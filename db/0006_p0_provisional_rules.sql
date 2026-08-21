-- P0 provisional-rule persistence boundary.
--
-- This is deliberately a private, experimental store.  The adapter which
-- calls these routines is responsible for the package's canonicalization and
-- SHA-256 computation; this migration validates the hash representation and
-- persists the trusted values without attempting to reimplement TypeScript's
-- canonical hash algorithm.  There are no FKs to reward rules, evidence,
-- replay, publication, or user data.

begin;

-- A small immutable helper used by the candidate and observation contracts.
create or replace function app_private.provisional_unique_string_array(
    p_value jsonb
)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog
as $$
begin
    if p_value is null
       or jsonb_typeof(p_value) <> 'array'
       or jsonb_array_length(p_value) = 0
    then
        return false;
    end if;

    if exists (
        select 1
          from jsonb_array_elements(p_value) as item(value)
         where jsonb_typeof(item.value) <> 'string'
            or length(item.value #>> '{}') = 0
    ) then
        return false;
    end if;

    return not exists (
        select 1
          from jsonb_array_elements_text(p_value) as item(value)
         group by item.value
        having count(*) > 1
    );
end;
$$;

revoke execute on function app_private.provisional_unique_string_array(jsonb) from public;

-- Canonical economic-validity gate shared by every current provisional view.
-- Date-only/raw claim dates are deliberately rejected.  The comparison is
-- half-open: valid_from <= effective_at < valid_to (or an open end).
create or replace function app_private.provisional_rule_valid_at(
    p_candidate_payload jsonb,
    p_effective_at timestamptz
)
returns boolean
language plpgsql
stable
set search_path = pg_catalog
as $$
declare
    v_validity jsonb;
    v_from_text text;
    v_to_text text;
    v_from timestamptz;
    v_to timestamptz;
begin
    if p_candidate_payload is null or p_effective_at is null then
        return false;
    end if;
    v_validity := p_candidate_payload #> '{rule,validity}';
    if jsonb_typeof(v_validity) is distinct from 'object'
       or not (v_validity ?& array['valid_from','valid_to'])
    then
        return false;
    end if;
    v_from_text := v_validity->>'valid_from';
    if v_from_text is null
       or v_from_text !~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]([.][0-9]{1,9})?(Z|[+-](0[0-9]|1[0-9]|2[0-3]):[0-5][0-9])$'
    then
        return false;
    end if;
    v_from := v_from_text::timestamptz;
    if v_validity->'valid_to' is null
       or v_validity->'valid_to' = 'null'::jsonb
    then
        v_to := null;
    else
        v_to_text := v_validity->>'valid_to';
        if v_to_text is null
           or v_to_text !~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]([.][0-9]{1,9})?(Z|[+-](0[0-9]|1[0-9]|2[0-3]):[0-5][0-9])$'
        then
            return false;
        end if;
        v_to := v_to_text::timestamptz;
    end if;
    if v_to is not null and v_from >= v_to then
        return false;
    end if;
    return v_from <= p_effective_at
       and (v_to is null or p_effective_at < v_to);
exception when others then
    return false;
end;
$$;

revoke execute on function app_private.provisional_rule_valid_at(jsonb,timestamptz)
    from public;

-- Validate the package candidate representation without attempting to
-- canonicalize or hash it in PostgreSQL.  The adapter owns those hashes; the
-- database owns the fail-closed shape and review/publication boundary.
create or replace function app_private.provisional_candidate_shape_valid(
    p_candidate jsonb
)
returns boolean
language plpgsql
set search_path = pg_catalog
as $$
declare
    v_rule jsonb;
    v_provenance jsonb;
    v_audit jsonb;
    v_validity jsonb;
    v_extractor jsonb;
    v_machine_check jsonb;
    v_checks jsonb;
    v_event jsonb;
