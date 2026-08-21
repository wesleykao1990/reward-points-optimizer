import { describe, expect, it } from "vitest";
import {
  calculateFixedReward,
  calculateMultiplierReward,
  calculateTieredReward,
  calculateTransfer,
  type FixedCalculationSpec,
  hasTransferCycle,
  type MultiplierCalculationSpec,
  type TieredCalculationSpec,
  type TransferCalculationSpec,
} from "../src/m1b-calculations.js";
import type { AssetRef, Quantity, Rounding, Settlement } from "../src/types.js";

const rounding = (
  reward_rounding_mode: Rounding["reward_rounding_mode"] = "floor",
): Rounding => ({
  aggregation_scope: "per_operation",
  eligible_spend_quantum_jpy: null,
  reward_rounding_mode,
});

const pointAsset = (asset_id = "points", scale = 0): AssetRef => ({
  asset_id,
  asset_kind: "reward_point",
  program_id: "program",
  reward_class: "normal",
  scale,
});

const fee: Quantity = { asset: pointAsset("fee-points"), amount: "3" };

const transferSettlement: Settlement = {
  status: "pending",
  expected_posting_from: "2026-08-17T00:00:00Z",
  expected_posting_to: "2026-08-19T00:00:00Z",
  posted_at: null,
};

const transfer = (
  overrides: Partial<TransferCalculationSpec> = {},
): TransferCalculationSpec => ({
  model: "transfer_ratio",
  source_asset: pointAsset("source"),
  destination_asset: pointAsset("destination"),
  source_units: "1",
  destination_units: "2",
  minimum_source_units: "100",
  increment_source_units: "25",
  maximum_source_units_per_request: "500",
  maximum_source_units_per_period: "1,000".replace(",", ""),
  maximum_period: "month",
  fee,
  rounding: { ...rounding("exact"), aggregation_scope: "transfer_request" },
  processing_time_days_min: 1,
  processing_time_days_max: 3,
  cancellation_policy: "cancelable_before_posting",
  ...overrides,
});

