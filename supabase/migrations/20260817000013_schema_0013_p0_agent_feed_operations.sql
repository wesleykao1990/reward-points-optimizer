-- Staged from db/0013_p0_agent_feed_operations.sql; edit the canonical source, not this file.
-- Resumable target-level P0 Agent Feed operations.
-- This ledger records locator/economic attempt outcomes only. It never creates
-- canonical evidence, reward rules, product SKUs, or publication authority.

begin;

create table app_private.p0_agent_feed_operation_manifests (
    id uuid primary key default gen_random_uuid(),
    manifest_sha256 text not null unique
        check (manifest_sha256 = 'sha256:6aa634b868e43f9c3f58417602e7b4465e36824f26d00bd9187f043395b4fae8'),
    version text not null check (version = 'p0-operations-manifest.v1'),
    plan_sha256 text not null unique
        references app_private.p0_source_plan_versions(plan_sha256) on delete restrict,
    family_count integer not null check (family_count = 44),
    stream_count integer not null check (stream_count = 19),
    target_count integer not null check (target_count = 301),
    created_at timestamptz not null default now()
);

create table app_private.p0_agent_feed_operation_targets (
    manifest_id uuid not null
        references app_private.p0_agent_feed_operation_manifests(id) on delete restrict,
    plan_sha256 text not null,
    target_id text not null check (target_id ~ '^p0t_[0-9a-f]{64}$'),
    stream_id text not null
        references app_private.monitor_stream_expectations(stream_id) on delete restrict,
    family_id text not null,
    source_role_id text not null,
    cadence_seconds integer not null check (cadence_seconds in (21600,86400,604800,2592000)),
    primary key (manifest_id, target_id),
    unique (manifest_id, family_id, source_role_id),
    foreign key (plan_sha256, family_id, source_role_id)
        references app_private.p0_source_role_requirements(plan_sha256, family_id, source_role_id)
        on delete restrict
);

create table app_private.p0_agent_feed_target_attempts (
    id uuid primary key default gen_random_uuid(),
    manifest_id uuid not null,
    target_id text not null,
    work_unit_sha256 text not null check (work_unit_sha256 ~ '^sha256:[0-9a-f]{64}$'),
    attempt_number integer not null check (attempt_number >= 1),
    observed_at timestamptz not null,
    outcome text not null check (outcome in (
        'resolved','not_found_this_attempt','access_blocked','authentication_required',
        'timeout','unsupported_content','validation_rejected','interrupted'
    )),
    run_id text not null,
    event_id text not null,
    receipt_id uuid not null references app_private.agent_feed_receipts(id) on delete restrict,
    idempotency_key text not null,
    input_sha256 text not null check (input_sha256 ~ '^sha256:[0-9a-f]{64}$'),
    locator text,
    locator_fingerprint text check (
        locator_fingerprint is null or locator_fingerprint ~ '^sha256:[0-9a-f]{64}$'
    ),
    economic_findings_accepted integer not null default 0 check (economic_findings_accepted >= 0),
    created_at timestamptz not null default now(),
    foreign key (manifest_id, target_id)
        references app_private.p0_agent_feed_operation_targets(manifest_id, target_id)
        on delete restrict,
    unique (manifest_id, target_id, attempt_number),
    unique (manifest_id, target_id, idempotency_key),
    check (length(btrim(run_id)) > 0 and length(btrim(event_id)) > 0 and length(btrim(idempotency_key)) > 0),
    check (
        (outcome = 'resolved' and locator is not null and locator_fingerprint is not null)
        or
        (outcome <> 'resolved' and locator is null and locator_fingerprint is null)
    )
);

create index p0_agent_feed_target_attempts_latest_idx
    on app_private.p0_agent_feed_target_attempts
    (manifest_id, target_id, attempt_number desc, observed_at desc);

create or replace function app_private.reject_p0_agent_feed_operation_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
    raise exception 'P0 Agent Feed operation records are append-only'
        using errcode = '55000';
end;
$$;

create or replace function app_private.reject_p0_agent_feed_operation_truncate()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
    raise exception 'P0 Agent Feed operation records cannot be truncated'
        using errcode = '55000';
end;
$$;

create trigger p0_agent_feed_manifests_immutable
before update or delete on app_private.p0_agent_feed_operation_manifests
for each row execute function app_private.reject_p0_agent_feed_operation_mutation();
create trigger p0_agent_feed_targets_immutable
before update or delete on app_private.p0_agent_feed_operation_targets
for each row execute function app_private.reject_p0_agent_feed_operation_mutation();
create trigger p0_agent_feed_attempts_immutable
before update or delete on app_private.p0_agent_feed_target_attempts
for each row execute function app_private.reject_p0_agent_feed_operation_mutation();

