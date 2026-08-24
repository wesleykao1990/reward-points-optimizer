import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { handleRequest, resetIssuedRecommendationIds } from "../src/server.js";

const EFFECTIVE_AT = "2026-08-24T12:00:00+09:00";

const requestBody = (overrides: Record<string, unknown> = {}) => ({
  merchant_id: "merchant.lawson",
  branch_id: "location.lawson.representative",
  amount_jpy: 200,
  tax_exclusive_amount_jpy: 200,
  effective_at: EFFECTIVE_AT,
  owned_instruments: ["synthetic_card"],
  selected_p0_products: ["card.rakuten"],
  stored_value_use: "no",
  facts: [],
  caps: [],
  ...overrides,
});

const activeCalculation = Object.freeze({
  family_id: "card.rakuten",
  label: "楽天カード",
  reward_label: "楽天ポイント",
  reward_points: "2",
  rate_percent: "1",
  calculation_note: "有効なAgent Feedルールで自動計算",
  source_claim_id: "claim.rakuten.active-rate",
  source_url: "https://www.rakuten-card.co.jp/point/",
  checked_at: "2026-08-24T00:00:00+09:00",
  calculation_source: "agent_feed_structured" as const,
});

function dependencies(accepted = true) {
  return {
    activeRewardCalculations: {
      async calculate() {
        return [activeCalculation];
      },
    },
    merchantAcceptance: {
      async listAcceptedFamilies() {
        return accepted ? ["card.rakuten" as const] : [];
      },
    },
  };
}

async function jsonRequest(
  body: unknown,
  dependency?: Parameters<typeof handleRequest>[1],
) {
  const serialized = JSON.stringify(body);
  return handleRequest(
    {
      method: "POST",
      pathname: "/api/recommendations",
      headers: {
        "content-type": "application/json",
        "content-length": String(Buffer.byteLength(serialized, "utf8")),
      },
      body: serialized,
    },
    dependency,
  );
}

function responseJson(response: { readonly body: string }) {
  return JSON.parse(response.body) as {
    version: string;
    selected_p0_products: string[];
    routes: Array<Record<string, unknown>>;
    supplemental_routes: Array<Record<string, unknown>>;
  };
}

