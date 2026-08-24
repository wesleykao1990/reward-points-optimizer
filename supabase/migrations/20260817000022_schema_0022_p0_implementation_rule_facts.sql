-- Staged from db/0022_p0_implementation_rule_facts.sql; edit the canonical source, not this file.
-- Machine-readable projection of current implementation facts, used to compile
-- the routing graph and the payment layers from the database rather than from
-- checked-in fixtures.
--
-- `app_api.p0_active_implementation_facts` deliberately exposes only fact
-- metadata: subject, predicate, paraphrase, disposition.  That is right for a
-- browse-only catalogue, but a compiler needs the stated quantities, so this
-- migration adds a separate SECURITY DEFINER projection that also returns
-- `value` and `applicability`.
--
-- The widening is deliberately narrow.  It is private, bounded, granted only
-- to the runtime role, correction-sensitive and window-active on exactly the
-- same terms as the browse projection, and restricted to the current snapshot
-- of each research artifact.  It publishes nothing: the compilers on the other
-- side refuse anything that is not an exactly stated rate, and the canonical
-- rule-publication gate is untouched.

begin;

-- Facts arrive as immutable snapshots, one per research artifact.  "Current"
-- is therefore the newest snapshot of each artifact rather than the newest row
-- overall, so a refreshed artifact replaces its own facts without disturbing
-- the others.  A corrected fact is superseded by a later `fact_version`, and
-- the correction filter below removes the version that was corrected, so at
-- most one version of each claim survives; the DISTINCT ON is a belt-and-braces
-- guard because a duplicate claim would abort the whole compile.
create or replace function app_private.p0_implementation_rule_facts_at(
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
    as_of timestamptz
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
        current_snapshot.as_of
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
    app_private.p0_implementation_rule_facts_at(timestamptz)
    from public;

-- The runtime receives this projection only.  It does not receive execute on
-- snapshot persistence, fact correction, or any broader relation, and this
-- function cannot write.
grant execute on function
    app_private.p0_implementation_rule_facts_at(timestamptz)
    to jro_runtime;

comment on function app_private.p0_implementation_rule_facts_at(timestamptz) is
    'Bounded private machine-readable projection of the current implementation facts per research artifact; compiles the experimental routing graph and payment layers. Never canonical reward truth and never a publication path.';

commit;
