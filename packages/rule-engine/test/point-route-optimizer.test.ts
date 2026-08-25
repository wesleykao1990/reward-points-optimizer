import { describe, expect, it } from "vitest";

import {
  buildValuationProfile,
  deriveBestExitValuations,
  optimizePointRoute,
  type PointRouteEdge,
  type PointRouteRequest,
  type ValuationProfile,
} from "../src/index.js";
import type { AssetRef } from "../src/types.js";

/**
 * The graph mirrors the shape of the published multi-hop exchange routes: a
 * poor direct exchange, and a three-hop chain through two intermediaries whose
 * composed rate is roughly twice as good.
 */
const SITE: AssetRef = {
  asset_id: "asset.point.site",
  asset_kind: "reward_point",
  program_id: "program.site",
  reward_class: "normal",
  scale: 0,
};
const HUB: AssetRef = {
  asset_id: "asset.point.hub",
  asset_kind: "reward_point",
  program_id: "program.hub",
  reward_class: "normal",
  scale: 0,
};
const TRANSIT: AssetRef = {
  asset_id: "asset.point.transit",
  asset_kind: "reward_point",
  program_id: "program.transit",
  reward_class: "normal",
  scale: 0,
};
const MILE: AssetRef = {
  asset_id: "asset.mile.air",
  asset_kind: "airline_mile",
  program_id: "program.air",
  reward_class: "normal",
  scale: 0,
};

function edge(
  ruleId: string,
  source: AssetRef,
  destination: AssetRef,
  sourceUnits: string,
  destinationUnits: string,
  overrides: Partial<PointRouteEdge> = {},
): PointRouteEdge {
  return {
    rule_id: ruleId,
    label_ja: ruleId,
    source_claim_ids: [`claim.${ruleId}`],
    source_asset: source,
    destination_asset: destination,
    source_units: sourceUnits,
    destination_units: destinationUnits,
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
    requires_direct_source: false,
    ...overrides,
  };
}

const DIRECT = edge("p0.direct", SITE, MILE, "1000", "333");
const HOP_A = edge("p0.hop-a", SITE, HUB, "1", "1");
const HOP_B = edge("p0.hop-b", HUB, TRANSIT, "1", "1");
const HOP_C = edge("p0.hop-c", TRANSIT, MILE, "1000", "700");

function profile(): ValuationProfile {
  return buildValuationProfile("test-profile", [
    {
      asset_id: SITE.asset_id,
      reward_class: "normal",
      jpy_per_unit_min: "1",
      jpy_per_unit_expected: "1",
      jpy_per_unit_max: "1",
      source: "face_value_default",
      note: "face value",
    },
    {
      asset_id: MILE.asset_id,
      reward_class: "normal",
      jpy_per_unit_min: "1.5",
      jpy_per_unit_expected: "2",
      jpy_per_unit_max: "3",
      source: "user_profile",
      note: "user redemption value",
    },
  ]);
}

function request(
  overrides: Partial<PointRouteRequest> = {},
): PointRouteRequest {
  return {
    effective_at: "2026-08-23T00:00:00Z",
    objective: "maximize_value",
    target_asset_id: MILE.asset_id,
    balances: [{ asset: SITE, amount: "10000", expires_at: null }],
    edges: [DIRECT, HOP_A, HOP_B, HOP_C],
    confirmed_rule_ids: [],
    period_source_used_by_rule: {},
    max_steps: 4,
    max_legs: 4,
    valuation: profile(),
    ...overrides,
  };
}

