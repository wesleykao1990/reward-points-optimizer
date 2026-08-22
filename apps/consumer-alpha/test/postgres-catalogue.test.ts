import { readFile } from "node:fs/promises";
import {
  EXPERIMENTAL_CATALOGUE_QUERY,
  EXPERIMENTAL_CORRECTION_QUERY,
  NANACO_P0_DEFINITION_HASH,
  P0_EXPERIMENTAL_CATALOGUE_LOOKUP_QUERY,
  P0_EXPERIMENTAL_CATALOGUE_QUERY,
  type QueryClient,
} from "@jro/agent-feed-postgres";
import {
  hashCandidate,
  hashDefinition,
  type ProvisionalRuleCandidate,
} from "@jro/provisional-rules";
import { beforeAll, describe, expect, it } from "vitest";
import type { ExperimentalRecommendationInput } from "../src/contracts.js";
import {
  createPostgresExperimentalCataloguePort,
  createPostgresNanacoExperimentalRecommendationPort,
  mapPostgresNanacoRecordToCard,
} from "../src/postgres-catalogue.js";
import {
  NANACO_EXPERIMENTAL_ACCEPTANCE_PUBLICATION_ID,
  NANACO_EXPERIMENTAL_PUBLICATION_ID,
} from "../src/real-experimental-recommendation.js";

type JsonRecord = Record<string, unknown>;

let candidate: ProvisionalRuleCandidate;
let acceptanceCandidate: ProvisionalRuleCandidate;

