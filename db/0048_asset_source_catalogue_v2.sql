begin;

create or replace view app_api.asset_source_catalogue
with (security_barrier = true)
as
select
  e.entity_key as asset_id,
  e.display_name,
  e.entity_type,
  coalesce(
    p.official_product_url,
    nullif(e.metadata ->> 'source_url', ''),
    nullif(e.metadata ->> 'official_url', ''),
    trusted.source_url
  ) as source_page_url,
  nullif(e.metadata ->> 'merchant_key', '') as merchant_key,
  nullif(e.metadata ->> 'brand_scope', '') as brand_scope,
  nullif(e.metadata ->> 'merchant_group', '') as merchant_group,
  e.metadata,
  coalesce(
    nullif(e.metadata ->> 'source_image_url', ''),
    nullif(p.metadata ->> 'source_image_url', ''),
    nullif(trusted.registry_payload ->> 'source_image_url', '')
  ) as source_image_url,
  case
    when p.official_product_url is not null then 'credit_card_catalogue_profile'
    when nullif(e.metadata ->> 'source_url', '') is not null then 'entity_metadata'
    when nullif(e.metadata ->> 'official_url', '') is not null then 'entity_metadata'
    when trusted.source_url is not null then 'trusted_source_registry'
    else null
  end as source_origin,
  greatest(
    e.updated_at,
    p.checked_at,
    trusted.content_verified_on::timestamptz
  ) as checked_at
from app_private.entities e
left join app_private.credit_card_catalogue_profiles p
  on p.card_id = e.entity_key
left join lateral (
  select
    ts.source_url,
    ts.registry_payload,
    ts.content_verified_on
  from app_private.trusted_sources ts
  where ts.verification_status = 'content_verified'
    and (
      ts.authority_scope ? e.entity_key
      or ts.registry_payload ->> 'card_id' = e.entity_key
      or ts.authority_scope ? (e.metadata ->> 'canonical_family_id')
      or ts.authority_scope ? (e.metadata ->> 'family_id')
    )
  order by
    case when ts.authority_scope ? e.entity_key then 0 else 1 end,
    ts.content_verified_on desc nulls last,
    ts.source_key
  limit 1
) trusted on true
where e.status = 'active'
  and e.entity_type in (
    'credit_card',
    'loyalty_program',
    'stored_value_program',
    'electronic_money',
    'qr_wallet',
    'payment_interface',
    'prepaid_card'
  );

comment on view app_api.asset_source_catalogue is
  'Build-time projection of active financial entities and first-party artwork source metadata. Restricted to jro_runtime and excludes economic facts, evidence, and user data.';

revoke all on app_api.asset_source_catalogue from public;
revoke all on app_api.asset_source_catalogue from anon;
revoke all on app_api.asset_source_catalogue from authenticated;
grant select on app_api.asset_source_catalogue to jro_runtime;

commit;