describe("point route optimizer", () => {
  it("prefers a three-hop chain over the direct exchange", () => {
    const result = optimizePointRoute(request());
    expect(result.winner?.target_amount).toBe("7000");
    expect(result.winner?.legs[0]?.rule_ids).toEqual([
      "p0.hop-a",
      "p0.hop-b",
      "p0.hop-c",
    ]);
    // 7,000 miles valued at JPY 2 against 10,000 points valued at JPY 1.
    expect(result.winner?.value?.expected_jpy).toBe("14000");
    expect(result.winner?.effective_rate_percent).toBe("140");
    expect(result.winner?.allocation_optimality).toBe("exact_single_leg");
  });

  it("splits the balance when a monthly cap binds the best route", () => {
    const capped = edge("p0.hop-c", TRANSIT, MILE, "1000", "700", {
      maximum_source_units_per_period: "5000",
      maximum_period: "month",
    });
    const result = optimizePointRoute(
      request({
        edges: [DIRECT, HOP_A, HOP_B, capped],
        period_source_used_by_rule: { "p0.hop-c": "0" },
      }),
    );
    const winner = result.winner;
    expect(winner?.legs).toHaveLength(2);
    // Only the 5,000 the cap admits goes down the good route; sending more
    // would strand it in the transit currency rather than earn a better rate.
    expect(winner?.legs[0]?.allocated_source_amount).toBe("5000");
    expect(winner?.legs[0]?.rule_ids).toEqual([
      "p0.hop-a",
      "p0.hop-b",
      "p0.hop-c",
    ]);
    expect(winner?.legs[1]?.rule_ids).toEqual(["p0.direct"]);
    expect(winner?.target_amount).toBe("5165");
    expect(winner?.allocation_optimality).toBe("greedy_marginal_value");
    expect(winner?.legs[0]?.binding_constraint).toBe("period_cap");
    expect(winner?.legs[0]?.binding_rule_id).toBe("p0.hop-c");
  });

  it("reports the remainder stranded at a hop other than the first", () => {
    const chunky = edge("p0.hop-c", TRANSIT, MILE, "1000", "700", {
      minimum_source_units: "1000",
      increment_source_units: "1000",
    });
    const result = optimizePointRoute(
      request({
        balances: [{ asset: SITE, amount: "10500", expires_at: null }],
        edges: [HOP_A, HOP_B, chunky],
      }),
    );
    const winner = result.winner;
    expect(winner?.target_amount).toBe("7000");
    expect(winner?.stranded).toEqual([
      { asset_id: TRANSIT.asset_id, reward_class: "normal", amount: "500" },
    ]);
    const lastHop = winner?.legs[0]?.hops[2];
    expect(lastHop?.stranded_source_amount).toBe("500");
    expect(lastHop?.binding_constraint).toBe("increment");
    // The transit currency has no declared valuation, so the loss is reported
    // in native units and explicitly not priced.
    expect(winner?.stranded_value_jpy).toBeNull();
  });

  it("rejects a hop that closes before the route reaches it", () => {
    const slowA = edge("p0.hop-a", SITE, HUB, "1", "1", {
      processing_time_days_min: 30,
      processing_time_days_max: 45,
    });
    const closing = edge("p0.hop-c", TRANSIT, MILE, "1000", "700", {
      valid_to: "2026-09-30",
    });
    const result = optimizePointRoute(
      request({ edges: [DIRECT, slowA, HOP_B, closing] }),
    );
    // Initiated 45 days after 2026-08-23, hop C is past its closing date.
    expect(result.winner?.legs[0]?.rule_ids).toEqual(["p0.direct"]);
    expect(result.skipped).toContainEqual({
      rule_id: "p0.hop-c",
      reason_code: "closes_before_hop_is_reached",
    });
  });

  it("treats valid_to as an exclusive date boundary", () => {
    const endingToday = edge("p0.direct", SITE, MILE, "1000", "333", {
      valid_to: "2026-08-23",
    });
    const result = optimizePointRoute(request({ edges: [endingToday] }));
    expect(result.winner).toBeNull();
    expect(result.skipped).toContainEqual({
      rule_id: "p0.direct",
      reason_code: "closes_before_hop_is_reached",
    });
  });

  it("requires confirmed structured rule prerequisites", () => {
    const direct = edge("p0.direct", SITE, MILE, "1000", "333", {
      requires_rule_ids: ["prerequisite.direct-entry"],
    });
    const blocked = optimizePointRoute(request({ edges: [direct] }));
    expect(blocked.winner).toBeNull();
    expect(blocked.skipped).toContainEqual({
      rule_id: "p0.direct",
      reason_code: "prerequisite_confirmation_required",
    });

    const confirmed = optimizePointRoute(
      request({
        edges: [direct],
        confirmed_prerequisite_ids: ["prerequisite.direct-entry"],
      }),
    );
    expect(confirmed.winner?.target_amount).toBe("3330");
  });

  it("does not require duplicate rule confirmation for structured prerequisites", () => {
    const direct = edge("p0.direct", SITE, MILE, "1000", "333", {
      required_conditions_ja: ["対象カードを保有していること"],
      requires_rule_ids: ["prerequisite.direct-entry"],
    });
    const confirmed = optimizePointRoute(
      request({
        edges: [direct],
        confirmed_prerequisite_ids: ["prerequisite.direct-entry"],
      }),
    );
    expect(confirmed.winner?.target_amount).toBe("3330");
    expect(confirmed.skipped).toEqual([]);
  });

  it("rejects unbounded or non-canonical confirmation identifiers", () => {
    expect(() =>
      optimizePointRoute(
        request({ confirmed_prerequisite_ids: ["x".repeat(1_000_000)] }),
      ),
    ).toThrow("point_route_prerequisite_state_invalid");
    expect(() =>
      optimizePointRoute(request({ confirmed_rule_ids: ["not_valid"] })),
    ).toThrow("point_route_state_invalid");
  });

  it("rejects an over-cap rolling request instead of truncating it", () => {
    const rolling = edge("p0.direct", SITE, MILE, "1", "1", {
      maximum_source_units_per_period: "100000",
      maximum_period: "rolling_30_day",
      partial_consumption: false,
    });
    const result = optimizePointRoute(
      request({
        balances: [{ asset: SITE, amount: "20000", expires_at: null }],
        edges: [rolling],
        period_source_used_by_rule: { "p0.direct": "90000" },
      }),
    );
    expect(result.winner).toBeNull();
    expect(result.skipped).toContainEqual({
      rule_id: "p0.direct",
      reason_code: "transfer_period_maximum_exceeded",
    });
  });

  it("keeps a directly-held-units rule out of every later hop", () => {
    const directOnly = edge("p0.hop-c", TRANSIT, MILE, "1000", "700", {
      requires_direct_source: true,
    });
    const result = optimizePointRoute(
      request({ edges: [DIRECT, HOP_A, HOP_B, directOnly] }),
    );
    // The chain can still reach the transit currency, but the campaign rate
    // there is unavailable to units that arrived through an intermediary.
    expect(result.winner?.legs[0]?.rule_ids).toEqual(["p0.direct"]);
    expect(result.winner?.target_amount).toBe("3330");
  });

  it("ranks every reachable exit when no target is given", () => {
    const withHubValue = buildValuationProfile("exit-profile", [
      ...profile().entries,
      {
        asset_id: HUB.asset_id,
        reward_class: "normal",
        jpy_per_unit_min: "1",
        jpy_per_unit_expected: "1",
        jpy_per_unit_max: "1",
        source: "face_value_default",
        note: "face value",
      },
    ]);
    const result = optimizePointRoute(
      request({ target_asset_id: null, valuation: withHubValue }),
    );
    const targets = result.plans.map((plan) => plan.target_asset.asset_id);
    expect(targets).toContain(MILE.asset_id);
    expect(targets).toContain(HUB.asset_id);
    // JPY 14,000 of miles beats JPY 10,000 of hub points.
    expect(result.winner?.target_asset.asset_id).toBe(MILE.asset_id);
    // The transit currency is reachable but unpriced, so it is named rather
    // than scored.
    expect(result.unvalued_asset_ids).toContain(`${TRANSIT.asset_id}#normal`);
  });

  it("never ranks an unvalued plan above a valued one", () => {
    const result = optimizePointRoute(request({ target_asset_id: null }));
    const statuses = result.plans.map((plan) => plan.value_status);
    expect(statuses.indexOf("unvalued")).toBeGreaterThan(-1);
    expect(statuses.lastIndexOf("valued")).toBeLessThan(
      statuses.indexOf("unvalued"),
    );
  });

  it("lets a better exit raise what a route is worth", () => {
    const derived = deriveBestExitValuations(profile(), [
      {
        exit_id: "exit.mile.premium",
        asset_id: MILE.asset_id,
        reward_class: "normal",
        label_ja: "premium redemption",
        jpy_per_unit: "3",
        source: "observed_redemption",
        source_claim_ids: ["claim.exit"],
      },
    ]);
    expect(derived.selected_exits).toHaveLength(1);
    const result = optimizePointRoute(request({ valuation: derived.profile }));
    expect(result.winner?.value?.expected_jpy).toBe("21000");
  });

  it("does not report a rule as skipped when it carried flow elsewhere", () => {
    const result = optimizePointRoute(request({ target_asset_id: null }));
    const skippedIds = result.skipped.map((item) => item.rule_id);
    expect(skippedIds).not.toContain("p0.hop-a");
  });

  it("requires prior usage before trusting a capped rule", () => {
    const capped = edge("p0.hop-c", TRANSIT, MILE, "1000", "700", {
      maximum_source_units_per_period: "5000",
      maximum_period: "month",
    });
    const result = optimizePointRoute(
      request({ edges: [DIRECT, HOP_A, HOP_B, capped] }),
    );
    expect(result.skipped).toContainEqual({
      rule_id: "p0.hop-c",
      reason_code: "transfer_period_usage_unknown",
    });
    expect(result.winner?.legs[0]?.rule_ids).toEqual(["p0.direct"]);
  });

  it("debits a source-percentage fee without overstating the destination", () => {
    const percentageFee = edge("p0.moppy-v", SITE, HUB, "1", "1", {
      minimum_source_units: "500",
      increment_source_units: "500",
      fee_schedule: {
        model: "percentage_of_source",
        numerator: "7",
        denominator: "100",
        rounding: "ceil",
      },
    });
    const result = optimizePointRoute(
      request({
        target_asset_id: HUB.asset_id,
        balances: [{ asset: SITE, amount: "1070", expires_at: null }],
        edges: [percentageFee],
      }),
    );
    expect(result.winner?.source_amount_used).toBe("1070");
    expect(result.winner?.target_amount).toBe("1000");
    expect(result.winner?.legs[0]?.hops[0]?.fee_source_units).toBe("70");
  });

  it("uses only provider-published discrete exchange principals", () => {
    const waon = edge("p0.moppy-waon", SITE, HUB, "1", "1", {
      minimum_source_units: "500",
      increment_source_units: null,
      allowed_source_amounts: ["500", "1000", "3000", "5000", "10000"],
      fee_schedule: {
        model: "percentage_of_source",
        numerator: "2",
        denominator: "100",
        rounding: "ceil",
      },
    });
    const result = optimizePointRoute(
      request({
        target_asset_id: HUB.asset_id,
        balances: [{ asset: SITE, amount: "1020", expires_at: null }],
        edges: [waon],
      }),
    );
    expect(result.winner?.source_amount_used).toBe("1020");
    expect(result.winner?.target_amount).toBe("1000");
    expect(result.winner?.legs[0]?.hops[0]?.fee_source_units).toBe("20");
  });

  it("moves from a full-rate to reduced-rate fiscal-year tier", () => {
    const full = edge("p0.ana-full", SITE, HUB, "10000", "10000", {
      minimum_source_units: "10000",
      increment_source_units: "10000",
      maximum_period: "fiscal_year_april",
      period_usage_key: "period.ana-partner-fiscal-year",
      period_usage_max_source_units_exclusive: "20000",
    });
    const reduced = edge("p0.ana-reduced", SITE, HUB, "10000", "5000", {
      minimum_source_units: "10000",
      increment_source_units: "10000",
      maximum_period: "fiscal_year_april",
      period_usage_key: "period.ana-partner-fiscal-year",
      period_usage_min_source_units: "20000",
    });
    const result = optimizePointRoute(
      request({
        target_asset_id: HUB.asset_id,
        balances: [{ asset: SITE, amount: "30000", expires_at: null }],
        edges: [full, reduced],
        period_source_used_by_rule: {
          "period.ana-partner-fiscal-year": "0",
        },
      }),
    );
    expect(result.winner?.target_amount).toBe("25000");
    expect(result.winner?.legs.map((leg) => leg.rule_ids[0])).toEqual([
      "p0.ana-full",
      "p0.ana-reduced",
    ]);
  });

  it("shares a fiscal-year cap across sibling rate rules", () => {
    const low = edge("p0.jal-low", SITE, HUB, "1000", "500", {
      minimum_source_units: "3000",
      increment_source_units: "1000",
      maximum_source_units_per_request: "9000",
      maximum_source_units_per_period: "30000",
      maximum_period: "fiscal_year_april",
      period_usage_key: "period.jal-jr-kyupo-fiscal-year",
    });
    const high = edge("p0.jal-high", SITE, HUB, "10000", "10000", {
      minimum_source_units: "10000",
      increment_source_units: "10000",
      maximum_source_units_per_period: "30000",
      maximum_period: "fiscal_year_april",
      period_usage_key: "period.jal-jr-kyupo-fiscal-year",
    });
    const result = optimizePointRoute(
      request({
        target_asset_id: HUB.asset_id,
        balances: [{ asset: SITE, amount: "40000", expires_at: null }],
        edges: [low, high],
        period_source_used_by_rule: {
          "period.jal-jr-kyupo-fiscal-year": "10000",
        },
      }),
    );
    expect(result.winner?.source_amount_used).toBe("20000");
    expect(result.winner?.target_amount).toBe("20000");
    expect(result.winner?.source_amount_available).toBe("40000");
  });

  it("is deterministic and rejects hostile input", () => {
    const left = optimizePointRoute(request());
    const right = optimizePointRoute(request());
    expect(right.result_hash).toBe(left.result_hash);
    expect(() =>
      optimizePointRoute(new Proxy(request(), {}) as PointRouteRequest),
    ).toThrow("point_route_input_invalid");
    const hostile = {
      ...request(),
      balances: [
        Object.defineProperty({ ...SITE }, "amount", {
          get: () => "999999",
          enumerable: true,
        }),
      ],
    };
    expect(() =>
      optimizePointRoute(hostile as unknown as PointRouteRequest),
    ).toThrow();
  });
});
