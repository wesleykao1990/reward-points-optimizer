import {
  compileRuleIR,
  getNanacoCreditChargeRule,
  NANACO_CREDIT_CHARGE_CANDIDATE,
  NANACO_CREDIT_CHARGE_CANDIDATE_ARTIFACT_HASH,
  NANACO_CREDIT_CHARGE_CLAIM_IDS,
  NANACO_CREDIT_CHARGE_DEFINITION_HASH,
  NANACO_CREDIT_CHARGE_EVIDENCE_IDS,
  NANACO_CREDIT_CHARGE_FINDING_ID,
  NANACO_CREDIT_CHARGE_SOURCE_IDS,
  RULE_IR_VERSION,
} from "@jro/provisional-rules";
import { describe, expect, it } from "vitest";

import { parseNanacoCreditChargeRecommendation } from "../src/contracts.js";
import { getDefaultFactInfluenceGraphPort } from "../src/fact-influence-graph.js";
import {
  evaluateNanacoCreditChargeRecommendation,
  getNanacoCreditChargeRuleIRMaterial,
  NANACO_CREDIT_CHARGE_PUBLICATION_ID,
  type NanacoCreditChargeAvailability,
  NanacoCreditChargeRecommendationError,
} from "../src/nanaco-credit-charge-recommendation.js";
import { handleRequest } from "../src/server.js";

const ruleIR = (() => {
  const compiled = compileRuleIR({
    version: RULE_IR_VERSION,
    rule: getNanacoCreditChargeRule(),
    source_binding: {
      claim_id: NANACO_CREDIT_CHARGE_CLAIM_IDS[0],
      family_id: NANACO_CREDIT_CHARGE_CANDIDATE.p0_family_id,
      source_role_id: NANACO_CREDIT_CHARGE_CANDIDATE.source_role_id,
      source_ids: [...NANACO_CREDIT_CHARGE_CANDIDATE.source_ids],
      observation_id: NANACO_CREDIT_CHARGE_CANDIDATE.observation_id,
      observation_fingerprint:
        NANACO_CREDIT_CHARGE_CANDIDATE.observation_fingerprint,
      evidence_ids: [...NANACO_CREDIT_CHARGE_EVIDENCE_IDS],
      candidate_id: NANACO_CREDIT_CHARGE_CANDIDATE.candidate_id,
      candidate_hash: NANACO_CREDIT_CHARGE_CANDIDATE_ARTIFACT_HASH,
      definition_hash: NANACO_CREDIT_CHARGE_DEFINITION_HASH,
    },
    ...getNanacoCreditChargeRuleIRMaterial(),
  });
  if (!compiled.ok) throw new Error("credit-charge-test-rule-ir-invalid");
  return compiled.value;
})();

const availability = (): NanacoCreditChargeAvailability => ({
  route_id: NANACO_CREDIT_CHARGE_PUBLICATION_ID,
  candidate_id: NANACO_CREDIT_CHARGE_PUBLICATION_ID,
  candidate_hash: NANACO_CREDIT_CHARGE_CANDIDATE_ARTIFACT_HASH,
  definition_hash: NANACO_CREDIT_CHARGE_DEFINITION_HASH,
  finding_id: NANACO_CREDIT_CHARGE_FINDING_ID,
  claim_ids: [...NANACO_CREDIT_CHARGE_CLAIM_IDS],
  evidence_ids: [...NANACO_CREDIT_CHARGE_EVIDENCE_IDS],
  source_ids: [...NANACO_CREDIT_CHARGE_SOURCE_IDS],
  reward_rule: getNanacoCreditChargeRule(),
  rule_ir: ruleIR,
});

const input = (amount = 5_000, balance = 0) => ({
  selection_id: NANACO_CREDIT_CHARGE_PUBLICATION_ID,
  charge_amount_jpy: amount,
  nanaco_balance_jpy: balance,
  seven_card_plus_owned: true,
  nanaco_credit_charge_preregistered: true,
  effective_at: "2026-08-22T00:00:00+09:00",
});

