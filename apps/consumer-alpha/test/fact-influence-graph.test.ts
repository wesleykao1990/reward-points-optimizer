import { describe, expect, it } from "vitest";
import {
  buildFactInfluenceGraph,
  classifyFactInfluence,
  getDefaultFactInfluenceGraphPort,
  projectFactInfluenceForRecommendation,
} from "../src/fact-influence-graph.js";
import { handleRequest } from "../src/server.js";

describe("P0 fact influence graph", () => {
  it("builds a deterministic 364-node graph from the complete fixture wave", async () => {
    const port = getDefaultFactInfluenceGraphPort();
    const first = await port.load("2026-08-21T00:00:00.000Z");
    const second = await port.load("2026-08-21T00:00:00.000Z");
    expect(first.fact_count).toBe(364);
    expect(first.nodes).toHaveLength(364);
    expect(first.graph_hash).toBe(second.graph_hash);
    expect(first.nodes.map((node) => node.factor_id)).toEqual(
      second.nodes.map((node) => node.factor_id),
    );
    expect(new Set(first.nodes.map((node) => node.factor_id)).size).toBe(364);
    expect(first.nodes.every((node) => node.raw.value !== undefined)).toBe(
      true,
    );
  });

  it("classifies explicit engine bindings as calculation inputs and never ranks advisory facts", () => {
    expect(
      classifyFactInfluence({
        claim_type: "earn_rule",
        predicate: "awards_points_per_amount",
        disposition: "engine_rule",
        derived_rule_ids: ["rule.example"],
      }),
    ).toBe("calculation_input");
    expect(
      classifyFactInfluence({
        claim_type: "earn_rule",
        predicate: "awards_points_per_amount",
        disposition: "catalogue_fact",
        derived_rule_ids: [],
      }),
    ).toBe("advisory_unknown");
  });

  it("keeps catalogue facts non-rankable and gives every active incomplete fact a question or warning", async () => {
    const graph = await getDefaultFactInfluenceGraphPort().load(
      "2026-08-21T00:00:00.000Z",
    );
    expect(
      graph.nodes
        .filter((node) => node.raw.disposition === "catalogue_fact")
        .every((node) => node.rankable === false),
    ).toBe(true);
    expect(
      graph.nodes
        .filter(
          (node) =>
            node.active &&
            (node.raw.reason === "insufficient_operation_mapping" ||
              node.raw.reason === "unsupported_calculation_model"),
        )
        .every((node) => node.question !== null || node.warning !== null),
    ).toBe(true);
  });

  it("joins Nanaco context to bounded Japanese factors without leaking raw material", async () => {
    const graph = await getDefaultFactInfluenceGraphPort().load(
      "2026-08-21T00:00:00.000Z",
    );
    const projection = projectFactInfluenceForRecommendation(graph, {
      merchant_id: "merchant.seveneleven",
      payment_method: "nanaco",
    });
    expect(projection.fact_count).toBe(364);
    expect(projection.relevant_count).toBeGreaterThan(0);
    expect(projection.relevant_factor_ids).toEqual(
      expect.arrayContaining(
        projection.factors.map((factor) => factor.factor_id),
      ),
    );
    expect(JSON.stringify(projection)).not.toMatch(
      /implementation_hash|source_ids|source_identity|evidence_locator|parent_claim_id|https?:\/\//iu,
    );
    expect(
      projection.factors.every((factor) =>
        /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(
          factor.family,
        ),
      ),
    ).toBe(true);
  });

  it("marks only the host-bound purchase claim applied without relabeling it", async () => {
    const graph = await getDefaultFactInfluenceGraphPort().load(
      "2026-08-21T00:00:00.000Z",
    );
    const claim = "claim.point.nanaco.earn.shopping-immediate.004";
    const appliedNode = graph.nodes.find(
      (node) =>
        node.raw.parent_claim_id === claim && node.active && !node.corrected,
    );
    if (!appliedNode) throw new Error("purchase_claim_missing_in_fixture");
    const projection = projectFactInfluenceForRecommendation(
      graph,
      { merchant_id: "merchant.seveneleven", payment_method: "nanaco" },
      [claim],
    );
    expect(projection.applied_count).toBe(1);
    expect(projection.applied_factor_ids).toEqual([appliedNode.factor_id]);
    expect(projection.factors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          factor_id: appliedNode.factor_id,
          applied: true,
          influence_kind: "advisory_unknown",
        }),
      ]),
    );
    expect(JSON.stringify(projection)).not.toContain(claim);
  });

  it("sanitizes arbitrary Japanese subjects and URLs at the browser boundary", async () => {
    const source = await getDefaultFactInfluenceGraphPort().load(
      "2026-08-21T00:00:00.000Z",
    );
    const first = source.nodes[0]?.raw;
    if (!first) throw new Error("fixture_fact_missing");
    const facts = source.nodes.map((node) => node.raw);
    facts[0] = {
      ...first,
      subject: "危険な対象 https://attacker.invalid/source",
      short_paraphrase: "将来の説明 https://attacker.invalid/raw",
    };
    const graph = buildFactInfluenceGraph(facts, source.effective_at);
    const projection = projectFactInfluenceForRecommendation(graph, {
      merchant_id: "merchant.synthetic",
      family_ids: [first.family_id],
    });
    expect(JSON.stringify(projection)).not.toContain("attacker.invalid");
    expect(JSON.stringify(projection)).not.toContain("危険な対象");
  });

  it("rejects a graph whose count does not match its node list", () => {
    const fact = {
      graph_order: `sha256:${"a".repeat(64)}:claim.point.nanaco.earn.example.001:v0001`,
      fact_id: "11111111-1111-4111-8111-111111111111",
      implementation_version: "p0-point-rules-a.implementation.v0.1",
      implementation_hash: `sha256:${"a".repeat(64)}`,
      fact_version: 1,
      parent_claim_id: "claim.point.nanaco.earn.example.001",
      family_id: "point.nanaco",
      source_role_id: "earn_rules",
      source_ids: ["source.nanaco"],
      source_identity: [],
      claim_type: "earn_rule",
      subject: "nanaco",
      predicate: "awards_points_per_amount",
      value: { spend_jpy: 200 },
      applicability: { scope: "eligible" },
      exclusions: [],
      evidence_locator: "detail",
      short_paraphrase: "nanaco points",
      disposition: "catalogue_fact" as const,
      derived_rule_ids: [],
      reason: "non_calculable_fact",
      reason_detail: "Reference.",
      fact_payload: {},
      active_at: true,
      corrected: false,
    };
    const graph = buildFactInfluenceGraph([fact], "2026-08-21T00:00:00.000Z");
    expect(graph.fact_count).toBe(1);
    expect(() =>
      projectFactInfluenceForRecommendation(
        { ...graph, fact_count: 2 },
        { merchant_id: "merchant.synthetic" },
      ),
    ).toThrow("fact_influence_graph_count_invalid");
  });

  it("attaches the bounded graph projection to the synthetic recommendation response", async () => {
    const input = JSON.stringify({
      merchant_id: "merchant.synthetic",
      branch_id: "location.synthetic",
      amount_jpy: 640,
      owned_instruments: ["synthetic_card"],
      stored_value_use: "unknown",
      facts: [],
      caps: [],
    });
    const response = await handleRequest({
      method: "POST",
      pathname: "/api/synthetic/evaluate",
      headers: {
        "content-type": "application/json",
        "content-length": String(Buffer.byteLength(input, "utf8")),
      },
      body: input,
    });
    expect(response.status).toBe(200);
    const body = JSON.parse(response.body) as {
      recommendation?: Record<string, unknown>;
    };
    const influence = body.recommendation?.fact_influence as
      | Record<string, unknown>
      | undefined;
    expect(influence?.fact_count).toBe(364);
    expect(influence?.relevant_factor_ids).toEqual([]);
    expect(response.body).not.toMatch(
      /implementation_hash|source_ids|source_identity|evidence_locator|parent_claim_id|https?:\/\//iu,
    );
  });
});
