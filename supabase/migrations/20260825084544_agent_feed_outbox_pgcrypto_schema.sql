-- Staged from db/0034_agent_feed_outbox_pgcrypto_schema.sql; edit the canonical source, not this file.
-- Supabase installs pgcrypto in the `extensions` schema. Agent Feed's durable
-- outbox trigger historically called digest() unqualified, which fails when a
-- caller uses a locked-down search_path that excludes `extensions`.
-- Preserve the current trigger behavior and qualify only the pgcrypto call.

begin;

create or replace function agent_feed.set_outbox_event_defaults()
returns trigger
language plpgsql
set search_path = pg_catalog, agent_feed
as $$
declare
  run_tenant text;
  run_stream text;
  run_wire_id text;
begin
  select tenant_id, stream_id, wire_run_id
    into run_tenant, run_stream, run_wire_id
    from agent_feed.runs
   where id = new.run_id;
  if run_tenant is null then
    raise exception 'outbox event run does not exist';
  end if;
  if new.tenant_id <> run_tenant or new.stream_id <> run_stream then
    raise exception 'outbox event crosses run or tenant scope';
  end if;
  if new.wire_run_id is null or new.wire_run_id = '' then
    new.wire_run_id := run_wire_id;
  elsif new.wire_run_id <> run_wire_id then
    raise exception 'outbox event wire run identity mismatch';
  end if;

  new.tenant_id := coalesce(nullif(new.tenant_id, ''), 'default');
  new.event_id := coalesce(nullif(new.event_id, ''), gen_random_uuid()::text);
  new.event_key := coalesce(nullif(new.event_key, ''), new.event_id);
  new.protocol_version := coalesce(new.protocol_version, '0.1');
  new.occurred_at := coalesce(new.occurred_at, new.created_at, now());
  new.trace_id := coalesce(nullif(new.trace_id, ''), md5(gen_random_uuid()::text));
  new.wire_finding_id := coalesce(nullif(new.wire_finding_id, ''), new.finding_id::text);
  new.finding_type := coalesce(nullif(new.finding_type, ''), new.payload ->> 'finding_type');
  new.routing_tags := coalesce(new.routing_tags, new.payload -> 'routing_tags', '[]'::jsonb);
  new.payload_hash := coalesce(
    nullif(new.payload_hash, ''),
    encode(
      extensions.digest(convert_to(new.payload::text, 'utf8'), 'sha256'),
      'hex'
    )
  );
  new.delivery_eligibility := coalesce(new.delivery_eligibility, 'eligible');
  new.delivery_position := agent_feed.next_tenant_event_position(new.tenant_id);
  new.stream_position := agent_feed.next_stream_event_position(new.tenant_id, new.stream_id);
  return new;
end
$$;

comment on function agent_feed.set_outbox_event_defaults() is
  'Agent Feed durable outbox defaults with Supabase-safe qualified pgcrypto digest lookup.';

commit;
