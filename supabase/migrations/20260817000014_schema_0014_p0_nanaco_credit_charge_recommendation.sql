-- Staged from db/0014_p0_nanaco_credit_charge_recommendation.sql; edit the canonical source, not this file.
-- P0 Seven Card Plus -> nanaco credit-charge route.
--
-- This is a second, deliberately separate experimental lane.  It is not a
-- purchase-rule alias: the candidate is scoped only to stored_value_top_up,
-- and its database projection is independently bound to the two reviewed M3
-- evidence records and the two checked-in claim identities.

begin;

create table app_private.p0_nanaco_credit_charge_route_bindings (
    route_id text primary key
        check (route_id = 'candidate_p0_nanaco_sevencard_credit_charge_20260822_v0_1'),
    candidate_hash text not null unique
        check (candidate_hash = 'sha256:3f40d8082021af23704564a0e0be870241d91490124c6912faff31beb19ce914'),
    claim_ids jsonb not null
        check (claim_ids is not distinct from '["claim.point.nanaco.earn.credit-charge.003","claim.emoney.nanaco.eligible.001"]'::jsonb),
    evidence_ids jsonb not null
        check (evidence_ids is not distinct from '["ev_m3_sevencard_nanaco_charge_20260820","ev_m3_nanaco_sevencard_earning_20260820"]'::jsonb),
    source_ids jsonb not null
        check (source_ids is not distinct from '["jp.nanaco.sevencard-earning","jp.sevencard.nanaco-charge"]'::jsonb),
    created_at timestamptz not null default now()
);

create trigger p0_nanaco_credit_charge_route_bindings_immutable
before update or delete on app_private.p0_nanaco_credit_charge_route_bindings
for each row execute function app_private.reject_update_or_delete();

comment on table app_private.p0_nanaco_credit_charge_route_bindings is
    'Immutable Rewards-owned binding for the Seven Card Plus nanaco stored-value top-up experiment; not canonical rule truth.';

