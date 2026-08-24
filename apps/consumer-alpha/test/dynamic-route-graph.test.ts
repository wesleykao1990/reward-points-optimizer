import { promises as fs } from "node:fs";

import { beforeAll, describe, expect, it } from "vitest";
import { recommendPaymentStack } from "../src/payment-stack-recommendation.js";
import {
  listPointSpendBrowserOptions,
  type RouteGraphSourcePort,
  recommendPointSpend,
} from "../src/point-spend-recommendation.js";
import { createPostgresRouteGraphSourcePort } from "../src/postgres-catalogue.js";

/**
 * The routing graph compiled from database facts rather than from fixtures.
 *
 * These use a driver-free query double rather than a live server, so the
 * projection's row shape is exercised without a PostgreSQL dependency; the
 * migration itself is covered by the SQL gate.
 */

const RESEARCH_FILES = [
  "p0-point-rules-a.research.v0.1.json",
  "p0-point-rules-b.research.v0.1.json",
  "p0-wallet-card-rules.research.v0.1.json",
  "p0-merchant-transit-regulatory-rules.research.v0.1.json",
] as const;

interface Claim {
  readonly claim_id: string;
  readonly family_id: string;
  readonly source_role_id: string;
  readonly claim_type: string;
  readonly subject: string;
  readonly predicate: string;
  readonly source_ids: readonly string[];
  readonly value: unknown;
  readonly applicability: unknown;
}

let rows: Record<string, unknown>[] = [];

/** Project the fixtures into the exact shape the SQL projection returns. */
function factRows(
  artifacts: readonly { metadata: { artifact_id: string }; claims: Claim[] }[],
): Record<string, unknown>[] {
  return artifacts.flatMap((artifact, index) =>
    artifact.claims.map((claim) => ({
      claim_id: claim.claim_id,
      family_id: claim.family_id,
      source_role_id: claim.source_role_id,
      claim_type: claim.claim_type,
      subject: claim.subject,
      predicate: claim.predicate,
      source_ids: claim.source_ids,
      value: claim.value,
      applicability: claim.applicability,
      research_artifact_id: artifact.metadata.artifact_id,
      implementation_version: `p0-set-${index}.implementation.v1`,
      implementation_hash: `sha256:${String(index).repeat(64).slice(0, 64)}`,
      // node-postgres hands back a Date for timestamptz.
      as_of: new Date("2026-08-22T00:20:17+09:00"),
    })),
  );
}

function target(supplied: Record<string, unknown>[] = rows) {
  let calls = 0;
  return {
    calls: () => calls,
    query: async <Row>() => {
      calls += 1;
      return { rows: supplied as unknown as Row[] };
    },
  };
}

const input = {
  source_asset_id: "asset.point.rakuten",
  target_asset_id: "asset.mile.ana",
  balance: 1000,
  objective: "maximize_target" as const,
  effective_at: "2026-08-23T12:00:00+09:00",
  confirmed_rule_ids: ["p0.transfer.rakuten.ana"],
  unit_value_jpy: null,
};

