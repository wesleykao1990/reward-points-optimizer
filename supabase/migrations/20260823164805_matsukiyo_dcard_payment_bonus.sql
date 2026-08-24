begin;

with merchant as (select id from app_private.entities where entity_key='merchant.matsukiyo'),
     dpoint as (select id from app_private.entities where entity_key='program.jp.dpoint'),
     dcard as (select id from app_private.entities where entity_key='instrument.card.d')
insert into app_private.merchant_tender_reward_facts (
  fact_key,merchant_entity_id,loyalty_program_entity_id,payment_instrument_entity_id,
  scope,rate_model,rate_percent,rounding_mode,source_kind,source_ref,source_url,
  source_checked_at,confidence,provenance,status,
  component_kind,stacking_mode,choice_group,eligibility
)
select
  'mtr_matsukiyo_dcard_special_bonus',m.id,d.id,c.id,
  'chain_default','points_percent',2,'floor','official_store_page',
  'dpoint:matsukiyo:dcard-special',
  'https://dpoint.docomo.ne.jp/store/item/?id=70765',
  '2026-08-23T00:00:00Z'::timestamptz,0.99,
  jsonb_build_object(
    'note','d Card special-store points: 2 d Points per JPY100 tax-inclusive, additional to normal d Card payment points.',
    'tax_basis','tax_inclusive',
    'points_per_jpy_100',2,
    'additive_to_card_base_reward',true
  ),
  'active','payment_bonus','additive',null,
  jsonb_build_object(
    'eligible_card_family','card.d',
    'eligible_payment_modes',jsonb_build_array('credit_card','dcard_id'),
    'eligible_memberships',jsonb_build_array('d_card','d_card_gold_u','d_card_gold','d_card_platinum'),
    'excluded_products_possible',true
  )
from merchant m cross join dpoint d cross join dcard c
on conflict (fact_key) do update set
  rate_percent=excluded.rate_percent,
  source_url=excluded.source_url,
  source_checked_at=excluded.source_checked_at,
  confidence=excluded.confidence,
  provenance=app_private.merchant_tender_reward_facts.provenance||excluded.provenance,
  component_kind=excluded.component_kind,
  stacking_mode=excluded.stacking_mode,
  choice_group=excluded.choice_group,
  eligibility=app_private.merchant_tender_reward_facts.eligibility||excluded.eligibility,
  status='active';

commit;
