-- Resolve branch-specific acceptance before chain defaults.

begin;

create or replace view app_api.merchant_acceptance_resolved
with (security_barrier=true) as
with current_facts as (
  select * from app_private.current_merchant_acceptance_facts
), branch_rows as (
  select
    bf.fact_key,
    me.entity_key as merchant_key,
    me.display_name as merchant_name,
    ml.location_key,
    ml.display_name as location_name,
    ml.address,
    ml.latitude,
    ml.longitude,
    ml.external_place_ids,
    ml.metadata as location_metadata,
    ie.entity_key as instrument_key,
    ie.display_name as instrument_name,
    bf.action,
    bf.acceptance_state,
    bf.confidence,
    bf.source_checked_at,
    bf.expires_at,
    bf.source_url,
    false as inherited_from_chain
  from current_facts bf
  join app_private.entities me on me.id=bf.merchant_entity_id
  join app_private.entities ie on ie.id=bf.instrument_entity_id
  join app_private.merchant_locations ml on ml.id=bf.merchant_location_id
  where bf.scope='branch'
), inherited_rows as (
  select
    cf.fact_key,
    me.entity_key as merchant_key,
    me.display_name as merchant_name,
    ml.location_key,
    ml.display_name as location_name,
    ml.address,
    ml.latitude,
    ml.longitude,
    ml.external_place_ids,
    ml.metadata as location_metadata,
    ie.entity_key as instrument_key,
    ie.display_name as instrument_name,
    cf.action,
    cf.acceptance_state,
    cf.confidence,
    cf.source_checked_at,
    cf.expires_at,
    cf.source_url,
    true as inherited_from_chain
  from current_facts cf
  join app_private.entities me on me.id=cf.merchant_entity_id
  join app_private.entities ie on ie.id=cf.instrument_entity_id
  join app_private.merchant_locations ml on ml.merchant_entity_id=cf.merchant_entity_id
  where cf.scope='chain_default'
    and not exists (
      select 1 from current_facts bf
      where bf.scope='branch'
        and bf.merchant_location_id=ml.id
        and bf.instrument_entity_id=cf.instrument_entity_id
        and bf.action=cf.action
    )
)
select * from branch_rows
union all
select * from inherited_rows;

revoke all on app_api.merchant_acceptance_resolved from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname='jro_runtime') then
    grant select on app_api.merchant_acceptance_resolved to jro_runtime;
  end if;
end $$;

comment on view app_api.merchant_acceptance_resolved is 'Resolved branch compatibility: active branch evidence wins; otherwise active chain defaults are inherited. Collected facts are usable immediately and unresolved negative correction signals suppress them.';

commit;
