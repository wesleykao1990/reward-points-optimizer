-- Staged from db/0027_p0_route_graph_source_identity.sql; edit the canonical source, not this file.
-- Compatibility-safe route-graph projection.
--
-- Migration 0024 (and the typed-rule migration that follows it) already
-- exposes p0_implementation_rule_facts_at(timestamptz).  Its return type is
-- an established private contract, so source descriptors are added through a
-- new function rather than changing that function in place.  The route graph
-- loader needs the exact stored source identity and exclusions to rebuild the
-- descriptor-first artifact shape consumed by the compiler.

begin;

create or replace function app_private.p0_route_graph_facts_at(
    p_effective_at timestamptz
)
returns table (
    claim_id text,
    family_id text,
    source_role_id text,
    claim_type text,
    subject text,
    predicate text,
    source_ids jsonb,
    value jsonb,
    applicability jsonb,
    research_artifact_id text,
    implementation_version text,
    implementation_hash text,
    as_of timestamptz,
    source_identity jsonb,
    exclusions jsonb
)
language sql
stable
security definer
set search_path = pg_catalog
as $$
    with current_snapshot as (
        select distinct on (snapshot.research_artifact_id)
               snapshot.snapshot_id,
               snapshot.research_artifact_id,
               snapshot.implementation_version,
               snapshot.implementation_hash,
               snapshot.as_of
          from app_private.p0_implementation_snapshots as snapshot
         order by snapshot.research_artifact_id asc,
                  snapshot.as_of desc,
                  snapshot.created_at desc,
                  snapshot.snapshot_id desc
    )
    select distinct on (fact.parent_claim_id)
        fact.parent_claim_id,
        fact.family_id,
        fact.source_role_id,
        fact.claim_type,
        fact.subject,
        fact.predicate,
        fact.source_ids,
        fact.value,
        fact.applicability,
        current_snapshot.research_artifact_id,
        current_snapshot.implementation_version,
        current_snapshot.implementation_hash,
        current_snapshot.as_of,
        fact.source_identity,
        fact.exclusions
      from app_private.p0_implementation_facts as fact
      join current_snapshot
        on current_snapshot.snapshot_id = fact.snapshot_id
     where not exists (
         select 1
           from app_private.p0_implementation_fact_corrections as correction
          where correction.fact_id = fact.fact_id
            and correction.implementation_hash = fact.implementation_hash
            and correction.parent_claim_id = fact.parent_claim_id
            and correction.fact_version = fact.fact_version
     )
       and app_private.p0_implementation_window_active(
           fact.claim_type,
           fact.reason,
           fact.applicability,
           p_effective_at
       )
     order by fact.parent_claim_id asc, fact.fact_version desc
     limit 2049
$$;

revoke all on function
    app_private.p0_route_graph_facts_at(timestamptz)
    from public;

grant execute on function
    app_private.p0_route_graph_facts_at(timestamptz)
    to jro_runtime;

comment on function app_private.p0_route_graph_facts_at(timestamptz) is
    'Bounded private route-graph projection of the current uncorrected implementation facts, including exact stored source identities and exclusions. Applicability is window-sensitive at the requested Asia/Tokyo effective date; no browser or evidence surface is widened.';

commit;
