-- Staged from db/0026_merchant_location_public_rpc.sql; edit the canonical source, not this file.
-- Canonical merchant-location spatial search contract.
-- Keeps merchant data private while exposing one bounded, browser-safe RPC.

begin;

create schema if not exists extensions;

do $extension$
begin
  if not exists (
    select 1 from pg_extension where extname = 'postgis'
  ) then
    execute 'create extension postgis with schema extensions';
  end if;
end
$extension$;

do $geo_column$
declare
  v_postgis_schema text;
begin
  select n.nspname
    into v_postgis_schema
  from pg_extension e
  join pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'postgis';

  if v_postgis_schema is null then
    raise exception 'postgis_extension_missing' using errcode = '55000';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'app_private'
      and table_name = 'merchant_locations'
      and column_name = 'geo'
  ) then
    execute format(
      'alter table app_private.merchant_locations add column geo %1$I.geography(Point,4326) generated always as (case when latitude is null or longitude is null then null::%1$I.geography else %1$I.st_setsrid(%1$I.st_makepoint(longitude::double precision, latitude::double precision),4326)::%1$I.geography end) stored',
      v_postgis_schema
    );
  end if;
end
$geo_column$;

do $coordinate_constraints$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'app_private.merchant_locations'::regclass
      and conname = 'merchant_locations_coordinate_pair_check'
  ) then
    alter table app_private.merchant_locations
      add constraint merchant_locations_coordinate_pair_check
      check ((latitude is null) = (longitude is null)) not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'app_private.merchant_locations'::regclass
      and conname = 'merchant_locations_japan_coordinate_check'
  ) then
    alter table app_private.merchant_locations
      add constraint merchant_locations_japan_coordinate_check
      check (
        latitude is null
        or (
          latitude between 20 and 46
          and longitude between 122 and 154
        )
      ) not valid;
  end if;
end
$coordinate_constraints$;

alter table app_private.merchant_locations
  validate constraint merchant_locations_coordinate_pair_check;
alter table app_private.merchant_locations
  validate constraint merchant_locations_japan_coordinate_check;

create index if not exists merchant_locations_geo_gist_idx
  on app_private.merchant_locations using gist (geo)
  where geo is not null;

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
  from public;

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

create or replace function app_api.nearby_merchants(
  p_latitude double precision,
  p_longitude double precision,
  p_radius_m integer default 1000,
  p_limit integer default 15
)
returns table (
  location_key text,
  merchant_key text,
  merchant_name text,
  location_name text,
  address jsonb,
  latitude double precision,
  longitude double precision,
  distance_m integer
)
language plpgsql
stable
security definer
set search_path = pg_catalog, extensions, public
set statement_timeout = '2s'
as $function$
declare
  v_radius integer := coalesce(p_radius_m, 1000);
  v_limit integer := coalesce(p_limit, 15);
begin
  if p_latitude is null or p_latitude < 20 or p_latitude > 46 then
    raise exception 'nearby_latitude_outside_japan' using errcode = '22023';
  end if;
  if p_longitude is null or p_longitude < 122 or p_longitude > 154 then
    raise exception 'nearby_longitude_outside_japan' using errcode = '22023';
  end if;
  if v_radius < 100 or v_radius > 5000 then
    raise exception 'nearby_radius_invalid' using errcode = '22023';
  end if;
  if v_limit < 1 or v_limit > 25 then
    raise exception 'nearby_limit_invalid' using errcode = '22023';
  end if;

  return query
  with origin as (
    select st_setsrid(st_makepoint(p_longitude, p_latitude), 4326)::geography as geo
  ),
  candidates as (
    select
      ml.location_key,
      me.entity_key as merchant_key,
      me.display_name as merchant_name,
      ml.display_name as location_name,
      ml.address,
      ml.latitude::double precision as latitude,
      ml.longitude::double precision as longitude,
      round(st_distance(ml.geo, origin.geo))::integer as distance_m
    from app_private.merchant_locations ml
    join app_private.entities me
      on me.id = ml.merchant_entity_id
    cross join origin
    where me.entity_type = 'merchant'
      and me.status = 'active'
      and ml.geo is not null
      and (ml.valid_from is null or ml.valid_from <= now())
      and (ml.valid_to is null or ml.valid_to > now())
      and st_dwithin(ml.geo, origin.geo, v_radius)
  )
  select
    candidates.location_key,
    candidates.merchant_key,
    candidates.merchant_name,
    candidates.location_name,
    candidates.address,
    candidates.latitude,
    candidates.longitude,
    candidates.distance_m
  from candidates
  order by candidates.distance_m, candidates.location_key
  limit v_limit;
end
$function$;

revoke all on function app_api.nearby_merchants(
  double precision,
  double precision,
  integer,
  integer
) from public;

do $internal_grants$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function app_api.nearby_merchants(
      double precision,
      double precision,
      integer,
      integer
    ) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function app_api.nearby_merchants(
      double precision,
      double precision,
      integer,
      integer
    ) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function app_api.nearby_merchants(
      double precision,
      double precision,
      integer,
      integer
    ) to service_role;
  end if;
  if exists (select 1 from pg_roles where rolname = 'jro_runtime') then
    grant execute on function app_api.nearby_merchants(
      double precision,
      double precision,
      integer,
      integer
    ) to jro_runtime;
  end if;
end
$internal_grants$;

drop function if exists public.nearby_merchants(
  double precision,
  double precision,
  integer,
  integer
);

create function public.nearby_merchants(
  p_latitude double precision,
  p_longitude double precision,
  p_radius_m integer default 1000,
  p_limit integer default 15
)
returns table (
  location_key text,
  merchant_key text,
  merchant_name text,
  location_name text,
  address jsonb,
  latitude double precision,
  longitude double precision,
  distance_m integer,
  coordinate_precision text,
  coordinate_attribution text
)
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '2s'
as $function$
begin
  return query
  with nearby as materialized (
    select *
    from app_api.nearby_merchants(
      p_latitude,
      p_longitude,
      p_radius_m,
      p_limit
    )
  )
  select
    n.location_key,
    n.merchant_key,
    n.merchant_name,
    n.location_name,
    n.address,
    n.latitude,
    n.longitude,
    n.distance_m,
    coalesce(
      ml.metadata ->> 'coordinate_precision',
      case
        when ml.metadata ->> 'coordinate_source' like 'official_%'
          then 'official_map_point'
        else 'unknown'
      end
    ) as coordinate_precision,
    ml.metadata ->> 'coordinate_attribution' as coordinate_attribution
  from nearby n
  join app_private.merchant_locations ml
    on ml.location_key = n.location_key
  order by n.distance_m, n.location_key;
end
$function$;

comment on function public.nearby_merchants(
  double precision,
  double precision,
  integer,
  integer
) is
  'Version 1 bounded browser-safe PostGIS search for active Japanese merchant branches. Supplied user coordinates are used transiently and are never persisted. Source attribution is returned when required.';

revoke all on function public.nearby_merchants(
  double precision,
  double precision,
  integer,
  integer
) from public;

do $public_grants$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    grant execute on function public.nearby_merchants(
      double precision,
      double precision,
      integer,
      integer
    ) to anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function public.nearby_merchants(
      double precision,
      double precision,
      integer,
      integer
    ) to authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.nearby_merchants(
      double precision,
      double precision,
      integer,
      integer
    ) to service_role;
  end if;
end
$public_grants$;

notify pgrst, 'reload schema';

commit;
