-- Staged from db/0019_p0_implementation_provenance.sql; edit the canonical source, not this file.
-- Browser-safe provenance projection for the generic implementation catalogue.
-- The existing fact rows already retain source_identity, applicability, and
-- their immutable snapshot.  This function exposes only the small fields the
-- browser needs; missing source URLs remain NULL.

begin;

create or replace function app_private.p0_active_implementation_fact_provenance_rows_at(
    p_effective_at timestamptz
)
returns table (
    fact_id uuid,
    implementation_version text,
    fact_version integer,
    family_id text,
    source_role_id text,
    source_ids jsonb,
    claim_type text,
    subject text,
    predicate text,
    short_paraphrase text,
    disposition text,
    reason text,
    reason_detail text,
    source_url text,
    checked_at timestamptz,
    effective_from text,
    effective_to text
)
language sql
stable
security definer
set search_path = pg_catalog
as $$
    select
        fact.fact_id,
        fact.implementation_version,
        fact.fact_version,
        fact.family_id,
        fact.source_role_id,
        fact.source_ids,
        fact.claim_type,
        fact.subject,
        fact.predicate,
        fact.short_paraphrase,
        fact.disposition,
        fact.reason,
        fact.reason_detail,
        (
            select identity_item->>'url'
              from jsonb_array_elements(fact.source_identity) as identity_item
             where identity_item->>'source_id' = fact.source_ids->>0
               and identity_item->>'url' ~ '^https://[^[:space:]]+$'
             order by identity_item->>'url'
             limit 1
        ) as source_url,
        snapshot.as_of as checked_at,
        nullif(fact.applicability->>'effective_from', '') as effective_from,
        nullif(fact.applicability->>'effective_to', '') as effective_to
      from app_private.p0_implementation_facts as fact
      join app_private.p0_implementation_snapshots as snapshot
        on snapshot.snapshot_id = fact.snapshot_id
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
$$;

revoke execute on function
    app_private.p0_active_implementation_fact_provenance_rows_at(timestamptz)
    from public;

grant execute on function
    app_private.p0_active_implementation_fact_provenance_rows_at(timestamptz)
    to jro_runtime;

comment on function app_private.p0_active_implementation_fact_provenance_rows_at(timestamptz) is
    'Bounded browser-safe implementation facts with source URL, snapshot check time, and source-declared applicability dates.';

commit;
