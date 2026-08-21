-- Rewards Optimizer: Milestone 2.5 persistence hardening.
--
-- This migration is deliberately additive.  The Agent Feed service remains a
-- separate system: this file creates no foreign data wrappers, cross-database
-- credentials, database links, or Realtime dependencies.  The only durable
-- ingress boundary is app_private.accept_agent_feed_event(), which must be
-- called after the HTTP consumer has verified the signed delivery.
begin;

-- ----------
-- Small JSON helpers used by CHECK constraints and canonical-document sync.
-- ----------

create or replace function app_private.is_jsonb_string_array(p_value jsonb)
returns boolean
language sql
immutable
as $$
    select case
        when jsonb_typeof(p_value) <> 'array' then false
        else not exists (
            select 1
              from jsonb_array_elements(p_value) as item(value)
             where jsonb_typeof(item.value) <> 'string'
        )
    end
$$;

create or replace function app_private.is_jsonb_unique_string_array(p_value jsonb)
returns boolean
language sql
immutable
as $$
    select case
        when not app_private.is_jsonb_string_array(p_value) then false
        else jsonb_array_length(p_value) = (
            select count(distinct item.value)
              from jsonb_array_elements(p_value) as item(value)
        )
    end
$$;

create or replace function app_private.is_jsonb_object_with_exact_keys(
    p_value jsonb,
    p_keys text[]
) returns boolean
language sql
immutable
as $$
    select case
        when jsonb_typeof(p_value) <> 'object' then false
        else p_value ?& p_keys
         and (select count(*) from jsonb_object_keys(p_value)) = cardinality(p_keys)
    end
$$;

create or replace function app_private.is_source_observation_subject_array(p_value jsonb)
returns boolean
language sql
immutable
as $$
    select case
        when jsonb_typeof(p_value) <> 'array' or jsonb_array_length(p_value) = 0 then false
        else not exists (
            select 1
              from jsonb_array_elements(p_value) as item(value)
             where jsonb_typeof(item.value) <> 'object'
                or not (item.value ?& array['type','id','name'])
                or (select count(*) from jsonb_object_keys(item.value)) <> 3
                or jsonb_typeof(item.value->'type') <> 'string'
                or jsonb_typeof(item.value->'id') not in ('string','null')
                or jsonb_typeof(item.value->'name') not in ('string','null')
        )
    end
$$;

create or replace function app_private.is_source_observation_assessment(p_value jsonb)
returns boolean
language plpgsql
immutable
as $$
declare
    v_confidence numeric;
begin
    if jsonb_typeof(p_value) <> 'object'
       or not (p_value ?& array['source_authority_claim','evidence_completeness','agent_confidence'])
       or (select count(*) from jsonb_object_keys(p_value)) <> 3
       or p_value->>'source_authority_claim' not in ('primary','official_secondary','third_party','unknown')
       or p_value->>'evidence_completeness' not in ('complete','partial','lead_only')
       or jsonb_typeof(p_value->'agent_confidence') not in ('number','null') then
        return false;
    end if;
    if jsonb_typeof(p_value->'agent_confidence') = 'null' then
        return true;
    end if;
    v_confidence := (p_value->>'agent_confidence')::numeric;
    return v_confidence between 0 and 1;
exception when invalid_text_representation or numeric_value_out_of_range then
    return false;
end;
$$;

create or replace function app_private.jsonb_timestamp(p_value jsonb)
returns timestamptz
language plpgsql
immutable
as $$
begin
    if p_value is null or p_value = 'null'::jsonb then
        return null;
    end if;
    if jsonb_typeof(p_value) <> 'string' then
        raise exception 'timestamp JSON value must be a string or null'
            using errcode = '22023';
    end if;
    return p_value #>> '{}';
exception when datetime_field_overflow or invalid_datetime_format then
    raise exception 'invalid timestamp JSON value %', p_value
        using errcode = '22007';
end;
$$;

revoke execute on function app_private.is_jsonb_string_array(jsonb) from public;
revoke execute on function app_private.is_jsonb_unique_string_array(jsonb) from public;
revoke execute on function app_private.is_jsonb_object_with_exact_keys(jsonb,text[]) from public;
revoke execute on function app_private.is_source_observation_subject_array(jsonb) from public;
revoke execute on function app_private.is_source_observation_assessment(jsonb) from public;
revoke execute on function app_private.jsonb_timestamp(jsonb) from public;

create or replace function app_private.is_jsonb_evidence_key_array(p_value jsonb)
returns boolean
language sql
immutable
as $$
    select app_private.is_jsonb_unique_string_array(p_value)
       and not exists (
           select 1
             from jsonb_array_elements(p_value) as item(value)
            where item.value #>> '{}' !~ '^ev_[a-z0-9_-]+$'
       )
$$;

revoke execute on function app_private.is_jsonb_evidence_key_array(jsonb) from public;

-- Give callers a stable, non-generic SQLSTATE for invalid lifecycle moves.
create or replace function app_private.enforce_source_observation_transition()
returns trigger
language plpgsql
as $$
begin
    if new.status = old.status then
        return new;
    end if;
    if old.status = 'new' and new.status in ('duplicate','needs_evidence','needs_review','rejected','closed') then
        return new;
    elsif old.status = 'needs_evidence' and new.status in ('needs_review','rejected','closed') then
        return new;
    elsif old.status = 'needs_review' and new.status in ('rejected','closed') then
        return new;
    end if;
    raise exception 'invalid SourceObservation transition % -> %', old.status, new.status
        using errcode = '55000';
end;
$$;

revoke execute on function app_private.enforce_source_observation_transition() from public;

-- ----------
-- Durable verified transport intake and diagnostics.
-- ----------

alter table app_private.agent_feed_receipts
    add column delivery_id text not null default 'legacy-unavailable',
    add column signature_timestamp timestamptz not null default now(),
    add column signature_key_id text not null default 'legacy-unverified',
    add column delivery_attempt integer not null default 1,
    add column transport_payload_hash text,
    add column signature_verified boolean not null default false,
    add column acknowledged_at timestamptz,
    add column receipt_inserted_at timestamptz not null default now();

-- Preserve the pre-M2.5 insert contract for trusted migration/test callers
-- while making the verified intake function supply the real transport hash.
-- A column default cannot refer to payload_hash, so use a narrow row trigger.
create or replace function app_private.sync_agent_feed_receipt_transport_hash()
returns trigger
language plpgsql
as $$
begin
    if new.transport_payload_hash is null then
        new.transport_payload_hash := new.payload_hash;
    end if;
    return new;
end;
$$;

create trigger agent_feed_receipts_transport_hash_default
before insert or update of payload_hash, transport_payload_hash
on app_private.agent_feed_receipts
for each row execute function app_private.sync_agent_feed_receipt_transport_hash();

revoke execute on function app_private.sync_agent_feed_receipt_transport_hash() from public;

update app_private.agent_feed_receipts
   set transport_payload_hash = payload_hash
 where transport_payload_hash is null;

-- Existing terminal receipts predate the fail-closed payload-erasure rule.
-- Redact them before validating the additive constraint during an upgrade.
update app_private.agent_feed_receipts
   set raw_payload = '{}'::jsonb,
       redaction_status = 'complete'
 where processing_status in ('mapped','duplicate','quarantined','failed')
   and (raw_payload <> '{}'::jsonb or redaction_status <> 'complete');

alter table app_private.agent_feed_receipts
    alter column transport_payload_hash set not null;

alter table app_private.agent_feed_receipts
    add constraint agent_feed_receipts_delivery_id_ck
        check (length(btrim(delivery_id)) > 0),
    add constraint agent_feed_receipts_signature_key_id_ck
        check (length(btrim(signature_key_id)) > 0),
    add constraint agent_feed_receipts_delivery_attempt_ck
        check (delivery_attempt > 0),
    add constraint agent_feed_receipts_transport_hash_ck
        check (transport_payload_hash ~ '^sha256:[0-9a-f]{64}$'),
    add constraint agent_feed_receipts_terminal_redacted_ck
        check (
            processing_status not in ('mapped','duplicate','quarantined','failed')
            or (redaction_status = 'complete' and raw_payload = '{}'::jsonb)
        ),
    add constraint agent_feed_receipts_ack_after_insert_ck
        check (acknowledged_at is null or acknowledged_at >= receipt_inserted_at);

comment on column app_private.agent_feed_receipts.signature_timestamp is
    'Timestamp covered by the verified Agent Feed signature; stale-window policy is enforced by the HTTP consumer.';
comment on column app_private.agent_feed_receipts.signature_key_id is
    'Rewards-owned key identifier selected by the verified signature resolver.';
comment on column app_private.agent_feed_receipts.delivery_attempt is
    'Producer delivery attempt number; event identity and payload identity remain stable across retries.';
comment on column app_private.agent_feed_receipts.transport_payload_hash is
    'Hash of the first exact signed transport payload, retained after payload redaction; per-attempt hashes are stored separately.';
comment on column app_private.agent_feed_receipts.payload_hash is
    'Stable event identity hash computed without the delivery attempt field; it must remain unchanged across retries.';
comment on column app_private.agent_feed_receipts.delivery_id is
    'Producer delivery identifier presented by the authenticated transport.';

