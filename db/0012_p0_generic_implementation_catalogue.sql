-- Generic P0 implementation-fact catalogue.
--
-- This is an immutable, machine-checked fact lane.  It accepts validated P0
-- implementation snapshots, including the current 87-fact catalogue, but
-- deliberately creates no RewardRule, evidence, publication, or candidate
-- rows.  The trusted TypeScript producer supplies the implementation hash;
-- PostgreSQL validates its SHA-256 representation and exact shape but does
-- not reimplement TypeScript canonicalization.

begin;

create table app_private.p0_implementation_coverage_refs (
    coverage_index_version text not null,
    family_id text not null,
    source_role_id text not null,
    source_id text not null,
    primary key (coverage_index_version, family_id, source_role_id, source_id),
    check (coverage_index_version ~ '^p0-coverage-index\.v[0-9]+(\.[0-9]+)*$'),
    check (length(btrim(family_id)) > 0),
    check (length(btrim(source_role_id)) > 0),
    check (length(btrim(source_id)) > 0)
);

create table app_private.p0_implementation_snapshots (
    snapshot_id uuid primary key default gen_random_uuid(),
    implementation_version text not null unique,
    implementation_hash text not null unique,
    artifact_type text not null,
    research_artifact_id text not null,
    research_artifact_hash text not null,
    coverage_index_version text not null,
    as_of timestamptz not null,
    parent_claim_count integer not null,
    derived_rule_count integer not null,
    fact_count integer not null,
    snapshot_payload jsonb not null,
    created_at timestamptz not null default now(),
    check (implementation_version ~ '^p0-[a-z0-9][a-z0-9._-]{0,95}\.implementation\.v[0-9]+(\.[0-9]+)*$'),
    check (artifact_type = 'p0_point_rules_implementation'),
    check (research_artifact_id ~ '^p0-[a-z0-9][a-z0-9._-]{0,95}\.research\.v[0-9]+(\.[0-9]+)*$'),
    check (coverage_index_version ~ '^p0-coverage-index\.v[0-9]+(\.[0-9]+)*$'),
    check (implementation_hash ~ '^sha256:[0-9a-f]{64}$'),
    check (research_artifact_hash ~ '^sha256:[0-9a-f]{64}$'),
    check (parent_claim_count between 1 and 512),
    check (derived_rule_count between 0 and 512),
    check (fact_count between 0 and 512),
    check (jsonb_typeof(snapshot_payload) = 'object')
);

create table app_private.p0_implementation_facts (
    fact_id uuid primary key default gen_random_uuid(),
    snapshot_id uuid not null
        references app_private.p0_implementation_snapshots(snapshot_id)
        on delete restrict,
    implementation_version text not null,
    implementation_hash text not null,
    fact_version integer not null default 1 check (fact_version > 0 and fact_version < 1000),
    parent_claim_id text not null,
    family_id text not null,
    source_role_id text not null,
    source_ids jsonb not null,
    source_identity jsonb not null,
    claim_type text not null,
    subject text not null,
    predicate text not null,
    value jsonb not null,
    applicability jsonb not null,
    exclusions jsonb not null,
    evidence_locator text not null,
    short_paraphrase text not null,
    disposition text not null check (disposition in ('catalogue_fact','engine_rule')),
    derived_rule_ids jsonb not null,
    reason text,
    reason_detail text,
    candidate_id uuid,
    candidate_hash text,
    definition_hash text,
    fact_payload jsonb not null,
    created_at timestamptz not null default now(),
    unique (implementation_hash, parent_claim_id, fact_version),
    check (implementation_version ~ '^p0-[a-z0-9][a-z0-9._-]{0,95}\.implementation\.v[0-9]+(\.[0-9]+)*$'),
    check (implementation_hash ~ '^sha256:[0-9a-f]{64}$'),
    check (length(btrim(parent_claim_id)) > 0 and length(parent_claim_id) <= 256),
    check (length(btrim(family_id)) > 0 and length(family_id) <= 128),
    check (length(btrim(source_role_id)) > 0 and length(source_role_id) <= 128),
    check (jsonb_typeof(source_ids) = 'array'),
    check (jsonb_typeof(source_identity) = 'array'),
    check (jsonb_typeof(value) in ('object', 'array', 'string', 'number', 'boolean')),
    check (jsonb_typeof(applicability) = 'object'),
    check (jsonb_typeof(exclusions) = 'array'),
    check (jsonb_typeof(derived_rule_ids) = 'array'),
    check (candidate_hash is null or candidate_hash ~ '^sha256:[0-9a-f]{64}$'),
    check (definition_hash is null or definition_hash ~ '^sha256:[0-9a-f]{64}$'),
    check (candidate_id is null or candidate_hash is not null),
    check (char_length(subject) between 1 and 4096),
    check (char_length(predicate) between 1 and 512),
    check (char_length(claim_type) between 1 and 256),
    check (char_length(evidence_locator) between 1 and 4096),
    check (char_length(short_paraphrase) between 1 and 4096),
    check (pg_column_size(fact_payload) <= 262144)
);

