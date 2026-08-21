-- P0 economic canary ingestion and correction-sensitive experimental view.
--
-- This migration adds one narrow Rewards-owned adapter around the existing
-- provisional candidate routine.  It accepts only the exact Nanaco economic
-- canary mapping, records machine_checked candidates, and never touches
-- reward_rules, reward_rule_versions, evidence_records, or rule_evidence.

begin;

create or replace function app_private.persist_p0_economic_candidate(
    p_candidate_hash text,
    p_definition_hash text,
    p_candidate_payload jsonb
)
returns table (
    candidate_id uuid,
    outcome text,
    status text
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
    v_existing app_private.provisional_rule_candidates%rowtype;
    v_observation app_private.source_observations%rowtype;
    v_candidate_id uuid;
    v_status text;
begin
    if p_candidate_hash is null
       or p_candidate_hash !~ '^sha256:[0-9a-f]{64}$'
       or p_definition_hash is null
       or p_definition_hash is distinct from
          'sha256:9f8cb5de0af689ee8ca751a3ae6a34c2d974eb1c79c29c60bd555da4db116746'
       or not app_private.provisional_candidate_shape_valid(p_candidate_payload)
    then
        raise exception 'P0 economic candidate identity or shape is invalid'
            using errcode = '22023';
    end if;

    -- Rewards owns the exact supported mapping.  No caller-provided rule or
    -- economic template can widen it to another family, role, source, or
    -- rule definition.
    if p_candidate_payload->>'p0_family_id' is distinct from 'point.nanaco'
       or p_candidate_payload->>'source_role_id' is distinct from 'earn_rules'
       or p_candidate_payload->>'source_authority_role' is distinct from 'primary'
       or p_candidate_payload->'source_ids' is distinct from
          '["jp.nanaco.shopping-earning"]'::jsonb
       or p_candidate_payload->'rule'->>'rule_id' is distinct from
          'rr_jp_cvs_006_nanaco_purchase_reward'
       or p_candidate_payload->'rule'->>'version' is distinct from '1'
    then
        raise exception 'P0 economic candidate mapping is unsupported'
            using errcode = '22023';
    end if;

    -- Serialize duplicate detection before taking any observation lock.  The
    -- existing routine takes the same advisory lock, so retries and concurrent
    -- deliveries share one lock order.
    perform pg_advisory_xact_lock(hashtextextended(p_candidate_hash, 0));
    select * into v_existing
      from app_private.provisional_rule_candidates as candidate
     where candidate.candidate_hash = p_candidate_hash
     for update;
    if found then
        if v_existing.definition_hash is distinct from p_definition_hash
           or v_existing.candidate_payload is distinct from p_candidate_payload
        then
            raise exception 'P0 economic candidate hash was reused with different content'
                using errcode = '55000';
        end if;
        return query select v_existing.id, 'duplicate'::text, v_existing.status;
        return;
    end if;

    select * into v_observation
      from app_private.source_observations as observation
     where observation.observation_key = p_candidate_payload->>'observation_id'
     for update;
    if not found then
        raise exception 'P0 economic SourceObservation does not exist'
            using errcode = '23503';
    end if;

    -- The mapped observation must be the exact complete canary.  Every
    -- condition is explicit and NULL-safe: malformed JSON never passes by
    -- three-valued-logic accident.
    if v_observation.source_ids is distinct from
          '["jp.nanaco.shopping-earning"]'::jsonb
       or v_observation.observation_key is distinct from
          p_candidate_payload->>'observation_id'
       or v_observation.semantic_fingerprint is distinct from
          p_candidate_payload->>'observation_fingerprint'
       or v_observation.agent_feed->>'finding_id' is distinct from
          'nanaco-economic-ui-canary-20260821-v1'
       or v_observation.change_type is distinct from 'reward_rate'
       or v_observation.status is distinct from 'needs_review'
       or v_observation.discovery_assessment->>'source_authority_claim' is distinct from 'primary'
       or v_observation.discovery_assessment->>'evidence_completeness' is distinct from 'complete'
       or jsonb_typeof(v_observation.submitted_evidence_refs) is distinct from 'array'
       or jsonb_array_length(v_observation.submitted_evidence_refs) < 1
       or v_observation.canonical_evidence_ids is distinct from '[]'::jsonb
       or v_observation.security_flags is distinct from '[]'::jsonb
       or v_observation.trust_state is null
       or v_observation.trust_state = 'quarantined'
       or jsonb_typeof(v_observation.raw_attributes) is distinct from 'object'
       or not (v_observation.raw_attributes ?& array[
           'change_type','program_id','merchant_id','reward_rate',
           'eligible_product_class','posting_timing','product_exclusions_apply',
           'canonical_publication','human_verified'
       ])
       or (select count(*) from jsonb_object_keys(v_observation.raw_attributes)) <> 9
       or v_observation.raw_attributes->>'change_type' is distinct from 'reward_rate'
       or v_observation.raw_attributes->>'program_id' is distinct from 'program.jp.nanaco'
       or v_observation.raw_attributes->>'merchant_id' is distinct from 'merchant.seveneleven'
       or v_observation.raw_attributes->>'eligible_product_class' is distinct from 'ordinary'
       or v_observation.raw_attributes->>'posting_timing' is distinct from 'immediate_for_listed_merchant'
       or v_observation.raw_attributes->'product_exclusions_apply' is distinct from 'true'::jsonb
       or v_observation.raw_attributes->'canonical_publication' is distinct from 'false'::jsonb
       or v_observation.raw_attributes->'human_verified' is distinct from 'false'::jsonb
       or jsonb_typeof(v_observation.raw_attributes->'reward_rate') is distinct from 'object'
       or not (v_observation.raw_attributes->'reward_rate' ?& array[
           'reward_units','spend_jpy','spend_basis'
       ])
       or (select count(*) from jsonb_object_keys(v_observation.raw_attributes->'reward_rate')) <> 3
       or v_observation.raw_attributes->'reward_rate'->>'reward_units' is distinct from '1'
       or v_observation.raw_attributes->'reward_rate'->'spend_jpy' is distinct from '200'::jsonb
       or v_observation.raw_attributes->'reward_rate'->>'spend_basis' is distinct from 'tax_exclusive'
    then
        raise exception 'P0 economic SourceObservation does not match the exact canary'
            using errcode = '22023';
    end if;

    v_candidate_id := app_private.persist_provisional_rule_candidate(
        p_candidate_hash,
        p_definition_hash,
        p_candidate_payload
    );
    select candidate.status into v_status
      from app_private.provisional_rule_candidates as candidate
     where candidate.id = v_candidate_id;
    if v_status is distinct from 'machine_checked'
       and v_status is distinct from 'active_experimental'
    then
        raise exception 'P0 economic candidate did not persist as machine_checked'
            using errcode = '55000';
    end if;
    return query select v_candidate_id, 'inserted'::text, v_status;
end;
$$;

revoke execute on function app_private.persist_p0_economic_candidate(text,text,jsonb)
    from public;

comment on function app_private.persist_p0_economic_candidate(text,text,jsonb) is
    'Rewards-owned exact Nanaco economic canary adapter; machine_checked only, never canonical publication.';

create view app_api.p0_unverified_experimental_catalogue
with (security_invoker = true, security_barrier = true) as
select
    candidate.candidate_hash,
    candidate.definition_hash,
    candidate.candidate_id,
    candidate.candidate_payload,
    candidate.source_observation_id,
    candidate.source_observation_key,
    candidate.observation_fingerprint,
    candidate.source_ids,
    candidate.p0_family_id,
    candidate.source_role_id,
    candidate.source_authority_role,
    candidate.status,
    candidate.machine_checked_at,
    candidate.admitted_at
  from app_api.active_experimental_provisional_rules as candidate
 where candidate.p0_family_id = 'merchant.7eleven'
   and candidate.source_role_id = 'accepted_payment_methods'
   and candidate.source_ids is not distinct from
       '["merchant.seveneleven.payment-methods"]'::jsonb
   and candidate.candidate_payload->'extractor'->>'name' =
       'p0-payment-family-extractor'
union
select
    candidate.candidate_hash,
    candidate.definition_hash,
    candidate.candidate_id,
    candidate.candidate_payload,
    candidate.source_observation_id,
    candidate.source_observation_key,
    candidate.observation_fingerprint,
    candidate.source_ids,
    candidate.p0_family_id,
    candidate.source_role_id,
    candidate.source_authority_role,
    candidate.status,
    candidate.machine_checked_at,
    candidate.admitted_at
  from app_private.provisional_rule_candidates as candidate
  join app_private.source_observations as observation
    on observation.id = candidate.source_observation_id
 where candidate.status in ('machine_checked','active_experimental')
   and candidate.source_authority_role = 'primary'
   and candidate.p0_family_id = 'point.nanaco'
   and candidate.source_role_id = 'earn_rules'
   and candidate.source_ids is not distinct from
       '["jp.nanaco.shopping-earning"]'::jsonb
   and observation.discovery_assessment->>'source_authority_claim' = 'primary'
   and observation.status is not null
   and observation.status not in ('rejected','quarantined')
   and observation.trust_state is not null
   and observation.trust_state <> 'quarantined'
   and observation.security_flags is not distinct from '[]'::jsonb
   and observation.agent_feed->>'finding_id' =
       'nanaco-economic-ui-canary-20260821-v1';

comment on view app_api.p0_unverified_experimental_catalogue is
    'Private correction-sensitive Nanaco economic canary catalogue; machine_checked data is experimental and never canonical truth.';

revoke all on app_api.p0_unverified_experimental_catalogue from public;
revoke execute on function app_private.persist_p0_economic_candidate(text,text,jsonb)
    from public;

commit;