create or replace function app_private.persist_p0_nanaco_credit_charge_candidate(
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
    v_candidate_id uuid;
    v_status text;
    v_observation app_private.source_observations%rowtype;
begin
    if p_candidate_hash is distinct from
       'sha256:3f40d8082021af23704564a0e0be870241d91490124c6912faff31beb19ce914'
       or p_definition_hash is distinct from
       'sha256:62785ad9ee107ddeced93f54696a24b0f38eb4873b1339f7ff351d29fa57e92b'
       or not app_private.provisional_candidate_shape_valid(p_candidate_payload)
    then
        raise exception 'Nanaco credit-charge candidate identity or shape is invalid'
            using errcode = '22023';
    end if;

    if p_candidate_payload->>'candidate_id' is distinct from
           'candidate_p0_nanaco_sevencard_credit_charge_20260822_v0_1'
       or p_candidate_payload->>'observation_id' is distinct from
           'so_p0_nanaco_sevencard_credit_charge_20260822'
       or p_candidate_payload->>'p0_family_id' is distinct from 'point.nanaco'
       or p_candidate_payload->>'source_role_id' is distinct from 'earn_rules'
       or p_candidate_payload->>'source_authority_role' is distinct from 'primary'
       or p_candidate_payload->'source_ids' is distinct from
          '["jp.nanaco.sevencard-earning","jp.sevencard.nanaco-charge"]'::jsonb
       or p_candidate_payload->'rule'->>'rule_id' is distinct from
          'rr_jp_cvs_006_sevencard_credit_topup_reward'
       or p_candidate_payload->'rule'->>'version' is distinct from '1'
       or p_candidate_payload->'rule'->'scope'->'operation_types' is distinct from
          '["stored_value_top_up"]'::jsonb
       or p_candidate_payload->'rule'->'scope'->'channels' is distinct from
          '["not_applicable"]'::jsonb
       or p_candidate_payload->'rule'->'eligibility'->'transaction_conditions'->>'minimum_amount_jpy' is distinct from '5000'
       or p_candidate_payload->'rule'->'eligibility'->'transaction_conditions'->>'maximum_amount_jpy' is distinct from '30000'
       or p_candidate_payload->'rule'->'calculation'->>'model' is distinct from 'points_per_unit'
       or p_candidate_payload->'rule'->'calculation'->>'spend_jpy' is distinct from '200'
       or p_candidate_payload->'rule'->'provenance'->'human_verified' is distinct from 'false'
       or p_candidate_payload->'rule'->'provenance'->'evidence_ids' is distinct from
          '["ev_m3_sevencard_nanaco_charge_20260820","ev_m3_nanaco_sevencard_earning_20260820"]'::jsonb
    then
        raise exception 'Nanaco credit-charge candidate mapping is unsupported'
            using errcode = '22023';
    end if;

    select * into strict v_observation
      from app_private.source_observations as observation
     where observation.observation_key = p_candidate_payload->>'observation_id'
     for update;

    if v_observation.source_ids is distinct from
          '["jp.nanaco.sevencard-earning","jp.sevencard.nanaco-charge"]'::jsonb
       or v_observation.semantic_fingerprint is distinct from
          p_candidate_payload->>'observation_fingerprint'
       or v_observation.agent_feed->>'finding_id' is distinct from
          'nanaco-credit-charge-ui-canary-20260822-v1'
       or v_observation.change_type is distinct from 'funding_route'
       or v_observation.status is distinct from 'needs_review'
       or v_observation.discovery_assessment->>'source_authority_claim' is distinct from 'primary'
       or v_observation.discovery_assessment->>'evidence_completeness' is distinct from 'complete'
       or v_observation.security_flags is distinct from '[]'::jsonb
       or v_observation.trust_state is null
       or v_observation.trust_state = 'quarantined'
       or jsonb_typeof(v_observation.submitted_evidence_refs) is distinct from 'array'
       or v_observation.submitted_evidence_refs is distinct from
          '["ev_m3_sevencard_nanaco_charge_20260820","ev_m3_nanaco_sevencard_earning_20260820"]'::jsonb
       or jsonb_typeof(v_observation.raw_attributes) is distinct from 'object'
       or v_observation.raw_attributes->>'change_type' is distinct from 'funding_route'
       or v_observation.raw_attributes->>'funding_instrument' is distinct from 'instrument.jp.seven-card-plus'
       or v_observation.raw_attributes->>'funding_source' is distinct from 'funding.jp.seven-card-plus'
       or v_observation.raw_attributes->>'target_instrument' is distinct from 'asset.jp.nanaco'
       or v_observation.raw_attributes->'preregistration_required' is distinct from 'true'::jsonb
       or v_observation.raw_attributes->'minimum_charge_jpy' is distinct from '5000'::jsonb
       or v_observation.raw_attributes->'charge_increment_jpy' is distinct from '1000'::jsonb
       or v_observation.raw_attributes->'maximum_charge_jpy' is distinct from '30000'::jsonb
       or v_observation.raw_attributes->'post_charge_balance_limit_jpy' is distinct from '50000'::jsonb
       or v_observation.raw_attributes->'eligible_charge_jpy' is distinct from '200'::jsonb
       or v_observation.raw_attributes->>'reward_units' is distinct from '1'
       or v_observation.raw_attributes->'claim_ids' is distinct from
          '["claim.point.nanaco.earn.credit-charge.003","claim.emoney.nanaco.eligible.001"]'::jsonb
    then
        raise exception 'Nanaco credit-charge SourceObservation does not match the exact checked-in evidence tuple'
            using errcode = '22023';
    end if;

    if (select count(*)
          from app_private.evidence_records as evidence
          join app_private.source_snapshots as snapshot
            on snapshot.id = evidence.source_snapshot_id
          join app_private.trusted_sources as source
            on source.id = snapshot.source_id
         where evidence.evidence_key = any(array[
                   'ev_m3_sevencard_nanaco_charge_20260820',
                   'ev_m3_nanaco_sevencard_earning_20260820'
               ]::text[])
           and evidence.status = 'verified'
           and (
               (evidence.evidence_key = 'ev_m3_sevencard_nanaco_charge_20260820'
                and source.source_key = 'jp.sevencard.nanaco-charge'
                and snapshot.snapshot_key = 'snap_m3_sevencard_nanaco_charge_20260820')
               or
               (evidence.evidence_key = 'ev_m3_nanaco_sevencard_earning_20260820'
                and source.source_key = 'jp.nanaco.sevencard-earning'
                and snapshot.snapshot_key = 'snap_m3_nanaco_sevencard_earning_20260820')
           )) <> 2
    then
        raise exception 'Nanaco credit-charge evidence is missing, unverified, or source-unbound'
            using errcode = '55000';
    end if;

    v_candidate_id := app_private.persist_provisional_rule_candidate(
        p_candidate_hash,
        p_definition_hash,
        p_candidate_payload
    );
    select candidate.status into strict v_status
      from app_private.provisional_rule_candidates as candidate
     where candidate.id = v_candidate_id;
    if v_status not in ('machine_checked', 'active_experimental') then
        raise exception 'Nanaco credit-charge candidate did not persist as machine_checked'
            using errcode = '55000';
    end if;
    return query select v_candidate_id, 'inserted'::text, v_status;
exception
    when no_data_found then
        raise exception 'Nanaco credit-charge SourceObservation does not exist'
            using errcode = '23503';
end;
$$;

revoke execute on function app_private.persist_p0_nanaco_credit_charge_candidate(text,text,jsonb)
    from public;

create view app_api.p0_nanaco_credit_charge_experimental_route
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
    candidate.admitted_at,
    binding.route_id,
    binding.claim_ids,
    binding.evidence_ids,
    binding.source_ids as bound_source_ids,
    observation.agent_feed->>'finding_id' as finding_id
  from app_private.provisional_rule_candidates as candidate
  join app_private.p0_nanaco_credit_charge_route_bindings as binding
    on binding.candidate_hash = candidate.candidate_hash
  join app_private.source_observations as observation
    on observation.id = candidate.source_observation_id
 where candidate.status = 'active_experimental'
   and candidate.source_authority_role = 'primary'
   and candidate.p0_family_id = 'point.nanaco'
   and candidate.source_role_id = 'earn_rules'
   and candidate.source_ids is distinct from
       '[]'::jsonb
   and candidate.candidate_payload->'rule'->'scope'->'operation_types' is distinct from
       '["merchant_purchase"]'::jsonb
   and candidate.candidate_payload->'rule'->>'status' = 'under_review'
   and observation.status not in ('rejected','quarantined')
   and observation.trust_state is not null
   and observation.trust_state <> 'quarantined'
   and observation.security_flags is not distinct from '[]'::jsonb
   and (select count(*)
          from app_private.evidence_records as evidence
         where evidence.evidence_key in (
             'ev_m3_sevencard_nanaco_charge_20260820',
             'ev_m3_nanaco_sevencard_earning_20260820'
         ) and evidence.status = 'verified') = 2;

comment on view app_api.p0_nanaco_credit_charge_experimental_route is
    'Correction-sensitive, evidence-bound Seven Card Plus nanaco stored-value top-up route; never a canonical recommendation.';

create or replace function app_api.p0_nanaco_credit_charge_experimental_route_at(
    p_effective_at timestamptz
)
returns setof app_api.p0_nanaco_credit_charge_experimental_route
language sql
stable
security invoker
set search_path = pg_catalog
as $$
    select route.*
      from app_api.p0_nanaco_credit_charge_experimental_route as route
     where app_private.provisional_rule_valid_at(
               route.candidate_payload,
               p_effective_at
           )
$$;

revoke all on app_api.p0_nanaco_credit_charge_experimental_route from public;
revoke all on function app_api.p0_nanaco_credit_charge_experimental_route_at(timestamptz)
    from public;

commit;
