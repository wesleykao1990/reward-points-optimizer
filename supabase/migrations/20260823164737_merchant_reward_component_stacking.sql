begin;

alter table app_private.merchant_tender_reward_facts
  add column if not exists component_kind text not null default 'merchant_loyalty'
    check (component_kind in ('merchant_loyalty','payment_bonus','campaign_bonus','other')),
  add column if not exists stacking_mode text not null default 'additive'
    check (stacking_mode in ('additive','exclusive_choice')),
  add column if not exists choice_group text null,
  add column if not exists eligibility jsonb not null default '{}'::jsonb;

alter table app_private.merchant_tender_reward_facts
  drop constraint if exists merchant_tender_reward_choice_group_check;
alter table app_private.merchant_tender_reward_facts
  add constraint merchant_tender_reward_choice_group_check check (
    (stacking_mode='exclusive_choice' and choice_group is not null and length(choice_group) between 1 and 120)
    or (stacking_mode='additive' and choice_group is null)
  );

update app_private.merchant_tender_reward_facts
set component_kind='merchant_loyalty',stacking_mode='exclusive_choice',choice_group='biccamera.loyalty_earn',
    eligibility=eligibility||jsonb_build_object('selection_scope','merchant_loyalty_program')
where fact_key like 'mtr_bic_%';

update app_private.merchant_tender_reward_facts
set component_kind='merchant_loyalty',stacking_mode='additive',choice_group=null,
    eligibility=eligibility||jsonb_build_object('stackable_pair',true)
where fact_key in ('mtr_matsukiyo_ownpoint_base','mtr_matsukiyo_dpoint_base');

update app_private.merchant_tender_reward_facts
set component_kind='merchant_loyalty',stacking_mode='additive',choice_group=null,
    eligibility=eligibility||jsonb_build_object('welcia_member_linked_cards_required_for_double',true)
where fact_key in ('mtr_welcia_waonpoint_base','mtr_welcia_vpoint_base');

create or replace view app_private.current_merchant_tender_reward_facts
with (security_barrier=true) as
select f.*
from app_private.merchant_tender_reward_facts f
where f.status='active'
  and (f.valid_from is null or f.valid_from<=now())
  and (f.valid_to is null or f.valid_to>now())
  and (f.expires_at is null or f.expires_at>now());

create or replace view app_api.merchant_tender_reward_current
with (security_barrier=true) as
select
  f.fact_key,me.entity_key as merchant_key,ml.location_key,
  lp.entity_key as loyalty_program_key,lp.display_name as loyalty_program_name,
  pi.entity_key as payment_instrument_key,pi.display_name as payment_instrument_name,
  f.scope,f.rate_model,f.rate_percent,rp.entity_key as reference_program_key,f.reference_fraction,
  f.rounding_mode,
  f.confidence,f.source_checked_at,f.source_url,f.provenance,
  f.component_kind,f.stacking_mode,f.choice_group,f.eligibility
from app_private.current_merchant_tender_reward_facts f
join app_private.entities me on me.id=f.merchant_entity_id
join app_private.entities lp on lp.id=f.loyalty_program_entity_id
left join app_private.entities pi on pi.id=f.payment_instrument_entity_id
left join app_private.entities rp on rp.id=f.reference_program_entity_id
left join app_private.merchant_locations ml on ml.id=f.merchant_location_id;

create or replace view app_api.merchant_tender_reward_resolved
with (security_barrier=true) as
with candidates as (
  select ml.location_key,me.entity_key as merchant_key,me.display_name as merchant_name,
         f.fact_key,lp.entity_key as loyalty_program_key,lp.display_name as loyalty_program_name,
         pi.entity_key as payment_instrument_key,pi.display_name as payment_instrument_name,
         f.rate_model,f.rate_percent,rp.entity_key as reference_program_key,f.reference_fraction,
         f.rounding_mode,
         f.confidence,f.source_checked_at,f.source_url,f.provenance,
         (f.scope='chain_default') as inherited_from_chain,
         f.component_kind,f.stacking_mode,f.choice_group,f.eligibility,
         case when f.scope='branch' then 0 else 1 end as precedence
  from app_private.merchant_locations ml
  join app_private.entities me on me.id=ml.merchant_entity_id
  join app_private.current_merchant_tender_reward_facts f
    on f.merchant_entity_id=ml.merchant_entity_id
   and (f.scope='chain_default' or f.merchant_location_id=ml.id)
  join app_private.entities lp on lp.id=f.loyalty_program_entity_id
  left join app_private.entities pi on pi.id=f.payment_instrument_entity_id
  left join app_private.entities rp on rp.id=f.reference_program_entity_id
  where (ml.valid_from is null or ml.valid_from<=now())
    and (ml.valid_to is null or ml.valid_to>now())
), ranked as (
  select c.*,
         row_number() over (
           partition by c.location_key,c.loyalty_program_key,coalesce(c.payment_instrument_key,''),c.component_kind,coalesce(c.choice_group,'')
           order by c.precedence,c.source_checked_at desc,c.fact_key desc
         ) as rn
  from candidates c
)
select location_key,merchant_key,merchant_name,fact_key,
       loyalty_program_key,loyalty_program_name,payment_instrument_key,payment_instrument_name,
       rate_model,rate_percent,reference_program_key,reference_fraction,rounding_mode,
       confidence,source_checked_at,source_url,provenance,inherited_from_chain,
       component_kind,stacking_mode,choice_group,eligibility
from ranked where rn=1;

comment on column app_private.merchant_tender_reward_facts.component_kind is 'Semantic reward component: merchant loyalty, payment-specific bonus, campaign bonus, or other.';
comment on column app_private.merchant_tender_reward_facts.stacking_mode is 'additive means this component may stack; exclusive_choice means select at most one component from choice_group.';
comment on column app_private.merchant_tender_reward_facts.choice_group is 'Mutual-exclusion group for alternative earning programs such as Bic Point vs d/Rakuten Point.';
comment on column app_private.merchant_tender_reward_facts.eligibility is 'Structured eligibility conditions not safely reducible to rate alone.';

commit;
