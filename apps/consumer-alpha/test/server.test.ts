import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resetExperimentalCatalogue } from "../src/provisional-catalog.js";
import {
  handleRequest,
  LOCALHOST_BIND_HOST,
  MAX_EVALUATE_BODY_BYTES,
  resetIssuedRecommendationIds,
} from "../src/server.js";

const validManualState = {
  merchant_id: "merchant.synthetic",
  branch_id: "location.synthetic",
  amount_jpy: 640,
  owned_instruments: ["synthetic_card"],
  stored_value_use: "unknown",
  facts: [],
  caps: [],
};

const jsonRequest = (
  method: string,
  pathname: string,
  body: unknown,
  contentType = "application/json",
) => {
  const serialized = JSON.stringify(body);
  return handleRequest({
    method,
    pathname,
    headers: {
      "content-type": contentType,
      "content-length": String(Buffer.byteLength(serialized, "utf8")),
    },
    body: serialized,
  });
};

type JsonRecord = Record<string, unknown>;

const jsonBody = (response: { body: string }) =>
  JSON.parse(response.body) as JsonRecord;

describe("M6 localhost consumer shell", () => {
  it("keeps the loopback bind constant and sends security headers without CORS", async () => {
    expect(LOCALHOST_BIND_HOST).toBe("127.0.0.1");
    const response = await handleRequest({
      method: "GET",
      pathname: "/health",
    });
    expect(response.status).toBe(200);
    expect(response.headers["Content-Security-Policy"]).toContain(
      "default-src 'none'",
    );
    expect(response.headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(response.headers["Access-Control-Allow-Origin"]).toBeUndefined();
    expect(jsonBody(response)).toMatchObject({
      status: "ok",
      synthetic_recommendations_only: false,
      recommendation_routes: [
        "synthetic",
        "nanaco_purchase",
        "nanaco_credit_charge",
      ],
      experimental_catalogue: true,
      bind_host: "127.0.0.1",
    });
  });

  it("has explicit route methods and JSON content type", async () => {
    const get = await handleRequest({
      method: "GET",
      pathname: "/api/synthetic/evaluate",
    });
    expect(get.status).toBe(405);
    expect(get.headers.Allow).toBe("POST");
    expect(jsonBody(get)).toMatchObject({
      error: { code: "method_not_allowed" },
    });

    const text = await jsonRequest(
      "POST",
      "/api/synthetic/evaluate",
      validManualState,
      "text/plain",
    );
    expect(text.status).toBe(415);
    expect(jsonBody(text)).toMatchObject({
      error: { code: "json_content_type_required" },
    });
  });

  it("rejects an impossible experimental effective date before evaluator access", async () => {
    let calls = 0;
    const body = JSON.stringify({
      selection_id: "candidate_p0_nanaco_shopping_earning_20260821_v0_1",
      amount_jpy: 220,
      tax_exclusive_amount_jpy: 200,
      nanaco_balance_jpy: 1_000,
      effective_at: "2026-09-31T00:00:00+09:00",
    });
    const response = await handleRequest(
      {
        method: "POST",
        pathname: "/api/experimental/recommendation",
        headers: {
          "content-type": "application/json",
          "content-length": String(Buffer.byteLength(body, "utf8")),
        },
        body,
      },
      {
        experimentalRecommendation: {
          async evaluate() {
            calls += 1;
            throw new Error("must not run");
          },
        },
      },
    );
    expect(response.status).toBe(400);
    expect(jsonBody(response)).toMatchObject({
      error: { code: "experimental_effective_at_invalid" },
    });
    expect(calls).toBe(0);
  });

  it("accepts only bounded manual state and never accepts production mode or evaluator inputs", async () => {
    const valid = await jsonRequest(
      "POST",
      "/api/synthetic/evaluate",
      validManualState,
    );
    expect(valid.status).toBe(200);
    const result = jsonBody(valid);
    const recommendation = result.recommendation as JsonRecord;
    expect(recommendation.synthetic_only).toBe(true);
    expect(recommendation.not_current_advice).toBe(true);
    expect(recommendation).not.toHaveProperty("plans");
    expect(recommendation).not.toHaveProperty("rules");
    expect(recommendation).not.toHaveProperty("assurances");

    const prohibited = await jsonRequest("POST", "/api/synthetic/evaluate", {
      ...validManualState,
      rules: [],
    });
    expect(prohibited.status).toBe(400);
    expect(jsonBody(prohibited)).toMatchObject({
      error: { code: "forbidden_field" },
    });

    const production = await jsonRequest("POST", "/api/synthetic/evaluate", {
      ...validManualState,
      mode: "production",
    });
    expect(production.status).toBe(400);
    expect(jsonBody(production)).toMatchObject({
      error: { code: "unknown_field" },
    });
  });

  it("enforces the body limit and redacts evaluator failures", async () => {
    const oversized = "x".repeat(MAX_EVALUATE_BODY_BYTES + 1);
    const response = await handleRequest({
      method: "POST",
      pathname: "/api/synthetic/evaluate",
      headers: {
        "content-type": "application/json",
        "content-length": String(Buffer.byteLength(oversized, "utf8")),
      },
      body: oversized,
    });
    expect(response.status).toBe(413);
    expect(response.body).not.toContain(oversized);
    expect(response.body).not.toContain("Error");
  });

  it("keeps correction drafts session-only and not submitted", async () => {
    resetIssuedRecommendationIds();
    const evaluation = await jsonRequest(
      "POST",
      "/api/synthetic/evaluate",
      validManualState,
    );
    expect(evaluation.status).toBe(200);
    const recommendation = jsonBody(evaluation).recommendation as JsonRecord;
    const recommendationId = recommendation.request_id;
    expect(recommendationId).toMatch(/^sha256:[0-9a-f]{64}$/u);

    const response = await jsonRequest("POST", "/api/corrections/draft", {
      category: "wrong_reward_amount",
      note_code: "amount_disagrees",
      recommendation_id: recommendationId,
    });
    expect(response.status).toBe(200);
    expect(jsonBody(response)).toMatchObject({
      correction: {
        status: "not_submitted",
        category: "wrong_reward_amount",
        note_code: "amount_disagrees",
        recommendation_id: recommendationId,
      },
    });
  });

  it("selects deep links by opaque link id", async () => {
    const response = await handleRequest({
      method: "GET",
      pathname: "/go/synthetic_loyalty_app",
    });
    expect(response.status).toBe(302);
    expect(response.headers.Location).toContain("alpha.rewards-optimizer.test");
    const arbitrary = await handleRequest({
      method: "GET",
      pathname: "/go/https-example",
    });
    expect(arbitrary.status).toBe(404);
    const query = await handleRequest({
      method: "GET",
      pathname: "/go/synthetic_loyalty_app?next=https://example.invalid",
    });
    expect(query.status).toBe(400);
    expect(jsonBody(query)).toMatchObject({
      error: { code: "query_not_allowed" },
    });
  });

  it("rejects non-local authority and cross-origin API calls", async () => {
    const hostileHost = await handleRequest({
      method: "POST",
      pathname: "/api/synthetic/evaluate",
      headers: {
        host: "attacker.invalid",
        "content-type": "application/json",
      },
      body: JSON.stringify(validManualState),
    });
    expect(hostileHost.status).toBe(400);
    expect(jsonBody(hostileHost)).toMatchObject({
      error: { code: "host_invalid" },
    });
    const hostileOrigin = await handleRequest({
      method: "POST",
      pathname: "/api/synthetic/evaluate",
      headers: {
        host: "127.0.0.1",
        origin: "https://attacker.invalid/",
        "content-type": "application/json",
      },
      body: JSON.stringify(validManualState),
    });
    expect(hostileOrigin.status).toBe(403);
    expect(jsonBody(hostileOrigin)).toMatchObject({
      error: { code: "origin_invalid" },
    });
  });

  it("uses DOM-safe rendering for hostile synthetic text", () => {
    const source = readFileSync(
      new URL("../public/app.js", import.meta.url),
      "utf8",
    );
    expect(source).toContain("textContent");
    expect(source).not.toContain("innerHTML");
    expect(source).not.toContain("insertAdjacentHTML");
    expect(source).not.toContain("document.write");
    expect(source).not.toContain("localStorage");
    expect(source).not.toContain("sessionStorage");
    expect(source).not.toContain("document.cookie");
  });

  it("returns the exact browser-safe experimental snapshot", async () => {
    resetExperimentalCatalogue();
    const response = await handleRequest({
      method: "GET",
      pathname: "/api/experimental/rules",
    });
    expect(response.status).toBe(200);
    const body = jsonBody(response);
    expect(Object.keys(body).sort()).toEqual(["rules", "status", "updated_at"]);
    expect(body.status).toBe("ready");
    expect(body.updated_at).toBe("2026-08-21T04:53:00.000Z");
    const rules = body.rules as JsonRecord[];
    expect(rules).toHaveLength(11);
    const creditCard = rules.find(
      (item) =>
        item.publication_id ===
        "candidate_p0_seveneleven_credit_card_20260821_v0_1",
    );
    expect(creditCard).toMatchObject({
      publication_id: "candidate_p0_seveneleven_credit_card_20260821_v0_1",
      kind: "payment_acceptance",
      title: "セブン‐イレブンの支払い方法",
      display_status: "experimental_unverified",
      confidence: "high",
      source_label: "セブン‐イレブン公式情報",
    });
    expect(Object.keys(creditCard ?? {}).sort()).toEqual([
      "checked_at",
      "confidence",
      "display_status",
      "kind",
      "publication_id",
      "source_label",
      "summary",
      "title",
      "valid_from",
      "valid_to",
    ]);
    expect(JSON.stringify(creditCard)).not.toMatch(
      /candidate_hash|definition_hash|source_ids|evidence|rule_id|https?:\/\//iu,
    );
  });

  it("composes an injected port and distinguishes partial and empty snapshots", async () => {
    const card = {
      publication_id: "publication_alpha_v1",
      kind: "campaign",
      title: "春のキャンペーン",
      summary: "公式情報をもとに自動収集した先行公開情報です。",
      display_status: "experimental_unverified",
      confidence: "medium",
      source_label: "公式キャンペーン情報",
      checked_at: "2026-08-21T00:00:00Z",
      valid_from: "2026-08-21T00:00:00Z",
      valid_to: null,
    } as const;
    let cards = [card];
    const port = {
      async list() {
        return {
          status: "partial" as const,
          updated_at: null,
          rules: cards,
        };
      },
      async reportCorrection(input: {
        publication_id: string;
        category: string;
      }) {
        cards = cards.filter(
          (item) => item.publication_id !== input.publication_id,
        );
        return {
          ok: true as const,
          publication_id: input.publication_id,
          category: input.category,
          accepted: true as const,
          candidate_hash: `sha256:${"f".repeat(64)}`,
          status: "disputed",
        };
      },
    };
    const initial = await handleRequest(
      { method: "GET", pathname: "/api/experimental/rules" },
      { experimentalCatalogue: port },
    );
    expect(initial.status).toBe(200);
    expect(jsonBody(initial)).toEqual({
      status: "partial",
      updated_at: null,
      rules: [card],
    });
    // Pass the injected port directly to assert server composition and exact
    // publication binding.
    const injectedCorrection = await handleRequest(
      {
        method: "POST",
        pathname: "/api/experimental/corrections",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          publication_id: card.publication_id,
          category: "not_accepted",
        }),
      },
      port,
    );
    expect(injectedCorrection.status).toBe(200);
    expect(jsonBody(injectedCorrection)).toEqual({
      correction: {
        publication_id: card.publication_id,
        category: "not_accepted",
        accepted: true,
      },
    });
    const empty = await handleRequest(
      { method: "GET", pathname: "/api/experimental/rules" },
      port,
    );
    expect(empty.status).toBe(200);
    expect(jsonBody(empty)).toEqual({
      status: "partial",
      updated_at: null,
      rules: [],
    });
  });

  it("fails closed when an injected port throws or returns a malformed row", async () => {
    const throwingPort = {
      async list() {
        throw new Error("private database details");
      },
      async reportCorrection() {
        throw new Error("private correction details");
      },
    };
    const thrown = await handleRequest(
      { method: "GET", pathname: "/api/experimental/rules" },
      throwingPort,
    );
    expect(thrown.status).toBe(503);
    expect(thrown.body).not.toContain("private database details");

    const malformedPort = {
      async list() {
        return {
          status: "ready" as const,
          updated_at: "2026-08-21T00:00:00Z",
          rules: [
            {
              publication_id: "publication_malformed",
              kind: "other",
              title: "表示用カード",
              summary: "先行公開情報",
              display_status: "experimental_unverified",
              confidence: "limited",
              source_label: "公式情報",
              checked_at: "2026-08-21T00:00:00Z",
              valid_from: "2026-08-21T00:00:00Z",
              valid_to: null,
              evidence: "do not serialize",
            },
          ],
        };
      },
      async reportCorrection() {
        return { ok: false, code: "correction_not_applied" };
      },
    };
    const malformed = await handleRequest(
      { method: "GET", pathname: "/api/experimental/rules" },
      malformedPort,
    );
    expect(malformed.status).toBe(503);
    expect(malformed.body).not.toContain("do not serialize");
    expect(malformed.body).not.toContain("evidence");
  });

  it("rejects hostile authority on provisional catalogue reads", async () => {
    const response = await handleRequest({
      method: "GET",
      pathname: "/api/experimental/rules",
      headers: {
        host: "attacker.invalid",
        origin: "https://attacker.invalid",
      },
    });
    expect(response.status).toBe(400);
    expect(jsonBody(response)).toMatchObject({
      error: { code: "host_invalid" },
    });
  });

  it("accepts only an exact publication/category correction and removes that version", async () => {
    resetExperimentalCatalogue();
    const initial = await handleRequest({
      method: "GET",
      pathname: "/api/experimental/rules",
    });
    const publicationId = (jsonBody(initial).rules as JsonRecord[])[0]
      ?.publication_id;
    if (typeof publicationId !== "string")
      throw new Error("publication missing");

    const corrected = await jsonRequest(
      "POST",
      "/api/experimental/corrections",
      { publication_id: publicationId, category: "not_accepted" },
    );
    expect(corrected.status).toBe(200);
    expect(jsonBody(corrected)).toMatchObject({
      correction: {
        publication_id: publicationId,
        category: "not_accepted",
        accepted: true,
      },
    });
    expect(JSON.stringify(jsonBody(corrected))).not.toMatch(
      /candidate_hash|definition_hash|reported_at|disputed|severity|credible/iu,
    );
    const removed = await handleRequest({
      method: "GET",
      pathname: "/api/experimental/rules",
    });
    const remaining = jsonBody(removed).rules as JsonRecord[];
    expect(remaining).toHaveLength(10);
    expect(
      remaining.some((item) => item.publication_id === publicationId),
    ).toBe(false);

    const repeated = await jsonRequest(
      "POST",
      "/api/experimental/corrections",
      { publication_id: publicationId, category: "not_accepted" },
    );
    expect(repeated.status).toBe(409);
    expect(jsonBody(repeated)).toMatchObject({
      error: { code: "publication_not_active" },
    });
  });

  it("rejects unknown, extra-field, and proxy-ish correction payloads", async () => {
    resetExperimentalCatalogue();
    const unknown = await jsonRequest("POST", "/api/experimental/corrections", {
      publication_id: "candidate_unknown",
      category: "not_accepted",
    });
    expect(unknown.status).toBe(404);
    expect(jsonBody(unknown)).toMatchObject({
      error: { code: "publication_not_found" },
    });

    const extra = await jsonRequest("POST", "/api/experimental/corrections", {
      publication_id: "candidate_unknown",
      category: "not_accepted",
      candidate_hash: `sha256:${"0".repeat(64)}`,
    });
    expect(extra.status).toBe(400);
    expect(jsonBody(extra)).toMatchObject({
      error: { code: "unknown_field" },
    });

    const proxyish = await jsonRequest(
      "POST",
      "/api/experimental/corrections",
      {
        publication_id: "candidate_unknown",
        category: "not_accepted",
        source: { value: "https://attacker.invalid" },
      },
    );
    expect(proxyish.status).toBe(400);
    expect(jsonBody(proxyish)).toMatchObject({
      error: { code: "forbidden_field" },
    });
  });

  it("keeps the unified Japanese catalogue and synthetic links DOM-safe", () => {
    const html = readFileSync(
      new URL("../public/index.html", import.meta.url),
      "utf8",
    );
    const source = readFileSync(
      new URL("../public/app.js", import.meta.url),
      "utf8",
    );
    expect(html).toContain("ルート・ポイントカタログを見る");
    expect(html).toContain("ルート・ポイント情報");
    expect(html).toContain("ファミリー、支払い方法、還元ルート、ポイント情報");
    expect(html.indexOf('id="tab-information"')).toBeLessThan(
      html.indexOf('id="experimental-section"'),
    );
    expect(html).not.toContain("先行公開");
    expect(html).not.toContain("実験");
    expect(html).not.toContain("最終確認前");
    expect(html).not.toContain("未検証");
    expect(html).not.toContain("現在のおすすめには使わない");
    expect(source).toContain("/api/experimental/rules");
    expect(source).toContain("/api/experimental/corrections");
    expect(source).toContain("誤りを報告する");
    expect(source).toContain("renderGroupedPaymentAcceptance");
    expect(source).not.toContain('"先行公開"');
    expect(source).not.toContain("先行実験");
    expect(source).toContain("textContent");
    expect(source).not.toContain("innerHTML");
    expect(source).not.toContain("localStorage");
  });
});
