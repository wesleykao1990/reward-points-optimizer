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
  and e.status='active'
  and coalesce((e.metadata->>'merged')::boolean,false)=false
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
where e.entity_type='credit_card'
  and e.status='active'
  and coalesce((e.metadata->>'merged')::boolean,false)=false;