describe("Seven Card Plus Nanaco credit-charge recommendation", () => {
  it("creates one principal top-up and 25 separate points at JPY 5,000", async () => {
    const result = await evaluateNanacoCreditChargeRecommendation(input(), {
      current: async () => availability(),
    });

    expect(result.outcome).toBe("definite");
    expect(result.winner).toMatchObject({
      eligible: true,
      reward_points: "25",
      objective_score_jpy: null,
      operation_count: 1,
    });
    expect(result.nanaco_balance_after_jpy).toBe(5_000);
    expect(result.verification_status).toBe("experimental_unverified");
  });

  it("fails closed when source availability omits Rule IR", async () => {
    const withoutRuleIR = { ...availability() } as Record<string, unknown>;
    delete withoutRuleIR.rule_ir;
    await expect(
      evaluateNanacoCreditChargeRecommendation(input(), {
        current: async () =>
          withoutRuleIR as unknown as NanacoCreditChargeAvailability,
      }),
    ).rejects.toMatchObject({ code: "rule_not_current" });
  });

  it("enforces the reviewed amount, increment, balance, and user boundaries", async () => {
    const source = { current: async () => availability() };
    for (const [candidate, code] of [
      [input(4_999), "charge_below_minimum"],
      [input(5_500), "charge_not_increment"],
      [input(31_000), "charge_above_maximum"],
      [input(5_000, 46_000), "balance_limit_exceeded"],
      [{ ...input(), seven_card_plus_owned: false }, "ownership_required"],
      [
        { ...input(), nanaco_credit_charge_preregistered: false },
        "preregistration_required",
      ],
    ] as const) {
      await expect(
        evaluateNanacoCreditChargeRecommendation(candidate, source),
      ).rejects.toMatchObject({ code });
    }
  });

  it("fails closed on stale or mismatched source-bound rules", async () => {
    const stale = availability();
    stale.reward_rule.validity.valid_to = "2026-08-21T00:00:00+09:00";
    await expect(
      evaluateNanacoCreditChargeRecommendation(input(), {
        current: async () => stale,
      }),
    ).rejects.toBeInstanceOf(NanacoCreditChargeRecommendationError);

    await expect(
      evaluateNanacoCreditChargeRecommendation(input(), {
        current: async () => ({ ...availability(), evidence_ids: [] }),
      }),
    ).rejects.toMatchObject({ code: "source_unavailable" });

    const drifted = availability();
    if (drifted.reward_rule.calculation?.model === "points_per_unit") {
      drifted.reward_rule.calculation.spend_jpy = 1;
      drifted.reward_rule.calculation.reward_units = "9";
    }
    await expect(
      evaluateNanacoCreditChargeRecommendation(input(), {
        current: async () => drifted,
      }),
    ).rejects.toMatchObject({ code: "rule_not_current" });
  });

  it("rejects impossible dates, extra keys, proxies, and hidden fields", () => {
    expect(() =>
      parseNanacoCreditChargeRecommendation({
        ...input(),
        effective_at: "2026-09-31T00:00:00+09:00",
      }),
    ).toThrowError(/nanaco_credit_charge_effective_at_invalid/u);
    expect(() =>
      parseNanacoCreditChargeRecommendation({ ...input(), evidence: [] }),
    ).toThrow();
    expect(() =>
      parseNanacoCreditChargeRecommendation(new Proxy(input(), {})),
    ).toThrow();
    const hidden = input() as Record<string, unknown>;
    Object.defineProperty(hidden, "secret", { value: "Bearer hidden" });
    expect(() => parseNanacoCreditChargeRecommendation(hidden)).toThrow();
  });

  it("serves only the bounded browser projection through the POST route", async () => {
    const body = JSON.stringify(input());
    const response = await handleRequest(
      {
        method: "POST",
        pathname: "/api/experimental/nanaco-credit-charge",
        headers: {
          host: "127.0.0.1",
          origin: "http://127.0.0.1",
          "content-type": "application/json",
          "content-length": String(Buffer.byteLength(body, "utf8")),
        },
        body,
      },
      {
        experimentalNanacoCreditChargeRecommendation: {
          evaluate: async (request) =>
            evaluateNanacoCreditChargeRecommendation(request, {
              current: async () => availability(),
            }),
        },
        factInfluenceGraph: getDefaultFactInfluenceGraphPort(),
      },
    );

    expect(response.status).toBe(200);
    const recommendation = JSON.parse(response.body).recommendation;
    expect(recommendation).toMatchObject({
      verification_status: "experimental_unverified",
      outcome: "definite",
      payment_method: "seven_card_plus",
      charge_amount_jpy: 5_000,
      nanaco_balance_after_jpy: 5_000,
      winner: { reward_points: "25", operation_count: 1 },
    });
    expect(recommendation.fact_influence).toMatchObject({
      fact_count: 364,
      applied_count: 1,
      applied_factor_ids: [expect.stringMatching(/^factor_[0-9a-f]{32}$/u)],
    });
    expect(response.body).not.toContain("evidence_ids");
    expect(response.body).not.toContain("source_ids");
    expect(response.body).not.toContain("rule_id");
    expect(response.body).not.toContain("sha256:");
  });

  it("rejects a forged host result whose accounting disagrees with the request", async () => {
    const valid = await evaluateNanacoCreditChargeRecommendation(input(), {
      current: async () => availability(),
    });
    const forged = {
      ...valid,
      winner_plan_id: "plan_experimental_nanaco_credit_charge",
      winner: {
        ...valid.winner,
        reward_points: "999",
        operation_count: 2,
      },
      plans: [
        {
          ...valid.plans[0],
          reward_points: "999",
          operation_count: 2,
        },
      ],
    };
    const body = JSON.stringify(input());
    const response = await handleRequest(
      {
        method: "POST",
        pathname: "/api/experimental/nanaco-credit-charge",
        headers: {
          "content-type": "application/json",
          "content-length": String(Buffer.byteLength(body, "utf8")),
        },
        body,
      },
      {
        experimentalNanacoCreditChargeRecommendation: {
          evaluate: async () => forged as never,
        },
      },
    );
    expect(response.status).toBe(503);
    expect(response.body).not.toContain("999");

    const contradictoryResponse = await handleRequest(
      {
        method: "POST",
        pathname: "/api/experimental/nanaco-credit-charge",
        headers: {
          "content-type": "application/json",
          "content-length": String(Buffer.byteLength(body, "utf8")),
        },
        body,
      },
      {
        experimentalNanacoCreditChargeRecommendation: {
          evaluate: async () => ({ ...valid, outcome: "no_valid_plan" }),
        },
      },
    );
    expect(contradictoryResponse.status).toBe(503);

    let getterReads = 0;
    const proxy = new Proxy(valid, {
      get(target, property, receiver) {
        getterReads += 1;
        return Reflect.get(target, property, receiver);
      },
    });
    const proxyResponse = await handleRequest(
      {
        method: "POST",
        pathname: "/api/experimental/nanaco-credit-charge",
        headers: {
          "content-type": "application/json",
          "content-length": String(Buffer.byteLength(body, "utf8")),
        },
        body,
      },
      {
        experimentalNanacoCreditChargeRecommendation: {
          evaluate: async () => proxy,
        },
      },
    );
    expect(proxyResponse.status).toBe(503);
    // Promise resolution performs the one unavoidable `then` lookup; the
    // output admission itself must not read any application field.
    expect(getterReads).toBe(1);
  });
});
