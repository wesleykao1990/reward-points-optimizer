import { readFile } from "node:fs/promises";
import {
  hashCandidate,
  hashDefinition,
  type ProvisionalRuleCandidate,
} from "@jro/provisional-rules";
import { beforeAll, describe, expect, it } from "vitest";
import {
  ACTIVE_REWARD_CLAIM_CALCULATIONS_QUERY,
  createPostgresActiveRewardClaimStore,
  MAX_ACTIVE_REWARD_CLAIM_ROWS,
  type QueryClient,
  type QueryResult,
} from "../src/index.js";

type JsonRecord = Record<string, unknown>;

let baseCandidate: ProvisionalRuleCandidate;

beforeAll(async () => {
  const source = await readFile(
    new URL(
      "../../../fixtures/m3/provisional/p0-nanaco-economic-candidate.v0.1.json",
      import.meta.url,
    ),
    "utf8",
  );
  baseCandidate = JSON.parse(source) as ProvisionalRuleCandidate;
});

function candidate(
  familyId: string,
  sourceRoleId: string,
  candidateId: string,
): ProvisionalRuleCandidate {
  return {
    ...baseCandidate,
    candidate_id: candidateId,
    p0_family_id: familyId,
    source_role_id: sourceRoleId,
    extractor: { name: "reward-claim-compiler", version: "1" },
    machine_check: {
      checker: "reward-claim-compiler",
      checker_version: "1",
      checked_at: "2026-08-22T00:00:00Z",
      checks: {
        representation_safe: true,
        rule_structure: true,
        rule_semantics: true,
        observation_binding: true,
        p0_coverage: true,
      },
    },
  };
}

function observationFor(value: ProvisionalRuleCandidate): JsonRecord {
  return {
    observation_id: value.observation_id,
    agent_feed: {
      protocol_version: "0.1",
      event_id: "evt_active_reward_claim_test",
      stream_id: "stream_active_reward_claim_test",
      run_id: "run_active_reward_claim_test",
      finding_id: "finding_active_reward_claim_test",
    },
    source_ids: [...value.source_ids],
    subjects: [],
    change_type: "reward_rate",
    summary: "Structured reward claim fixture",
    effective_time: {
      occurred_at: null,
      effective_from: null,
      effective_to: null,
    },
    discovery_assessment: {
      source_authority_claim: "primary",
      evidence_completeness: "complete",
      agent_confidence: 1,
    },
    submitted_evidence_refs: ["ev_active_reward_claim_test"],
    canonical_evidence_ids: [],
    semantic_fingerprint_version: 1,
    semantic_fingerprint: value.observation_fingerprint,
    status: "needs_review",
    security_flags: [],
    raw_attributes: {
      reward_claims: {
        version: "reward-claim.v1",
        claims: [],
      },
    },
    created_at: "2026-08-22T00:00:00Z",
    updated_at: "2026-08-22T00:00:00Z",
  };
}

function row(
  value: ProvisionalRuleCandidate,
  overrides: JsonRecord = {},
): JsonRecord {
  const definitionHash = hashDefinition(value.rule);
  return {
    candidate_hash: hashCandidate(value, definitionHash),
    definition_hash: definitionHash,
    candidate_id: value.candidate_id,
    candidate_payload: value,
    p0_family_id: value.p0_family_id,
    source_role_id: value.source_role_id,
    source_ids: [...value.source_ids],
    observation: observationFor(value),
    source_url: "https://rewards.example.test/rules/base",
    checked_at: "2026-08-22T00:01:00Z",
    ...overrides,
  };
}

function clientFor(
  handler: (
    text: string,
    values: readonly unknown[] | undefined,
  ) => QueryResult<unknown> | Promise<QueryResult<unknown>>,
): QueryClient {
  return {
    query(text, values) {
      return Promise.resolve(handler(text, values));
    },
  };
}

