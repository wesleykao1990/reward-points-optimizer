import { describe, expect, it } from "vitest";
import {
  type AssetRef,
  type Expiry,
  evaluateM1BEvent,
  evaluateRewardExpiryEvent,
  evaluateTransferCancellationEvent,
  type Quantity,
  type Rounding,
  type Settlement,
  type TransferCalculationSpec,
  type TransferCancellationEvent,
} from "../src/index.js";

const points = (asset_id: string): AssetRef => ({
  asset_id,
  asset_kind: "reward_point",
  program_id: "program",
  reward_class: "normal",
  scale: 0,
});

const rounding: Rounding = {
  aggregation_scope: "transfer_request",
  eligible_spend_quantum_jpy: null,
  reward_rounding_mode: "exact",
};

const transfer: TransferCalculationSpec = {
  model: "transfer_ratio",
  source_asset: points("source"),
  destination_asset: points("destination"),
  source_units: "1",
  destination_units: "2",
  minimum_source_units: "100",
  increment_source_units: "25",
  maximum_source_units_per_request: "500",
  maximum_source_units_per_period: "1,000".replace(",", ""),
  maximum_period: "month",
  fee: null,
  rounding,
  processing_time_days_min: 1,
  processing_time_days_max: 3,
  cancellation_policy: "cancelable_before_posting",
};

const pending: Settlement = {
  status: "pending",
  expected_posting_from: "2026-08-18T00:00:00Z",
  expected_posting_to: "2026-08-20T00:00:00Z",
  posted_at: null,
};

const posted: Settlement = {
  ...pending,
  status: "posted",
  posted_at: "2026-08-18T00:00:00Z",
};

const rewardQuantity: Quantity = { asset: points("reward"), amount: "100" };
const fixedExpiry: Expiry = {
  policy: "fixed_date",
  expires_at: "2026-08-18T00:00:00Z",
  duration_days: null,
  timezone: "UTC",
};

const transferEvent = (
  overrides: Partial<TransferCancellationEvent> = {},
): TransferCancellationEvent => ({
  event_kind: "transfer_cancellation",
  calculation: transfer,
  source_amount: "125",
  period_source_used: "0",
  ...overrides,
});

describe("public M1B event facade", () => {
  it("cancels before posting and preserves the original source amount", () => {
    const result = evaluateTransferCancellationEvent(
      transferEvent({ posting: pending }),
    );
    expect(result).toMatchObject({
      event_kind: "transfer_cancellation",
      status: "cancelled",
      reason_code: "cancelled_before_posting",
      transfer: {
        source_amount: "125",
        status: "cancelled",
        posting: pending,
      },
    });
  });

  it("rejects cancellation after posting and preserves the underlying reason", () => {
    const result = evaluateTransferCancellationEvent(
      transferEvent({ posting: posted }),
    );
    expect(result).toMatchObject({
      status: "rejected",
      reason_code: "already_posted",
      transfer: { status: "rejected", reason_code: "already_posted" },
    });
  });

  it("returns conditional when posting state is missing or unknown", () => {
    expect(evaluateTransferCancellationEvent(transferEvent())).toMatchObject({
      status: "conditional",
      reason_code: "posting_state_required",
    });
    expect(
      evaluateTransferCancellationEvent(
        transferEvent({
          posting: { ...pending, status: "unknown" },
        }),
      ),
    ).toMatchObject({
      status: "conditional",
      reason_code: "posting_state_required",
    });
  });

  it("evaluates due and not-due expiry without mutating the reward target", () => {
    const reward = {
      component_id: "cmp_reward",
      quantity: rewardQuantity,
      expiry: fixedExpiry,
    };
    expect(
      evaluateRewardExpiryEvent({
        event_kind: "reward_expiry",
        reward,
        at: "2026-08-17T23:59:59Z",
      }),
    ).toMatchObject({
      event_kind: "reward_expiry",
      status: "not_due",
      reason_code: "expiry_not_reached",
      adjustment: { reward_instruction: null },
    });
    expect(
      evaluateRewardExpiryEvent({
        event_kind: "reward_expiry",
        reward,
        at: "2026-08-18T00:00:00Z",
      }),
    ).toMatchObject({
      status: "applied",
      reason_code: "reward_expired",
      adjustment: {
        status: "applied",
        reward_instruction: { sign: "debit", quantity: { amount: "100" } },
      },
    });
    expect(reward.quantity).toEqual(rewardQuantity);
  });

  it("keeps unknown expiry metadata and timestamps conditional", () => {
    expect(
      evaluateRewardExpiryEvent({
        event_kind: "reward_expiry",
        reward: { quantity: rewardQuantity },
        at: "2026-08-18T00:00:00Z",
      }),
    ).toMatchObject({
      status: "conditional",
      reason_code: "expiry_metadata_unknown",
    });
    expect(
      evaluateRewardExpiryEvent({
        event_kind: "reward_expiry",
        reward: { quantity: rewardQuantity, expiry: fixedExpiry },
      }),
    ).toMatchObject({
      status: "conditional",
      reason_code: "expiry_time_required",
    });
  });

  it("dispatches both event kinds through one discriminated facade", () => {
    expect(evaluateM1BEvent(transferEvent({ posted: false }))).toMatchObject({
      event_kind: "transfer_cancellation",
      status: "cancelled",
    });
    expect(
      evaluateM1BEvent({
        event_kind: "reward_expiry",
        reward: { quantity: rewardQuantity, expiry: fixedExpiry },
        at: "2026-08-18T00:00:00Z",
      }),
    ).toMatchObject({ event_kind: "reward_expiry", status: "applied" });
  });
});
