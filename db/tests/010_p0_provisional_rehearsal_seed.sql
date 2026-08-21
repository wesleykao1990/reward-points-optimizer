\set ON_ERROR_STOP on
begin;

-- Seed 002 is the one durable local rehearsal: one unverified/redacted
-- finding, one lead-only evidence payload, and one active experimental
-- candidate.  This test intentionally rolls back all correction probes.
do $$
declare
    v_receipt app_private.agent_feed_receipts%rowtype;
    v_attempt app_private.agent_feed_delivery_attempts%rowtype;
    v_observation app_private.source_observations%rowtype;
    v_candidate app_private.provisional_rule_candidates%rowtype;
    v_transition_count integer;
    v_view_count integer;
begin
    select * into v_receipt
      from app_private.agent_feed_receipts
     where event_id = 'event_91bedf464f81e794733e214176a02457e37371ece9bf38990c9cdc1f975dc22c';
    if not found
       or v_receipt.delivery_id is distinct from 'delivery_887d661b215ec7889cd0572d2fbb2e77e49934728965507ffe43d0e26ae75469'
       or v_receipt.payload_hash is distinct from 'sha256:42612edd3cf92ac392c913ec7201ca0d489e4d8636f697630a46524bc1e0f377'
       or v_receipt.transport_payload_hash is distinct from 'sha256:0d6819ca6d3e0a35d5a31d0a31696a4fc02a0314871279d5c89d399aedc8141d'
       or v_receipt.signature_verified is not false
       or v_receipt.signature_key_id is distinct from 'local-run-bundle-unverified'
       or v_receipt.retention_class is distinct from 'local_run_bundle_import'
       or v_receipt.processing_status is distinct from 'mapped'
       or v_receipt.redaction_status is distinct from 'complete'
       or v_receipt.raw_payload is distinct from '{}'::jsonb
       or v_receipt.acknowledged_at is null
    then
        raise exception 'local rehearsal receipt is not exact, local, unverified, and redacted';
    end if;

    select * into v_attempt
      from app_private.agent_feed_delivery_attempts
     where receipt_id = v_receipt.id and attempt_number = 1;
    if not found
       or v_attempt.delivery_id is distinct from v_receipt.delivery_id
       or v_attempt.signature_key_id is distinct from 'local-run-bundle-unverified'
       or v_attempt.transport_payload_hash is distinct from v_receipt.transport_payload_hash
       or v_attempt.outcome is distinct from 'replayed'
       or v_attempt.redaction_status is distinct from 'complete'
       or v_attempt.diagnostic is distinct from '{}'::jsonb
       or v_attempt.redacted_at is null
    then
        raise exception 'local rehearsal delivery attempt metadata is not exact';
    end if;

    select * into v_observation
      from app_private.source_observations
     where observation_key = 'so_finding_jp_cvs_002_payment_acceptance_001_27170bd69424f4e0';
    if not found
       or v_observation.receipt_id is distinct from v_receipt.id
       or v_observation.semantic_fingerprint is distinct from 'sha256:27170bd69424f4e047cc1217d2c78bbf73eb1408f0db025dc398b6244354f612'
       or v_observation.source_ids is distinct from '["merchant.seveneleven.payment-methods"]'::jsonb
       or v_observation.source_keys is distinct from '["merchant.seveneleven.payment-methods"]'::jsonb
       or v_observation.change_type is distinct from 'merchant_acceptance'
       or v_observation.status is distinct from 'needs_review'
       or v_observation.trust_state is distinct from 'lead_only'
       or v_observation.security_flags is distinct from '[]'::jsonb
       or v_observation.canonical_evidence_ids is distinct from '[]'::jsonb
       or v_observation.discovery_assessment #>> '{source_authority_claim}' is distinct from 'primary'
       or v_observation.discovery_assessment #>> '{evidence_completeness}' is distinct from 'complete'
       or v_observation.submitted_evidence_refs is distinct from '["ev_m3_seveneleven_payment_methods_20260820"]'::jsonb
    then
        raise exception 'local rehearsal SourceObservation binding or lifecycle is not exact';
    end if;
    if not exists (
        select 1
          from app_private.source_observation_transport_links as link
         where link.receipt_id = v_receipt.id
           and link.observation_id = v_observation.id
           and link.link_status = 'canonical'
           and link.semantic_fingerprint = v_observation.semantic_fingerprint
    ) then
        raise exception 'local rehearsal transport-to-observation link is missing';
    end if;

    if not exists (
        select 1
          from app_private.source_observation_submitted_evidence as evidence
         where evidence.observation_id = v_observation.id
           and evidence.agent_feed_evidence_id = 'ev_m3_seveneleven_payment_methods_20260820'
           and evidence.promotion_status = 'lead_only'
           and evidence.promoted_evidence_id is null
           and evidence.submitted_payload->>'evidence_id' = 'ev_m3_seveneleven_payment_methods_20260820'
           and evidence.submitted_payload->>'content_hash' = 'sha256:637988f93599ec46f8249b954e0e01130311e0491dd1f25a5b126a7264d6985c'
           and evidence.submitted_payload #>> '{source,source_id}' = 'merchant.seveneleven.payment-methods'
           and evidence.submitted_payload #>> '{metadata,source_snapshot_id}' = 'snap_m3_seveneleven_payment_methods_20260820'
    ) then
        raise exception 'local rehearsal submitted evidence payload is not the exact lead-only bundle payload';
    end if;

    select * into v_candidate
      from app_private.provisional_rule_candidates
     where candidate_hash = 'sha256:f931acf332c5432cca86af671798fe321353d11e49490d61e45b4df458e250bb';
    if not found
       or v_candidate.definition_hash is distinct from 'sha256:ebea92cf5859e2450aef073d14d19b008cfb2e1cf3cfa7030e5e46a194cb8038'
       or v_candidate.status is distinct from 'active_experimental'
       or v_candidate.source_observation_id is distinct from v_observation.id
       or v_candidate.source_observation_key is distinct from v_observation.observation_key
       or v_candidate.observation_fingerprint is distinct from v_observation.semantic_fingerprint
       or v_candidate.observation_source_ids is distinct from v_observation.source_ids
       or v_candidate.source_ids is distinct from v_observation.source_ids
       or v_candidate.p0_family_id is distinct from 'merchant.7eleven'
       or v_candidate.source_role_id is distinct from 'accepted_payment_methods'
       or v_candidate.source_authority_role is distinct from 'primary'
       or v_candidate.candidate_payload->>'candidate_id' is distinct from 'candidate_jp_cvs_002_credit_card_local_v0_1'
       or v_candidate.candidate_payload #>> '{rule,rule_id}' is distinct from 'rr_jp_cvs_002_b_accept_credit_card'
       or v_candidate.candidate_payload #>> '{rule,status}' is distinct from 'under_review'
       or v_candidate.candidate_payload #>> '{rule,provenance,human_verified}' is distinct from 'false'
       or v_candidate.candidate_payload #>> '{rule,audit,review_mode}' is not null
       or v_candidate.candidate_payload #>> '{rule,audit,reviewed_at}' is not null
       or v_candidate.candidate_payload #>> '{rule,audit,reviewed_by}' is not null
       or v_candidate.candidate_payload #>> '{rule,validity,superseded_at}' is not null
       or v_candidate.candidate_payload #>> '{extractor,name}' is distinct from 'local-agent-feed-rehearsal'
       or v_candidate.candidate_payload #>> '{machine_check,checked_at}' is distinct from '2026-08-21T00:03:00Z'
    then
        raise exception 'local rehearsal candidate snapshot/hash/under-review boundary is not exact';
    end if;

    select count(*) into v_transition_count
      from app_private.provisional_rule_transitions
     where candidate_id = v_candidate.id;
    if v_transition_count <> 2
       or not exists (
           select 1 from app_private.provisional_rule_transitions
            where candidate_id = v_candidate.id and sequence = 0
              and from_status is null and to_status = 'machine_checked'
       )
       or not exists (
           select 1 from app_private.provisional_rule_transitions
            where candidate_id = v_candidate.id and sequence = 1
              and from_status = 'machine_checked' and to_status = 'active_experimental'
              and occurred_at = '2026-08-21T00:04:00Z'
       )
    then
        raise exception 'local rehearsal lifecycle history is not the exact 0-to-1 activation';
    end if;

    select count(*) into v_view_count
      from app_api.active_experimental_provisional_rules;
    if v_view_count <> 1
       or not exists (
           select 1 from app_api.active_experimental_provisional_rules
            where candidate_hash = v_candidate.candidate_hash
              and source_authority_role = 'primary'
       )
    then
        raise exception 'local rehearsal active experimental view does not contain exactly one candidate';
    end if;

    if exists (
        select 1
          from app_private.reward_rule_versions as version
          join app_private.reward_rules as rule on rule.id = version.rule_id
         where rule.rule_key = 'rr_jp_cvs_002_b_accept_credit_card'
           and version.definition_hash = v_candidate.definition_hash
           and version.review_status = 'approved'
    ) then
        raise exception 'local rehearsal created an approved canonical rule version';
    end if;
    if exists (
        select 1
          from app_private.rule_publication_requests as request
          join app_private.reward_rules as rule on rule.id = request.rule_id
         where rule.rule_key = 'rr_jp_cvs_002_b_accept_credit_card'
    ) then
        raise exception 'local rehearsal created a canonical publication request';
    end if;
