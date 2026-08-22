import { readFileSync } from "node:fs";
import { getNanacoEconomicPilotRule } from "@jro/provisional-rules";
import { describe, expect, it } from "vitest";
import type { ExperimentalRecommendationInput } from "../src/contracts.js";
import {
  FACT_INFLUENCE_VERIFIED_APPLIED_PARENT_CLAIMS,
  getDefaultFactInfluenceGraphPort,
} from "../src/fact-influence-graph.js";
import {
  NANACO_CREDIT_CHARGE_PLAN_ID,
  NANACO_CREDIT_CHARGE_PUBLIC_ASSUMPTIONS,
  NANACO_CREDIT_CHARGE_PUBLIC_BLOCKERS,
  NanacoCreditChargeRecommendationError,
} from "../src/nanaco-credit-charge-recommendation.js";
import {
  createNanacoExperimentalRecommendationPort,
  NANACO_EXPERIMENTAL_ACCEPTANCE_PUBLICATION_ID,
  NANACO_EXPERIMENTAL_ACCEPTANCE_RULE_ID,
  NANACO_EXPERIMENTAL_PUBLICATION_ID,
  type NanacoExperimentalRuleSource,
} from "../src/real-experimental-recommendation.js";
import { handleRequest, resetIssuedRecommendationIds } from "../src/server.js";

const EFFECTIVE_AT = "2026-08-22T00:00:00+09:00";
const PURCHASE_ID = "candidate_p0_nanaco_shopping_earning_20260821_v0_1";
const CREDIT_ID = "candidate_p0_nanaco_sevencard_credit_charge_20260822_v0_1";

const requestBody = (overrides: Record<string, unknown> = {}) => ({
  merchant_id: "merchant.synthetic",
  branch_id: "location.synthetic",
  amount_jpy: 200,
  tax_exclusive_amount_jpy: 200,
  nanaco_balance_jpy: 10_000,
  nanaco_credit_charge_balance_jpy: 0,
  charge_amount_jpy: 5_000,
  seven_card_plus_owned: true,
  nanaco_credit_charge_preregistered: true,
  effective_at: EFFECTIVE_AT,
  owned_instruments: ["synthetic_card"],
  stored_value_use: "no",
  facts: [],
  caps: [],
  ...overrides,
});

const jsonRequest = async (
  body: unknown,
  dependency: Parameters<typeof handleRequest>[1],
) => {
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
};

const activeCard = (
  publication_id: string,
  valid_from = "2026-08-20T00:00:00+09:00",
) => ({
  publication_id,
  kind: "reward_rate" as const,
  title: "先行公開の還元情報",
  summary: "実験的な情報表示です。",
  display_status: "experimental_unverified" as const,
  confidence: "medium" as const,
  source_label: "ホスト確認済み情報",
  checked_at: EFFECTIVE_AT,
  valid_from,
  valid_to: null,
});

const catalogue = (cards: readonly ReturnType<typeof activeCard>[]) => ({
  async list() {
    return { status: "ready" as const, updated_at: EFFECTIVE_AT, rules: cards };
  },
  async reportCorrection() {
    return { ok: true as const };
  },
});

function purchaseSource(): NanacoExperimentalRuleSource {
  return {
    async current() {
      return {
        reward_candidate_id: NANACO_EXPERIMENTAL_PUBLICATION_ID,
        reward_rule: getNanacoEconomicPilotRule(),
        acceptance_candidate_id: NANACO_EXPERIMENTAL_ACCEPTANCE_PUBLICATION_ID,
        acceptance_rule_id: NANACO_EXPERIMENTAL_ACCEPTANCE_RULE_ID,
      };
    },
  };
}

const creditPlan = {
  plan_id: NANACO_CREDIT_CHARGE_PLAN_ID,
  eligible: true,
  reward_points: "25",
  objective_score_jpy: null,
  operation_count: 1,
  conditions: [],
};

