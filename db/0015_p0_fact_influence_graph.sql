-- P0 implementation-fact influence graph.
--
-- This is a private, correction-aware host projection.  It deliberately does
-- not replace the browse-only catalogue views from 0012: recommendation
-- composition needs the complete immutable fact history, including rows that
-- are outside the requested effective window and rows which have a recorded
-- correction.  The host is responsible for reducing this material to the
-- browser-safe influence DTO.

begin;

create or replace function app_private.p0_implementation_fact_influence_graph_rows(
    p_effective_at timestamptz
)
returns table (
    graph_order text,
    fact_id uuid,
    implementation_version text,
    implementation_hash text,
    fact_version integer,
    parent_claim_id text,
    family_id text,
    source_role_id text,
    source_ids jsonb,
    source_identity jsonb,
    claim_type text,
    subject text,
    predicate text,
    value jsonb,
    applicability jsonb,
    exclusions jsonb,
    evidence_locator text,
    short_paraphrase text,
    disposition text,
    derived_rule_ids jsonb,
    reason text,
    reason_detail text,
    fact_payload jsonb,
    active_at boolean,
    corrected boolean
)
language sql
stable
security definer
set search_path = pg_catalog
as $$
    select
        fact.implementation_hash || ':' || fact.parent_claim_id || ':v' ||
            lpad(fact.fact_version::text, 4, '0') as graph_order,
        fact.fact_id,
        fact.implementation_version,
        fact.implementation_hash,
        fact.fact_version,
        fact.parent_claim_id,
        fact.family_id,
        fact.source_role_id,
        fact.source_ids,
        fact.source_identity,
        fact.claim_type,
        fact.subject,
        fact.predicate,
        fact.value,
        fact.applicability,
        fact.exclusions,
        fact.evidence_locator,
        fact.short_paraphrase,
        fact.disposition,
        fact.derived_rule_ids,
        fact.reason,
        fact.reason_detail,
        fact.fact_payload,
        app_private.p0_implementation_window_active(
            fact.claim_type,
            fact.reason,
            fact.applicability,
            p_effective_at
        ) as active_at,
        exists (
            select 1
              from app_private.p0_implementation_fact_corrections as correction
             where correction.fact_id = fact.fact_id
               and correction.implementation_hash = fact.implementation_hash
               and correction.parent_claim_id = fact.parent_claim_id
               and correction.fact_version = fact.fact_version
        ) as corrected
      from app_private.p0_implementation_facts as fact
     order by graph_order asc
$$;

comment on function app_private.p0_implementation_fact_influence_graph_rows(timestamptz) is
    'Private deterministic complete P0 fact material for host-side influence graphs; includes effective-time and correction flags without exposing raw JSON to the API.';

revoke execute on function app_private.p0_implementation_fact_influence_graph_rows(timestamptz) from public;

commit;
