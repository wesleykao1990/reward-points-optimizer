import { describe, expect, it } from "vitest";
import {
  limitedPointAsset,
  makeBitemporalRuleVersions,
  makeDirectPurchasePlan,
  makeEngineContext,
  makeOpeningWalletLot,
  makePercentageRule,
  makePointsPerUnitRule,
  makeRewardExclusionRule,
  makeTenThousandFundingPlan,
  makeTopupPurchasePlan,
  makeTopupRewardRule,
  makeUserState,
  makeValuationFlipFixture,
  normalPointAsset,
  walletAsset,
} from "../../test-fixtures/src/index.ts";
import { selectApprovedRule } from "../src/bitemporal.js";
import {
  calculateBreakEvenResidualValue,
  evaluateCandidates,
  evaluateNativePlan,
  replayByteStable,
  serializeReplay,
  validateConservation,
  validatePurchasePlan,
  validateUserState,
} from "../src/index.js";

describe("Milestone 1a native ledger", () => {
  it("reconciles a direct purchase", () => {
    const plan = evaluateNativePlan(
      makeDirectPurchasePlan(),
      makeEngineContext(),
    );
    expect(plan.eligible).toBe(true);
    expect(plan.external_funding_jpy).toBe(640n);
    expect(plan.merchant_value_jpy).toBe(640n);
    expect(plan.ending_asset_lots).toHaveLength(0);
    expect(plan.asset_movements).toHaveLength(1);
  });

  it("creates, partially consumes, and preserves a top-up residual", () => {
    const plan = evaluateNativePlan(
      makeTopupPurchasePlan(1_000, 640),
      makeEngineContext(),
    );
    expect(plan.eligible).toBe(true);
    expect(plan.external_funding_jpy).toBe(1_000n);
    expect(plan.ending_asset_lots[0]?.quantity.amount).toBe("360");
    validateConservation([], plan.asset_movements, plan.ending_asset_lots);
  });

  it("keeps the exact residual when JPY 10,000 funds a smaller purchase", () => {
    const plan = evaluateNativePlan(
      makeTenThousandFundingPlan(640),
      makeEngineContext(),
    );
    expect(plan.ending_asset_lots.map((lot) => lot.quantity.amount)).toEqual([
      "9360",
    ]);
    expect(plan.external_funding_jpy).toBe(10_000n);
  });

  it("attaches the top-up reward only to acquisition", () => {
    const plan = evaluateNativePlan(
      makeTopupPurchasePlan(1_000, 640),
      makeEngineContext("1", { rules: [makeTopupRewardRule()] }),
    );
    const rewards = plan.reward_components.filter(
      (reward) => reward.rule_id === "rr_synthetic_topup",
    );
    expect(rewards).toHaveLength(1);
    expect(rewards[0]?.operation_id).toBe("op_synthetic_topup");
  });

  it("uses explicit tax-exclusive line spend and fails closed when it is absent", () => {
    const rule = makePointsPerUnitRule("rr_tax_exclusive", 200, "1");
    rule.scope.tax_basis = "tax_exclusive";
    rule.eligibility.transaction_conditions.eligible_amount_basis =
      "eligible_line_items";
    const plan = makeDirectPurchasePlan(220);
    const line = plan.operations[0]?.line_items[0];
    if (!line) throw new Error("purchase line missing");
    line.tax_exclusive_amount_jpy = 200;

    const result = evaluateNativePlan(
      plan,
      makeEngineContext("1", { rules: [rule] }),
    );
    expect(result.reward_components).toHaveLength(1);
    expect(result.reward_components[0]?.quantity.amount).toBe("1");
    expect(result.reward_components[0]?.calculation_trace.spend_jpy).toBe(
      "200",
    );

    const missing = makeDirectPurchasePlan(220);
    const missingResult = evaluateNativePlan(
      missing,
      makeEngineContext("1", { rules: [rule] }),
    );
    expect(missingResult.reward_components).toHaveLength(0);
    expect(missingResult.rejection_reasons).toContainEqual(
      expect.objectContaining({
        rule_id: "rr_tax_exclusive",
        message: "tax_exclusive_amount_required",
      }),
    );
  });

  it("keeps limited-period and normal classes separate", () => {
    const normal = makePercentageRule(
      "rr_normal",
      ["merchant_purchase"],
      100,
      normalPointAsset,
    );
    const limited = makePercentageRule(
      "rr_limited",
      ["merchant_purchase"],
      100,
      limitedPointAsset,
    );
    const result = evaluateNativePlan(
      makeDirectPurchasePlan(),
      makeEngineContext("1", { rules: [normal, limited] }),
    );
    expect(
      result.reward_components
        .map((reward) => reward.quantity.asset.reward_class)
        .sort(),
    ).toEqual(["limited_period", "normal"]);
  });

  it("rejects under- and over-funded merchant tenders", () => {
    const under = makeDirectPurchasePlan(640);
    under.operations[0]!.asset_inputs[0]!.quantity.amount = "1";
    const over = makeDirectPurchasePlan(640);
    over.operations[0]!.asset_inputs[0]!.quantity.amount = "641";
    expect(
      evaluateNativePlan(
        under,
        makeEngineContext("1", { rules: [] }),
      ).rejection_reasons.some(
        (reason) => reason.code === "tender_amount_mismatch",
      ),
    ).toBe(true);
    expect(
      evaluateNativePlan(
        over,
        makeEngineContext("1", { rules: [] }),
      ).rejection_reasons.some(
        (reason) => reason.code === "tender_amount_mismatch",
      ),
    ).toBe(true);

    const reusable = makeDirectPurchasePlan(640);
    reusable.operations[0]!.asset_inputs[0] = {
      input_id: "in_opening_wallet",
      source_lot_id: "lot_opening_wallet",
      quantity: { asset: walletAsset, amount: "1" },
      role: "stored_value_tender",
    };
    const reusableResult = evaluateNativePlan(
      reusable,
      makeEngineContext("1", {
        rules: [],
        opening_asset_lots: [makeOpeningWalletLot("640")],
      }),
    );
    expect(
      reusableResult.rejection_reasons.some(
        (reason) => reason.code === "tender_amount_mismatch",
      ),
    ).toBe(true);
  });

  it("suppresses a reward targeted by a reward_earning exclusion", () => {
    const reward = makePercentageRule(
      "rr_excluded_reward",
      ["merchant_purchase"],
      100,
      normalPointAsset,
    );
    const exclusion = makeRewardExclusionRule(reward.rule_id);
    const result = evaluateNativePlan(
      makeDirectPurchasePlan(640),
      makeEngineContext("1", { rules: [reward, exclusion] }),
    );
    expect(result.reward_components).toHaveLength(0);
    expect(
      result.rejection_reasons.some(
        (reason) =>
          reason.rule_id === reward.rule_id && reason.code === "rule_excluded",
      ),
    ).toBe(true);
  });

  it("rejects non-per-operation aggregation before emitting a reward", () => {
    const rule = makePercentageRule(
      "rr_unsupported_scope",
      ["merchant_purchase"],
      100,
      normalPointAsset,
    );
    rule.calculation = {
      model: "percentage",
      rate_basis_points: 100,
      rounding: {
        aggregation_scope: "per_line_item",
        reward_rounding_mode: "floor",
      },
    };
    const result = evaluateNativePlan(
      makeDirectPurchasePlan(640),
      makeEngineContext("1", { rules: [rule] }),
    );
    expect(result.reward_components).toHaveLength(0);
    expect(
      result.rejection_reasons.some(
        (reason) => reason.code === "unsupported_aggregation_scope",
      ),
    ).toBe(true);
  });

  it("cannot bypass the shared contracts validator for public evaluation", () => {
    const invalidRule = structuredClone(
      makePercentageRule("rr_invalid_contract"),
    ) as unknown as Record<string, unknown>;
    delete (invalidRule.scope as Record<string, unknown>).channels;
    expect(() =>
      evaluateNativePlan(
        makeDirectPurchasePlan(),
        makeEngineContext("1", { rules: [invalidRule as never] }),
      ),
    ).toThrow(/contract validation failed/);

    const invalidState = makeUserState();
    invalidState.facts = {
      estimated: {
        status: "estimated",
        lower_bound: 2,
        upper_bound: 1,
        confidence: "0.9",
        observed_at: "2026-08-17T00:00:00Z",
        source: "user_input",
      },
    };
    expect(() =>
      evaluateNativePlan(
        makeDirectPurchasePlan(),
        makeEngineContext("1", { rules: [], user_state: invalidState }),
      ),
    ).toThrow(/contract validation failed/);

    const invalidPlan = structuredClone(
      makeDirectPurchasePlan(),
    ) as unknown as Record<string, unknown>;
    delete invalidPlan.dependencies;
    expect(() =>
      evaluateNativePlan(
        invalidPlan as never,
        makeEngineContext("1", { rules: [] }),
      ),
    ).toThrow(/contract validation failed/);

    const invalidAssetContext = makeEngineContext("1", { rules: [] });
    const invalidAsset = invalidAssetContext.assets?.[0] as unknown as
      | Record<string, unknown>
      | undefined;
    if (!invalidAsset) throw new Error("synthetic asset fixture missing");
    delete invalidAsset.display_name;
    expect(() =>
      evaluateNativePlan(makeDirectPurchasePlan(), invalidAssetContext),
    ).toThrow(/contract validation failed/);
  });
});

