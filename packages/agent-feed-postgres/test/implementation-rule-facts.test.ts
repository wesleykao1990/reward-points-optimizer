import { readFileSync } from "node:fs";

import { compileP0SpendRuleSet } from "@jro/provisional-rules";
import { describe, expect, it } from "vitest";
import {
  loadCurrentP0ImplementationArtifacts,
  P0_ROUTE_GRAPH_FACTS_QUERY,
  type QueryClient,
  type QueryResult,
} from "../src/index.js";

type JsonRecord = Record<string, unknown>;

const IMPLEMENTATION_FILES = [
  "p0-point-rules-a.implementation.v0.1.json",
  "p0-point-rules-b.implementation.v0.4.json",
  "p0-wallet-card-rules.implementation.v0.5.json",
  "p0-merchant-transit-regulatory-rules.implementation.v0.6.json",
  "p0-complex-route-benchmark.implementation.v0.7.json",
] as const;

function implementationRows(
  names: readonly string[] = IMPLEMENTATION_FILES,
): JsonRecord[] {
  return names.flatMap((name) => {
    const artifact = JSON.parse(
      readFileSync(
        new URL(`../../../fixtures/m3/provisional/${name}`, import.meta.url),
        "utf8",
      ),
    ) as JsonRecord;
    const entries = artifact.entries;
    if (!Array.isArray(entries)) throw new Error("test_entries_missing");
    return entries.map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry))
        throw new Error("test_entry_invalid");
      const value = entry as JsonRecord;
      return {
        claim_id: value.parent_claim_id,
        family_id: value.family_id,
        source_role_id: value.source_role_id,
        claim_type: value.claim_type,
        subject: value.subject,
        predicate: value.predicate,
        source_ids: value.source_ids,
        value: value.value,
        applicability: value.applicability,
        research_artifact_id: artifact.research_artifact_id,
        implementation_version: artifact.version,
        implementation_hash: artifact.implementation_hash,
        as_of: artifact.as_of,
        source_identity: value.source_identity,
        exclusions: value.exclusions,
      };
    });
  });
}

function clientFor(
  rows: JsonRecord[],
  onQuery?: (text: string, values: readonly unknown[] | undefined) => void,
): QueryClient {
  return {
    async query(text, values): Promise<QueryResult<unknown>> {
      onQuery?.(text, values);
      return { rows };
    },
  };
}

function minimalRow(overrides: JsonRecord = {}): JsonRecord {
  return {
    claim_id: "claim.test.route.001",
    family_id: "family.claim",
    source_role_id: "earn_rules",
    claim_type: "transfer_rule",
    subject: "test route",
    predicate: "transfer_ratio",
    source_ids: ["source.shared"],
    value: { transfer: { source_units: "1", destination_units: "1" } },
    applicability: { status: "current_as_observed" },
    research_artifact_id: "artifact.test.research.v1",
    implementation_version: "p0-test.implementation.v1",
    implementation_hash: `sha256:${"a".repeat(64)}`,
    as_of: "2026-08-24T00:00:00.000Z",
    source_identity: [
      {
        source_id: "source.shared",
        family_id: "family.source",
        roles: ["earn_rules"],
        url: "https://example.invalid/route",
        publisher: "Example Publisher",
        official_domain: "example.invalid",
      },
    ],
    exclusions: ["not a reward-rate claim"],
    ...overrides,
  };
}