function creditPort() {
  return {
    async evaluate(input: {
      readonly charge_amount_jpy: number;
      readonly nanaco_balance_jpy: number;
      readonly seven_card_plus_owned: boolean;
      readonly nanaco_credit_charge_preregistered: boolean;
      readonly selection_id: string;
      readonly effective_at: string;
    }) {
      if (input.charge_amount_jpy < 5_000)
        throw new NanacoCreditChargeRecommendationError("charge_below_minimum");
      if ((input.charge_amount_jpy - 5_000) % 1_000 !== 0)
        throw new NanacoCreditChargeRecommendationError("charge_not_increment");
      if (!input.seven_card_plus_owned)
        throw new NanacoCreditChargeRecommendationError("ownership_required");
      if (!input.nanaco_credit_charge_preregistered)
        throw new NanacoCreditChargeRecommendationError(
          "preregistration_required",
        );
      const rewardPoints = String(Math.floor(input.charge_amount_jpy / 200));
      const plan = { ...creditPlan, reward_points: rewardPoints };
      return {
        version:
          "real-experimental-nanaco-credit-charge-recommendation.v1" as const,
        request_id: `experimental_nanaco_credit_charge_${"a".repeat(64)}`,
        mode: "experimental_real_data" as const,
        verification_status: "experimental_unverified" as const,
        outcome: "definite" as const,
        selection_id: input.selection_id,
        payment_method: "seven_card_plus" as const,
        destination: "nanaco" as const,
        charge_amount_jpy: input.charge_amount_jpy,
        nanaco_balance_before_jpy: input.nanaco_balance_jpy,
        nanaco_balance_after_jpy:
          input.nanaco_balance_jpy + input.charge_amount_jpy,
        effective_at: input.effective_at,
        winner_plan_id: NANACO_CREDIT_CHARGE_PLAN_ID,
        winner: plan,
        plans: [plan],
        assumptions: NANACO_CREDIT_CHARGE_PUBLIC_ASSUMPTIONS,
        blockers: NANACO_CREDIT_CHARGE_PUBLIC_BLOCKERS,
      };
    },
  };
}

function dependencies(
  graph = getDefaultFactInfluenceGraphPort(),
  cards: readonly ReturnType<typeof activeCard>[] = [
    activeCard(PURCHASE_ID),
    activeCard(CREDIT_ID),
  ],
) {
  return {
    experimentalCatalogue: catalogue(cards),
    experimentalRecommendation: createNanacoExperimentalRecommendationPort(
      purchaseSource(),
    ),
    experimentalNanacoCreditChargeRecommendation: creditPort(),
    factInfluenceGraph: graph,
  };
}

function responseJson(response: { readonly body: string }) {
  return JSON.parse(response.body) as {
    version: string;
    selected_p0_products: string[];
    routes: Array<Record<string, unknown>>;
  };
}