describe("PostgreSQL active structured reward-claim store", () => {
  it("discovers dynamic family/role rows and preserves provenance", async () => {
    const first = candidate(
      "dynamic.family.a",
      "base_reward_rules",
      "candidate_dynamic_a",
    );
    const second = candidate(
      "dynamic.family.b",
      "campaign_rules",
      "candidate_dynamic_b",
    );
    const target = clientFor((text, values) => {
      expect(text).toBe(ACTIVE_REWARD_CLAIM_CALCULATIONS_QUERY);
      expect(values).toEqual(["2026-08-22T00:02:00Z"]);
      return { rows: [row(second), row(first)] };
    });

    const records = await createPostgresActiveRewardClaimStore(target).list(
      "2026-08-22T00:02:00Z",
    );
    expect(records).toHaveLength(2);
    expect(records.map((item) => item.p0_family_id)).toEqual([
      ...[...records]
        .sort((left, right) =>
          left.candidate_hash.localeCompare(right.candidate_hash),
        )
        .map((item) => item.p0_family_id),
    ]);
    expect(
      records.find((item) => item.p0_family_id === "dynamic.family.a"),
    ).toMatchObject({
      candidate_id: "candidate_dynamic_a",
      source_role_id: "base_reward_rules",
      source_url: "https://rewards.example.test/rules/base",
      checked_at: "2026-08-22T00:01:00Z",
      observation: {
        observation_id: baseCandidate.observation_id,
        raw_attributes: {
          reward_claims: { version: "reward-claim.v1", claims: [] },
        },
      },
    });
  });

  it("rejects malformed rows, non-HTTPS provenance, and payload drift", async () => {
    const value = candidate(
      "dynamic.family",
      "base_reward_rules",
      "candidate_dynamic",
    );
    const extra = clientFor((text) =>
      text === ACTIVE_REWARD_CLAIM_CALCULATIONS_QUERY
        ? { rows: [row(value, { unexpected: "drift" })] }
        : { rows: [] },
    );
    await expect(
      createPostgresActiveRewardClaimStore(extra).list("2026-08-22T00:02:00Z"),
    ).rejects.toThrow("active_reward_claim_row_shape_invalid");

    const badUrl = clientFor((text) =>
      text === ACTIVE_REWARD_CLAIM_CALCULATIONS_QUERY
        ? {
            rows: [row(value, { source_url: "http://untrusted.example.test" })],
          }
        : { rows: [] },
    );
    await expect(
      createPostgresActiveRewardClaimStore(badUrl).list("2026-08-22T00:02:00Z"),
    ).rejects.toThrow("active_reward_claim_source_url_invalid");

    const driftedPayload = {
      ...value,
      extractor: { name: "not-the-compiler", version: "1" },
    };
    const payloadDrift = clientFor((text) =>
      text === ACTIVE_REWARD_CLAIM_CALCULATIONS_QUERY
        ? {
            rows: [
              row(driftedPayload, {
                candidate_hash: hashCandidate(
                  driftedPayload,
                  hashDefinition(driftedPayload.rule),
                ),
                definition_hash: hashDefinition(driftedPayload.rule),
                candidate_payload: driftedPayload,
              }),
            ],
          }
        : { rows: [] },
    );
    await expect(
      createPostgresActiveRewardClaimStore(payloadDrift).list(
        "2026-08-22T00:02:00Z",
      ),
    ).rejects.toThrow("active_reward_claim_extractor_invalid");
  });

  it("fails closed for an oversized result and invalid effective time", async () => {
    const value = candidate(
      "dynamic.family",
      "base_reward_rules",
      "candidate_dynamic",
    );
    const tooMany = clientFor((text) =>
      text === ACTIVE_REWARD_CLAIM_CALCULATIONS_QUERY
        ? {
            rows: Array.from({ length: MAX_ACTIVE_REWARD_CLAIM_ROWS + 1 }, () =>
              row(value),
            ),
          }
        : { rows: [] },
    );
    await expect(
      createPostgresActiveRewardClaimStore(tooMany).list(
        "2026-08-22T00:02:00Z",
      ),
    ).rejects.toThrow("active_reward_claim_too_many_rows");

    const target = clientFor(() => {
      throw new Error("invalid effective time reached the database");
    });
    await expect(
      createPostgresActiveRewardClaimStore(target).list("2026-08-22"),
    ).rejects.toThrow("active_reward_claim_effective_at_invalid");
  });
});
