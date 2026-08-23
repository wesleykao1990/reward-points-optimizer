import { describe, expect, it } from "vitest";
import {
  DEFAULT_POINT_VALUATIONS,
  defaultPointValuation,
  type RankingCandidate,
  rankUnifiedRoutes,
} from "../src/recommendation-ranking.js";

function candidate(
  route_id: string,
  score: string,
  units: string,
  asset = `point.${route_id}`,
): RankingCandidate {
  return {
    route_id,
    label: route_id,
    objective_score_jpy: score,
    reward_units: units,
    reward_asset_id: asset,
    reward_label: "ポイント",
    valuation: defaultPointValuation(asset),
    comparison_role: "purchase",
  };
}

describe("unified recommendation ranking", () => {
  it("uses explicit per-point face-value defaults and ranks by JPY score", () => {
    const result = rankUnifiedRoutes([
      candidate("paypay", "3", "3"),
      candidate("rakuten", "6", "6"),
    ]);

    expect(result.winner_route_id).toBe("rakuten");
    expect(result.runner_up_route_id).toBe("paypay");
    expect(result.delta_jpy).toBe("3");
    expect(result.ranked_routes.map((route) => route.route_id)).toEqual([
      "rakuten",
      "paypay",
    ]);
    expect(result.valuation_policy.version).toBe("point-face-value-default.v1");
    expect(result.valuation_policy.assets).toEqual(DEFAULT_POINT_VALUATIONS);
  });

  it("derives a conservative break-even threshold from native reward units", () => {
    const result = rankUnifiedRoutes([
      candidate("direct", "3", "3", "point.direct"),
      candidate("alternative", "2", "2", "point.alternative"),
    ]);

    expect(result.break_even).toMatchObject({
      asset_id: "point.alternative",
      current_jpy_per_unit: "1",
      break_even_jpy_per_unit: "1.5",
      winner_at_or_below_threshold_route_id: "direct",
      winner_above_threshold_route_id: "alternative",
    });
  });

  it("never ranks a funding route as a merchant purchase", () => {
    const result = rankUnifiedRoutes([
      candidate("purchase", "1", "1"),
      {
        ...candidate("funding", "25", "25"),
        comparison_role: "funding",
      },
    ]);

    expect(result.winner_route_id).toBe("purchase");
    expect(result.ranked_routes.map((route) => route.route_id)).toEqual([
      "purchase",
    ]);
  });
});
