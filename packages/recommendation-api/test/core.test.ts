import { describe, expect, it } from "vitest";
import {
  makeAssetDefinitions,
  makeDirectPurchasePlan,
  makePercentageRule,
  makeTopupPurchasePlan,
  makeUserState,
  SYNTHETIC_REPLAY_KNOWLEDGE_TIME,
  SYNTHETIC_TRANSACTION_TIME,
} from "../../test-fixtures/src/index.ts";
import {
  evaluateRecommendation,
  hashRecommendationPayload,
  recommend,
  serializeRecommendation,
  verifyRecommendationHashes,
} from "../src/core.js";
import type { RecommendationRequest } from "../src/types.js";

function assurance(ruleId: string): Record<string, unknown> {
  return {
    rule_id: ruleId,
    version: 1,
    status: "approved",
    terms_reviewed: true,
    terms_status: "approved",
    review_approved: true,
    review_status: "approved",
    canonical_evidence: [
      {
        evidence_id: `ev_${ruleId}`,
        source_id: "source.synthetic",
        verified: true,
      },
    ],
    canonical_evidence_ids: [`ev_${ruleId}`],
    evidence_verified: true,
    sources: [{ source_id: "source.synthetic", verified: true }],
    source_ids: ["source.synthetic"],
    sources_verified: true,
    freshness_status: "healthy",
    risk_status: "low",
    unresolved_high_risk: false,
  };
}

function request(
  overrides: Partial<RecommendationRequest> = {},
): RecommendationRequest {
  const rules = [
    makePercentageRule("rr_recommendation", ["merchant_purchase"], 100),
  ];
  return {
    version: "1",
    request_id: "req_synthetic_1",
    mode: "synthetic_internal",
    transaction_time: SYNTHETIC_TRANSACTION_TIME,
    replay_knowledge_at: SYNTHETIC_REPLAY_KNOWLEDGE_TIME,
    timezone: "Asia/Tokyo",
    source_maintenance_status: { status: "insufficient_data" },
    merchant_query: {
      merchant_id: "merchant.synthetic",
      branch_id: "location.synthetic",
    },
    merchant_catalog: {
      version: "synthetic-catalog-v1",
      merchants: [
        {
          merchant_id: "merchant.synthetic",
          name: "Synthetic Merchant",
          aliases: ["Synthetic Shop"],
          branches: [
            { branch_id: "location.synthetic", name: "Tokyo Synthetic" },
          ],
        },
      ],
    },
    comparison: {
      merchant_id: "merchant.synthetic",
      merchant_location_id: "location.synthetic",
      amount_jpy: 640,
      channel: "in_store",
      interface: "physical_card",
      line_items: [
        {
          product_class: "ordinary",
          amount_jpy: 640,
          quantity: 1,
          eligible_for_rewards: true,
        },
      ],
    },
    candidate_plans: [makeDirectPurchasePlan(), makeTopupPurchasePlan()],
    rules,
    assets: makeAssetDefinitions(),
    user_state: makeUserState("0.95"),
    objective: {
      primary: "maximize_guaranteed_net_value",
      probabilistic_reward_policy: "guaranteed_only",
      ending_asset_valuation: "use_user_profile",
      tie_breakers: ["lower_external_funding", "fewer_operations"],
    },
    rule_assurances: [assurance("rr_recommendation")],
    evidence_refs: [
      { evidence_id: "ev_rr_recommendation", source_id: "source.synthetic" },
    ],
    ...overrides,
  };
}

