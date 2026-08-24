-- Recovered from the hosted Supabase migration history so the repository and
-- production history remain a complete, replayable set.
create or replace view app_api.credit_card_coverage
as
with cards as (
  select
    e.entity_key as card_id,
    e.display_name,
    coalesce(e.metadata->>'coverage_tier', 'unclassified') as coverage_tier,
    case
      when (e.metadata->>'coverage_priority') ~ '^[0-9]+$'
        then (e.metadata->>'coverage_priority')::integer
      else null
    end as coverage_priority
  from app_private.entities e
  where e.status = 'active'
    and e.entity_key like 'instrument.card.%'
), reflected as (
  select
    c.card_id,
    count(f.finding_id)::integer as active_finding_count,
    max(f.first_reflected_at) as latest_reflected_at
  from cards c
  left join app_api.active_agent_feed_experimental_findings f
    on c.card_id = any(f.family_ids)
  group by c.card_id
)
select
  c.card_id,
  c.display_name,
  c.coverage_tier,
  c.coverage_priority,
  (r.active_finding_count > 0) as optimization_covered,
  r.active_finding_count,
  r.latest_reflected_at
from cards c
join reflected r using (card_id);

comment on view app_api.credit_card_coverage is
  'Browser-safe canonical Japan credit-card catalogue coverage with active reflected Agent Feed optimization coverage.';

grant select on app_api.credit_card_coverage to jro_runtime;
