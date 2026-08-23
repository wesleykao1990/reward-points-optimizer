-- Production compatibility marker.
-- The connected Supabase project first installed the OSM ingest boundary and
-- then replaced its ingest function to add validated prewarmed-location
-- matching. Fresh installs already receive that final behavior from 0025.

begin;

comment on function app_private.ingest_osm_nearby_snapshot(text, integer, timestamptz, timestamptz, jsonb) is
  'Bounded jro_runtime ingest for OSM nearby discovery. Optional validated location_key lets a matched OSM branch enrich an existing prewarmed location instead of creating a duplicate; it cannot publish reward economics.';

commit;
