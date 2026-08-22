-- Staged from db/0001_core_schema.sql; edit the canonical source, not this file.
-- Japan Rewards Optimizer foundation schema v0.3
-- Target: PostgreSQL 15+ / Supabase-compatible Postgres
-- Fresh-install baseline. See V0_1_TO_V0_2_MIGRATION_NOTES.md for the breaking model changes.
-- This migration stores no PAN, CVV, PIN, banking password, dynamic payment QR secret,
-- or copied issuer authentication credential.

begin;

create extension if not exists pgcrypto;
create extension if not exists citext;
create extension if not exists btree_gist;

create schema if not exists app_private;
create schema if not exists app_api;
create schema if not exists user_data;

revoke all on schema app_private from public;
revoke all on schema app_api from public;
revoke all on schema user_data from public;
revoke create on schema public from public;

-- New objects created by the migration owner remain deny-by-default.
alter default privileges in schema app_private revoke all on tables from public;
alter default privileges in schema app_private revoke all on sequences from public;
alter default privileges in schema app_api revoke all on tables from public;
alter default privileges in schema app_api revoke all on sequences from public;
alter default privileges in schema user_data revoke all on tables from public;
alter default privileges in schema user_data revoke all on sequences from public;
alter default privileges in schema app_private revoke execute on functions from public;
alter default privileges in schema app_api revoke execute on functions from public;
alter default privileges in schema user_data revoke execute on functions from public;

-- ----------
-- Helpers
-- ----------

create or replace function app_private.set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at := now();
    return new;
end;
$$;

create or replace function app_private.reject_update_or_delete()
returns trigger
language plpgsql
as $$
begin
    raise exception '% is append-only/immutable after insert', tg_table_name
        using errcode = '55000';
end;
$$;

create or replace function app_private.protect_reward_rule_version()
returns trigger
language plpgsql
as $$
begin
    if tg_op = 'DELETE' then
        raise exception 'reward_rule_versions cannot be deleted'
            using errcode = '55000';
    end if;

    -- Draft and under-review rows may be edited. Once approved, the definition,
    -- evidence-relevant fields, and economic interval are frozen. The only allowed
    -- mutation is closing system validity by setting superseded_at exactly once.
    if old.review_status = 'approved' then
        if old.superseded_at is null
           and new.superseded_at is not null
           and (to_jsonb(new) - 'superseded_at') = (to_jsonb(old) - 'superseded_at') then
            return new;
        end if;
        raise exception 'approved reward rule versions are immutable; use a new version and close superseded_at'
            using errcode = '55000';
    end if;

    return new;
end;
$$;

-- ----------
-- Authority, access, and evidence
-- ----------

