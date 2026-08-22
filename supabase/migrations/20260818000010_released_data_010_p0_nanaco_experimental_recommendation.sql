-- Staged from db/seeds/010_p0_nanaco_experimental_recommendation.sql; edit the canonical source, not this file.
-- Seed the one exact P0 economic rule that is currently executable by the
-- consumer alpha. This is an explicitly unverified experimental candidate,
-- not a canonical RewardRuleVersion publication.

begin;

do $$
declare
    v_receipt_id uuid;
    v_observation_id uuid;
    v_candidate_id uuid;
    v_candidate jsonb := $candidate$
{"version":"provisional-rule-candidate.v1","candidate_id":"candidate_p0_nanaco_shopping_earning_20260821_v0_1","observation_id":"so_p0_nanaco_earn_rules_20260821","observation_fingerprint":"sha256:18a176e1ccb2e0eafe353f86ea8dfa7c0660fe3eec3d460e527e5bcc90060894","p0_family_id":"point.nanaco","source_role_id":"earn_rules","source_authority_role":"primary","source_ids":["jp.nanaco.shopping-earning"],"rule":{"rule_id":"rr_jp_cvs_006_nanaco_purchase_reward","version":1,"status":"under_review","rule_type":"base_reward","name":"Seven-Eleven ordinary nanaco purchase earning","description":"Reviewed candidate reward rule with operation-scoped attribution.","subject":{"entity_type":"stored_value_program","entity_id":"program.jp.nanaco"},"scope":{"countries":["JP"],"operation_types":["merchant_purchase"],"channels":["in_store"],"merchant_ids":["merchant.seveneleven"],"included_product_classes":["ordinary"],"tax_basis":"tax_exclusive"},"eligibility":{"operation_match":{"required_loyalty_program_ids":["program.jp.nanaco"],"allowed_payment_instrument_ids":["instrument.jp.nanaco"],"allowed_funding_source_ids":["funding.jp.nanaco"],"allowed_source_asset_ids":["asset.jp.nanaco"]},"user_conditions":[],"transaction_conditions":{"eligible_amount_basis":"eligible_line_items"},"campaign_conditions":{}},"calculation":{"model":"points_per_unit","reward_units":"1","spend_jpy":200,"rounding":{"aggregation_scope":"per_operation","eligible_spend_quantum_jpy":200,"reward_rounding_mode":"floor"}},"output":{"asset":{"asset_id":"asset.jp.nanaco-point","asset_kind":"reward_point","program_id":"program.jp.nanaco","reward_class":"normal","scale":0},"sign":"credit","certainty":{"type":"guaranteed","probability":null,"probability_source":null},"settlement":{"status":"posted","expected_posting_from":null,"expected_posting_to":null,"posted_at":null},"expiry":{"policy":"unknown","expires_at":null,"duration_days":null,"timezone":"Asia/Tokyo"},"restrictions":{"transferable":null,"redeemable_for_cash":null,"usable_for_payment":null,"investable":null,"permitted_destination_ids":["asset.jp.nanaco"],"notes":"nanaco points are recorded separately from nanaco principal and are not a second top-up principal balance."},"clawback":{"on_refund":"unknown","posting_delay_days":null,"notes":"No refund operation is included in this narrow candidate slice."}},"caps":[],"stacking":{"stack_group":"rr_jp_cvs_006_nanaco_purchase_reward","mode":"additive","precedence":0,"conflicts_with_rule_ids":[],"requires_rule_ids":[]},"validity":{"valid_from":"2026-08-20T05:39:00+09:00","valid_to":null,"timezone":"Asia/Tokyo","recorded_at":"2026-08-20T05:50:00+09:00","superseded_at":null},"provenance":{"evidence_ids":["ev_m3_nanaco_shopping_earning_20260820"],"minimum_source_tier":"T1_CANONICAL","confidence":0.95,"human_verified":false,"review_notes":"Source-bound provisional candidate; no human verification or publication claim is made."},"audit":{"created_at":"2026-08-21T00:04:00Z","created_by":"p0-nanaco-economic-extractor","review_events":[],"required_review_modes":["solo_dual_pass","agent_challenged"],"review_mode":null,"reviewed_at":null,"reviewed_by":null,"change_reason":"Deterministic provisional candidate copied from the checked-in economic definition; not a publication decision."}},"extractor":{"name":"p0-nanaco-economic-extractor","version":"0.1"},"machine_check":{"checker":"p0-nanaco-economic-semantic-check","checker_version":"0.1","checked_at":"2026-08-21T00:05:00Z","checks":{"representation_safe":true,"rule_structure":true,"rule_semantics":true,"observation_binding":true,"p0_coverage":true}}}
$candidate$::jsonb;
begin
    if exists (
        select 1 from app_private.provisional_rule_candidates
         where candidate_hash = 'sha256:05c33d3f208f425b511bb90ef71a6a22e1f45973c23b1997f9f9a316a7fbff07'
    ) then
        raise exception 'Nanaco experimental recommendation seed is one-time and drift-sensitive';
    end if;

    insert into app_private.agent_feed_receipts (
        event_id, protocol_version, stream_id, run_id, finding_id, event_type,
        received_at, payload_hash, raw_payload, retention_class, purge_after,
        delivery_id, signature_timestamp, signature_key_id, delivery_attempt,
        transport_payload_hash, signature_verified
    ) values (
        'event_p0_nanaco_recommendation_seed_20260822', '0.1',
        'economy.seven-nanaco', 'run_p0_nanaco_recommendation_seed_20260822',
        'nanaco-economic-ui-canary-20260821-v1', 'finding.submitted',
        '2026-08-21T00:03:00Z',
        'sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a',
        '{}'::jsonb, 'local_run_bundle_import', '2026-09-20T00:03:00Z',
        'delivery_p0_nanaco_recommendation_seed_20260822',
        '2026-08-21T00:03:00Z', 'local-seed-unverified', 1,
        'sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a',
        false
    ) returning id into v_receipt_id;

    select observation_id into strict v_observation_id
      from app_private.map_agent_feed_finding(
          v_receipt_id,
          'so_p0_nanaco_earn_rules_20260821',
          '["jp.nanaco.shopping-earning"]'::jsonb,
          '[{"type":"loyalty_program","id":"program.jp.nanaco","name":"nanaco"},{"type":"merchant","id":"merchant.seveneleven","name":"Seven-Eleven"}]'::jsonb,
          'reward_rate',
          'Exact local P0 Nanaco reward-rate canary for the experimental UI.',
          '{"occurred_at":"2026-08-21T00:03:00Z","effective_from":"2026-08-20T05:39:00+09:00","effective_to":null}'::jsonb,
          '{"source_authority_claim":"primary","evidence_completeness":"complete","agent_confidence":0.95}'::jsonb,
          '["ev_m3_nanaco_shopping_earning_20260820"]'::jsonb,
          '{"change_type":"reward_rate","program_id":"program.jp.nanaco","merchant_id":"merchant.seveneleven","reward_rate":{"reward_units":"1","spend_jpy":200,"spend_basis":"tax_exclusive"},"eligible_product_class":"ordinary","posting_timing":"immediate_for_listed_merchant","product_exclusions_apply":true,"canonical_publication":false,"human_verified":false}'::jsonb,
          '[]'::jsonb,
          'sha256:18a176e1ccb2e0eafe353f86ea8dfa7c0660fe3eec3d460e527e5bcc90060894',
          1
      );

    update app_private.source_observations
       set status = 'needs_review'
     where id = v_observation_id;

    select candidate_id into strict v_candidate_id
      from app_private.persist_p0_economic_candidate(
          'sha256:05c33d3f208f425b511bb90ef71a6a22e1f45973c23b1997f9f9a316a7fbff07',
          'sha256:9f8cb5de0af689ee8ca751a3ae6a34c2d974eb1c79c29c60bd555da4db116746',
          v_candidate
      );
    perform app_private.activate_provisional_rule_candidate(
        'sha256:05c33d3f208f425b511bb90ef71a6a22e1f45973c23b1997f9f9a316a7fbff07',
        '2026-08-21T00:06:00Z',
        'explicit Nanaco experimental UI activation'
    );
    if not exists (
        select 1 from app_private.provisional_rule_candidates
         where id = v_candidate_id and status = 'active_experimental'
    ) then
        raise exception 'Nanaco experimental recommendation seed did not activate';
    end if;
end
$$;

commit;
