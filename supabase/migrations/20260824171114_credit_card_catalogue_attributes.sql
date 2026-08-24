-- Recovered from the hosted Supabase migration history so the repository and
-- production history remain a complete, replayable set.
create table if not exists app_private.credit_card_catalogue_profiles (
  card_id text primary key references app_private.entities(entity_key) on update cascade on delete cascade,
  issuer_name text not null,
  supported_networks text[] not null default '{}'::text[],
  product_tier text null,
  reward_program text null,
  official_product_url text null,
  checked_at timestamptz null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint credit_card_catalogue_profiles_networks_check check (
    supported_networks <@ array['visa','mastercard','jcb','amex','diners','unionpay','discover']::text[]
  ),
  constraint credit_card_catalogue_profiles_url_check check (
    official_product_url is null or official_product_url ~ '^https://'
  )
);

create table if not exists app_private.credit_card_economic_terms (
  id uuid primary key default gen_random_uuid(),
  card_id text not null references app_private.entities(entity_key) on update cascade on delete cascade,
  annual_fee_jpy integer null check (annual_fee_jpy is null or annual_fee_jpy >= 0),
  first_year_annual_fee_jpy integer null check (first_year_annual_fee_jpy is null or first_year_annual_fee_jpy >= 0),
  annual_fee_waiver_condition text null,
  base_reward_rate_percent numeric(8,4) null check (base_reward_rate_percent is null or base_reward_rate_percent >= 0),
  reward_program text null,
  foreign_transaction_fee_percent numeric(8,4) null check (foreign_transaction_fee_percent is null or foreign_transaction_fee_percent >= 0),
  effective_from timestamptz null,
  effective_to timestamptz null,
  source_url text null,
  agent_feed_finding_id text null,
  official_source_verified boolean not null default false,
  checked_at timestamptz null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint credit_card_economic_terms_time_check check (
    effective_to is null or effective_from is null or effective_to > effective_from
  ),
  constraint credit_card_economic_terms_url_check check (
    source_url is null or source_url ~ '^https://'
  )
);

create unique index if not exists credit_card_economic_terms_one_current
  on app_private.credit_card_economic_terms(card_id)
  where effective_to is null;

insert into app_private.credit_card_catalogue_profiles(card_id, issuer_name)
select e.entity_key, e.metadata->>'issuer'
from app_private.entities e
where e.status='active'
  and e.entity_key like 'instrument.card.%'
  and nullif(e.metadata->>'issuer','') is not null
on conflict (card_id) do update
set issuer_name = excluded.issuer_name,
    updated_at = now();

create or replace view app_api.credit_card_catalogue_details as
select
  e.entity_key as card_id,
  e.display_name,
  coalesce(e.metadata->>'coverage_tier','unclassified') as coverage_tier,
  case when (e.metadata->>'coverage_priority') ~ '^[0-9]+$'
       then (e.metadata->>'coverage_priority')::integer else null end as coverage_priority,
  p.issuer_name,
  p.supported_networks,
  p.product_tier,
  coalesce(t.reward_program,p.reward_program) as reward_program,
  t.annual_fee_jpy,
  t.first_year_annual_fee_jpy,
  t.annual_fee_waiver_condition,
  t.base_reward_rate_percent,
  t.foreign_transaction_fee_percent,
  coalesce(t.source_url,p.official_product_url) as official_source_url,
  t.agent_feed_finding_id,
  coalesce(t.official_source_verified,false) as official_source_verified,
  greatest(p.checked_at,t.checked_at) as checked_at
from app_private.entities e
join app_private.credit_card_catalogue_profiles p on p.card_id=e.entity_key
left join app_private.credit_card_economic_terms t
  on t.card_id=e.entity_key and t.effective_to is null
where e.status='active' and e.entity_key like 'instrument.card.%';

comment on table app_private.credit_card_catalogue_profiles is
  'Canonical static/semi-static credit-card catalogue attributes such as issuer and supported card networks.';
comment on table app_private.credit_card_economic_terms is
  'Current/temporal credit-card economics such as annual fee and base reward rate; null means unknown, zero fee means free.';
comment on view app_api.credit_card_catalogue_details is
  'Browser-safe current credit-card identity plus economic attributes. Optimization eligibility remains separate.';

grant select on app_api.credit_card_catalogue_details to jro_runtime;
