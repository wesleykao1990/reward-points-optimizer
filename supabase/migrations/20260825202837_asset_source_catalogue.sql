-- Staged from db/0036_asset_source_catalogue.sql; edit the canonical source, not this file.
begin;

create or replace view app_api.asset_source_catalogue
with (security_barrier = true)
as
select
  e.entity_key as asset_id,
  e.display_name,
  e.entity_type,
  case
    when e.entity_type = 'credit_card' then p.official_product_url
    else nullif(e.metadata ->> 'source_url', '')
  end as source_page_url,
  nullif(e.metadata ->> 'merchant_key', '') as merchant_key,
  nullif(e.metadata ->> 'brand_scope', '') as brand_scope,
  nullif(e.metadata ->> 'merchant_group', '') as merchant_group
from app_private.entities e
left join app_private.credit_card_catalogue_profiles p
  on p.card_id = e.entity_key
where e.status = 'active'
  and (
    e.entity_key like 'program.%'
    or (
      e.entity_key like 'instrument.%'
      and e.entity_type in (
        'credit_card',
        'electronic_money',
        'payment_interface',
        'prepaid_card',
        'qr_wallet',
        'stored_value_program'
      )
    )
  );

comment on view app_api.asset_source_catalogue is
  'Bounded build-time projection of active financial entities and first-party artwork source pages. Excludes economic facts, evidence, private metadata, and user data.';

revoke all on app_api.asset_source_catalogue from public;
revoke all on app_api.asset_source_catalogue from anon;
revoke all on app_api.asset_source_catalogue from authenticated;
grant select on app_api.asset_source_catalogue to jro_runtime;

commit;
