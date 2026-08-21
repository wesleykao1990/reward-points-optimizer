import type { RecommendationResponse } from "@jro/recommendation-api";
import { describe, expect, it } from "vitest";
import { buildPresentation, PresentationError } from "../src/presentation.js";

type JsonRecord = Record<string, unknown>;

const economics = {
  merchant_value_received_jpy: {
    minimum_jpy: "640",
    maximum_jpy: "640",
    expected_jpy: "640",
  },
  external_funding_jpy: {
    minimum_jpy: "640",
    maximum_jpy: "640",
    expected_jpy: "640",
  },
  ending_asset_value_jpy: {
    minimum_jpy: "4",
    maximum_jpy: "4",
    expected_jpy: "4",
  },
  guaranteed_net_value_change_jpy: {
    minimum_jpy: "4",
    maximum_jpy: "4",
    expected_jpy: "4",
  },
};

function quantity(amount = "4") {
  return {
    asset: {
      asset_id: "point.synthetic",
      asset_kind: "reward_point",
      program_id: "synthetic",
      reward_class: "normal",
      scale: 1,
    },
    amount,
  };
}

function plan(planId: string, score: string): JsonRecord {
  return {
    plan_id: planId,
    eligible: true,
    operations: [
      {
        operation_id: `${planId}:purchase`,
        sequence: 1,
        occurred_at: "2026-08-19T12:00:00+09:00",
        operation_type: "merchant_purchase",
        merchant_id: "merchant.synthetic",
        merchant_location_id: "branch.tokyo",
        channel: "in_store",
        interface: "physical_card",
        amount_jpy: 640,
        notes: "<script>do-not-render</script>",
        canonical_input: "do-not-expose",
      },
      {
        operation_id: `${planId}:topup`,
        sequence: 0,
        occurred_at: "2026-08-19T11:59:00+09:00",
        operation_type: "stored_value_top_up",
        merchant_id: null,
        merchant_location_id: null,
        channel: "in_app",
        interface: "wallet_app",
        amount_jpy: 640,
      },
    ],
    asset_movements: [
      {
        movement_id: `${planId}:movement`,
        operation_id: `${planId}:topup`,
        direction: "create",
        movement_role: "principal_output",
        quantity: {
          ...quantity("640"),
          asset: {
            ...quantity("640").asset,
            asset_id: "stored.synthetic",
            reward_class: null,
          },
        },
        source_lot_id: null,
        destination_lot_id: `${planId}:lot`,
        notes: "not a UI instruction",
      },
    ],
    rewards: [],
    reward_components: [
      {
        component_id: `${planId}:reward`,
        operation_id: `${planId}:purchase`,
        rule_id: "rule.synthetic",
        sign: "credit",
        quantity: quantity(),
        value_jpy: { minimum_jpy: "4", maximum_jpy: "4", expected_jpy: "4" },
        certainty: {
          type: "guaranteed",
          probability: null,
          probability_source: null,
        },
        canonical_output: "do-not-expose",
      },
    ],
    ending_asset_lots: [
      {
        lot_id: `${planId}:lot`,
        quantity: quantity("640"),
        acquired_at: "2026-08-19T11:59:00+09:00",
        source_operation_id: `${planId}:topup`,
        settlement: { status: "posted" },
        expiry: { policy: "none", expires_at: null },
      },
    ],
    ending_assets: [],
    economics,
    objective_score_jpy: score,
    applied_rule_ids: ["rule.synthetic"],
    rejected_rule_ids: [],
    rejection_reasons: [],
    native_snapshot_hash: `sha256:native-${planId}`,
  };
}