describe("exact reward primitives", () => {
  it("applies percentage with integer rounding at boundaries", () => {
    const rule = makePercentageRule(
      "rr_percent_boundary",
      ["merchant_purchase"],
      100,
      normalPointAsset,
    );
    const context = makeEngineContext("1", { rules: [rule] });
    expect(
      evaluateNativePlan(makeDirectPurchasePlan(99), context).reward_components,
    ).toHaveLength(0);
    expect(
      evaluateNativePlan(makeDirectPurchasePlan(100), context)
        .reward_components[0]?.quantity.amount,
    ).toBe("1");
  });

  it("applies points-per-unit one below, exact, and above denominator", () => {
    const rule = makeTopupRewardRule();
    const context = makeEngineContext("1", { rules: [rule] });
    expect(
      evaluateNativePlan(makeTopupPurchasePlan(99, 1), context)
        .reward_components,
    ).toHaveLength(0);
    expect(
      evaluateNativePlan(makeTopupPurchasePlan(100, 1), context)
        .reward_components[0]?.quantity.amount,
    ).toBe("1");
    expect(
      evaluateNativePlan(makeTopupPurchasePlan(101, 1), context)
        .reward_components[0]?.quantity.amount,
    ).toBe("1");
  });
});

describe("valuation isolation and replay", () => {
  it("flips the winner while preserving the byte-identical native ledger", () => {
    const lowFixture = makeValuationFlipFixture("0.95");
    const highFixture = makeValuationFlipFixture("1.00");
    const low = evaluateCandidates(lowFixture.plans, lowFixture.context);
    const high = evaluateCandidates(highFixture.plans, highFixture.context);
    expect(low.winner?.plan_id).toBe("plan_synthetic_direct_card");
    expect(high.winner?.plan_id).toBe("plan_synthetic_topup_then_pay");
    expect(low.winner?.native_snapshot).toBe(
      high.plans.find((plan) => plan.plan_id === low.winner?.plan_id)
        ?.native_snapshot,
    );
    expect(
      low.valuation_sensitivities[0]?.break_even_jpy_per_unit.startsWith(
        "0.9722222222",
      ),
    ).toBe(true);
    expect(
      replayByteStable(
        low,
        evaluateCandidates(lowFixture.plans, lowFixture.context),
      ),
    ).toBe(true);
    expect(serializeReplay(low)).toBe(
      serializeReplay(evaluateCandidates(lowFixture.plans, lowFixture.context)),
    );
  });

  it("calculates the arbitrary-precision break-even value", () => {
    const fixture = makeValuationFlipFixture("0.95");
    const result = evaluateCandidates(fixture.plans, fixture.context);
    const direct = result.plans.find(
      (plan) => plan.plan_id === "plan_synthetic_direct_card",
    )!;
    const wallet = result.plans.find(
      (plan) => plan.plan_id === "plan_synthetic_topup_then_pay",
    )!;
    expect(
      calculateBreakEvenResidualValue(
        direct,
        wallet,
        walletAsset.asset_id,
        walletAsset.reward_class,
        fixture.context,
      ),
    ).toBe("0.972222222222222222222222222222");
  });
});