create table app_private.p0_implementation_fact_corrections (
    correction_id text primary key,
    fact_id uuid not null
        references app_private.p0_implementation_facts(fact_id)
        on delete restrict,
    snapshot_id uuid not null
        references app_private.p0_implementation_snapshots(snapshot_id)
        on delete restrict,
    implementation_version text not null,
    implementation_hash text not null,
    parent_claim_id text not null,
    fact_version integer not null,
    reason text not null,
    correction_payload jsonb not null,
    created_at timestamptz not null default now(),
    unique (implementation_hash, parent_claim_id, fact_version, correction_id),
    check (correction_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$'),
    check (implementation_version ~ '^p0-[a-z0-9][a-z0-9._-]{0,95}\.implementation\.v[0-9]+(\.[0-9]+)*$'),
    check (implementation_hash ~ '^sha256:[0-9a-f]{64}$'),
    check (fact_version > 0 and fact_version < 1000),
    check (length(btrim(parent_claim_id)) > 0),
    check (char_length(reason) between 1 and 1024 and reason !~ '[\r\n]'),
    check (jsonb_typeof(correction_payload) = 'object')
);

create index p0_implementation_facts_search_idx
    on app_private.p0_implementation_facts
       (implementation_version, family_id, source_role_id, claim_type, parent_claim_id);
create index p0_implementation_facts_parent_idx
    on app_private.p0_implementation_facts (parent_claim_id, implementation_hash, fact_version);
create index p0_implementation_corrections_fact_idx
    on app_private.p0_implementation_fact_corrections
       (implementation_hash, parent_claim_id, fact_version);

create or replace function app_private.protect_p0_implementation_append_only()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
    v_context text := coalesce(current_setting('app_private.p0_implementation_write_context', true), '');
begin
    if tg_op = 'TRUNCATE' then
        raise exception 'P0 implementation tables cannot be truncated'
            using errcode = '55000';
    end if;
    if tg_op <> 'INSERT' then
        raise exception 'P0 implementation tables are append-only'
            using errcode = '55000';
    end if;
    if (tg_table_name in ('p0_implementation_snapshots','p0_implementation_facts')
        and v_context <> 'snapshot')
       or (tg_table_name = 'p0_implementation_fact_corrections'
           and v_context <> 'correction')
       or (tg_table_name = 'p0_implementation_coverage_refs'
           and v_context <> 'seed') then
        raise exception 'P0 implementation rows are DB-owned'
            using errcode = '55000';
    end if;
    return new;
end;
$$;

create trigger p0_implementation_snapshots_append_only
before insert or update or delete on app_private.p0_implementation_snapshots
for each row execute function app_private.protect_p0_implementation_append_only();
create trigger p0_implementation_snapshots_no_truncate
before truncate on app_private.p0_implementation_snapshots
for each statement execute function app_private.protect_p0_implementation_append_only();
create trigger p0_implementation_facts_append_only
before insert or update or delete on app_private.p0_implementation_facts
for each row execute function app_private.protect_p0_implementation_append_only();
create trigger p0_implementation_facts_no_truncate
before truncate on app_private.p0_implementation_facts
for each statement execute function app_private.protect_p0_implementation_append_only();
create trigger p0_implementation_corrections_append_only
before insert or update or delete on app_private.p0_implementation_fact_corrections
for each row execute function app_private.protect_p0_implementation_append_only();
create trigger p0_implementation_corrections_no_truncate
before truncate on app_private.p0_implementation_fact_corrections
for each statement execute function app_private.protect_p0_implementation_append_only();
create trigger p0_implementation_coverage_append_only
before insert or update or delete on app_private.p0_implementation_coverage_refs
for each row execute function app_private.protect_p0_implementation_append_only();
create trigger p0_implementation_coverage_no_truncate
before truncate on app_private.p0_implementation_coverage_refs
for each statement execute function app_private.protect_p0_implementation_append_only();

create or replace function app_private.p0_implementation_hash_shape(p_value text)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
    select p_value is not null and p_value ~ '^sha256:[0-9a-f]{64}$'
$$;

create or replace function app_private.p0_implementation_safe_text(
    p_value text,
    p_max integer
)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
    select p_value is not null
       and char_length(p_value) between 1 and p_max
       and p_value !~ '[\r\n]'
       and p_value !~* '(password|passwd|secret|api[ _-]?key|access[ _-]?token|bearer|private[ _-]?key|cvv|cvc)'
       and p_value !~* '(^|[^a-z0-9])pan([^a-z0-9]|$)'
$$;

create or replace function app_private.persist_p0_implementation_snapshot(
    p_snapshot jsonb
)
returns table (
    snapshot_id uuid,
    outcome text,
    fact_count integer,
    derived_rule_count integer
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
    v_existing app_private.p0_implementation_snapshots%rowtype;
    v_snapshot_id uuid;
    v_version text;
    v_implementation_hash text;
    v_research_hash text;
    v_coverage_version text;
    v_parent_claim_count integer;
    v_derived_rule_count integer;
    v_fact_count integer;
    v_entries jsonb;
    v_issues jsonb;
    v_entry jsonb;
    v_issue jsonb;
    v_identity jsonb;
    v_roles jsonb;
    v_source_ids jsonb;
    v_item jsonb;
    v_previous_claim text;
    v_previous_source text;
    v_previous_role text;
    v_previous_issue text;
    v_claim_id text;
    v_issue_claim_id text;
    v_seen_claims text[] := array[]::text[];
    v_seen_issue_claims text[] := array[]::text[];
    v_reason text;
    v_role text;
    v_source_id text;
    v_index integer;
begin
    if p_snapshot is null
       or jsonb_typeof(p_snapshot) is distinct from 'object'
       or not (p_snapshot ?& array[
           'version','artifact_type','research_artifact_id','research_artifact_hash',
           'coverage_index_version','as_of','parent_claim_count','derived_rule_count',
           'entries','derived_rules','issues','implementation_hash'
       ])
       or exists (
           select 1 from jsonb_object_keys(p_snapshot) as key(name)
            where key.name not in (
                'version','artifact_type','research_artifact_id','research_artifact_hash',
                'coverage_index_version','as_of','parent_claim_count','derived_rule_count',
                'entries','derived_rules','issues','implementation_hash'
            )
       )
    then
        raise exception 'P0 implementation snapshot envelope is invalid'
            using errcode = '22023';
    end if;

    v_version := p_snapshot->>'version';
    v_implementation_hash := p_snapshot->>'implementation_hash';
    v_research_hash := p_snapshot->>'research_artifact_hash';
    v_coverage_version := p_snapshot->>'coverage_index_version';
    if v_version !~ '^p0-[a-z0-9][a-z0-9._-]{0,95}\.implementation\.v[0-9]+(\.[0-9]+)*$'
       or p_snapshot->>'artifact_type' is distinct from 'p0_point_rules_implementation'
       or p_snapshot->>'research_artifact_id' !~ '^p0-[a-z0-9][a-z0-9._-]{0,95}\.research\.v[0-9]+(\.[0-9]+)*$'
       or v_coverage_version !~ '^p0-coverage-index\.v[0-9]+(\.[0-9]+)*$'
       or not app_private.p0_implementation_hash_shape(v_implementation_hash)
       or not app_private.p0_implementation_hash_shape(v_research_hash)
       or jsonb_typeof(p_snapshot->'as_of') is distinct from 'string'
       or jsonb_typeof(p_snapshot->'parent_claim_count') is distinct from 'number'
       or jsonb_typeof(p_snapshot->'derived_rule_count') is distinct from 'number'
       or jsonb_typeof(p_snapshot->'entries') is distinct from 'array'
       or jsonb_typeof(p_snapshot->'derived_rules') is distinct from 'array'
       or jsonb_typeof(p_snapshot->'issues') is distinct from 'array'
    then
        raise exception 'P0 implementation snapshot identity or counts are invalid'
            using errcode = '22023';
    end if;
    begin
        v_parent_claim_count := (p_snapshot->>'parent_claim_count')::integer;
        v_derived_rule_count := (p_snapshot->>'derived_rule_count')::integer;
        v_fact_count := jsonb_array_length(p_snapshot->'entries');
    exception when others then
        raise exception 'P0 implementation snapshot counts are invalid'
            using errcode = '22023';
    end;
    -- This additive lane currently has no rule-link writer.  Reject a
    -- non-empty derived-rule section instead of silently dropping executable
    -- rules; a later migration can widen this contract with candidate links.
    if v_parent_claim_count not between 1 and 512
       or v_derived_rule_count not between 0 and 512
       or v_derived_rule_count <> 0
       or v_fact_count <> v_parent_claim_count
       or v_derived_rule_count <> jsonb_array_length(p_snapshot->'derived_rules')
       or v_fact_count <> jsonb_array_length(p_snapshot->'issues')
    then
        raise exception 'P0 implementation snapshot counts are inconsistent'
            using errcode = '22023';
    end if;
    perform (p_snapshot->>'as_of')::timestamptz;
    if pg_column_size(p_snapshot) > 16777216 then
        raise exception 'P0 implementation snapshot exceeds bounded size'
            using errcode = '22023';
    end if;
    v_entries := p_snapshot->'entries';

    -- Validate the complete fact array before taking the first write.  The
    -- source identity and coverage references are exact, not merely shaped.
    for v_entry in
        select item.value
          from jsonb_array_elements(v_entries) as item(value)
    loop
        if jsonb_typeof(v_entry) is distinct from 'object'
           or not (v_entry ?& array[
               'parent_claim_id','family_id','source_role_id','source_ids',
               'source_identity','claim_type','subject','predicate','value',
               'applicability','exclusions','evidence_locator','short_paraphrase',
               'disposition','derived_rule_ids','reason','reason_detail'
           ])
           or exists (
               select 1 from jsonb_object_keys(v_entry) as key(name)
                where key.name not in (
                    'parent_claim_id','family_id','source_role_id','source_ids',
                    'source_identity','claim_type','subject','predicate','value',
                    'applicability','exclusions','evidence_locator','short_paraphrase',
                    'disposition','derived_rule_ids','reason','reason_detail'
                )
           )
        then
            raise exception 'P0 implementation fact entry shape is invalid'
                using errcode = '22023';
        end if;
        v_claim_id := v_entry->>'parent_claim_id';
        if v_claim_id !~ '^claim\.[A-Za-z0-9._:-]{1,240}$'
           or v_previous_claim is not null and v_claim_id <= v_previous_claim
           or v_claim_id = any(v_seen_claims)
        then
            raise exception 'P0 implementation parent claim IDs must be unique and sorted'
                using errcode = '22023';
        end if;
        v_seen_claims := array_append(v_seen_claims, v_claim_id);
        v_previous_claim := v_claim_id;
        if not app_private.p0_implementation_safe_text(v_entry->>'family_id', 128)
           or not app_private.p0_implementation_safe_text(v_entry->>'source_role_id', 128)
           or not app_private.p0_implementation_safe_text(v_entry->>'claim_type', 256)
           or not app_private.p0_implementation_safe_text(v_entry->>'subject', 4096)
           or not app_private.p0_implementation_safe_text(v_entry->>'predicate', 512)
           or not app_private.p0_implementation_safe_text(v_entry->>'evidence_locator', 4096)
           or not app_private.p0_implementation_safe_text(v_entry->>'short_paraphrase', 4096)
           or v_entry->>'disposition' is distinct from 'catalogue_fact'
           or (v_entry->>'reason' is distinct from 'non_calculable_fact'
               and v_entry->>'reason' is distinct from 'insufficient_operation_mapping'
               and v_entry->>'reason' is distinct from 'unsupported_calculation_model'
               and v_entry->>'reason' is distinct from 'ended_or_future_inactive'
               and v_entry->>'reason' is distinct from 'explicit_no_rate')
           or not app_private.p0_implementation_safe_text(v_entry->>'reason_detail', 4096)
           or jsonb_typeof(v_entry->'value') not in ('object', 'array', 'string', 'number', 'boolean')
           or jsonb_typeof(v_entry->'applicability') is distinct from 'object'
           or jsonb_typeof(v_entry->'exclusions') is distinct from 'array'
           or jsonb_typeof(v_entry->'derived_rule_ids') is distinct from 'array'
           or jsonb_array_length(v_entry->'derived_rule_ids') <> 0
           or pg_column_size(v_entry) > 262144
        then
            raise exception 'P0 implementation fact entry fields are invalid'
                using errcode = '22023';
        end if;

        v_source_ids := v_entry->'source_ids';
        if jsonb_typeof(v_source_ids) is distinct from 'array'
           or jsonb_array_length(v_source_ids) = 0
        then
            raise exception 'P0 implementation source IDs are invalid'
                using errcode = '22023';
        end if;
        v_previous_source := null;
        for v_item in
            select item.value
              from jsonb_array_elements(v_source_ids) as item(value)
        loop
            v_source_id := v_item #>> '{}';
            if jsonb_typeof(v_item) is distinct from 'string'
               or not app_private.p0_implementation_safe_text(v_source_id, 256)
               or v_previous_source is not null and v_source_id <= v_previous_source
            then
                raise exception 'P0 implementation source IDs must be unique and sorted'
                    using errcode = '22023';
            end if;
            v_previous_source := v_source_id;
            if not exists (
                select 1 from app_private.p0_implementation_coverage_refs as ref
                 where ref.coverage_index_version = v_coverage_version
                   and ref.family_id = v_entry->>'family_id'
                   and ref.source_role_id = v_entry->>'source_role_id'
                   and ref.source_id = v_source_id
            ) then
                raise exception 'P0 implementation source is absent from coverage index'
                    using errcode = '22023';
            end if;
        end loop;

        v_identity := v_entry->'source_identity';
        if jsonb_typeof(v_identity) is distinct from 'array'
           or jsonb_array_length(v_identity) <> jsonb_array_length(v_source_ids)
        then
            raise exception 'P0 implementation source identity is invalid'
                using errcode = '22023';
        end if;
        v_index := 0;
        for v_item in
            select item.value
              from jsonb_array_elements(v_identity) as item(value)
        loop
            if jsonb_typeof(v_item) is distinct from 'object'
               or not (v_item ?& array['source_id','family_id','roles','url','publisher','official_domain'])
               or exists (
                   select 1 from jsonb_object_keys(v_item) as key(name)
                    where key.name not in ('source_id','family_id','roles','url','publisher','official_domain')
               )
               or v_item->>'source_id' is distinct from v_source_ids->>v_index
               or v_item->>'family_id' is distinct from v_entry->>'family_id'
               or not app_private.p0_implementation_safe_text(v_item->>'publisher', 512)
               or not app_private.p0_implementation_safe_text(v_item->>'official_domain', 512)
               or v_item->>'url' is null
               or char_length(v_item->>'url') not between 1 and 2048
               or (v_item->>'url') !~ '^https?://[^[:space:]]+$'
               or jsonb_typeof(v_item->'roles') is distinct from 'array'
               or jsonb_array_length(v_item->'roles') = 0
        then
            raise exception 'P0 implementation source identity shape is invalid'
                using errcode = '22023';
        end if;
            v_roles := v_item->'roles';
            if exists (
                select 1 from jsonb_array_elements(v_roles) as role(value)
                 where jsonb_typeof(role.value) is distinct from 'string'
            ) then
                raise exception 'P0 implementation source identity roles are invalid'
                    using errcode = '22023';
            end if;
            v_previous_role := null;
            for v_role in
                select role.value
                  from jsonb_array_elements_text(v_roles) as role(value)
            loop
                if not app_private.p0_implementation_safe_text(v_role, 128)
                   or v_previous_role is not null and v_role <= v_previous_role
                then
                    raise exception 'P0 implementation source identity roles must be unique and sorted'
                        using errcode = '22023';
                end if;
                v_previous_role := v_role;
            end loop;
            if not exists (
                select 1 from jsonb_array_elements_text(v_roles) as role(value)
                 where role.value = v_entry->>'source_role_id'
            ) then
                raise exception 'P0 implementation source identity role mismatch'
                    using errcode = '22023';
            end if;
            v_index := v_index + 1;
        end loop;
    end loop;

    -- The issue ledger must be one exact, sorted explanation for every fact.
    v_previous_issue := null;
    for v_issue in
        select item.value
          from jsonb_array_elements(p_snapshot->'issues') as item(value)
    loop
        if jsonb_typeof(v_issue) is distinct from 'object'
           or not (v_issue ?& array['code','path','message','claim_id','reason'])
           or exists (
               select 1 from jsonb_object_keys(v_issue) as key(name)
                where key.name not in ('code','path','message','claim_id','reason')
           )
           or v_issue->>'code' is distinct from 'catalogue_fact'
           or v_issue->>'path' !~ '^/claims/claim\.[A-Za-z0-9._:-]{1,240}$'
           or not app_private.p0_implementation_safe_text(v_issue->>'message', 4096)
           or v_issue->>'claim_id' is distinct from regexp_replace(v_issue->>'path', '^/claims/', '')
           or v_issue->>'claim_id' = any(v_seen_issue_claims)
           or not (v_issue->>'claim_id' = any(v_seen_claims))
        then
            raise exception 'P0 implementation issue ledger is invalid'
                using errcode = '22023';
        end if;
        v_issue_claim_id := v_issue->>'claim_id';
        if v_previous_issue is not null and v_issue_claim_id <= v_previous_issue then
            raise exception 'P0 implementation issues must be sorted'
                using errcode = '22023';
        end if;
        v_previous_issue := v_issue_claim_id;
        v_seen_issue_claims := array_append(v_seen_issue_claims, v_issue_claim_id);
        select entry.value->>'reason' into v_reason
          from jsonb_array_elements(p_snapshot->'entries') as entry(value)
         where entry.value->>'parent_claim_id' = v_issue_claim_id;
        if v_issue->>'reason' is distinct from v_reason
           or v_issue->>'message' is distinct from (
               select entry.value->>'reason_detail'
                 from jsonb_array_elements(p_snapshot->'entries') as entry(value)
                where entry.value->>'parent_claim_id' = v_issue_claim_id
           )
        then
            raise exception 'P0 implementation issue does not bind its fact'
                using errcode = '22023';
        end if;
    end loop;
    if cardinality(v_seen_issue_claims) <> cardinality(v_seen_claims) then
        raise exception 'P0 implementation issue count does not match facts'
            using errcode = '22023';
    end if;

    perform pg_advisory_xact_lock(hashtextextended(v_version, 0));
    select * into v_existing
      from app_private.p0_implementation_snapshots as snapshot
     where snapshot.implementation_version = v_version
     for update;
    if found then
        if v_existing.implementation_hash = v_implementation_hash
           and v_existing.snapshot_payload is not distinct from p_snapshot
        then
            return query select v_existing.snapshot_id, 'duplicate'::text,
                v_existing.fact_count, v_existing.derived_rule_count;
            return;
        end if;
        raise exception 'P0 implementation version was reused with different content'
            using errcode = '55000';
    end if;
    if exists (
        select 1 from app_private.p0_implementation_snapshots as snapshot
         where snapshot.implementation_hash = v_implementation_hash
    ) then
        raise exception 'P0 implementation hash was reused with different content'
            using errcode = '55000';
    end if;

    perform set_config('app_private.p0_implementation_write_context', 'snapshot', true);
    insert into app_private.p0_implementation_snapshots (
        implementation_version, implementation_hash, artifact_type,
        research_artifact_id, research_artifact_hash, coverage_index_version,
        as_of, parent_claim_count, derived_rule_count, fact_count, snapshot_payload
    ) values (
        v_version, v_implementation_hash, p_snapshot->>'artifact_type',
        p_snapshot->>'research_artifact_id', v_research_hash,
        p_snapshot->>'coverage_index_version', (p_snapshot->>'as_of')::timestamptz,
        v_parent_claim_count,
        v_derived_rule_count,
        v_fact_count, p_snapshot
    ) returning p0_implementation_snapshots.snapshot_id into v_snapshot_id;

    for v_entry in
        select item.value
          from jsonb_array_elements(p_snapshot->'entries') as item(value)
    loop
        insert into app_private.p0_implementation_facts (
            snapshot_id, implementation_version, implementation_hash, fact_version,
            parent_claim_id, family_id, source_role_id, source_ids, source_identity,
            claim_type, subject, predicate, value, applicability, exclusions,
            evidence_locator, short_paraphrase, disposition, derived_rule_ids,
            reason, reason_detail, fact_payload
        ) values (
            v_snapshot_id, v_version, v_implementation_hash, 1,
            v_entry->>'parent_claim_id', v_entry->>'family_id', v_entry->>'source_role_id',
            v_entry->'source_ids', v_entry->'source_identity', v_entry->>'claim_type',
            v_entry->>'subject', v_entry->>'predicate', v_entry->'value',
            v_entry->'applicability', v_entry->'exclusions', v_entry->>'evidence_locator',
            v_entry->>'short_paraphrase', v_entry->>'disposition', v_entry->'derived_rule_ids',
            v_entry->>'reason', v_entry->>'reason_detail', v_entry
        );
    end loop;
    perform set_config('app_private.p0_implementation_write_context', '', true);
    return query select v_snapshot_id, 'inserted'::text, v_fact_count, v_derived_rule_count;
exception when others then
    perform set_config('app_private.p0_implementation_write_context', '', true);
    raise;
end;
$$;

create or replace function app_private.record_p0_implementation_fact_correction(
    p_parent_claim_id text,
    p_implementation_version text,
    p_implementation_hash text,
    p_fact_version integer,
    p_correction_id text,
    p_reason text
)
returns table (
    outcome text,
    fact_id uuid
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
    v_fact app_private.p0_implementation_facts%rowtype;
    v_existing app_private.p0_implementation_fact_corrections%rowtype;
    v_payload jsonb;
begin
    if p_parent_claim_id is null
       or p_parent_claim_id !~ '^claim\.[A-Za-z0-9._:-]{1,240}$'
       or p_implementation_version !~ '^p0-[a-z0-9][a-z0-9._-]{0,95}\.implementation\.v[0-9]+(\.[0-9]+)*$'
       or not app_private.p0_implementation_hash_shape(p_implementation_hash)
       or p_fact_version is null or p_fact_version < 1 or p_fact_version >= 1000
       or p_correction_id is null or p_correction_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$'
       or not app_private.p0_implementation_safe_text(p_reason, 1024)
    then
        raise exception 'P0 implementation correction identity is invalid'
            using errcode = '22023';
    end if;

    perform pg_advisory_xact_lock(hashtextextended(
        p_implementation_hash || ':' || p_parent_claim_id || ':' || p_fact_version::text, 0
    ));
    select * into v_fact
      from app_private.p0_implementation_facts as fact
     where fact.parent_claim_id = p_parent_claim_id
       and fact.implementation_version = p_implementation_version
       and fact.implementation_hash = p_implementation_hash
       and fact.fact_version = p_fact_version
     for update;
    if not found then
        raise exception 'P0 implementation fact identity was not found'
            using errcode = '23503';
    end if;
    v_payload := jsonb_build_object(
        'parent_claim_id', p_parent_claim_id,
        'implementation_version', p_implementation_version,
        'implementation_hash', p_implementation_hash,
        'fact_version', p_fact_version,
        'correction_id', p_correction_id,
        'reason', p_reason
    );
    select * into v_existing
      from app_private.p0_implementation_fact_corrections as correction
     where correction.correction_id = p_correction_id
     for update;
    if found then
        if v_existing.fact_id = v_fact.fact_id
           and v_existing.snapshot_id = v_fact.snapshot_id
           and v_existing.implementation_hash = p_implementation_hash
           and v_existing.parent_claim_id = p_parent_claim_id
           and v_existing.fact_version = p_fact_version
           and v_existing.reason = p_reason
        then
            return query select 'duplicate'::text, v_fact.fact_id;
            return;
        end if;
        raise exception 'P0 implementation correction ID was reused with different content'
            using errcode = '55000';
    end if;
    perform set_config('app_private.p0_implementation_write_context', 'correction', true);
    insert into app_private.p0_implementation_fact_corrections (
        correction_id, fact_id, snapshot_id, implementation_version,
        implementation_hash, parent_claim_id, fact_version, reason, correction_payload
    ) values (
        p_correction_id, v_fact.fact_id, v_fact.snapshot_id, p_implementation_version,
        p_implementation_hash, p_parent_claim_id, p_fact_version, p_reason, v_payload
    );
    perform set_config('app_private.p0_implementation_write_context', '', true);
    return query select 'recorded'::text, v_fact.fact_id;
exception when others then
    perform set_config('app_private.p0_implementation_write_context', '', true);
    raise;
end;
$$;

create or replace function app_private.record_p0_implementation_fact_correction_by_id(
    p_fact_id uuid,
    p_correction_id text,
    p_reason text
)
returns table (
    outcome text,
    fact_id uuid
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
    v_fact app_private.p0_implementation_facts%rowtype;
begin
    if p_fact_id is null then
        raise exception 'P0 implementation fact key is invalid'
            using errcode = '22023';
    end if;
    select * into v_fact
      from app_private.p0_implementation_facts as fact
     where fact.fact_id = p_fact_id
     for update;
    if not found then
        raise exception 'P0 implementation fact key was not found'
            using errcode = '23503';
    end if;
    return query
      select correction.outcome, correction.fact_id
        from app_private.record_p0_implementation_fact_correction(
            v_fact.parent_claim_id,
            v_fact.implementation_version,
            v_fact.implementation_hash,
            v_fact.fact_version,
            p_correction_id,
            p_reason
        ) as correction;
end;
$$;

create or replace function app_private.p0_active_implementation_fact_rows()
returns table (
    fact_id uuid,
    implementation_version text,
    fact_version integer,
    family_id text,
    source_role_id text,
    source_ids jsonb,
    claim_type text,
    subject text,
    predicate text,
    short_paraphrase text,
    disposition text,
    reason text,
    reason_detail text
)
language sql
security definer
set search_path = pg_catalog
as $$
    select
        fact.fact_id,
        fact.implementation_version,
        fact.fact_version,
        fact.family_id,
        fact.source_role_id,
        fact.source_ids,
        fact.claim_type,
        fact.subject,
        fact.predicate,
        fact.short_paraphrase,
        fact.disposition,
        fact.reason,
        fact.reason_detail
      from app_private.p0_implementation_facts as fact
     where not exists (
         select 1
           from app_private.p0_implementation_fact_corrections as correction
          where correction.fact_id = fact.fact_id
            and correction.implementation_hash = fact.implementation_hash
            and correction.parent_claim_id = fact.parent_claim_id
            and correction.fact_version = fact.fact_version
     )
$$;

create view app_api.p0_active_implementation_facts
with (security_invoker = true, security_barrier = true) as
select * from app_private.p0_active_implementation_fact_rows();

create view app_api.p0_implementation_catalogue
with (security_invoker = true, security_barrier = true) as
select * from app_api.p0_active_implementation_facts;

comment on table app_private.p0_implementation_snapshots is
    'Immutable machine-checked P0 implementation receipts; hashes are validated representations supplied by TypeScript.';
comment on table app_private.p0_implementation_facts is
    'Immutable bounded implementation facts; nullable candidate links are reserved for future derived rules.';
comment on view app_api.p0_active_implementation_facts is
    'Correction-sensitive invoker/barrier projection of generic implementation facts; never canonical reward truth.';
comment on function app_private.persist_p0_implementation_snapshot(jsonb) is
    'Atomically validates and persists one exact P0 implementation snapshot; PostgreSQL does not recompute TS canonical hashes.';

revoke all on app_private.p0_implementation_coverage_refs from public;
revoke all on app_private.p0_implementation_snapshots from public;
revoke all on app_private.p0_implementation_facts from public;
revoke all on app_private.p0_implementation_fact_corrections from public;
revoke all on app_api.p0_active_implementation_facts from public;
revoke all on app_api.p0_implementation_catalogue from public;
revoke execute on function app_private.persist_p0_implementation_snapshot(jsonb) from public;
revoke execute on function app_private.record_p0_implementation_fact_correction(text,text,text,integer,text,text) from public;
revoke execute on function app_private.record_p0_implementation_fact_correction_by_id(uuid,text,text) from public;
revoke execute on function app_private.p0_active_implementation_fact_rows() from public;
revoke execute on function app_private.protect_p0_implementation_append_only() from public;
revoke execute on function app_private.p0_implementation_hash_shape(text) from public;
revoke execute on function app_private.p0_implementation_safe_text(text,integer) from public;

commit;
