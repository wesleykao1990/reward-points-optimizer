begin;

create or replace view app_api.merchant_purchase_context
with (security_barrier=true) as
with resolved as (
  select
    r.fact_key,
    r.merchant_key,
    r.merchant_name,
    r.location_key,
    r.location_name,
    r.address,
    r.latitude,
    r.longitude,
    r.external_place_ids,
    r.location_metadata,
    r.instrument_key,
    r.instrument_name,
    r.action,
    r.acceptance_state,
    r.confidence,
    r.source_checked_at,
    r.expires_at,
    r.source_url,
    r.inherited_from_chain,
    ie.entity_type as instrument_type
  from app_api.merchant_acceptance_resolved r
  join app_private.entities ie on ie.entity_key = r.instrument_key
), branch_summary as (
  select
    location_key,
    count(*) filter (where branch_relation = 'branch_exception')::integer as branch_exception_count,
    count(*) filter (where branch_relation = 'branch_confirmation')::integer as branch_confirmation_count,
    count(*) filter (where branch_relation = 'branch_only')::integer as branch_only_count
  from app_api.merchant_branch_rule_details
  group by location_key
)
select
  l.location_key,
  l.merchant_key,
  l.merchant_name,
  l.location_name,
  l.address,
  l.latitude,
  l.longitude,
  l.external_place_ids,
  l.confidence as location_confidence,
  coalesce(
    jsonb_agg(
      jsonb_build_object(
        'instrument_key', r.instrument_key,
        'instrument_name', r.instrument_name,
        'instrument_type', r.instrument_type,
        'state', r.acceptance_state,
        'confidence', r.confidence,
        'rule_origin', case when r.inherited_from_chain then 'chain_default' else 'branch' end,
        'checked_at', r.source_checked_at
      ) order by r.instrument_name
    ) filter (where r.action = 'pay'),
    '[]'::jsonb
  ) as payment_methods,
  coalesce(
    jsonb_agg(
      jsonb_build_object(
        'program_key', r.instrument_key,
        'program_name', r.instrument_name,
        'action', r.action,
        'state', r.acceptance_state,
        'confidence', r.confidence,
        'rule_origin', case when r.inherited_from_chain then 'chain_default' else 'branch' end,
        'checked_at', r.source_checked_at
      ) order by r.instrument_name, r.action
    ) filter (where r.action in ('earn','redeem')),
    '[]'::jsonb
  ) as loyalty_actions,
  count(*) filter (where r.inherited_from_chain)::integer as chain_inherited_fact_count,
  count(*) filter (where not r.inherited_from_chain)::integer as branch_specific_fact_count,
  coalesce(bs.branch_exception_count,0) as branch_exception_count,
  coalesce(bs.branch_confirmation_count,0) as branch_confirmation_count,
  coalesce(bs.branch_only_count,0) as branch_only_count,
  case
    when coalesce(bs.branch_exception_count,0) > 0 then 'chain_with_branch_exceptions'
    when coalesce(bs.branch_only_count,0) > 0 and coalesce(bs.branch_confirmation_count,0) > 0 then 'chain_with_branch_rules'
    when coalesce(bs.branch_only_count,0) > 0 then 'branch_specific_rules'
    when coalesce(bs.branch_confirmation_count,0) > 0 then 'chain_with_branch_confirmations'
    else 'chain_default'
  end as rule_model,
  max(r.source_checked_at) as newest_rule_checked_at
from app_api.merchant_nearby_locations l
left join resolved r on r.location_key = l.location_key
left join branch_summary bs on bs.location_key = l.location_key
group by
  l.location_key,l.merchant_key,l.merchant_name,l.location_name,l.address,
  l.latitude,l.longitude,l.external_place_ids,l.confidence,
  bs.branch_exception_count,bs.branch_confirmation_count,bs.branch_only_count;

comment on view app_api.merchant_purchase_context is 'Location-level purchase context with explicit chain-default, branch-confirmation, branch-only, and branch-exception classification.';

commit;
