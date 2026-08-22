-- Staged from db/seeds/002_p0_provisional_rehearsal.sql; edit the canonical source, not this file.
-- Durable local Agent Feed rehearsal for the experimental P0 boundary.
--
-- This is intentionally a local, unverified import.  The receipt is inserted
-- directly with explicit local metadata; it does not enter through the signed
-- transport acknowledgement routine.  Mapping redacts the receipt payload,
-- while the bundle hash remains the transport-artifact identity and the
-- candidate snapshot remains private/immutable.

begin;

do $$
begin
    if exists (
        select 1 from app_private.agent_feed_receipts
         where event_id = 'event_91bedf464f81e794733e214176a02457e37371ece9bf38990c9cdc1f975dc22c'
    ) then
        raise exception 'P0 rehearsal receipt already exists; seed is one-time and drift-sensitive';
    end if;
    if exists (
        select 1 from app_private.source_observations
         where observation_key = 'so_finding_jp_cvs_002_payment_acceptance_001_27170bd69424f4e0'
            or semantic_fingerprint = 'sha256:27170bd69424f4e047cc1217d2c78bbf73eb1408f0db025dc398b6244354f612'
    ) then
        raise exception 'P0 rehearsal SourceObservation identity already exists';
    end if;
    if exists (
        select 1 from app_private.provisional_rule_candidates
         where candidate_hash = 'sha256:f931acf332c5432cca86af671798fe321353d11e49490d61e45b4df458e250bb'
    ) then
        raise exception 'P0 rehearsal candidate hash already exists';
    end if;
end
$$;

do $$
declare
    v_receipt_id uuid;
    v_observation_id uuid;
    v_candidate_id uuid;
    v_mapping_status text;
    v_candidate jsonb;
    v_evidence jsonb;
    v_raw_payload jsonb;
