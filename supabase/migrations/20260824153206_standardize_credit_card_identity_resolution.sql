-- Recovered from the hosted Supabase migration history so the repository and
-- production history remain a complete, replayable set.
create or replace view app_api.credit_card_identity_map as
select
  e.entity_key as canonical_card_id,
  e.display_name,
  e.status,
  e.metadata,
  e.entity_key as observed_id,
  'canonical'::text as observed_id_type
from app_private.entities e
where e.entity_type='credit_card'
union all
select
  e.entity_key as canonical_card_id,
  e.display_name,
  e.status,
  e.metadata,
  a.alias::text as observed_id,
  coalesce(a.alias_type,'alias')::text as observed_id_type
from app_private.entities e
join app_private.entity_aliases a on a.entity_id=e.id
where e.entity_type='credit_card';

create or replace function app_api.resolve_credit_card_id(input_id text)
returns text
language sql
stable
security definer
set search_path = pg_catalog, app_private, app_api
as $$
  select m.canonical_card_id
  from app_api.credit_card_identity_map m
  where m.observed_id = input_id
  order by case when m.observed_id_type='canonical' then 0 else 1 end
  limit 1
$$;

comment on view app_api.credit_card_identity_map is 'Canonical credit-card identity map. Legacy family IDs and canonical instrument.card IDs resolve to one canonical card entity.';
comment on function app_api.resolve_credit_card_id(text) is 'Resolve canonical or legacy credit-card IDs to the canonical instrument.card entity ID.';
