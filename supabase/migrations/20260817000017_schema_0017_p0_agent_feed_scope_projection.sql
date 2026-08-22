-- Staged from db/0017_p0_agent_feed_scope_projection.sql; edit the canonical source, not this file.
-- P0 Agent Feed terminal scope projection.
--
-- A terminal receipt is deliberately redacted by the atomic Agent Feed
-- adapter before the host performs P0 reconciliation.  This append-only
-- projection preserves only the signed target-id scope needed to validate a
-- completed recovery subset.  It never retains, reconstructs, or exposes the
-- terminal raw payload.

begin;

create or replace function app_private.p0_scope_target_ids_valid(
    p_target_ids text[]
) returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
    select p_target_ids is not null
       and cardinality(p_target_ids) > 0
       and not exists (
           select 1
             from unnest(p_target_ids) as item(target_id)
            where item.target_id is null
               or item.target_id !~ '^p0t_[0-9a-f]{64}$'
       )
       and cardinality(p_target_ids) = (
           select count(distinct item.target_id)::integer
             from unnest(p_target_ids) as item(target_id)
       )
$$;

create table app_private.p0_agent_feed_receipt_scope_projections (
    receipt_id uuid primary key
        references app_private.agent_feed_receipts(id) on delete restrict,
    event_id text not null unique
        check (length(btrim(event_id)) > 0),
    stream_id text not null
        check (length(btrim(stream_id)) > 0),
    run_id text not null
        check (length(btrim(run_id)) > 0),
    expected_target_ids text[] not null
        check (app_private.p0_scope_target_ids_valid(expected_target_ids)),
    actual_target_ids text[] not null
        check (app_private.p0_scope_target_ids_valid(actual_target_ids)),
    projected_at timestamptz not null default now()
);

create index p0_agent_feed_scope_projections_run_idx
    on app_private.p0_agent_feed_receipt_scope_projections (stream_id, run_id);

create or replace function app_private.project_p0_agent_feed_receipt_scope()
returns trigger
language plpgsql
security definer
set search_path = app_private, pg_catalog
as $$
declare
    v_expected_target_ids text[];
    v_actual_target_ids text[];
begin
    -- The only capture point is the adapter's terminal redaction update.  A
    -- signed receipt that arrives already redacted has no scope to project;
    -- this prevents callers from manufacturing a projection after the fact.
    if tg_op <> 'UPDATE'
       or old.raw_payload = '{}'::jsonb
       or new.raw_payload is distinct from '{}'::jsonb
       or new.redaction_status is distinct from 'complete'
       or old.signature_verified is distinct from true
       or old.event_type is distinct from 'run.completed'
       or length(btrim(old.event_id)) = 0
       or length(btrim(old.stream_id)) = 0
       or length(btrim(old.run_id)) = 0
    then
        return new;
    end if;

    -- Scope is optional for a full-family completion.  Missing, malformed,
    -- duplicated, or divergent scopes intentionally produce no projection;
    -- reconciliation then fails closed if the checkpoint batch is a subset.
    if jsonb_typeof(old.raw_payload) is distinct from 'object'
       or jsonb_typeof(old.raw_payload->'payload') is distinct from 'object'
       or jsonb_typeof(old.raw_payload->'payload'->'expected_scope') is distinct from 'object'
       or jsonb_typeof(old.raw_payload->'payload'->'expected_scope'->'metadata') is distinct from 'object'
       or jsonb_typeof(old.raw_payload->'payload'->'expected_scope'->'metadata'->'target_ids') is distinct from 'array'
       or jsonb_typeof(old.raw_payload->'payload'->'actual_scope') is distinct from 'object'
       or jsonb_typeof(old.raw_payload->'payload'->'actual_scope'->'metadata') is distinct from 'object'
       or jsonb_typeof(old.raw_payload->'payload'->'actual_scope'->'metadata'->'target_ids') is distinct from 'array'
    then
        return new;
    end if;
    if exists (
        select 1
          from jsonb_array_elements(
              old.raw_payload->'payload'->'expected_scope'->'metadata'->'target_ids'
          ) as item(value)
         where jsonb_typeof(item.value) is distinct from 'string'
    ) or exists (
        select 1
          from jsonb_array_elements(
              old.raw_payload->'payload'->'actual_scope'->'metadata'->'target_ids'
          ) as item(value)
         where jsonb_typeof(item.value) is distinct from 'string'
    ) then
        return new;
    end if;

    select array_agg(item.value order by item.ordinality)
      into v_expected_target_ids
      from jsonb_array_elements_text(
          old.raw_payload->'payload'->'expected_scope'->'metadata'->'target_ids'
      ) with ordinality as item(value, ordinality);
    select array_agg(item.value order by item.ordinality)
      into v_actual_target_ids
      from jsonb_array_elements_text(
          old.raw_payload->'payload'->'actual_scope'->'metadata'->'target_ids'
      ) with ordinality as item(value, ordinality);

    if not app_private.p0_scope_target_ids_valid(v_expected_target_ids)
       or not app_private.p0_scope_target_ids_valid(v_actual_target_ids)
       or cardinality(v_expected_target_ids) is distinct from cardinality(v_actual_target_ids)
       or exists (
           select 1
             from unnest(v_expected_target_ids) as item(target_id)
            where not (item.target_id = any(v_actual_target_ids))
       )
       or exists (
           select 1
             from unnest(v_actual_target_ids) as item(target_id)
            where not (item.target_id = any(v_expected_target_ids))
       )
    then
        return new;
    end if;

    -- The receipt/run/event binding is copied from the already verified
    -- receipt row.  Require the base (non-replay) lifecycle row to exist and
    -- be terminal before allowing the projection to be written.
    if not exists (
        select 1
          from app_private.agent_feed_run_lifecycle as lifecycle
         where lifecycle.stream_id = old.stream_id
           and lifecycle.run_id = old.run_id
           and lifecycle.replay_attempt = 0
           and lifecycle.run_state in ('completed','partial','failed')
    ) then
        return new;
    end if;

    insert into app_private.p0_agent_feed_receipt_scope_projections (
        receipt_id, event_id, stream_id, run_id,
        expected_target_ids, actual_target_ids
    ) values (
        old.id, old.event_id, old.stream_id, old.run_id,
        v_expected_target_ids, v_actual_target_ids
    ) on conflict (receipt_id) do nothing;

    return new;