begin
    v_candidate := $candidate_json$
{
  "version": "provisional-rule-candidate.v1",
  "candidate_id": "candidate_jp_cvs_002_credit_card_local_v0_1",
  "observation_id": "so_finding_jp_cvs_002_payment_acceptance_001_27170bd69424f4e0",
  "observation_fingerprint": "sha256:27170bd69424f4e047cc1217d2c78bbf73eb1408f0db025dc398b6244354f612",
  "p0_family_id": "merchant.7eleven",
  "source_role_id": "accepted_payment_methods",
  "source_authority_role": "primary",
  "source_ids": [
    "merchant.seveneleven.payment-methods"
  ],
  "rule": {
    "rule_id": "rr_jp_cvs_002_b_accept_credit_card",
    "version": 1,
    "status": "under_review",
    "rule_type": "payment_acceptance",
    "name": "Seven-Eleven credit-card acceptance",
    "description": "Acceptance-only candidate rule for the evidenced credit-card family.",
    "subject": {
      "entity_type": "merchant",
      "entity_id": "merchant.seveneleven"
    },
    "scope": {
      "countries": ["JP"],
      "operation_types": ["merchant_purchase"],
      "merchant_ids": ["merchant.seveneleven"],
      "channels": ["in_store"],
      "included_product_classes": ["ordinary"],
      "excluded_product_classes": [],
      "tax_basis": "tax_inclusive"
    },
    "eligibility": {
      "operation_match": {
        "required_loyalty_program_ids": [],
        "excluded_payment_instrument_ids": [],
        "allowed_funding_source_ids": [],
        "excluded_funding_source_ids": [],
        "allowed_source_asset_ids": [],
        "excluded_source_asset_ids": [],
        "allowed_destination_asset_ids": [],
        "required_interfaces": [],
        "excluded_interfaces": [],
        "must_present_before_payment": false,
        "allowed_payment_instrument_ids": ["instrument.seveneleven.credit_card"]
      },
      "user_conditions": [],
      "transaction_conditions": {
        "eligible_amount_basis": "not_applicable",
        "requires_single_operation": true
      },
      "campaign_conditions": {
        "entry_required": false,
        "targeted_offer": false,
        "identity_verification_required": false,
        "first_use_only": false
      }
    },
    "effect": {
      "decision": "allow",
      "effect_target": "operation_eligibility",
      "target_rule_ids": [],
      "target_stack_groups": [],
      "reason_code": "accepted_payment_family_credit_card"
    },
    "caps": [],
    "stacking": {
      "stack_group": "jp_cvs_002_payment_acceptance",
      "mode": "non_reward_acceptance",
      "precedence": 10,
      "conflicts_with_rule_ids": [],
      "requires_rule_ids": [],
      "notes": "Payment acceptance is intentionally non-financial."
    },
    "validity": {
      "valid_from": "2026-08-20T05:39:00+09:00",
      "valid_to": null,
      "timezone": "Asia/Tokyo",
      "recorded_at": "2026-08-20T05:45:00+09:00",
      "superseded_at": null
    },
    "provenance": {
      "evidence_ids": ["ev_m3_seveneleven_payment_methods_20260820"],
      "minimum_source_tier": "T1_CANONICAL",
      "confidence": 0.95,
      "human_verified": false,
      "review_notes": "Payment family was reviewed from the first-party Seven-Eleven payment-methods source; this rule carries no reward calculation."
    },
    "audit": {
      "created_at": "2026-08-20T05:42:00+09:00",
      "created_by": "m3-jp-cvs-002-builder",
      "review_events": [],
      "required_review_modes": ["solo_dual_pass", "agent_challenged"],
      "review_mode": null,
      "reviewed_at": null,
      "reviewed_by": null,
      "change_reason": "Initial M3 under-review acceptance candidate; not a canonical publication."
    }
  },
  "extractor": {
    "name": "local-agent-feed-rehearsal",
    "version": "0.1"
  },
  "machine_check": {
    "checker": "p0-local-rehearsal",
    "checker_version": "0.1",
    "checked_at": "2026-08-21T00:03:00Z",
    "checks": {
      "representation_safe": true,
      "rule_structure": true,
      "rule_semantics": true,
      "observation_binding": true,
      "p0_coverage": true
    }
  }
}
$candidate_json$::jsonb;

    v_evidence := $evidence_json$
{
  "evidence_id": "ev_m3_seveneleven_payment_methods_20260820",
  "kind": "web",
  "source": {
    "uri": "https://www.sej.co.jp/services/cash.html",
    "title": null,
    "publisher": null,
    "source_id": "merchant.seveneleven.payment-methods"
  },
  "captured_at": "2026-08-20T03:13:10+09:00",
  "published_at": null,
  "locator": {
    "type": "manual_note",
    "value": "Normalized accepted-payment-family facts from a manual review; no source excerpt retained.",
    "page": null
  },
  "excerpt": null,
  "content_hash": "sha256:637988f93599ec46f8249b954e0e01130311e0491dd1f25a5b126a7264d6985c",
  "artifact": {
    "uri": null,
    "media_type": null,
    "size_bytes": null
  },
  "handling": {
    "contains_personal_data": false,
    "contains_secrets": false,
    "redistribution_restricted": false
  },
  "metadata": {
    "source_snapshot_id": "snap_m3_seveneleven_payment_methods_20260820",
    "capture_method": "manual_capture",
    "record_type": "normalized_manual_source_snapshot"
  }
}
$evidence_json$::jsonb;

    v_raw_payload := jsonb_build_object(
        'finding', $finding_json$
{
  "finding_id": "finding_jp_cvs_002_payment_acceptance_001",
  "finding_type": "rewards.merchant_acceptance",
  "title": "Seven-Eleven lists credit cards among accepted payment families",
  "summary": "The reviewed Seven-Eleven payment-methods source lists credit cards as an accepted payment family.",
  "subjects": [{"type":"merchant","id":"merchant.7eleven","name":"7-Eleven"}],
  "effective_time": {"occurred_at":null,"effective_from":null,"effective_to":null},
  "assessment": {"novelty":"known","evidence_completeness":"complete","agent_confidence":0.95,"source_authority_claim":"primary"},
  "evidence_refs": ["ev_m3_seveneleven_payment_methods_20260820"],
  "producer_dedupe_key": "JP-CVS-002|merchant.7eleven|credit_card",
  "routing_tags": ["p0","merchant-acceptance"],
  "attributes": {
    "change_kind":"merchant_acceptance",
    "merchant_id":"merchant.7eleven",
    "accepted_payment_family":"credit_card",
    "source_id":"merchant.seveneleven.payment-methods",
    "source_snapshot_id":"snap_m3_seveneleven_payment_methods_20260820"
  },
  "security_flags": []
}
$finding_json$::jsonb,
        'submitted_evidence', jsonb_build_array(v_evidence),
        'import_provenance', jsonb_build_object(
            'mode', 'local_run_bundle_import',
            'bundle_hash', 'sha256:0d6819ca6d3e0a35d5a31d0a31696a4fc02a0314871279d5c89d399aedc8141d',
            'imported_at', '2026-08-21T00:02:00.000Z'
        )
    );

    insert into app_private.agent_feed_receipts (
        event_id, protocol_version, stream_id, run_id, finding_id, event_type,
        received_at, payload_hash, raw_payload, retention_class, purge_after,
        delivery_id, signature_timestamp, signature_key_id, delivery_attempt,
        transport_payload_hash, signature_verified
    ) values (
        'event_91bedf464f81e794733e214176a02457e37371ece9bf38990c9cdc1f975dc22c',
        '0.1',
        'rewards-optimizer.jp-cvs-002',
        'run_jp_cvs_002_payment_acceptance_local_20260821',
        'finding_jp_cvs_002_payment_acceptance_001',
        'finding.submitted',
        '2026-08-21T00:02:00.000Z',
        'sha256:42612edd3cf92ac392c913ec7201ca0d489e4d8636f697630a46524bc1e0f377',
        v_raw_payload,
        'local_run_bundle_import',
        '2026-09-20T00:02:00.000Z',
        'delivery_887d661b215ec7889cd0572d2fbb2e77e49934728965507ffe43d0e26ae75469',
        '2026-08-21T00:02:00.000Z',
        'local-run-bundle-unverified',
        1,
        'sha256:0d6819ca6d3e0a35d5a31d0a31696a4fc02a0314871279d5c89d399aedc8141d',
        false
    ) returning id into v_receipt_id;

    insert into app_private.agent_feed_delivery_attempts (
        receipt_id, delivery_id, attempt_number, attempted_at,
        signature_timestamp, signature_key_id, transport_payload_hash,
        outcome, diagnostic, redaction_status, redacted_at
    ) values (
        v_receipt_id,
        'delivery_887d661b215ec7889cd0572d2fbb2e77e49934728965507ffe43d0e26ae75469',
        1,
        '2026-08-21T00:02:00.000Z',
        '2026-08-21T00:02:00.000Z',
        'local-run-bundle-unverified',
        'sha256:0d6819ca6d3e0a35d5a31d0a31696a4fc02a0314871279d5c89d399aedc8141d',
        'replayed', '{}', 'complete', '2026-08-21T00:02:00.000Z'
    );

    select observation_id, mapping_status
      into v_observation_id, v_mapping_status
      from app_private.map_agent_feed_finding(
          v_receipt_id,
          'so_finding_jp_cvs_002_payment_acceptance_001_27170bd69424f4e0',
          '["merchant.seveneleven.payment-methods"]'::jsonb,
          '[{"type":"merchant","id":"merchant.7eleven","name":"7-Eleven"}]'::jsonb,
          'merchant_acceptance',
          'The reviewed Seven-Eleven payment-methods source lists credit cards as an accepted payment family.',
          '{"occurred_at":null,"effective_from":null,"effective_to":null}'::jsonb,
          '{"source_authority_claim":"primary","evidence_completeness":"complete","agent_confidence":0.95}'::jsonb,
          '["ev_m3_seveneleven_payment_methods_20260820"]'::jsonb,
          '{"change_kind":"merchant_acceptance","merchant_id":"merchant.7eleven","accepted_payment_family":"credit_card","source_id":"merchant.seveneleven.payment-methods","source_snapshot_id":"snap_m3_seveneleven_payment_methods_20260820"}'::jsonb,
          '[]'::jsonb,
          'sha256:27170bd69424f4e047cc1217d2c78bbf73eb1408f0db025dc398b6244354f612',
          1
      );
    if v_mapping_status is distinct from 'mapped' or v_observation_id is null then
        raise exception 'local rehearsal finding did not map to a new observation';
    end if;

    update app_private.source_observations
       set status = 'needs_review'
     where id = v_observation_id;

    update app_private.source_observation_submitted_evidence
       set submitted_payload = v_evidence,
           promotion_status = 'lead_only'
     where observation_id = v_observation_id
       and agent_feed_evidence_id = 'ev_m3_seveneleven_payment_methods_20260820';
    if not found then
        raise exception 'mapped local rehearsal evidence lead is missing';
    end if;

    v_candidate_id := app_private.persist_provisional_rule_candidate(
        'sha256:f931acf332c5432cca86af671798fe321353d11e49490d61e45b4df458e250bb',
        'sha256:ebea92cf5859e2450aef073d14d19b008cfb2e1cf3cfa7030e5e46a194cb8038',
        v_candidate
    );
    perform app_private.activate_provisional_rule_candidate(
        'sha256:f931acf332c5432cca86af671798fe321353d11e49490d61e45b4df458e250bb',
        '2026-08-21T00:04:00Z',
        'local P0 rehearsal activation'
    );
    if not exists (
        select 1 from app_private.provisional_rule_candidates
         where id = v_candidate_id and status = 'active_experimental'
    ) then
        raise exception 'local rehearsal candidate did not activate';
    end if;
end
$$;

commit;
