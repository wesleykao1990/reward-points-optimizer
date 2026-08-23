-- Bounded server-side projection for generic structured Agent Feed reward
-- claims.  This is intentionally private: the browser never receives the
-- SourceObservation raw_attributes document or the candidate payload directly.

begin;

-- The existing app_api active view owns lifecycle, primary-source, and
-- SourceObservation quarantine filtering.  This SECURITY DEFINER wrapper adds
-- only the compiler discriminator, effective-time validity, and a constrained
-- provenance lookup.  It returns one extra row so the driver-free adapter can
-- fail closed if a caller accidentally exceeds the fixed projection bound.
create or replace function app_private.active_reward_claim_calculations_at(
    p_effective_at timestamptz
)
returns table (
    candidate_hash text,
    definition_hash text,
    candidate_id text,
    candidate_payload jsonb,
    p0_family_id text,
    source_role_id text,
    source_ids jsonb,
    observation jsonb,
    source_url text,
    checked_at text
)
language sql
stable
security definer
set search_path = pg_catalog
as $$
    select
        candidate.candidate_hash,
        candidate.definition_hash,
        candidate.candidate_id,
        candidate.candidate_payload,
        candidate.p0_family_id,
        candidate.source_role_id,
        candidate.source_ids,
        observation.canonical_document as observation,
        provenance.source_url,
        coalesce(
            provenance.checked_at,
            to_char(
                candidate.machine_checked_at at time zone 'UTC',
                'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
            )
        ) as checked_at
      from app_api.active_experimental_provisional_rules as candidate
      join app_private.source_observations as observation
        on observation.id = candidate.source_observation_id
      left join lateral (
          select
              nullif(submitted.submitted_payload #>> '{source,uri}', '') as source_url,
              nullif(submitted.submitted_payload->>'captured_at', '') as checked_at
            from app_private.source_observation_submitted_evidence as submitted
           where submitted.observation_id = observation.id
             and submitted.promotion_status <> 'rejected'
             and submitted.submitted_payload #>> '{source,source_id}' in (
                 select jsonb_array_elements_text(observation.source_ids)
             )
             and submitted.submitted_payload #>> '{source,uri}' ~ '^https://[^[:space:]]+$'
             and app_private.is_agent_feed_atomic_timestamp(
                     to_jsonb(submitted.submitted_payload->>'captured_at'),
                     false
                 )
           order by
               submitted.submitted_payload #>> '{source,uri}' asc,
               submitted.submitted_payload->>'captured_at' asc,
               submitted.agent_feed_evidence_id asc
           limit 1
      ) as provenance on true
     where candidate.status = 'active_experimental'
       and candidate.source_authority_role = 'primary'
       and candidate.candidate_payload #>> '{extractor,name}' = 'reward-claim-compiler'
       and app_private.provisional_rule_valid_at(
               candidate.candidate_payload,
               p_effective_at
           )
       and not exists (
           select 1
             from app_private.source_observation_submitted_evidence as rejected
             left join app_private.evidence_records as evidence
               on evidence.id = rejected.promoted_evidence_id
            where rejected.observation_id = observation.id
              and (
                  rejected.promotion_status = 'rejected'
                  or (
                      rejected.promoted_evidence_id is not null
                      and (
                          evidence.id is null
                          or evidence.status in ('rejected','superseded')
                      )
                  )
              )
       )
     order by candidate.candidate_hash asc
     limit 129
$$;

revoke all on function
    app_private.active_reward_claim_calculations_at(timestamptz)
    from public;

-- Runtime receives only this constrained projection. It does not receive
-- execute on candidate persistence, activation, or any broad new relation.
grant execute on function
    app_private.active_reward_claim_calculations_at(timestamptz)
    to jro_runtime;

comment on function app_private.active_reward_claim_calculations_at(timestamptz) is
    'Bounded private projection of current generic reward-claim compiler candidates with canonical SourceObservation and deterministic HTTPS submitted-evidence provenance.';

commit;
