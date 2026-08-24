-- Private, audited merchant-address geocoder for the Supabase deployment.
-- Raw provider responses and user coordinates are never persisted.

create table if not exists app_private.merchant_location_geocoding_attempts (
  id uuid primary key default gen_random_uuid(),
  merchant_location_id uuid not null
    references app_private.merchant_locations(id) on delete cascade,
  provider text not null
    check (provider in ('gsi_address_search')),
  query_text text not null
    check (length(query_text) between 1 and 512),
  requested_at timestamptz not null default now(),
  http_status integer,
  result_count integer
    check (result_count is null or result_count >= 0),
  selected_title text,
  selected_latitude numeric,
  selected_longitude numeric,
  outcome text not null
    check (outcome in ('updated', 'no_match', 'http_error', 'parse_error', 'skipped')),
  error_code text,
  response_sha256 text
    check (response_sha256 is null or response_sha256 ~ '^[0-9a-f]{64}$'),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists merchant_location_geocoding_attempts_location_time_idx
  on app_private.merchant_location_geocoding_attempts (
    merchant_location_id,
    requested_at desc
  );

create index if not exists merchant_location_geocoding_attempts_outcome_time_idx
  on app_private.merchant_location_geocoding_attempts (
    outcome,
    requested_at desc
  );

comment on table app_private.merchant_location_geocoding_attempts is
  'Private audit log for server-side merchant coordinate enrichment. Raw provider responses and user coordinates are never stored.';

create or replace function app_private.geocode_merchant_locations_gsi(
  p_limit integer default 25,
  p_retry_attempted boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_limit integer := coalesce(p_limit, 25);
  v_location record;
  v_query text;
  v_expected_prefecture text;
  v_expected_municipality text;
  v_url text;
  v_response extensions.http_response;
  v_body jsonb;
  v_candidate jsonb;
  v_title text;
  v_latitude numeric;
  v_longitude numeric;
  v_selected_title text;
  v_selected_latitude numeric;
  v_selected_longitude numeric;
  v_response_hash text;
  v_result_count integer;
  v_attempted integer := 0;
  v_updated integer := 0;
  v_no_match integer := 0;
  v_http_errors integer := 0;
  v_parse_errors integer := 0;
  v_remaining integer := 0;
  v_error_code text;
begin
  if v_limit < 1 or v_limit > 25 then
    raise exception 'merchant_geocode_limit_invalid' using errcode = '22023';
  end if;

  if not pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtext('app_private.geocode_merchant_locations_gsi')
  ) then
    raise exception 'merchant_geocode_already_running' using errcode = '55006';
  end if;

  perform pg_catalog.set_config(
    'http.curlopt_useragent',
    'PointRoute/0.4.1 merchant-location-enrichment',
    true
  );
  perform pg_catalog.set_config('http.curlopt_connecttimeout_ms', '4000', true);
  perform pg_catalog.set_config('http.curlopt_timeout_ms', '8000', true);

  for v_location in
    select
      ml.id,
      ml.location_key,
      ml.address
    from app_private.merchant_locations ml
    where (ml.latitude is null or ml.longitude is null)
      and jsonb_typeof(ml.address) = 'object'
      and nullif(pg_catalog.btrim(ml.address ->> 'street'), '') is not null
      and (
        p_retry_attempted
        or not exists (
          select 1
          from app_private.merchant_location_geocoding_attempts a
          where a.merchant_location_id = ml.id
            and a.provider = 'gsi_address_search'
        )
      )
    order by ml.location_key
    limit v_limit
    for update of ml skip locked
  loop
    v_attempted := v_attempted + 1;
    v_query := pg_catalog.concat_ws(
      '',
      nullif(pg_catalog.btrim(v_location.address ->> 'prefecture'), ''),
      coalesce(
        nullif(pg_catalog.btrim(v_location.address ->> 'ward'), ''),
        nullif(pg_catalog.btrim(v_location.address ->> 'city'), '')
      ),
      nullif(pg_catalog.btrim(v_location.address ->> 'street'), '')
    );
    v_expected_prefecture := nullif(
      pg_catalog.btrim(v_location.address ->> 'prefecture'),
      ''
    );
    v_expected_municipality := coalesce(
      nullif(pg_catalog.btrim(v_location.address ->> 'ward'), ''),
      nullif(pg_catalog.btrim(v_location.address ->> 'city'), '')
    );
    v_url := 'https://msearch.gsi.go.jp/address-search/AddressSearch?q='
      || extensions.urlencode(v_query::varchar);

    v_selected_title := null;
    v_selected_latitude := null;
    v_selected_longitude := null;
    v_response_hash := null;
    v_result_count := null;
    v_error_code := null;

    begin
      v_response := extensions.http_get(v_url::varchar);
      if (v_response).content is not null then
        v_response_hash := pg_catalog.encode(
          extensions.digest((v_response).content, 'sha256'),
          'hex'
        );
      end if;

      if (v_response).status <> 200 then
        v_http_errors := v_http_errors + 1;
        v_error_code := 'gsi_http_' || (v_response).status::text;
        insert into app_private.merchant_location_geocoding_attempts (
          merchant_location_id,
          provider,
          query_text,
          http_status,
          outcome,
          error_code,
          response_sha256,
          metadata
        ) values (
          v_location.id,
          'gsi_address_search',
          v_query,
          (v_response).status,
          'http_error',
          v_error_code,
          v_response_hash,
          jsonb_build_object('location_key', v_location.location_key)
        );
        perform pg_catalog.pg_sleep(0.12);
        continue;
      end if;

      begin
        v_body := (v_response).content::jsonb;
      exception when others then
        v_parse_errors := v_parse_errors + 1;
        insert into app_private.merchant_location_geocoding_attempts (
          merchant_location_id,
          provider,
          query_text,
          http_status,
          outcome,
          error_code,
          response_sha256,
          metadata
        ) values (
          v_location.id,
          'gsi_address_search',
          v_query,
          (v_response).status,
          'parse_error',
          'gsi_response_not_json',
          v_response_hash,
          jsonb_build_object('location_key', v_location.location_key)
        );
        perform pg_catalog.pg_sleep(0.12);
        continue;
      end;

      if jsonb_typeof(v_body) <> 'array' then
        v_parse_errors := v_parse_errors + 1;
        insert into app_private.merchant_location_geocoding_attempts (
          merchant_location_id,
          provider,
          query_text,
          http_status,
          outcome,
          error_code,
          response_sha256,
          metadata
        ) values (
          v_location.id,
          'gsi_address_search',
          v_query,
          (v_response).status,
          'parse_error',
          'gsi_response_not_array',
          v_response_hash,
          jsonb_build_object('location_key', v_location.location_key)
        );
        perform pg_catalog.pg_sleep(0.12);
        continue;
      end if;

      v_result_count := jsonb_array_length(v_body);
      for v_candidate in
        select value from jsonb_array_elements(v_body)
      loop
        v_title := nullif(v_candidate #>> '{properties,title}', '');
        begin
          v_longitude := (v_candidate #>> '{geometry,coordinates,0}')::numeric;
          v_latitude := (v_candidate #>> '{geometry,coordinates,1}')::numeric;
        exception when others then
          v_longitude := null;
          v_latitude := null;
        end;

        if v_title is null
          or v_latitude is null
          or v_longitude is null
          or v_latitude < 20
          or v_latitude > 46
          or v_longitude < 122
          or v_longitude > 154
          or (
            v_expected_prefecture is not null
            and pg_catalog.strpos(v_title, v_expected_prefecture) = 0
          )
          or (
            v_expected_municipality is not null
            and pg_catalog.strpos(v_title, v_expected_municipality) = 0
          )
        then
          continue;
        end if;

        v_selected_title := v_title;
        v_selected_latitude := v_latitude;
        v_selected_longitude := v_longitude;
        exit;
      end loop;

      if v_selected_latitude is null or v_selected_longitude is null then
        v_no_match := v_no_match + 1;
        insert into app_private.merchant_location_geocoding_attempts (
          merchant_location_id,
          provider,
          query_text,
          http_status,
          result_count,
          outcome,
          error_code,
          response_sha256,
          metadata
        ) values (
          v_location.id,
          'gsi_address_search',
          v_query,
          (v_response).status,
          v_result_count,
          'no_match',
          'gsi_no_valid_match',
          v_response_hash,
          jsonb_build_object(
            'location_key', v_location.location_key,
            'expected_prefecture', v_expected_prefecture,
            'expected_municipality', v_expected_municipality
          )
        );
      else
        update app_private.merchant_locations
        set latitude = v_selected_latitude,
            longitude = v_selected_longitude,
            metadata = metadata || jsonb_build_object(
              'coordinate_source', 'gsi_address_search',
              'coordinate_checked_at', pg_catalog.now(),
              'coordinate_query', v_query,
              'coordinate_result_title', v_selected_title,
              'coordinate_precision', 'address_search',
              'coordinate_attribution', '国土地理院「地理院地図」（住居表示住所）'
            ),
            updated_at = pg_catalog.now()
        where id = v_location.id
          and latitude is null
          and longitude is null;

        if found then
          v_updated := v_updated + 1;
          insert into app_private.merchant_location_geocoding_attempts (
            merchant_location_id,
            provider,
            query_text,
            http_status,
            result_count,
            selected_title,
            selected_latitude,
            selected_longitude,
            outcome,
            response_sha256,
            metadata
          ) values (
            v_location.id,
            'gsi_address_search',
            v_query,
            (v_response).status,
            v_result_count,
            v_selected_title,
            v_selected_latitude,
            v_selected_longitude,
            'updated',
            v_response_hash,
            jsonb_build_object(
              'location_key', v_location.location_key,
              'precision', 'address_search'
            )
          );
        else
          insert into app_private.merchant_location_geocoding_attempts (
            merchant_location_id,
            provider,
            query_text,
            http_status,
            result_count,
            selected_title,
            selected_latitude,
            selected_longitude,
            outcome,
            response_sha256,
            metadata
          ) values (
            v_location.id,
            'gsi_address_search',
            v_query,
            (v_response).status,
            v_result_count,
            v_selected_title,
            v_selected_latitude,
            v_selected_longitude,
            'skipped',
            v_response_hash,
            jsonb_build_object(
              'location_key', v_location.location_key,
              'reason', 'coordinates_already_present'
            )
          );
        end if;
      end if;
    exception when others then
      v_http_errors := v_http_errors + 1;
      v_error_code := pg_catalog.left(sqlstate || ':' || sqlerrm, 240);
      insert into app_private.merchant_location_geocoding_attempts (
        merchant_location_id,
        provider,
        query_text,
        outcome,
        error_code,
        metadata
      ) values (
        v_location.id,
        'gsi_address_search',
        v_query,
        'http_error',
        v_error_code,
        jsonb_build_object('location_key', v_location.location_key)
      );
    end;

    perform pg_catalog.pg_sleep(0.12);
  end loop;

  select count(*)::integer
    into v_remaining
  from app_private.merchant_locations
  where latitude is null or longitude is null;

  return jsonb_build_object(
    'attempted', v_attempted,
    'updated', v_updated,
    'no_match', v_no_match,
    'http_errors', v_http_errors,
    'parse_errors', v_parse_errors,
    'remaining_without_coordinates', v_remaining
  );
end
$function$;

revoke all on table app_private.merchant_location_geocoding_attempts
  from public, anon, authenticated;
revoke all on function app_private.geocode_merchant_locations_gsi(integer, boolean)
  from public, anon, authenticated;
grant execute on function app_private.geocode_merchant_locations_gsi(integer, boolean)
  to postgres, service_role, jro_runtime;