begin
    if p_candidate is null
       or jsonb_typeof(p_candidate) is distinct from 'object'
       or not (p_candidate ?& array[
           'version','observation_id','observation_fingerprint','p0_family_id',
           'source_role_id','source_authority_role','source_ids','rule',
           'extractor','machine_check'
       ])
       or exists (
           select 1
             from jsonb_object_keys(p_candidate) as key(name)
            where key.name not in (
                'version','candidate_id','observation_id','observation_fingerprint',
                'p0_family_id','source_role_id','source_authority_role','source_ids',
                'rule','extractor','machine_check'
            )
       )
    then
        return false;
    end if;

    if jsonb_typeof(p_candidate->'version') is distinct from 'string'
       or p_candidate->>'version' is distinct from 'provisional-rule-candidate.v1'
       or jsonb_typeof(p_candidate->'observation_id') is distinct from 'string'
       or length(btrim(p_candidate->>'observation_id')) = 0
       or jsonb_typeof(p_candidate->'observation_fingerprint') is distinct from 'string'
       or p_candidate->>'observation_fingerprint' !~ '^sha256:[0-9a-f]{64}$'
       or jsonb_typeof(p_candidate->'p0_family_id') is distinct from 'string'
       or length(btrim(p_candidate->>'p0_family_id')) = 0
       or jsonb_typeof(p_candidate->'source_role_id') is distinct from 'string'
       or length(btrim(p_candidate->>'source_role_id')) = 0
       or jsonb_typeof(p_candidate->'source_authority_role') is distinct from 'string'
       or (p_candidate->>'source_authority_role' is distinct from 'primary'
           and p_candidate->>'source_authority_role' is distinct from 'corroborating')
       or (p_candidate ? 'candidate_id' and (
           jsonb_typeof(p_candidate->'candidate_id') is distinct from 'string'
           or length(btrim(p_candidate->>'candidate_id')) = 0
       ))
       or not app_private.provisional_unique_string_array(p_candidate->'source_ids')
    then
        return false;
    end if;

    v_rule := p_candidate->'rule';
    if jsonb_typeof(v_rule) is distinct from 'object'
       or (v_rule->>'status' is distinct from 'draft'
           and v_rule->>'status' is distinct from 'under_review')
    then
        return false;
    end if;

    v_provenance := v_rule->'provenance';
    if jsonb_typeof(v_provenance) is distinct from 'object'
       or not (v_provenance ? 'human_verified')
       or jsonb_typeof(v_provenance->'human_verified') is distinct from 'boolean'
       or v_provenance->'human_verified' is distinct from 'false'::jsonb
    then
        return false;
    end if;

    v_audit := v_rule->'audit';
    if jsonb_typeof(v_audit) is distinct from 'object'
       or not (v_audit ?& array['review_mode','reviewed_at','reviewed_by','review_events'])
       or v_audit->'review_mode' is distinct from 'null'::jsonb
       or v_audit->'reviewed_at' is distinct from 'null'::jsonb
       or v_audit->'reviewed_by' is distinct from 'null'::jsonb
       or jsonb_typeof(v_audit->'review_events') is distinct from 'array'
       or exists (
           select 1
             from jsonb_array_elements(v_audit->'review_events') as event(value)
       where jsonb_typeof(event.value) is distinct from 'object'
          or (event.value->>'decision' is distinct from 'approved'
              and event.value->>'decision' is distinct from 'rejected'
              and event.value->>'decision' is distinct from 'needs_more_evidence')
          or not (event.value ?& array['mode','reviewer_id','completed_at','decision','notes'])
       )
    then
        return false;
    end if;
    if exists (
        select 1
          from jsonb_array_elements(v_audit->'review_events') as event(value)
         where event.value->>'decision' is not distinct from 'approved'
    ) then
        return false;
    end if;

    v_validity := v_rule->'validity';
    if jsonb_typeof(v_validity) is distinct from 'object'
       or not (v_validity ? 'superseded_at')
       or v_validity->'superseded_at' is distinct from 'null'::jsonb
    then
        return false;
    end if;

    v_extractor := p_candidate->'extractor';
    if jsonb_typeof(v_extractor) is distinct from 'object'
       or not (v_extractor ?& array['name','version'])
       or exists (
           select 1 from jsonb_object_keys(v_extractor) as key(name)
            where key.name not in ('name','version')
       )
       or jsonb_typeof(v_extractor->'name') is distinct from 'string'
       or length(btrim(v_extractor->>'name')) = 0
       or jsonb_typeof(v_extractor->'version') is distinct from 'string'
       or length(btrim(v_extractor->>'version')) = 0
    then
        return false;
    end if;

    v_machine_check := p_candidate->'machine_check';
    if jsonb_typeof(v_machine_check) is distinct from 'object'
       or not (v_machine_check ?& array['checker','checker_version','checked_at','checks'])
       or exists (
           select 1 from jsonb_object_keys(v_machine_check) as key(name)
            where key.name not in ('checker','checker_version','checked_at','checks')
       )
       or jsonb_typeof(v_machine_check->'checker') is distinct from 'string'
       or length(btrim(v_machine_check->>'checker')) = 0
       or jsonb_typeof(v_machine_check->'checker_version') is distinct from 'string'
       or length(btrim(v_machine_check->>'checker_version')) = 0
       or jsonb_typeof(v_machine_check->'checked_at') is distinct from 'string'
       or length(btrim(v_machine_check->>'checked_at')) = 0
    then
        return false;
    end if;
    v_checks := v_machine_check->'checks';
    if jsonb_typeof(v_checks) is distinct from 'object'
       or not (v_checks ?& array[
           'representation_safe','rule_structure','rule_semantics',
           'observation_binding','p0_coverage'
       ])
       or exists (
           select 1 from jsonb_object_keys(v_checks) as key(name)
            where key.name not in (
                'representation_safe','rule_structure','rule_semantics',
                'observation_binding','p0_coverage'
            )
       )
       or jsonb_typeof(v_checks->'representation_safe') is distinct from 'boolean'
       or v_checks->'representation_safe' is distinct from 'true'::jsonb
       or jsonb_typeof(v_checks->'rule_structure') is distinct from 'boolean'
       or v_checks->'rule_structure' is distinct from 'true'::jsonb
       or jsonb_typeof(v_checks->'rule_semantics') is distinct from 'boolean'
       or v_checks->'rule_semantics' is distinct from 'true'::jsonb
       or jsonb_typeof(v_checks->'observation_binding') is distinct from 'boolean'
       or v_checks->'observation_binding' is distinct from 'true'::jsonb
       or jsonb_typeof(v_checks->'p0_coverage') is distinct from 'boolean'
       or v_checks->'p0_coverage' is distinct from 'true'::jsonb
    then
        return false;
    end if;

    return true;
exception when others then
    -- Any malformed nested value is a representation rejection, never an
    -- implicit success caused by a NULL JSON extraction or cast.
    return false;
end;
$$;

revoke execute on function app_private.provisional_candidate_shape_valid(jsonb) from public;

