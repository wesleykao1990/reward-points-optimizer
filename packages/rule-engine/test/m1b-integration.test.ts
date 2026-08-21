import { describe, expect, it } from "vitest";
import {
  externalFundingAsset,
  makeDirectPurchasePlan,
  makeEngineContext,
  makeOpeningWalletLot,
  makePercentageRule,
  makePointsPerUnitRule,
  makeRewardRule,
  makeUserState,
  normalPointAsset,
} from "../../test-fixtures/src/index.ts";
import {
  type AssetRef,
  evaluateCandidates,
  evaluateNativePlan,
  type PurchasePlan,
  type RewardRule,
  type StateValue,
} from "../src/index.js";

function fixedRule(rewardUnits = "3"): RewardRule {
  const rule = makeRewardRule({
    ruleId: "rr_m1b_fixed",
    operationTypes: ["merchant_purchase"],
    calculation: {
      model: "fixed",
      reward_units: rewardUnits,
      rounding: {
        aggregation_scope: "per_operation",
        reward_rounding_mode: "exact",
      },
    },
  });
  rule.eligibility.transaction_conditions.minimum_amount_jpy = 1_000;
  return rule;
}

function knownFact(value: unknown): StateValue {
  return {
    status: "known",
    value,
    observed_at: "2026-08-17T00:00:00+09:00",
    source: "user_input",
  };
}

