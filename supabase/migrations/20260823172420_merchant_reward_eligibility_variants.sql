begin;

create or replace view app_api.merchant_tender_reward_resolved
with (security_barrier=true) as
with candidates as (
  select
    ml.location_key,me.entity_key as merchant_key,me.display_name as merchant_name,
    f.fact_key,lp.entity_key as loyalty_program_key,lp.display_name as loyalty_program_name,
    pi.entity_key as payment_instrument_key,pi.display_name as payment_instrument_name,
    f.rate_model,f.rate_percent,rp.entity_key as reference_program_key,f.reference_fraction,
    f.rounding_mode,f.confidence,f.source_checked_at,f.source_url,f.provenance,
    (f.scope='chain_default') as inherited_from_chain,f.component_kind,f.stacking_mode,
    f.choice_group,f.eligibility,f.reward_units,f.spend_jpy,f.tax_basis,f.channel,
    case when f.scope='branch' then 0 else 1 end as precedence
  from app_private.merchant_locations ml
  join app_private.entities me on me.id=ml.merchant_entity_id
  join app_private.current_merchant_tender_reward_facts f
    on f.merchant_entity_id=ml.merchant_entity_id
   and (f.scope='chain_default' or f.merchant_location_id=ml.id)
  join app_private.entities lp on lp.id=f.loyalty_program_entity_id
  left join app_private.entities pi on pi.id=f.payment_instrument_entity_id
  left join app_private.entities rp on rp.id=f.reference_program_entity_id
  where (ml.valid_from is null or ml.valid_from <= now())
    and (ml.valid_to is null or ml.valid_to > now())
), ranked as (
 select c.*,
   row_number() over (
     partition by c.location_key,c.loyalty_program_key,coalesce(c.payment_instrument_key,''),c.component_kind,coalesce(c.choice_group,''),c.channel,c.eligibility
     order by c.precedence,c.source_checked_at desc,c.fact_key desc
   ) rn
 from candidates c
)
select location_key,merchant_key,merchant_name,fact_key,loyalty_program_key,loyalty_program_name,
       payment_instrument_key,payment_instrument_name,rate_model,rate_percent,reference_program_key,
       reference_fraction,rounding_mode,confidence,source_checked_at,source_url,provenance,
       inherited_from_chain,component_kind,stacking_mode,choice_group,eligibility,
       reward_units,spend_jpy,tax_basis,channel
from ranked where rn=1;

revoke all on app_api.merchant_tender_reward_resolved from public;
do $$ begin if exists(select 1 from pg_roles where rolname='jro_runtime') then grant select on app_api.merchant_tender_reward_resolved to jro_runtime; end if; end $$;

commit;