function response(overrides: JsonRecord = {}): RecommendationResponse {
  const primary = plan("plan.primary", "8");
  const fallback = plan("plan.fallback", "6");
  return {
    version: "1",
    request_id: "req.presentation",
    mode: "synthetic_internal",
    verification_status: "synthetic_only",
    outcome: "definite",
    winner_plan_id: "plan.primary",
    safe_plan_id: "plan.primary",
    runner_up_plan_id: "plan.fallback",
    winner: primary,
    safe_plan: primary,
    runner_up: fallback,
    conditional_winners: [],
    eligible_plans: [primary, fallback],
    rejected_plans: [],
    plans: [primary, fallback],
    merchant: {
      merchant_id: "merchant.synthetic",
      merchant_name: "Synthetic Store",
      merchant_alias: null,
      branch_id: "branch.tokyo",
      branch_name: "Tokyo branch",
      branch_alias: null,
    },
    comparison: {
      merchant_id: "merchant.synthetic",
      merchant_location_id: "branch.tokyo",
      amount_jpy: 640,
      channel: "in_store",
      interface: "physical_card",
      line_items: [],
    },
    assumptions: ["<b>plain text only</b>", "assume synthetic"],
    questions: ["<img src=x onerror=alert(1)>", "Which wallet is owned?"],
    freshness: {
      checked_at: "2026-08-19T00:00:00Z",
      source_ids: ["source.synthetic"],
      rule_valid_from: { "rule.synthetic": "2026-01-01T00:00:00Z" },
      rule_valid_to: { "rule.synthetic": null },
      notes: ["fixture only"],
    },
    evidence_refs: [
      {
        evidence_id: "ev.synthetic",
        source_id: "source.synthetic",
        locator: "https://example.invalid/raw-evidence",
        content_hash: "sha256:evidence",
      },
    ],
    valuation_sensitivities: [
      {
        asset_id: "point.synthetic",
        reward_class: "normal",
        current_jpy_per_unit: "1",
        break_even_jpy_per_unit: "0.5",
        winner_at_or_below_threshold_plan_id: "plan.fallback",
        winner_above_threshold_plan_id: "plan.primary",
      },
    ],
    trust_assessments: [],
    blockers: [],
    replay: {
      contract_version: "1",
      input_hash: "sha256:input",
      output_hash: "sha256:response",
    },
    canonical_input: "do-not-expose",
    raw_rule: { secret: "do-not-expose" },
    ...overrides,
  } as unknown as RecommendationResponse;
}

