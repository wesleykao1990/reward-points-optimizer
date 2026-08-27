import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AppDependencies } from "../src/server.js";
import { createLocalDemoDependencies, handleRequest } from "../src/server.js";

const purchaseContext = {
  merchant_id: "merchant.lawson",
  branch_id: "location.lawson.representative",
  amount_jpy: 10_000,
  tax_exclusive_amount_jpy: 10_000,
  effective_at: "2026-08-27T12:00:00+09:00",
  owned_instruments: ["synthetic_card"],
  selected_p0_products: ["card.rakuten"],
  stored_value_use: "no",
  facts: [],
  caps: [],
};

const dependencies: AppDependencies = {
  activeRewardCalculations: {
    async calculate() {
      return [
        {
          family_id: "card.rakuten",
          label: "楽天カード",
          reward_label: "楽天ポイント",
          reward_points: "100",
          rate_percent: "1",
          calculation_note: "active deterministic rule",
          source_claim_id: "claim.rakuten.active",
          checked_at: "2026-08-27T00:00:00+09:00",
          calculation_source: "agent_feed_structured" as const,
        },
      ];
    },
  },
  merchantAcceptance: {
    async listAcceptedFamilies() {
      return ["card.rakuten"];
    },
  },
};

async function post(
  pathname: string,
  body: unknown,
  dependency: AppDependencies = dependencies,
) {
  const serialized = JSON.stringify(body);
  const response = await handleRequest(
    {
      method: "POST",
      pathname,
      headers: {
        host: "127.0.0.1",
        "content-type": "application/json",
        "content-length": String(Buffer.byteLength(serialized)),
      },
      body: serialized,
    },
    dependency,
  );
  return {
    response,
    body: JSON.parse(response.body) as Record<string, unknown>,
  };
}

describe("shared RewardCapabilities adapters", () => {
  it("returns the same deterministic winner through normal UI and WebMCP capability paths", async () => {
    const normal = await post("/api/recommendations", purchaseContext);
    const webmcp = await post("/api/capabilities/invoke", {
      tool: "compare_purchase_routes",
      purchase_context: purchaseContext,
      preferences: {},
      arguments: {},
    });

    expect(normal.response.status).toBe(200);
    expect(webmcp.response.status).toBe(200);
    expect(
      (normal.body.comparison as Record<string, unknown>).winner_route_id,
    ).toBe("selected_product_card.rakuten");
    expect(
      (
        (webmcp.body.result as Record<string, unknown>).comparison as Record<
          string,
          unknown
        >
      ).winner_route_id,
    ).toBe((normal.body.comparison as Record<string, unknown>).winner_route_id);
    expect(
      (webmcp.body.state as Record<string, unknown>).activity as unknown[],
    ).toHaveLength(1);
  });

  it("lets the server-only agent runner call the same capabilities and return shared UI state", async () => {
    const result = await post(
      "/api/agent",
      {
        message: "How should I pay?",
        purchase_context: purchaseContext,
        preferences: {},
      },
      {
        ...dependencies,
        rewardsAgentRunner: {
          async run(capabilities) {
            await capabilities.comparePurchaseRoutes();
            capabilities.explainPurchaseRoute();
            return {
              answer: "Use the deterministic winner.",
              state: capabilities.snapshot(),
            };
          },
        },
      },
    );

    expect(result.response.status).toBe(200);
    expect(result.body.answer).toBe("Use the deterministic winner.");
    const state = result.body.state as Record<string, unknown>;
    expect(state.selected_route_id).toBe("selected_product_card.rakuten");
    expect(
      (state.activity as Array<Record<string, unknown>>).map(
        (item) => item.tool,
      ),
    ).toEqual(["compare_purchase_routes", "explain_purchase_route"]);
  });

  it("keeps demo passport data explicitly labeled and rejects unbounded preferences", async () => {
    const passport = await post("/api/capabilities/invoke", {
      tool: "get_rewards_passport_summary",
      preferences: {},
      arguments: {},
    });
    expect(passport.response.status).toBe(200);
    expect(passport.body.result).toMatchObject({ mode: "demo_fixture" });

    const hostile = await post("/api/capabilities/invoke", {
      tool: "set_session_purchase_preferences",
      preferences: {},
      arguments: { max_extra_steps: 1000 },
    });
    expect(hostile.response.status).toBe(400);
    expect(hostile.body).toMatchObject({
      error: { code: "max_extra_steps_invalid" },
    });
  });

  it("uses the current document.modelContext API with abort-based dynamic lifecycle", () => {
    const source = readFileSync(
      new URL("../public/webmcp.js", import.meta.url),
      "utf8",
    );
    expect(source).toContain("document.modelContext");
    expect(source).toContain("modelContext.registerTool");
    expect(source).toContain("new AbortController()");
    expect(source).toContain("controller?.abort()");
    expect(source).not.toContain("navigator.modelContext");
    expect(source).not.toContain("unregisterTool");
    expect(source).not.toContain("run_sql");
    expect(source).not.toContain("execute_rule");
  });

  it("supports an explicitly labeled local demo graph without a database", async () => {
    const result = await post(
      "/api/capabilities/invoke",
      {
        tool: "compare_purchase_routes",
        purchase_context: {
          ...purchaseContext,
          merchant_id: "merchant.synthetic",
          branch_id: "location.synthetic",
        },
        preferences: {},
        arguments: {},
      },
      createLocalDemoDependencies(),
    );

    expect(result.response.status).toBe(200);
    expect(
      (result.body.result as Record<string, unknown>).comparison,
    ).toMatchObject({ winner_route_id: "selected_product_card.rakuten" });
  });

  it("hydrates the local demo's browser catalogue from the same fixture source", async () => {
    const response = await handleRequest(
      {
        method: "GET",
        pathname: "/api/experimental/point-spend/options",
        headers: { host: "127.0.0.1" },
      },
      createLocalDemoDependencies(),
    );
    const body = JSON.parse(response.body) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ data_origin: "bundled_fixture" });
    expect((body.wallet_catalogue as unknown[]).length).toBeGreaterThan(1);
  });
});
