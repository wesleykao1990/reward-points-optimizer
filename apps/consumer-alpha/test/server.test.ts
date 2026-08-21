import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
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
      synthetic_only: true,
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
});