create table app_private.provisional_rule_candidates (
    id uuid primary key default gen_random_uuid(),
    candidate_hash text not null unique,
    definition_hash text not null,
    candidate_id text,
    candidate_payload jsonb not null,
    source_observation_id uuid not null
        references app_private.source_observations(id) on delete restrict,
    source_observation_key text not null,
    observation_fingerprint text not null,
    observation_source_ids jsonb not null,
    source_ids jsonb not null,
    p0_family_id text not null,
    source_role_id text not null,
    source_authority_role text not null
        check (source_authority_role in ('primary','corroborating')),
    status text not null
        check (status in (
            'needs_evidence','machine_checked','active_experimental',
            'disputed','quarantined'
        )),
    machine_checked_at timestamptz not null,
    admitted_at timestamptz not null default now(),
    check (char_length(candidate_hash) = 71
        and candidate_hash ~ '^sha256:[0-9a-f]{64}$'),
    check (char_length(definition_hash) = 71
        and definition_hash ~ '^sha256:[0-9a-f]{64}$'),
    check (jsonb_typeof(candidate_payload) = 'object'),
    check (jsonb_typeof(observation_source_ids) = 'array'),
    check (app_private.provisional_unique_string_array(source_ids)),
    check (jsonb_typeof(source_ids) = 'array'),
    check (source_observation_key ~ '^so_[a-z0-9_-]+$'),
    check (observation_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
    check (candidate_id is null or length(candidate_id) > 0),
    check (length(btrim(p0_family_id)) > 0),
    check (length(btrim(source_role_id)) > 0)
);

comment on table app_private.provisional_rule_candidates is
    'Private immutable snapshots admitted by @jro/provisional-rules; never a canonical or published rule.';
comment on column app_private.provisional_rule_candidates.candidate_hash is
    'Trusted adapter SHA-256 identity; the database validates format but does not recompute the TypeScript canonical hash.';
comment on column app_private.provisional_rule_candidates.candidate_payload is
    'Immutable package candidate document, retained exactly as admitted.';

create index provisional_rule_candidates_status_idx
    on app_private.provisional_rule_candidates (status, admitted_at desc);
create index provisional_rule_candidates_observation_idx
    on app_private.provisional_rule_candidates (source_observation_id, admitted_at desc);

create table app_private.provisional_rule_transitions (
    candidate_id uuid not null
        references app_private.provisional_rule_candidates(id) on delete restrict,
    sequence integer not null check (sequence >= 0),
    candidate_hash text not null,
    from_status text,
    to_status text not null,
    occurred_at timestamptz not null,
    reason text not null,
    correction_hash text,
    created_at timestamptz not null default now(),
    primary key (candidate_id, sequence),
    check (char_length(candidate_hash) = 71
        and candidate_hash ~ '^sha256:[0-9a-f]{64}$'),
    check (from_status is null or from_status in (
        'needs_evidence','machine_checked','active_experimental',
        'disputed','quarantined'
    )),
    check (to_status in (
        'needs_evidence','machine_checked','active_experimental',
        'disputed','quarantined'
    )),
    check (correction_hash is null or (
        char_length(correction_hash) = 71
        and correction_hash ~ '^sha256:[0-9a-f]{64}$'
    )),
    check (length(reason) > 0 and length(reason) <= 160 and reason !~ '[\r\n]')
);

comment on table app_private.provisional_rule_transitions is
    'Private append-only lifecycle history for provisional candidates.';

create index provisional_rule_transitions_candidate_time_idx
    on app_private.provisional_rule_transitions (candidate_id, occurred_at, sequence);

create table app_private.provisional_correction_signals (
    signal_id text primary key,
    candidate_id uuid not null
        references app_private.provisional_rule_candidates(id) on delete restrict,
    candidate_hash text not null,
    signal_hash text not null,
    category text not null check (category in (
        'not_accepted','reward_missing','rate_wrong','campaign_ended',
        'registration_required','cap_or_minimum_missing','merchant_wrong',
        'product_variant_wrong','security_mismatch','source_mismatch'
    )),
    credible boolean not null,
    reported_at timestamptz not null,
    severity text not null default 'normal'
        check (severity in ('normal','severe')),
    signal_payload jsonb not null,
    created_at timestamptz not null default now(),
    check (signal_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
    check (char_length(candidate_hash) = 71
        and candidate_hash ~ '^sha256:[0-9a-f]{64}$'),
    check (char_length(signal_hash) = 71
        and signal_hash ~ '^sha256:[0-9a-f]{64}$'),
    check (jsonb_typeof(signal_payload) = 'object')
);

comment on table app_private.provisional_correction_signals is
    'Private append-only correction signals; signal_id is globally unique to detect content tampering.';

create index provisional_correction_signals_candidate_time_idx
    on app_private.provisional_correction_signals (candidate_id, reported_at, signal_id);

-- Freeze SourceObservation identity once a candidate has relied on it. Status,
-- trust_state, and security flags remain mutable so a source can immediately
-- remove a candidate from the active experimental view.
create or replace function app_private.protect_provisional_observation_binding()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
    if tg_op = 'DELETE' then
        if exists (
            select 1
              from app_private.provisional_rule_candidates as candidate
             where candidate.source_observation_id = old.id
        ) then
            raise exception 'SourceObservation % is bound to a provisional candidate'
                , old.observation_key using errcode = '55000';
        end if;
        return old;
    end if;

    if exists (
        select 1
          from app_private.provisional_rule_candidates as candidate
         where candidate.source_observation_id = old.id
    ) and (
        new.observation_key is distinct from old.observation_key
        or new.semantic_fingerprint is distinct from old.semantic_fingerprint
        or new.source_keys is distinct from old.source_keys
        or new.source_ids is distinct from old.source_ids
    ) then
        raise exception 'SourceObservation identity is immutable after provisional admission'
            using errcode = '55000';
    end if;
    return new;
end;
$$;

revoke execute on function app_private.protect_provisional_observation_binding() from public;

create trigger source_observations_provisional_binding_guard
before update or delete on app_private.source_observations
for each row execute function app_private.protect_provisional_observation_binding();

-- Candidate snapshots may only be created by the narrow SECURITY DEFINER
-- admission routine. The context marker is transaction-local and is cleared by
-- each routine before it returns.
create or replace function app_private.protect_provisional_candidate()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
    v_observation app_private.source_observations%rowtype;
    v_candidate jsonb;
    v_source_role_id text;
    v_source_authority_role text;
    v_expected_status text;
begin
    if tg_op = 'DELETE' then
        raise exception 'provisional candidates are immutable and cannot be deleted'
            using errcode = '55000';
    end if;

    if tg_op = 'UPDATE' then
        if (to_jsonb(new) - 'status') <> (to_jsonb(old) - 'status') then
            raise exception 'provisional candidate payload and binding are immutable'
                using errcode = '55000';
        end if;
        if new.status = old.status then
            raise exception 'provisional candidate status update is not a lifecycle transition'
                using errcode = '55000';
        end if;
        if coalesce(current_setting('app_private.provisional_write_context', true), '')
             not in ('lifecycle_transition','correction') then
            raise exception 'provisional candidate status is DB-owned'
                using errcode = '55000';
        end if;
        if not exists (
            select 1
              from app_private.provisional_rule_transitions as transition
             where transition.candidate_id = old.id
               and transition.sequence = (
                   select max(last_transition.sequence)
                     from app_private.provisional_rule_transitions as last_transition
                    where last_transition.candidate_id = old.id
               )
               and transition.from_status is not distinct from old.status
               and transition.to_status = new.status
        ) then
            raise exception 'candidate status requires a matching append-only transition'
                using errcode = '55000';
        end if;
        return new;
    end if;

    if coalesce(current_setting('app_private.provisional_write_context', true), '')
         <> 'candidate_insert' then
        raise exception 'provisional candidates may only be inserted by the admission routine'
            using errcode = '55000';
    end if;

    select * into v_observation
      from app_private.source_observations as observation
     where observation.id = new.source_observation_id
     for update;
    if not found then
        raise exception 'candidate SourceObservation does not exist'
            using errcode = '23503';
    end if;
    if new.source_observation_key is distinct from v_observation.observation_key
       or new.observation_fingerprint is distinct from v_observation.semantic_fingerprint
       or new.observation_source_ids is distinct from v_observation.source_ids
    then
        raise exception 'candidate SourceObservation binding is not exact'
            using errcode = '22023';
    end if;
    if (v_observation.status is distinct from 'needs_evidence'
        and v_observation.status is distinct from 'needs_review')
       or jsonb_typeof(v_observation.security_flags) is distinct from 'array'
       or jsonb_array_length(v_observation.security_flags) <> 0
       or v_observation.trust_state is null
       or v_observation.trust_state = 'quarantined' then
        raise exception 'quarantined or non-admissible SourceObservation cannot create a candidate'
            using errcode = '55000';
    end if;

    v_candidate := new.candidate_payload;
    if not app_private.provisional_candidate_shape_valid(v_candidate) then
        raise exception 'candidate payload shape is not an exact provisional candidate'
            using errcode = '22023';
    end if;
    v_source_role_id := v_candidate->>'source_role_id';
    v_source_authority_role := v_candidate->>'source_authority_role';
    if v_candidate->>'version' is distinct from 'provisional-rule-candidate.v1'
       or v_candidate->>'observation_id' is distinct from v_observation.observation_key
       or v_candidate->>'observation_fingerprint' is distinct from v_observation.semantic_fingerprint
       or v_candidate->>'p0_family_id' is distinct from new.p0_family_id
       or v_source_role_id is distinct from new.source_role_id
       or v_source_authority_role is distinct from new.source_authority_role
       or v_candidate->'source_ids' is distinct from new.source_ids
       or (v_source_authority_role = 'primary'
           and v_observation.discovery_assessment->>'source_authority_claim' is distinct from 'primary')
       or (v_source_authority_role = 'corroborating'
           and v_observation.discovery_assessment->>'source_authority_claim' is distinct from 'official_secondary'
           and v_observation.discovery_assessment->>'source_authority_claim' is distinct from 'third_party')
    then
        raise exception 'candidate payload does not match persisted binding'
            using errcode = '22023';
    end if;
    if exists (
           select 1
             from jsonb_array_elements_text(new.source_ids) as candidate_source(value)
            where not exists (
                select 1
                  from jsonb_array_elements_text(v_observation.source_ids) as observation_source(value)
                 where observation_source.value = candidate_source.value
            )
       ) then
        raise exception 'candidate source IDs must be covered by SourceObservation'
            using errcode = '22023';
    end if;
    v_expected_status := case
        when v_observation.status = 'needs_review'
         and v_observation.discovery_assessment->>'evidence_completeness' = 'complete'
         and jsonb_array_length(v_observation.submitted_evidence_refs) > 0
            then 'machine_checked'
        else 'needs_evidence'
    end;
    if new.status is distinct from v_expected_status
       or new.machine_checked_at is distinct from (v_candidate->'machine_check'->>'checked_at')::timestamptz
    then
        raise exception 'candidate lifecycle status is not DB-derived from SourceObservation'
            using errcode = '22023';
    end if;
    return new;
end;
$$;

revoke execute on function app_private.protect_provisional_candidate() from public;

create trigger provisional_rule_candidates_lifecycle_guard
before insert or update or delete on app_private.provisional_rule_candidates
for each row execute function app_private.protect_provisional_candidate();

create or replace function app_private.protect_provisional_transition()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
    v_candidate app_private.provisional_rule_candidates%rowtype;
    v_last_sequence integer;
    v_last_at timestamptz;
    v_allowed boolean := false;
begin
    if tg_op <> 'INSERT' then
        raise exception 'provisional transitions are append-only'
            using errcode = '55000';
    end if;
    if coalesce(current_setting('app_private.provisional_write_context', true), '')
         not in ('candidate_insert','lifecycle_transition','correction') then
        raise exception 'provisional transitions are DB-owned'
            using errcode = '55000';
    end if;

    select * into v_candidate
      from app_private.provisional_rule_candidates as candidate
     where candidate.id = new.candidate_id
     for update;
    if not found or new.candidate_hash <> v_candidate.candidate_hash then
        raise exception 'transition candidate hash binding is invalid'
            using errcode = '22023';
    end if;
    select max(sequence) into v_last_sequence
      from app_private.provisional_rule_transitions
     where candidate_id = new.candidate_id;
    if new.sequence <> coalesce(v_last_sequence, -1) + 1 then
        raise exception 'provisional transition sequence must be contiguous'
            using errcode = '22023';
    end if;
    if new.sequence = 0 then
        v_allowed := new.from_status is null
            and new.to_status in ('needs_evidence','machine_checked');
    else
        v_allowed := new.from_status is not distinct from v_candidate.status
            and (
                (v_candidate.status = 'machine_checked'
                    and new.to_status in ('active_experimental','disputed','quarantined'))
                or (v_candidate.status = 'active_experimental'
                    and new.to_status in ('disputed','quarantined'))
                or (v_candidate.status = 'needs_evidence'
                    and new.to_status = 'quarantined')
                or (v_candidate.status = 'disputed'
                    and new.to_status = 'quarantined')
            );
    end if;
    if not v_allowed then
        raise exception 'invalid provisional lifecycle transition % -> %'
            , coalesce(new.from_status, '<none>'), new.to_status
            using errcode = '22023';
    end if;

    select greatest(
        coalesce((select max(occurred_at)
                    from app_private.provisional_rule_transitions
                   where candidate_id = new.candidate_id), '-infinity'::timestamptz),
        coalesce((select max(reported_at)
                    from app_private.provisional_correction_signals
                   where candidate_id = new.candidate_id), '-infinity'::timestamptz)
    ) into v_last_at;
    if new.sequence > 0 and new.occurred_at < v_last_at then
        raise exception 'provisional transition time regresses history'
            using errcode = '22023';
    end if;
    if new.correction_hash is not null
       and not exists (
           select 1
             from app_private.provisional_correction_signals as signal
            where signal.candidate_id = new.candidate_id
              and signal.candidate_hash = new.candidate_hash
              and signal.signal_hash = new.correction_hash
       ) then
        raise exception 'transition correction hash is not an appended signal'
            using errcode = '22023';
    end if;
    return new;
end;
$$;

revoke execute on function app_private.protect_provisional_transition() from public;

create trigger provisional_rule_transitions_append_only
before insert or update or delete on app_private.provisional_rule_transitions
for each row execute function app_private.protect_provisional_transition();

create or replace function app_private.protect_provisional_correction()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
    v_candidate_hash text;
begin
    if tg_op <> 'INSERT' then
        raise exception 'provisional correction signals are append-only'
            using errcode = '55000';
    end if;
    if coalesce(current_setting('app_private.provisional_write_context', true), '')
         <> 'correction' then
        raise exception 'provisional corrections are DB-owned'
            using errcode = '55000';
    end if;
    select candidate_hash into v_candidate_hash
      from app_private.provisional_rule_candidates
     where id = new.candidate_id;
    if v_candidate_hash is null or new.candidate_hash is distinct from v_candidate_hash then
        raise exception 'correction candidate hash binding is invalid'
            using errcode = '22023';
    end if;
    if new.signal_payload->>'version' is distinct from 'provisional-correction.v1'
       or new.signal_payload->>'signal_id' is distinct from new.signal_id
       or new.signal_payload->>'candidate_hash' is distinct from new.candidate_hash
       or new.signal_payload->>'category' is distinct from new.category
       or (new.signal_payload->>'credible')::boolean is distinct from new.credible
       or (new.signal_payload->>'reported_at')::timestamptz is distinct from new.reported_at
       or coalesce(new.signal_payload->>'severity', 'normal') is distinct from new.severity
    then
        raise exception 'correction payload does not match persisted signal fields'
            using errcode = '22023';
    end if;
    return new;
end;
$$;

revoke execute on function app_private.protect_provisional_correction() from public;

create trigger provisional_correction_signals_append_only
before insert or update or delete on app_private.provisional_correction_signals
for each row execute function app_private.protect_provisional_correction();

-- Persist one package-admitted candidate.  The routine accepts exactly the
-- package candidate object and stores its immutable snapshot. Re-admission of
-- the same hash is idempotent only when all trusted identity values and the
-- immutable payload agree.
create or replace function app_private.persist_provisional_rule_candidate(
    p_candidate_hash text,
    p_definition_hash text,
    p_candidate_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
    v_candidate jsonb;
    v_existing app_private.provisional_rule_candidates%rowtype;
    v_observation app_private.source_observations%rowtype;
    v_status text;
    v_id uuid;
    v_source_role_id text;
    v_source_authority_role text;
begin
    if p_candidate_hash is null
       or p_definition_hash is null
       or char_length(p_candidate_hash) <> 71
       or p_candidate_hash !~ '^sha256:[0-9a-f]{64}$'
       or char_length(p_definition_hash) <> 71
       or p_definition_hash !~ '^sha256:[0-9a-f]{64}$'
    then
        raise exception 'candidate and definition hashes must be strict SHA-256 values'
            using errcode = '22023';
    end if;
    if not app_private.provisional_candidate_shape_valid(p_candidate_payload) then
        raise exception 'candidate payload shape is not an exact provisional candidate'
            using errcode = '22023';
    end if;
    v_candidate := p_candidate_payload;

    -- Serialize insert-or-get retries before taking the SourceObservation lock.
    perform pg_advisory_xact_lock(hashtextextended(p_candidate_hash, 0));

    select * into v_observation
      from app_private.source_observations as observation
     where observation.observation_key = v_candidate->>'observation_id'
     for update;
    if not found then
        raise exception 'candidate SourceObservation % does not exist'
            , v_candidate->>'observation_id' using errcode = '23503';
    end if;
    if jsonb_typeof(v_observation.source_ids) is distinct from 'array'
       or exists (
           select 1
             from jsonb_array_elements_text(v_candidate->'source_ids') as candidate_source(value)
            where not exists (
                select 1
                  from jsonb_array_elements_text(v_observation.source_ids) as observation_source(value)
                 where observation_source.value = candidate_source.value
            )
       )
    then
        raise exception 'candidate source IDs are not exactly bound to SourceObservation'
            using errcode = '22023';
    end if;
    if v_candidate->>'observation_fingerprint' is distinct from v_observation.semantic_fingerprint
       or v_candidate->>'observation_id' is distinct from v_observation.observation_key
       or (v_candidate->>'source_authority_role' = 'primary'
           and v_observation.discovery_assessment->>'source_authority_claim' is distinct from 'primary')
       or (v_candidate->>'source_authority_role' = 'corroborating'
           and v_observation.discovery_assessment->>'source_authority_claim' is distinct from 'official_secondary'
           and v_observation.discovery_assessment->>'source_authority_claim' is distinct from 'third_party')
    then
        raise exception 'candidate identity or SourceObservation authority binding is invalid'
            using errcode = '22023';
    end if;
    if jsonb_typeof(v_observation.security_flags) is distinct from 'array'
       or jsonb_array_length(v_observation.security_flags) <> 0
       or v_observation.trust_state is null
       or v_observation.trust_state = 'quarantined'
       or (v_observation.status is distinct from 'needs_evidence'
           and v_observation.status is distinct from 'needs_review')
    then
        raise exception 'quarantined or non-admissible SourceObservation cannot be persisted'
            using errcode = '55000';
    end if;

    v_status := case
        when v_observation.status = 'needs_review'
         and v_observation.discovery_assessment->>'evidence_completeness' = 'complete'
         and jsonb_array_length(v_observation.submitted_evidence_refs) > 0
            then 'machine_checked'
        else 'needs_evidence'
    end;
    v_source_role_id := v_candidate->>'source_role_id';
    v_source_authority_role := v_candidate->>'source_authority_role';

    select * into v_existing
      from app_private.provisional_rule_candidates as candidate
     where candidate.candidate_hash = p_candidate_hash
     for update;
    if found then
        if v_existing.definition_hash is distinct from p_definition_hash
           or v_existing.candidate_payload is distinct from v_candidate
           or v_existing.source_observation_id is distinct from v_observation.id
           or v_existing.observation_fingerprint is distinct from v_observation.semantic_fingerprint
           or v_existing.source_ids is distinct from (v_candidate->'source_ids')
        then
            raise exception 'candidate hash was reused with different content'
                using errcode = '55000';
        end if;
        return v_existing.id;
    end if;

    perform set_config('app_private.provisional_write_context', 'candidate_insert', true);
    insert into app_private.provisional_rule_candidates (
        candidate_hash, definition_hash, candidate_id, candidate_payload,
        source_observation_id, source_observation_key, observation_fingerprint,
        observation_source_ids, source_ids, p0_family_id, source_role_id,
        source_authority_role,
        status, machine_checked_at
    ) values (
        p_candidate_hash, p_definition_hash, v_candidate->>'candidate_id', v_candidate,
        v_observation.id, v_observation.observation_key, v_observation.semantic_fingerprint,
        v_observation.source_ids, v_candidate->'source_ids', v_candidate->>'p0_family_id',
        v_source_role_id, v_source_authority_role, v_status,
        (v_candidate->'machine_check'->>'checked_at')::timestamptz
    ) returning id into v_id;

    insert into app_private.provisional_rule_transitions (
        candidate_id, sequence, candidate_hash, from_status, to_status,
        occurred_at, reason
    ) values (
        v_id, 0, p_candidate_hash, null, v_status,
        (v_candidate->'machine_check'->>'checked_at')::timestamptz,
        case when v_status = 'machine_checked'
             then 'machine_checks_passed' else 'evidence_required' end
    );
    perform set_config('app_private.provisional_write_context', '', true);
    return v_id;
end;
$$;

revoke execute on function app_private.persist_provisional_rule_candidate(text,text,jsonb) from public;

-- Activate only a machine-checked candidate. The source is rechecked under
-- the same candidate lock, so a concurrent quarantine cannot race activation.
create or replace function app_private.activate_provisional_rule_candidate(
    p_candidate_hash text,
    p_occurred_at timestamptz,
    p_reason text default 'explicit_experimental_activation'
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
    v_candidate app_private.provisional_rule_candidates%rowtype;
    v_source app_private.source_observations%rowtype;
    v_sequence integer;
begin
    if p_candidate_hash is null
       or p_occurred_at is null
       or char_length(p_candidate_hash) <> 71
       or p_candidate_hash !~ '^sha256:[0-9a-f]{64}$'
       or p_reason is null
       or length(p_reason) = 0
       or length(p_reason) > 160
       or p_reason ~ '[\r\n]'
    then
        raise exception 'activation arguments are invalid' using errcode = '22023';
    end if;
    -- Match admission/correction lock ordering: candidate-hash advisory lock
    -- precedes every candidate/source row lock.
    perform pg_advisory_xact_lock(hashtextextended(p_candidate_hash, 0));
    select * into v_candidate
      from app_private.provisional_rule_candidates as candidate
     where candidate.candidate_hash = p_candidate_hash
     for update;
    if not found then
        raise exception 'provisional candidate % does not exist'
            , p_candidate_hash using errcode = '23503';
    end if;
    if v_candidate.status is distinct from 'machine_checked'
       or v_candidate.source_authority_role is distinct from 'primary'
    then
        raise exception 'only machine_checked candidates may become active_experimental'
            using errcode = '55000';
    end if;
    select * into v_source
      from app_private.source_observations as observation
     where observation.id = v_candidate.source_observation_id
     for update;
    if v_source.status = 'rejected'
       or v_source.status = 'quarantined'
       or v_source.status is null
       or v_source.trust_state = 'quarantined'
       or v_source.trust_state is null
       or jsonb_typeof(v_source.security_flags) is distinct from 'array'
       or jsonb_array_length(v_source.security_flags) > 0
       or v_source.discovery_assessment->>'source_authority_claim' is distinct from 'primary'
    then
        raise exception 'quarantined SourceObservation cannot activate a candidate'
            using errcode = '55000';
    end if;
    if p_occurred_at < greatest(
        (select max(occurred_at) from app_private.provisional_rule_transitions
          where candidate_id = v_candidate.id),
        coalesce((select max(reported_at) from app_private.provisional_correction_signals
          where candidate_id = v_candidate.id), '-infinity'::timestamptz)
    ) then
        raise exception 'activation timestamp precedes provisional history'
            using errcode = '22023';
    end if;
    select coalesce(max(sequence), -1) + 1 into v_sequence
      from app_private.provisional_rule_transitions
     where candidate_id = v_candidate.id;

    perform set_config('app_private.provisional_write_context', 'lifecycle_transition', true);
    insert into app_private.provisional_rule_transitions (
        candidate_id, sequence, candidate_hash, from_status, to_status,
        occurred_at, reason
    ) values (
        v_candidate.id, v_sequence, v_candidate.candidate_hash,
        v_candidate.status, 'active_experimental', p_occurred_at, p_reason
    );
    update app_private.provisional_rule_candidates
       set status = 'active_experimental'
     where id = v_candidate.id;
    perform set_config('app_private.provisional_write_context', '', true);
    return v_candidate.id;
end;
$$;

revoke execute on function app_private.activate_provisional_rule_candidate(text,timestamptz,text) from public;

-- Append one already-adjudicated package correction. Credible normal signals
-- dispute active/machine-checked candidates; a needs_evidence candidate is
-- recorded only. Credible severe or security/source mismatch signals
-- quarantine immediately. Non-credible signals are retained without changing
-- status. A signal ID is global across all candidates.
create or replace function app_private.record_provisional_correction(
    p_signal jsonb,
    p_signal_hash text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
    v_existing app_private.provisional_correction_signals%rowtype;
    v_candidate app_private.provisional_rule_candidates%rowtype;
    v_signal_id text;
    v_candidate_hash text;
    v_category text;
    v_credible boolean;
    v_reported_at timestamptz;
    v_severity text;
    v_sequence integer;
    v_disposition text := 'recorded';
    v_next_status text;
    v_severe boolean;
begin
    if p_signal is null
       or p_signal_hash is null
       or char_length(p_signal_hash) <> 71
       or p_signal_hash !~ '^sha256:[0-9a-f]{64}$'
       or jsonb_typeof(p_signal) is distinct from 'object'
       or not (p_signal ?& array[
           'version','signal_id','candidate_hash','category','credible','reported_at'
       ])
       or p_signal->>'version' is distinct from 'provisional-correction.v1'
       or exists (
           select 1
             from jsonb_object_keys(p_signal) as key(name)
            where key.name not in ('version','signal_id','candidate_hash','category',
                                   'credible','reported_at','severity')
       )
    then
        raise exception 'correction signal representation or hash is invalid'
            using errcode = '22023';
    end if;
    if jsonb_typeof(p_signal->'version') is distinct from 'string'
       or jsonb_typeof(p_signal->'signal_id') is distinct from 'string'
       or jsonb_typeof(p_signal->'candidate_hash') is distinct from 'string'
       or jsonb_typeof(p_signal->'category') is distinct from 'string'
       or jsonb_typeof(p_signal->'credible') is distinct from 'boolean'
       or jsonb_typeof(p_signal->'reported_at') is distinct from 'string'
       or (p_signal ? 'severity'
           and jsonb_typeof(p_signal->'severity') is distinct from 'string')
    then
        raise exception 'correction signal fields have invalid JSON types'
            using errcode = '22023';
    end if;
    v_signal_id := p_signal->>'signal_id';
    v_candidate_hash := p_signal->>'candidate_hash';
    v_category := p_signal->>'category';
    v_credible := (p_signal->>'credible')::boolean;
    v_reported_at := (p_signal->>'reported_at')::timestamptz;
    v_severity := coalesce(p_signal->>'severity', 'normal');
    if v_signal_id is null
       or v_signal_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
       or v_candidate_hash is null
       or char_length(v_candidate_hash) <> 71
       or v_candidate_hash !~ '^sha256:[0-9a-f]{64}$'
       or v_category is null
       or v_category not in (
           'not_accepted','reward_missing','rate_wrong','campaign_ended',
           'registration_required','cap_or_minimum_missing','merchant_wrong',
           'product_variant_wrong','security_mismatch','source_mismatch'
       )
       or v_reported_at is null
       or v_severity is null
       or v_severity not in ('normal','severe')
    then
        raise exception 'correction signal fields are invalid' using errcode = '22023';
    end if;

    -- Serialize candidate mutations before the global signal-ID inspection.
    -- This is the same first lock as activation and admission, so concurrent
    -- correction/activation transitions cannot overtake one another.
    perform pg_advisory_xact_lock(hashtextextended(v_candidate_hash, 0));
    perform pg_advisory_xact_lock(hashtextextended(v_signal_id, 0));
    select * into v_existing
      from app_private.provisional_correction_signals as signal
     where signal.signal_id = v_signal_id
     for update;
    if found then
        if v_existing.signal_hash is not distinct from p_signal_hash
           and v_existing.signal_payload is not distinct from p_signal
        then
            raise exception 'correction signal was already recorded'
                using errcode = '23505';
        end if;
        raise exception 'correction signal ID was reused with different content'
            using errcode = '55000';
    end if;

    select * into v_candidate
      from app_private.provisional_rule_candidates as candidate
     where candidate.candidate_hash = v_candidate_hash
     for update;
    if not found then
        raise exception 'provisional candidate % does not exist'
            , v_candidate_hash using errcode = '23503';
    end if;
    if v_reported_at < greatest(
        (select max(occurred_at) from app_private.provisional_rule_transitions
          where candidate_id = v_candidate.id),
        coalesce((select max(reported_at) from app_private.provisional_correction_signals
          where candidate_id = v_candidate.id), '-infinity'::timestamptz)
    ) then
        raise exception 'correction timestamp precedes provisional history'
            using errcode = '22023';
    end if;
    v_severe := v_severity = 'severe'
        or v_category in ('security_mismatch','source_mismatch');

    perform set_config('app_private.provisional_write_context', 'correction', true);
    insert into app_private.provisional_correction_signals (
        signal_id, candidate_id, candidate_hash, signal_hash, category,
        credible, reported_at, severity, signal_payload
    ) values (
        v_signal_id, v_candidate.id, v_candidate.candidate_hash, p_signal_hash,
        v_category, v_credible, v_reported_at, v_severity, p_signal
    );

    if v_credible and v_severe and v_candidate.status is distinct from 'quarantined' then
        v_next_status := 'quarantined';
        v_disposition := 'quarantined';
    elsif v_credible and not v_severe
          and v_candidate.status in ('active_experimental','machine_checked') then
        v_next_status := 'disputed';
        v_disposition := 'disputed';
    elsif v_credible and v_severe then
        v_disposition := 'quarantined';
    end if;

    if v_next_status is not null then
        select coalesce(max(sequence), -1) + 1 into v_sequence
          from app_private.provisional_rule_transitions
         where candidate_id = v_candidate.id;
        insert into app_private.provisional_rule_transitions (
            candidate_id, sequence, candidate_hash, from_status, to_status,
            occurred_at, reason, correction_hash
        ) values (
            v_candidate.id, v_sequence, v_candidate.candidate_hash,
            v_candidate.status, v_next_status, v_reported_at,
            case when v_severe then 'severe_correction_signal'
                 else 'credible_correction:' || v_category end,
            p_signal_hash
        );
        update app_private.provisional_rule_candidates
           set status = v_next_status
         where id = v_candidate.id;
    end if;
    perform set_config('app_private.provisional_write_context', '', true);
    return v_disposition;
end;
$$;

revoke execute on function app_private.record_provisional_correction(jsonb,text) from public;

-- The view is useful only to an explicitly privileged internal reader. It is
-- invoker/security-barrier by design and excludes source rows whose current
-- status or trust state is rejected/quarantined (including security flags).
create or replace view app_api.active_experimental_provisional_rules
with (security_invoker = true, security_barrier = true) as
select
    candidate.candidate_hash,
    candidate.definition_hash,
    candidate.candidate_id,
    candidate.candidate_payload,
    candidate.source_observation_id,
    candidate.source_observation_key,
    candidate.observation_fingerprint,
    candidate.source_ids,
    candidate.p0_family_id,
    candidate.source_role_id,
    candidate.source_authority_role,
    candidate.status,
    candidate.machine_checked_at,
    candidate.admitted_at
  from app_private.provisional_rule_candidates as candidate
  join app_private.source_observations as observation
    on observation.id = candidate.source_observation_id
 where candidate.status = 'active_experimental'
   and candidate.source_authority_role = 'primary'
   and observation.discovery_assessment->>'source_authority_claim' = 'primary'
   and observation.status is not null
   and observation.status not in ('rejected','quarantined')
   and observation.trust_state is not null
   and observation.trust_state <> 'quarantined'
   and observation.security_flags = '[]'::jsonb;

revoke all on app_private.provisional_rule_candidates from public;
revoke all on app_private.provisional_rule_transitions from public;
revoke all on app_private.provisional_correction_signals from public;
revoke all on app_api.active_experimental_provisional_rules from public;
revoke execute on all functions in schema app_private from public;
revoke execute on all functions in schema app_api from public;

-- Explicit current-view function. The unparameterized view above remains a
-- lifecycle/historical projection for deterministic replay and maintenance;
-- callers that need a current recommendation must provide the effective
-- instant and cannot accidentally depend on wall-clock time.
create or replace function app_api.active_experimental_provisional_rules_at(
    p_effective_at timestamptz
)
returns setof app_api.active_experimental_provisional_rules
language sql
stable
security invoker
set search_path = pg_catalog
as $$
    select candidate.*
      from app_api.active_experimental_provisional_rules as candidate
     where app_private.provisional_rule_valid_at(
               candidate.candidate_payload,
               p_effective_at
           )
$$;

revoke all on function app_api.active_experimental_provisional_rules_at(timestamptz)
    from public;

commit;
