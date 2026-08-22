import { describe, expect, it } from "vitest";

import {
  optimizePointSpend,
  type PointSpendEdge,
  type PointSpendRequest,
} from "../src/point-spend-optimizer.js";
import type { AssetRef } from "../src/types.js";

const point = (id: string): AssetRef => ({
  asset_id: id,
  asset_kind: id.includes("mile") ? "airline_mile" : "reward_point",
  program_id: `program.${id}`,
  reward_class: "normal",
  scale: 0,
});

const edge = (
  rule_id: string,
  source: AssetRef,
  destination: AssetRef,
  source_units: string,
  destination_units: string,
  overrides: Partial<PointSpendEdge> = {},
): PointSpendEdge => ({
  rule_id,
  label_ja: rule_id,
  source_claim_ids: [`claim.${rule_id}`],
  source_asset: source,
  destination_asset: destination,
  source_units,
  destination_units,
  minimum_source_units: null,
  increment_source_units: null,
  maximum_source_units_per_request: null,
  maximum_source_units_per_period: null,
  maximum_period: null,
  fee_source_units: "0",
  processing_time_days_min: 0,
  processing_time_days_max: 0,
  cancellation_policy: "provider_defined",
  valid_from: null,
  valid_to: null,
  required_conditions_ja: [],
  ...overrides,
});

const recruit = point("asset.point.recruit");
const ponta = point("asset.point.ponta");
const jal = point("asset.mile.jal");

function request(
  overrides: Partial<PointSpendRequest> = {},
): PointSpendRequest {
  return {
    effective_at: "2026-08-23T12:00:00+09:00",
    objective: "maximize_target",
    target_asset_id: jal.asset_id,
    balances: [{ asset: recruit, amount: "1000", expires_at: null }],
    edges: [
      edge("recruit-ponta", recruit, ponta, "1", "1"),
      edge("ponta-jal", ponta, jal, "2", "1", {
        minimum_source_units: "2",
        increment_source_units: "2",
        processing_time_days_min: 7,
        processing_time_days_max: 7,
      }),
    ],
    confirmed_rule_ids: [],
    period_source_used_by_rule: {},
    max_steps: 4,
    ...overrides,
  };
}

describe("point spending route optimizer", () => {
  it("finds an acyclic multi-hop route and validates each ratio", () => {
    const result = optimizePointSpend(request());
    expect(result.winner).toMatchObject({
      target_amount: "500",
      residual_source_amount: "0",
      processing_time_days_max: 7,
    });
    expect(result.winner?.steps.map((step) => step.rule_id)).toEqual([
      "recruit-ponta",
      "ponta-jal",
    ]);
    expect(result.routes).toHaveLength(1);
    expect(result.result_hash).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });

  it("aligns to transfer increments and retains the source residual", () => {
    const result = optimizePointSpend(
      request({
        balances: [{ asset: ponta, amount: "101", expires_at: null }],
        edges: [
          edge("ponta-jal", ponta, jal, "2", "1", {
            minimum_source_units: "2",
            increment_source_units: "2",
          }),
        ],
      }),
    );
    expect(result.winner).toMatchObject({
      target_amount: "50",
      residual_source_amount: "1",
    });
  });

  it("requires explicit condition confirmation and excludes expired edges", () => {
    const conditional = edge("campaign", ponta, jal, "2", "3", {
      required_conditions_ja: ["エントリーが必要です"],
    });
    const expired = edge("expired", ponta, jal, "1", "99", {
      valid_to: "2026-08-22",
    });
    const blocked = optimizePointSpend(
      request({
        balances: [{ asset: ponta, amount: "100", expires_at: null }],
        edges: [conditional, expired],
      }),
    );
    expect(blocked.winner).toBeNull();
    expect(blocked.skipped).toEqual([
      { rule_id: "campaign", reason_code: "condition_confirmation_required" },
      { rule_id: "expired", reason_code: "outside_validity_window" },
    ]);

    const confirmed = optimizePointSpend(
      request({
        balances: [{ asset: ponta, amount: "100", expires_at: null }],
        edges: [conditional],
        confirmed_rule_ids: ["campaign"],
      }),
    );
    expect(confirmed.winner?.target_amount).toBe("150");
  });

  it("rejects proxies and accessors before dereference", () => {
    let reads = 0;
    const hostile = request() as unknown as Record<string, unknown>;
    Object.defineProperty(hostile, "objective", {
      enumerable: true,
      get() {
        reads += 1;
        return "maximize_target";
      },
    });
    expect(() =>
      optimizePointSpend(hostile as unknown as PointSpendRequest),
    ).toThrow("point_spend_input_invalid");
    expect(reads).toBe(0);
    expect(() => optimizePointSpend(new Proxy(request(), {}))).toThrow(
      "point_spend_input_invalid",
    );
  });
});
