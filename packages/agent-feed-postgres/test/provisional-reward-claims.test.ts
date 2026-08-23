import { freezeP0CoverageIndex } from "@jro/provisional-rules";
import { describe, expect, it } from "vitest";
import {
  createPostgresP0RewardClaimBatchProcessor,
  P0_PROVISIONAL_CANDIDATE_QUERY,
  P0_REWARD_CLAIM_BATCH_VERSION,
  type P0EconomicCandidatePersistencePort,
  processP0RewardClaimBatch,
} from "../src/index.js";

const COVERAGE = freezeP0CoverageIndex({
  version: "p0-coverage-index.v1",
  entries: [
    {
      family_id: "test.family",
      source_role_id: "test_role",
      known_source_ids: ["source.test"],
    },
  ],
});

const REWARD_ASSET = {
  asset_id: "asset.test-point",
  asset_kind: "reward_point",
  program_id: "program.test",
  reward_class: "normal",
  scale: 0,
};

const SUBJECT = {
  entity_type: "stored_value_program",
  entity_id: "program.test",
};

const SCOPE = {
  countries: ["JP"],
  operation_types: ["merchant_purchase"],
  channels: ["in_store"],
  merchant_ids: ["merchant.test"],
  tax_basis: "tax_inclusive",
};

const ELIGIBILITY = {
  operation_match: {
    required_loyalty_program_ids: ["program.test"],
    allowed_payment_instrument_ids: ["instrument.test"],
  },
  user_conditions: [],
  transaction_conditions: {
    eligible_amount_basis: "operation_amount",
  },
  campaign_conditions: {},
};

const OUTPUT = {
  asset: REWARD_ASSET,
  sign: "credit",
  certainty: {
    type: "guaranteed",
    probability: null,
    probability_source: null,
  },
  settlement: {
    status: "posted",
    expected_posting_from: null,
    expected_posting_to: null,
    posted_at: null,
  },
  expiry: {
    policy: "unknown",
    expires_at: null,
    duration_days: null,
    timezone: "Asia/Tokyo",
  },
  restrictions: {
    transferable: null,
    redeemable_for_cash: null,
    usable_for_payment: null,
    investable: null,
    permitted_destination_ids: [],
    notes: "",
  },
  clawback: {
    on_refund: "unknown",
    posting_delay_days: null,
    notes: "",
  },
};

function claim(claimId: string, extra: Record<string, unknown> = {}) {
  return {
    claim_id: claimId,
    claim_type: "fixed",
    subject: structuredClone(SUBJECT),
    scope: structuredClone(SCOPE),
    eligibility: structuredClone(ELIGIBILITY),
    calculation: {
      model: "fixed",
      reward_units: "1",
      rounding: {
        aggregation_scope: "per_operation",
        eligible_spend_quantum_jpy: null,
        reward_rounding_mode: "exact",
      },
    },
    output: structuredClone(OUTPUT),
    ...extra,
  };
}

function observation(
  id: string,
  claims: readonly unknown[] | undefined,
): Record<string, unknown> {
  const observationId = id.startsWith("so_") ? id : `so_${id}`;
  return {
    observation_id: observationId,
    agent_feed: {
      protocol_version: "0.1",
      event_id: `event_${id}`,
      stream_id: "stream.test",
      run_id: `run_${id}`,
      finding_id: `finding_${id}`,
    },
    source_ids: ["source.test"],
    subjects: [
      { type: "merchant", id: "merchant.test", name: "Test Merchant" },
      { type: "loyalty_program", id: "program.test", name: "Test Points" },
    ],
    change_type: "reward_rate",
    summary: "Structured reward claim test observation.",
    effective_time: {
      occurred_at: "2026-08-21T00:00:00Z",
      effective_from: null,
      effective_to: null,
    },
    discovery_assessment: {
      source_authority_claim: "primary",
      evidence_completeness: "complete",
      agent_confidence: null,
    },
    submitted_evidence_refs: [`ev_${id}`],
    canonical_evidence_ids: [],
    semantic_fingerprint_version: 1,
    semantic_fingerprint:
      "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    status: "needs_review",
    security_flags: [],
    raw_attributes:
      claims === undefined
        ? { change_type: "catalogue_fact" }
        : {
            reward_claims: {
              version: "reward-claim.v1",
              claims,
            },
          },
    created_at: "2026-08-21T00:00:00Z",
    updated_at: "2026-08-21T00:00:00Z",
  };
}

function batch(
  observations: readonly Record<string, unknown>[],
  binding: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    version: P0_REWARD_CLAIM_BATCH_VERSION,
    observations: observations.map((item) => ({
      observation: item,
      binding: {
        family_id: "test.family",
        source_role_id: "test_role",
        source_ids: ["source.test"],
        p0_coverage_index: COVERAGE,
        ...binding,
      },
    })),
  };
}