describe("Milestone 1B calculation kernels", () => {
  it("honors fixed thresholds one below, exact, and one above", () => {
    const calculation: FixedCalculationSpec = {
      model: "fixed",
      reward_units: "3",
      rounding: rounding("exact"),
    };
    expect(
      calculateFixedReward(calculation, {
        eligible_amount_jpy: 999,
        minimum_amount_jpy: 1_000,
      }),
    ).toMatchObject({ status: "not_eligible", units: 0n });
    expect(
      calculateFixedReward(calculation, {
        eligible_amount_jpy: 1_000,
        minimum_amount_jpy: 1_000,
      }),
    ).toMatchObject({ status: "applied", units: 3n });
    expect(
      calculateFixedReward(calculation, {
        eligible_amount_jpy: 1_001,
        threshold_jpy: 1_000,
      }),
    ).toMatchObject({ status: "applied", units: 3n });
  });

  it("evaluates transaction, user-fact, period-aggregate, and event-counter tiers", () => {
    const transaction: TieredCalculationSpec = {
      model: "tiered",
      tier_basis: { source: "transaction_amount", key: "amount", period: null },
      tiers: [
        {
          operator: "gte",
          value: 1_000,
          award: { model: "fixed", reward_units: "1" },
        },
        {
          operator: "gte",
          value: 5_000,
          award: { model: "fixed", reward_units: "2" },
        },
      ],
      rounding: rounding("exact"),
    };
    expect(
      calculateTieredReward(transaction, {
        basis_value: 5_000,
        asset_scale: 0,
      }),
    ).toMatchObject({ status: "applied", units: 2n, matched_tier_index: 1 });

    const userFact: TieredCalculationSpec = {
      model: "tiered",
      tier_basis: { source: "user_fact", key: "membership_tier", period: null },
      tiers: [
        {
          operator: "eq",
          value: "gold",
          award: { model: "fixed", reward_units: "7" },
        },
      ],
      rounding: rounding("exact"),
    };
    expect(
      calculateTieredReward(userFact, { basis_value: "gold" }),
    ).toMatchObject({
      status: "applied",
      units: 7n,
    });

    const aggregate: TieredCalculationSpec = {
      model: "tiered",
      tier_basis: {
        source: "period_aggregate",
        key: "prior_month_spend",
        period: "previous_month",
      },
      tiers: [
        {
          operator: "gte",
          value: 10_000,
          award: { model: "percentage", rate_basis_points: 100 },
        },
      ],
      rounding: rounding("floor"),
    };
    expect(
      calculateTieredReward(aggregate, {
        basis_value: 12_000,
        spend_jpy: 1_000,
      }),
    ).toMatchObject({ status: "applied", units: 10n });

    const eventCounter: TieredCalculationSpec = {
      model: "tiered",
      tier_basis: {
        source: "event_counter",
        key: "presentations",
        period: "current_month",
      },
      tiers: [
        {
          operator: "range",
          value: [1, 3],
          award: { model: "points_per_unit", reward_units: "2", spend_jpy: 5 },
        },
      ],
      rounding: rounding("floor"),
    };
    expect(
      calculateTieredReward(eventCounter, { basis_value: 2, spend_jpy: 12 }),
    ).toMatchObject({ status: "applied", units: 4n });
  });

  it("rejects a missing tier basis instead of treating it as zero", () => {
    const calculation: TieredCalculationSpec = {
      model: "tiered",
      tier_basis: { source: "user_fact", key: "tier", period: null },
      tiers: [
        {
          operator: "gte",
          value: 1,
          award: { model: "fixed", reward_units: "1" },
        },
      ],
      rounding: rounding("exact"),
    };
    expect(calculateTieredReward(calculation, {})).toMatchObject({
      status: "rejected",
      conditions: [{ code: "tier_basis_required" }],
    });
  });

  it("requires explicit multiplier base units and exposes total versus increment", () => {
    const calculation: MultiplierCalculationSpec = {
      model: "multiplier",
      multiplier_milli: 1_500,
      applies_to_stack_group: "base",
      rounding: rounding("exact"),
    };
    expect(calculateMultiplierReward(calculation, {})).toMatchObject({
      status: "rejected",
      conditions: [{ code: "base_reward_required" }],
    });
    expect(
      calculateMultiplierReward(calculation, { base_units: 10n }),
    ).toMatchObject({
      status: "applied",
      units: 15n,
      multiplied_units: 15n,
      increment_units: 5n,
    });
    expect(
      calculateMultiplierReward(calculation, {
        base_units: 10n,
        output_mode: "increment",
      }),
    ).toMatchObject({ status: "applied", units: 5n });
  });

  it("enforces transfer minimum, increment, maxima, fee, posting, and ratio", () => {
    const accepted = calculateTransfer(transfer(), {
      source_amount: "150",
      period_source_used: "200",
      posting: transferSettlement,
    });
    expect(accepted).toMatchObject({
      status: "applied",
      source_amount: "150",
      destination_amount: "300",
      fee,
      posting: transferSettlement,
    });

    expect(
      calculateTransfer(transfer(), {
        source_amount: "99",
        period_source_used: "0",
      }),
    ).toMatchObject({
      status: "rejected",
      reason_code: "below_transfer_minimum",
    });
    expect(
      calculateTransfer(transfer(), {
        source_amount: "110",
        period_source_used: "0",
      }),
    ).toMatchObject({
      status: "rejected",
      reason_code: "transfer_increment_mismatch",
    });
    expect(
      calculateTransfer(transfer(), {
        source_amount: "525",
        period_source_used: "0",
      }),
    ).toMatchObject({
      status: "rejected",
      reason_code: "transfer_request_maximum_exceeded",
    });
    expect(
      calculateTransfer(transfer(), { source_amount: "150" }),
    ).toMatchObject({
      status: "conditional",
      reason_code: "transfer_period_usage_unknown",
    });
    expect(
      calculateTransfer(transfer(), {
        source_amount: "150",
        period_source_used: "900",
      }),
    ).toMatchObject({
      status: "rejected",
      reason_code: "transfer_period_maximum_exceeded",
    });
  });

  it("keeps cancellation and directed cycle checks explicit", () => {
    expect(
      calculateTransfer(transfer(), {
        source_amount: "100",
        period_source_used: "0",
        cancel_requested: true,
      }),
    ).toMatchObject({
      status: "conditional",
      reason_code: "posting_state_required",
    });
    expect(
      calculateTransfer(transfer(), {
        source_amount: "100",
        period_source_used: "0",
        cancel_requested: true,
        posting: transferSettlement,
      }),
    ).toMatchObject({
      status: "cancelled",
      reason_code: "cancelled_before_posting",
    });
    expect(
      calculateTransfer(transfer(), {
        source_amount: "100",
        period_source_used: "0",
        cancel_requested: true,
        posting: { ...transferSettlement, status: "posted" },
      }),
    ).toMatchObject({ status: "rejected", reason_code: "already_posted" });
    expect(
      calculateTransfer(
        transfer({
          source_asset: pointAsset("same"),
          destination_asset: pointAsset("same"),
        }),
        {
          source_amount: "100",
          period_source_used: "0",
        },
      ),
    ).toMatchObject({
      status: "rejected",
      reason_code: "transfer_cycle_detected",
    });
    expect(
      calculateTransfer(transfer(), {
        source_amount: "100",
        period_source_used: "0",
        visited_asset_ids: ["destination"],
      }),
    ).toMatchObject({
      status: "rejected",
      reason_code: "transfer_cycle_detected",
    });
    expect(
      hasTransferCycle([
        { source_asset_id: "a", destination_asset_id: "b" },
        { source_asset_id: "b", destination_asset_id: "c" },
        { source_asset_id: "c", destination_asset_id: "a" },
      ]),
    ).toBe(true);
    expect(
      hasTransferCycle([{ source_asset_id: "a", destination_asset_id: "b" }]),
    ).toBe(false);
  });
});