end;
$$;

create trigger p0_agent_feed_receipts_scope_projection
before update of raw_payload, redaction_status on app_private.agent_feed_receipts
for each row execute function app_private.project_p0_agent_feed_receipt_scope();

create trigger p0_agent_feed_scope_projections_immutable
before update or delete on app_private.p0_agent_feed_receipt_scope_projections
for each row execute function app_private.reject_p0_agent_feed_operation_mutation();

create trigger p0_agent_feed_scope_projections_no_truncate
before truncate on app_private.p0_agent_feed_receipt_scope_projections
for each statement execute function app_private.reject_p0_agent_feed_operation_truncate();

revoke all on app_private.p0_agent_feed_receipt_scope_projections from public;
revoke execute on function app_private.p0_scope_target_ids_valid(text[]) from public;
revoke execute on function app_private.project_p0_agent_feed_receipt_scope() from public;

comment on table app_private.p0_agent_feed_receipt_scope_projections is
    'Append-only signed terminal target scope projection; contains no Agent Feed raw payload and is used only for P0 subset reconciliation.';

-- Replace the historical reconciliation definition after the projection has
-- been created.  The old migration remains unchanged for migration-history
-- integrity; this definition is the active contract for new databases.
create or replace function app_private.reconcile_p0_agent_feed_work_unit(
    p_payload jsonb
) returns table (inserted_count integer, duplicate_count integer)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
    v_manifest app_private.p0_agent_feed_operation_manifests%rowtype;
    v_receipt app_private.agent_feed_receipts%rowtype;
    v_run app_private.agent_feed_run_lifecycle%rowtype;
    v_scope app_private.p0_agent_feed_receipt_scope_projections%rowtype;
    v_item jsonb;
    v_target app_private.p0_agent_feed_operation_targets%rowtype;
    v_existing app_private.p0_agent_feed_target_attempts%rowtype;
    v_expected_count integer;
    v_expected_work_unit_sha256 text;
    v_expected_scope_target_ids text[] := '{}';
    v_actual_scope_target_ids text[] := '{}';
    v_inserted integer := 0;
    v_duplicates integer := 0;
    v_seen text[] := '{}';