create table app_private.agent_feed_delivery_attempts (
    id uuid primary key default gen_random_uuid(),
    receipt_id uuid not null references app_private.agent_feed_receipts(id) on delete restrict,
    delivery_id text not null check (length(btrim(delivery_id)) > 0),
    attempt_number integer not null check (attempt_number > 0),
    attempted_at timestamptz not null default now(),
    signature_timestamp timestamptz not null,
    signature_key_id text not null check (length(btrim(signature_key_id)) > 0),
    transport_payload_hash text not null check (transport_payload_hash ~ '^sha256:[0-9a-f]{64}$'),
    outcome text not null check (outcome in (
        'accepted','rejected','retryable_failure','dead_letter','replayed'
    )),
    http_status integer check (http_status is null or http_status between 100 and 599),
    error_code text,
    diagnostic jsonb not null default '{}'::jsonb check (jsonb_typeof(diagnostic) = 'object'),
    redaction_status text not null default 'pending' check (redaction_status in ('pending','complete')),
    redacted_at timestamptz,
    retention_class text not null default 'short_operational',
    purge_after timestamptz not null default (now() + interval '30 days'),
    created_at timestamptz not null default now(),
    unique (receipt_id, attempt_number),
    check (redacted_at is null or redacted_at >= attempted_at),
    check (redaction_status <> 'complete' or (diagnostic = '{}'::jsonb and redacted_at is not null))
);

create index agent_feed_delivery_attempts_receipt_idx
    on app_private.agent_feed_delivery_attempts (receipt_id, attempt_number desc);

create table app_private.agent_feed_dead_letters (
    id uuid primary key default gen_random_uuid(),
    receipt_id uuid references app_private.agent_feed_receipts(id) on delete restrict,
    event_id text not null,
    reason_code text not null check (length(btrim(reason_code)) > 0),
    first_failed_at timestamptz not null default now(),
    last_failed_at timestamptz not null default now(),
    replay_status text not null default 'not_requested' check (replay_status in (
        'not_requested','requested','in_progress','completed','exhausted','rejected'
    )),
    replay_cursor text,
    diagnostic jsonb not null default '{}'::jsonb check (jsonb_typeof(diagnostic) = 'object'),
    redaction_status text not null default 'pending' check (redaction_status in ('pending','complete')),
    redacted_at timestamptz,
    retention_class text not null default 'short_operational',
    purge_after timestamptz not null default (now() + interval '90 days'),
    created_at timestamptz not null default now(),
    check (last_failed_at >= first_failed_at),
    check (redacted_at is null or redacted_at >= first_failed_at),
    check (redaction_status <> 'complete' or (diagnostic = '{}'::jsonb and redacted_at is not null))
);

create unique index agent_feed_dead_letters_open_event_idx
    on app_private.agent_feed_dead_letters (event_id)
    where replay_status in ('not_requested','requested','in_progress');
create index agent_feed_dead_letters_receipt_idx
    on app_private.agent_feed_dead_letters (receipt_id, created_at desc);

create table app_private.agent_feed_replay_requests (
    id uuid primary key default gen_random_uuid(),
    event_id text,
    receipt_id uuid references app_private.agent_feed_receipts(id) on delete restrict,
    cursor text,
    requested_by text not null,
    requested_at timestamptz not null default now(),
    status text not null default 'requested' check (status in (
        'requested','claimed','completed','failed','cancelled'
    )),
    completed_at timestamptz,
    result_code text,
    diagnostic jsonb not null default '{}'::jsonb check (jsonb_typeof(diagnostic) = 'object'),
    redaction_status text not null default 'pending' check (redaction_status in ('pending','complete')),
    redacted_at timestamptz,
    purge_after timestamptz not null default (now() + interval '90 days'),
    created_at timestamptz not null default now(),
    check (event_id is not null or cursor is not null),
    check (receipt_id is not null or event_id is not null or cursor is not null),
    check (completed_at is null or completed_at >= requested_at),
    check (redacted_at is null or redacted_at >= requested_at),
    check (redaction_status <> 'complete' or (diagnostic = '{}'::jsonb and redacted_at is not null))
);

create index agent_feed_replay_requests_status_idx
    on app_private.agent_feed_replay_requests (status, requested_at);

create or replace function app_private.protect_agent_feed_delivery_attempt()
returns trigger
language plpgsql
as $$
begin
    if tg_op = 'DELETE' then
        raise exception 'agent feed delivery attempts are append-only'
            using errcode = '55000';
    end if;

    if (to_jsonb(new) - array['diagnostic','redaction_status','redacted_at','purge_after'])
       <> (to_jsonb(old) - array['diagnostic','redaction_status','redacted_at','purge_after']) then
        raise exception 'delivery attempt identity and outcome are immutable'
            using errcode = '55000';
    end if;

    if new.redaction_status <> 'complete'
       or new.diagnostic <> '{}'::jsonb
       or new.redacted_at is null then
        raise exception 'delivery attempt diagnostics may only be safely redacted'
            using errcode = '55000';
    end if;
    return new;
end;
$$;

create trigger agent_feed_delivery_attempts_immutable
before update or delete on app_private.agent_feed_delivery_attempts
for each row execute function app_private.protect_agent_feed_delivery_attempt();

create or replace function app_private.protect_agent_feed_dead_letter()
returns trigger
language plpgsql
as $$
begin
    if tg_op = 'DELETE' then
        raise exception 'agent feed dead letters are append-only'
            using errcode = '55000';
    end if;
    if (to_jsonb(new) - array['last_failed_at','diagnostic','redaction_status','redacted_at','replay_status','replay_cursor','purge_after'])
       <> (to_jsonb(old) - array['last_failed_at','diagnostic','redaction_status','redacted_at','replay_status','replay_cursor','purge_after']) then
        raise exception 'dead-letter identity and failure evidence are immutable'
            using errcode = '55000';
    end if;
    if new.replay_status <> old.replay_status then
        if not (
            (old.replay_status = 'not_requested' and new.replay_status in ('requested','rejected'))
            or (old.replay_status = 'requested' and new.replay_status in ('in_progress','rejected'))
            or (old.replay_status = 'in_progress' and new.replay_status in ('completed','exhausted','rejected'))
        ) then
            raise exception 'invalid dead-letter replay transition % -> %', old.replay_status, new.replay_status
                using errcode = '55000';
        end if;
    end if;
    if new.redaction_status <> 'complete'
       or new.diagnostic <> '{}'::jsonb
       or new.redacted_at is null then
        raise exception 'dead-letter diagnostics may only be safely redacted'
            using errcode = '55000';
    end if;
    return new;
end;
$$;

create trigger agent_feed_dead_letters_immutable
before update or delete on app_private.agent_feed_dead_letters
for each row execute function app_private.protect_agent_feed_dead_letter();

create or replace function app_private.protect_agent_feed_replay_request()
returns trigger
language plpgsql
as $$
begin
    if tg_op = 'DELETE' then
        raise exception 'agent feed replay requests are append-only'
            using errcode = '55000';
    end if;
    if (to_jsonb(new) - array['status','completed_at','result_code','diagnostic','redaction_status','redacted_at','purge_after'])
       <> (to_jsonb(old) - array['status','completed_at','result_code','diagnostic','redaction_status','redacted_at','purge_after']) then
        raise exception 'replay request identity is immutable'
            using errcode = '55000';
    end if;
    if new.status <> old.status and not (
        (old.status = 'requested' and new.status in ('claimed','failed','cancelled'))
        or (old.status = 'claimed' and new.status in ('completed','failed','cancelled'))
    ) then
        raise exception 'invalid replay request transition % -> %', old.status, new.status
            using errcode = '55000';
    end if;
    if new.redaction_status <> 'complete'
       or new.diagnostic <> '{}'::jsonb
       or new.redacted_at is null then
        raise exception 'replay diagnostics may only be safely redacted'
            using errcode = '55000';
    end if;
    return new;
end;
$$;

create trigger agent_feed_replay_requests_immutable
before update or delete on app_private.agent_feed_replay_requests
for each row execute function app_private.protect_agent_feed_replay_request();

-- The function is the only acknowledgement-safe intake boundary.  The HTTP
-- layer verifies HMAC/timestamp/key policy; this function atomically records
-- the verified metadata and returns the existing row for a retry.
create or replace function app_private.accept_agent_feed_event(
    p_event_id text,
    p_protocol_version text,
    p_stream_id text,
    p_run_id text,
    p_finding_id text,
    p_event_type text,
    p_delivery_id text,
    p_signature_timestamp timestamptz,
    p_signature_key_id text,
    p_delivery_attempt integer,
    p_payload_hash text,
    p_transport_payload_hash text,
    p_raw_payload jsonb,
    p_signature_verified boolean default true,
    p_received_at timestamptz default now()
) returns table (
    receipt_id uuid,
    event_id text,
    inserted boolean,
    duplicate boolean,
    acknowledged boolean,
    processing_status text
)
language plpgsql
security definer
set search_path = app_private, pg_catalog
as $$
declare
    v_receipt app_private.agent_feed_receipts%rowtype;
    v_attempt app_private.agent_feed_delivery_attempts%rowtype;
    v_rows integer;