describe("Milestone 1B integrated engine adapters", () => {
  it("applies a fixed reward only at and above its threshold", () => {
    for (const [amount, expected] of [
      [999, 0],
      [1_000, 1],
      [1_001, 1],
    ] as const) {
      const result = evaluateNativePlan(
        makeDirectPurchasePlan(amount),
        makeEngineContext("1", { rules: [fixedRule()] }),
      );
      expect(result.reward_components).toHaveLength(expected);
      if (expected === 1)
        expect(result.reward_components[0]?.quantity.amount).toBe("3");
    }
  });

  it("adapts every tier basis through explicit transaction or user state", () => {
    for (const [source, key, period, value] of [
      ["transaction_amount", "amount", null, undefined],
      ["user_fact", "membership", null, "gold"],
      ["period_aggregate", "prior_spend", "previous_month", 20_000],
      ["event_counter", "visits", "current_month", 4],
    ] as const) {
      const rule = makeRewardRule({
        ruleId: `rr_m1b_tier_${source}`,
        operationTypes: ["merchant_purchase"],
        calculation: {
          model: "tiered",
          tier_basis: { source, key, period },
          tiers: [
            {
              operator: source === "user_fact" ? "eq" : "gte",
              value: source === "user_fact" ? "gold" : 4,
              award: { model: "fixed", reward_units: "7" },
            },
          ],
          rounding: {
            aggregation_scope: "per_operation",
            reward_rounding_mode: "exact",
          },
        },
      });
      const userState = makeUserState("1");
      if (value !== undefined) userState.facts[key] = knownFact(value);
      const result = evaluateNativePlan(
        makeDirectPurchasePlan(1_000),
        makeEngineContext("1", {
          rules: [rule],
          ...(value === undefined ? {} : { user_state: userState }),
        }),
      );
      expect(result.reward_components[0]?.quantity.amount).toBe("7");
    }
  });

  it("caps a reward to the known remainder", () => {
    const rule = fixedRule("20");
    rule.caps = [
      {
        cap_id: "cap_m1b_daily",
        cap_type: "per_day",
        max_reward_units: "100",
        max_eligible_spend_jpy: null,
        shared_cap_group: null,
        progress_source: "user_input",
        reset: {
          period: "day",
          timezone: "Asia/Tokyo",
          boundary: "calendar",
        },
        partial_consumption: true,
        unknown_progress_policy: "return_range",
      },
    ];
    const userState = makeUserState("1");
    userState.cap_progress.cap_m1b_daily = {
      status: "known",
      eligible_spend_jpy_min: 0,
      eligible_spend_jpy_max: 0,
      reward_earned_units_min: "90",
      reward_earned_units_max: "90",
      period_start: "2026-08-16T15:00:00Z",
      period_end: "2026-08-17T15:00:00Z",
      observed_at: "2026-08-17T00:00:00Z",
      source: "user_input",
    };
    const result = evaluateNativePlan(
      makeDirectPurchasePlan(1_000),
      makeEngineContext("1", { rules: [rule], user_state: userState }),
    );
    expect(result.reward_components[0]?.quantity.amount).toBe("10");
    expect(result.reward_components[0]?.calculation_trace.cap_state).toBe(
      "partial",
    );
  });

  it("reserves one shared cap across concurrent additive rules", () => {
    const first = fixedRule("70");
    first.rule_id = "rr_m1b_shared_first";
    const second = fixedRule("70");
    second.rule_id = "rr_m1b_shared_second";
    for (const [index, rule] of [first, second].entries()) {
      rule.caps = [
        {
          cap_id: `cap_m1b_shared_${index + 1}`,
          cap_type: "per_day",
          max_reward_units: "100",
          max_eligible_spend_jpy: null,
          shared_cap_group: "cap_group_m1b_shared",
          progress_source: "user_input",
          reset: {
            period: "day",
            timezone: "Asia/Tokyo",
            boundary: "calendar",
          },
          partial_consumption: true,
          unknown_progress_policy: "return_range",
        },
      ];
    }
    const userState = makeUserState("1");
    userState.cap_progress.cap_group_m1b_shared = {
      status: "known",
      eligible_spend_jpy_min: 0,
      eligible_spend_jpy_max: 0,
      reward_earned_units_min: "0",
      reward_earned_units_max: "0",
      period_start: "2026-08-16T15:00:00Z",
      period_end: "2026-08-17T15:00:00Z",
      observed_at: "2026-08-17T00:00:00Z",
      source: "user_input",
    };
    const result = evaluateNativePlan(
      makeDirectPurchasePlan(1_000),
      makeEngineContext("1", {
        rules: [first, second],
        user_state: userState,
      }),
    );
    expect(result.eligible).toBe(true);
    expect(
      result.reward_components.reduce(
        (sum, component) => sum + Number(component.quantity.amount),
        0,
      ),
    ).toBe(100);
    expect(
      result.reward_components.map((item) => item.quantity.amount),
    ).toEqual(["70", "30"]);
  });

  it("does not double a base reward included by a stacked award", () => {
    const base = makePercentageRule("rr_m1b_base", ["merchant_purchase"], 100);
    base.stacking.stack_group = "m1b_earn";
    const included = makePointsPerUnitRule("rr_m1b_included", 1_000, "15");
    included.stacking = {
      ...included.stacking,
      stack_group: "m1b_earn",
      mode: "includes_base",
      precedence: 1,
    };
    if (included.calculation?.model === "points_per_unit")
      included.calculation.base_reward_included = true;
    const result = evaluateNativePlan(
      makeDirectPurchasePlan(1_000),
      makeEngineContext("1", { rules: [base, included] }),
    );
    expect(
      result.reward_components.map((item) => item.quantity.amount),
    ).toEqual(["15"]);
    expect(result.applied_rule_ids).toContain("rr_m1b_included");
    expect(result.rejected_rule_ids).toContain("rr_m1b_base");
  });

  it("returns conditional winners from explicit compatible feasible states", () => {
    const first = { ...makeDirectPurchasePlan(640), plan_id: "plan_a" };
    const second = { ...makeDirectPurchasePlan(640), plan_id: "plan_b" };
    const result = evaluateCandidates([first, second], {
      ...makeEngineContext("1", { rules: [] }),
      feasibleStates: [
        {
          state_id: "not_enrolled",
          assignments: { campaign_enrollment: false },
          unknown_keys: ["campaign_enrollment"],
          questions: {
            campaign_enrollment: "Are you enrolled in the campaign?",
          },
          plans: {
            plan_a: { value: "10" },
            plan_b: { value: "20" },
          },
        },
        {
          state_id: "enrolled",
          assignments: { campaign_enrollment: true },
          unknown_keys: ["campaign_enrollment"],
          plans: {
            plan_a: { value: "30" },
            plan_b: { value: "20" },
          },
        },
      ],
    });
    expect(result.outcome_mode).toBe("conditional");
    expect(result.winner).toBeNull();
    expect(result.definite_winner_plan_id).toBeNull();
    expect(result.conditional_winners?.map((item) => item.plan_id)).toEqual([
      "plan_a",
      "plan_b",
    ]);
    expect(result.questions_to_resolve).toContainEqual({
      fact_key: "campaign_enrollment",
      question: "Are you enrolled in the campaign?",
      could_change_winner: true,
    });
  });

  it("keeps the concrete winner consistent with a definite feasible-state winner", () => {
    const first = { ...makeDirectPurchasePlan(640), plan_id: "plan_a" };
    const second = { ...makeDirectPurchasePlan(640), plan_id: "plan_b" };
    const result = evaluateCandidates([first, second], {
      ...makeEngineContext("1", { rules: [] }),
      feasibleStates: [
        {
          state_id: "sole_state",
          assignments: {},
          unknown_keys: [],
          plans: {
            plan_a: { value: "10" },
            plan_b: { value: "20" },
          },
        },
      ],
    });
    expect(result.outcome_mode).toBe("definite");
    expect(result.definite_winner_plan_id).toBe("plan_b");
    expect(result.winner?.plan_id).toBe("plan_b");
  });

  it("derives a conditional recommendation from unknown enrollment", () => {
    const conditional = fixedRule("10");
    conditional.rule_id = "rr_m1b_enrollment_bonus";
    conditional.eligibility.user_conditions = [
      {
        fact_key: "campaign_enrollment",
        operator: "eq",
        value: true,
        unknown_policy: "return_conditional",
      },
    ];
    const fallback = fixedRule("5");
    fallback.rule_id = "rr_m1b_fallback";
    fallback.scope.merchant_ids = ["merchant.fallback"];
    const first = { ...makeDirectPurchasePlan(1_000), plan_id: "plan_a" };
    const second = structuredClone(makeDirectPurchasePlan(1_000));
    second.plan_id = "plan_b";
    const fallbackOperation = second.operations[0];
    if (!fallbackOperation) throw new Error("fallback operation missing");
    fallbackOperation.merchant_id = "merchant.fallback";
    const userState = makeUserState("1");
    userState.facts.campaign_enrollment = {
      status: "unknown",
      source: "unknown",
      confidence: null,
    };
    const result = evaluateCandidates([first, second], {
      ...makeEngineContext("1", {
        rules: [conditional, fallback],
        user_state: userState,
      }),
    });
    expect(result.outcome_mode).toBe("conditional");
    expect(result.definite_winner_plan_id).toBeNull();
    expect(result.conditional_winners?.map((item) => item.plan_id)).toEqual([
      "plan_a",
      "plan_b",
    ]);
    expect(result.questions_to_resolve).toContainEqual({
      fact_key: "campaign_enrollment",
      question: "What is the current value of campaign_enrollment?",
      could_change_winner: true,
    });
  });

  it("does not admit historical probability under the official-only policy", () => {
    const rule = makePercentageRule(
      "rr_m1b_probability",
      ["merchant_purchase"],
      1_000,
    );
    if (!rule.output) throw new Error("fixture output missing");
    rule.output.certainty = {
      type: "probabilistic",
      probability: "0.5",
      probability_source: "historical_estimate",
    };
    const officialOnly = evaluateCandidates([makeDirectPurchasePlan(1_000)], {
      ...makeEngineContext("1", { rules: [rule] }),
      objective: {
        primary: "maximize_expected_net_value",
        probabilistic_reward_policy: "expected_if_official_probability",
      },
    });
    const historicalAllowed = evaluateCandidates(
      [makeDirectPurchasePlan(1_000)],
      {
        ...makeEngineContext("1", { rules: [rule] }),
        objective: {
          primary: "maximize_expected_net_value",
          probabilistic_reward_policy: "include_user_estimate",
        },
      },
    );
    expect(
      officialOnly.winner?.economics.probabilistic_expected_reward_value_jpy
        .expected_jpy,
    ).toBe("0");
    expect(
      historicalAllowed.winner?.economics
        .probabilistic_expected_reward_value_jpy.expected_jpy,
    ).toBe("50");
  });

  it("evaluates a directed transfer with an explicit conserved fee", () => {
    const sourceAsset: AssetRef = {
      ...normalPointAsset,
      asset_id: "point.transfer.source",
    };
    const destinationAsset: AssetRef = {
      ...normalPointAsset,
      asset_id: "point.transfer.destination",
    };
    const feeAsset: AssetRef = {
      ...normalPointAsset,
      asset_id: "point.transfer.fee",
    };
    const rule = makeRewardRule({
      ruleId: "rr_m1b_transfer",
      operationTypes: ["point_transfer"],
      channel: "transfer",
      ruleType: "transfer",
      calculation: {
        model: "transfer_ratio",
        source_asset: sourceAsset,
        destination_asset: destinationAsset,
        source_units: "1",
        destination_units: "2",
        minimum_source_units: "100",
        increment_source_units: "10",
        maximum_source_units_per_request: "500",
        maximum_source_units_per_period: null,
        maximum_period: null,
        fee: { asset: feeAsset, amount: "3" },
        rounding: {
          aggregation_scope: "transfer_request",
          reward_rounding_mode: "exact",
        },
        processing_time_days_min: 1,
        processing_time_days_max: 3,
        cancellation_policy: "cancelable_before_posting",
      },
    });
    rule.scope.merchant_ids = [];
    delete rule.output;
    const opening = {
      ...makeOpeningWalletLot(100),
      lot_id: "lot_transfer_source",
      quantity: { asset: sourceAsset, amount: "100" },
    };
    const feeOpening = {
      ...makeOpeningWalletLot(3),
      lot_id: "lot_transfer_fee",
      quantity: { asset: feeAsset, amount: "3" },
    };
    const plan: PurchasePlan = {
      plan_id: "plan_m1b_transfer",
      operations: [
        {
          operation_id: "op_m1b_transfer",
          sequence: 1,
          occurred_at: "2026-08-17T12:00:00+09:00",
          operation_type: "point_transfer",
          merchant_id: null,
          merchant_location_id: null,
          channel: "transfer",
          interface: "manual_transfer",
          payment_instrument_id: null,
          funding_source_id: null,
          amount_jpy: null,
          asset_inputs: [
            {
              input_id: "in_m1b_transfer_source",
              source_lot_id: opening.lot_id,
              quantity: { asset: sourceAsset, amount: "100" },
              role: "transfer_source",
            },
            {
              input_id: "in_m1b_transfer_fee",
              source_lot_id: feeOpening.lot_id,
              quantity: { asset: feeAsset, amount: "3" },
              role: "fee",
            },
          ],
          output_requests: [
            {
              request_id: "out_m1b_transfer_destination",
              created_lot_id: "lot_transfer_destination",
              asset: destinationAsset,
              requested_amount: "200",
              role: "transfer_destination",
            },
          ],
          original_operation_id: null,
          portal_id: null,
          line_items: [],
          notes: "Synthetic transfer.",
        },
      ],
      dependencies: [],
      loyalty_presentments: [],
      assumptions: [],
    };
    const result = evaluateNativePlan(
      plan,
      makeEngineContext("1", {
        rules: [rule],
        opening_asset_lots: [opening, feeOpening],
      }),
    );
    expect(result.eligible).toBe(true);
    expect(result.ending_asset_lots).toHaveLength(1);
    expect(result.ending_asset_lots[0]?.quantity).toEqual({
      asset: destinationAsset,
      amount: "200",
    });
    expect(result.asset_movements.map((item) => item.movement_role)).toEqual([
      "transfer",
      "fee",
      "transfer",
    ]);
  });

  it("returns refund principal and emits a proportional reward clawback", () => {
    const plan = makeDirectPurchasePlan(1_000);
    plan.plan_id = "plan_m1b_refund";
    plan.operations.push({
      operation_id: "op_m1b_refund",
      sequence: 2,
      occurred_at: "2026-08-17T13:00:00+09:00",
      operation_type: "refund",
      merchant_id: "merchant.synthetic",
      merchant_location_id: null,
      channel: "in_store",
      interface: "physical_card",
      payment_instrument_id: "instrument.synthetic.card",
      funding_source_id: "instrument.synthetic.card",
      amount_jpy: 250,
      asset_inputs: [],
      output_requests: [
        {
          request_id: "out_m1b_refund",
          created_lot_id: "lot_m1b_refund",
          asset: externalFundingAsset,
          requested_amount: "250",
          role: "refund",
        },
      ],
      original_operation_id: "op_synthetic_direct",
      portal_id: null,
      line_items: [],
      notes: "Synthetic partial refund.",
    });
    plan.dependencies.push({
      from_operation_id: "op_synthetic_direct",
      to_operation_id: "op_m1b_refund",
      dependency_type: "attribution",
    });
    const rule = fixedRule("100");
    if (!rule.output) throw new Error("fixture output missing");
    rule.output.clawback.on_refund = "proportional";
    const result = evaluateNativePlan(
      plan,
      makeEngineContext("1", { rules: [rule] }),
    );
    expect(result.eligible).toBe(true);
    expect(result.merchant_value_jpy).toBe(750n);
    expect(result.ending_asset_lots[0]?.quantity.amount).toBe("250");
    expect(
      result.reward_components.map((item) => [item.sign, item.quantity.amount]),
    ).toEqual([
      ["credit", "100"],
      ["debit", "25"],
    ]);

    const assetSubstitution = structuredClone(plan);
    assetSubstitution.plan_id = "plan_m1b_refund_asset_substitution";
    const substitutedOutput =
      assetSubstitution.operations[1]?.output_requests[0];
    if (!substitutedOutput) throw new Error("refund output missing");
    substitutedOutput.asset = normalPointAsset;
    expect(() =>
      evaluateNativePlan(
        assetSubstitution,
        makeEngineContext("1", { rules: [rule] }),
      ),
    ).toThrow(/lifecycle_return_asset_mismatch/);
  });
});
