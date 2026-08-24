import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildFactInfluenceGraph,
  classifyFactInfluence,
  FACT_GRAPH_ROLES,
  getDefaultFactInfluenceGraphPort,
  projectFactInfluenceForRecommendation,
} from "../src/fact-influence-graph.js";
import { handleRequest } from "../src/server.js";

describe("P0 fact influence graph", () => {
  it("builds a deterministic graph from the complete fixture wave", async () => {
    const port = getDefaultFactInfluenceGraphPort();
    const first = await port.load("2026-08-21T00:00:00.000Z");
    const second = await port.load("2026-08-21T00:00:00.000Z");
    expect(first.fact_count).toBeGreaterThan(0);
    expect(first.nodes).toHaveLength(first.fact_count);
    expect(first.graph_hash).toBe(second.graph_hash);
    expect(first.nodes.map((node) => node.factor_id)).toEqual(
      second.nodes.map((node) => node.factor_id),
    );
    expect(new Set(first.nodes.map((node) => node.factor_id)).size).toBe(
      first.fact_count,
    );
    expect(first.nodes.every((node) => node.raw.value !== undefined)).toBe(
      true,
    );
  });

  it("partitions every P0 fact into one deterministic primary graph role", async () => {
    const graph = await getDefaultFactInfluenceGraphPort().load(
      "2026-08-21T00:00:00.000Z",
    );
    const counts = Object.fromEntries(
      FACT_GRAPH_ROLES.map((role) => [
        role,
        graph.nodes.filter((node) => node.graph_role === role).length,
      ]),
    );
    expect(counts.applied).toBeGreaterThanOrEqual(2);
    expect(
      graph.nodes.every((node) =>
        (FACT_GRAPH_ROLES as readonly string[]).includes(node.graph_role),
      ),
    ).toBe(true);
    expect(
      Object.values(counts).reduce((total, count) => total + count, 0),
    ).toBe(graph.fact_count);
    expect(graph.nodes.filter((node) => node.graph_role === "applied")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          graph_role: "applied",
          raw: expect.objectContaining({
            parent_claim_id: "claim.point.nanaco.earn.shopping-immediate.004",
          }),
        }),
        expect.objectContaining({
          graph_role: "applied",
          raw: expect.objectContaining({
            parent_claim_id: "claim.point.nanaco.earn.credit-charge.003",
          }),
        }),
      ]),
    );
    expect(
      graph.nodes
        .filter((node) => node.raw.family_id.startsWith("reg."))
        .every((node) => node.graph_role === "warning" && !node.rankable),
    ).toBe(true);
  });

  it("keeps ordering and graph hash stable under fact permutation", async () => {
    const source = await getDefaultFactInfluenceGraphPort().load(
      "2026-08-21T00:00:00.000Z",
    );
    const permuted = buildFactInfluenceGraph(
      [...source.nodes].reverse().map((node) => node.raw),
      source.effective_at,
    );
    expect(permuted.graph_hash).toBe(source.graph_hash);
    expect(permuted.nodes.map((node) => node.factor_id)).toEqual(
      source.nodes.map((node) => node.factor_id),
    );
    expect(permuted.nodes.map((node) => node.graph_role)).toEqual(
      source.nodes.map((node) => node.graph_role),
    );
  });

  it("binds the graph hash to normalized fact content, not only node metadata", async () => {
    const source = await getDefaultFactInfluenceGraphPort().load(
      "2026-08-21T00:00:00.000Z",
    );
    const first = source.nodes[0];
    if (!first) throw new Error("fixture_fact_missing");
    const mutated = buildFactInfluenceGraph(
      source.nodes.map((node) =>
        node === first
          ? {
              ...node.raw,
              value: { changed_for_integrity_test: true },
              short_paraphrase: `${node.raw.short_paraphrase}（内容変更）`,
            }
          : node.raw,
      ),
      source.effective_at,
    );
    expect(mutated.graph_hash).not.toBe(source.graph_hash);
    const reordered = buildFactInfluenceGraph(
      [...source.nodes].reverse().map((node) => node.raw),
      source.effective_at,
    );
    expect(reordered.graph_hash).toBe(source.graph_hash);
  });

  it("marks corrected and inactive facts as warnings and never rankable", async () => {
    const source = await getDefaultFactInfluenceGraphPort().load(
      "2026-08-21T00:00:00.000Z",
    );
    const first = source.nodes[0];
    if (!first) throw new Error("fixture_fact_missing");
    const corrected = buildFactInfluenceGraph(
      source.nodes.map((node) =>
        node === first ? { ...node.raw, corrected: true } : node.raw,
      ),
      source.effective_at,
    );
    const correctedNode = corrected.nodes.find(
      (node) => node.factor_id === first.factor_id,
    );
    expect(correctedNode).toMatchObject({
      graph_role: "warning",
      corrected: true,
      rankable: false,
    });

    const inactive = buildFactInfluenceGraph(
      source.nodes.map((node) =>
        node === first ? { ...node.raw, active_at: false } : node.raw,
      ),
      source.effective_at,
    );
    expect(
      inactive.nodes.find((node) => node.factor_id === first.factor_id),
    ).toMatchObject({
      graph_role: "warning",
      active: false,
      rankable: false,
    });
  });

  it("does not treat a claim ID alone as an applied RuleIR binding", async () => {
    const source = await getDefaultFactInfluenceGraphPort().load(
      "2026-08-21T00:00:00.000Z",
    );
    const applied = source.nodes.find((node) => node.graph_role === "applied");
    if (!applied) throw new Error("applied_fact_missing");
    const graph = buildFactInfluenceGraph(
      source.nodes.map((node) =>
        node === applied
          ? { ...node.raw, predicate: "narrative_only_predicate" }
          : node.raw,
      ),
      source.effective_at,
    );
    expect(
      graph.nodes.find((node) => node.factor_id === applied.factor_id),
    ).toMatchObject({ graph_role: "question" });
    expect(() =>
      projectFactInfluenceForRecommendation(
        graph,
        { merchant_id: "merchant.seveneleven", payment_method: "nanaco" },
        [applied.raw.parent_claim_id],
      ),
    ).toThrow("fact_influence_applied_claim_unavailable");
  });

  it("ranks only an explicitly marked executable RuleIR fact", async () => {
    const source = await getDefaultFactInfluenceGraphPort().load(
      "2026-08-21T00:00:00.000Z",
    );
    const first = source.nodes[0];
    if (!first) throw new Error("fixture_fact_missing");
    const executable = buildFactInfluenceGraph(
      source.nodes.map((node) =>
        node === first
          ? {
              ...node.raw,
              disposition: "engine_rule" as const,
              derived_rule_ids: ["rule.example"],
              active_at: true,
              corrected: false,
            }
          : node.raw,
      ),
      source.effective_at,
    );
    expect(
      executable.nodes.find((node) => node.factor_id === first.factor_id),
    ).toMatchObject({ rankable: true });

    const unvalidated = buildFactInfluenceGraph(
      source.nodes.map((node) =>
        node === first
          ? {
              ...node.raw,
              disposition: "engine_rule" as const,
              derived_rule_ids: ["not-a-rule-id"],
              active_at: true,
              corrected: false,
            }
          : node.raw,
      ),
      source.effective_at,
    );
    expect(
      unvalidated.nodes.find((node) => node.factor_id === first.factor_id),
    ).toMatchObject({ rankable: false });
  });

  it("gives every non-applied role a useful Japanese message without exposing graph roles in the UI", async () => {
    const graph = await getDefaultFactInfluenceGraphPort().load(
      "2026-08-21T00:00:00.000Z",
    );
    expect(
      graph.nodes
        .filter((node) => node.graph_role !== "applied")
        .every((node) =>
          [node.question, node.warning, node.information].some(
            (value) =>
              typeof value === "string" &&
              value.length > 0 &&
              /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(
                value,
              ),
          ),
        ),
    ).toBe(true);
    expect(
      graph.nodes
        .filter((node) => node.graph_role === "constraint")
        .every((node) => node.information !== null),
    ).toBe(true);
    expect(
      graph.nodes
        .filter((node) => node.graph_role === "question")
        .every((node) => node.question !== null),
    ).toBe(true);
    expect(
      graph.nodes
        .filter((node) => node.graph_role === "warning")
        .every((node) => node.warning !== null),
    ).toBe(true);
    const app = readFileSync(
      new URL("../public/app.js", import.meta.url),
      "utf8",
    );
    for (const label of ["適用候補", "条件候補・要確認", "判定に反映した情報"])
      expect(app).not.toContain(label);
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
    expect(projection.fact_count).toBe(graph.fact_count);
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

  it("separates route-bound application from static applied capability", async () => {
    const graph = await getDefaultFactInfluenceGraphPort().load(
      "2026-08-21T00:00:00.000Z",
    );
    const purchase = projectFactInfluenceForRecommendation(
      graph,
      { merchant_id: "merchant.seveneleven", payment_method: "nanaco" },
      ["claim.point.nanaco.earn.shopping-immediate.004"],
    );
    const credit = projectFactInfluenceForRecommendation(
      graph,
      { merchant_id: "merchant.seveneleven", payment_method: "nanaco" },
      ["claim.point.nanaco.earn.credit-charge.003"],
    );
    for (const projection of [purchase, credit]) {
      expect(
        projection.factors.filter((factor) => factor.graph_role === "applied"),
      ).toHaveLength(2);
      expect(projection.applied_count).toBe(1);
      expect(
        projection.factors.filter((factor) => factor.applied),
      ).toHaveLength(1);
      expect(
        projection.factors
          .filter((factor) => factor.applied)
          .every((factor) => factor.graph_role === "applied"),
      ).toBe(true);
    }
  });

  it("does not present unrelated constraints as checked on a purchase route", async () => {
    const graph = await getDefaultFactInfluenceGraphPort().load(
      "2026-08-21T00:00:00.000Z",
    );
    const projection = projectFactInfluenceForRecommendation(
      graph,
      { merchant_id: "merchant.seveneleven", payment_method: "nanaco" },
      ["claim.point.nanaco.earn.shopping-immediate.004"],
    );
    const constraints = projection.factors.filter(
      (factor) => factor.graph_role === "constraint",
    );
    expect(constraints.length).toBeGreaterThan(0);
    expect(constraints.every((factor) => factor.applied === false)).toBe(true);
    expect(
      constraints.every(
        (factor) =>
          factor.information?.includes("まだ照合していません") === true &&
          !factor.information?.includes("照合する情報"),
      ),
    ).toBe(true);
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
    expect(influence?.fact_count).toEqual(expect.any(Number));
    expect(influence?.relevant_factor_ids).toEqual([]);
    expect(response.body).not.toMatch(
      /implementation_hash|source_ids|source_identity|evidence_locator|parent_claim_id|https?:\/\//iu,
    );
  });
});
