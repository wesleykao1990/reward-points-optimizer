-- Resolve the seven station/area-only merchant seeds with current official
-- branch or station-building addresses. Stable location keys avoid generated
-- ID coupling.

update app_private.merchant_locations
set address = address || jsonb_build_object(
      'postal_code', '171-0022',
      'street', '南池袋1-28-2'
    ),
    metadata = metadata || jsonb_build_object(
      'address_source', 'official_station_store_page',
      'address_source_url', 'https://shop.jr-cross.co.jp/eki/spot/detail?code=1040188',
      'address_checked_at', '2026-08-24',
      'address_precision', 'station_building'
    ),
    updated_at = now()
where location_key = 'tokyo.ikebukuro.newdays.ikebukuro';

update app_private.merchant_locations
set address = address || jsonb_build_object(
      'postal_code', '171-0021',
      'street', '西池袋1-38-5',
      'site_detail', 'セイコービル1F'
    ),
    metadata = metadata || jsonb_build_object(
      'address_source', 'official_store_page',
      'address_source_url', 'https://shop.ringerhut.jp/detail/r0673/',
      'address_checked_at', '2026-08-24',
      'address_precision', 'street'
    ),
    updated_at = now()
where location_key = 'tokyo.ikebukuro.ringerhut.nishi-ikebukuro';

update app_private.merchant_locations
set address = address || jsonb_build_object(
      'postal_code', '171-0021',
      'street', '西池袋1-24-1',
      'site_detail', '宮川ビル'
    ),
    metadata = metadata || jsonb_build_object(
      'address_source', 'official_store_page',
      'address_source_url', 'https://stores.yoshinoya.com/yoshinoya/spot/detail?code=ysn_041448',
      'address_checked_at', '2026-08-24',
      'address_precision', 'street'
    ),
    updated_at = now()
where location_key = 'tokyo.ikebukuro.yoshinoya.north-exit';

update app_private.merchant_locations
set address = address || jsonb_build_object(
      'street', '丸の内1-9-1'
    ),
    metadata = metadata || jsonb_build_object(
      'address_source', 'official_station_store_page',
      'address_source_url', 'https://shop.jr-cross.co.jp/eki/spot/detail?code=1010222',
      'address_checked_at', '2026-08-24',
      'address_precision', 'station_building'
    ),
    updated_at = now()
where location_key = 'tokyo.marunouchi.newdays.gransta-south';

update app_private.merchant_locations
set address = address || jsonb_build_object(
      'postal_code', '150-0043',
      'street', '道玄坂1-1-1'
    ),
    metadata = metadata || jsonb_build_object(
      'address_source', 'official_station_store_page',
      'address_source_url', 'https://shop.jr-cross.co.jp/eki/spot/detail?code=1044400',
      'address_checked_at', '2026-08-24',
      'address_precision', 'station_building'
    ),
    updated_at = now()
where location_key = 'tokyo.shibuya.newdays.shibuya-shinminami';

update app_private.merchant_locations
set address = address || jsonb_build_object(
      'postal_code', '155-0031',
      'street', '北沢2-17-13'
    ),
    metadata = metadata || jsonb_build_object(
      'address_source', 'official_store_search',
      'address_source_url', 'https://md.mapion.co.jp/b/misterdonut/info/0515/',
      'address_checked_at', '2026-08-24',
      'address_precision', 'street'
    ),
    updated_at = now()
where location_key = 'tokyo.shimokitazawa.misterdonut.shimokitazawa';

update app_private.merchant_locations
set address = address || jsonb_build_object(
      'postal_code', '160-0022',
      'street', '新宿3-38-1'
    ),
    metadata = metadata || jsonb_build_object(
      'address_source', 'official_station_store_page',
      'address_source_url', 'https://shop.jr-cross.co.jp/eki/spot/detail?code=1048000',
      'address_checked_at', '2026-08-24',
      'address_precision', 'station_building'
    ),
    updated_at = now()
where location_key = 'tokyo.shinjuku.newdays.shinjuku';

create or replace function app_private.sync_merchant_location_coordinate_status()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.latitude is not null and new.longitude is not null then
    new.metadata := coalesce(new.metadata, '{}'::jsonb)
      || jsonb_build_object('coordinate_status', 'ready');
  elsif new.latitude is null and new.longitude is null then
    new.metadata := coalesce(new.metadata, '{}'::jsonb)
      || jsonb_build_object('coordinate_status', 'missing');
  end if;
  return new;
end
$function$;

revoke all on function app_private.sync_merchant_location_coordinate_status()
  from public, anon, authenticated;

drop trigger if exists merchant_locations_coordinate_status_trigger
  on app_private.merchant_locations;
create trigger merchant_locations_coordinate_status_trigger
before insert or update of latitude, longitude, metadata
on app_private.merchant_locations
for each row
execute function app_private.sync_merchant_location_coordinate_status();

update app_private.merchant_locations
set metadata = metadata || jsonb_build_object(
      'coordinate_status',
      case
        when latitude is not null and longitude is not null then 'ready'
        else 'missing'
      end
    ),
    updated_at = updated_at;