describe("semantic and bitemporal boundaries", () => {
  it("rejects backward dependencies, calculated candidate fields, and reversed estimated bounds", () => {
    const plan = makeDirectPurchasePlan() as unknown as Record<string, unknown>;
    plan.economics = {};
    expect(() => validatePurchasePlan(plan as never)).toThrow(
      /calculated_field_supplied/,
    );
    const state = makeUserState();
    state.facts = {
      progress: {
        status: "estimated",
        lower_bound: 3,
        upper_bound: 2,
        observed_at: "2026-08-17T00:00:00Z",
        confidence: "0.9",
        source: "user_input",
      },
    };
    expect(() => validateUserState(state)).toThrow(
      /estimated_lower_above_upper/,
    );
  });

  it("uses half-open transaction and replay-knowledge boundaries", () => {
    const versions = makeBitemporalRuleVersions();
    expect(
      selectApprovedRule(
        versions,
        "rr_synthetic_bitemporal",
        "2026-12-31T14:59:59Z",
        "2026-12-31T14:59:59Z",
      )?.version,
    ).toBe(1);
    expect(
      selectApprovedRule(
        versions,
        "rr_synthetic_bitemporal",
        "2026-12-31T15:00:00Z",
        "2026-12-31T15:00:00Z",
      )?.version,
    ).toBe(2);
    expect(
      selectApprovedRule(
        versions,
        "rr_synthetic_bitemporal",
        "2026-12-31T15:00:00Z",
        "2026-12-31T14:59:59Z",
      )?.version,
    ).toBe(1);
  });

  it("allows partial consumption of an opening lot without treating it as external funding", () => {
    const plan = makeTopupPurchasePlan(1_000, 640);
    plan.operations = [plan.operations[1]!];
    plan.operations[0] = { ...plan.operations[0]!, sequence: 1 };
    plan.dependencies = [];
    const context = makeEngineContext("1", {
      rules: [],
      opening_asset_lots: [
        makeOpeningWalletLot("1000", "lot_synthetic_wallet"),
      ],
    });
    const result = evaluateNativePlan(plan, context);
    expect(result.eligible).toBe(true);
    expect(result.ending_asset_lots[0]?.quantity.amount).toBe("360");
  });
});