describe("unified merchant recommendation journey", () => {
  it("keeps the five-tab award-wallet walkthrough keyboard-addressable", () => {
    const html = readFileSync(
      new URL("../public/index.html", import.meta.url),
      "utf8",
    );
    const navStart = html.indexOf('<nav class="bottom-nav"');
    const navEnd = html.indexOf("</nav>", navStart);
    const nav = html.slice(navStart, navEnd);
    expect(
      [...nav.matchAll(/data-tab-target="([^"]+)"/gu)].map((match) => match[1]),
    ).toEqual(["balance", "spend", "earn", "information", "settings"]);
    for (const tab of ["balance", "spend", "earn", "information", "settings"])
      expect(html).toMatch(
        new RegExp(
          `id="tab-${tab}"[^>]*role="tabpanel"[^>]*aria-labelledby="tab-button-${tab}"`,
          "u",
        ),
      );
    expect(html).toMatch(
      /<section id="tab-balance"[^>]*class="tab-panel is-active"/u,
    );
  });

  it("keeps the lot ledger source-attributed and self-hosted", () => {
    const app = readFileSync(
      new URL("../public/app.js", import.meta.url),
      "utf8",
    );
    expect(app).toContain("walletDemo");
    expect(app).toContain("lot_class");
    expect(app).toContain("days_remaining");
    expect(app).toContain("checked_days_ago");
    expect(app).toContain("confidence");
    expect(app).toContain('const WALLET_STORAGE_KEY = "point-route.wallet.v1"');
    expect(app).not.toContain('postJson("/api/wallet');
    const styles = readFileSync(
      new URL("../public/styles.css", import.meta.url),
      "utf8",
    );
    expect(styles).toContain('url("/assets/fonts/archivo-var.woff2")');
    expect(styles).not.toContain("fonts.googleapis.com");
    for (const filename of ["archivo-var.woff2", "jetbrainsmono-var.woff2"])
      expect(
        existsSync(
          new URL(`../public/assets/fonts/${filename}`, import.meta.url),
        ),
      ).toBe(true);
  });

  it("keeps motion optional and never hides content behind it", () => {
    const styles = readFileSync(
      new URL("../public/styles.css", import.meta.url),
      "utf8",
    );
    const app = readFileSync(
      new URL("../public/app.js", import.meta.url),
      "utf8",
    );
    expect(styles).toContain("--ease-snap");
    expect(app).toContain("reducedMotion");
    const reduced = styles.slice(
      styles.lastIndexOf("@media (prefers-reduced-motion: reduce)"),
    );
    expect(reduced).toContain("animation: none !important");
    expect(reduced).toContain("opacity: 1 !important");
  });

  it("keeps campaigns inside the conversion surface and renders every route node", () => {
    const html = readFileSync(
      new URL("../public/index.html", import.meta.url),
      "utf8",
    );
    const app = readFileSync(
      new URL("../public/app.js", import.meta.url),
      "utf8",
    );
    const styles = readFileSync(
      new URL("../public/styles.css", import.meta.url),
      "utf8",
    );
    expect(html).toContain("ポイントの交換ルート");
    expect(html).toContain("通常・キャンペーン");
    expect(app).not.toContain('text("h2", "キャンペーン経路の試算")');
    expect(app).toContain('campaignMode.textContent = "キャンペーン込み"');
    expect(app).toContain("renderRouteChain(leg.steps");
    expect(app).toContain("renderRouteChain(body.winner.steps");
    expect(app).toContain("routeNodeLogo(reward.asset_id");
    expect(app).toContain("target.conditional_rule_ids");
    expect(app).toContain("relevantRuleIds.has(rule.rule_id)");
    expect(styles).toContain(".route-chain-node");
    expect(styles).toContain(".route-mode-switch");
  });

  it("fails visibly when the active database path is not composed", async () => {
    const response = await jsonRequest(requestBody());
    expect(response.status).toBe(200);
    const body = responseJson(response);
    expect(body.routes).toEqual([
      expect.objectContaining({
        route_id: "selected_product_card.rakuten",
        status: "unavailable",
        issues: ["catalogue_unavailable"],
      }),
    ]);
    expect(JSON.stringify(body)).not.toMatch(
      /nanaco_purchase|synthetic_cardで支払う/u,
    );
  });

  it("uses only accepted, active database rules", async () => {
    resetIssuedRecommendationIds();
    const response = await jsonRequest(requestBody(), dependencies());
    expect(response.status).toBe(200);
    const body = responseJson(response);
    expect(body.version).toBe("unified-recommendations.v2");
    expect(body.routes).toHaveLength(1);
    expect(body.supplemental_routes).toEqual([]);
    expect(body.routes[0]).toMatchObject({
      route_id: "selected_product_card.rakuten",
      label: "楽天カード",
      status: "eligible",
      automatic_application: true,
      calculation_source: "agent_feed_structured",
      recommendation: {
        winner: {
          reward_points: "2",
          reward_rate_percent: "1",
          source_claim_id: "claim.rakuten.active-rate",
        },
      },
    });
    expect(body.routes[0]?.recommendation_id).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(JSON.stringify(body)).not.toContain("サンプル");
    expect(JSON.stringify(body)).not.toContain("nanaco_purchase");
  });

  it("does not calculate a family rejected by merchant acceptance", async () => {
    const body = responseJson(
      await jsonRequest(requestBody(), dependencies(false)),
    );
    expect(body.routes).toEqual([
      expect.objectContaining({
        route_id: "selected_product_card.rakuten",
        status: "no_valid_plan",
      }),
    ]);
    expect(JSON.stringify(body)).not.toContain("source_claim_id");
  });

  it("accepts bounded dynamic merchant and family ids", async () => {
    const body = responseJson(
      await jsonRequest(
        requestBody({
          merchant_id: "merchant.dynamic-shop",
          branch_id: "location.dynamic-shop.representative",
          selected_p0_products: ["card.rakuten"],
        }),
        dependencies(),
      ),
    );
    expect(body.routes[0]).toMatchObject({ status: "eligible" });
  });

  it("rejects duplicate, malformed, and category-incoherent selections", async () => {
    for (const overrides of [
      { selected_p0_products: ["card.rakuten", "card.rakuten"] },
      { selected_p0_products: ["invalid"] },
      {
        owned_instruments: ["synthetic_qr_wallet"],
        selected_p0_products: ["card.rakuten"],
      },
    ]) {
      const response = await jsonRequest(
        requestBody(overrides),
        dependencies(),
      );
      expect(response.status).toBe(400);
    }
  });

  it("binds corrections to a displayed database recommendation", async () => {
    resetIssuedRecommendationIds();
    const route = responseJson(await jsonRequest(requestBody(), dependencies()))
      .routes[0];
    expect(route?.recommendation_id).toMatch(/^sha256:[0-9a-f]{64}$/u);
    const serialized = JSON.stringify({
      category: "wrong_plan",
      note_code: "plan_not_available",
      recommendation_id: route?.recommendation_id,
    });
    const accepted = await handleRequest({
      method: "POST",
      pathname: "/api/recommendations/corrections",
      headers: {
        "content-type": "application/json",
        "content-length": String(Buffer.byteLength(serialized, "utf8")),
      },
      body: serialized,
    });
    expect(accepted.status).toBe(200);
  });
});
