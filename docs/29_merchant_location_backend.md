# Merchant location backend

## Purpose

The merchant-location backend turns a transient user coordinate into a bounded list of nearby, selectable merchant branches for the `貯める` journey. It is shared by web and native clients: only the client-side location provider differs.

The backend owns branch identity. A selected result therefore carries the same stable `location_key` used by payment-acceptance and reward-rule records instead of relying on a third-party place object at recommendation time.

## Request flow

```text
Web Geolocation or iOS Core Location
              |
              | latitude / longitude
              v
Supabase Data API: public.nearby_merchants(...)
              |
              v
Private PostGIS search over app_private.merchant_locations
              |
              v
Bounded browser-safe branch records
              |
              v
Selected location_key enters the trusted recommendation API
```

The supplied user coordinate is used only inside the SQL statement. It is not written to a table, log, cache, profile, or recommendation record by this RPC.

## Public RPC

```sql
public.nearby_merchants(
  p_latitude double precision,
  p_longitude double precision,
  p_radius_m integer default 1000,
  p_limit integer default 15
)
```

Input limits:

- latitude: `20..46`
- longitude: `122..154`
- radius: `100..5000` metres
- result limit: `1..25`
- statement timeout: two seconds

The response contains only:

```text
location_key
merchant_key
merchant_name
location_name
address
latitude
longitude
distance_m
coordinate_precision
coordinate_attribution
```

The RPC is executable by `anon` and `authenticated`. Its internal counterpart, private tables, geocoding audit records, and enrichment function are not accessible to either role.

### Supabase JavaScript example

```ts
const { data: stores, error } = await supabase.rpc("nearby_merchants", {
  p_latitude: location.coords.latitude,
  p_longitude: location.coords.longitude,
  p_radius_m: 1000,
  p_limit: 15,
});

if (error) throw error;
```

No service-role key or database connection string belongs in the web or iOS bundle. Use the normal Supabase publishable key.

## Spatial storage

`app_private.merchant_locations` retains its numeric `latitude` and `longitude` columns and also has a stored generated column:

```sql
geo geography(Point, 4326)
```

A partial GiST index covers rows where `geo` is present. The generated column keeps existing OSM and official-directory ingestion paths compatible: writing a valid coordinate pair updates the indexed point automatically.

Database constraints reject partial coordinate pairs and coordinates outside Japan. A trigger records `metadata.coordinate_status` as `ready` or `missing`.

## Coordinate enrichment

Production merchant addresses are enriched through the private function:

```sql
app_private.geocode_merchant_locations_gsi(
  p_limit integer default 25,
  p_retry_attempted boolean default false
)
```

The function:

1. locks one bounded batch with `FOR UPDATE SKIP LOCKED`;
2. builds a Japanese address query from structured address fields;
3. calls the Geospatial Information Authority of Japan address-search service from PostgreSQL;
4. accepts only a candidate inside Japan whose title includes the expected prefecture and municipality;
5. stores the selected coordinate and required attribution;
6. stores an audit row containing status, outcome, selected title/coordinate, and a SHA-256 response hash;
7. never stores the raw provider response.

An advisory transaction lock prevents two operators from running the job simultaneously. Each function call processes at most 25 rows and applies an inter-request delay.

### Run the enrichment job

```sh
JRO_DATABASE_URL='postgresql://...' pnpm merchant:geocode
```

Optional bounded retry:

```sh
JRO_DATABASE_URL='postgresql://...' \
  pnpm merchant:geocode -- --batch-size 10 --retry-attempted
```

Normal mode continues until all eligible rows have coordinates or it finds a row that requires manual address correction. Retry mode executes one batch only, preventing an unresolved row from creating an infinite loop.

The operator script never prints `JRO_DATABASE_URL`.

## Adding branches

For every new branch:

1. upsert the merchant entity;
2. upsert a stable branch `location_key` and structured official address;
3. preserve the official source URL and checked date in metadata;
4. supply official coordinates when the source provides them;
5. otherwise run `pnpm merchant:geocode`;
6. confirm `coordinate_status = 'ready'` before treating nearby coverage as complete.

Do not replace an official branch identity with an OSM runtime identity. OSM discovery may enrich or match a branch, but `location_key` remains the application-owned join key.

## Attribution and precision

Address-search results carry:

```text
coordinate_precision = address_search
coordinate_attribution = 国土地理院「地理院地図」（住居表示住所）
```

Official map points retain their official precision metadata. The public RPC returns these two fields so the UI can present attribution when required without exposing internal source URLs or audit records.

## Current production coverage

As of 2026-08-24:

- stored merchant branches: 448
- branches with coordinate pairs: 448
- branches with generated PostGIS points: 448
- unresolved branches: 0
- GSI-enriched branches: 442
- pre-existing official coordinate points: 6
- geocoding HTTP, parsing, and validation failures during the backfill: 0

Shared coordinates can be legitimate for branches inside the same station or commercial building, so duplicate coordinate groups are not rejected automatically.

## Tests and release gates

`db/tests/099_merchant_location_public_rpc.sql` verifies:

- PostGIS point generation and GiST index presence;
- distance-sorted lookup through the public RPC;
- `anon` and `authenticated` execution grants;
- denial of internal RPC and private-table access;
- rejection of invalid coordinates, radii, and limits.

CI runs the full migration chain against a PostGIS-enabled PostgreSQL 16 service. `pnpm deploy:supabase:check` additionally verifies that canonical migrations and production-only history files match the staged Supabase migration set.

## Failure behavior

- invalid input: SQLSTATE `22023` with a bounded error code;
- spatial query over two seconds: statement timeout;
- provider or parsing error: audit entry plus a non-zero operator-script exit;
- no valid address match: `no_match` audit entry, no coordinate update;
- concurrent enrichment run: `merchant_geocode_already_running`;
- no nearby branch: an empty list, not an external-provider call from the client.

External discovery and cache refresh remain server-side concerns. The public nearby RPC reads only the application's current branch catalogue.