beforeAll(async () => {
  const [nanaco, paymentJson] = await Promise.all([
    readFile(
      new URL(
        "../../../fixtures/m3/provisional/p0-nanaco-economic-candidate.v0.1.json",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../../../fixtures/m3/provisional/p0-seveneleven-payment-family-candidates.v0.1.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);
  candidate = JSON.parse(nanaco) as ProvisionalRuleCandidate;
  const paymentCandidates = JSON.parse(paymentJson) as {
    readonly candidates: readonly {
      readonly payment_family: string;
      readonly candidate: ProvisionalRuleCandidate;
    }[];
  };
  const nanacoPayment = paymentCandidates.candidates.find(
    (item) => item.payment_family === "nanaco",
  );
  if (!nanacoPayment) throw new Error("nanaco acceptance fixture missing");
  acceptanceCandidate = nanacoPayment.candidate;
});

function row(overrides: JsonRecord = {}): JsonRecord {
  return {
    candidate_hash: hashCandidate(candidate, NANACO_P0_DEFINITION_HASH),
    definition_hash: NANACO_P0_DEFINITION_HASH,
    candidate_id: candidate.candidate_id,
    candidate_payload: candidate,
    source_observation_id: "00000000-0000-0000-0000-000000000001",
    source_observation_key: candidate.observation_id,
    observation_fingerprint: candidate.observation_fingerprint,
    source_ids: [...candidate.source_ids],
    p0_family_id: candidate.p0_family_id,
    source_role_id: candidate.source_role_id,
    source_authority_role: candidate.source_authority_role,
    status: "active_experimental",
    machine_checked_at: candidate.machine_check.checked_at,
    admitted_at: candidate.machine_check.checked_at,
    ...overrides,
  };
}

function acceptanceRow(overrides: JsonRecord = {}): JsonRecord {
  return {
    candidate_hash: hashCandidate(
      acceptanceCandidate,
      hashDefinition(acceptanceCandidate.rule),
    ),
    definition_hash: hashDefinition(acceptanceCandidate.rule),
    candidate_id: acceptanceCandidate.candidate_id,
    candidate_payload: acceptanceCandidate,
    source_observation_id: "00000000-0000-0000-0000-000000000002",
    source_observation_key: acceptanceCandidate.observation_id,
    observation_fingerprint: acceptanceCandidate.observation_fingerprint,
    source_ids: [...acceptanceCandidate.source_ids],
    p0_family_id: acceptanceCandidate.p0_family_id,
    source_role_id: acceptanceCandidate.source_role_id,
    source_authority_role: acceptanceCandidate.source_authority_role,
    status: "active_experimental",
    machine_checked_at: acceptanceCandidate.machine_check.checked_at,
    admitted_at: acceptanceCandidate.machine_check.checked_at,
    ...overrides,
  };
}

function target(calls: string[]): QueryClient {
  return {
    async query(text, values) {
      calls.push(text);
      if (text === EXPERIMENTAL_CATALOGUE_QUERY) return { rows: [row()] };
      if (text === P0_EXPERIMENTAL_CATALOGUE_LOOKUP_QUERY)
        return { rows: [row()] };
      if (text === EXPERIMENTAL_CORRECTION_QUERY) {
        expect(JSON.parse(String(values?.[0]))).toMatchObject({
          credible: true,
          severity: "normal",
        });
        return { rows: [{ disposition: "disputed" }] };
      }
      return { rows: [] };
    },
  };
}

function recommendationTarget(
  calls: string[],
  rewardOverrides: JsonRecord = {},
): QueryClient {
  return {
    async query(text) {
      calls.push(text);
      if (text === P0_EXPERIMENTAL_CATALOGUE_QUERY)
        return { rows: [row(rewardOverrides), acceptanceRow()] };
      if (text === P0_EXPERIMENTAL_CATALOGUE_LOOKUP_QUERY)
        return { rows: [row(rewardOverrides)] };
      return { rows: [] };
    },
  };
}

describe("consumer-alpha PostgreSQL catalogue adapter", () => {
  it("maps only the browser-safe Japanese card fields", () => {
    const card = mapPostgresNanacoRecordToCard({
      publication_id: "candidate_p0_nanaco",
      candidate_hash: `sha256:${"a".repeat(64)}`,
      definition_hash: NANACO_P0_DEFINITION_HASH,
      status: "active_experimental",
      checked_at: "2026-08-21T00:05:00Z",
      admitted_at: "2026-08-21T00:05:00Z",
      valid_from: "2026-08-20T05:39:00+09:00",
      valid_to: null,
      source_id: "jp.nanaco.shopping-earning",
      source_label: "nanaco公式情報",
      rule_id: "rr_jp_cvs_006_nanaco_purchase_reward",
      rule_version: 1,
      reward_units: "1",
      spend_jpy: 200,
    });
    expect(card).toEqual({
      publication_id: "candidate_p0_nanaco",
      kind: "reward_rate",
      title: "nanacoの買い物ポイント",
      summary: expect.stringContaining(
        "税抜200円ごとにnanacoポイント1ポイント",
      ),
      display_status: "experimental_unverified",
      confidence: "high",
      source_label: "nanaco公式情報",
      checked_at: "2026-08-21T00:05:00Z",
      valid_from: "2026-08-20T05:39:00+09:00",
      valid_to: null,
    });
    expect(JSON.stringify(card)).not.toMatch(
      /candidate_hash|definition_hash|candidate_payload|https?:\/\//iu,
    );
  });

  it("returns a normalized snapshot and delegates correction without exposing DB fields", async () => {
    const calls: string[] = [];
    const port = createPostgresExperimentalCataloguePort(target(calls));
    const snapshot = await port.list();
    expect(snapshot).toMatchObject({ status: "ready" });
    expect(snapshot.rules).toHaveLength(1);
    expect(snapshot.rules[0]).toMatchObject({
      publication_id: candidate.candidate_id,
      kind: "reward_rate",
      display_status: "experimental_unverified",
    });
    expect(JSON.stringify(snapshot)).not.toMatch(
      /candidate_hash|definition_hash|candidate_payload|https?:\/\//iu,
    );

    await expect(
      port.reportCorrection({
        publication_id: candidate.candidate_id ?? "missing",
        category: "rate_wrong",
      }),
    ).resolves.toEqual({
      ok: true,
      publication_id: candidate.candidate_id,
      category: "rate_wrong",
      accepted: true,
    });
    expect(calls).toContain(EXPERIMENTAL_CORRECTION_QUERY);
  });

  it("uses the current DB Rule IR loader and evaluates one point at tax-exclusive JPY 200", async () => {
    const calls: string[] = [];
    const port = createPostgresNanacoExperimentalRecommendationPort(
      recommendationTarget(calls),
    );
    const input: ExperimentalRecommendationInput = {
      selection_id: NANACO_EXPERIMENTAL_PUBLICATION_ID,
      amount_jpy: 200,
      tax_exclusive_amount_jpy: 200,
      nanaco_balance_jpy: 10_000,
      effective_at: "2026-08-22T00:00:00Z",
    };
    await expect(port.evaluate(input)).resolves.toMatchObject({
      winner: { reward_points: "1" },
    });
    expect(
      calls.filter((text) => text === P0_EXPERIMENTAL_CATALOGUE_QUERY),
    ).toHaveLength(2);
    expect(NANACO_EXPERIMENTAL_ACCEPTANCE_PUBLICATION_ID).toBe(
      acceptanceCandidate.candidate_id,
    );
  });

  it("fails closed when the current reward candidate is inactive or drifted", async () => {
    const missing = createPostgresNanacoExperimentalRecommendationPort({
      query: async (text) =>
        text === P0_EXPERIMENTAL_CATALOGUE_QUERY
          ? { rows: [acceptanceRow()] }
          : { rows: [] },
    });
    const input: ExperimentalRecommendationInput = {
      selection_id: NANACO_EXPERIMENTAL_PUBLICATION_ID,
      amount_jpy: 200,
      tax_exclusive_amount_jpy: 200,
      nanaco_balance_jpy: 10_000,
      effective_at: "2026-08-22T00:00:00Z",
    };
    await expect(missing.evaluate(input)).rejects.toMatchObject({
      code: "recommendation_unavailable",
    });

    const inactive = createPostgresNanacoExperimentalRecommendationPort(
      recommendationTarget([], { status: "disputed" }),
    );
    await expect(inactive.evaluate(input)).rejects.toMatchObject({
      code: "recommendation_unavailable",
    });

    const driftedCandidate = structuredClone(candidate);
    if (driftedCandidate.rule.calculation?.model === "points_per_unit")
      driftedCandidate.rule.calculation.spend_jpy = 1;
    const drifted = createPostgresNanacoExperimentalRecommendationPort({
      query: async (text) => {
        if (text === P0_EXPERIMENTAL_CATALOGUE_QUERY)
          return {
            rows: [
              row({
                candidate_payload: driftedCandidate,
                candidate_hash: hashCandidate(
                  driftedCandidate,
                  hashDefinition(driftedCandidate.rule),
                ),
                definition_hash: hashDefinition(driftedCandidate.rule),
              }),
              acceptanceRow(),
            ],
          };
        return { rows: [] };
      },
    });
    await expect(drifted.evaluate(input)).rejects.toMatchObject({
      code: "recommendation_unavailable",
    });
  });
});
