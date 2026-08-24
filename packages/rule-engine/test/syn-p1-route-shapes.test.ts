import { promises as fs } from "node:fs";

import { beforeAll, describe, expect, it } from "vitest";

import {
  type AssetValuation,
  buildValuationProfile,
  optimizePointRoute,
  type PointRouteBalance,
  type PointRouteEdge,
  type PointRouteRequest,
} from "../src/index.js";

/**
 * Route shapes the P0 research wave does not yet contain.
 *
 * Real evidence currently carries no transfer fee, no per-day or per-lifetime
 * cap, and no restricted reward class, so those kernel paths would otherwise
 * only ever run against assertions written beside them.  This fixture states
 * the shapes explicitly and is never evidence, coverage, or a published rule.
 */

interface Fixture {
  readonly fixture_id: string;
  readonly evidence_status: string;
  readonly balances: readonly PointRouteBalance[];
  readonly valuation_entries: readonly AssetValuation[];
  readonly edges: readonly PointRouteEdge[];
}

let fixture: Fixture;

function request(
  overrides: Partial<PointRouteRequest> = {},
): PointRouteRequest {
  return {
    effective_at: "2026-08-23T00:00:00Z",
    objective: "maximize_value",
    target_asset_id: "asset.mile.syn-air",
    balances: fixture.balances,
    edges: fixture.edges,
    confirmed_rule_ids: [],
    period_source_used_by_rule: {
      "syn-p1.transfer.hub.air": "0",
      "syn-p1.transfer.site.campaign": "0",
    },
    max_steps: 4,
    max_legs: 4,
    valuation: buildValuationProfile("syn-p1", fixture.valuation_entries),
    ...overrides,
  };
}

describe("SYN-P1 route shapes", () => {
  beforeAll(async () => {
    fixture = JSON.parse(
      await fs.readFile(
        new URL(
          "../../../fixtures/synthetic/syn-p1-route-shapes.v0.1.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as Fixture;
  });

  it("is declared synthetic and never evidence", () => {
    expect(fixture.fixture_id).toBe("SYN-P1-ROUTE-SHAPES");
    expect(fixture.evidence_status).toBe("synthetic_never_evidence");
  });

  it("carries the fee back through the capacity calculation", () => {
    const result = optimizePointRoute(request());
    const leg = result.winner?.legs[0];
    // The capped hop admits 20,000, the ratio ahead of it is 1:1, and the
    // first hop charges 150 to move anything — so 20,150 is the most worth
    // sending, not the 20,000 the cap alone would suggest.
    expect(leg?.allocated_source_amount).toBe("20150");
    expect(leg?.hops[0]?.source_amount).toBe("20000");
    expect(leg?.hops[0]?.fee_source_units).toBe("150");
    expect(leg?.hops[0]?.stranded_source_amount).toBe("0");
    expect(leg?.hops[1]?.source_amount).toBe("20000");
    expect(leg?.hops[1]?.destination_amount).toBe("14000");
  });

  it("honours a per-day cap and spends the rest on the direct route", () => {
    const result = optimizePointRoute(request());
    const winner = result.winner;
    expect(winner?.legs).toHaveLength(2);
    expect(winner?.legs[0]?.hops[1]?.cap_period).toBe("day");
    expect(winner?.legs[0]?.hops[1]?.cap_remaining_before).toBe("20000");
    expect(winner?.legs[0]?.hops[1]?.cap_remaining_after).toBe("0");
    expect(winner?.legs[0]?.binding_constraint).toBe("period_cap");
    // 30,000 less the 20,150 the capped route absorbs leaves 9,850 direct.
    expect(winner?.legs[1]?.rule_ids).toEqual(["syn-p1.transfer.site.air"]);
    expect(winner?.legs[1]?.target_amount).toBe("2955");
    expect(winner?.target_amount).toBe("16955");
    expect(winner?.value?.expected_jpy).toBe("33910");
  });

  it("accumulates the lead time of every hop on the route", () => {
    const result = optimizePointRoute(request());
    const leg = result.winner?.legs[0];
    expect(leg?.processing_time_days_min).toBe(3);
    expect(leg?.processing_time_days_max).toBe(10);
    // The capped hop is initiated only once the first has posted.
    expect(leg?.hops[0]?.initiated_on).toBe("2026-08-23");
    expect(leg?.hops[1]?.initiated_on).toBe("2026-08-26");
    expect(leg?.irreversible_step_count).toBe(2);
  });

  it("prices a restricted uplift below the ordinary class", () => {
    const result = optimizePointRoute(request({ target_asset_id: null }));
    const campaign = result.plans.find(
      (plan) => plan.target_asset.asset_id === "asset.point.syn-campaign",
    );
    // A lifetime cap of 10,000 source units at 2:3 yields 15,000 units, and
    // the short-dated class is worth 0.7 rather than 1.
    expect(campaign?.target_asset.reward_class).toBe("limited_period");
    expect(campaign?.legs[0]?.hops[0]?.cap_period).toBe("lifetime");
    expect(campaign?.target_amount).toBe("15000");
    expect(campaign?.value?.expected_jpy).toBe("10500");
    // 15,000 uplift units are nominally more than 16,955 miles are in count,
    // but valuing each class on its own terms puts the miles ahead.
    expect(result.winner?.target_asset.asset_id).toBe("asset.mile.syn-air");
  });

  it("refuses a capped rule when prior period usage is unknown", () => {
    const result = optimizePointRoute(
      request({ period_source_used_by_rule: {} }),
    );
    expect(result.skipped).toContainEqual({
      rule_id: "syn-p1.transfer.hub.air",
      reason_code: "transfer_period_usage_unknown",
    });
    expect(result.winner?.legs[0]?.rule_ids).toEqual([
      "syn-p1.transfer.site.air",
    ]);
  });

  it("is deterministic across runs", () => {
    expect(optimizePointRoute(request()).result_hash).toBe(
      optimizePointRoute(request()).result_hash,
    );
  });
});
