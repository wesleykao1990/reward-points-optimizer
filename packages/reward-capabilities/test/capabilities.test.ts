import { describe, expect, it } from "vitest";
import {
  RewardCapabilities,
  type PurchaseContext,
  type RewardCalculationPort,
} from "../src/index.js";

const context: PurchaseContext = {
  merchant_id: "merchant.synthetic",
  branch_id: "location.synthetic",
  amount_jpy: 10_000,
  tax_exclusive_amount_jpy: 10_000,
  nanaco_balance_jpy: 10_000,
  nanaco_credit_charge_balance_jpy: 0,
  charge_amount_jpy: 5_000,
  seven_card_plus_owned: false,
  nanaco_credit_charge_preregistered: false,
  effective_at: "2026-08-27T12:00:00+09:00",
  owned_instruments: ["synthetic_card"],
  selected_p0_products: ["card.d", "card.rakuten"],
  stored_value_use: "unknown",
  facts: [],
  caps: [],
};

describe("RewardCapabilities", () => {
  it("routes comparison through the injected deterministic calculator", async () => {
    const calls: unknown[] = [];
    const calculator: RewardCalculationPort = {
      async comparePurchaseRoutes(input, preferences) {
        calls.push({ input, preferences });
        return {
          routes: [
            {
              route_id: "selected_product_card.d",
              label: "dカード",
              objective_score_jpy: "100",
              reward_asset_id: "point.d",
            },
          ],
          supplemental_routes: [],
          comparison: {
            winner_route_id: "selected_product_card.d",
          },
          fact_influence_shared: null,
          questions: [],
        };
      },
    };
    const capabilities = new RewardCapabilities({
      calculator,
      purchaseContext: context,
      now: () => new Date("2026-08-27T03:00:00.000Z"),
    });

    capabilities.setSessionPurchasePreferences({
      preferred_reward_class: "airline_miles",
      max_extra_steps: 1,
    });
    const comparison = await capabilities.comparePurchaseRoutes();
    const explanation = capabilities.explainPurchaseRoute();

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      input: { amount_jpy: 10_000 },
      preferences: {
        preferred_reward_class: "airline_miles",
        max_extra_steps: 1,
      },
    });
    expect(comparison.comparison.winner_route_id).toBe(
      "selected_product_card.d",
    );
    expect(explanation.deterministic_summary.reward_asset_id).toBe("point.d");
    expect(capabilities.snapshot().activity.map((item) => item.tool)).toEqual([
      "set_session_purchase_preferences",
      "compare_purchase_routes",
      "explain_purchase_route",
    ]);
  });

  it("returns only demo lots inside the requested expiry window", () => {
    const capabilities = new RewardCapabilities({
      calculator: {
        async comparePurchaseRoutes() {
          throw new Error("not used");
        },
      },
      now: () => new Date("2026-09-15T00:00:00.000Z"),
    });

    expect(capabilities.getExpiringRewards(30)).toMatchObject([
      { program_id: "point.d", amount: 850 },
    ]);
    expect(capabilities.getRewardsPassportSummary().mode).toBe("demo_fixture");
  });
});