describe("M6 presentation mapping", () => {
  it("shows one primary and one disjoint fallback with explicit route data", () => {
    const result = buildPresentation(response());
    expect(result.state).toBe("definite");
    expect(result.labels).toEqual(["synthetic_only", "not_current_advice"]);
    expect(result.primary?.plan_id).toBe("plan.primary");
    expect(result.fallback?.plan_id).toBe("plan.fallback");
    expect(result.primary?.steps.map((step) => step.operation_id)).toEqual([
      "plan.primary:topup",
      "plan.primary:topup",
      "plan.primary:purchase",
      "plan.primary:purchase",
    ]);
    expect(result.primary?.rewards[0]?.asset_id).toBe("point.synthetic");
    expect(result.primary?.ending_assets[0]?.units).toBe("640");
    expect(
      result.primary?.economics?.ending_asset_value_jpy?.expected_jpy,
    ).toBe("4");
    expect(result.merchant?.branch_id).toBe("branch.tokyo");
    expect(result.amount_jpy).toBe(640);
    expect(result.response_hash).toBe("sha256:response");
    expect(result.sensitivities[0]?.winner_above_threshold_plan_id).toBe(
      "plan.primary",
    );
    expect(result.primary?.native_snapshot_hash).toBe(
      "sha256:native-plan.primary",
    );
  });

  it("uses the safe route and names conditional alternatives", () => {
    const safe = plan("plan.safe", "4");
    const conditional = plan("plan.conditional", "9");
    const result = buildPresentation(
      response({
        outcome: "conditional",
        winner_plan_id: null,
        winner: null,
        safe_plan_id: "plan.safe",
        safe_plan: safe,
        runner_up_plan_id: null,
        runner_up: null,
        eligible_plans: [conditional, safe],
        plans: [conditional, safe],
        conditional_winners: [
          {
            plan_id: "plan.conditional",
            conditions: ["campaign entry is confirmed"],
            value_range_jpy: {
              minimum_jpy: "8",
              maximum_jpy: "10",
              expected_jpy: null,
            },
          },
        ],
      }),
    );
    expect(result.state).toBe("conditional");
    expect(result.primary?.role).toBe("safe");
    expect(result.primary?.plan_id).toBe("plan.safe");
    expect(result.fallback).toBeNull();
    expect(result.conditional_alternatives).toHaveLength(1);
    expect(result.conditional_alternatives[0]?.conditions).toEqual([
      "campaign entry is confirmed",
    ]);
  });

  it("never exposes routes or reward claims for blocked and no-valid responses", () => {
    for (const outcome of ["blocked", "no_valid_plan"] as const) {
      const result = buildPresentation(
        response({
          outcome,
          mode: outcome === "blocked" ? "production" : "synthetic_internal",
          winner_plan_id: null,
          safe_plan_id: null,
          runner_up_plan_id: null,
          winner: null,
          safe_plan: null,
          runner_up: null,
          conditional_winners: [],
          eligible_plans: [],
          plans: [],
          blockers:
            outcome === "blocked"
              ? ["production_authorization_unavailable"]
              : [],
        }),
      );
      expect(result.state).toBe(outcome);
      expect(result.primary).toBeNull();
      expect(result.fallback).toBeNull();
      expect(result.conditional_alternatives).toEqual([]);
    }
    const productionWithRouteEnvelope = buildPresentation(
      response({ mode: "production" }),
    );
    expect(productionWithRouteEnvelope.state).toBe("blocked");
    expect(productionWithRouteEnvelope.primary).toBeNull();
    expect(productionWithRouteEnvelope.fallback).toBeNull();

    const deniedWithRouteEnvelope = buildPresentation(
      response({ verification_status: "blocked" }),
    );
    expect(deniedWithRouteEnvelope.state).toBe("blocked");
    expect(deniedWithRouteEnvelope.labels).toEqual(["blocked"]);
    expect(deniedWithRouteEnvelope.primary).toBeNull();
    expect(deniedWithRouteEnvelope.fallback).toBeNull();
    expect(deniedWithRouteEnvelope.conditional_alternatives).toEqual([]);
    expect(deniedWithRouteEnvelope.sensitivities).toEqual([]);

    for (const mode of ["production ", "PRODUCTION", "untrusted"]) {
      const unknownMode = buildPresentation(response({ mode }));
      expect(unknownMode.state).toBe("blocked");
      expect(unknownMode.primary).toBeNull();
      expect(unknownMode.fallback).toBeNull();
      expect(unknownMode.conditional_alternatives).toEqual([]);
      expect(unknownMode.sensitivities).toEqual([]);
    }
  });

  it("keeps text as inert strings and excludes raw rules, evidence, and replay bodies", () => {
    const result = buildPresentation(response());
    expect(result.assumptions[0]).toBe("<b>plain text only</b>");
    expect(typeof result.assumptions[0]).toBe("string");
    expect(JSON.stringify(result)).not.toContain("canonical_input");
    expect(JSON.stringify(result)).not.toContain("raw_rule");
    expect(JSON.stringify(result)).not.toContain("raw-evidence");
    expect(JSON.stringify(result)).not.toContain("do-not-expose");
    expect("html" in result).toBe(false);
  });

  it("rejects verified results and invalid or missing plan references", () => {
    expect(() =>
      buildPresentation(response({ verification_status: "verified" })),
    ).toThrow(PresentationError);
    expect(() =>
      buildPresentation(
        response({ winner_plan_id: "missing", winner: plan("missing", "9") }),
      ),
    ).toThrow(/winner_not_eligible/);
    expect(() =>
      buildPresentation(
        response({
          outcome: "conditional",
          winner_plan_id: null,
          winner: null,
          safe_plan_id: null,
          safe_plan: null,
          conditional_winners: [],
        }),
      ),
    ).toThrow(/conditional_safe_plan_missing/);
  });

  it("is reorder-deterministic, frozen, JSON-safe, and preserves native sensitivity association", () => {
    const first = buildPresentation(response());
    const second = buildPresentation(
      response({
        eligible_plans: [plan("plan.fallback", "6"), plan("plan.primary", "8")],
        plans: [plan("plan.fallback", "6"), plan("plan.primary", "8")],
        evidence_refs: [...(response().evidence_refs ?? [])].reverse(),
        assumptions: ["assume synthetic", "<b>plain text only</b>"],
      }),
    );
    expect(second.presentation_hash).toBe(first.presentation_hash);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.primary)).toBe(true);
    expect(() => JSON.stringify(first)).not.toThrow();
    expect(JSON.stringify(first)).not.toContain("canonical_output");
  });
});
