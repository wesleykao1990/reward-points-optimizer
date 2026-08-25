-- Additive online-commerce model. Physical merchant/location tables are unchanged.
begin;

create table if not exists app_private.commerce_surfaces (
  id uuid primary key default gen_random_uuid(),
  surface_key text not null unique check (surface_key ~ '^commerce\.[a-z0-9][a-z0-9._-]+$'),
  operator_entity_id uuid not null references app_private.entities(id) on delete restrict,
  parent_surface_id uuid references app_private.commerce_surfaces(id) on delete set null,
  display_name text not null,
  surface_kind text not null check (surface_kind in ('owned_store','marketplace','c2c','service','digital_store')),
  canonical_host text not null,
  canonical_path_pattern text,
  market_country text not null check (market_country ~ '^[A-Z]{2}$'),
  locale text not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  merchant_of_record_mode text not null check (merchant_of_record_mode in ('platform','seller','mixed','unknown')),
  payment_policy_mode text not null check (payment_policy_mode in ('uniform','seller_configurable','offer_dynamic','mixed')),
  web_url text not null,
  ios_app_id text,
  android_package_id text,
  valid_from timestamptz,
  valid_to timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active','inactive','retired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (valid_to is null or valid_from is null or valid_to > valid_from)
);
create index if not exists commerce_surfaces_host_idx on app_private.commerce_surfaces (lower(canonical_host), market_country, status);
drop trigger if exists commerce_surfaces_set_updated_at on app_private.commerce_surfaces;
create trigger commerce_surfaces_set_updated_at before update on app_private.commerce_surfaces for each row execute function app_private.set_updated_at();

create table if not exists app_private.commerce_surface_aliases (
  id uuid primary key default gen_random_uuid(),
  surface_id uuid not null references app_private.commerce_surfaces(id) on delete cascade,
  alias_type text not null check (alias_type in ('host','url_prefix','app_bundle','external')),
  alias text not null,
  market_country text check (market_country is null or market_country ~ '^[A-Z]{2}$'),
  is_primary boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (surface_id, alias_type, alias)
);
create index if not exists commerce_surface_alias_lookup_idx on app_private.commerce_surface_aliases (lower(alias), alias_type);

