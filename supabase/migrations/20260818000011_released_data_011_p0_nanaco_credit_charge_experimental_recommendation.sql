-- Staged from db/seeds/011_p0_nanaco_credit_charge_experimental_recommendation.sql; edit the canonical source, not this file.
-- Seed the exact Seven Card Plus credit-funded nanaco top-up candidate.
-- The route stays active_experimental and under_review; it is not canonical.

begin;

do $$
declare
    v_receipt_id uuid;
    v_observation_id uuid;
    v_candidate_id uuid;
    v_candidate jsonb := $candidate$
{"version":"provisional-rule-candidate.v1","candidate_id":"candidate_p0_nanaco_sevencard_credit_charge_20260822_v0_1","observation_id":"so_p0_nanaco_sevencard_credit_charge_20260822","observation_fingerprint":"sha256:4d3c2e7c57f17b3c95f96d2e4e7de1bb174b1a5fb77b428db5e886d5c8f4e5a1","p0_family_id":"point.nanaco","source_role_id":"earn_rules","source_authority_role":"primary","source_ids":["jp.nanaco.sevencard-earning","jp.sevencard.nanaco-charge"],"rule":{"rule_id":"rr_jp_cvs_006_sevencard_credit_topup_reward","version":1,"status":"under_review","rule_type":"card_benefit","name":"Seven Card Plus nanaco credit-charge earning","description":"Under-review candidate for the separate Seven Card Plus credit-funded nanaco top-up operation.","subject":{"entity_type":"credit_card","entity_id":"instrument.jp.seven-card-plus"},"scope":{"countries":["JP"],"operation_types":["stored_value_top_up"],"channels":["not_applicable"],"tax_basis":"tax_inclusive"},"eligibility":{"operation_match":{"allowed_payment_instrument_ids":["instrument.jp.seven-card-plus"],"allowed_funding_source_ids":["funding.jp.seven-card-plus"],"allowed_destination_asset_ids":["asset.jp.nanaco"]},"user_conditions":[{"fact_key":"nanaco_credit_charge_preregistered","operator":"eq","value":true,"unknown_policy":"suppress_rule"}],"transaction_conditions":{"minimum_amount_jpy":5000,"maximum_amount_jpy":30000,"eligible_amount_basis":"operation_amount","requires_single_operation":true},"campaign_conditions":{}},"calculation":{"model":"points_per_unit","reward_units":"1","spend_jpy":200,"rounding":{"aggregation_scope":"per_operation","eligible_spend_quantum_jpy":200,"reward_rounding_mode":"floor"}},"output":{"asset":{"asset_id":"asset.jp.nanaco-point","asset_kind":"reward_point","program_id":"program.jp.nanaco","reward_class":"normal","scale":0},"sign":"credit","certainty":{"type":"guaranteed","probability":null,"probability_source":null},"settlement":{"status":"pending","expected_posting_from":null,"expected_posting_to":null,"posted_at":null},"expiry":{"policy":"unknown","expires_at":null,"duration_days":null,"timezone":"Asia/Tokyo"},"restrictions":{"transferable":null,"redeemable_for_cash":null,"usable_for_payment":null,"investable":null,"permitted_destination_ids":["asset.jp.nanaco"],"notes":"nanaco points are recorded separately from nanaco principal and are not a second top-up principal balance."},"clawback":{"on_refund":"unknown","posting_delay_days":null,"notes":"No refund operation is included in this narrow experimental route."}},"caps":[],"stacking":{"stack_group":"rr_jp_cvs_006_sevencard_credit_topup_reward","mode":"additive","precedence":0,"conflicts_with_rule_ids":[],"requires_rule_ids":[]},"validity":{"valid_from":"2026-08-20T05:39:00+09:00","valid_to":null,"timezone":"Asia/Tokyo","recorded_at":"2026-08-20T05:50:00+09:00","superseded_at":null},"provenance":{"evidence_ids":["ev_m3_sevencard_nanaco_charge_20260820","ev_m3_nanaco_sevencard_earning_20260820"],"minimum_source_tier":"T1_CANONICAL","confidence":0.95,"human_verified":false,"review_notes":"Bound to the two reviewed M3 evidence records and the exact credit-charge and eligible-card claims; no canonical publication or JPY valuation is asserted."},"audit":{"created_at":"2026-08-22T00:05:00Z","created_by":"p0-nanaco-credit-charge-extractor","review_events":[],"required_review_modes":["solo_dual_pass","agent_challenged"],"review_mode":null,"reviewed_at":null,"reviewed_by":null,"change_reason":"Deterministic under-review candidate copied from checked-in M3 credit-charge evidence; not a publication decision."}},"extractor":{"name":"p0-nanaco-credit-charge-extractor","version":"0.1"},"machine_check":{"checker":"p0-nanaco-credit-charge-semantic-check","checker_version":"0.1","checked_at":"2026-08-22T00:06:00Z","checks":{"representation_safe":true,"rule_structure":true,"rule_semantics":true,"observation_binding":true,"p0_coverage":true}}}
$candidate$::jsonb;
begin
    if exists (
        select 1 from app_private.provisional_rule_candidates
         where candidate_hash =
           'sha256:3f40d8082021af23704564a0e0be870241d91490124c6912faff31beb19ce914'
    ) then
        raise exception 'Nanaco credit-charge recommendation seed is one-time and drift-sensitive';
    end if;

    insert into app_private.agent_feed_receipts (
        event_id, protocol_version, stream_id, run_id, finding_id, event_type,
        received_at, payload_hash, raw_payload, retention_class, purge_after,
        delivery_id, signature_timestamp, signature_key_id, delivery_attempt,
        transport_payload_hash, signature_verified
    ) values (
        'event_p0_nanaco_credit_charge_seed_20260822', '0.1',
        'economy.seven-nanaco', 'run_p0_nanaco_credit_charge_seed_20260822',
        'nanaco-credit-charge-ui-canary-20260822-v1', 'finding.submitted',
        '2026-08-22T00:03:00Z',
        'sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a',
        '{}'::jsonb, 'local_run_bundle_import', '2026-09-21T00:03:00Z',
        'delivery_p0_nanaco_credit_charge_seed_20260822',
        '2026-08-22T00:03:00Z', 'local-seed-unverified', 1,
        'sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a',
        false
    ) returning id into v_receipt_id;

    select observation_id into strict v_observation_id
      from app_private.map_agent_feed_finding(
          v_receipt_id,
          'so_p0_nanaco_sevencard_credit_charge_20260822',
          '["jp.nanaco.sevencard-earning","jp.sevencard.nanaco-charge"]'::jsonb,
          '[{"type":"credit_card","id":"instrument.jp.seven-card-plus","name":"Seven Card Plus"},{"type":"stored_value_program","id":"program.jp.nanaco","name":"nanaco"}]'::jsonb,
          'funding_route',
          'Exact local P0 Seven Card Plus credit-funded nanaco charge canary for the experimental UI.',
          '{"occurred_at":"2026-08-22T00:03:00Z","effective_from":"2026-08-20T05:39:00+09:00","effective_to":null}'::jsonb,
          '{"source_authority_claim":"primary","evidence_completeness":"complete","agent_confidence":0.95}'::jsonb,
          '["ev_m3_sevencard_nanaco_charge_20260820","ev_m3_nanaco_sevencard_earning_20260820"]'::jsonb,
          '{"change_type":"funding_route","funding_instrument":"instrument.jp.seven-card-plus","funding_source":"funding.jp.seven-card-plus","target_instrument":"asset.jp.nanaco","preregistration_required":true,"minimum_charge_jpy":5000,"charge_increment_jpy":1000,"maximum_charge_jpy":30000,"post_charge_balance_limit_jpy":50000,"eligible_charge_jpy":200,"reward_units":"1","claim_ids":["claim.point.nanaco.earn.credit-charge.003","claim.emoney.nanaco.eligible.001"],"canonical_publication":false,"human_verified":false}'::jsonb,
          '[]'::jsonb,
          'sha256:4d3c2e7c57f17b3c95f96d2e4e7de1bb174b1a5fb77b428db5e886d5c8f4e5a1',
          1
      );

    update app_private.source_observations
       set status = 'needs_review'
     where id = v_observation_id;

    select candidate_id into strict v_candidate_id
      from app_private.persist_p0_nanaco_credit_charge_candidate(
          'sha256:3f40d8082021af23704564a0e0be870241d91490124c6912faff31beb19ce914',
          'sha256:62785ad9ee107ddeced93f54696a24b0f38eb4873b1339f7ff351d29fa57e92b',
          v_candidate
      );

    perform app_private.activate_provisional_rule_candidate(
        'sha256:3f40d8082021af23704564a0e0be870241d91490124c6912faff31beb19ce914',
        '2026-08-22T00:07:00Z',
        'explicit Seven Card Plus nanaco credit-charge experimental activation'
    );

    insert into app_private.p0_nanaco_credit_charge_route_bindings (
        route_id, candidate_hash, claim_ids, evidence_ids, source_ids
    ) values (
        'candidate_p0_nanaco_sevencard_credit_charge_20260822_v0_1',
        'sha256:3f40d8082021af23704564a0e0be870241d91490124c6912faff31beb19ce914',
        '["claim.point.nanaco.earn.credit-charge.003","claim.emoney.nanaco.eligible.001"]'::jsonb,
        '["ev_m3_sevencard_nanaco_charge_20260820","ev_m3_nanaco_sevencard_earning_20260820"]'::jsonb,
        '["jp.nanaco.sevencard-earning","jp.sevencard.nanaco-charge"]'::jsonb
    );

    if not exists (
        select 1 from app_private.provisional_rule_candidates
         where id = v_candidate_id and status = 'active_experimental'
    ) then
        raise exception 'Nanaco credit-charge candidate did not activate';
    end if;
end
$$;

commit;