create table app_private.trusted_sources (
    id uuid primary key default gen_random_uuid(),
    source_key text not null unique check (source_key ~ '^[a-z0-9][a-z0-9._-]+$'),
    name text not null,
    publisher text not null,
    category text not null,
    tier text not null check (tier in (
        'T0_REGULATOR','T1_CANONICAL','T2_OFFICIAL_SUPPORT','T3_PARTNER_CONTRACT','T4_DISCOVERY_ONLY'
    )),
    publication_use text not null check (publication_use in ('canonical','corroborating','discovery_only')),
    source_url text not null,
    authority_scope jsonb not null check (jsonb_typeof(authority_scope) = 'array'),
    locale text not null,
    geography text not null,
    evidence_format text not null,
    volatility text not null check (volatility in ('low','medium','high','very_high')),
    recommended_check_cadence text not null,
    retrieval_method text not null,
    requires_login boolean not null default false,
    automation_status text not null,
    terms_review_status text not null check (terms_review_status in (
        'not_reviewed','approved','restricted','prohibited','not_applicable'
    )),
    technical_feasibility text not null default 'unknown' check (technical_feasibility in (
        'unknown','plain_http_observed_reachable','plain_http_observed_blocked_or_unavailable',
        'environment_dependent_or_mixed','rendering_or_session_likely','manual_capture_candidate',
        'partner_feed_candidate','temporarily_unavailable'
    )),
    url_registered_on date not null,
    content_verified_on date,
    verification_status text not null check (verification_status in (
        'registered','content_verified','temporarily_unavailable','retired','unverified'
    )),
    notes text not null default '',
    registry_payload jsonb not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index trusted_sources_tier_category_idx
    on app_private.trusted_sources (tier, category);
create index trusted_sources_terms_feasibility_idx
    on app_private.trusted_sources (terms_review_status, technical_feasibility, automation_status);

create trigger trusted_sources_set_updated_at
before update on app_private.trusted_sources
for each row execute function app_private.set_updated_at();

create table app_private.source_access_observations (
    id uuid primary key default gen_random_uuid(),
    observation_key text not null unique check (observation_key ~ '^sao_[a-z0-9_-]+$'),
    observed_at timestamptz not null,
    observer text not null,
    environment text not null,
    method text not null check (method in (
        'plain_http','browser_session','official_api','manual_browser','partner_feed','aggregate_external_review'
    )),
    scope text not null check (scope in ('single_source','source_group','registry')),
    result text not null check (result in (
        'reachable','forbidden','unavailable','timeout','login_required','requires_rendering',
        'blocked_or_unavailable','aggregate','unknown'
    )),
    http_status integer check (http_status is null or http_status between 100 and 599),
    summary_counts jsonb not null default '{}'::jsonb,
    notes text not null default '',
    evidence_reference text,
    created_at timestamptz not null default now()
);

create table app_private.source_access_observation_sources (
    observation_id uuid not null references app_private.source_access_observations(id) on delete restrict,
    source_id uuid not null references app_private.trusted_sources(id) on delete restrict,
    primary key (observation_id, source_id)
);

create table app_private.source_collection_policies (
    id uuid primary key default gen_random_uuid(),
    source_id uuid not null references app_private.trusted_sources(id) on delete restrict,
    version integer not null check (version >= 1),
    decision text not null check (decision in (
        'pending','approved_manual','approved_automated','restricted','prohibited','not_applicable'
    )),
    permitted_method text,
    request_rate jsonb,
    storage_policy jsonb,
    attribution_requirements text,
    redistribution_policy text,
    technical_preconditions jsonb not null default '{}'::jsonb,
    reviewed_by text,
    reviewed_at timestamptz,
    valid_from timestamptz not null default now(),
    valid_to timestamptz,
    recorded_at timestamptz not null default now(),
    superseded_at timestamptz,
    notes text not null default '',
    unique (source_id, version),
    check (valid_to is null or valid_to > valid_from),
    check (superseded_at is null or superseded_at > recorded_at),
    check (decision not in ('approved_manual','approved_automated') or reviewed_at is not null)
);

create unique index source_collection_policy_current_idx
    on app_private.source_collection_policies (source_id)
    where superseded_at is null;

create table app_private.source_snapshots (
    id uuid primary key default gen_random_uuid(),
    snapshot_key text not null unique check (snapshot_key ~ '^snap_[a-zA-Z0-9_-]+$'),
    source_id uuid not null references app_private.trusted_sources(id) on delete restrict,
    collection_policy_id uuid references app_private.source_collection_policies(id) on delete restrict,
    fetched_at timestamptz not null,
    requested_url text not null,
    effective_url text not null,
    http_status integer check (http_status is null or http_status between 100 and 599),
    content_type text,
    etag text,
    last_modified text,
    raw_content_hash text not null check (raw_content_hash ~ '^sha256:[0-9a-f]{64}$'),
    normalized_content_hash text check (
        normalized_content_hash is null or normalized_content_hash ~ '^sha256:[0-9a-f]{64}$'
    ),
    storage_uri text,
    acquisition_method text not null check (acquisition_method in (
        'official_api','partner_feed','permitted_http','permitted_browser','manual_capture','test_fixture'
    )),
    parser_version text,
    renderer_version text,
    capture_complete boolean not null default false,
    metadata jsonb not null default '{}'::jsonb,
    created_by text not null,
    created_at timestamptz not null default now(),
    unique (source_id, raw_content_hash, acquisition_method)
);

create index source_snapshots_source_time_idx
    on app_private.source_snapshots (source_id, fetched_at desc);

create trigger source_snapshots_immutable
before update or delete on app_private.source_snapshots
for each row execute function app_private.reject_update_or_delete();

create table app_private.source_check_runs (
    id uuid primary key default gen_random_uuid(),
    source_id uuid not null references app_private.trusted_sources(id) on delete restrict,
    collection_policy_id uuid references app_private.source_collection_policies(id) on delete restrict,
    access_observation_id uuid references app_private.source_access_observations(id) on delete set null,
    checked_at timestamptz not null,
    status text not null check (status in (
        'unchanged','new_snapshot','unavailable','relocated','blocked_by_policy',
        'blocked_technically','manual_capture_required','failed'
    )),
    observed_content_hash text check (
        observed_content_hash is null or observed_content_hash ~ '^sha256:[0-9a-f]{64}$'
    ),
    source_snapshot_id uuid references app_private.source_snapshots(id) on delete set null,
    http_status integer check (http_status is null or http_status between 100 and 599),
    error_code text,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create index source_check_runs_source_time_idx
    on app_private.source_check_runs (source_id, checked_at desc);

create table app_private.evidence_records (
    id uuid primary key default gen_random_uuid(),
    evidence_key text not null unique check (evidence_key ~ '^ev_[a-z0-9_-]+$'),
    source_snapshot_id uuid not null references app_private.source_snapshots(id) on delete restrict,
    locator jsonb not null,
    excerpt_text text,
    normalized_claim jsonb not null,
    supports jsonb not null check (jsonb_typeof(supports) = 'array'),
    economic_valid_from timestamptz,
    economic_valid_to timestamptz,
    status text not null check (status in ('draft','under_review','verified','rejected','superseded')),
    extraction_method text not null,
    extraction_model text,
    extraction_confidence numeric(6,5),
    review_mode text check (review_mode is null or review_mode in (
        'solo_dual_pass','agent_challenged','human_second_review','expert_review'
    )),
    required_review_modes text[] not null default '{}'::text[],
    completed_review_modes text[] not null default '{}'::text[],
    reviewed_by text,
    reviewed_at timestamptz,
    notes text not null default '',
    created_at timestamptz not null default now(),
    check (economic_valid_to is null or economic_valid_from is null or economic_valid_to > economic_valid_from),
    check (extraction_confidence is null or extraction_confidence between 0 and 1),
    check (status <> 'verified' or (
        review_mode is not null and reviewed_at is not null
        and cardinality(required_review_modes) > 0
        and required_review_modes <@ completed_review_modes
    ))
);

create index evidence_snapshot_idx on app_private.evidence_records (source_snapshot_id);
create index evidence_status_idx on app_private.evidence_records (status);

-- ----------
-- Canonical entities and assets
-- ----------

create table app_private.entities (
    id uuid primary key default gen_random_uuid(),
    entity_key text not null unique check (entity_key ~ '^[a-z0-9][a-z0-9._-]+$'),
    entity_type text not null check (entity_type in (
        'merchant','merchant_group','loyalty_program','credit_card','debit_card','prepaid_card',
        'qr_wallet','electronic_money','cashback_portal','airline_program','hotel_program',
        'campaign','payment_interface','stored_value_program','other'
    )),
    display_name text not null,
    legal_name text,
    locale text,
    metadata jsonb not null default '{}'::jsonb,
    status text not null default 'active' check (status in ('active','inactive','merged','retired')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create trigger entities_set_updated_at
before update on app_private.entities
for each row execute function app_private.set_updated_at();

create table app_private.entity_aliases (
    id uuid primary key default gen_random_uuid(),
    entity_id uuid not null references app_private.entities(id) on delete cascade,
    alias citext not null,
    locale text,
    alias_type text not null default 'name',
    source text
);

create unique index entity_alias_unique_idx
    on app_private.entity_aliases (entity_id, alias, coalesce(locale, ''));
create index entity_alias_lookup_idx on app_private.entity_aliases (alias);

create table app_private.merchant_locations (
    id uuid primary key default gen_random_uuid(),
    location_key text not null unique,
    merchant_entity_id uuid not null references app_private.entities(id) on delete restrict,
    parent_location_id uuid references app_private.merchant_locations(id) on delete set null,
    display_name text not null,
    address jsonb,
    latitude numeric(9,6),
    longitude numeric(9,6),
    external_place_ids jsonb not null default '{}'::jsonb,
    confidence text not null default 'unverified' check (confidence in (
        'verified','official_directory','third_party','unverified'
    )),
    valid_from timestamptz,
    valid_to timestamptz,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    check (valid_to is null or valid_from is null or valid_to > valid_from)
);

create trigger merchant_locations_set_updated_at
before update on app_private.merchant_locations
for each row execute function app_private.set_updated_at();

create table app_private.asset_definitions (
    id uuid primary key default gen_random_uuid(),
    asset_key text not null unique check (asset_key ~ '^[a-z0-9][a-z0-9._-]+$'),
    asset_kind text not null check (asset_kind in (
        'fiat','reward_point','airline_mile','hotel_point','cashback','stored_value',
        'voucher','discount','credit_limit','other'
    )),
    program_entity_id uuid references app_private.entities(id) on delete restrict,
    default_reward_class text check (default_reward_class is null or default_reward_class in (
        'normal','limited_period','usage_limited','merchant_limited','pending','promotional','other'
    )),
    display_name text not null,
    scale integer not null default 0 check (scale between 0 and 9),
    default_expiry_policy jsonb not null default '{}'::jsonb,
    default_usage_restrictions jsonb not null default '{}'::jsonb,
    metadata jsonb not null default '{}'::jsonb,
    status text not null default 'active' check (status in ('active','inactive','retired')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create trigger asset_definitions_set_updated_at
before update on app_private.asset_definitions
for each row execute function app_private.set_updated_at();

-- ----------
-- Rules, candidates, and review
-- ----------

create table app_private.reward_rules (
    id uuid primary key default gen_random_uuid(),
    rule_key text not null unique check (rule_key ~ '^rr_[a-z0-9_-]+$'),
    rule_type text not null,
    subject_entity_id uuid references app_private.entities(id) on delete restrict,
    name text not null,
    lifecycle_status text not null check (lifecycle_status in (
        'draft','under_review','published','superseded','retired','rejected'
    )),
    created_at timestamptz not null default now(),
    created_by text not null,
    updated_at timestamptz not null default now()
);

create trigger reward_rules_set_updated_at
before update on app_private.reward_rules
for each row execute function app_private.set_updated_at();

create table app_private.reward_rule_versions (
    id uuid primary key default gen_random_uuid(),
    rule_id uuid not null references app_private.reward_rules(id) on delete restrict,
    version integer not null check (version >= 1),
    definition jsonb not null,
    definition_hash text not null check (definition_hash ~ '^sha256:[0-9a-f]{64}$'),
    valid_from timestamptz not null,
    valid_to timestamptz,
    recorded_at timestamptz not null default now(),
    superseded_at timestamptz,
    review_status text not null check (review_status in ('draft','under_review','approved','rejected')),
    review_mode text check (review_mode is null or review_mode in (
        'solo_dual_pass','agent_challenged','human_second_review','expert_review'
    )),
    required_review_modes text[] not null default '{}'::text[],
    completed_review_modes text[] not null default '{}'::text[],
    reviewed_by text,
    reviewed_at timestamptz,
    change_reason text not null,
    created_by text not null,
    created_at timestamptz not null default now(),
    unique (rule_id, version),
    check (valid_to is null or valid_to > valid_from),
    check (superseded_at is null or superseded_at > recorded_at),
    check (review_status <> 'approved' or (
        review_mode is not null and reviewed_at is not null
        and cardinality(required_review_modes) > 0
        and required_review_modes <@ completed_review_modes
    ))
);

create index reward_rule_versions_economic_idx
    on app_private.reward_rule_versions (rule_id, valid_from, valid_to);
create index reward_rule_versions_recorded_idx
    on app_private.reward_rule_versions (rule_id, recorded_at, superseded_at);

-- definition_hash identifies canonicalized economic definition content only.
-- Reuse across distinct non-overlapping validity intervals is legitimate; it is
-- indexed for duplicate detection, not constrained as historical identity.
create index reward_rule_versions_definition_hash_idx
    on app_private.reward_rule_versions (rule_id, definition_hash);

-- For any (transaction_time, replay_knowledge_time) pair, at most one approved
-- version of a rule may match. Constraining only unsuperseded rows is insufficient:
-- backdated corrections can otherwise create historical replay ambiguity.
alter table app_private.reward_rule_versions
add constraint reward_rule_versions_no_bitemporal_overlap
exclude using gist (
    rule_id with =,
    tstzrange(valid_from, coalesce(valid_to, 'infinity'::timestamptz), '[)') with &&,
    tstzrange(recorded_at, coalesce(superseded_at, 'infinity'::timestamptz), '[)') with &&
)
where (review_status = 'approved');

create trigger reward_rule_versions_protect
before update or delete on app_private.reward_rule_versions
for each row execute function app_private.protect_reward_rule_version();

create table app_private.rule_publication_requests (
    id uuid primary key default gen_random_uuid(),
    rule_id uuid not null references app_private.reward_rules(id) on delete restrict,
    idempotency_key text not null,
    request_hash text not null check (request_hash ~ '^sha256:[0-9a-f]{64}$'),
    resulting_rule_version_id uuid references app_private.reward_rule_versions(id) on delete restrict,
    status text not null check (status in ('received','published','rejected','failed')),
    created_by text not null,
    created_at timestamptz not null default now(),
    completed_at timestamptz,
    unique (rule_id, idempotency_key),
    check (completed_at is null or completed_at >= created_at),
    check (status <> 'published' or resulting_rule_version_id is not null)
);

create table app_private.rule_evidence (
    rule_version_id uuid not null references app_private.reward_rule_versions(id) on delete restrict,
    evidence_id uuid not null references app_private.evidence_records(id) on delete restrict,
    supported_paths jsonb not null check (jsonb_typeof(supported_paths) = 'array'),
    created_at timestamptz not null default now(),
    primary key (rule_version_id, evidence_id)
);

create table app_private.extraction_candidates (
    id uuid primary key default gen_random_uuid(),
    candidate_key text not null unique check (candidate_key ~ '^xc_[a-z0-9_-]+$'),
    candidate_payload jsonb not null,
    schema_valid boolean not null default false,
    semantic_status text not null default 'pending' check (semantic_status in (
        'pending','valid','needs_evidence','conflict','security_flagged','rejected'
    )),
    security_flags jsonb not null default '[]'::jsonb check (jsonb_typeof(security_flags) = 'array'),
    extractor text not null,
    extractor_version text,
    created_at timestamptz not null default now(),
    created_by text not null
);

create table app_private.extraction_candidate_snapshots (
    extraction_candidate_id uuid not null references app_private.extraction_candidates(id) on delete restrict,
    source_snapshot_id uuid not null references app_private.source_snapshots(id) on delete restrict,
    source_role text not null default 'primary' check (source_role in ('primary','corroborating','conflict')),
    primary key (extraction_candidate_id, source_snapshot_id)
);

create table app_private.scenario_fixtures (
    id uuid primary key default gen_random_uuid(),
    scenario_key text not null,
    version integer not null check (version >= 1),
    title text not null,
    level text not null check (level in ('L1_SINGLE_RULE','L2_STACKING','L3_ADVERSARIAL')),
    status text not null check (status in (
        'planned','researched','calculated','reviewed','golden','superseded','retired'
    )),
    as_of timestamptz,
    replay_knowledge_at timestamptz,
    fixture_payload jsonb not null,
    fixture_hash text not null check (fixture_hash ~ '^sha256:[0-9a-f]{64}$'),
    calculated_by text,
    calculated_at timestamptz,
    review_mode text check (review_mode is null or review_mode in (
        'solo_dual_pass','agent_challenged','human_second_review','expert_review'
    )),
    required_review_modes text[] not null default '{}'::text[],
    completed_review_modes text[] not null default '{}'::text[],
    reviewed_by text,
    reviewed_at timestamptz,
    cooling_off_completed_at timestamptz,
    independent_calculation_artifact text,
    created_at timestamptz not null default now(),
    unique (scenario_key, version),
    unique (scenario_key, fixture_hash),
    check (status not in ('reviewed','golden') or (
        review_mode is not null and reviewed_at is not null
        and cardinality(required_review_modes) > 0
        and required_review_modes <@ completed_review_modes
    )),
    check (status <> 'golden' or (calculated_by is not null and calculated_at is not null))
);

create index scenario_fixtures_status_level_idx
    on app_private.scenario_fixtures (status, level);

create table app_private.scenario_evidence (
    scenario_fixture_id uuid not null references app_private.scenario_fixtures(id) on delete restrict,
    evidence_id uuid not null references app_private.evidence_records(id) on delete restrict,
    primary key (scenario_fixture_id, evidence_id)
);

create table app_private.scenario_rule_versions (
    scenario_fixture_id uuid not null references app_private.scenario_fixtures(id) on delete restrict,
    rule_version_id uuid not null references app_private.reward_rule_versions(id) on delete restrict,
    relation text not null check (relation in ('applied','rejected','candidate','boundary_source')),
    primary key (scenario_fixture_id, rule_version_id, relation)
);

create table app_private.review_items (
    id uuid primary key default gen_random_uuid(),
    review_type text not null check (review_type in (
        'source_terms','source_access','snapshot_change','evidence','rule','scenario',
        'correction','security','legal'
    )),
    subject_type text not null,
    subject_id uuid,
    external_subject_key text,
    priority text not null default 'normal' check (priority in ('low','normal','high','critical')),
    status text not null default 'open' check (status in (
        'open','in_review','needs_more_evidence','approved','rejected','closed'
    )),
    assigned_to text,
    payload jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    closed_at timestamptz
);

create trigger review_items_set_updated_at
before update on app_private.review_items
for each row execute function app_private.set_updated_at();

create table app_private.review_decisions (
    id uuid primary key default gen_random_uuid(),
    review_item_id uuid not null references app_private.review_items(id) on delete restrict,
    review_mode text not null check (review_mode in (
        'solo_dual_pass','agent_challenged','human_second_review','expert_review'
    )),
    decision text not null,
    rationale text not null,
    decided_by text not null,
    decided_at timestamptz not null default now(),
    evidence_refs jsonb not null default '[]'::jsonb
);

create trigger review_decisions_append_only
before update or delete on app_private.review_decisions
for each row execute function app_private.reject_update_or_delete();

-- Permanent replay data is restricted to synthetic fixtures, golden benchmarks,
-- or separately approved redacted incident records. User history lives elsewhere.
create table app_private.canonical_replay_runs (
    id uuid primary key default gen_random_uuid(),
    replay_key text not null unique,
    replay_class text not null check (replay_class in ('synthetic','golden_fixture','redacted_incident')),
    engine_version text not null,
    contracts_version text not null,
    request_hash text not null check (request_hash ~ '^sha256:[0-9a-f]{64}$'),
    request_payload jsonb not null,
    result_payload jsonb not null,
    result_hash text not null check (result_hash ~ '^sha256:[0-9a-f]{64}$'),
    transaction_time timestamptz not null,
    replay_knowledge_time timestamptz not null,
    valuation_profile_version text not null,
    contains_user_data boolean not null default false,
    created_at timestamptz not null default now(),
    check (contains_user_data = false)
);

create table app_private.canonical_replay_rule_versions (
    replay_run_id uuid not null references app_private.canonical_replay_runs(id) on delete restrict,
    rule_version_id uuid not null references app_private.reward_rule_versions(id) on delete restrict,
    disposition text not null check (disposition in ('applied','rejected','considered')),
    reason_codes jsonb not null default '[]'::jsonb,
    primary key (replay_run_id, rule_version_id, disposition)
);

-- ----------
-- User-owned state and retention
-- ----------

create table user_data.user_profiles (
    user_id uuid primary key,
    locale text not null default 'ja-JP',
    timezone text not null default 'Asia/Tokyo',
    preferences jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create trigger user_profiles_set_updated_at
before update on user_data.user_profiles
for each row execute function app_private.set_updated_at();

create table user_data.user_wallet_items (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references user_data.user_profiles(user_id) on delete cascade,
    public_product_entity_id uuid references app_private.entities(id) on delete restrict,
    item_type text not null check (item_type in (
        'credit_card','debit_card','prepaid_card','qr_wallet','electronic_money','loyalty_program','other'
    )),
    nickname text,
    optional_last_four text check (optional_last_four is null or optional_last_four ~ '^[0-9]{4}$'),
    settings jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index user_wallet_items_user_idx on user_data.user_wallet_items (user_id);
create trigger user_wallet_items_set_updated_at
before update on user_data.user_wallet_items
for each row execute function app_private.set_updated_at();

create table user_data.user_facts (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references user_data.user_profiles(user_id) on delete cascade,
    fact_key text not null,
    status text not null check (status in ('known','estimated','unknown','not_applicable')),
    value jsonb,
    lower_bound jsonb,
    upper_bound jsonb,
    observed_at timestamptz,
    source text not null check (source in (
        'user_input','transaction_history','provider_api','inferred','manual_review','unknown'
    )),
    confidence numeric(6,5) check (confidence is null or confidence between 0 and 1),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (user_id, fact_key),
    check (
        (status = 'known' and value is not null)
        or (status = 'estimated' and lower_bound is not null and upper_bound is not null)
        or status in ('unknown','not_applicable')
    )
);

create trigger user_facts_set_updated_at
before update on user_data.user_facts
for each row execute function app_private.set_updated_at();

create table user_data.user_asset_lots (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references user_data.user_profiles(user_id) on delete cascade,
    asset_definition_id uuid not null references app_private.asset_definitions(id) on delete restrict,
    reward_class text check (reward_class is null or reward_class in (
        'normal','limited_period','usage_limited','merchant_limited','pending','promotional','other'
    )),
    quantity numeric(30,9) not null check (quantity >= 0),
    acquired_at timestamptz,
    settlement_status text not null check (settlement_status in (
        'pending','posted','available','reversed','expired','unknown'
    )),
    expected_posting_from timestamptz,
    expected_posting_to timestamptz,
    posted_at timestamptz,
    expiry_policy text not null default 'unknown' check (expiry_policy in (
        'none','fixed_date','relative_to_posting','provider_defined','unknown'
    )),
    expires_at timestamptz,
    expiry_duration_days integer check (expiry_duration_days is null or expiry_duration_days >= 0),
    expiry_timezone text,
    usage_restrictions jsonb not null default '{}'::jsonb,
    provenance_rule_ids jsonb not null default '[]'::jsonb check (jsonb_typeof(provenance_rule_ids) = 'array'),
    source_operation_ref text,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    check (expected_posting_to is null or expected_posting_from is null or expected_posting_to >= expected_posting_from),
    check (expiry_policy <> 'fixed_date' or expires_at is not null),
    check (expiry_policy <> 'relative_to_posting' or expiry_duration_days is not null)
);

create index user_asset_lots_user_asset_idx
    on user_data.user_asset_lots (user_id, asset_definition_id, expires_at);
create trigger user_asset_lots_set_updated_at
before update on user_data.user_asset_lots
for each row execute function app_private.set_updated_at();

create table user_data.user_valuation_profiles (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references user_data.user_profiles(user_id) on delete cascade,
    version integer not null check (version >= 1),
    name text not null,
    is_active boolean not null default false,
    created_at timestamptz not null default now(),
    unique (user_id, version)
);

create unique index user_valuation_profile_active_idx
    on user_data.user_valuation_profiles (user_id)
    where is_active;

create table user_data.user_valuation_entries (
    id uuid primary key default gen_random_uuid(),
    valuation_profile_id uuid not null references user_data.user_valuation_profiles(id) on delete cascade,
    asset_definition_id uuid not null references app_private.asset_definitions(id) on delete restrict,
    reward_class text,
    expiry_horizon_days integer check (expiry_horizon_days is null or expiry_horizon_days >= 0),
    jpy_per_unit numeric(30,9) not null check (jpy_per_unit >= 0),
    basis text not null,
    unique (valuation_profile_id, asset_definition_id, reward_class, expiry_horizon_days)
);

create table user_data.user_cap_progress (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references user_data.user_profiles(user_id) on delete cascade,
    cap_key text not null,
    status text not null check (status in ('known','estimated','unknown','not_applicable')),
    eligible_spend_jpy_min bigint check (eligible_spend_jpy_min is null or eligible_spend_jpy_min >= 0),
    eligible_spend_jpy_max bigint check (eligible_spend_jpy_max is null or eligible_spend_jpy_max >= 0),
    reward_earned_units_min numeric(30,9) check (reward_earned_units_min is null or reward_earned_units_min >= 0),
    reward_earned_units_max numeric(30,9) check (reward_earned_units_max is null or reward_earned_units_max >= 0),
    period_start timestamptz,
    period_end timestamptz,
    observed_at timestamptz,
    source text not null check (source in (
        'user_input','transaction_history','provider_api','inferred','unknown'
    )),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (user_id, cap_key, period_start, period_end),
    check (period_end is null or period_start is null or period_end > period_start),
    check (eligible_spend_jpy_max is null or eligible_spend_jpy_min is null
           or eligible_spend_jpy_max >= eligible_spend_jpy_min),
    check (reward_earned_units_max is null or reward_earned_units_min is null
           or reward_earned_units_max >= reward_earned_units_min),
    check (
        status not in ('known','estimated')
        or (eligible_spend_jpy_min is not null and eligible_spend_jpy_max is not null
            and reward_earned_units_min is not null and reward_earned_units_max is not null
            and observed_at is not null)
    ),
    check (
        status <> 'known'
        or (eligible_spend_jpy_min = eligible_spend_jpy_max
            and reward_earned_units_min = reward_earned_units_max)
    )
);

create trigger user_cap_progress_set_updated_at
before update on user_data.user_cap_progress
for each row execute function app_private.set_updated_at();

create table user_data.user_recommendation_history (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references user_data.user_profiles(user_id) on delete cascade,
    recommendation_key text not null,
    engine_version text not null,
    contracts_version text not null,
    request_hash text not null check (request_hash ~ '^sha256:[0-9a-f]{64}$'),
    request_payload_redacted jsonb not null,
    result_payload jsonb not null,
    result_hash text not null check (result_hash ~ '^sha256:[0-9a-f]{64}$'),
    transaction_time timestamptz not null,
    replay_knowledge_time timestamptz not null,
    valuation_profile_version text not null,
    retention_class text not null check (retention_class in (
        'session_only','30_days','90_days','user_selected','legal_hold'
    )),
    purge_after timestamptz,
    payload_redaction_status text not null default 'redacted' check (payload_redaction_status in (
        'pending','redacted','rejected'
    )),
    created_at timestamptz not null default now(),
    unique (user_id, recommendation_key),
    check (retention_class = 'legal_hold' or purge_after is not null)
);

create index user_recommendation_history_user_time_idx
    on user_data.user_recommendation_history (user_id, created_at desc);
create index user_recommendation_history_purge_idx
    on user_data.user_recommendation_history (purge_after)
    where purge_after is not null;

create table user_data.user_recommendation_rule_versions (
    recommendation_history_id uuid not null references user_data.user_recommendation_history(id) on delete cascade,
    rule_version_id uuid not null references app_private.reward_rule_versions(id) on delete restrict,
    disposition text not null check (disposition in ('applied','rejected','considered')),
    reason_codes jsonb not null default '[]'::jsonb,
    primary key (recommendation_history_id, rule_version_id, disposition)
);

create table user_data.correction_reports (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references user_data.user_profiles(user_id) on delete cascade,
    recommendation_history_id uuid references user_data.user_recommendation_history(id) on delete set null,
    merchant_location_id uuid references app_private.merchant_locations(id) on delete set null,
    reported_at timestamptz not null default now(),
    report_payload_redacted jsonb not null,
    privacy_redaction_status text not null default 'pending' check (privacy_redaction_status in (
        'pending','complete','rejected'
    )),
    status text not null default 'open' check (status in (
        'open','triaged','investigating','resolved','rejected'
    )),
    purge_after timestamptz not null,
    created_review_item_id uuid references app_private.review_items(id) on delete set null
);

-- RLS is required on all user-owned tables. No permissive policies are installed in
-- this foundation migration, so direct client access is denied until the application
-- adds reviewed auth.uid()-based policies.
alter table user_data.user_profiles enable row level security;
alter table user_data.user_profiles force row level security;
alter table user_data.user_wallet_items enable row level security;
alter table user_data.user_wallet_items force row level security;
alter table user_data.user_facts enable row level security;
alter table user_data.user_facts force row level security;
alter table user_data.user_asset_lots enable row level security;
alter table user_data.user_asset_lots force row level security;
alter table user_data.user_valuation_profiles enable row level security;
alter table user_data.user_valuation_profiles force row level security;
alter table user_data.user_valuation_entries enable row level security;
alter table user_data.user_valuation_entries force row level security;
alter table user_data.user_cap_progress enable row level security;
alter table user_data.user_cap_progress force row level security;
alter table user_data.user_recommendation_history enable row level security;
alter table user_data.user_recommendation_history force row level security;
alter table user_data.user_recommendation_rule_versions enable row level security;
alter table user_data.user_recommendation_rule_versions force row level security;
alter table user_data.correction_reports enable row level security;
alter table user_data.correction_reports force row level security;

-- ----------
-- Controlled read surface
-- ----------

-- SECURITY INVOKER is deliberate: granting a view alone must not silently lend
-- the migration owner's privileges. A deployment must grant the querying server role
-- only the underlying privileges it actually needs, or expose a reviewed RPC instead.
create view app_api.verified_sources
with (security_invoker = true, security_barrier = true) as
select
    id,
    source_key,
    name,
    publisher,
    category,
    tier,
    source_url,
    authority_scope,
    content_verified_on,
    verification_status
from app_private.trusted_sources
where verification_status = 'content_verified'
  and publication_use <> 'discovery_only';

create view app_api.approved_reward_rule_versions
with (security_invoker = true, security_barrier = true) as
select
    rr.rule_key,
    rr.rule_type,
    rr.name,
    rrv.id as rule_version_id,
    rrv.version,
    rrv.definition,
    rrv.valid_from,
    rrv.valid_to,
    rrv.recorded_at,
    rrv.superseded_at,
    rrv.review_mode
from app_private.reward_rules rr
join app_private.reward_rule_versions rrv on rrv.rule_id = rr.id
where rrv.review_status = 'approved'
  and rrv.superseded_at is null;

revoke all on all tables in schema app_private from public;
revoke all on all tables in schema app_api from public;
revoke all on all tables in schema user_data from public;
revoke all on all sequences in schema app_private from public;
revoke all on all sequences in schema user_data from public;

-- Supabase roles are optional in plain PostgreSQL. Revoke existing and future grants
-- when those roles exist. This does not create user policies.
do $$
declare
    role_name text;
begin
    foreach role_name in array array['anon','authenticated'] loop
        if exists (select 1 from pg_roles where rolname = role_name) then
            execute format('revoke all on schema app_private from %I', role_name);
            execute format('revoke all on schema app_api from %I', role_name);
            execute format('revoke all on schema user_data from %I', role_name);
            execute format('revoke all on all tables in schema app_private from %I', role_name);
            execute format('revoke all on all tables in schema app_api from %I', role_name);
            execute format('revoke all on all tables in schema user_data from %I', role_name);
            execute format('revoke all on all sequences in schema app_private from %I', role_name);
            execute format('revoke all on all sequences in schema user_data from %I', role_name);
            execute format('alter default privileges in schema app_private revoke all on tables from %I', role_name);
            execute format('alter default privileges in schema app_api revoke all on tables from %I', role_name);
            execute format('alter default privileges in schema user_data revoke all on tables from %I', role_name);
            execute format('alter default privileges in schema app_private revoke all on sequences from %I', role_name);
            execute format('alter default privileges in schema user_data revoke all on sequences from %I', role_name);
            execute format('alter default privileges in schema app_private revoke execute on functions from %I', role_name);
            execute format('alter default privileges in schema app_api revoke execute on functions from %I', role_name);
            execute format('alter default privileges in schema user_data revoke execute on functions from %I', role_name);
        end if;
    end loop;
end
$$;

comment on schema app_private is 'Internal evidence, rule, review, and canonical replay state; do not expose through client APIs.';
comment on schema user_data is 'User-owned wallet, state, valuation, and short-retention recommendation history; RLS required.';
comment on table app_private.trusted_sources is 'Authority registry. Authority, permission, and technical reachability are separate.';
comment on table app_private.source_snapshots is 'Immutable content-addressed evidence captures.';
comment on table app_private.reward_rule_versions is 'Bitemporal economic rule definitions; approved payloads are immutable.';
comment on table app_private.canonical_replay_runs is 'Permanent replay records limited to synthetic/golden/redacted benchmark data.';
comment on table user_data.user_recommendation_history is 'Deletable user history with explicit retention and purge deadlines.';

comment on view app_api.verified_sources is 'Security-invoker, security-barrier view; no client grant is implied by creation.';
comment on view app_api.approved_reward_rule_versions is 'Security-invoker, security-barrier view; use a least-privilege server role or reviewed RPC.';

commit;
