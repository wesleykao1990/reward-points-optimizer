create table if not exists app_private.merchant_location_change_signals (
  id uuid primary key default gen_random_uuid(),
  signal_key text not null unique check (signal_key ~ '^[a-z0-9][a-z0-9._-]+$'),
  provider text not null check (provider in ('geomedian','official_merchant','search_index','other')),
  event_type text not null check (event_type in ('opening','closure_candidate','closure_confirmed','reopening','relocation','unknown_change')),
  chain_name text not null,
  store_name text not null,
  merchant_entity_id uuid references app_private.entities(id) on delete set null,
  merchant_location_id uuid references app_private.merchant_locations(id) on delete set null,
  prefecture text,
  municipality text,
  address_text text,
  effective_date date,
  date_precision text not null default 'unknown' check (date_precision in ('day','month','unknown')),
  source_url text not null,
  source_title text,
  normalized_claim jsonb not null default '{}'::jsonb,
  observed_at timestamptz not null,
  verification_status text not null default 'unverified' check (verification_status in ('unverified','official_confirmed','rejected','superseded')),
  verification_source_url text,
  verified_at timestamptz,
  canonical_action text not null default 'none' check (canonical_action in ('none','insert_location','close_location','reopen_location','update_location')),
  canonical_applied_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists merchant_location_change_signals_event_idx
  on app_private.merchant_location_change_signals(event_type, effective_date desc nulls last);
create index if not exists merchant_location_change_signals_verification_idx
  on app_private.merchant_location_change_signals(verification_status, observed_at desc);
create index if not exists merchant_location_change_signals_merchant_idx
  on app_private.merchant_location_change_signals(merchant_entity_id, observed_at desc);

create or replace view app_api.merchant_location_change_feed as
select
  s.signal_key,
  s.provider,
  s.event_type,
  s.chain_name,
  s.store_name,
  e.entity_key as merchant_entity_key,
  s.prefecture,
  s.municipality,
  s.address_text,
  s.effective_date,
  s.date_precision,
  s.source_url,
  s.source_title,
  s.normalized_claim,
  s.observed_at,
  s.verification_status,
  s.verification_source_url,
  s.verified_at,
  s.canonical_action,
  s.canonical_applied_at,
  s.metadata
from app_private.merchant_location_change_signals s
left join app_private.entities e on e.id=s.merchant_entity_id;

create or replace view app_api.merchant_location_change_summary as
select
  event_type,
  verification_status,
  count(*)::bigint as signal_count,
  max(observed_at) as latest_observed_at
from app_private.merchant_location_change_signals
group by event_type, verification_status;
