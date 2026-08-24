-- Mirrors the credit-card catalogue/optimization schema already applied to production.
-- This migration is intentionally schema-focused and does not alter production by itself.

create table if not exists app_private.credit_card_catalogue_profiles (
  card_id text primary key references app_private.entities(entity_key) on update cascade on delete cascade,
  issuer_name text not null,
  supported_networks text[] not null default '{}'::text[],
  product_tier text,
  reward_program text,
  official_product_url text,
  checked_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint credit_card_catalogue_profiles_networks_check
    check (supported_networks <@ array['visa','mastercard','jcb','amex','diners','unionpay','discover']::text[]),
  constraint credit_card_catalogue_profiles_url_check
    check (official_product_url is null or official_product_url ~ '^https://')
);

create table if not exists app_private.credit_card_economic_terms (
  id uuid primary key default gen_random_uuid(),
  card_id text not null references app_private.entities(entity_key) on update cascade on delete cascade,
  annual_fee_jpy integer,
  first_year_annual_fee_jpy integer,
  annual_fee_waiver_condition text,
  base_reward_rate_percent numeric,
  reward_program text,
  foreign_transaction_fee_percent numeric,
  effective_from timestamptz,
  effective_to timestamptz,
  source_url text,
  agent_feed_finding_id text,
  official_source_verified boolean not null default false,
  checked_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint credit_card_economic_terms_annual_fee_jpy_check
    check (annual_fee_jpy is null or annual_fee_jpy >= 0),
  constraint credit_card_economic_terms_first_year_annual_fee_jpy_check
    check (first_year_annual_fee_jpy is null or first_year_annual_fee_jpy >= 0),
  constraint credit_card_economic_terms_base_reward_rate_percent_check
    check (base_reward_rate_percent is null or base_reward_rate_percent >= 0),
  constraint credit_card_economic_terms_foreign_transaction_fee_percen_check
    check (foreign_transaction_fee_percent is null or foreign_transaction_fee_percent >= 0),
  constraint credit_card_economic_terms_time_check
    check (effective_to is null or effective_from is null or effective_to > effective_from),
  constraint credit_card_economic_terms_url_check
    check (source_url is null or source_url ~ '^https://')
);

create unique index if not exists credit_card_economic_terms_one_current
  on app_private.credit_card_economic_terms(card_id)
  where effective_to is null;

-- Ensure every active canonical credit-card entity has a catalogue profile.
insert into app_private.credit_card_catalogue_profiles (card_id, issuer_name)
select
  e.entity_key,
  coalesce(nullif(e.metadata ->> 'issuer', ''), 'Unknown')
from app_private.entities e
where e.status = 'active'
  and e.entity_key like 'instrument.card.%'
on conflict (card_id) do nothing;

create or replace view app_api.credit_card_catalogue_details as
select
  e.entity_key as card_id,
  e.display_name,
  coalesce(e.metadata ->> 'coverage_tier', 'unclassified') as coverage_tier,
  case
    when (e.metadata ->> 'coverage_priority') ~ '^[0-9]+$'
      then (e.metadata ->> 'coverage_priority')::integer
    else null::integer
  end as coverage_priority,
  p.issuer_name,
  p.supported_networks,
  p.product_tier,
  coalesce(t.reward_program, p.reward_program) as reward_program,
  t.annual_fee_jpy,
  t.first_year_annual_fee_jpy,
  t.annual_fee_waiver_condition,
  t.base_reward_rate_percent,
  t.foreign_transaction_fee_percent,
  coalesce(t.source_url, p.official_product_url) as official_source_url,
  t.agent_feed_finding_id,
  coalesce(t.official_source_verified, false) as official_source_verified,
  greatest(p.checked_at, t.checked_at) as checked_at
from app_private.entities e
join app_private.credit_card_catalogue_profiles p
  on p.card_id = e.entity_key
left join app_private.credit_card_economic_terms t
  on t.card_id = e.entity_key
 and t.effective_to is null
where e.status = 'active'
  and e.entity_key like 'instrument.card.%';

create or replace view app_api.credit_card_coverage as
with cards as (
  select
    e.entity_key as card_id,
    e.display_name,
    coalesce(e.metadata ->> 'coverage_tier', 'unclassified') as coverage_tier,
    case
      when (e.metadata ->> 'coverage_priority') ~ '^[0-9]+$'
        then (e.metadata ->> 'coverage_priority')::integer
      else null::integer
    end as coverage_priority
  from app_private.entities e
  where e.status = 'active'
    and e.entity_key like 'instrument.card.%'
), reflected as (
  select
    c.card_id,
    count(f.finding_id)::integer as active_finding_count,
    max(f.first_reflected_at) as latest_reflected_at
  from cards c
  left join app_api.active_agent_feed_experimental_findings f
    on c.card_id = any(f.family_ids)
  group by c.card_id
)
select
  c.card_id,
  c.display_name,
  c.coverage_tier,
  c.coverage_priority,
  r.active_finding_count > 0 as optimization_covered,
  r.active_finding_count,
  r.latest_reflected_at
from cards c
join reflected r using (card_id);

grant select on app_api.credit_card_catalogue_details to jro_runtime;
grant select on app_api.credit_card_coverage to jro_runtime;
