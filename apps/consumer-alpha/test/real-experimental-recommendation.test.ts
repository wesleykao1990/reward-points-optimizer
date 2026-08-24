import { getNanacoEconomicPilotRule } from "@jro/provisional-rules";
import { describe, expect, it } from "vitest";
import type { ExperimentalRecommendationInput } from "../src/contracts.js";
import { getDefaultFactInfluenceGraphPort } from "../src/fact-influence-graph.js";
import {
  createNanacoExperimentalRecommendationPort,
  ExperimentalRecommendationError,
  NANACO_EXPERIMENTAL_ACCEPTANCE_PUBLICATION_ID,
  NANACO_EXPERIMENTAL_ACCEPTANCE_RULE_ID,
  NANACO_EXPERIMENTAL_PUBLICATION_ID,
  type NanacoExperimentalRuleSource,
} from "../src/real-experimental-recommendation.js";
import { handleRequest } from "../src/server.js";

const effectiveAt = "2026-08-21T00:00:00+09:00";

function input(
  taxExclusive: number,
  amount = 200,
): ExperimentalRecommendationInput {
  return {
    selection_id: NANACO_EXPERIMENTAL_PUBLICATION_ID,
    amount_jpy: amount,
    tax_exclusive_amount_jpy: taxExclusive,
    nanaco_balance_jpy: 10_000,
    effective_at: effectiveAt,
  };
}

function source(
  rule = getNanacoEconomicPilotRule(),
): NanacoExperimentalRuleSource {
  return {
    async current() {
      return {
        reward_candidate_id: NANACO_EXPERIMENTAL_PUBLICATION_ID,
        reward_rule: rule,
        acceptance_candidate_id: NANACO_EXPERIMENTAL_ACCEPTANCE_PUBLICATION_ID,
        acceptance_rule_id: NANACO_EXPERIMENTAL_ACCEPTANCE_RULE_ID,
      };
    },
  };
}

describe("real experimental Nanaco recommendation", () => {
  it("uses the explicit tax-exclusive amount and preserves unvalued output", async () => {
    const port = createNanacoExperimentalRecommendationPort(source());
    const below = await port.evaluate(input(199));
    const at = await port.evaluate(input(200));

    expect(below.verification_status).toBe("experimental_unverified");
    expect(below.winner?.reward_points).toBe("0");
    expect(at.winner?.reward_points).toBe("1");
    expect(at.winner?.objective_score_jpy).toBeNull();
    expect(at.tax_exclusive_amount_jpy).toBe(200);
    expect(at.winner?.plan_id).toMatch(/^plan_direct_[0-9a-f]{16}$/u);
  });

  it("rejects a source rule that fabricates reviewed or published status", async () => {
    const fake = structuredClone(getNanacoEconomicPilotRule());
    fake.status = "published";
    const port = createNanacoExperimentalRecommendationPort(source(fake));

    await expect(port.evaluate(input(200))).rejects.toMatchObject({
      code: "rule_not_current",
    });
  });

  it("rejects a drifted economic definition before graph generation", async () => {
    const drifted = structuredClone(getNanacoEconomicPilotRule());
    if (drifted.calculation?.model === "points_per_unit")
      drifted.calculation.spend_jpy = 1;
    const port = createNanacoExperimentalRecommendationPort(source(drifted));

    await expect(port.evaluate(input(200))).rejects.toMatchObject({
      code: "rule_not_current",
    });
  });

  it("removes the route when the host source no longer proves both identities", async () => {
    let current = true;
    const route: NanacoExperimentalRuleSource = {
      async current() {
        if (!current) throw new Error("corrected_or_deactivated");
        return await source().current(effectiveAt);
      },
    };
    const port = createNanacoExperimentalRecommendationPort(route);
    await expect(port.evaluate(input(200))).resolves.toMatchObject({
      winner: { reward_points: "1" },
    });
    current = false;
    await expect(port.evaluate(input(200))).rejects.toBeInstanceOf(
      ExperimentalRecommendationError,
    );
  });

  it("is deterministic for the same host proof and request", async () => {
    const port = createNanacoExperimentalRecommendationPort(source());
    const first = await port.evaluate(input(200));
    const second = await port.evaluate(input(200));
    expect(first).toEqual(second);
  });

  it("attaches only the verified purchase claim as an opaque applied factor", async () => {
    const body = JSON.stringify(input(200));
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
        experimentalRecommendation: createNanacoExperimentalRecommendationPort(
          source(),
        ),
        factInfluenceGraph: getDefaultFactInfluenceGraphPort(),
      },
    );
    expect(response.status).toBe(200);
    const recommendation = JSON.parse(response.body).recommendation as Record<
      string,
      unknown
    >;
    expect(recommendation.fact_influence).toMatchObject({
      fact_count: expect.any(Number),
      applied_count: 1,
      applied_factor_ids: [expect.stringMatching(/^factor_[0-9a-f]{32}$/u)],
    });
    expect(response.body).not.toMatch(
      /parent_claim_id|implementation_hash|source_ids|https?:\/\//iu,
    );
  });

  it("fails closed when an injected recommendation dependency omits the graph", async () => {
    const body = JSON.stringify(input(200));
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
        experimentalRecommendation: createNanacoExperimentalRecommendationPort(
          source(),
        ),
      },
    );
    expect(response.status).toBe(500);
    expect(response.body).toContain("fact_influence_graph_dependency_invalid");
  });
});
