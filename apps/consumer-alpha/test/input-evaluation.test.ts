import { beforeEach, describe, expect, it } from "vitest";
import {
  parseManualAlphaState,
  SYNTHETIC_BRANCH_ID,
  SYNTHETIC_MERCHANT_ID,
} from "../src/contracts.js";
import { handleRequest, resetIssuedRecommendationIds } from "../src/server.js";
import { buildSyntheticRecommendationRequest } from "../src/synthetic.js";

const baseState = {
  merchant_id: SYNTHETIC_MERCHANT_ID,
  branch_id: SYNTHETIC_BRANCH_ID,
  amount_jpy: 640,
  owned_instruments: ["synthetic_card"],
  stored_value_use: "unknown",
  facts: [],
  caps: [],
};

function jsonRequest(pathname: string, body: unknown) {
  const serialized = JSON.stringify(body);
  return handleRequest({
    method: "POST",
    pathname,
    headers: {
      host: "127.0.0.1",
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(serialized, "utf8")),
    },
    body: serialized,
  });
}

function bodyOf(response: { readonly body: string }): Record<string, unknown> {
  return JSON.parse(response.body) as Record<string, unknown>;
}

describe("M6 host input/evaluation boundary", () => {
  beforeEach(() => resetIssuedRecommendationIds());

  it("requires the exact host-owned merchant and branch ids", () => {
    const parsed = parseManualAlphaState(baseState);
    expect(parsed.merchant_id).toBe(SYNTHETIC_MERCHANT_ID);
    expect(parsed.branch_id).toBe(SYNTHETIC_BRANCH_ID);
    expect(() =>
      parseManualAlphaState({
        ...baseState,
        merchant_alias: "Synthetic Shop",
      }),
    ).toThrow("unknown_field");
    expect(() =>
      parseManualAlphaState({ ...baseState, branch_id: "attacker.branch" }),
    ).toThrow("branch_id_invalid");
  });

  it("canonicalizes custom positive valuations without binary floats", () => {
    const parsed = parseManualAlphaState({
      ...baseState,
      owned_instruments: ["synthetic_card", "synthetic_stored_value"],
      stored_value_use: "yes",
      stored_value_usage: "custom",
      stored_value_value_jpy_per_unit: "000.7500",
    });
    expect(parsed.stored_value_value_jpy_per_unit).toBe("0.75");
    for (const value of ["0", "0.0000", "1.0001", "2", "-0.1", "1e-1"]) {
      expect(() =>
        parseManualAlphaState({
          ...baseState,
          owned_instruments: ["synthetic_card", "synthetic_stored_value"],
          stored_value_use: "yes",
          stored_value_usage: "custom",
          stored_value_value_jpy_per_unit: value,
        }),
      ).toThrow("stored_value_valuation_invalid");
    }
  });

  it("hashes all normalized accepted input, including facts and caps", () => {
    const first = parseManualAlphaState({
      ...baseState,
      facts: [{ key: "acceptance", status: "known", value: "yes" }],
      caps: [{ key: "monthly", status: "known", spend_jpy: 100 }],
    });
    const second = parseManualAlphaState({
      ...baseState,
      facts: [{ key: "acceptance", status: "known", value: "no" }],
      caps: [{ key: "monthly", status: "known", spend_jpy: 100 }],
    });
    const firstId = buildSyntheticRecommendationRequest(first).request_id;
    const secondId = buildSyntheticRecommendationRequest(second).request_id;
    expect(firstId).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(secondId).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(firstId).not.toBe(secondId);
    expect(
      buildSyntheticRecommendationRequest(
        parseManualAlphaState({
          ...baseState,
          facts: [
            { key: "z_fact", status: "unknown" },
            { key: "a_fact", status: "known", value: "yes" },
          ],
          caps: [
            { key: "z_cap", status: "unknown" },
            { key: "a_cap", status: "known", spend_jpy: 10 },
          ],
        }),
      ).request_id,
    ).toBe(
      buildSyntheticRecommendationRequest(
        parseManualAlphaState({
          ...baseState,
          facts: [
            { key: "a_fact", status: "known", value: "yes" },
            { key: "z_fact", status: "unknown" },
          ],
          caps: [
            { key: "a_cap", status: "known", spend_jpy: 10 },
            { key: "z_cap", status: "unknown" },
          ],
        }),
      ).request_id,
    );
  });

  it("fails closed before evaluation for unsupported ownership", async () => {
    for (const owned_instruments of [
      [],
      ["synthetic_qr_wallet"],
      ["synthetic_stored_value"],
    ]) {
      const response = await jsonRequest("/api/synthetic/evaluate", {
        ...baseState,
        owned_instruments,
      });
      expect(response.status).toBe(400);
      expect(bodyOf(response)).toMatchObject({
        error: { code: "no_supported_owned_instrument" },
      });
    }
  });

  it("requires an issued full-input id for correction drafts", async () => {
    const missing = await jsonRequest("/api/corrections/draft", {
      category: "wrong_plan",
      note_code: "plan_not_available",
    });
    expect(missing.status).toBe(400);
    expect(bodyOf(missing)).toMatchObject({
      error: { code: "correction_id_invalid" },
    });

    const arbitrary = await jsonRequest("/api/corrections/draft", {
      category: "wrong_plan",
      note_code: "plan_not_available",
      recommendation_id: `sha256:${"a".repeat(64)}`,
    });
    expect(arbitrary.status).toBe(409);
    expect(bodyOf(arbitrary)).toMatchObject({
      error: { code: "recommendation_not_issued" },
    });

    const evaluation = await jsonRequest("/api/synthetic/evaluate", baseState);
    expect(evaluation.status).toBe(200);
    const recommendation = bodyOf(evaluation).recommendation as Record<
      string,
      unknown
    >;
    const recommendationId = recommendation.request_id;
    expect(recommendationId).toMatch(/^sha256:[0-9a-f]{64}$/u);
    const accepted = await jsonRequest("/api/corrections/draft", {
      category: "wrong_plan",
      note_code: "plan_not_available",
      recommendation_id: recommendationId,
    });
    expect(accepted.status).toBe(200);
    expect(bodyOf(accepted)).toMatchObject({
      correction: {
        status: "not_submitted",
        recommendation_id: recommendationId,
      },
    });
  });

  it("keeps host, origin, and query boundaries strict", async () => {
    const hostileHost = await handleRequest({
      method: "POST",
      pathname: "/api/synthetic/evaluate",
      headers: {
        host: "attacker.invalid",
        "content-type": "application/json",
      },
      body: JSON.stringify(baseState),
    });
    expect(hostileHost.status).toBe(400);
    expect(bodyOf(hostileHost)).toMatchObject({
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
      body: JSON.stringify(baseState),
    });
    expect(hostileOrigin.status).toBe(403);
    expect(bodyOf(hostileOrigin)).toMatchObject({
      error: { code: "origin_invalid" },
    });

    const query = await handleRequest({
      method: "GET",
      pathname: "/go/synthetic_loyalty_app?next=https://attacker.invalid",
    });
    expect(query.status).toBe(400);
    expect(bodyOf(query)).toMatchObject({
      error: { code: "query_not_allowed" },
    });
  });

  it("rejects sensitive fact scalars and unsafe object descriptors before reads", () => {
    for (const value of [
      "4111 1111 1111 1111",
      "Bearer abcdefghijklmnop",
      "person@example.com",
    ]) {
      expect(() =>
        parseManualAlphaState({
          ...baseState,
          facts: [{ key: "manual_fact", status: "known", value }],
        }),
      ).toThrow("prohibited_data");
    }

    const getterInput = { ...baseState } as Record<string, unknown>;
    Object.defineProperty(getterInput, "amount_jpy", {
      enumerable: true,
      get: () => {
        throw new Error("getter must not run");
      },
    });
    expect(() => parseManualAlphaState(getterInput)).toThrow("prohibited_data");

    const hiddenInput = { ...baseState } as Record<string, unknown>;
    Object.defineProperty(hiddenInput, "hidden", {
      enumerable: false,
      value: "secret",
    });
    expect(() => parseManualAlphaState(hiddenInput)).toThrow("prohibited_data");

    const proxyInput = new Proxy(baseState, {
      get: () => {
        throw new Error("proxy getter must not run");
      },
    });
    expect(() => parseManualAlphaState(proxyInput)).toThrow("prohibited_data");
  });
});
