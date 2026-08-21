begin;

do $$
declare
    v_batch app_private.provisional_publication_batches%rowtype;
begin
    select * into strict v_batch
      from app_private.provisional_publication_batches
     where batch_id = 'batch_p0_seveneleven_payment_families_20260821';
    if v_batch.batch_hash is distinct from
         'sha256:ec1d70a01eed2004edf2a7397461e9983a89172162cad05dd3a6b3eb4023482d'
       or v_batch.member_count <> 11
       or jsonb_array_length(v_batch.batch_payload->'members') <> 11
    then
        raise exception 'P0 payment-family publication batch identity drifted';
    end if;
    if (select count(*) from app_private.provisional_publication_batch_members
         where batch_id = v_batch.batch_id) <> 11
       or (select count(*) from app_api.active_experimental_provisional_publications
            where batch_id = v_batch.batch_id) <> 11
    then
        raise exception 'P0 payment-family publication membership is incomplete';
    end if;
    if exists (
        select 1
          from app_private.provisional_publication_batch_members as member
          join app_private.provisional_rule_candidates as candidate
            on candidate.id = member.candidate_id
         where member.batch_id = v_batch.batch_id
           and (
             candidate.status is distinct from 'active_experimental'
             or candidate.p0_family_id is distinct from 'merchant.7eleven'
             or candidate.source_role_id is distinct from 'accepted_payment_methods'
             or candidate.candidate_payload->'rule'->>'status' is distinct from 'under_review'
             or candidate.candidate_payload->'rule'->'provenance'->>'human_verified' is distinct from 'false'
           )
    ) then
        raise exception 'P0 payment-family member escaped provisional lifecycle constraints';
    end if;
end
$$;

do $$
declare
    v_receipt app_private.agent_feed_receipts%rowtype;
    v_observation app_private.source_observations%rowtype;
begin
    select * into strict v_receipt
      from app_private.agent_feed_receipts
     where event_id = 'event_9cf61afbfddb1984d59470024e999b72d303eef8feb2f3ae6cc1303600fa9b70';
    if v_receipt.signature_verified
       or v_receipt.payload_hash is distinct from
          'sha256:1323f959f8da89ff4ef44edc26670fcea20f9634292fa217dfb172b0c6fb1ea2'
       or v_receipt.transport_payload_hash is distinct from
          'sha256:afdcb4dc495882f38a1c88c111c5a8dc9ecaaaccb164c3d07d09a8c0c5b0b3b0'
    then
        raise exception 'P0 payment-family receipt provenance drifted';
    end if;
    select * into strict v_observation
      from app_private.source_observations
     where receipt_id = v_receipt.id;
    if v_observation.observation_key is distinct from
         'so_finding_p0_seveneleven_payment_families_20260821_81fb0e1867d59197'
       or v_observation.semantic_fingerprint is distinct from
          'sha256:81fb0e1867d59197d932134ca5c94fe8f93018769dfda1d1ebe57df2bb41bf9c'
       or v_observation.status is distinct from 'needs_review'
       or jsonb_array_length(v_observation.raw_attributes->'accepted_payment_families') <> 11
    then
        raise exception 'P0 payment-family SourceObservation drifted';
    end if;
    if not exists (
        select 1
          from app_private.source_observation_submitted_evidence
         where observation_id = v_observation.id
           and agent_feed_evidence_id = 'ev_p0_seveneleven_payment_methods_20260821'
           and promotion_status = 'lead_only'
    ) then
        raise exception 'P0 payment-family evidence must remain lead-only';
    end if;
end
$$;

rollback;