create trigger p0_agent_feed_manifests_no_truncate
before truncate on app_private.p0_agent_feed_operation_manifests
for each statement execute function app_private.reject_p0_agent_feed_operation_truncate();
create trigger p0_agent_feed_targets_no_truncate
before truncate on app_private.p0_agent_feed_operation_targets
for each statement execute function app_private.reject_p0_agent_feed_operation_truncate();
create trigger p0_agent_feed_attempts_no_truncate
before truncate on app_private.p0_agent_feed_target_attempts
for each statement execute function app_private.reject_p0_agent_feed_operation_truncate();

create or replace function app_private.register_p0_agent_feed_operations(
    p_plan_sha256 text,
    p_manifest_sha256 text
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
    v_manifest_id uuid;
    v_existing app_private.p0_agent_feed_operation_manifests%rowtype;
    v_target_count integer;
    v_stream_count integer;
begin
    if p_plan_sha256 is distinct from 'sha256:a59447525cb207838439a3cdb8b9cc22d19d875a650a64f50354137a78892003'
       or p_manifest_sha256 is distinct from 'sha256:6aa634b868e43f9c3f58417602e7b4465e36824f26d00bd9187f043395b4fae8' then
        raise exception 'P0 operation manifest identity is invalid' using errcode = '22023';
    end if;
    if not exists (
        select 1 from app_private.p0_source_plan_versions
         where plan_sha256 = p_plan_sha256 and sealed_at is not null
           and family_count = 44 and stream_count = 19 and required_role_count = 301
    ) then
        raise exception 'sealed P0 source plan is unavailable' using errcode = '55000';
    end if;

    perform pg_advisory_xact_lock(hashtextextended(p_manifest_sha256, 0));
    select * into v_existing
      from app_private.p0_agent_feed_operation_manifests
     where plan_sha256 = p_plan_sha256;
    if found then
        if v_existing.manifest_sha256 is distinct from p_manifest_sha256 then
            raise exception 'P0 operation plan was reused with a different manifest' using errcode = '55000';
        end if;
        return v_existing.id;
    end if;

    insert into app_private.p0_agent_feed_operation_manifests (
        manifest_sha256, version, plan_sha256, family_count, stream_count, target_count
    ) values (
        p_manifest_sha256, 'p0-operations-manifest.v1', p_plan_sha256, 44, 19, 301
    ) returning id into v_manifest_id;

    insert into app_private.p0_agent_feed_operation_targets (
        manifest_id, plan_sha256, target_id, stream_id, family_id, source_role_id, cadence_seconds
    )
    select v_manifest_id,
           requirement.plan_sha256,
           'p0t_' || encode(
               extensions.digest(
                   convert_to(
                       '{"family_id":' || to_jsonb(requirement.family_id)::text ||
                       ',"plan_sha256":' || to_jsonb(requirement.plan_sha256)::text ||
                       ',"source_role_id":' || to_jsonb(requirement.source_role_id)::text || '}',
                       'UTF8'
                   ),
                   'sha256'
               ),
               'hex'
           ),
           family.stream_id,
           requirement.family_id,
           requirement.source_role_id,
           family.recommended_cadence_seconds
      from app_private.p0_source_role_requirements as requirement
      join app_private.p0_source_families as family
        on family.plan_sha256 = requirement.plan_sha256
       and family.family_id = requirement.family_id
     where requirement.plan_sha256 = p_plan_sha256
     order by family.stream_id, requirement.family_id, requirement.source_role_id;

    select count(*), count(distinct stream_id)
      into v_target_count, v_stream_count
      from app_private.p0_agent_feed_operation_targets
     where manifest_id = v_manifest_id;
    if v_target_count is distinct from 301 or v_stream_count is distinct from 19 then
        raise exception 'P0 operation manifest expansion drifted' using errcode = '55000';
    end if;
    return v_manifest_id;
end;
$$;

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
    -- when that exact subset is carried by the signed terminal event.  The
    -- receipt raw payload is retained at this boundary for the signed-scope
    -- comparison; no producer-supplied reconciliation field can widen it.
    if p_payload->>'terminal_status' = 'completed'
       and jsonb_array_length(p_payload->'checkpoints') < v_expected_count then
        if jsonb_typeof(v_receipt.raw_payload) is distinct from 'object'
           or jsonb_typeof(v_receipt.raw_payload->'payload') is distinct from 'object'
           or jsonb_typeof(v_receipt.raw_payload->'payload'->'expected_scope') is distinct from 'object'
           or jsonb_typeof(v_receipt.raw_payload->'payload'->'expected_scope'->'metadata') is distinct from 'object'
           or jsonb_typeof(v_receipt.raw_payload->'payload'->'expected_scope'->'metadata'->'target_ids') is distinct from 'array' then
            raise exception 'completed P0 subset has no signed expected target scope' using errcode = '22023';
        end if;
        if exists (
            select 1
              from jsonb_array_elements(
                  v_receipt.raw_payload->'payload'->'expected_scope'->'metadata'->'target_ids'
              ) as item(value)
             where jsonb_typeof(item.value) is distinct from 'string'
                or length(btrim(item.value #>> '{}')) = 0
        ) then
            raise exception 'signed P0 expected target scope is malformed' using errcode = '22023';
        end if;
        v_expected_scope_target_ids := array(
            select jsonb_array_elements_text(
                v_receipt.raw_payload->'payload'->'expected_scope'->'metadata'->'target_ids'
            )
        );
        if cardinality(v_expected_scope_target_ids) = 0
           or cardinality(v_expected_scope_target_ids) is distinct from (
               select count(distinct target_id)
                 from unnest(v_expected_scope_target_ids) as scope(target_id)
           ) then
            raise exception 'signed P0 expected target scope is empty or repeated' using errcode = '22023';
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
            raise exception 'signed P0 expected target scope does not match the manifest work unit' using errcode = '22023';
        end if;

        -- A scoped terminal event must also report the same actual target
        -- scope.  Missing or differently shaped actual scope is unsafe to
        -- interpret as successful completion of the selected subset.
        if jsonb_typeof(v_receipt.raw_payload->'payload'->'actual_scope') is distinct from 'object'
           or jsonb_typeof(v_receipt.raw_payload->'payload'->'actual_scope'->'metadata') is distinct from 'object'
           or jsonb_typeof(v_receipt.raw_payload->'payload'->'actual_scope'->'metadata'->'target_ids') is distinct from 'array' then
            raise exception 'completed P0 subset has no signed actual target scope' using errcode = '22023';
        end if;
        if exists (
            select 1
              from jsonb_array_elements(
                  v_receipt.raw_payload->'payload'->'actual_scope'->'metadata'->'target_ids'
              ) as item(value)
             where jsonb_typeof(item.value) is distinct from 'string'
                or length(btrim(item.value #>> '{}')) = 0
        ) then
            raise exception 'signed P0 actual target scope is malformed' using errcode = '22023';
        end if;
        v_actual_scope_target_ids := array(
            select jsonb_array_elements_text(
                v_receipt.raw_payload->'payload'->'actual_scope'->'metadata'->'target_ids'
            )
        );
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
            raise exception 'signed P0 actual target scope does not match expected scope' using errcode = '22023';
        end if;
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
       and jsonb_array_length(p_payload->'checkpoints') < v_expected_count
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
        raise exception 'completed P0 checkpoints do not exactly match signed target scope' using errcode = '22023';
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

create view app_api.p0_agent_feed_target_progress
with (security_invoker = true, security_barrier = true)
as
with latest as (
    select distinct on (attempt.manifest_id, attempt.target_id)
           attempt.*
      from app_private.p0_agent_feed_target_attempts as attempt
     order by attempt.manifest_id, attempt.target_id,
              attempt.attempt_number desc, attempt.observed_at desc, attempt.id desc
), resolved as (
    select distinct on (attempt.manifest_id, attempt.target_id)
           attempt.manifest_id, attempt.target_id, attempt.observed_at as resolved_at,
           attempt.locator_fingerprint
      from app_private.p0_agent_feed_target_attempts as attempt
     where attempt.outcome = 'resolved'
     order by attempt.manifest_id, attempt.target_id,
              attempt.attempt_number desc, attempt.observed_at desc, attempt.id desc
)
select manifest.manifest_sha256,
       target.target_id, target.stream_id, target.family_id, target.source_role_id,
       target.cadence_seconds,
       latest.attempt_number as latest_attempt_number,
       latest.observed_at as latest_observed_at,
       latest.outcome as latest_outcome,
       resolved.resolved_at,
       resolved.locator_fingerprint,
       (resolved.resolved_at is not null) as locator_covered,
       coalesce((
           select sum(attempt.economic_findings_accepted)
             from app_private.p0_agent_feed_target_attempts as attempt
            where attempt.manifest_id = target.manifest_id
              and attempt.target_id = target.target_id
       ), 0)::bigint as economic_findings_accepted
  from app_private.p0_agent_feed_operation_targets as target
  join app_private.p0_agent_feed_operation_manifests as manifest on manifest.id = target.manifest_id
  left join latest on latest.manifest_id = target.manifest_id and latest.target_id = target.target_id
  left join resolved on resolved.manifest_id = target.manifest_id and resolved.target_id = target.target_id;

revoke all on app_private.p0_agent_feed_operation_manifests from public;
revoke all on app_private.p0_agent_feed_operation_targets from public;
revoke all on app_private.p0_agent_feed_target_attempts from public;
revoke all on app_api.p0_agent_feed_target_progress from public;
revoke execute on function app_private.reject_p0_agent_feed_operation_mutation() from public;
revoke execute on function app_private.reject_p0_agent_feed_operation_truncate() from public;
revoke execute on function app_private.register_p0_agent_feed_operations(text,text) from public;
revoke execute on function app_private.reconcile_p0_agent_feed_work_unit(jsonb) from public;

comment on table app_private.p0_agent_feed_target_attempts is
    'Immutable P0 locator/economic attempt receipts; resolved locator coverage never implies canonical evidence or a rule.';

commit;
