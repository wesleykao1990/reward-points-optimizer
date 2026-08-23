import type { ActiveRewardClaimRecord } from "@jro/agent-feed-postgres";
import {
  compileRewardClaims,
  freezeP0CoverageIndex,
} from "@jro/provisional-rules";
import { describe, expect, it } from "vitest";

import { createActiveRewardCalculationPort } from "../src/active-reward-calculation.js";

const COVERAGE = freezeP0CoverageIndex({
  version: "test-coverage.v1",
  entries: [
    {
      family_id: "card.rakuten",
      source_role_id: "base_reward_rules",
      known_source_ids: ["source.rakuten.test"],
    },
  ],
});

const OUTPUT = {
  asset: {
    asset_id: "asset.jp.rakuten-point",
    asset_kind: "reward_point",
    program_id: "program.jp.rakuten-point",
    reward_class: "normal",
    scale: 0,
  },
  sign: "credit",
  certainty: {
    type: "guaranteed",
    probability: null,
    probability_source: null,
  },
  settlement: {
    status: "posted",
    expected_posting_from: null,
    expected_posting_to: null,
    posted_at: null,
  },
  expiry: {
    policy: "unknown",
    expires_at: null,
    duration_days: null,
    timezone: "Asia/Tokyo",
  },
  restrictions: {
    transferable: null,
    redeemable_for_cash: null,
    usable_for_payment: true,
    investable: null,
    permitted_destination_ids: [],
    notes: "",
  },
  clawback: {
    on_refund: "proportional",
    posting_delay_days: null,
    notes: "",
  },
};

function claim(claimId: string, userConditions: readonly unknown[] = []) {
  return {
    claim_id: claimId,
    claim_type: "points_per_unit",
    subject: {
      entity_type: "credit_card",
      entity_id: "card.jp.rakuten",
    },
    scope: {
      countries: ["JP"],
      operation_types: ["merchant_purchase"],
      channels: ["in_store", "online"],
      tax_basis: "tax_inclusive",
    },
    eligibility: {
      operation_match: {
        allowed_payment_instrument_ids: ["card.jp.rakuten"],
      },
      user_conditions: userConditions,
      transaction_conditions: {
        eligible_amount_basis: "operation_amount",
        requires_single_operation: true,
      },
      campaign_conditions: {},
    },
    calculation: {
      model: "points_per_unit",
      reward_units: "2",
      spend_jpy: 100,
      rounding: {
        aggregation_scope: "per_operation",
        eligible_spend_quantum_jpy: 100,
        reward_rounding_mode: "floor",
      },
    },
    output: structuredClone(OUTPUT),
    caps: [],
    validity: {
      valid_from: "2026-08-20T00:00:00+09:00",
      valid_to: null,
      timezone: "Asia/Tokyo",
      recorded_at: "2026-08-20T00:00:00+09:00",
      superseded_at: null,
    },
  };
}

function observation() {
  return {
    observation_id: "so_rakuten_active_test",
    agent_feed: {
      protocol_version: "0.1",
      event_id: "event_rakuten_active_test",
      stream_id: "stream.rakuten.test",
      run_id: "run_rakuten_active_test",
      finding_id: "finding_rakuten_active_test",
    },
    source_ids: ["source.rakuten.test"],
    subjects: [
      { type: "credit_card", id: "card.jp.rakuten", name: "楽天カード" },
    ],
    change_type: "reward_rate",
    summary: "Structured active reward claim.",
    effective_time: {
      occurred_at: "2026-08-20T00:00:00+09:00",
      effective_from: "2026-08-20T00:00:00+09:00",
      effective_to: null,
    },
    discovery_assessment: {
      source_authority_claim: "primary",
      evidence_completeness: "complete",
      agent_confidence: null,
    },
    submitted_evidence_refs: ["ev_rakuten_active_test"],
    canonical_evidence_ids: [],
    semantic_fingerprint_version: 1,
    semantic_fingerprint:
      "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    status: "needs_review",
    security_flags: [],
    raw_attributes: {
      reward_claims: {
        version: "reward-claim.v1",
        claims: [
          claim("claim.rakuten.valid"),
          claim("claim.rakuten.conditional", [
            {
              fact_key: "campaign.enrolled",
              operator: "eq",
              value: true,
              unknown_policy: "ask_user",
            },
          ]),
        ],
      },
    },
    created_at: "2026-08-20T00:00:00+09:00",
    updated_at: "2026-08-20T00:00:00+09:00",
  };
}

describe("active Agent Feed reward calculation", () => {
  it("automatically applies an active structured rule and ignores an inapplicable sibling", async () => {
    const sourceObservation = observation();
    const compiled = compileRewardClaims(sourceObservation, {
      binding: {
        p0_family_id: "card.rakuten",
        source_role_id: "base_reward_rules",
        source_ids: ["source.rakuten.test"],
        p0_coverage_index: COVERAGE,
      },
    });
    expect(compiled.envelopes).toHaveLength(2);
    expect(
      compiled.envelopes.every((item) => item.status === "active_experimental"),
    ).toBe(true);
    const records = compiled.envelopes.map(
      (envelope): ActiveRewardClaimRecord => ({
        candidate_hash: envelope.candidate_hash,
        definition_hash: envelope.definition_hash,
        candidate_id: envelope.candidate.candidate_id ?? "candidate.test",
        candidate_payload: envelope.candidate,
        p0_family_id: envelope.candidate.p0_family_id,
        source_role_id: envelope.candidate.source_role_id,
        source_ids: envelope.candidate.source_ids,
        observation:
          sourceObservation as ActiveRewardClaimRecord["observation"],
        source_url: "https://www.rakuten-card.co.jp/point/",
        checked_at: "2026-08-23T00:00:00+09:00",
      }),
    );
    const port = createActiveRewardCalculationPort({
      async list() {
        return records;
      },
    });

    await expect(
      port.calculate({
        selected_p0_products: ["card.rakuten"],
        merchant_id: "merchant.lawson",
        branch_id: "location.lawson.representative",
        amount_jpy: 250,
        tax_exclusive_amount_jpy: 227,
        effective_at: "2026-08-23T00:00:00+09:00",
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        family_id: "card.rakuten",
        reward_points: "4",
        rate_percent: "2",
        source_claim_id: "claim.rakuten.valid",
        source_url: "https://www.rakuten-card.co.jp/point/",
        calculation_source: "agent_feed_structured",
      }),
    ]);
  });
});
