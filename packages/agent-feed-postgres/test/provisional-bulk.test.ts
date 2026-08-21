import { describe, expect, it } from "vitest";
import {
  createPostgresP0NanacoEconomicBatchProcessor,
  type P0EconomicCandidatePersistencePort,
  processP0NanacoEconomicBatch,
} from "../src/index.js";

const TIME = "2026-08-21T00:05:00Z";

function observation(
  id: string,
  fingerprint: string = "a",
): Record<string, unknown> {
  return {
    observation_id: id,
    agent_feed: {
      protocol_version: "0.1",
      event_id: `event_${id}`,
      stream_id: "economy.seven-nanaco",
      run_id: "7f727453-b5d3-4585-8f87-44ffb0b380d3",
      finding_id: "nanaco-economic-ui-canary-20260821-v1",
    },
    source_ids: ["jp.nanaco.shopping-earning"],
    subjects: [
      { type: "loyalty_program", id: "program.jp.nanaco", name: "nanaco" },
      {
        type: "merchant",
        id: "merchant.seveneleven",
        name: "Seven-Eleven",
      },
    ],
    change_type: "reward_rate",
    summary: "The supported Nanaco purchase reward canary finding.",
    effective_time: {
      occurred_at: null,
      effective_from: null,
      effective_to: null,
    },
    discovery_assessment: {
      source_authority_claim: "primary",
      evidence_completeness: "complete",
      agent_confidence: 0.95,
    },
    submitted_evidence_refs: [
      "nanaco-shopping-earning-evidence-canary-20260821-v1",
    ],
    canonical_evidence_ids: [],
    semantic_fingerprint_version: 1,
    semantic_fingerprint: `sha256:${fingerprint.repeat(64)}`,
    status: "needs_review",
    security_flags: [],
    raw_attributes: {
      change_type: "reward_rate",
      program_id: "program.jp.nanaco",
      merchant_id: "merchant.seveneleven",
      reward_rate: {
        reward_units: "1",
        spend_jpy: 200,
        spend_basis: "tax_exclusive",
      },
      eligible_product_class: "ordinary",
      posting_timing: "immediate_for_listed_merchant",
      product_exclusions_apply: true,
      canonical_publication: false,
      human_verified: false,
    },
    created_at: TIME,
    updated_at: TIME,
  };
}

function fakePort(calls: string[]): P0EconomicCandidatePersistencePort {
  return {
    async persist(input) {
      calls.push(input.candidate_hash);
      return {
        candidate_id: `db-${calls.length}`,
        outcome: calls.length === 1 ? "inserted" : "duplicate",
        status: "machine_checked",
      };
    },
  };
}

describe("P0 Nanaco economic bulk ingestion", () => {
  it("persists valid neighbors and reports ordinary semantic rejection", async () => {
    const calls: string[] = [];
    const result = await processP0NanacoEconomicBatch(
      [
        observation("so_nanaco_valid"),
        { ...observation("so_nanaco_invalid"), status: "rejected" },
      ],
      fakePort(calls),
    );
    expect(result.ok).toBe(true);
    expect(result.status).toBe("mixed");
    expect(result.members[0]?.status).toBe("inserted");
    expect(result.members[1]?.status).toBe("rejected");
    expect(calls).toHaveLength(1);
  });

  it("rejects an all-semantic-rejection batch without database calls", async () => {
    const calls: string[] = [];
    const result = await processP0NanacoEconomicBatch(
      [
        { ...observation("so_nanaco_invalid_a"), status: "rejected" },
        { ...observation("so_nanaco_invalid_b"), status: "rejected" },
      ],
      fakePort(calls),
    );
    expect(result.ok).toBe(false);
    expect(result.status).toBe("rejected");
    expect(result.members.map((member) => member.status)).toEqual([
      "rejected",
      "rejected",
    ]);
    expect(calls).toEqual([]);
  });

  it("rejects a hostile representation globally before any database call", async () => {
    const hostile = observation("so_nanaco_hostile");
    Object.defineProperty(hostile, "status", {
      enumerable: true,
      get() {
        throw new Error("status getter must not run");
      },
    });
    const calls: string[] = [];
    const result = await processP0NanacoEconomicBatch(
      [hostile, observation("so_nanaco_valid_after_hostile")],
      fakePort(calls),
    );
    expect(result.ok).toBe(false);
    expect(result.status).toBe("rejected");
    expect(result.members).toHaveLength(1);
    expect(result.members[0]?.input_index).toBe(-1);
    expect(
      result.members[0]?.issues?.some(
        (issue) => issue.code === "accessor_property",
      ),
    ).toBe(true);
    expect(calls).toEqual([]);
  });

  it("orders by candidate hash and accounts for duplicate input plus retry outcome", async () => {
    const calls: string[] = [];
    const port = fakePort(calls);
    const first = await processP0NanacoEconomicBatch(
      [observation("so_nanaco_b"), observation("so_nanaco_a")],
      port,
    );
    expect(first.ok).toBe(true);
    expect(calls).toEqual([...calls].sort());

    const duplicateCalls: string[] = [];
    const duplicate = await processP0NanacoEconomicBatch(
      [observation("so_nanaco_a"), observation("so_nanaco_a")],
      fakePort(duplicateCalls),
    );
    expect(duplicate.ok).toBe(true);
    expect(duplicate.members.map((member) => member.status)).toEqual([
      "inserted",
      "duplicate",
    ]);
    expect(duplicateCalls).toHaveLength(1);
  });

  it("uses a caller-owned query target and one transaction", async () => {
    const statements: string[] = [];
    const target = {
      async query(text: string) {
        statements.push(text.trim().split("\n")[0] ?? "");
        if (text.includes("persist_p0_economic_candidate"))
          return {
            rows: [
              {
                candidate_id: "candidate-db-id",
                outcome: "inserted",
                status: "machine_checked",
              },
            ],
          };
        return { rows: [] };
      },
    };
    const process = createPostgresP0NanacoEconomicBatchProcessor(target);
    const result = await process([observation("so_nanaco_query")]);
    expect(result.ok).toBe(true);
    expect(statements).toEqual([
      "BEGIN",
      "select candidate_id, outcome, status",
      "COMMIT",
    ]);
  });

  it("does not open a transaction when every member is semantically rejected", async () => {
    const statements: string[] = [];
    let connects = 0;
    const target = {
      async query(text: string) {
        statements.push(text);
        return { rows: [] };
      },
      async connect() {
        connects += 1;
        throw new Error("pool checkout must not run");
      },
    };
    const process = createPostgresP0NanacoEconomicBatchProcessor(target);
    const result = await process([
      { ...observation("so_nanaco_only_invalid"), status: "rejected" },
    ]);
    expect(result).toMatchObject({ ok: false, status: "rejected" });
    expect(connects).toBe(0);
    expect(statements).toEqual([]);
  });
});