create table if not exists app_private.online_commerce_catalogue (
  family_id text primary key check (family_id ~ '^commerce-family\.[a-z0-9][a-z0-9._-]+$'),
  surface_id uuid not null unique references app_private.commerce_surfaces(id) on delete restrict,
  display_name text not null,
  category text not null,
  priority text not null check (priority in ('P0','P1','P2')),
  requires_payment_coverage boolean not null default true,
  requires_loyalty_coverage boolean not null default true,
  requires_optimization_coverage boolean not null default true,
  requires_seller_resolution boolean not null default false,
  stream_id text not null,
  rationale text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active','inactive','retired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists online_commerce_catalogue_set_updated_at on app_private.online_commerce_catalogue;
create trigger online_commerce_catalogue_set_updated_at before update on app_private.online_commerce_catalogue for each row execute function app_private.set_updated_at();

create table if not exists app_private.commerce_contexts (
  id uuid primary key default gen_random_uuid(),
  context_key text not null unique check (context_key ~ '^commerce-context\.[a-z0-9][a-z0-9._-]+$'),
  surface_id uuid not null references app_private.commerce_surfaces(id) on delete restrict,
  parent_context_id uuid references app_private.commerce_contexts(id) on delete set null,
  context_type text not null check (context_type in ('surface_default','seller','shop','category','product','offer','subscription','fulfillment')),
  external_id text,
  merchant_entity_id uuid references app_private.entities(id) on delete restrict,
  display_name text not null,
  selector jsonb not null default '{}'::jsonb,
  specificity_rank integer not null default 0 check (specificity_rank between 0 and 1000),
  valid_from timestamptz,
  valid_to timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active','inactive','retired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (valid_to is null or valid_from is null or valid_to > valid_from)
);
create index if not exists commerce_contexts_resolution_idx on app_private.commerce_contexts (surface_id, context_type, external_id, specificity_rank desc);
drop trigger if exists commerce_contexts_set_updated_at on app_private.commerce_contexts;
create trigger commerce_contexts_set_updated_at before update on app_private.commerce_contexts for each row execute function app_private.set_updated_at();

create table if not exists app_private.commerce_acceptance_facts (
  id uuid primary key default gen_random_uuid(),
  fact_key text not null unique check (fact_key ~ '^caf_[a-z0-9_-]+$'),
  surface_id uuid not null references app_private.commerce_surfaces(id) on delete restrict,
  context_id uuid references app_private.commerce_contexts(id) on delete restrict,
  instrument_entity_id uuid not null references app_private.entities(id) on delete restrict,
  action text not null check (action in ('pay','earn','redeem')),
  acceptance_state text not null check (acceptance_state in ('yes','no','unknown','conflicting')),
  split_tender_mode text not null default 'unknown' check (split_tender_mode in ('none','supported','required','unknown')),
  amount_constraint jsonb not null default '{}'::jsonb,
  applicability jsonb not null default '{}'::jsonb,
  trusted_source_id uuid references app_private.trusted_sources(id) on delete restrict,
  source_kind text not null check (source_kind in ('official_merchant','official_platform_help','official_api','official_payment_provider','user_report','other')),
  source_ref text not null,
  source_url text not null,
  source_checked_at timestamptz not null,
  confidence numeric(6,5) not null check (confidence between 0 and 1),
  valid_from timestamptz,
  valid_to timestamptz,
  expires_at timestamptz,
  provenance jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active','disputed','superseded')),
  supersedes_fact_id uuid references app_private.commerce_acceptance_facts(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (valid_to is null or valid_from is null or valid_to > valid_from),
  check (expires_at is null or expires_at > source_checked_at)
);
create index if not exists commerce_acceptance_surface_idx on app_private.commerce_acceptance_facts (surface_id, status, action, instrument_entity_id);
create index if not exists commerce_acceptance_context_idx on app_private.commerce_acceptance_facts (context_id) where context_id is not null;

create table if not exists app_private.commerce_reward_facts (
  id uuid primary key default gen_random_uuid(),
  fact_key text not null unique check (fact_key ~ '^crf_[a-z0-9_-]+$'),
  surface_id uuid not null references app_private.commerce_surfaces(id) on delete restrict,
  context_id uuid references app_private.commerce_contexts(id) on delete restrict,
  loyalty_program_entity_id uuid references app_private.entities(id) on delete restrict,
  payment_instrument_entity_id uuid references app_private.entities(id) on delete restrict,
  component_kind text not null check (component_kind in ('merchant_loyalty','payment_wallet_reward','funding_card_reward','marketplace_reward','portal_reward','campaign_bonus','membership_bonus','coupon_or_discount','fee_or_surcharge','other')),
  value_model jsonb not null check (jsonb_typeof(value_model)='object'),
  amount_basis text not null check (amount_basis in ('order_total','item_subtotal','eligible_item_subtotal','instrument_paid_portion','post_discount_tax_exclusive','post_discount_tax_inclusive','variable','other')),
  rankability text not null default 'conditional' check (rankability in ('rankable','conditional','informational')),
  stacking_mode text not null default 'conditional' check (stacking_mode in ('additive','exclusive_choice','conditional')),
  choice_group text,
  eligibility jsonb not null default '{}'::jsonb,
  cap_model jsonb not null default '{}'::jsonb,
  rounding_mode text check (rounding_mode is null or rounding_mode in ('floor','ceil','half_up','exact','unknown')),
  trusted_source_id uuid references app_private.trusted_sources(id) on delete restrict,
  source_kind text not null check (source_kind in ('official_merchant','official_platform_help','official_api','official_payment_provider','official_card_issuer','user_report','other')),
  source_ref text not null,
  source_url text not null,
  source_checked_at timestamptz not null,
  confidence numeric(6,5) not null check (confidence between 0 and 1),
  valid_from timestamptz,
  valid_to timestamptz,
  expires_at timestamptz,
  provenance jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active','disputed','superseded')),
  supersedes_fact_id uuid references app_private.commerce_reward_facts(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (valid_to is null or valid_from is null or valid_to > valid_from),
  check (expires_at is null or expires_at > source_checked_at),
  check ((stacking_mode='exclusive_choice' and choice_group is not null) or stacking_mode<>'exclusive_choice')
);
create index if not exists commerce_reward_surface_idx on app_private.commerce_reward_facts (surface_id, status, rankability);
create index if not exists commerce_reward_context_idx on app_private.commerce_reward_facts (context_id) where context_id is not null;

create or replace view app_private.current_commerce_acceptance_facts as
select * from app_private.commerce_acceptance_facts where status='active' and (valid_from is null or valid_from<=now()) and (valid_to is null or valid_to>now()) and (expires_at is null or expires_at>now());
create or replace view app_private.current_commerce_reward_facts as
select * from app_private.commerce_reward_facts where status='active' and (valid_from is null or valid_from<=now()) and (valid_to is null or valid_to>now()) and (expires_at is null or expires_at>now());

create or replace view app_api.online_commerce_coverage as
select c.family_id,c.display_name,c.category,c.priority,c.stream_id,c.requires_seller_resolution,
       s.surface_key,s.surface_kind,s.canonical_host,s.market_country,s.currency,
       s.merchant_of_record_mode,s.payment_policy_mode,s.web_url,true as catalogue_covered,
       coalesce(a.acceptance_fact_count,0) as acceptance_fact_count,
       coalesce(a.acceptance_fact_count,0)>0 as acceptance_covered,
       coalesce(r.reward_fact_count,0) as reward_fact_count,
       coalesce(r.rankable_reward_fact_count,0) as rankable_reward_fact_count,
       coalesce(r.reward_fact_count,0)>0 as optimization_model_covered,
       coalesce(r.rankable_reward_fact_count,0)>0 as rankable_optimization_covered,
       greatest(a.latest_checked_at,r.latest_checked_at) as latest_checked_at,c.metadata,c.status
from app_private.online_commerce_catalogue c join app_private.commerce_surfaces s on s.id=c.surface_id
left join lateral (select count(*)::integer acceptance_fact_count,max(source_checked_at) latest_checked_at from app_private.current_commerce_acceptance_facts f where f.surface_id=s.id) a on true
left join lateral (select count(*)::integer reward_fact_count,count(*) filter (where rankability='rankable')::integer rankable_reward_fact_count,max(source_checked_at) latest_checked_at from app_private.current_commerce_reward_facts f where f.surface_id=s.id) r on true
where c.status='active' and s.status='active';

create or replace function app_api.resolve_commerce_url(p_url text)
returns table(surface_key text,display_name text,canonical_host text,market_country text,surface_kind text,payment_policy_mode text,requires_seller_resolution boolean,confidence numeric)
language sql stable security definer set search_path=pg_catalog,app_private,app_api as $$
with input as (select lower(regexp_replace(regexp_replace(btrim(p_url),'^[a-z][a-z0-9+.-]*://','','i'),'[/?#].*$','')) as host),
matched as (select s.id,case when lower(s.canonical_host)=i.host then 1.0 else 0.98 end::numeric confidence from input i join app_private.commerce_surfaces s on s.status='active' and (lower(s.canonical_host)=i.host or exists (select 1 from app_private.commerce_surface_aliases a where a.surface_id=s.id and a.alias_type='host' and lower(a.alias)=i.host)))
select s.surface_key,s.display_name,s.canonical_host,s.market_country,s.surface_kind,s.payment_policy_mode,c.requires_seller_resolution,m.confidence
from matched m join app_private.commerce_surfaces s on s.id=m.id join app_private.online_commerce_catalogue c on c.surface_id=s.id and c.status='active'
order by m.confidence desc,s.surface_key limit 1
$$;

revoke all on app_api.online_commerce_coverage from public;
revoke all on function app_api.resolve_commerce_url(text) from public;
grant select on app_api.online_commerce_coverage to jro_runtime;
grant execute on function app_api.resolve_commerce_url(text) to jro_runtime;
commit;
