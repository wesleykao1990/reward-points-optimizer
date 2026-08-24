import { describe, expect, it } from "vitest";
import { parseUnifiedRecommendation } from "../src/contracts.js";
import {
  type PaymentStackBrowserInput,
  parsePaymentStackBrowserInput,
} from "../src/payment-stack-recommendation.js";
import { p0ProductFamilyDefinition } from "../src/point-spend-recommendation.js";
import { type AppDependencies, handleRequest } from "../src/server.js";

const input = (overrides: Record<string, unknown> = {}) => ({
  merchant_id: "merchant.synthetic",
  branch_id: "location.synthetic",
  amount_jpy: 200,
  tax_exclusive_amount_jpy: 200,
  effective_at: "2026-08-23T12:00:00+09:00",
  owned_instruments: ["synthetic_card"],
  selected_p0_products: ["card.dynamic"],
  stored_value_use: "no",
  facts: [],
  caps: [],
  ...overrides,
});

interface UnifiedTestRoute {
  readonly route_id: string;
  readonly status: string;
  readonly issues: readonly string[];
  readonly recommendation?: unknown;
}

interface UnifiedTestBody {
  readonly routes: readonly UnifiedTestRoute[];
  readonly supplemental_routes: readonly UnifiedTestRoute[];
  readonly [key: string]: unknown;
}

async function request(
  body: unknown,
  dependencies?: AppDependencies,
): Promise<UnifiedTestBody> {
  const response = await handleRequest(
    {
      method: "POST",
      pathname: "/api/recommendations",
      headers: { "content-type": "application/json", host: "127.0.0.1" },
      body: JSON.stringify(body),
    },
    dependencies,
  );
  expect(response.status).toBe(200);
  return JSON.parse(response.body) as UnifiedTestBody;
}

const activeCalculation = {
  family_id: "card.dynamic",
  label: "カード（dynamic）",
  reward_label: "ポイント",
  reward_points: "3",
  rate_percent: "1.5",
  calculation_note: "active DB rule",
  source_claim_id: "claim.dynamic",
  checked_at: "2026-08-23T00:00:00+09:00",
  calculation_source: "agent_feed_structured" as const,
};

describe("unified active database route graph", () => {
  it("rejects impossible calendar dates in payment-stack input", () => {
    const valid: PaymentStackBrowserInput = {
      merchant_id: "merchant.synthetic",
      amount_jpy: 200,
      owned_family_ids: [],
      effective_at: "2026-08-23T12:00:00+09:00",
      confirmed_option_ids: [],
    };
    expect(() =>
      parsePaymentStackBrowserInput({
        ...valid,
        effective_at: "2026-09-31T12:00:00+09:00",
      }),
    ).toThrow("payment_stack_request_invalid");
  });

  it("admits bounded dynamic merchant and product-family ids", () => {
    const parsed = parseUnifiedRecommendation(
      input({
        merchant_id: "merchant.dynamic-shop",
        branch_id: "location.dynamic-shop.representative",
        selected_p0_products: ["card.dynamic-product"],
      }),
    );
    expect(parsed.merchant_id).toBe("merchant.dynamic-shop");
    expect(parsed.selected_p0_products).toEqual(["card.dynamic-product"]);
    expect(p0ProductFamilyDefinition("storedvalue.dynamic-balance")).toEqual(
      expect.objectContaining({ kind: "stored_value" }),
    );
  });

  it("never resurrects fixture or Nanaco economics when active DB is missing", async () => {
    const body = await request(input());
    expect(body.routes.map((route) => route.route_id)).toEqual([
      "selected_product_card.dynamic",
    ]);
    expect(body.routes[0]).toMatchObject({
      status: "unavailable",
      issues: ["route_unavailable"],
    });
    expect(JSON.stringify(body)).not.toContain("nanaco_purchase");
    expect(JSON.stringify(body)).not.toContain("サンプル");
    expect(body.routes[0].recommendation).toBeUndefined();
  });

  it("fails visibly when neither active rules nor the database graph can answer", async () => {
    const body = await request(input(), {
      activeRewardCalculations: {
        async calculate() {
          return [];
        },
      },
    });
    expect(body.routes[0]).toMatchObject({
      status: "unavailable",
      issues: ["route_unavailable"],
    });
  });

  it("filters active calculations by direct merchant acceptance", async () => {
    const dependencies: AppDependencies = {
      activeRewardCalculations: {
        async calculate() {
          return [activeCalculation];
        },
      },
      merchantAcceptance: {
        async listAcceptedFamilies() {
          return [];
        },
      },
    };
    const body = await request(
      input({
        merchant_id: "merchant.dynamic-shop",
        branch_id: "location.dynamic-shop.representative",
      }),
      dependencies,
    );
    expect(body.routes[0]).toMatchObject({ status: "no_valid_plan" });
    expect(JSON.stringify(body)).not.toContain("source_claim_id");
  });

  it("uses an accepted active route without composing a Nanaco route", async () => {
    const body = await request(input(), {
      activeRewardCalculations: {
        async calculate() {
          return [activeCalculation];
        },
      },
      merchantAcceptance: {
        async listAcceptedFamilies() {
          return ["card.dynamic"];
        },
      },
    });
    expect(body.routes.map((route) => route.route_id)).toEqual([
      "selected_product_card.dynamic",
    ]);
    expect(body.supplemental_routes).toEqual([]);
    expect(
      JSON.stringify([...body.routes, ...body.supplemental_routes]),
    ).not.toContain("nanaco");
  });
});