describe("unified merchant recommendation journey", () => {
  it("keeps the five-tab mobile walkthrough keyboard-addressable", () => {
    const html = readFileSync(
      new URL("../public/index.html", import.meta.url),
      "utf8",
    );
    const navStart = html.indexOf('<nav class="bottom-nav"');
    const navEnd = html.indexOf("</nav>", navStart);
    const nav = html.slice(navStart, navEnd);
    expect(
      [...nav.matchAll(/data-tab-target="([^"]+)"/gu)].map((match) => match[1]),
    ).toEqual(["home", "wallet", "history", "information", "settings"]);
    for (const tab of ["home", "wallet", "history", "information", "settings"])
      expect(html).toMatch(
        new RegExp(
          `id="tab-${tab}"[^>]*role="tabpanel"[^>]*aria-labelledby="tab-button-${tab}"`,
          "u",
        ),
      );
    const app = readFileSync(
      new URL("../public/app.js", import.meta.url),
      "utf8",
    );
    expect(app).toContain(
      'const tabOrder = ["home", "wallet", "history", "information", "settings"]',
    );
    const styles = readFileSync(
      new URL("../public/styles.css", import.meta.url),
      "utf8",
    );
    expect(styles).toContain("@media (max-width: 380px)");
    expect(styles).toContain(".route-input-grid");
    expect(html).not.toMatch(
      /id="(?:seven-card-owned|credit-preregistered)"[^>]*checked/iu,
    );
  });

  it("does not assume Nanaco ownership or preregistration when omitted", async () => {
    const body = requestBody();
    delete (body as Record<string, unknown>).seven_card_plus_owned;
    delete (body as Record<string, unknown>).nanaco_credit_charge_preregistered;
    const routes = responseJson(await jsonRequest(body, dependencies())).routes;
    expect(
      routes.find((route) => route.route_id === "synthetic"),
    ).toMatchObject({ status: "eligible" });
    expect(
      routes.find((route) => route.route_id === "nanaco_purchase"),
    ).toMatchObject({ status: "eligible" });
    expect(
      routes.find((route) => route.route_id === "nanaco_credit_charge"),
    ).toMatchObject({
      status: "no_valid_plan",
      issues: ["route_input_invalid"],
    });
  });

  it("rejects forged host-owned fields while accepting only bounded route state", async () => {
    const response = await jsonRequest(
      { ...requestBody(), applied_claim_ids: ["forged"] },
      dependencies(),
    );
    expect(response.status).toBe(400);
    expect(response.body).not.toContain("forged");
  });

  it("returns synthetic and Nanaco routes as calculations", async () => {
    resetIssuedRecommendationIds();
    const response = await jsonRequest(requestBody(), dependencies());
    expect(response.status).toBe(200);
    const body = responseJson(response);
    expect(body.version).toBe("unified-recommendations.v2");
    expect(body.selected_p0_products).toEqual([]);
    expect(body.routes.map((route) => route.route_id)).toEqual([
      "synthetic",
      "nanaco_purchase",
      "nanaco_credit_charge",
    ]);
    expect(body.routes.map((route) => route.kind)).toEqual([
      "calculation",
      "calculation",
      "calculation",
    ]);
    expect(body.routes.map((route) => route.status)).toEqual([
      "eligible",
      "eligible",
      "eligible",
    ]);
    expect(
      body.routes.every((route) => route.validity_state === "active"),
    ).toBe(true);
    expect(response.body).not.toMatch(
      /https?:\/\/|evidence_ids|source_ids|parent_claim_id|candidate_hash|definition_hash/iu,
    );
  });

  it("uses selected product rates in the Seven-Eleven calculation", async () => {
    const body = responseJson(
      await jsonRequest(
        requestBody({
          merchant_id: "merchant.seveneleven",
          branch_id: "location.seveneleven.representative",
          selected_p0_products: ["card.rakuten"],
        }),
        dependencies(),
      ),
    );
    expect(body.routes.map((route) => route.route_id)).toEqual([
      "selected_product_card.rakuten",
      "nanaco_purchase",
      "nanaco_credit_charge",
    ]);
    expect(body.routes[0]).toMatchObject({
      kind: "calculation",
      status: "eligible",
      recommendation: {
        winner: {
          display_name: "楽天カードで支払う",
          reward_points: "2",
          reward_label: "楽天ポイント",
          reward_rate_percent: "1",
        },
      },
    });
    expect(JSON.stringify(body.routes)).not.toContain("サンプル");
  });

  it("does not add Seven-Eleven or Nanaco routes to general shopping", async () => {
    const body = responseJson(
      await jsonRequest(
        requestBody({ selected_p0_products: ["card.rakuten"] }),
        dependencies(),
      ),
    );
    expect(body.routes.map((route) => route.route_id)).toEqual([
      "selected_product_card.rakuten",
    ]);
    expect(body.routes[0]).toMatchObject({
      label: "通常のお買い物・楽天カード",
      kind: "calculation",
      status: "eligible",
      recommendation: {
        winner: { reward_points: "2", reward_rate_percent: "1" },
      },
    });
  });

  it("binds exact card, mobile-pay, and point selections to calculated routes", async () => {
    resetIssuedRecommendationIds();
    const selected = responseJson(
      await jsonRequest(
        requestBody({
          owned_instruments: ["synthetic_card", "synthetic_qr_wallet"],
          selected_p0_products: [
            "wallet.paypay",
            "point.rakuten",
            "card.rakuten",
          ],
        }),
        dependencies(),
      ),
    );
    expect(selected.selected_p0_products).toEqual([
      "card.rakuten",
      "point.rakuten",
      "wallet.paypay",
    ]);
    const firstId = selected.routes.find(
      (route) => route.route_id === "selected_product_card.rakuten",
    )?.recommendation_id;
    const changed = responseJson(
      await jsonRequest(
        requestBody({
          selected_p0_products: ["card.view"],
        }),
        dependencies(),
      ),
    );
    expect(firstId).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(
      changed.routes.find(
        (route) => route.route_id === "selected_product_card.view",
      )?.recommendation_id,
    ).not.toBe(firstId);
  });

  it("rejects unknown, duplicate, and category-incoherent P0 product selections", async () => {
    for (const overrides of [
      { selected_p0_products: ["card.unknown"] },
      { selected_p0_products: ["card.rakuten", "card.rakuten"] },
      {
        owned_instruments: ["synthetic_qr_wallet"],
        selected_p0_products: ["card.rakuten", "wallet.paypay"],
      },
      {
        owned_instruments: ["synthetic_card", "synthetic_qr_wallet"],
        selected_p0_products: ["card.rakuten"],
      },
    ]) {
      const response = await jsonRequest(
        requestBody(overrides),
        dependencies(),
      );
      expect(response.status).toBe(400);
      expect(response.body).not.toContain("card.unknown");
    }
  });

  it("binds the synthetic correction ID to unified Nanaco and effective inputs", async () => {
    resetIssuedRecommendationIds();
    const first = responseJson(
      await jsonRequest(requestBody(), dependencies()),
    ).routes.find((route) => route.route_id === "synthetic");
    const second = responseJson(
      await jsonRequest(
        requestBody({
          nanaco_balance_jpy: 9_999,
          effective_at: "2026-08-22T00:00:01+09:00",
        }),
        dependencies(),
      ),
    ).routes.find((route) => route.route_id === "synthetic");
    expect(first?.recommendation_id).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(second?.recommendation_id).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(first?.recommendation_id).not.toBe(second?.recommendation_id);
    expect(
      (first?.recommendation as { request_id?: string } | undefined)
        ?.request_id,
    ).not.toBe(
      (second?.recommendation as { request_id?: string } | undefined)
        ?.request_id,
    );
  });

  it("projects hostile experimental text and opaque IDs without leaking internals", async () => {
    const base = dependencies();
    const hostile = {
      async evaluate(input: ExperimentalRecommendationInput) {
        const valid = await base.experimentalRecommendation.evaluate(input);
        const marker = "rule_id=hostile-evidence-marker";
        const plans = valid.plans.map((plan) => ({
          ...plan,
          conditions: [marker],
        }));
        return {
          ...valid,
          request_id: `claim.secret.${marker}`,
          assumptions: [marker],
          blockers: ["predicate_awards_points_per_amount"],
          plans,
          winner: valid.winner
            ? { ...valid.winner, conditions: [marker] }
            : null,
        };
      },
    };
    const routes = responseJson(
      await jsonRequest(requestBody(), {
        ...base,
        experimentalRecommendation: hostile,
      }),
    ).routes;
    const purchase = routes.find(
      (route) => route.route_id === "nanaco_purchase",
    );
    expect(purchase).toMatchObject({ status: "eligible" });
    expect(JSON.stringify(purchase)).not.toContain("hostile-evidence-marker");
    expect(JSON.stringify(purchase)).not.toContain(
      "predicate_awards_points_per_amount",
    );
    expect(
      (purchase?.recommendation as { request_id?: string } | undefined)
        ?.request_id,
    ).toBe("experimental_nanaco_seveneleven");
    expect(
      (
        purchase?.recommendation as
          | { assumptions?: readonly string[] }
          | undefined
      )?.assumptions,
    ).toEqual(expect.arrayContaining([expect.stringContaining("先行実験")]));
  });

  it("degrades only the affected route for forged fields or incoherent plans", async () => {
    const base = dependencies();
    const malformed = {
      async evaluate(input: ExperimentalRecommendationInput) {
        const valid = await base.experimentalRecommendation.evaluate(input);
        return {
          ...valid,
          evidence_ids: ["evidence-secret"],
        } as typeof valid & { evidence_ids: string[] };
      },
    };
    const malformedRoutes = responseJson(
      await jsonRequest(requestBody(), {
        ...base,
        experimentalRecommendation: malformed,
      }),
    ).routes;
    expect(
      malformedRoutes.find((route) => route.route_id === "nanaco_purchase"),
    ).toMatchObject({
      status: "unavailable",
      issues: ["recommendation_malformed"],
    });
    expect(
      malformedRoutes.find(
        (route) => route.route_id === "nanaco_credit_charge",
      ),
    ).toMatchObject({ status: "eligible" });

    const incoherent = {
      async evaluate(input: ExperimentalRecommendationInput) {
        const valid = await base.experimentalRecommendation.evaluate(input);
        const plan = valid.plans[0];
        if (!plan) throw new Error("test_plan_missing");
        const extraPlan = {
          ...plan,
          plan_id:
            plan.plan_id === "plan_direct_0000000000000001"
              ? "plan_direct_0000000000000002"
              : "plan_direct_0000000000000001",
          eligible: false,
        };
        return { ...valid, plans: [...valid.plans, extraPlan] };
      },
    };
    const incoherentRoutes = responseJson(
      await jsonRequest(requestBody(), {
        ...base,
        experimentalRecommendation: incoherent,
      }),
    ).routes;
    expect(
      incoherentRoutes.find((route) => route.route_id === "nanaco_purchase"),
    ).toMatchObject({
      status: "unavailable",
      issues: ["recommendation_malformed"],
    });
    expect(
      incoherentRoutes.find(
        (route) => route.route_id === "nanaco_credit_charge",
      ),
    ).toMatchObject({ status: "eligible" });
  });

  it("keeps the purchase neighbor when the credit-charge input is invalid", async () => {
    const response = await jsonRequest(
      requestBody({ charge_amount_jpy: 31_000 }),
      dependencies(),
    );
    expect(response.status).toBe(200);
    const routes = responseJson(response).routes;
    expect(
      routes.find((route) => route.route_id === "nanaco_purchase"),
    ).toMatchObject({
      status: "eligible",
    });
    expect(
      routes.find((route) => route.route_id === "nanaco_credit_charge"),
    ).toMatchObject({
      status: "no_valid_plan",
      issues: ["route_input_invalid"],
    });
  });

  it("keeps numeric results visible during graph or binding outages", async () => {
    const graphUnavailable = {
      load: async () => {
        throw new Error("graph temporarily unavailable");
      },
    };
    const degraded = responseJson(
      await jsonRequest(requestBody(), dependencies(graphUnavailable)),
    ).routes;
    expect(
      degraded.find((route) => route.route_id === "nanaco_purchase"),
    ).toMatchObject({
      status: "eligible",
      issues: expect.arrayContaining(["facts_unavailable"]),
    });

    const graph = await getDefaultFactInfluenceGraphPort().load(EFFECTIVE_AT);
    const missingBindingGraph = {
      load: async () => ({
        ...graph,
        nodes: graph.nodes.map((node) =>
          node.raw.parent_claim_id ===
          FACT_INFLUENCE_VERIFIED_APPLIED_PARENT_CLAIMS.nanaco_purchase
            ? {
                ...node,
                raw: {
                  ...node.raw,
                  parent_claim_id: "claim.point.nanaco.missing",
                },
              }
            : node,
        ),
      }),
    };
    const blocked = responseJson(
      await jsonRequest(requestBody(), dependencies(missingBindingGraph)),
    ).routes;
    expect(
      blocked.find((route) => route.route_id === "nanaco_purchase"),
    ).toMatchObject({
      status: "eligible",
      issues: expect.arrayContaining(["fact_binding_required"]),
    });
    expect(
      blocked.find((route) => route.route_id === "nanaco_credit_charge"),
    ).toMatchObject({
      status: "eligible",
    });
  });

  it("projects scheduled, expired, and unknown campaign states without inventing dates", async () => {
    const scheduled = activeCard(PURCHASE_ID, "2026-08-23T00:00:00+09:00");
    const expired = {
      ...activeCard(CREDIT_ID, "2026-08-18T00:00:00+09:00"),
      valid_to: "2026-08-21T00:00:00+09:00",
    };
    const routes = responseJson(
      await jsonRequest(
        requestBody(),
        dependencies(getDefaultFactInfluenceGraphPort(), [scheduled, expired]),
      ),
    ).routes;
    expect(
      routes.find((route) => route.route_id === "nanaco_purchase"),
    ).toMatchObject({
      status: "blocked",
      validity_state: "scheduled",
      issues: expect.arrayContaining(["rule_not_current"]),
    });
    expect(
      routes.find((route) => route.route_id === "nanaco_credit_charge"),
    ).toMatchObject({
      status: "blocked",
      validity_state: "expired",
      issues: expect.arrayContaining(["rule_not_current"]),
    });

    const unknown = responseJson(
      await jsonRequest(
        requestBody(),
        dependencies(getDefaultFactInfluenceGraphPort(), [
          activeCard(CREDIT_ID),
        ]),
      ),
    ).routes;
    expect(
      unknown.find((route) => route.route_id === "nanaco_purchase"),
    ).toMatchObject({
      validity_state: "unknown",
      issues: expect.arrayContaining(["catalogue_unavailable"]),
    });
  });

  it("accepts only displayed host-issued recommendation IDs for corrections", async () => {
    resetIssuedRecommendationIds();
    const response = await jsonRequest(requestBody(), dependencies());
    const purchase = responseJson(response).routes.find(
      (route) => route.route_id === "nanaco_purchase",
    );
    expect(purchase?.recommendation_id).toMatch(/^sha256:[0-9a-f]{64}$/u);
    const recommendation_id = purchase?.recommendation_id;
    const serialized = JSON.stringify({
      category: "wrong_plan",
      note_code: "plan_not_available",
      recommendation_id,
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
    expect(JSON.parse(accepted.body).correction.status).toBe("not_submitted");

    const forged = JSON.stringify({
      category: "wrong_plan",
      note_code: "plan_not_available",
      recommendation_id: `sha256:${"f".repeat(64)}`,
    });
    const rejected = await handleRequest({
      method: "POST",
      pathname: "/api/recommendations/corrections",
      headers: {
        "content-type": "application/json",
        "content-length": String(Buffer.byteLength(forged, "utf8")),
      },
      body: forged,
    });
    expect(rejected.status).toBe(409);
    expect(rejected.body).not.toContain("f".repeat(64));
  });
});
