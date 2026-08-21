import { describe, expect, it } from "vitest";
import {
  applyClawback,
  applyExpiry,
  applyRefund,
  applyReversal,
  calculateClawbackAdjustment,
  calculateExpiryAdjustment,
  calculateRefundAdjustment,
  type LifecycleRewardTarget,
  lifecycleTargetFromRewardComponent,
} from "../src/m1b-lifecycle.js";
import type {
  AssetRef,
  ClawbackPolicy,
  Expiry,
  Quantity,
  RewardComponent,
  Settlement,
} from "../src/types.js";

const points: AssetRef = {
  asset_id: "points",
  asset_kind: "reward_point",
  program_id: "program",
  reward_class: "normal",
  scale: 0,
};

const principalAsset: AssetRef = {
  asset_id: "stored-value",
  asset_kind: "stored_value",
  program_id: "wallet",
  reward_class: null,
  scale: 0,
};

const quantity: Quantity = { asset: points, amount: "100" };
const principal: Quantity = { asset: principalAsset, amount: "250" };

const settlement: Settlement = {
  status: "posted",
  expected_posting_from: "2026-08-01T00:00:00Z",
  expected_posting_to: "2026-08-02T00:00:00Z",
  posted_at: "2026-08-01T00:00:00Z",
};

const policy = (on_refund: ClawbackPolicy["on_refund"]): ClawbackPolicy => ({
  on_refund,
  posting_delay_days: null,
  notes: "test",
});

const target = (
  overrides: Partial<LifecycleRewardTarget> = {},
): LifecycleRewardTarget => ({
  component_id: "cmp_reward",
  quantity,
  clawback: policy("proportional"),
  settlement,
  ...overrides,
});

const fixedExpiry = (overrides: Partial<Expiry> = {}): Expiry => ({
  policy: "fixed_date",
  expires_at: "2026-08-17T00:00:00Z",
  duration_days: null,
  timezone: "UTC",
  ...overrides,
});

describe("Milestone 1B lifecycle kernels", () => {
  it("emits a principal refund and proportional reward debit separately", () => {
    const input = {
      operation_id: "op_refund",
      original_operation_id: "op_purchase",
      principal_quantity: principal,
      reward: target(),
      refund_amount_jpy: 250,
      original_amount_jpy: 1_000,
    };
    const result = calculateRefundAdjustment(input);
    expect(result.status).toBe("applied");
    expect(result.principal_instruction).toMatchObject({
      kind: "refund",
      sign: "credit",
      direction: "return",
      movement_role: "refund",
      original_operation_id: "op_purchase",
      quantity: principal,
    });
    expect(result.reward_instruction).toMatchObject({
      kind: "clawback",
      sign: "debit",
      source_component_id: "cmp_reward",
      quantity: { amount: "25" },
      reason_code: "proportional_clawback",
    });
    expect(input.principal_quantity).toEqual(principal);
    expect(input.reward.quantity).toEqual(quantity);
  });

  it("defaults a reversal to an explicit full reward debit", () => {
    const result = applyReversal({
      operation_id: "op_reversal",
      original_operation_id: "op_purchase",
      principal_quantity: principal,
      reward: target({ clawback: null }),
    });
    expect(result.status).toBe("applied");
    expect(result.principal_instruction).toMatchObject({
      kind: "reversal",
      sign: "credit",
      movement_role: "reversal",
    });
    expect(result.reward_instruction).toMatchObject({
      kind: "reversal",
      sign: "debit",
      quantity: { amount: "100" },
      reason_code: "full_clawback",
    });
  });

  it("does not invent a principal quantity or a missing provider-defined clawback", () => {
    expect(
      applyRefund({
        reward: target(),
        refund_amount_jpy: 1,
        original_amount_jpy: 2,
      }),
    ).toMatchObject({
      status: "rejected",
      reason_code: "refund_principal_required",
    });
    expect(
      calculateClawbackAdjustment({
        reward: target({ clawback: policy("provider_defined") }),
      }),
    ).toMatchObject({
      status: "conditional",
      reason_code: "provider_clawback_required",
    });
    expect(
      applyClawback({
        reward: target({ clawback: policy("provider_defined") }),
        provider_defined_units: "30",
      }),
    ).toMatchObject({
      status: "applied",
      reward_instruction: {
        quantity: { amount: "30" },
        reason_code: "provider_defined_clawback",
      },
    });
  });

  it("expires a fixed-date reward only at or after the boundary", () => {
    const expiring = target({ expiry: fixedExpiry() });
    expect(
      calculateExpiryAdjustment({
        reward: expiring,
        at: "2026-08-16T23:59:59Z",
      }),
    ).toMatchObject({ status: "not_due", reason_code: "expiry_not_reached" });
    expect(
      calculateExpiryAdjustment({
        reward: expiring,
        at: "2026-08-17T00:00:00Z",
      }),
    ).toMatchObject({
      status: "applied",
      reason_code: "reward_expired",
      reward_instruction: { sign: "debit", quantity: { amount: "100" } },
    });
  });

  it("handles relative posting expiry and keeps provider expiry conditional", () => {
    const relative = target({
      expiry: fixedExpiry({
        policy: "relative_to_posting",
        expires_at: null,
        duration_days: 2,
      }),
    });
    expect(
      applyExpiry({ reward: relative, at: "2026-08-02T00:00:00Z" }),
    ).toMatchObject({ status: "not_due", reason_code: "expiry_not_reached" });
    expect(
      applyExpiry({ reward: relative, at: "2026-08-03T00:00:00Z" }),
    ).toMatchObject({ status: "applied", reason_code: "reward_expired" });
    expect(
      applyExpiry({
        reward: target({
          expiry: fixedExpiry({ policy: "provider_defined", expires_at: null }),
        }),
        at: "2026-08-17T00:00:00Z",
      }),
    ).toMatchObject({
      status: "conditional",
      reason_code: "provider_expiry_unknown",
    });
  });

  it("adapts a native RewardComponent without changing it", () => {
    const component: RewardComponent = {
      component_id: "cmp_native",
      operation_id: "op_purchase",
      rule_id: "rr_reward",
      sign: "credit",
      quantity,
      value_jpy: { minimum_jpy: 100, maximum_jpy: 100, expected_jpy: 100 },
      certainty: {
        type: "guaranteed",
        probability: null,
        probability_source: null,
      },
      settlement,
      expiry: fixedExpiry(),
      restrictions: {
        transferable: true,
        redeemable_for_cash: false,
        usable_for_payment: true,
        investable: false,
        permitted_destination_ids: [],
        notes: "",
      },
      clawback: policy("full"),
      calculation_trace: {
        eligible_basis: "operation_amount",
        rounding_stage: "per_operation",
      },
    };
    const adapted = lifecycleTargetFromRewardComponent(component);
    expect(adapted).toEqual({
      component_id: "cmp_native",
      quantity,
      clawback: policy("full"),
      settlement,
      expiry: fixedExpiry(),
    });
    expect(component.quantity).toEqual(quantity);
  });
});
