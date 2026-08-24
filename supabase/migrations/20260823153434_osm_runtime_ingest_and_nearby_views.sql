begin;

create index if not exists merchant_locations_geo_idx
  on app_private.merchant_locations (latitude, longitude)
  where latitude is not null and longitude is not null;

create or replace view app_api.merchant_nearby_locations
with (security_barrier=true) as
select
  ml.location_key,
  me.entity_key as merchant_key,
  me.display_name as merchant_name,
  ml.display_name as location_name,
  ml.address,
  ml.latitude,
  ml.longitude,
  ml.external_place_ids,
  ml.confidence,
  ml.valid_from,
  ml.valid_to,
  ml.metadata
from app_private.merchant_locations ml
join app_private.entities me on me.id = ml.merchant_entity_id
where me.entity_type = 'merchant'
  and me.status = 'active'
  and (ml.valid_from is null or ml.valid_from <= now())
  and (ml.valid_to is null or ml.valid_to > now());

create or replace view app_api.geo_query_cache_current
with (security_barrier=true) as
select
  cache_key,
  provider,
  geo_cell,
  query_radius_m,
  fetched_at,
  expires_at,
  result_count,
  result_refs,
  cache_policy
from app_private.geo_query_cache
where expires_at > now();

create or replace function app_private.ingest_osm_nearby_snapshot(
  p_geo_cell text,
  p_radius_m integer,
  p_fetched_at timestamptz,
  p_expires_at timestamptz,
  p_places jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, app_private
as $fn$
declare
  v_place jsonb;
  v_payment jsonb;
  v_osm_id text;
  v_name text;
  v_requested_merchant_key text;
  v_merchant_key text;
  v_merchant_id uuid;
  v_location_id uuid;
  v_location_key text;
  v_lat numeric;
  v_lon numeric;
  v_address jsonb;
  v_instrument_key text;
  v_instrument_id uuid;
  v_state text;
  v_fact_key text;
  v_refs jsonb := '[]'::jsonb;
  v_place_count integer := 0;
  v_fact_count integer := 0;
begin
  if p_geo_cell is null or p_geo_cell !~ '^g3_[0-9a-f]{16}$' then
    raise exception 'osm_geo_cell_invalid' using errcode = '22023';
  end if;
  if p_radius_m is null or p_radius_m < 100 or p_radius_m > 1500 then
    raise exception 'osm_radius_invalid' using errcode = '22023';
  end if;
  if p_fetched_at is null or p_expires_at is null or p_expires_at <= p_fetched_at
     or p_expires_at > p_fetched_at + interval '31 days' then
    raise exception 'osm_cache_interval_invalid' using errcode = '22023';
  end if;
  if jsonb_typeof(p_places) is distinct from 'array'
     or jsonb_array_length(p_places) > 80 then
    raise exception 'osm_places_invalid' using errcode = '22023';
  end if;

  for v_place in select value from jsonb_array_elements(p_places)
  loop
    if jsonb_typeof(v_place) is distinct from 'object' then
      raise exception 'osm_place_invalid' using errcode = '22023';
    end if;
    v_osm_id := v_place ->> 'osm_id';
    v_name := v_place ->> 'name';
    v_requested_merchant_key := nullif(v_place ->> 'merchant_key', '');
    if v_osm_id is null or v_osm_id !~ '^(node|way|relation)/[0-9]{1,20}$' then
      raise exception 'osm_id_invalid' using errcode = '22023';
    end if;
    if v_name is null or length(v_name) < 1 or length(v_name) > 160 then
      raise exception 'osm_name_invalid' using errcode = '22023';
    end if;
    begin
      v_lat := (v_place ->> 'lat')::numeric;
      v_lon := (v_place ->> 'lon')::numeric;
    exception when others then
      raise exception 'osm_coordinate_invalid' using errcode = '22023';
    end;
    if v_lat < 20 or v_lat > 46 or v_lon < 122 or v_lon > 154 then
      raise exception 'osm_coordinate_outside_japan' using errcode = '22023';
    end if;
    v_address := coalesce(v_place -> 'address', '{}'::jsonb);
    if jsonb_typeof(v_address) is distinct from 'object' then
      raise exception 'osm_address_invalid' using errcode = '22023';
    end if;

    v_merchant_id := null;
    if v_requested_merchant_key is not null then
      select id, entity_key into v_merchant_id, v_merchant_key
      from app_private.entities
      where entity_key = v_requested_merchant_key
        and entity_type = 'merchant'
        and status = 'active';
    end if;
    if v_merchant_id is null then
      v_merchant_key := 'merchant.osm.' || replace(v_osm_id, '/', '.');
      insert into app_private.entities (
        entity_key, entity_type, display_name, locale, metadata
      ) values (
        v_merchant_key, 'merchant', v_name, 'ja-JP',
        jsonb_build_object(
          'runtime_discovery', true,
          'provider', 'openstreetmap',
          'external_id', v_osm_id
        )
      )
      on conflict (entity_key) do update
        set display_name = excluded.display_name,
            metadata = app_private.entities.metadata || excluded.metadata,
            updated_at = now()
      returning id into v_merchant_id;
    end if;

    v_location_key := 'runtime.osm.' || replace(v_osm_id, '/', '.');
    insert into app_private.merchant_locations (
      location_key, merchant_entity_id, display_name, address,
      latitude, longitude, external_place_ids, confidence, metadata
    ) values (
      v_location_key, v_merchant_id, v_name, v_address,
      v_lat, v_lon,
      jsonb_build_object('osm', v_osm_id),
      'third_party',
      jsonb_build_object(
        'runtime_discovery', true,
        'source_kind', 'open_data',
        'source_checked_at', p_fetched_at,
        'provider', 'openstreetmap'
      )
    )
    on conflict (location_key) do update
      set merchant_entity_id = excluded.merchant_entity_id,
          display_name = excluded.display_name,
          address = case
            when excluded.address = '{}'::jsonb then app_private.merchant_locations.address
            else excluded.address
          end,
          latitude = excluded.latitude,
          longitude = excluded.longitude,
          external_place_ids = app_private.merchant_locations.external_place_ids || excluded.external_place_ids,
          confidence = excluded.confidence,
          metadata = app_private.merchant_locations.metadata || excluded.metadata,
          updated_at = now()
    returning id into v_location_id;

    v_refs := v_refs || jsonb_build_array(v_location_key);
    v_place_count := v_place_count + 1;

    if v_place ? 'payments' then
      if jsonb_typeof(v_place -> 'payments') is distinct from 'array'
         or jsonb_array_length(v_place -> 'payments') > 24 then
        raise exception 'osm_payments_invalid' using errcode = '22023';
      end if;
      for v_payment in select value from jsonb_array_elements(v_place -> 'payments')
      loop
        if jsonb_typeof(v_payment) is distinct from 'object' then
          raise exception 'osm_payment_invalid' using errcode = '22023';
        end if;
        v_instrument_key := v_payment ->> 'instrument_key';
        v_state := v_payment ->> 'state';
        if v_instrument_key is null
           or v_instrument_key !~ '^[a-z0-9][a-z0-9._-]+$'
           or v_state not in ('yes','no') then
          raise exception 'osm_payment_value_invalid' using errcode = '22023';
        end if;
        select id into v_instrument_id
        from app_private.entities
        where entity_key = v_instrument_key
          and entity_type in (
            'credit_card','debit_card','prepaid_card','qr_wallet',
            'electronic_money','payment_interface','stored_value_program'
          )
          and status = 'active';
        if v_instrument_id is null then
          continue;
        end if;

        v_fact_key := 'maf_osm_' || substr(
          md5(v_osm_id || '|' || v_instrument_key || '|' || to_char(p_fetched_at at time zone 'UTC','YYYYMMDDHH24')),
          1, 24
        );

        update app_private.merchant_acceptance_facts
           set status = 'superseded'
         where merchant_location_id = v_location_id
           and instrument_entity_id = v_instrument_id
           and action = 'pay'
           and scope = 'branch'
           and source_kind = 'open_data'
           and source_ref = 'osm:' || v_osm_id
           and status = 'active'
           and fact_key <> v_fact_key;

        insert into app_private.merchant_acceptance_facts (
          fact_key, merchant_entity_id, merchant_location_id,
          instrument_entity_id, action, acceptance_state, scope,
          source_kind, source_ref, source_url, source_checked_at,
          confidence, expires_at, derivation, provenance, status
        ) values (
          v_fact_key, v_merchant_id, v_location_id,
          v_instrument_id, 'pay', v_state, 'branch',
          'open_data', 'osm:' || v_osm_id,
          'https://www.openstreetmap.org/' || v_osm_id,
          p_fetched_at, 0.72, p_expires_at, 'normalized',
          jsonb_build_object(
            'provider', 'openstreetmap',
            'license', 'ODbL-1.0',
            'normalized_from_payment_tag', true
          ),
          'active'
        )
        on conflict (fact_key) do update
          set acceptance_state = excluded.acceptance_state,
              source_checked_at = excluded.source_checked_at,
              expires_at = excluded.expires_at,
              confidence = excluded.confidence,
              provenance = app_private.merchant_acceptance_facts.provenance || excluded.provenance,
              status = 'active';
        v_fact_count := v_fact_count + 1;
      end loop;
    end if;
  end loop;

  insert into app_private.geo_query_cache (
    cache_key, provider, geo_cell, query_radius_m,
    fetched_at, expires_at, result_count, result_refs,
    cache_policy, metadata
  ) values (
    'osm_overpass:' || p_geo_cell || ':' || p_radius_m,
    'osm_overpass', p_geo_cell, p_radius_m,
    p_fetched_at, p_expires_at, v_place_count, v_refs,
    'full_allowed',
    jsonb_build_object(
      'attribution', '© OpenStreetMap contributors',
      'license', 'ODbL-1.0'
    )
  )
  on conflict (cache_key) do update
    set fetched_at = excluded.fetched_at,
        expires_at = excluded.expires_at,
        result_count = excluded.result_count,
        result_refs = excluded.result_refs,
        cache_policy = excluded.cache_policy,
        metadata = app_private.geo_query_cache.metadata || excluded.metadata,
        updated_at = now();

  return jsonb_build_object(
    'locations_ingested', v_place_count,
    'acceptance_facts_ingested', v_fact_count,
    'result_refs', v_refs
  );
end
$fn$;

revoke all on app_api.merchant_nearby_locations from public;
revoke all on app_api.geo_query_cache_current from public;
revoke all on function app_private.ingest_osm_nearby_snapshot(text, integer, timestamptz, timestamptz, jsonb) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'jro_runtime') then
    grant select on app_api.merchant_nearby_locations to jro_runtime;
    grant select on app_api.geo_query_cache_current to jro_runtime;
    grant execute on function app_private.ingest_osm_nearby_snapshot(text, integer, timestamptz, timestamptz, jsonb) to jro_runtime;
  end if;
end
$$;

comment on view app_api.merchant_nearby_locations is 'Browser-safe merchant locations for server-side radius search; exact user coordinates are not stored here.';
comment on view app_api.geo_query_cache_current is 'Current provider cache metadata keyed by opaque geo cell; contains no user identity.';
comment on function app_private.ingest_osm_nearby_snapshot(text, integer, timestamptz, timestamptz, jsonb) is 'Bounded jro_runtime ingest for OSM nearby discovery. Creates immediately usable merchant locations/payment facts only; cannot publish reward economics.';

commit;
