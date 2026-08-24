begin;

create table app_private.merchant_tender_reward_facts (
  id uuid primary key default gen_random_uuid(),
  fact_key text not null unique check (fact_key ~ '^mtr_[a-z0-9_-]+$'),
  merchant_entity_id uuid not null references app_private.entities(id) on delete restrict,
  merchant_location_id uuid null references app_private.merchant_locations(id) on delete restrict,
  loyalty_program_entity_id uuid not null references app_private.entities(id) on delete restrict,
  payment_instrument_entity_id uuid null references app_private.entities(id) on delete restrict,
  scope text not null check (scope in ('chain_default','branch')),
  rate_model text not null check (rate_model in ('points_percent','fraction_of_reference')),
  rate_percent numeric null check (rate_percent is null or (rate_percent >= 0 and rate_percent <= 100)),
  reference_program_entity_id uuid null references app_private.entities(id) on delete restrict,
  reference_fraction numeric null check (reference_fraction is null or (reference_fraction > 0 and reference_fraction <= 10)),
  rounding_mode text null check (rounding_mode is null or rounding_mode in ('floor','ceil','half_up','exact','unknown')),
  source_kind text not null check (source_kind in ('existing_implementation_fact','official_directory','official_store_page','open_data','runtime_provider','user_report','other')),
  source_ref text null,
  source_url text null,
  source_checked_at timestamptz not null,
  confidence numeric not null default 0.8 check (confidence >= 0 and confidence <= 1),
  valid_from timestamptz null,
  valid_to timestamptz null,
  expires_at timestamptz null,
  provenance jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active','disputed','superseded')),
  supersedes_fact_id uuid null references app_private.merchant_tender_reward_facts(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (((scope = 'branch') and merchant_location_id is not null) or ((scope = 'chain_default') and merchant_location_id is null)),
  check ((valid_to is null) or (valid_from is null) or valid_to > valid_from),
  check ((expires_at is null) or expires_at > source_checked_at),
  check (
    (rate_model = 'points_percent' and rate_percent is not null and reference_program_entity_id is null and reference_fraction is null)
    or
    (rate_model = 'fraction_of_reference' and rate_percent is null and reference_program_entity_id is not null and reference_fraction is not null)
  )
);

create index merchant_tender_reward_merchant_idx
  on app_private.merchant_tender_reward_facts (merchant_entity_id, status, scope);
create index merchant_tender_reward_location_idx
  on app_private.merchant_tender_reward_facts (merchant_location_id)
  where merchant_location_id is not null;
create index merchant_tender_reward_program_idx
  on app_private.merchant_tender_reward_facts (loyalty_program_entity_id, payment_instrument_entity_id, status);
create index merchant_tender_reward_reference_program_idx
  on app_private.merchant_tender_reward_facts (reference_program_entity_id)
  where reference_program_entity_id is not null;
create index merchant_tender_reward_supersedes_idx
  on app_private.merchant_tender_reward_facts (supersedes_fact_id)
  where supersedes_fact_id is not null;

create or replace view app_private.current_merchant_tender_reward_facts
with (security_barrier=true) as
select f.*
from app_private.merchant_tender_reward_facts f
where f.status = 'active'
  and (f.valid_from is null or f.valid_from <= now())
  and (f.valid_to is null or f.valid_to > now())
  and (f.expires_at is null or f.expires_at > now());

create or replace view app_api.merchant_tender_reward_current
with (security_barrier=true) as
select
  f.fact_key,
  me.entity_key as merchant_key,
  ml.location_key,
  lp.entity_key as loyalty_program_key,
  lp.display_name as loyalty_program_name,
  pi.entity_key as payment_instrument_key,
  pi.display_name as payment_instrument_name,
  f.scope,
  f.rate_model,
  f.rate_percent,
  rp.entity_key as reference_program_key,
  f.reference_fraction,
  f.rounding_mode,
  f.confidence,
  f.source_checked_at,
  f.source_url,
  f.provenance
from app_private.current_merchant_tender_reward_facts f
join app_private.entities me on me.id = f.merchant_entity_id
join app_private.entities lp on lp.id = f.loyalty_program_entity_id
left join app_private.entities pi on pi.id = f.payment_instrument_entity_id
left join app_private.entities rp on rp.id = f.reference_program_entity_id
left join app_private.merchant_locations ml on ml.id = f.merchant_location_id;

create or replace view app_api.merchant_tender_reward_resolved
with (security_barrier=true) as
with candidates as (
  select
    ml.location_key,
    me.entity_key as merchant_key,
    me.display_name as merchant_name,
    f.fact_key,
    lp.entity_key as loyalty_program_key,
    lp.display_name as loyalty_program_name,
    pi.entity_key as payment_instrument_key,
    pi.display_name as payment_instrument_name,
    f.rate_model,
    f.rate_percent,
    rp.entity_key as reference_program_key,
    f.reference_fraction,
    f.rounding_mode,
    f.confidence,
    f.source_checked_at,
    f.source_url,
    f.provenance,
    (f.scope = 'chain_default') as inherited_from_chain,
    case when f.scope = 'branch' then 0 else 1 end as precedence
  from app_private.merchant_locations ml
  join app_private.entities me on me.id = ml.merchant_entity_id
  join app_private.current_merchant_tender_reward_facts f
    on f.merchant_entity_id = ml.merchant_entity_id
   and (f.scope = 'chain_default' or f.merchant_location_id = ml.id)
  join app_private.entities lp on lp.id = f.loyalty_program_entity_id
  left join app_private.entities pi on pi.id = f.payment_instrument_entity_id
  left join app_private.entities rp on rp.id = f.reference_program_entity_id
  where (ml.valid_from is null or ml.valid_from <= now())
    and (ml.valid_to is null or ml.valid_to > now())
), ranked as (
  select c.*,
         row_number() over (
           partition by c.location_key, c.loyalty_program_key, coalesce(c.payment_instrument_key, '')
           order by c.precedence, c.source_checked_at desc, c.fact_key desc
         ) as rn
  from candidates c
)
select
  location_key, merchant_key, merchant_name, fact_key,
  loyalty_program_key, loyalty_program_name,
  payment_instrument_key, payment_instrument_name,
  rate_model, rate_percent, reference_program_key, reference_fraction,
  rounding_mode, confidence, source_checked_at, source_url, provenance,
  inherited_from_chain
from ranked
where rn = 1;

revoke all on app_private.merchant_tender_reward_facts from public;
revoke all on app_private.current_merchant_tender_reward_facts from public;
revoke all on app_api.merchant_tender_reward_current from public;
revoke all on app_api.merchant_tender_reward_resolved from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'jro_runtime') then
    grant select on app_api.merchant_tender_reward_current to jro_runtime;
    grant select on app_api.merchant_tender_reward_resolved to jro_runtime;
  end if;
end
$$;

comment on table app_private.merchant_tender_reward_facts is 'Evidence-backed merchant loyalty earn rates conditioned on payment tender. Chain defaults may be overridden by sparse branch facts.';
comment on view app_api.merchant_tender_reward_resolved is 'Per-location tender-dependent merchant loyalty rules; branch facts override chain defaults.';

commit;
