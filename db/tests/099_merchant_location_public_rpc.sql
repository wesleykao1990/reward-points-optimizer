\set ON_ERROR_STOP on

begin;

insert into app_private.entities (
  entity_key,
  entity_type,
  display_name,
  locale,
  status,
  metadata
) values (
  'merchant.test.nearby-rpc',
  'merchant',
  'Nearby RPC Test Merchant',
  'ja-JP',
  'active',
  '{"test_fixture":true}'::jsonb
)
on conflict (entity_key) do update
set display_name = excluded.display_name,
    status = 'active',
    metadata = app_private.entities.metadata || excluded.metadata,
    updated_at = now();

insert into app_private.merchant_locations (
  location_key,
  merchant_entity_id,
  display_name,
  address,
  latitude,
  longitude,
  confidence,
  metadata
)
select
  'test.nearby-rpc.tokyo-station',
  e.id,
  'Nearby RPC Tokyo Station Test Branch',
  '{"prefecture":"東京都","ward":"千代田区","street":"丸の内1-9-1"}'::jsonb,
  35.681236,
  139.767125,
  'official_directory',
  '{"test_fixture":true,"coordinate_source":"official_test_fixture","coordinate_precision":"official_map_point"}'::jsonb
from app_private.entities e
where e.entity_key = 'merchant.test.nearby-rpc'
on conflict (location_key) do update
set merchant_entity_id = excluded.merchant_entity_id,
    display_name = excluded.display_name,
    address = excluded.address,
    latitude = excluded.latitude,
    longitude = excluded.longitude,
    confidence = excluded.confidence,
    metadata = app_private.merchant_locations.metadata || excluded.metadata,
    valid_to = null,
    updated_at = now();

do $test$
begin
  if to_regprocedure(
    'public.nearby_merchants(double precision,double precision,integer,integer)'
  ) is null then
    raise exception 'public_nearby_merchants_missing';
  end if;

  if to_regprocedure(
    'app_api.nearby_merchants(double precision,double precision,integer,integer)'
  ) is null then
    raise exception 'internal_nearby_merchants_missing';
  end if;

  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'app_private'
      and tablename = 'merchant_locations'
      and indexname = 'merchant_locations_geo_gist_idx'
  ) then
    raise exception 'merchant_location_geo_index_missing';
  end if;

  if not exists (
    select 1
    from app_private.merchant_locations
    where location_key = 'test.nearby-rpc.tokyo-station'
      and geo is not null
      and metadata ->> 'coordinate_status' = 'ready'
  ) then
    raise exception 'merchant_location_geo_generation_failed';
  end if;

  if not has_function_privilege(
    'anon',
    'public.nearby_merchants(double precision,double precision,integer,integer)',
    'EXECUTE'
  ) then
    raise exception 'anon_public_rpc_execute_missing';
  end if;

  if not has_function_privilege(
    'authenticated',
    'public.nearby_merchants(double precision,double precision,integer,integer)',
    'EXECUTE'
  ) then
    raise exception 'authenticated_public_rpc_execute_missing';
  end if;

  if has_function_privilege(
    'anon',
    'app_api.nearby_merchants(double precision,double precision,integer,integer)',
    'EXECUTE'
  ) then
    raise exception 'anon_internal_rpc_execute_leaked';
  end if;

  if has_table_privilege('anon', 'app_private.merchant_locations', 'SELECT') then
    raise exception 'anon_private_location_select_leaked';
  end if;
end
$test$;

set local role anon;

select 1 / case when exists (
  select 1
  from public.nearby_merchants(35.681236, 139.767125, 1000, 25)
  where location_key = 'test.nearby-rpc.tokyo-station'
    and merchant_key = 'merchant.test.nearby-rpc'
    and distance_m = 0
    and coordinate_precision = 'official_map_point'
) then 1 else 0 end as anon_nearby_rpc_contract;

reset role;

do $test$
begin
  begin
    perform 1 from public.nearby_merchants(0, 0, 1000, 15);
    raise exception 'expected_invalid_coordinate_rejection';
  exception when sqlstate '22023' then
    null;
  end;

  begin
    perform 1 from public.nearby_merchants(35.68, 139.76, 99, 15);
    raise exception 'expected_invalid_radius_rejection';
  exception when sqlstate '22023' then
    null;
  end;

  begin
    perform 1 from public.nearby_merchants(35.68, 139.76, 1000, 26);
    raise exception 'expected_invalid_limit_rejection';
  exception when sqlstate '22023' then
    null;
  end;
end
$test$;

rollback;