describe("Milestone 5 recommendation core", () => {
  it("produces a synthetic-only deterministic result and JSON-safe values", () => {
    const first = recommend(request());
    const second = evaluateRecommendation(request());
    expect(first.verification_status).toBe("synthetic_only");
    expect(first.outcome).toBe("definite");
    expect(first.winner_plan_id).toBeTruthy();
    expect(first.replay.input_hash).toBe(second.replay.input_hash);
    expect(first.replay.output_hash).toBe(second.replay.output_hash);
    expect(hashRecommendationPayload(first)).toBe(first.replay.output_hash);
    expect(verifyRecommendationHashes(first)).toBe(true);
    expect(
      hashRecommendationPayload(
        JSON.parse(serializeRecommendation(first)) as typeof first,
      ),
    ).toBe(first.replay.output_hash);
    expect(() => JSON.stringify(first)).not.toThrow();
    expect(serializeRecommendation(first)).not.toContain("canonical_input");
    expect(serializeRecommendation(first)).not.toContain("canonical_output");
    expect(Object.isFrozen(first)).toBe(true);
  });

  it("isolates caller mutation and keeps unordered catalog/evidence inputs deterministic", () => {
    const original = request();
    const first = recommend(original);
    const firstMerchant = original.merchant_catalog.merchants[0];
    const firstBranch = firstMerchant?.branches[0];
    if (!firstMerchant || !firstBranch)
      throw new Error("synthetic merchant fixture missing");
    (firstBranch as { name: string }).name = "mutated";
    const reordered = request({
      evidence_refs: [
        { evidence_id: "ev_rr_recommendation", source_id: "source.synthetic" },
      ],
    });
    expect(first.replay.input_hash).toBe(
      recommend(reordered).replay.input_hash,
    );
  });

  it("rejects ambiguous or chain-only merchant selection", () => {
    expect(() =>
      recommend(
        request({ merchant_query: { merchant_alias: "Synthetic Shop" } }),
      ),
    ).toThrow(/branch_query_required/);
    expect(() =>
      recommend(
        request({
          merchant_query: {
            merchant_id: "merchant.synthetic",
            branch_id: "wrong",
          },
        }),
      ),
    ).toThrow(/branch_id_not_found/);
  });

  it("retains a candidate whose frozen purchase does not match", () => {
    const bad = makeDirectPurchasePlan(640);
    const badPurchase = bad.operations[0];
    if (!badPurchase) throw new Error("synthetic purchase fixture missing");
    badPurchase.amount_jpy = 641;
    const result = recommend(
      request({ candidate_plans: [bad, makeTopupPurchasePlan()] }),
    );
    expect(result.rejected_plans.map((plan) => plan.plan_id)).toContain(
      bad.plan_id,
    );
    expect(
      result.rejected_plans.find((plan) => plan.plan_id === bad.plan_id)
        ?.rejection_reasons[0]?.message,
    ).toMatch(/amount_mismatch/);
  });

  it("blocks unsupported objectives and stale assurances before evaluation", () => {
    expect(() =>
      recommend(
        request({
          objective: {
            primary: "minimize_net_cost",
            probabilistic_reward_policy: "guaranteed_only",
            ending_asset_valuation: "use_user_profile",
            tie_breakers: [],
          } as unknown as RecommendationRequest["objective"],
        }),
      ),
    ).toThrow(/unsupported_engine_objective/);
    expect(() =>
      recommend(
        request({
          rule_assurances: [
            { ...assurance("rr_recommendation"), freshness_status: "stale" },
          ],
        }),
      ),
    ).toThrow(/rule_trust_blocked/);
  });

  it("keeps production blocked while allowing synthetic fixtures to run", () => {
    const result = recommend(
      request({
        mode: "production",
        source_maintenance_status: { status: "green" },
      }),
    );
    expect(result.outcome).toBe("blocked");
    expect(result.verification_status).toBe("blocked");
    expect(result.blockers).toEqual(["production_authorization_unavailable"]);
  });

  it("requires exact versioned rule assurances and rejects wildcard omissions", () => {
    const { version: _version, ...versionless } =
      assurance("rr_recommendation");
    expect(() =>
      recommend(request({ rule_assurances: [versionless] })),
    ).toThrow(/rule_assurance_version_missing/);
    expect(() =>
      recommend(
        request({
          rule_assurances: [{ ...assurance("rr_recommendation"), version: 2 }],
        }),
      ),
    ).toThrow(/rule_assurance_missing/);
  });

  it("normalizes candidate order and keeps frozen purchase dates bound to the transaction", () => {
    const base = request();
    const reordered = request({
      candidate_plans: [...base.candidate_plans].reverse(),
    });
    const first = recommend(base);
    const second = recommend(reordered);
    expect(second.replay.input_hash).toBe(first.replay.input_hash);
    expect(second.replay.output_hash).toBe(first.replay.output_hash);
    expect(second.plans.map((plan) => plan.plan_id)).toEqual(
      first.plans.map((plan) => plan.plan_id),
    );
    expect(second.assumptions).toEqual(first.assumptions);

    const wrongDate = makeDirectPurchasePlan();
    const purchase = wrongDate.operations[0];
    if (!purchase) throw new Error("synthetic purchase fixture missing");
    purchase.occurred_at = "2026-08-18T12:00:00+09:00";
    const result = recommend(
      request({ candidate_plans: [wrongDate, makeTopupPurchasePlan()] }),
    );
    expect(
      result.rejected_plans
        .find((plan) => plan.plan_id === wrongDate.plan_id)
        ?.rejection_reasons.map((reason) => reason.code),
    ).toContain("occurred_at_date_mismatch");
  });

  it("redacts raw engine failures to stable rejection codes", () => {
    const invalid = structuredClone(makeDirectPurchasePlan()) as unknown as {
      dependencies?: unknown;
    };
    delete invalid.dependencies;
    const result = recommend(
      request({
        candidate_plans: [
          invalid as unknown as RecommendationRequest["candidate_plans"][number],
          makeTopupPurchasePlan(),
        ],
      }),
    );
    const rejection = result.rejected_plans.find(
      (plan) => plan.plan_id === "plan_synthetic_direct_card",
    );
    expect(rejection?.rejection_reasons).toEqual([
      { code: "engine_evaluation_failed", message: "engine_evaluation_failed" },
    ]);
    expect(JSON.stringify(result)).not.toContain("contract validation");
  });

  it("keeps candidate partition complete and disjoint when no plan is valid", () => {
    const direct = makeDirectPurchasePlan(641);
    const topup = makeTopupPurchasePlan(1_000, 641);
    const result = recommend(request({ candidate_plans: [direct, topup] }));
    const eligibleIds = result.eligible_plans.map((plan) => plan.plan_id);
    const rejectedIds = result.rejected_plans.map((plan) => plan.plan_id);
    expect(result.outcome).toBe("no_valid_plan");
    expect(result.winner_plan_id).toBeNull();
    expect(result.safe_plan_id).toBeNull();
    expect(result.runner_up_plan_id).toBeNull();
    expect(new Set([...eligibleIds, ...rejectedIds]).size).toBe(2);
    expect(eligibleIds.filter((id) => rejectedIds.includes(id))).toHaveLength(
      0,
    );
    expect(result.plans.map((plan) => plan.plan_id).sort()).toEqual(
      [direct.plan_id, topup.plan_id].sort(),
    );
  });
});
