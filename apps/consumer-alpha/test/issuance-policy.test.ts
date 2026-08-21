import { beforeEach, describe, expect, it, vi } from "vitest";

const { evaluateSyntheticMock, originalEvaluate } = vi.hoisted(() => ({
  evaluateSyntheticMock: vi.fn(),
  originalEvaluate: vi.fn(),
}));

vi.mock("../src/synthetic.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/synthetic.js")>();
  originalEvaluate.mockImplementation(original.evaluateSynthetic);
  return { ...original, evaluateSynthetic: evaluateSyntheticMock };
});

const { handleRequest, resetIssuedRecommendationIds } = await import(
  "../src/server.js"
);

const state = {
  merchant_id: "merchant.synthetic",
  branch_id: "location.synthetic",
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

describe("M6 correction issuance policy", () => {
  beforeEach(() => {
    resetIssuedRecommendationIds();
    evaluateSyntheticMock.mockImplementation((input) => {
      const response = originalEvaluate(input);
      const exhausted = input.caps.some(
        (cap) =>
          cap.key === "synthetic.exhausted_cap" &&
          cap.status === "known" &&
          cap.spend_jpy !== undefined &&
          cap.spend_jpy >= input.amount_jpy,
      );
      if (!exhausted) return response;
      return {
        ...response,
        outcome: "no_valid_plan" as const,
        winner_plan_id: null,
        safe_plan_id: null,
        runner_up_plan_id: null,
        winner: null,
        safe_plan: null,
        runner_up: null,
        eligible_plans: [],
        rejected_plans: response.plans,
        conditional_winners: [],
      };
    });
  });

  it("does not issue correction authority for a cap-driven no-valid result", async () => {
    const evaluation = await jsonRequest("/api/synthetic/evaluate", {
      ...state,
      caps: [
        {
          key: "synthetic.exhausted_cap",
          status: "known",
          spend_jpy: 640,
        },
      ],
    });
    expect(evaluation.status).toBe(200);
    const recommendation = bodyOf(evaluation).recommendation as Record<
      string,
      unknown
    >;
    expect(recommendation.outcome).toBe("no_valid_plan");
    expect(recommendation.primary).toBeNull();
    expect(recommendation.request_id).toMatch(/^sha256:[0-9a-f]{64}$/u);

    const correction = await jsonRequest("/api/corrections/draft", {
      category: "wrong_plan",
      note_code: "plan_not_available",
      recommendation_id: recommendation.request_id,
    });
    expect(correction.status).toBe(409);
    expect(bodyOf(correction)).toMatchObject({
      error: { code: "recommendation_not_issued" },
    });
  });
});