function recordingPort(
  events: string[],
  failOnPersist = false,
): P0EconomicCandidatePersistencePort {
  const persisted = new Set<string>();
  return {
    async begin() {
      events.push("BEGIN");
    },
    async persist(input) {
      events.push(
        `PERSIST:${input.candidate_hash}:${input.activate === true ? "activate" : "retain"}`,
      );
      if (failOnPersist) throw new Error("database failure");
      const duplicate = persisted.has(input.candidate_hash);
      persisted.add(input.candidate_hash);
      return {
        candidate_id: `candidate-${input.candidate_hash.slice(-8)}`,
        outcome: duplicate ? "duplicate" : "inserted",
        status: input.activate ? "active_experimental" : "machine_checked",
      };
    },
    async commit() {
      events.push("COMMIT");
    },
    async rollback() {
      events.push("ROLLBACK");
    },
  };
}

describe("generic structured reward-claim provisional bulk ingestion", () => {
  it("persists complete claims while preserving incomplete siblings", async () => {
    const events: string[] = [];
    const result = await processP0RewardClaimBatch(
      batch([
        observation("complete", [claim("complete-claim")]),
        observation("incomplete", [
          { claim_id: "incomplete-claim", claim_type: "fixed" },
        ]),
      ]),
      recordingPort(events),
    );

    expect(result.ok).toBe(true);
    expect(result.status).toBe("mixed");
    expect(result.members).toHaveLength(2);
    expect(
      result.members.find((member) => member.claim_id === "complete-claim"),
    ).toMatchObject({ status: "inserted" });
    expect(
      result.members.find((member) => member.claim_id === "incomplete-claim"),
    ).toMatchObject({ status: "rejected" });
    expect(events.filter((event) => event.startsWith("PERSIST:"))).toHaveLength(
      1,
    );
    expect(events[1]).toContain(":activate");
    expect(
      result.members.find((member) => member.claim_id === "complete-claim"),
    ).toMatchObject({ persisted_status: "active_experimental" });
  });

  it("does not convert observations without explicit reward_claims", async () => {
    const events: string[] = [];
    const result = await processP0RewardClaimBatch(
      batch([observation("catalogue-only", undefined)]),
      recordingPort(events),
    );

    expect(result).toMatchObject({ ok: false, status: "rejected" });
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "claim_document_missing" }),
      ]),
    );
    expect(events).toEqual([]);
  });

  it("rejects duplicate claim and candidate identities before persistence", async () => {
    const events: string[] = [];
    const repeated = observation("same", [claim("same-claim")]);
    const result = await processP0RewardClaimBatch(
      batch([repeated, structuredClone(repeated)]),
      recordingPort(events),
    );

    expect(result).toMatchObject({ ok: false, status: "rejected" });
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "duplicate_claim_identity",
        "duplicate_candidate_hash",
      ]),
    );
    expect(events).toEqual([]);
  });

  it("returns the same hash order regardless of input permutation", async () => {
    const firstEvents: string[] = [];
    const secondEvents: string[] = [];
    const first = await processP0RewardClaimBatch(
      batch([
        observation("first", [claim("first-claim")]),
        observation("second", [claim("second-claim")]),
      ]),
      recordingPort(firstEvents),
    );
    const second = await processP0RewardClaimBatch(
      batch([
        observation("second", [claim("second-claim")]),
        observation("first", [claim("first-claim")]),
      ]),
      recordingPort(secondEvents),
    );

    expect(first).toEqual(second);
    expect(firstEvents).toEqual(secondEvents);
  });

  it("rejects hostile outer representations without a database call", async () => {
    const hostileCases: readonly [string, unknown][] = [
      [
        "proxy",
        new Proxy(batch([observation("proxy", [claim("proxy-claim")])]), {}),
      ],
      [
        "accessor",
        (() => {
          const value = batch([
            observation("accessor", [claim("accessor-claim")]),
          ]);
          Object.defineProperty(value, "version", {
            enumerable: true,
            get() {
              throw new Error("getter must not run");
            },
          });
          return value;
        })(),
      ],
      [
        "extra",
        {
          ...batch([observation("extra", [claim("extra-claim")])]),
          extra: true,
        },
      ],
      [
        "non-enumerable",
        (() => {
          const value = batch([
            observation("nonenum", [claim("nonenum-claim")]),
          ]);
          Object.defineProperty(value, "extra", { value: true });
          return value;
        })(),
      ],
      [
        "symbol",
        Object.assign(batch([observation("symbol", [claim("symbol-claim")])]), {
          [Symbol("unexpected")]: true,
        }),
      ],
      [
        "sparse",
        {
          ...batch([observation("sparse", [claim("sparse-claim")])]),
          observations: new Array(1),
        },
      ],
      [
        "cycle",
        (() => {
          const value = batch([observation("cycle", [claim("cycle-claim")])]);
          (value as { cycle?: unknown }).cycle = value;
          return value;
        })(),
      ],
    ];

    for (const [, hostile] of hostileCases) {
      const events: string[] = [];
      const result = await processP0RewardClaimBatch(
        hostile,
        recordingPort(events),
      );
      expect(result.ok).toBe(false);
      expect(events).toEqual([]);
    }
  });

  it("rolls back a multi-candidate transaction when persistence fails", async () => {
    const events: string[] = [];
    await expect(
      processP0RewardClaimBatch(
        batch([
          observation("failure-a", [claim("failure-a-claim")]),
          observation("failure-b", [claim("failure-b-claim")]),
        ]),
        recordingPort(events, true),
      ),
    ).rejects.toThrow("database failure");
    expect(events[0]).toBe("BEGIN");
    expect(events.at(-1)).toBe("ROLLBACK");
    expect(events).not.toContain("COMMIT");
  });

  it("replays idempotently through the same persistence port", async () => {
    const events: string[] = [];
    const port = recordingPort(events);
    const input = batch([observation("replay", [claim("replay-claim")])]);
    const first = await processP0RewardClaimBatch(input, port);
    const second = await processP0RewardClaimBatch(input, port);

    expect(first.status).toBe("inserted");
    expect(second.status).toBe("duplicate");
    expect(second.members[0]?.persisted_status).toBe("active_experimental");
    expect(events.filter((event) => event.startsWith("PERSIST:"))).toHaveLength(
      2,
    );
  });

  it("keeps binding and coverage mismatches out of persistence", async () => {
    const events: string[] = [];
    const result = await processP0RewardClaimBatch(
      batch([observation("wrong-binding", [claim("wrong-binding-claim")])], {
        family_id: "not.covered",
      }),
      recordingPort(events),
    );

    expect(result).toMatchObject({ ok: false, status: "rejected" });
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "binding_invalid" }),
      ]),
    );
    expect(events).toEqual([]);
  });

  it("does not create a candidate for an observation with no complete claim", async () => {
    const events: string[] = [];
    const result = await processP0RewardClaimBatch(
      batch([
        observation("no-economics", [
          { claim_id: "no-economics-claim", claim_type: "fixed" },
        ]),
      ]),
      recordingPort(events),
    );

    expect(result).toMatchObject({ ok: false, status: "rejected" });
    expect(result.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          claim_id: "no-economics-claim",
          status: "rejected",
        }),
      ]),
    );
    expect(events).toEqual([]);
  });

  it("uses the generic provisional candidate routine in one Postgres transaction", async () => {
    const statements: string[] = [];
    const target = {
      async query(text: string) {
        statements.push(text.trim().split("\n")[0] ?? "");
        if (text.includes("persist_p0_reward_claim_candidate"))
          return {
            rows: [
              {
                candidate_id: "candidate-db-id",
                outcome: "inserted",
                status: "active_experimental",
              },
            ],
          };
        return { rows: [] };
      },
    };
    const process = createPostgresP0RewardClaimBatchProcessor(target);
    const result = await process(
      batch([observation("postgres", [claim("postgres-claim")])]),
    );

    expect(result.ok).toBe(true);
    expect(statements).toEqual([
      "BEGIN",
      "select candidate_id, outcome, status",
      "COMMIT",
    ]);
    expect(P0_PROVISIONAL_CANDIDATE_QUERY).toContain(
      "persist_p0_reward_claim_candidate",
    );
  });

  it("passes activation intent only for a compiler-produced active envelope", async () => {
    const inputs: Array<{ activate?: boolean; intended_status?: string }> = [];
    const port: P0EconomicCandidatePersistencePort = {
      async persist(input) {
        inputs.push({
          activate: input.activate,
          intended_status: input.intended_status,
        });
        return {
          candidate_id: "candidate-activation-intent",
          outcome: "inserted",
          status: input.activate ? "active_experimental" : "machine_checked",
        };
      },
    };
    const needsEvidence = {
      ...observation("needs-evidence", [claim("needs-evidence-claim")]),
      status: "needs_evidence",
    };
    const result = await processP0RewardClaimBatch(
      batch([observation("active", [claim("active-claim")]), needsEvidence]),
      port,
    );

    expect(result.ok).toBe(true);
    expect(inputs).toEqual([
      { activate: true, intended_status: "active_experimental" },
      { activate: false, intended_status: "needs_evidence" },
    ]);
  });
});