begin
    if p_protocol_version <> '0.1' then
        raise exception 'unsupported Agent Feed protocol %', p_protocol_version
            using errcode = '22023';
    end if;
    if p_signature_verified is not true then
        raise exception 'signed event must be verified before durable intake'
            using errcode = '28000';
    end if;
    if p_event_id is null or length(btrim(p_event_id)) = 0
       or p_stream_id is null or length(btrim(p_stream_id)) = 0
       or p_run_id is null or length(btrim(p_run_id)) = 0 then
        raise exception 'event_id, stream_id, and run_id are required'
            using errcode = '22023';
    end if;
    if p_delivery_id is null or length(btrim(p_delivery_id)) = 0
       or p_signature_timestamp is null or p_signature_key_id is null
       or length(btrim(p_signature_key_id)) = 0 then
        raise exception 'delivery id, verified signature timestamp, and key id are required'
            using errcode = '22023';
    end if;
    if p_delivery_attempt is null or p_delivery_attempt < 1 then
        raise exception 'delivery attempt must be positive'
            using errcode = '22023';
    end if;
    if p_payload_hash is null or p_payload_hash !~ '^sha256:[0-9a-f]{64}$'
       or p_transport_payload_hash is null
       or p_transport_payload_hash !~ '^sha256:[0-9a-f]{64}$' then
        raise exception 'stable and transport payload hashes must be sha256-prefixed'
            using errcode = '22023';
    end if;
    if p_raw_payload is null or jsonb_typeof(p_raw_payload) <> 'object' then
        raise exception 'raw transport payload must be a JSON object'
            using errcode = '22023';
    end if;

    insert into app_private.agent_feed_receipts (
        event_id, protocol_version, stream_id, run_id, finding_id, event_type,
        delivery_id, received_at, payload_hash, transport_payload_hash, raw_payload,
        signature_timestamp, signature_key_id, delivery_attempt,
        signature_verified, receipt_inserted_at
    ) values (
        p_event_id, p_protocol_version, p_stream_id, p_run_id, p_finding_id, p_event_type,
        p_delivery_id, coalesce(p_received_at, now()), p_payload_hash, p_transport_payload_hash,
        p_raw_payload, p_signature_timestamp, p_signature_key_id, p_delivery_attempt,
        true, now()
    ) on conflict on constraint agent_feed_receipts_event_id_key do nothing;

    get diagnostics v_rows = row_count;
    select r.* into v_receipt
      from app_private.agent_feed_receipts as r
     where r.event_id = p_event_id
     for update;

    if not found then
        raise exception 'durable Agent Feed receipt disappeared for event %', p_event_id
            using errcode = '40001';
    end if;

    if v_receipt.payload_hash <> p_payload_hash
       or v_receipt.stream_id <> p_stream_id
       or v_receipt.run_id <> p_run_id then
        raise exception 'event idempotency payload or routing mismatch for %', p_event_id
            using errcode = '22000';
    end if;

    insert into app_private.agent_feed_delivery_attempts (
        receipt_id, delivery_id, attempt_number, attempted_at, signature_timestamp,
        signature_key_id, transport_payload_hash, outcome, diagnostic
    ) values (
        v_receipt.id, p_delivery_id, p_delivery_attempt, coalesce(p_received_at, now()),
        p_signature_timestamp, p_signature_key_id, p_transport_payload_hash,
        case when v_rows = 1 then 'accepted' else 'replayed' end,
        jsonb_build_object('event_id', p_event_id, 'protocol_version', p_protocol_version)
    ) on conflict on constraint agent_feed_delivery_attempts_receipt_id_attempt_number_key do nothing;

    select a.* into v_attempt
      from app_private.agent_feed_delivery_attempts as a
     where a.receipt_id = v_receipt.id
       and a.attempt_number = p_delivery_attempt;
    if v_attempt.id is null
       or v_attempt.delivery_id <> p_delivery_id
       or v_attempt.signature_timestamp <> p_signature_timestamp
       or v_attempt.signature_key_id <> p_signature_key_id
       or v_attempt.transport_payload_hash <> p_transport_payload_hash then
        raise exception 'delivery attempt identity mismatch for event % attempt %', p_event_id, p_delivery_attempt
            using errcode = '22000';
    end if;

    return query select v_receipt.id, v_receipt.event_id, v_rows = 1,
        v_rows = 0, true, v_receipt.processing_status;
end;
$$;

revoke execute on function app_private.accept_agent_feed_event(
    text,text,text,text,text,text,text,timestamptz,text,integer,text,text,jsonb,boolean,timestamptz
) from public;

-- ----------
-- Canonical SourceObservation document and semantic deduplication.
-- ----------

alter table app_private.source_observations
    add column source_ids jsonb not null default '[]'::jsonb,
    add column occurred_at timestamptz,
    add column effective_time jsonb not null default '{"occurred_at":null,"effective_from":null,"effective_to":null}'::jsonb,
    add column submitted_evidence_refs jsonb not null default '[]'::jsonb,
    add column canonical_evidence_ids jsonb not null default '[]'::jsonb,
    add column agent_feed jsonb not null default '{}'::jsonb,
    add column canonical_document jsonb not null default '{}'::jsonb,
    add column trust_state text not null default 'untrusted',
    add column quarantined_reason text;

update app_private.source_observations as o
   set source_ids = o.source_keys,
       discovery_assessment = case
           when app_private.is_source_observation_assessment(o.discovery_assessment)
               then o.discovery_assessment
           else '{"source_authority_claim":"unknown","evidence_completeness":"lead_only","agent_confidence":null}'::jsonb
       end,
       occurred_at = app_private.jsonb_timestamp(o.effective_time->'occurred_at'),
       effective_time = jsonb_build_object(
           'occurred_at', o.occurred_at,
           'effective_from', o.effective_from,
           'effective_to', o.effective_to
       ),
       submitted_evidence_refs = coalesce((
           select jsonb_agg(e.agent_feed_evidence_id order by e.agent_feed_evidence_id)
             from app_private.source_observation_submitted_evidence as e
            where e.observation_id = o.id
       ), '[]'::jsonb),
       canonical_evidence_ids = '[]'::jsonb,
       agent_feed = coalesce((
           select jsonb_build_object(
               'protocol_version', r.protocol_version,
               'event_id', r.event_id,
               'stream_id', r.stream_id,
               'run_id', r.run_id,
               'finding_id', r.finding_id
           ) from app_private.agent_feed_receipts as r where r.id = o.receipt_id
       ), '{}'::jsonb),
       trust_state = case when jsonb_array_length(o.security_flags) > 0 then 'quarantined' else 'untrusted' end,
       quarantined_reason = case when jsonb_array_length(o.security_flags) > 0 then 'security_flagged' else null end;

alter table app_private.source_observations
    add constraint source_observations_source_ids_array_ck
        check (app_private.is_jsonb_unique_string_array(source_ids)),
    add constraint source_observations_subjects_contract_ck
        check (app_private.is_source_observation_subject_array(subjects)),
    add constraint source_observations_effective_time_object_ck
        check (
            jsonb_typeof(effective_time) = 'object'
            and effective_time ?& array['occurred_at','effective_from','effective_to']
            and app_private.jsonb_timestamp(effective_time->'occurred_at') is not distinct from
                occurred_at
        ),
    add constraint source_observations_submitted_evidence_refs_ck
        check (app_private.is_jsonb_unique_string_array(submitted_evidence_refs)),
    add constraint source_observations_discovery_assessment_ck
        check (app_private.is_source_observation_assessment(discovery_assessment)),
    add constraint source_observations_canonical_evidence_ids_ck
        check (app_private.is_jsonb_evidence_key_array(canonical_evidence_ids)),
    add constraint source_observations_agent_feed_object_ck
        check (jsonb_typeof(agent_feed) = 'object'),
    add constraint source_observations_canonical_document_object_ck
        check (jsonb_typeof(canonical_document) = 'object'),
    add constraint source_observations_security_flags_ck
        check (app_private.is_jsonb_unique_string_array(security_flags)),
    add constraint source_observations_trust_state_ck
        check (trust_state in ('untrusted','lead_only','quarantined','canonical_reviewed')),
    add constraint source_observations_quarantine_reason_ck
        check (trust_state <> 'quarantined' or length(btrim(coalesce(quarantined_reason,''))) > 0),
    add constraint source_observations_canonical_evidence_state_ck
        check (trust_state <> 'canonical_reviewed' or jsonb_array_length(canonical_evidence_ids) > 0);

