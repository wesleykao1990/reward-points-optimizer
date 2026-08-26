-- Allow the runtime visual-asset persistence service to resolve canonical
-- asset IDs to entity UUIDs without exposing other private entity columns.
grant select (id, entity_key) on app_private.entities to jro_runtime;
