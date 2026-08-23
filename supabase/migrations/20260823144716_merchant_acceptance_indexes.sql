-- Staged from db/0024_merchant_acceptance_indexes.sql; edit the canonical source, not this file.
-- Cover merchant-location and merchant-acceptance foreign keys used by lookup paths.

begin;

create index if not exists merchant_acceptance_instrument_idx
  on app_private.merchant_acceptance_facts (instrument_entity_id);
create index if not exists merchant_acceptance_location_idx
  on app_private.merchant_acceptance_facts (merchant_location_id)
  where merchant_location_id is not null;
create index if not exists merchant_acceptance_supersedes_idx
  on app_private.merchant_acceptance_facts (supersedes_fact_id)
  where supersedes_fact_id is not null;
create index if not exists merchant_locations_merchant_idx
  on app_private.merchant_locations (merchant_entity_id);
create index if not exists merchant_locations_parent_idx
  on app_private.merchant_locations (parent_location_id)
  where parent_location_id is not null;

commit;
