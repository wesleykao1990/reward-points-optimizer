-- Purchase-oriented merchant projection: chain defaults are the common case;
-- branch facts are sparse confirmations/exceptions layered on top.

begin;

create or replace view app_api.merchant_branch_rule_details
with (security_barrier=true) as
select
  bf.fact_key,
  me.entity_key as merchant_key,
  ml.location_key,
  ie.entity_key as instrument_key,
  ie.display_name as instrument_name,
  bf.action,
  bf.acceptance_state as branch_state,
  cf.acceptance_state as chain_state,
  case
    when cf.id is null then 'branch_only'
    when cf.acceptance_state = bf.acceptance_state then 'branch_confirmation'
    else 'branch_exception'
  end as branch_relation,
  bf.confidence,
  bf.source_checked_at,
  bf.source_url
from app_private.current_merchant_acceptance_facts bf
join app_private.entities me on me.id = bf.merchant_entity_id
join app_private.entities ie on ie.id = bf.instrument_entity_id
join app_private.merchant_locations ml on ml.id = bf.merchant_location_id
left join lateral (
  select c.id, c.acceptance_state
  from app_private.current_merchant_acceptance_facts c
  where c.scope = 'chain_default'
    and c.merchant_entity_id = bf.merchant_entity_id
    and c.instrument_entity_id = bf.instrument_entity_id
    and c.action = bf.action
  order by c.source_checked_at desc, c.created_at desc
  limit 1
) cf on true
where bf.scope = 'branch';

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
    when count(*) filter (where not r.inherited_from_chain) > 0 then 'chain_with_branch_confirmations'
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

revoke all on app_api.merchant_branch_rule_details from public;
revoke all on app_api.merchant_purchase_context from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname='jro_runtime') then
    grant select on app_api.merchant_branch_rule_details to jro_runtime;
    grant select on app_api.merchant_purchase_context to jro_runtime;
  end if;
end
$$;

comment on view app_api.merchant_branch_rule_details is 'Classifies branch acceptance facts as true exceptions, confirmations, or branch-only rules relative to chain defaults.';
comment on view app_api.merchant_purchase_context is 'Location-level purchase context: resolved payment methods and loyalty actions plus explicit chain-default/branch-exception provenance.';

commit;
