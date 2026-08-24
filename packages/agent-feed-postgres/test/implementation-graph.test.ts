import { describe, expect, it } from "vitest";
import {
  createPostgresP0FactInfluenceGraphStore,
  P0_FACT_INFLUENCE_GRAPH_QUERY,
  type QueryClient,
  type QueryResult,
} from "../src/index.js";

type JsonRecord = Record<string, unknown>;

function graphRow(overrides: JsonRecord = {}): JsonRecord {
  return {
    graph_order: `sha256:${"a".repeat(64)}:claim.point.nanaco.earn.example.001:v0001`,
    fact_id: "11111111-1111-4111-8111-111111111111",
    implementation_version: "p0-point-rules-a.implementation.v0.1",
    implementation_hash: `sha256:${"a".repeat(64)}`,
    fact_version: 1,
    parent_claim_id: "claim.point.nanaco.earn.example.001",
    family_id: "point.nanaco",
    source_role_id: "earn_rules",
    source_ids: ["source.nanaco.earn"],
    source_identity: [
      {
        source_id: "source.nanaco.earn",
        family_id: "point.nanaco",
        roles: ["earn_rules"],
        url: "https://example.invalid/source",
        publisher: "Example",
        official_domain: "example.invalid",
      },
    ],
    claim_type: "earn_rule",
    subject: "nanaco",
    predicate: "awards_points_per_amount",
    value: { spend_jpy: 200, reward_units: 1 },
    applicability: { scope: "eligible", timezone: "Asia/Tokyo" },
    exclusions: [],
    evidence_locator: "detail",
    short_paraphrase: "Eligible purchases earn points.",
    disposition: "catalogue_fact",
    derived_rule_ids: [],
    reason: "non_calculable_fact",
    reason_detail: "Reference only.",
    fact_payload: {
      parent_claim_id: "claim.point.nanaco.earn.example.001",
      value: { spend_jpy: 200, reward_units: 1 },
    },
    active_at: true,
    corrected: false,
    total_count: 5,
    ...overrides,
  };
}

function completeRows(count = 5, reportedTotal = count): JsonRecord[] {
  return Array.from({ length: count }, (_, index) => {
    const suffix = (index + 1).toString(16).padStart(12, "0");
    const hashHex = (index + 1).toString(16).padStart(64, "0");
    const claim = `claim.point.nanaco.earn.example.${String(index + 1).padStart(3, "0")}`;
    return graphRow({
      graph_order: `sha256:${hashHex}:${claim}:v0001`,
      fact_id: `00000000-0000-4000-8000-${suffix}`,
      implementation_hash: `sha256:${hashHex}`,
      parent_claim_id: claim,
      total_count: reportedTotal,
    });
  });
}

function clientFor(
  handler: (
    text: string,
    values: readonly unknown[] | undefined,
  ) => QueryResult<unknown>,
): QueryClient {
  return {
    async query(text, values) {
      return handler(text, values);
    },
  };
}

describe("PostgreSQL P0 fact influence graph adapter", () => {
  it("requests bounded complete material and keeps deterministic order", async () => {
    let valuesSeen: readonly unknown[] | undefined;
    const rows = completeRows();
    const first = rows[1];
    const second = rows[0];
    if (!first || !second) throw new Error("test_rows_missing");
    const target = clientFor((text, values) => {
      expect(text).toBe(P0_FACT_INFLUENCE_GRAPH_QUERY);
      valuesSeen = values;
      return { rows: [first, ...rows.slice(2), second] };
    });
    const result = await createPostgresP0FactInfluenceGraphStore(target, {
      clock: () => new Date("2026-08-21T00:00:00.000Z"),
    }).list();
    expect(valuesSeen).toEqual(["2026-08-21T00:00:00.000Z", 4097]);
    expect(result.version).toBe("p0-fact-influence-graph-source.v1");
    expect(result.fact_count).toBe(rows.length);
    expect(result.facts.map((fact) => fact.graph_order)).toEqual([
      second.graph_order,
      first.graph_order,
      ...rows.slice(2).map((row) => row.graph_order as string),
    ]);
    expect(result.facts[0]?.value).toEqual({ spend_jpy: 200, reward_units: 1 });
    expect(result.facts[0]?.source_identity).toEqual([
      expect.objectContaining({ url: "https://example.invalid/source" }),
    ]);
  });

  it("preserves correction and effective-time flags instead of filtering rows", async () => {
    const rows = completeRows();
    const corrected = rows[0];
    if (!corrected) throw new Error("test_rows_missing");
    rows[0] = { ...corrected, active_at: false, corrected: true };
    const target = clientFor(() => ({
      rows,
    }));
    const result = await createPostgresP0FactInfluenceGraphStore(target).list(
      "2026-08-21T00:00:00.000Z",
    );
    expect(result.facts).toHaveLength(rows.length);
    expect(result.facts.find((fact) => fact.corrected)).toMatchObject({
      active_at: false,
      corrected: true,
    });
  });

  it("rejects truncated material against the SQL-reported total", async () => {
    for (const count of [1, 4]) {
      const target = clientFor(() => ({ rows: completeRows(count, 5) }));
      await expect(
        createPostgresP0FactInfluenceGraphStore(target).list(),
      ).rejects.toThrow("p0_fact_influence_graph_incomplete");
    }
  });

  it("fails closed when the bounded query overflows or repeats identity", async () => {
    const overflow = clientFor(() => ({
      rows: completeRows(4097),
    }));
    await expect(
      createPostgresP0FactInfluenceGraphStore(overflow).list(),
    ).rejects.toThrow("p0_fact_influence_graph_too_many_rows");
    const duplicateRows = completeRows();
    const duplicate = duplicateRows[1];
    const original = duplicateRows[0];
    if (!duplicate || !original) throw new Error("test_rows_missing");
    duplicateRows[1] = { ...duplicate, graph_order: original.graph_order };
    const duplicateTarget = clientFor(() => ({ rows: duplicateRows }));
    await expect(
      createPostgresP0FactInfluenceGraphStore(duplicateTarget).list(),
    ).rejects.toThrow("p0_fact_influence_graph_duplicate_order");
  });

  it("rejects hostile nested getters without reading them", async () => {
    let reads = 0;
    const hostile = Object.create(null) as JsonRecord;
    Object.defineProperty(hostile, "secret", {
      enumerable: true,
      get() {
        reads += 1;
        throw new Error("getter_read");
      },
    });
    const rows = completeRows();
    const original = rows[0];
    if (!original) throw new Error("test_rows_missing");
    rows[0] = { ...original, value: { nested: hostile } };
    const target = clientFor(() => ({ rows }));
    await expect(
      createPostgresP0FactInfluenceGraphStore(target).list(),
    ).rejects.toThrow(
      "p0_fact_influence_graph_value_nested_descriptor_invalid",
    );
    expect(reads).toBe(0);
  });
});