describe("PostgreSQL route-graph implementation-fact adapter", () => {
  it("rebuilds exact per-artifact sources and compiles complex routes", async () => {
    let queryText: string | undefined;
    let queryValues: readonly unknown[] | undefined;
    const result = await loadCurrentP0ImplementationArtifacts(
      clientFor(implementationRows(), (text, values) => {
        queryText = text;
        queryValues = values;
      }),
      "2026-08-25T00:00:00.000Z",
    );

    expect(queryText).toBe(P0_ROUTE_GRAPH_FACTS_QUERY);
    expect(queryValues).toEqual(["2026-08-25T00:00:00.000Z"]);
    expect(result.artifacts).toHaveLength(5);
    const complex = result.artifacts.find(
      (artifact) =>
        (artifact as { metadata?: { artifact_id?: string } }).metadata
          ?.artifact_id === "p0-complex-route-benchmark.research.v0.1",
    ) as {
      claims: Array<{ exclusions: readonly string[] }>;
      sources: Array<{ source_id: string; family_id: string }>;
    };
    expect(complex.sources.length).toBeGreaterThan(0);
    expect(
      new Set(complex.sources.map((source) => source.source_id)).size,
    ).toBe(complex.sources.length);
    expect(complex.claims.some((claim) => claim.exclusions.length > 0)).toBe(
      true,
    );

    const compiled = compileP0SpendRuleSet([...result.artifacts]);
    expect(compiled.rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rule_id: "p0.transfer.v-to-ana-ana-card" }),
        expect.objectContaining({
          rule_id: "p0.transfer.jr-kyupo-to-saison-permanent",
        }),
        expect.objectContaining({ rule_id: "p0.transfer.revolut-to-ana-pay" }),
        expect.objectContaining({
          rule_id: "p0.transfer.saison-permanent-to-ana-mizuho",
        }),
      ]),
    );
  });

  it("allows a legitimate source-family difference and preserves exclusions", async () => {
    const row = minimalRow();
    const result = await loadCurrentP0ImplementationArtifacts(
      clientFor([row]),
      "2026-08-25T00:00:00.000Z",
    );
    const artifact = result.artifacts[0] as {
      claims: Array<{ exclusions: readonly string[] }>;
      sources: Array<{ family_id: string }>;
    };
    expect(artifact.sources[0]?.family_id).toBe("family.source");
    expect(artifact.claims[0]?.exclusions).toEqual(["not a reward-rate claim"]);
  });

  it("fails closed on malformed, missing, proxied, or accessor-bearing rows", async () => {
    const malformed = minimalRow({ source_identity: "not-json" });
    await expect(
      loadCurrentP0ImplementationArtifacts(
        clientFor([malformed]),
        "2026-08-25T00:00:00.000Z",
      ),
    ).rejects.toThrow("p0_implementation_fact_source_identity_invalid");

    const missing = minimalRow();
    delete missing.source_identity;
    await expect(
      loadCurrentP0ImplementationArtifacts(
        clientFor([missing]),
        "2026-08-25T00:00:00.000Z",
      ),
    ).rejects.toThrow("p0_implementation_fact_row_shape_invalid");

    const proxied = new Proxy(minimalRow(), {});
    await expect(
      loadCurrentP0ImplementationArtifacts(
        clientFor([proxied]),
        "2026-08-25T00:00:00.000Z",
      ),
    ).rejects.toThrow("p0_implementation_fact_row_shape_invalid");

    let reads = 0;
    const accessor = minimalRow();
    Object.defineProperty(accessor, "source_identity", {
      enumerable: true,
      get() {
        reads += 1;
        throw new Error("getter_read");
      },
    });
    await expect(
      loadCurrentP0ImplementationArtifacts(
        clientFor([accessor]),
        "2026-08-25T00:00:00.000Z",
      ),
    ).rejects.toThrow("p0_implementation_fact_row_shape_invalid");
    expect(reads).toBe(0);
  });

  it("rejects conflicting repeated source identities and duplicate source IDs", async () => {
    const first = minimalRow();
    const conflicting = minimalRow({
      claim_id: "claim.test.route.002",
      source_identity: [
        {
          source_id: "source.shared",
          family_id: "family.source",
          roles: ["earn_rules"],
          url: "https://example.invalid/changed",
          publisher: "Example Publisher",
          official_domain: "example.invalid",
        },
      ],
    });
    await expect(
      loadCurrentP0ImplementationArtifacts(
        clientFor([first, conflicting]),
        "2026-08-25T00:00:00.000Z",
      ),
    ).rejects.toThrow("p0_implementation_fact_source_identity_conflict");

    await expect(
      loadCurrentP0ImplementationArtifacts(
        clientFor([
          minimalRow({
            source_ids: ["source.shared", "source.shared"],
          }),
        ]),
        "2026-08-25T00:00:00.000Z",
      ),
    ).rejects.toThrow("p0_implementation_fact_source_ids_invalid");
  });
});