describe("dynamic route graph", () => {
  beforeAll(async () => {
    const artifacts = await Promise.all(
      RESEARCH_FILES.map(async (name) =>
        JSON.parse(
          await fs.readFile(
            new URL(`../../../fixtures/m3/agent-feed/${name}`, import.meta.url),
            "utf8",
          ),
        ),
      ),
    );
    rows = factRows(artifacts);
  });

  it("compiles the same graph from database facts as from the fixtures", async () => {
    const source = createPostgresRouteGraphSourcePort(target());
    const dynamic = await recommendPointSpend(input, source);
    const bundled = await recommendPointSpend(input);
    expect(dynamic.data_origin).toBe("database");
    expect(bundled.data_origin).toBe("bundled_fixture");
    // Identical claims must produce an identical answer whichever side they
    // arrived from; only the provenance differs.
    expect(dynamic.winner?.target_amount).toBe(bundled.winner?.target_amount);
    expect(dynamic.rule_count).toBe(bundled.rule_count);
    expect(dynamic.data_as_of).toBe("2026-08-21T15:20:17.000Z");
    expect(dynamic.data_fallback_reason).toBeNull();
  });

  it("reflects an updated rate without a redeploy", async () => {
    const changedClaim = "claim.point.rakuten.transfer.rakuten-to-ana-rate.001";
    const changedArtifact = rows.find(
      (row) => row.claim_id === changedClaim,
    )?.research_artifact_id;
    expect(changedArtifact).toBeTypeOf("string");
    // A refreshed research artifact republishes every one of its facts under a
    // new snapshot hash, so the whole group moves together.
    const updated = rows.map((row) => {
      if (row.research_artifact_id !== changedArtifact) return row;
      const rehashed = {
        ...row,
        implementation_hash: `sha256:${"a".repeat(64)}`,
      };
      return row.claim_id === changedClaim
        ? {
            ...rehashed,
            // A published devaluation of the same route: 2:1 becomes 4:1.
            value: {
              source_points: 4,
              destination_miles: 1,
              minimum_points: 50,
              fee: "free",
            },
          }
        : rehashed;
    });
    const before = await recommendPointSpend(
      input,
      createPostgresRouteGraphSourcePort(target()),
    );
    const after = await recommendPointSpend(
      input,
      createPostgresRouteGraphSourcePort(target(updated)),
    );
    expect(before.winner?.target_amount).toBe("500");
    expect(after.winner?.target_amount).toBe("250");
  });

  it("refuses rows that mix two snapshots of one artifact", async () => {
    const mixed = rows.map((row, index) =>
      index === 1
        ? { ...row, implementation_hash: `sha256:${"b".repeat(64)}` }
        : row,
    );
    const result = await recommendPointSpend(
      input,
      createPostgresRouteGraphSourcePort(target(mixed)),
    );
    expect(result.data_origin).toBe("bundled_fixture");
    expect(result.data_fallback_reason).toContain(
      "p0_implementation_fact_snapshot_inconsistent",
    );
  });

  it("recompiles only when a snapshot hash changes", async () => {
    const first = target();
    await recommendPointSpend(input, createPostgresRouteGraphSourcePort(first));
    const second = target();
    await recommendPointSpend(
      input,
      createPostgresRouteGraphSourcePort(second),
    );
    // Claims are read on every request so a refresh is never missed, even
    // though the compiled graph is reused.
    expect(first.calls()).toBe(1);
    expect(second.calls()).toBe(1);
  });

  it("falls back to the fixtures and says why when the database fails", async () => {
    const failing: RouteGraphSourcePort = {
      async current() {
        throw new Error("connection_refused");
      },
    };
    const result = await recommendPointSpend(input, failing);
    expect(result.data_origin).toBe("bundled_fixture");
    expect(result.data_fallback_reason).toBe("connection_refused");
    // The answer is still served rather than the surface going dark.
    expect(result.winner?.target_amount).toBe("500");
  });

  it("falls back when the database holds no facts yet", async () => {
    const empty = createPostgresRouteGraphSourcePort(target([]));
    const result = await recommendPointSpend(input, empty);
    expect(result.data_origin).toBe("bundled_fixture");
    expect(result.data_fallback_reason).toBe("route_graph_source_empty");
  });

  it("refuses a row that is not what the projection promises", async () => {
    const malformed = createPostgresRouteGraphSourcePort(
      target([{ ...rows[0], source_ids: "not-an-array" }]),
    );
    const result = await recommendPointSpend(input, malformed);
    expect(result.data_origin).toBe("bundled_fixture");
    expect(result.data_fallback_reason).toContain(
      "p0_implementation_fact_source_ids_invalid",
    );
  });

  it("serves the payment stack and the options list dynamically too", async () => {
    const stack = await recommendPaymentStack(
      {
        merchant_id: "merchant.any",
        amount_jpy: 10_000,
        owned_family_ids: ["card.aupay", "wallet.aupay"],
        effective_at: "2026-08-23T12:00:00+09:00",
        confirmed_option_ids: [],
      },
      createPostgresRouteGraphSourcePort(target()),
    );
    expect(stack.data_origin).toBe("database");
    expect(stack.winner?.native_reward_points).toBe("200");

    const options = await listPointSpendBrowserOptions(
      createPostgresRouteGraphSourcePort(target()),
    );
    expect(options.data_origin).toBe("database");
    expect(options.data_as_of).toBe("2026-08-21T15:20:17.000Z");
  });
});
