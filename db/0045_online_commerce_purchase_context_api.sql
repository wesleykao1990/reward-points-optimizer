begin;

create or replace function app_api.commerce_purchase_context(p_surface_key text)
returns table(
  surface_key text,
  display_name text,
  canonical_host text,
  payment_policy_mode text,
  requires_seller_resolution boolean,
  payment_methods jsonb,
  loyalty_actions jsonb,
  reward_components jsonb,
  latest_checked_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog, app_private, app_api
as $$
with target as (
  select s.id,s.surface_key,s.display_name,s.canonical_host,s.payment_policy_mode,c.requires_seller_resolution
  from app_private.commerce_surfaces s
  join app_private.online_commerce_catalogue c on c.surface_id=s.id and c.status='active'
  where s.surface_key=p_surface_key and s.status='active'
), acceptance as (
  select f.surface_id,
    coalesce(jsonb_agg(jsonb_build_object(
      'instrument_key',e.entity_key,'instrument_name',e.display_name,'action',f.action,
      'acceptance_state',f.acceptance_state,'split_tender_mode',f.split_tender_mode,
      'amount_constraint',f.amount_constraint,'applicability',f.applicability,
      'confidence',f.confidence,'source_checked_at',f.source_checked_at,'source_url',f.source_url
    ) order by e.display_name,f.action) filter (where f.action='pay'),'[]'::jsonb) payment_methods,
    coalesce(jsonb_agg(jsonb_build_object(
      'instrument_key',e.entity_key,'instrument_name',e.display_name,'action',f.action,
      'acceptance_state',f.acceptance_state,'applicability',f.applicability,
      'confidence',f.confidence,'source_checked_at',f.source_checked_at,'source_url',f.source_url
    ) order by e.display_name,f.action) filter (where f.action in ('earn','redeem')),'[]'::jsonb) loyalty_actions,
    max(f.source_checked_at) latest_checked_at
  from app_private.current_commerce_acceptance_facts f
  join app_private.entities e on e.id=f.instrument_entity_id
  join target t on t.id=f.surface_id
  group by f.surface_id
), rewards as (
  select f.surface_id,
    coalesce(jsonb_agg(jsonb_build_object(
      'fact_key',f.fact_key,'program_key',lp.entity_key,'program_name',lp.display_name,
      'payment_instrument_key',pi.entity_key,'payment_instrument_name',pi.display_name,
      'component_kind',f.component_kind,'value_model',f.value_model,'amount_basis',f.amount_basis,
      'rankability',f.rankability,'stacking_mode',f.stacking_mode,'choice_group',f.choice_group,
      'eligibility',f.eligibility,'cap_model',f.cap_model,'confidence',f.confidence,
      'source_checked_at',f.source_checked_at,'source_url',f.source_url
    ) order by f.fact_key),'[]'::jsonb) reward_components,
    max(f.source_checked_at) latest_checked_at
  from app_private.current_commerce_reward_facts f
  join target t on t.id=f.surface_id
  left join app_private.entities lp on lp.id=f.loyalty_program_entity_id
  left join app_private.entities pi on pi.id=f.payment_instrument_entity_id
  group by f.surface_id
)
select t.surface_key,t.display_name,t.canonical_host,t.payment_policy_mode,t.requires_seller_resolution,
       coalesce(a.payment_methods,'[]'::jsonb),coalesce(a.loyalty_actions,'[]'::jsonb),
       coalesce(r.reward_components,'[]'::jsonb),greatest(a.latest_checked_at,r.latest_checked_at)
from target t
left join acceptance a on a.surface_id=t.id
left join rewards r on r.surface_id=t.id
$$;

revoke all on function app_api.commerce_purchase_context(text) from public;
grant execute on function app_api.commerce_purchase_context(text) to jro_runtime;

commit;