begin
    if jsonb_typeof(p_payload) is distinct from 'object'
       or array(select jsonb_object_keys(p_payload) order by 1) is distinct from
          array['checkpoints','family_id','manifest_sha256','plan_sha256','receipt_id','run_id','stream_id','terminal_status','version','work_unit_sha256']::text[]
       or p_payload->>'version' is distinct from 'p0-receipt-reconciliation.v1'
       or p_payload->>'manifest_sha256' is null
       or p_payload->>'plan_sha256' is null
       or p_payload->>'work_unit_sha256' !~ '^sha256:[0-9a-f]{64}$'
       or p_payload->>'terminal_status' not in ('completed','partial','failed')
       or jsonb_typeof(p_payload->'checkpoints') is distinct from 'array' then
        raise exception 'P0 receipt reconciliation payload is invalid' using errcode = '22023';
    end if;

    select * into v_manifest
      from app_private.p0_agent_feed_operation_manifests
     where manifest_sha256 = p_payload->>'manifest_sha256'
       and plan_sha256 = p_payload->>'plan_sha256'
     for share;
    if not found then
        raise exception 'P0 operation manifest was not found' using errcode = '22023';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(p_payload->>'manifest_sha256', 0));

    begin
        select * into v_receipt
          from app_private.agent_feed_receipts
         where id = (p_payload->>'receipt_id')::uuid
         for share;
    exception when others then
        raise exception 'P0 receipt identity is invalid' using errcode = '22023';
    end;
    if not found
       or v_receipt.run_id is distinct from p_payload->>'run_id'
       or v_receipt.stream_id is distinct from p_payload->>'stream_id'
       or v_receipt.signature_verified is distinct from true
       or v_receipt.redaction_status is distinct from 'complete'
       or v_receipt.event_type is distinct from ('run.' || (p_payload->>'terminal_status')) then
        raise exception 'P0 receipt does not bind the declared run and stream' using errcode = '22023';
    end if;
    select * into v_run
      from app_private.agent_feed_run_lifecycle
     where stream_id = p_payload->>'stream_id'
       and run_id = p_payload->>'run_id'
       and replay_attempt = 0
     for share;
    if not found
       or v_run.run_state is distinct from p_payload->>'terminal_status'
       or v_run.terminal_status is distinct from p_payload->>'terminal_status' then
        raise exception 'P0 reconciliation is not bound to a matching terminal run' using errcode = '22023';
    end if;

    -- A projection is optional for a full-family completion, but when one is
    -- present its receipt/event/run binding must still be exact.  This makes
    -- an inserted or replayed projection unable to widen another run's scope.
    select * into v_scope
      from app_private.p0_agent_feed_receipt_scope_projections
     where receipt_id = v_receipt.id
     for share;
    if found and (
        v_scope.event_id is distinct from v_receipt.event_id
        or v_scope.stream_id is distinct from v_receipt.stream_id
        or v_scope.run_id is distinct from v_receipt.run_id
    ) then
        raise exception 'P0 receipt scope projection does not bind the receipt' using errcode = '22023';
    end if;

    select count(*) into v_expected_count
      from app_private.p0_agent_feed_operation_targets
     where manifest_id = v_manifest.id
       and stream_id = p_payload->>'stream_id'
       and family_id = p_payload->>'family_id';
    if v_expected_count = 0 then
        raise exception 'P0 work unit is absent from the manifest' using errcode = '22023';
    end if;
    select 'sha256:' || encode(extensions.digest(convert_to(
        '{"family_id":' || to_jsonb(p_payload->>'family_id')::text ||
        ',"manifest_sha256":' || to_jsonb(v_manifest.manifest_sha256)::text ||
        ',"plan_sha256":' || to_jsonb(v_manifest.plan_sha256)::text ||
        ',"stream_id":' || to_jsonb(p_payload->>'stream_id')::text ||
        ',"targets":[' || string_agg(
            '{"cadence_seconds":' || target.cadence_seconds::text ||
            ',"family_id":' || to_jsonb(target.family_id)::text ||
            ',"source_role_id":' || to_jsonb(target.source_role_id)::text ||
            ',"stream_id":' || to_jsonb(target.stream_id)::text ||
            ',"target_id":' || to_jsonb(target.target_id)::text || '}',
            ',' order by target.family_id, target.source_role_id
        ) || '],"version":"p0-family-work-unit.v1"}',
        'UTF8'
    ), 'sha256'), 'hex')
      into v_expected_work_unit_sha256
      from app_private.p0_agent_feed_operation_targets as target
     where target.manifest_id = v_manifest.id
       and target.stream_id = p_payload->>'stream_id'
       and target.family_id = p_payload->>'family_id';
    if p_payload->>'work_unit_sha256' is distinct from v_expected_work_unit_sha256 then
        raise exception 'P0 work unit hash is invalid' using errcode = '22023';
    end if;
    if p_payload->>'terminal_status' = 'completed'
       and jsonb_array_length(p_payload->'checkpoints') = 0 then
        raise exception 'completed P0 work unit is missing checkpoints' using errcode = '22023';
    end if;

    -- A normal completed work unit still covers the entire manifest family.
    -- Recovery runs may deliberately complete a nonempty subset, but only
    -- when the exact signed scope was projected before receipt redaction.  If
    -- a projection exists, it is authoritative even when the submitted batch
    -- happens to contain the whole family: a signed subset cannot be widened
    -- by adding extra checkpoints.
    if p_payload->>'terminal_status' = 'completed'
       and v_scope.receipt_id is not null then
        v_expected_scope_target_ids := v_scope.expected_target_ids;
        v_actual_scope_target_ids := v_scope.actual_target_ids;
        if cardinality(v_expected_scope_target_ids) = 0
           or cardinality(v_expected_scope_target_ids) is distinct from (
               select count(distinct target_id)
                 from unnest(v_expected_scope_target_ids) as scope(target_id)
           ) then
            raise exception 'projected P0 expected target scope is empty or repeated' using errcode = '22023';
        end if;
        if cardinality(v_expected_scope_target_ids) <> jsonb_array_length(p_payload->'checkpoints')
           or cardinality(v_expected_scope_target_ids) is distinct from (
               select count(*)
                 from app_private.p0_agent_feed_operation_targets as target
                where target.manifest_id = v_manifest.id
                  and target.stream_id = p_payload->>'stream_id'
                  and target.family_id = p_payload->>'family_id'
                  and target.target_id = any(v_expected_scope_target_ids)
           ) then
            raise exception 'projected P0 expected target scope does not match the manifest work unit' using errcode = '22023';
        end if;
        if cardinality(v_actual_scope_target_ids) = 0
           or cardinality(v_actual_scope_target_ids) is distinct from (
               select count(distinct target_id)
                 from unnest(v_actual_scope_target_ids) as scope(target_id)
           )
           or cardinality(v_actual_scope_target_ids) <> cardinality(v_expected_scope_target_ids)
           or exists (
               select 1
                 from unnest(v_expected_scope_target_ids) as scope(target_id)
                where not (scope.target_id = any(v_actual_scope_target_ids))
           ) then
            raise exception 'projected P0 actual target scope does not match expected scope' using errcode = '22023';
        end if;
    elsif p_payload->>'terminal_status' = 'completed'
       and jsonb_array_length(p_payload->'checkpoints') < v_expected_count then
        raise exception 'completed P0 subset has no signed scope projection' using errcode = '22023';
    end if;

    -- Preflight every member before the first insert.
    for v_item in select value from jsonb_array_elements(p_payload->'checkpoints')
    loop
        if jsonb_typeof(v_item) is distinct from 'object'
           or array(select jsonb_object_keys(v_item) order by 1) is distinct from
              array['attempt_number','economic_findings_accepted','event_id','family_id','idempotency_key','input_sha256','locator','locator_fingerprint','manifest_sha256','observed_at','outcome','receipt_id','run_id','source_role_id','stream_id','target_id','version']::text[]
           or v_item->>'version' is distinct from 'p0-target-checkpoint.v1'
           or v_item->>'manifest_sha256' is distinct from v_manifest.manifest_sha256
           or v_item->>'stream_id' is distinct from p_payload->>'stream_id'
           or v_item->>'family_id' is distinct from p_payload->>'family_id'
           or v_item->>'run_id' is distinct from p_payload->>'run_id'
           or v_item->>'receipt_id' is distinct from p_payload->>'receipt_id'
           or v_item->>'event_id' is distinct from v_receipt.event_id
           or v_item->>'input_sha256' !~ '^sha256:[0-9a-f]{64}$'
           or v_item->>'outcome' not in (
               'resolved','not_found_this_attempt','access_blocked','authentication_required',
               'timeout','unsupported_content','validation_rejected','interrupted'
           )
           or jsonb_typeof(v_item->'attempt_number') is distinct from 'number'
           or jsonb_typeof(v_item->'economic_findings_accepted') is distinct from 'number'
           or (v_item->>'attempt_number')::numeric < 1
           or trunc((v_item->>'attempt_number')::numeric) is distinct from (v_item->>'attempt_number')::numeric
           or (v_item->>'economic_findings_accepted')::numeric < 0
           or trunc((v_item->>'economic_findings_accepted')::numeric) is distinct from (v_item->>'economic_findings_accepted')::numeric then
            raise exception 'P0 target checkpoint is invalid' using errcode = '22023';
        end if;
        if (v_item->>'target_id') = any(v_seen) then
            raise exception 'P0 reconciliation repeats a target' using errcode = '22023';
        end if;
        v_seen := array_append(v_seen, v_item->>'target_id');
        select * into v_target
          from app_private.p0_agent_feed_operation_targets
         where manifest_id = v_manifest.id
           and target_id = v_item->>'target_id'
           and stream_id = v_item->>'stream_id'
           and family_id = v_item->>'family_id'
           and source_role_id = v_item->>'source_role_id';
        if not found then
            raise exception 'P0 checkpoint target is not in the work unit' using errcode = '22023';
        end if;
        if (v_item->>'outcome' = 'resolved') is distinct from
           ((v_item->'locator') <> 'null'::jsonb and (v_item->'locator_fingerprint') <> 'null'::jsonb) then
            raise exception 'P0 locator fields do not match checkpoint outcome' using errcode = '22023';
        end if;
        if v_item->>'outcome' = 'resolved'
           and (length(v_item->>'locator') > 2048 or v_item->>'locator' !~ '^https://') then
            raise exception 'P0 locator is invalid' using errcode = '22023';
        end if;
        select * into v_existing
          from app_private.p0_agent_feed_target_attempts
         where manifest_id = v_manifest.id
           and target_id = v_item->>'target_id'
           and idempotency_key = v_item->>'idempotency_key';
        if found and (
            v_existing.attempt_number is distinct from (v_item->>'attempt_number')::integer
            or v_existing.work_unit_sha256 is distinct from p_payload->>'work_unit_sha256'
            or v_existing.observed_at is distinct from (v_item->>'observed_at')::timestamptz
            or v_existing.outcome is distinct from v_item->>'outcome'
            or v_existing.run_id is distinct from v_item->>'run_id'
            or v_existing.event_id is distinct from v_item->>'event_id'
            or v_existing.input_sha256 is distinct from v_item->>'input_sha256'
            or v_existing.receipt_id::text is distinct from v_item->>'receipt_id'
            or v_existing.locator is distinct from
               case when v_item->'locator' = 'null'::jsonb then null else v_item->>'locator' end
            or v_existing.locator_fingerprint is distinct from
               case when v_item->'locator_fingerprint' = 'null'::jsonb then null else v_item->>'locator_fingerprint' end
            or v_existing.economic_findings_accepted is distinct from
               (v_item->>'economic_findings_accepted')::integer
        ) then
            raise exception 'P0 checkpoint idempotency key was reused with different content' using errcode = '55000';
        end if;
        if not found and exists (
            select 1 from app_private.p0_agent_feed_target_attempts
             where manifest_id = v_manifest.id and target_id = v_item->>'target_id'
               and attempt_number >= (v_item->>'attempt_number')::integer
        ) then
            raise exception 'P0 checkpoint attempt number is not monotone' using errcode = '55000';
        end if;
    end loop;

    if p_payload->>'terminal_status' = 'completed'
       and v_scope.receipt_id is not null
       and (
           cardinality(v_seen) is distinct from cardinality(v_expected_scope_target_ids)
           or exists (
               select 1
                 from unnest(v_expected_scope_target_ids) as scope(target_id)
                where not (scope.target_id = any(v_seen))
           )
           or exists (
               select 1
                 from unnest(v_seen) as checkpoint(target_id)
                where not (checkpoint.target_id = any(v_expected_scope_target_ids))
           )
       ) then
        raise exception 'completed P0 checkpoints do not exactly match projected target scope' using errcode = '22023';
    end if;

    for v_item in select value from jsonb_array_elements(p_payload->'checkpoints')
    loop
        insert into app_private.p0_agent_feed_target_attempts (
            manifest_id, target_id, work_unit_sha256, attempt_number, observed_at,
            outcome, run_id, event_id, receipt_id, idempotency_key, input_sha256,
            locator, locator_fingerprint, economic_findings_accepted
        ) values (
            v_manifest.id, v_item->>'target_id', p_payload->>'work_unit_sha256',
            (v_item->>'attempt_number')::integer, (v_item->>'observed_at')::timestamptz,
            v_item->>'outcome', v_item->>'run_id', v_item->>'event_id',
            (v_item->>'receipt_id')::uuid, v_item->>'idempotency_key', v_item->>'input_sha256',
            case when v_item->'locator' = 'null'::jsonb then null else v_item->>'locator' end,
            case when v_item->'locator_fingerprint' = 'null'::jsonb then null else v_item->>'locator_fingerprint' end,
            (v_item->>'economic_findings_accepted')::integer
        ) on conflict (manifest_id, target_id, idempotency_key) do nothing;
        if found then v_inserted := v_inserted + 1; else v_duplicates := v_duplicates + 1; end if;
    end loop;
    inserted_count := v_inserted;
    duplicate_count := v_duplicates;
    return next;
end;
$$;

revoke execute on function app_private.reconcile_p0_agent_feed_work_unit(jsonb) from public;

commit;