end
$$;

-- Each credible correction probe demonstrates its exclusion/quarantine in a
-- savepoint, then deliberately rolls back so the seeded active row survives.
do $$
declare
    v_candidate_hash text := 'sha256:f931acf332c5432cca86af671798fe321353d11e49490d61e45b4df458e250bb';
    v_signal jsonb;
    v_result text;
    v_status text;
    v_view_count integer;
begin
    v_signal := jsonb_build_object(
        'version','provisional-correction.v1',
        'signal_id','p0-rehearsal-rollback-rate-0001',
        'candidate_hash',v_candidate_hash,
        'category','rate_wrong',
        'credible',true,
        'reported_at','2026-08-21T00:05:00Z',
        'severity','normal'
    );
    begin
        v_result := app_private.record_provisional_correction(v_signal, 'sha256:' || repeat('a',64));
        select status into v_status
          from app_private.provisional_rule_candidates
         where candidate_hash = v_candidate_hash;
        select count(*) into v_view_count
          from app_api.active_experimental_provisional_rules;
        if v_result <> 'disputed'
           or v_status <> 'disputed'
           or v_view_count <> 0
        then
            raise exception 'credible rate correction did not dispute and exclude the active candidate';
        end if;
        raise exception using
            errcode = 'P0R01',
            message = 'rollback rate correction probe';
    exception when sqlstate 'P0R01' then
        null;
    end;
    if (select status from app_private.provisional_rule_candidates where candidate_hash = v_candidate_hash) <> 'active_experimental'
       or (select count(*) from app_api.active_experimental_provisional_rules) <> 1
    then
        raise exception 'rate correction rollback did not preserve the seeded active candidate';
    end if;

    v_signal := jsonb_build_object(
        'version','provisional-correction.v1',
        'signal_id','p0-rehearsal-rollback-source-0001',
        'candidate_hash',v_candidate_hash,
        'category','source_mismatch',
        'credible',true,
        'reported_at','2026-08-21T00:06:00Z',
        'severity','normal'
    );
    begin
        v_result := app_private.record_provisional_correction(v_signal, 'sha256:' || repeat('b',64));
        select status into v_status
          from app_private.provisional_rule_candidates
         where candidate_hash = v_candidate_hash;
        select count(*) into v_view_count
          from app_api.active_experimental_provisional_rules;
        if v_result <> 'quarantined'
           or v_status <> 'quarantined'
           or v_view_count <> 0
        then
            raise exception 'credible source correction did not quarantine and exclude the active candidate';
        end if;
        raise exception using
            errcode = 'P0R02',
            message = 'rollback source correction probe';
    exception when sqlstate 'P0R02' then
        null;
    end;
    if (select status from app_private.provisional_rule_candidates where candidate_hash = v_candidate_hash) <> 'active_experimental'
       or (select count(*) from app_api.active_experimental_provisional_rules) <> 1
       or (select count(*) from app_private.provisional_correction_signals where candidate_hash = v_candidate_hash) <> 0
    then
        raise exception 'source correction rollback did not preserve the seeded active candidate';
    end if;
end
$$;

rollback;