-- source_keys is retained as a query-compatible legacy alias.  New intake
-- writes both columns and the canonical document from the same array.
create table app_private.source_observation_semantic_keys (
    semantic_fingerprint_version integer not null check (semantic_fingerprint_version = 1),
    semantic_fingerprint text not null check (semantic_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
    canonical_observation_id uuid not null unique references app_private.source_observations(id) on delete restrict,
    first_receipt_id uuid not null references app_private.agent_feed_receipts(id) on delete restrict,
    created_at timestamptz not null default now(),
    primary key (semantic_fingerprint_version, semantic_fingerprint)
);

create table app_private.source_observation_transport_links (
    receipt_id uuid primary key references app_private.agent_feed_receipts(id) on delete restrict,
    semantic_fingerprint_version integer check (semantic_fingerprint_version is null or semantic_fingerprint_version = 1),
    semantic_fingerprint text check (semantic_fingerprint is null or semantic_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
    observation_id uuid references app_private.source_observations(id) on delete restrict,
    link_status text not null check (link_status in ('canonical','duplicate','quarantined','rejected')),
    linked_at timestamptz not null default now(),
    reason_code text,
    check (
        (link_status in ('canonical','duplicate') and observation_id is not null
            and semantic_fingerprint_version is not null and semantic_fingerprint is not null)
        or (link_status in ('quarantined','rejected') and observation_id is null)
    )
);

create index source_observation_transport_links_observation_idx
    on app_private.source_observation_transport_links (observation_id, linked_at);

create or replace function app_private.compute_source_observation_fingerprint(
    p_source_ids jsonb,
    p_subjects jsonb,
    p_change_type text,
    p_summary text,
    p_effective_time jsonb,
    p_raw_attributes jsonb
) returns text
language sql
immutable
as $$
    select 'sha256:' || encode(
        public.digest(
            convert_to(
                jsonb_build_object(
                    'source_ids', p_source_ids,
                    'subjects', p_subjects,
                    'change_type', p_change_type,
                    'summary', lower(regexp_replace(btrim(p_summary), '\\s+', ' ', 'g')),
                    'effective_time', p_effective_time,
                    'raw_attributes', coalesce(p_raw_attributes, '{}'::jsonb)
                )::text,
                'utf8'
            ),
            'sha256'
        ),
        'hex'
    )
$$;

revoke execute on function app_private.compute_source_observation_fingerprint(jsonb,jsonb,text,text,jsonb,jsonb) from public;

create or replace function app_private.sync_source_observation_document()
returns trigger
language plpgsql
as $$
declare
    v_receipt app_private.agent_feed_receipts%rowtype;
    v_agent_feed jsonb;
    v_effective_time jsonb;
begin
    if jsonb_typeof(new.source_keys) <> 'array' then
        raise exception 'source_keys must be a JSON array' using errcode = '22023';
    end if;
    if jsonb_typeof(new.source_ids) <> 'array' then
        raise exception 'source_ids must be a JSON array' using errcode = '22023';
    end if;

    if new.source_ids = '[]'::jsonb and new.source_keys <> '[]'::jsonb then
        new.source_ids := new.source_keys;
    elsif new.source_keys = '[]'::jsonb and new.source_ids <> '[]'::jsonb then
        new.source_keys := new.source_ids;
    elsif new.source_keys <> new.source_ids then
        raise exception 'source_ids and legacy source_keys must identify the same sources'
            using errcode = '22023';
    end if;

    if jsonb_typeof(new.effective_time) <> 'object'
       or not (new.effective_time ?& array['occurred_at','effective_from','effective_to'])
       or (select count(*) from jsonb_object_keys(new.effective_time)) <> 3 then
        raise exception 'effective_time must contain exactly occurred_at/effective_from/effective_to'
            using errcode = '22023';
    end if;
    v_effective_time := jsonb_build_object(
        'occurred_at', to_jsonb(new.occurred_at),
        'effective_from', to_jsonb(new.effective_from),
        'effective_to', to_jsonb(new.effective_to)
    );
    if new.effective_time ? 'occurred_at'
       and app_private.jsonb_timestamp(new.effective_time->'occurred_at') is not distinct from new.occurred_at
       and new.effective_time ? 'effective_from'
       and app_private.jsonb_timestamp(new.effective_time->'effective_from') is not distinct from new.effective_from
       and new.effective_time ? 'effective_to'
       and app_private.jsonb_timestamp(new.effective_time->'effective_to') is not distinct from new.effective_to then
        -- Keep the producer's occurred_at while enforcing the query-column alignment.
        null;
    elsif new.effective_time = '{"occurred_at":null,"effective_from":null,"effective_to":null}'::jsonb
          and new.effective_from is null and new.effective_to is null then
        null;
    else
        raise exception 'effective_time does not align with effective_from/effective_to'
            using errcode = '22023';
    end if;
    new.effective_time := v_effective_time;

    if not app_private.is_jsonb_string_array(new.submitted_evidence_refs)
       or not app_private.is_jsonb_string_array(new.canonical_evidence_ids) then
        raise exception 'submitted and canonical evidence references must be string arrays'
            using errcode = '22023';
    end if;
    if new.security_flags <> '[]'::jsonb then
        new.trust_state := 'quarantined';
        new.quarantined_reason := coalesce(new.quarantined_reason, 'security_flagged');
    elsif new.status = 'needs_evidence' then
        new.trust_state := case when new.submitted_evidence_refs = '[]'::jsonb then 'untrusted' else 'lead_only' end;
    elsif new.trust_state = 'quarantined' and new.quarantined_reason is null then
        new.quarantined_reason := 'security_flagged';
    end if;

    select r.* into v_receipt
      from app_private.agent_feed_receipts as r
     where r.id = new.receipt_id;
    v_agent_feed := jsonb_build_object(
        'protocol_version', v_receipt.protocol_version,
        'event_id', v_receipt.event_id,
        'stream_id', v_receipt.stream_id,
        'run_id', v_receipt.run_id,
        'finding_id', v_receipt.finding_id
    );
    new.agent_feed := v_agent_feed;
    new.updated_at := now();
    new.canonical_document := jsonb_build_object(
        'observation_id', new.observation_key,
        'agent_feed', new.agent_feed,
        'source_ids', new.source_ids,
        'subjects', new.subjects,
        'change_type', new.change_type,
        'summary', new.summary,
        'effective_time', new.effective_time,
        'discovery_assessment', new.discovery_assessment,
        'submitted_evidence_refs', new.submitted_evidence_refs,
        'canonical_evidence_ids', new.canonical_evidence_ids,
        'semantic_fingerprint_version', new.semantic_fingerprint_version,
        'semantic_fingerprint', new.semantic_fingerprint,
        'status', new.status,
        'security_flags', new.security_flags,
        'raw_attributes', new.raw_attributes,
        'created_at', new.created_at,
        'updated_at', new.updated_at
    );
    return new;
end;
$$;

create trigger source_observations_z_canonical_sync
before insert or update on app_private.source_observations
for each row execute function app_private.sync_source_observation_document();

-- Rows created before M2.5 received column defaults before the canonical sync
-- trigger existed.  Force one no-op update through the trigger, then make the
-- complete SourceObservation document shape a durable table invariant.
update app_private.source_observations
   set updated_at = updated_at;

alter table app_private.source_observations
    add constraint source_observations_canonical_document_contract_ck
        check (app_private.is_jsonb_object_with_exact_keys(
            canonical_document,
            array[
                'observation_id','agent_feed','source_ids','subjects','change_type',
                'summary','effective_time','discovery_assessment',
                'submitted_evidence_refs','canonical_evidence_ids',
                'semantic_fingerprint_version','semantic_fingerprint','status',
                'security_flags','raw_attributes','created_at','updated_at'
            ]
        ));

create or replace function app_private.enforce_source_observation_canonical_evidence()
returns trigger
language plpgsql
as $$
begin
    if new.canonical_evidence_ids <> old.canonical_evidence_ids then
        if exists (
            select 1
              from jsonb_array_elements(new.canonical_evidence_ids) as item(value)
             where not exists (
                 select 1
                   from app_private.source_observation_submitted_evidence as se
                  join app_private.evidence_records as er on er.id = se.promoted_evidence_id
                 where se.observation_id = new.id
                   and se.promotion_status = 'promoted'
                   and er.evidence_key = item.value #>> '{}'
             )
        ) then
            raise exception 'canonical evidence requires a completed Rewards-owned promotion'
                using errcode = '55000';
        end if;
    end if;
    return new;
end;
$$;

create trigger source_observations_canonical_evidence_guard
before update of canonical_evidence_ids on app_private.source_observations
for each row execute function app_private.enforce_source_observation_canonical_evidence();

-- ----------
-- Evidence acquisition/review/promotion gate.
-- ----------

alter table app_private.source_observation_submitted_evidence
    add column permission_granted boolean not null default false,
    add column permission_granted_by text,
    add column permission_granted_at timestamptz,
    add column capture_hash text,
    add column capture_locator jsonb,
    add column captured_at timestamptz,
    add column reviewed_by text,
    add column reviewed_at timestamptz;

alter table app_private.source_observation_submitted_evidence
    add constraint source_observation_submitted_evidence_capture_hash_ck
        check (capture_hash is null or capture_hash ~ '^sha256:[0-9a-f]{64}$'),
    add constraint source_observation_submitted_evidence_capture_locator_ck
        check (capture_locator is null or jsonb_typeof(capture_locator) = 'object'),
    add constraint source_observation_submitted_evidence_promotion_gate_ck
        check (
            promotion_status <> 'promoted'
            or (
                permission_granted
                and permission_granted_by is not null
                and permission_granted_at is not null
                and capture_hash is not null
                and capture_locator is not null
                and captured_at is not null
                and reviewed_by is not null
                and reviewed_at is not null
                and promoted_evidence_id is not null
            )
        );

create table app_private.source_observation_evidence_work (
    id uuid primary key default gen_random_uuid(),
    observation_id uuid not null references app_private.source_observations(id) on delete restrict,
    agent_feed_evidence_id text not null,
    work_status text not null default 'requested' check (work_status in (
        'requested','capturing','captured','under_review','approved','rejected','cancelled','promoted'
    )),
    permission_granted boolean not null default false,
    permission_granted_by text,
    permission_granted_at timestamptz,
    source_snapshot_id uuid references app_private.source_snapshots(id) on delete restrict,
    capture_hash text,
    locator jsonb,
    captured_at timestamptz,
    reviewed_by text,
    reviewed_at timestamptz,
    evidence_id uuid references app_private.evidence_records(id) on delete restrict,
    review_notes text not null default '',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (observation_id, agent_feed_evidence_id),
    check (capture_hash is null or capture_hash ~ '^sha256:[0-9a-f]{64}$'),
    check (locator is null or jsonb_typeof(locator) = 'object'),
    check (work_status not in ('captured','under_review','approved','promoted') or (
        permission_granted and permission_granted_by is not null and permission_granted_at is not null
        and source_snapshot_id is not null and capture_hash is not null and locator is not null and captured_at is not null
    )),
    check (work_status not in ('approved','promoted') or (reviewed_by is not null and reviewed_at is not null)),
    check ((work_status = 'promoted') = (evidence_id is not null))
);

create index source_observation_evidence_work_status_idx
    on app_private.source_observation_evidence_work (work_status, updated_at);

create or replace function app_private.enforce_source_observation_evidence_transition()
returns trigger
language plpgsql
as $$
begin
    if new.work_status = old.work_status then
        new.updated_at := now();
        return new;
    end if;
    if old.work_status = 'requested' and new.work_status in ('capturing','rejected','cancelled') then
        null;
    elsif old.work_status = 'capturing' and new.work_status in ('captured','rejected','cancelled') then
        null;
    elsif old.work_status = 'captured' and new.work_status in ('under_review','rejected','cancelled') then
        null;
    elsif old.work_status = 'under_review' and new.work_status in ('approved','rejected','cancelled') then
        null;
    elsif old.work_status = 'approved' and new.work_status = 'promoted' then
        null;
    else
        raise exception 'invalid evidence work transition % -> %', old.work_status, new.work_status
            using errcode = '55000';
    end if;
    new.updated_at := now();
    return new;
end;
$$;

create trigger source_observation_evidence_work_transition
before update on app_private.source_observation_evidence_work
for each row execute function app_private.enforce_source_observation_evidence_transition();

create or replace function app_private.enforce_submitted_evidence_transition()
returns trigger
language plpgsql
as $$
begin
    if new.promotion_status = old.promotion_status then
        return new;
    end if;
    if old.promotion_status = 'unreviewed' and new.promotion_status in ('lead_only','capture_required','rejected') then
        null;
    elsif old.promotion_status = 'lead_only' and new.promotion_status in ('capture_required','rejected') then
        null;
    elsif old.promotion_status = 'capture_required' and new.promotion_status in ('promoted','rejected') then
        null;
    else
        raise exception 'invalid submitted evidence transition % -> %', old.promotion_status, new.promotion_status
            using errcode = '55000';
    end if;
    if new.promotion_status = 'promoted' and new.promoted_evidence_id is null then
        raise exception 'promoted submitted evidence requires a canonical EvidenceRecord'
            using errcode = '55000';
    end if;
    return new;
end;
$$;

create trigger source_observation_submitted_evidence_transition
before update on app_private.source_observation_submitted_evidence
for each row execute function app_private.enforce_submitted_evidence_transition();

create or replace function app_private.promote_source_observation_evidence(
    p_observation_id uuid,
    p_agent_feed_evidence_id text,
    p_evidence_id uuid
) returns uuid
language plpgsql
security definer
set search_path = app_private, pg_catalog
as $$
declare
    v_submitted app_private.source_observation_submitted_evidence%rowtype;
    v_work app_private.source_observation_evidence_work%rowtype;
    v_evidence app_private.evidence_records%rowtype;
    v_snapshot app_private.source_snapshots%rowtype;
begin
    select * into v_submitted
      from app_private.source_observation_submitted_evidence
     where observation_id = p_observation_id
       and agent_feed_evidence_id = p_agent_feed_evidence_id
     for update;
    if v_submitted.observation_id is null then
        raise exception 'submitted evidence lead does not exist' using errcode = '22023';
    end if;
    if v_submitted.promotion_status in ('promoted','rejected') then
        raise exception 'submitted evidence lead is terminal: %', v_submitted.promotion_status
            using errcode = '55000';
    end if;

    select * into v_work
      from app_private.source_observation_evidence_work
     where observation_id = p_observation_id
       and agent_feed_evidence_id = p_agent_feed_evidence_id
     for update;
    if v_work.id is null or v_work.work_status <> 'approved' then
        raise exception 'evidence acquisition and review approval are required before promotion'
            using errcode = '55000';
    end if;
    if not v_work.permission_granted or v_work.permission_granted_by is null
       or v_work.permission_granted_at is null or v_work.capture_hash is null
       or v_work.locator is null or v_work.captured_at is null
       or v_work.reviewed_by is null or v_work.reviewed_at is null then
        raise exception 'permission, capture hash, locator, and review are required before promotion'
            using errcode = '55000';
    end if;

    select * into v_evidence from app_private.evidence_records where id = p_evidence_id;
    if v_evidence.id is null or v_evidence.status <> 'verified'
       or v_evidence.reviewed_by is null or v_evidence.reviewed_at is null then
        raise exception 'canonical EvidenceRecord must be verified and reviewed'
            using errcode = '55000';
    end if;
    select * into v_snapshot from app_private.source_snapshots where id = v_evidence.source_snapshot_id;
    if v_work.source_snapshot_id is distinct from v_evidence.source_snapshot_id
       or v_snapshot.raw_content_hash <> v_work.capture_hash then
        raise exception 'capture hash and canonical snapshot do not match'
            using errcode = '55000';
    end if;

    -- Preserve the explicit lead -> capture-required -> promoted lifecycle even
    -- when a caller invokes the atomic promotion routine after capture review.
    if v_submitted.promotion_status = 'lead_only' then
        update app_private.source_observation_submitted_evidence
           set promotion_status = 'capture_required'
         where observation_id = p_observation_id
           and agent_feed_evidence_id = p_agent_feed_evidence_id;
    end if;

    update app_private.source_observation_evidence_work
       set work_status = 'promoted', evidence_id = p_evidence_id
     where id = v_work.id;

    update app_private.source_observation_submitted_evidence
       set permission_granted = v_work.permission_granted,
           permission_granted_by = v_work.permission_granted_by,
           permission_granted_at = v_work.permission_granted_at,
           capture_hash = v_work.capture_hash,
           capture_locator = v_work.locator,
           captured_at = v_work.captured_at,
           reviewed_by = v_work.reviewed_by,
           reviewed_at = v_work.reviewed_at,
           promotion_status = 'promoted',
           promoted_evidence_id = p_evidence_id
     where observation_id = p_observation_id
       and agent_feed_evidence_id = p_agent_feed_evidence_id;

    update app_private.source_observations
       set canonical_evidence_ids = (
           select coalesce(jsonb_agg(value order by value), '[]'::jsonb)
             from (
                 select distinct value
                   from jsonb_array_elements(canonical_evidence_ids || to_jsonb(v_evidence.evidence_key)) as x(value)
             ) as dedup
       ),
           trust_state = 'canonical_reviewed'
     where id = p_observation_id;

    return p_evidence_id;
end;
$$;

revoke execute on function app_private.promote_source_observation_evidence(uuid,text,uuid) from public;

-- ----------
-- Run lifecycle, expected-run liveness, and source freshness.
-- ----------

alter table app_private.monitor_stream_expectations
    add column last_run_id text,
    add column last_terminal_status text,
    add column last_terminal_finding_count integer,
    add column last_replay_at timestamptz,
    add column expected_run_state text not null default 'never_seen';

alter table app_private.monitor_stream_expectations
    add constraint monitor_stream_expectations_last_status_ck
        check (last_terminal_status is null or last_terminal_status in ('completed','partial','failed','cancelled')),
    add constraint monitor_stream_expectations_last_count_ck
        check (last_terminal_finding_count is null or last_terminal_finding_count >= 0),
    add constraint monitor_stream_expectations_expected_state_ck
        check (expected_run_state in ('never_seen','received','absent','overdue'));

create table app_private.agent_feed_run_lifecycle (
    id uuid primary key default gen_random_uuid(),
    stream_id text not null references app_private.monitor_stream_expectations(stream_id) on delete restrict,
    run_id text not null,
    replay_attempt integer not null default 0 check (replay_attempt >= 0),
    replay_of_run_id text,
    run_state text not null check (run_state in (
        'started','completed','partial','failed','cancelled','replayed'
    )),
    terminal_status text check (terminal_status is null or terminal_status in ('completed','partial','failed','cancelled')),
    expected_scope jsonb not null default '{}'::jsonb check (jsonb_typeof(expected_scope) = 'object'),
    actual_scope jsonb not null default '{}'::jsonb check (jsonb_typeof(actual_scope) = 'object'),
    finding_count integer not null default 0 check (finding_count >= 0),
    started_at timestamptz not null default now(),
    terminal_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (stream_id, run_id, replay_attempt),
    check ((run_state = 'started') = (terminal_at is null)),
    check (run_state = 'replayed' or terminal_status is not null or run_state = 'started'),
    check (terminal_at is null or terminal_at >= started_at),
    check (replay_attempt = 0 or replay_of_run_id is not null)
);

create index agent_feed_run_lifecycle_stream_idx
    on app_private.agent_feed_run_lifecycle (stream_id, terminal_at desc nulls last);

create or replace function app_private.enforce_agent_feed_run_transition()
returns trigger
language plpgsql
as $$
begin
    if old.run_state <> 'started' then
        if (to_jsonb(new) - array['updated_at']) <> (to_jsonb(old) - array['updated_at']) then
            raise exception 'terminal Agent Feed run lifecycle rows are immutable'
                using errcode = '55000';
        end if;
    elsif new.run_state not in ('started','completed','partial','failed','cancelled','replayed') then
        raise exception 'invalid Agent Feed run lifecycle state %', new.run_state
            using errcode = '22023';
    end if;
    new.updated_at := now();
    return new;
end;
$$;

create trigger agent_feed_run_lifecycle_transition
before update on app_private.agent_feed_run_lifecycle
for each row execute function app_private.enforce_agent_feed_run_transition();

create or replace function app_private.record_agent_feed_run(
    p_stream_id text,
    p_run_id text,
    p_terminal_status text,
    p_finding_count integer default 0,
    p_expected_scope jsonb default '{}'::jsonb,
    p_actual_scope jsonb default '{}'::jsonb,
    p_started_at timestamptz default now(),
    p_terminal_at timestamptz default now(),
    p_replay_attempt integer default 0,
    p_replay_of_run_id text default null
) returns uuid
language plpgsql
security definer
set search_path = app_private, pg_catalog
as $$
declare
    v_run app_private.agent_feed_run_lifecycle%rowtype;
    v_state text;
    v_live text;
begin
    if p_terminal_status not in ('completed','partial','failed','cancelled') then
        raise exception 'invalid terminal run status %', p_terminal_status using errcode = '22023';
    end if;
    if p_stream_id is null or p_run_id is null or length(btrim(p_run_id)) = 0 then
        raise exception 'stream_id and run_id are required' using errcode = '22023';
    end if;
    if p_finding_count is null or p_finding_count < 0 then
        raise exception 'finding_count must be non-negative' using errcode = '22023';
    end if;
    if p_replay_attempt > 0 and p_replay_of_run_id is null then
        raise exception 'replay attempts must identify their original run' using errcode = '22023';
    end if;

    v_state := case when p_replay_attempt > 0 then 'replayed' else p_terminal_status end;
    insert into app_private.agent_feed_run_lifecycle (
        stream_id, run_id, replay_attempt, replay_of_run_id, run_state, terminal_status,
        expected_scope, actual_scope, finding_count, started_at, terminal_at
    ) values (
        p_stream_id, p_run_id, p_replay_attempt, p_replay_of_run_id, v_state, p_terminal_status,
        coalesce(p_expected_scope, '{}'::jsonb), coalesce(p_actual_scope, '{}'::jsonb),
        p_finding_count, coalesce(p_started_at, p_terminal_at, now()), coalesce(p_terminal_at, now())
    ) on conflict (stream_id, run_id, replay_attempt) do update
       set expected_scope = excluded.expected_scope,
           actual_scope = excluded.actual_scope,
           finding_count = excluded.finding_count
     where app_private.agent_feed_run_lifecycle.run_state = 'started';

    select * into v_run
      from app_private.agent_feed_run_lifecycle
     where stream_id = p_stream_id and run_id = p_run_id and replay_attempt = p_replay_attempt;

    v_live := case when p_terminal_status = 'completed' then 'healthy' else 'degraded' end;
    update app_private.monitor_stream_expectations
       set last_terminal_run_at = greatest(coalesce(last_terminal_run_at, v_run.terminal_at), v_run.terminal_at),
           next_due_at = v_run.terminal_at + make_interval(secs => expected_cadence_seconds + grace_seconds),
           liveness_status = v_live,
           last_run_id = p_run_id,
           last_terminal_status = p_terminal_status,
           last_terminal_finding_count = p_finding_count,
           last_replay_at = case when p_replay_attempt > 0 then v_run.terminal_at else last_replay_at end,
           expected_run_state = 'received',
           updated_at = now()
     where stream_id = p_stream_id;

    if not found then
        raise exception 'monitor stream expectation % is not registered', p_stream_id
            using errcode = '23503';
    end if;

    insert into app_private.source_monitoring_freshness (
        source_id, freshness_status, reason_code, stream_id, updated_at
    )
    select m.source_id,
           case when p_terminal_status = 'completed' then 'healthy' else 'degraded' end,
           case when p_terminal_status = 'completed' then null else 'agent_feed_' || p_terminal_status end,
           p_stream_id, v_run.terminal_at
      from app_private.monitor_stream_sources as m
     where m.stream_id = p_stream_id
    on conflict (source_id) do update
       set freshness_status = excluded.freshness_status,
           reason_code = excluded.reason_code,
           stream_id = excluded.stream_id,
           updated_at = excluded.updated_at;

    update app_private.monitoring_incidents
       set status = 'resolved', resolved_at = greatest(coalesce(resolved_at, now()), now())
     where stream_id = p_stream_id
       and status in ('open','acknowledged')
       and incident_type in ('overdue_run','absent_expected_run');

    if p_terminal_status = 'completed' then
        update app_private.monitoring_incidents
           set status = 'resolved', resolved_at = greatest(coalesce(resolved_at, now()), now())
         where stream_id = p_stream_id
           and status in ('open','acknowledged')
           and incident_type in ('partial_run','failed_run','scope_degradation');
    else
        insert into app_private.monitoring_incidents (
            stream_id, incident_type, status, detected_at, details
        )
        select p_stream_id,
               case p_terminal_status
                   when 'partial' then 'partial_run'
                   when 'failed' then 'failed_run'
                   else 'scope_degradation'
               end,
               'open', v_run.terminal_at,
               jsonb_build_object(
                   'run_id', p_run_id,
                   'terminal_status', p_terminal_status,
                   'finding_count', p_finding_count
               )
         where not exists (
             select 1
               from app_private.monitoring_incidents as i
              where i.stream_id = p_stream_id
                and i.incident_type = case p_terminal_status
                    when 'partial' then 'partial_run'
                    when 'failed' then 'failed_run'
                    else 'scope_degradation'
                end
                and i.status in ('open','acknowledged')
         );
    end if;

    return v_run.id;
end;
$$;

revoke execute on function app_private.record_agent_feed_run(text,text,text,integer,jsonb,jsonb,timestamptz,timestamptz,integer,text) from public;

-- Preserve the v0.4.1 function signature used by existing callers while
-- recording the same durable lifecycle state under a deterministic legacy id.
create or replace function app_private.record_monitor_terminal_run(
    p_stream_id text, p_completed_at timestamptz, p_status text
) returns void
language plpgsql
security definer
set search_path = app_private, pg_catalog
as $$
begin
    perform app_private.record_agent_feed_run(
        p_stream_id,
        'legacy:' || md5(p_stream_id || ':' || p_completed_at::text || ':' || p_status),
        p_status,
        0,
        '{}'::jsonb,
        '{}'::jsonb,
        p_completed_at,
        p_completed_at,
        0,
        null
    );
end;
$$;

revoke execute on function app_private.record_monitor_terminal_run(text,timestamptz,text) from public;

create or replace function app_private.sweep_overdue_monitor_streams(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = app_private, pg_catalog
as $$
declare
    v_count integer;
begin
    -- A registered stream with no observed terminal run is never-seen, not an
    -- overdue run: there is no cadence anchor yet.  Keep that state distinct
    -- and raise a separate absent-expectation diagnostic.
    insert into app_private.monitoring_incidents (
        stream_id, incident_type, status, detected_at, expected_by, details
    )
    select e.stream_id, 'absent_expected_run', 'open', p_now, null,
           jsonb_build_object('state','never_seen')
      from app_private.monitor_stream_expectations as e
     where e.enabled and e.next_due_at is null and e.liveness_status = 'never_seen'
       and not exists (
           select 1 from app_private.monitoring_incidents as i
            where i.stream_id = e.stream_id
              and i.incident_type = 'absent_expected_run'
              and i.status in ('open','acknowledged')
       );

    insert into app_private.monitoring_incidents (
        stream_id, incident_type, status, detected_at, expected_by
    )
    select e.stream_id, 'overdue_run', 'open', p_now, e.next_due_at
      from app_private.monitor_stream_expectations as e
     where e.enabled and e.next_due_at is not null and p_now > e.next_due_at
       and not exists (
           select 1 from app_private.monitoring_incidents as i
            where i.stream_id = e.stream_id
              and i.incident_type = 'overdue_run'
              and i.status in ('open','acknowledged')
       );
    get diagnostics v_count = row_count;

    update app_private.monitor_stream_expectations
       set liveness_status = 'overdue', expected_run_state = 'overdue', updated_at = p_now
     where enabled and next_due_at is not null and p_now > next_due_at;

    insert into app_private.source_monitoring_freshness (
        source_id, freshness_status, reason_code, stream_id, updated_at
    )
    select m.source_id, 'stale', 'agent_feed_overdue_run', m.stream_id, p_now
      from app_private.monitor_stream_sources as m
      join app_private.monitor_stream_expectations as e on e.stream_id = m.stream_id
     where e.enabled and e.next_due_at is not null and p_now > e.next_due_at
    on conflict (source_id) do update
       set freshness_status = excluded.freshness_status,
           reason_code = excluded.reason_code,
           stream_id = excluded.stream_id,
           updated_at = excluded.updated_at;

    return coalesce(v_count, 0);
end;
$$;

revoke execute on function app_private.sweep_overdue_monitor_streams(timestamptz) from public;

alter table app_private.monitoring_incidents
    drop constraint monitoring_incidents_incident_type_check;
alter table app_private.monitoring_incidents
    add constraint monitoring_incidents_incident_type_check check (incident_type in (
        'overdue_run','partial_run','failed_run','scope_degradation','absent_expected_run'
    ));

-- ----------
-- Redaction, replay, and purge helpers.
-- ----------

create or replace function app_private.record_agent_feed_delivery_attempt(
    p_receipt_id uuid,
    p_delivery_id text,
    p_attempt_number integer,
    p_signature_timestamp timestamptz,
    p_signature_key_id text,
    p_transport_payload_hash text,
    p_outcome text,
    p_http_status integer default null,
    p_error_code text default null,
    p_diagnostic jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = app_private, pg_catalog
as $$
declare
    v_id uuid;
    v_attempt app_private.agent_feed_delivery_attempts%rowtype;
begin
    insert into app_private.agent_feed_delivery_attempts (
        receipt_id, delivery_id, attempt_number, signature_timestamp, signature_key_id,
        transport_payload_hash, outcome, http_status, error_code, diagnostic
    ) values (
        p_receipt_id, p_delivery_id, p_attempt_number, p_signature_timestamp, p_signature_key_id,
        p_transport_payload_hash, p_outcome, p_http_status, p_error_code,
        case when jsonb_typeof(coalesce(p_diagnostic, '{}'::jsonb)) = 'object'
             then coalesce(p_diagnostic, '{}'::jsonb)
             else jsonb_build_object('diagnostic', coalesce(p_diagnostic, 'null'::jsonb)) end
    ) on conflict on constraint agent_feed_delivery_attempts_receipt_id_attempt_number_key do nothing
    returning id into v_id;

    if v_id is null then
        select a.* into v_attempt
          from app_private.agent_feed_delivery_attempts as a
         where a.receipt_id = p_receipt_id
           and a.attempt_number = p_attempt_number;
        if v_attempt.id is null
           or v_attempt.delivery_id <> p_delivery_id
           or v_attempt.signature_timestamp <> p_signature_timestamp
           or v_attempt.signature_key_id <> p_signature_key_id
           or v_attempt.transport_payload_hash <> p_transport_payload_hash
           or v_attempt.outcome <> p_outcome
           or v_attempt.http_status is distinct from p_http_status
           or v_attempt.error_code is distinct from p_error_code then
            raise exception 'delivery attempt identity or outcome mismatch for receipt % attempt %',
                p_receipt_id, p_attempt_number
                using errcode = '22000';
        end if;
        v_id := v_attempt.id;
    end if;
    return v_id;
end;
$$;

create or replace function app_private.enqueue_agent_feed_dead_letter(
    p_receipt_id uuid,
    p_reason_code text,
    p_diagnostic jsonb default '{}'::jsonb,
    p_replay_cursor text default null
) returns uuid
language plpgsql
security definer
set search_path = app_private, pg_catalog
as $$
declare
    v_event_id text;
    v_id uuid;
begin
    select event_id into v_event_id from app_private.agent_feed_receipts where id = p_receipt_id;
    if v_event_id is null then
        raise exception 'receipt % does not exist', p_receipt_id using errcode = '23503';
    end if;
    update app_private.agent_feed_receipts
       set processing_status = 'failed', redaction_status = 'complete', raw_payload = '{}', error_code = p_reason_code
     where id = p_receipt_id;
    insert into app_private.agent_feed_dead_letters (
        receipt_id, event_id, reason_code, replay_cursor, diagnostic, redaction_status, redacted_at
    ) values (
        p_receipt_id, v_event_id, p_reason_code, p_replay_cursor,
        '{}'::jsonb, 'complete', now()
    ) on conflict (event_id) where replay_status in ('not_requested','requested','in_progress') do update
       set last_failed_at = now()
    returning id into v_id;
    return v_id;
end;
$$;

create or replace function app_private.request_agent_feed_replay(
    p_event_id text default null,
    p_cursor text default null,
    p_requested_by text default 'system'
) returns uuid
language plpgsql
security definer
set search_path = app_private, pg_catalog
as $$
declare
    v_receipt_id uuid;
    v_id uuid;
begin
    if p_event_id is null and p_cursor is null then
        raise exception 'event_id or cursor is required' using errcode = '22023';
    end if;
    select id into v_receipt_id from app_private.agent_feed_receipts where event_id = p_event_id;
    insert into app_private.agent_feed_replay_requests (event_id, receipt_id, cursor, requested_by)
    values (p_event_id, v_receipt_id, p_cursor, coalesce(nullif(p_requested_by,''),'system'))
    returning id into v_id;
    update app_private.agent_feed_dead_letters
       set replay_status = 'requested', replay_cursor = coalesce(p_cursor, replay_cursor),
           diagnostic = '{}'::jsonb, redaction_status = 'complete',
           redacted_at = coalesce(redacted_at, now())
     where event_id = p_event_id and replay_status = 'not_requested';
    return v_id;
end;
$$;

create or replace function app_private.redact_expired_agent_feed_receipts(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = app_private, pg_catalog
as $$
declare
    v_count integer;
begin
    update app_private.agent_feed_receipts
       set raw_payload = '{}'::jsonb, redaction_status = 'complete'
     where purge_after <= p_now
       and processing_status in ('mapped','duplicate','quarantined','failed')
       and (redaction_status <> 'complete' or raw_payload <> '{}'::jsonb);
    get diagnostics v_count = row_count;

    update app_private.agent_feed_delivery_attempts
       set diagnostic = '{}'::jsonb, redaction_status = 'complete', redacted_at = p_now
     where purge_after <= p_now and redaction_status <> 'complete';

    update app_private.agent_feed_dead_letters
       set diagnostic = '{}'::jsonb, redaction_status = 'complete', redacted_at = p_now
     where purge_after <= p_now and redaction_status <> 'complete';

    update app_private.agent_feed_replay_requests
       set diagnostic = '{}'::jsonb, redaction_status = 'complete', redacted_at = p_now
     where purge_after <= p_now and redaction_status <> 'complete';

    return coalesce(v_count, 0);
end;
$$;

revoke execute on function app_private.record_agent_feed_delivery_attempt(uuid,text,integer,timestamptz,text,text,text,integer,text,jsonb) from public;
revoke execute on function app_private.enqueue_agent_feed_dead_letter(uuid,text,jsonb,text) from public;
revoke execute on function app_private.request_agent_feed_replay(text,text,text) from public;
revoke execute on function app_private.redact_expired_agent_feed_receipts(timestamptz) from public;

-- ----------
-- Finding mapping.  It owns semantic dedupe and refuses unknown/hostile input
-- before an observation row, evidence row, candidate, or rule can be created.
-- ----------

create or replace function app_private.map_agent_feed_finding(
    p_receipt_id uuid,
    p_observation_key text,
    p_source_ids jsonb,
    p_subjects jsonb,
    p_change_type text,
    p_summary text,
    p_effective_time jsonb,
    p_discovery_assessment jsonb,
    p_submitted_evidence_refs jsonb default '[]'::jsonb,
    p_raw_attributes jsonb default '{}'::jsonb,
    p_security_flags jsonb default '[]'::jsonb,
    p_semantic_fingerprint text default null,
    p_semantic_fingerprint_version integer default 1
) returns table (
    receipt_id uuid,
    observation_id uuid,
    mapping_status text,
    semantic_duplicate boolean,
    quarantined boolean
)
language plpgsql
security definer
set search_path = app_private, pg_catalog
as $$
#variable_conflict use_column
declare
    v_receipt app_private.agent_feed_receipts%rowtype;
    v_observation_id uuid;
    v_fingerprint text;
    v_lock_key bigint;
    v_hostile boolean;
    v_reason text;
    v_status text;
begin
    select * into v_receipt from app_private.agent_feed_receipts where id = p_receipt_id for update;
    if not found then
        raise exception 'receipt % does not exist', p_receipt_id using errcode = '23503';
    end if;
    if v_receipt.processing_status in ('mapped','duplicate','quarantined') then
        select l.observation_id, l.link_status into v_observation_id, v_status
          from app_private.source_observation_transport_links as l
         where l.receipt_id = p_receipt_id;
        return query select p_receipt_id, v_observation_id,
            coalesce(v_status, v_receipt.processing_status),
            coalesce(v_status = 'duplicate', false),
            coalesce(v_status in ('quarantined','rejected'), v_receipt.processing_status = 'quarantined');
        return;
    end if;
    if p_semantic_fingerprint_version <> 1 then
        raise exception 'unsupported semantic fingerprint version %', p_semantic_fingerprint_version
            using errcode = '22023';
    end if;
    if not app_private.is_jsonb_unique_string_array(p_source_ids) then
        raise exception 'source_ids must be a unique array of strings' using errcode = '22023';
    end if;
    if not app_private.is_source_observation_subject_array(p_subjects) then
        raise exception 'subjects must match the SourceObservation subject contract' using errcode = '22023';
    end if;
    if p_summary is null or length(btrim(p_summary)) < 3 or length(p_summary) > 5000 then
        raise exception 'summary must contain 3 to 5000 characters' using errcode = '22023';
    end if;
    if jsonb_typeof(p_effective_time) <> 'object'
       or not (p_effective_time ?& array['occurred_at','effective_from','effective_to'])
       or (select count(*) from jsonb_object_keys(p_effective_time)) <> 3 then
        raise exception 'effective_time must contain exactly occurred_at/effective_from/effective_to' using errcode = '22023';
    end if;
    if not app_private.is_source_observation_assessment(coalesce(p_discovery_assessment, '{}'::jsonb))
       or not app_private.is_jsonb_unique_string_array(coalesce(p_submitted_evidence_refs, '[]'::jsonb))
       or not app_private.is_jsonb_unique_string_array(coalesce(p_security_flags, '[]'::jsonb))
       or jsonb_typeof(coalesce(p_raw_attributes, '{}'::jsonb)) <> 'object' then
        raise exception 'finding fields have invalid JSON types' using errcode = '22023';
    end if;
    if v_receipt.event_type <> 'finding.submitted'
       or length(v_receipt.event_id) < 8
       or length(v_receipt.stream_id) < 1
       or length(v_receipt.run_id) < 8
       or v_receipt.finding_id is null
       or length(v_receipt.finding_id) < 3 then
        raise exception 'receipt does not identify a schema-valid finding delivery' using errcode = '22023';
    end if;

    v_hostile := p_change_type = 'unknown'
        or jsonb_array_length(coalesce(p_security_flags, '[]'::jsonb)) > 0;
    if v_hostile then
        v_reason := case when p_change_type = 'unknown' then 'unknown_finding_type' else 'security_flagged' end;
        update app_private.agent_feed_receipts
           set processing_status = 'quarantined', error_code = v_reason,
               raw_payload = '{}'::jsonb, redaction_status = 'complete', acknowledged_at = now()
         where id = p_receipt_id;
        insert into app_private.source_observation_transport_links (
            receipt_id, link_status, linked_at, reason_code
        ) values (p_receipt_id, 'quarantined', now(), v_reason)
        on conflict (receipt_id) do nothing;
        insert into app_private.agent_feed_dead_letters (
            receipt_id, event_id, reason_code, diagnostic, redaction_status, redacted_at
        ) values (p_receipt_id, v_receipt.event_id, v_reason,
                  '{}'::jsonb, 'complete', now())
        on conflict (event_id) where replay_status in ('not_requested','requested','in_progress') do nothing;
        return query select p_receipt_id, null::uuid, 'quarantined'::text, false, true;
        return;
    end if;

    v_fingerprint := coalesce(
        p_semantic_fingerprint,
        app_private.compute_source_observation_fingerprint(
            p_source_ids, p_subjects, p_change_type, p_summary, p_effective_time, p_raw_attributes
        )
    );
    if v_fingerprint !~ '^sha256:[0-9a-f]{64}$' then
        raise exception 'semantic fingerprint must be sha256-prefixed' using errcode = '22023';
    end if;

    -- Advisory locking serializes the insert-or-get pair for this semantic key;
    -- the primary-key registry is the durable second line of defence.
    v_lock_key := hashtextextended(p_semantic_fingerprint_version::text || ':' || v_fingerprint, 0);
    perform pg_advisory_xact_lock(v_lock_key);
    select canonical_observation_id into v_observation_id
      from app_private.source_observation_semantic_keys
     where semantic_fingerprint_version = p_semantic_fingerprint_version
       and semantic_fingerprint = v_fingerprint;

    if v_observation_id is null then
        insert into app_private.source_observations (
            observation_key, receipt_id, semantic_fingerprint_version, semantic_fingerprint,
            source_keys, source_ids, subjects, change_type, summary,
            occurred_at, effective_from, effective_to, effective_time, discovery_assessment,
            submitted_evidence_refs, canonical_evidence_ids, raw_attributes,
            security_flags, status, trust_state
        ) values (
            p_observation_key, p_receipt_id, p_semantic_fingerprint_version, v_fingerprint,
            p_source_ids, p_source_ids, p_subjects, p_change_type, p_summary,
            app_private.jsonb_timestamp(p_effective_time->'occurred_at'),
            app_private.jsonb_timestamp(p_effective_time->'effective_from'),
            app_private.jsonb_timestamp(p_effective_time->'effective_to'),
            p_effective_time, coalesce(p_discovery_assessment, '{}'::jsonb),
            coalesce(p_submitted_evidence_refs, '[]'::jsonb), '[]'::jsonb,
            coalesce(p_raw_attributes, '{}'::jsonb), coalesce(p_security_flags, '[]'::jsonb),
            'needs_evidence', 'untrusted'
        ) returning id into v_observation_id;

        insert into app_private.source_observation_semantic_keys (
            semantic_fingerprint_version, semantic_fingerprint,
            canonical_observation_id, first_receipt_id
        ) values (
            p_semantic_fingerprint_version, v_fingerprint, v_observation_id, p_receipt_id
        );

        insert into app_private.source_observation_transport_links (
            receipt_id, semantic_fingerprint_version, semantic_fingerprint,
            observation_id, link_status, reason_code
        ) values (
            p_receipt_id, p_semantic_fingerprint_version, v_fingerprint,
            v_observation_id, 'canonical', 'first_semantic_observation'
        );
        update app_private.agent_feed_receipts
           set processing_status = 'mapped', raw_payload = '{}'::jsonb,
               redaction_status = 'complete', acknowledged_at = now()
         where id = p_receipt_id;
        insert into app_private.source_observation_submitted_evidence (
            observation_id, agent_feed_evidence_id, submitted_payload,
            promotion_status
        )
        select v_observation_id, value #>> '{}',
               jsonb_build_object('agent_feed_evidence_id', value #>> '{}'),
               'lead_only'
          from jsonb_array_elements(coalesce(p_submitted_evidence_refs, '[]'::jsonb)) as evidence(value)
        on conflict (observation_id, agent_feed_evidence_id) do nothing;
        insert into app_private.source_observation_evidence_work (
            observation_id, agent_feed_evidence_id, work_status
        )
        select v_observation_id, value #>> '{}', 'requested'
          from jsonb_array_elements(coalesce(p_submitted_evidence_refs, '[]'::jsonb)) as evidence(value)
        on conflict (observation_id, agent_feed_evidence_id) do nothing;
        return query select p_receipt_id, v_observation_id, 'mapped'::text, false, false;
    else
        insert into app_private.source_observation_transport_links (
            receipt_id, semantic_fingerprint_version, semantic_fingerprint,
            observation_id, link_status, reason_code
        ) values (
            p_receipt_id, p_semantic_fingerprint_version, v_fingerprint,
            v_observation_id, 'duplicate', 'semantic_fingerprint_match'
        ) on conflict (receipt_id) do nothing;
        update app_private.agent_feed_receipts
           set processing_status = 'duplicate', raw_payload = '{}'::jsonb,
               redaction_status = 'complete', acknowledged_at = now()
         where id = p_receipt_id;
        return query select p_receipt_id, v_observation_id, 'duplicate'::text, true, false;
    end if;
end;
$$;

revoke execute on function app_private.map_agent_feed_finding(uuid,text,jsonb,jsonb,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,text,integer) from public;

-- ----------
-- Final privilege posture and comments.
-- ----------

comment on table app_private.source_observation_semantic_keys is
    'Rewards-owned one-row registry for each versioned semantic fingerprint; transport retries link to the same canonical observation.';
comment on table app_private.source_observation_transport_links is
    'Explicit transport-to-semantic linkage, including duplicate and quarantine decisions.';
comment on table app_private.source_observation_evidence_work is
    'Rewards-owned evidence acquisition and review state; producer-submitted evidence remains a lead until this gate completes.';
comment on table app_private.agent_feed_run_lifecycle is
    'Durable producer run state; completed zero-finding, partial, failed, cancelled, replayed, and never-seen expectations remain distinguishable.';

revoke all on all tables in schema app_private from public;
revoke all on all sequences in schema app_private from public;
revoke all on all functions in schema app_private from public;

commit;
