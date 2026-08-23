-- Merchant acceptance and geo-cache layer.
-- Collected facts are usable immediately; provenance and correction signals preserve auditability.

begin;

create table if not exists app_private.merchant_acceptance_facts (
    id uuid primary key default gen_random_uuid(),
    fact_key text not null unique check (fact_key ~ '^maf_[a-z0-9_-]+$'),
    merchant_entity_id uuid not null references app_private.entities(id) on delete restrict,
    merchant_location_id uuid references app_private.merchant_locations(id) on delete restrict,
    instrument_entity_id uuid not null references app_private.entities(id) on delete restrict,
    action text not null check (action in ('pay','earn','redeem')),
    acceptance_state text not null check (acceptance_state in ('yes','no','unknown','conflicting')),
    scope text not null check (scope in ('chain_default','branch')),
    source_kind text not null check (source_kind in (
        'existing_implementation_fact','official_directory','official_store_page',
        'open_data','runtime_provider','user_report','other'
    )),
    source_ref text,
    source_url text,
    source_checked_at timestamptz not null,
    confidence numeric(6,5) not null default 0.8 check (confidence between 0 and 1),
    valid_from timestamptz,
    valid_to timestamptz,
    expires_at timestamptz,
    derivation text not null default 'direct' check (derivation in ('direct','normalized','inferred')),
    provenance jsonb not null default '{}'::jsonb,
    status text not null default 'active' check (status in ('active','disputed','superseded')),
    supersedes_fact_id uuid references app_private.merchant_acceptance_facts(id) on delete restrict,
    created_at timestamptz not null default now(),
    check ((scope = 'branch' and merchant_location_id is not null) or (scope = 'chain_default' and merchant_location_id is null)),
    check (valid_to is null or valid_from is null or valid_to > valid_from),
    check (expires_at is null or expires_at > source_checked_at)
);

create index if not exists merchant_acceptance_lookup_idx
    on app_private.merchant_acceptance_facts
    (merchant_entity_id, merchant_location_id, instrument_entity_id, action, acceptance_state, status);
create index if not exists merchant_acceptance_freshness_idx
    on app_private.merchant_acceptance_facts (source_checked_at desc, expires_at);

create table if not exists app_private.merchant_acceptance_corrections (
    id uuid primary key default gen_random_uuid(),
    correction_key text not null unique check (correction_key ~ '^mac_[a-z0-9_-]+$'),
    fact_id uuid not null references app_private.merchant_acceptance_facts(id) on delete restrict,
    reporter_type text not null check (reporter_type in ('user','system','source')),
    signal text not null check (signal in ('wrong','accepted','not_accepted','changed','other')),
    note text not null default '',
    payload jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    resolved_at timestamptz,
    resolution text,
    check (resolved_at is null or resolved_at >= created_at)
);
create index if not exists merchant_acceptance_corrections_fact_idx
    on app_private.merchant_acceptance_corrections (fact_id, created_at desc);

create table if not exists app_private.geo_query_cache (
    id uuid primary key default gen_random_uuid(),
    cache_key text not null unique,
    provider text not null,
    geo_cell text not null,
    query_radius_m integer not null check (query_radius_m between 50 and 50000),
    fetched_at timestamptz not null,
    expires_at timestamptz not null,
    response_hash text,
    result_count integer not null default 0 check (result_count >= 0),
    result_refs jsonb not null default '[]'::jsonb check (jsonb_typeof(result_refs) = 'array'),
    cache_policy text not null default 'ids_only' check (cache_policy in ('ids_only','full_allowed','no_persist')),
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    check (expires_at > fetched_at)
);
create index if not exists geo_query_cache_lookup_idx
    on app_private.geo_query_cache (provider, geo_cell, expires_at desc);
create trigger geo_query_cache_set_updated_at
before update on app_private.geo_query_cache
for each row execute function app_private.set_updated_at();

create table if not exists app_private.merchant_enrichment_jobs (
    id uuid primary key default gen_random_uuid(),
    merchant_location_id uuid not null references app_private.merchant_locations(id) on delete cascade,
    provider text not null,
    enrichment_kind text not null check (enrichment_kind in ('coordinates','address','external_id','acceptance','point_program','full')),
    priority integer not null default 50 check (priority between 0 and 100),
    status text not null default 'pending' check (status in ('pending','running','complete','failed','blocked')),
    attempts integer not null default 0 check (attempts >= 0),
    last_attempt_at timestamptz,
    retry_after timestamptz,
    last_error text,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (merchant_location_id, provider, enrichment_kind)
);
create index if not exists merchant_enrichment_queue_idx
    on app_private.merchant_enrichment_jobs (status, priority desc, retry_after);
create trigger merchant_enrichment_jobs_set_updated_at
before update on app_private.merchant_enrichment_jobs
for each row execute function app_private.set_updated_at();

create or replace view app_private.current_merchant_acceptance_facts
with (security_barrier=true) as
select f.*
from app_private.merchant_acceptance_facts f
where f.status = 'active'
  and (f.valid_from is null or f.valid_from <= now())
  and (f.valid_to is null or f.valid_to > now())
  and (f.expires_at is null or f.expires_at > now())
  and not exists (
      select 1
      from app_private.merchant_acceptance_corrections c
      where c.fact_id = f.id
        and c.resolved_at is null
        and c.signal in ('wrong','not_accepted','changed')
  );

create or replace view app_api.merchant_acceptance_current
with (security_barrier=true) as
select
    f.fact_key,
    me.entity_key as merchant_key,
    me.display_name as merchant_name,
    ml.location_key,
    ml.display_name as location_name,
    ml.address,
    ml.latitude,
    ml.longitude,
    ml.external_place_ids,
    ml.metadata as location_metadata,
    ie.entity_key as instrument_key,
    ie.display_name as instrument_name,
    f.action,
    f.acceptance_state,
    f.scope,
    f.confidence,
    f.source_checked_at,
    f.expires_at,
    f.source_url
from app_private.current_merchant_acceptance_facts f
join app_private.entities me on me.id = f.merchant_entity_id
join app_private.entities ie on ie.id = f.instrument_entity_id
left join app_private.merchant_locations ml on ml.id = f.merchant_location_id;

revoke all on app_private.merchant_acceptance_facts from public;
revoke all on app_private.merchant_acceptance_corrections from public;
revoke all on app_private.geo_query_cache from public;
revoke all on app_private.merchant_enrichment_jobs from public;
revoke all on app_private.current_merchant_acceptance_facts from public;
revoke all on app_api.merchant_acceptance_current from public;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'jro_runtime') then
    grant select on app_api.merchant_acceptance_current to jro_runtime;
  end if;
end $$;

comment on table app_private.merchant_acceptance_facts is 'Immediately usable merchant payment/point acceptance facts. Review does not gate activation; provenance and corrections preserve auditability.';
comment on table app_private.merchant_acceptance_corrections is 'User/system/source correction signals. Unresolved negative signals suppress a fact from the current projection.';
comment on table app_private.geo_query_cache is 'Provider-aware geographic lookup cache. ids_only supports providers whose content cannot be persistently mirrored.';

commit;
