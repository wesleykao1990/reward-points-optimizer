import { readFile } from "node:fs/promises";
import {
  hashCandidate,
  hashCanonical,
  hashDefinition,
  type ProvisionalRuleCandidate,
} from "@jro/provisional-rules";
import { beforeAll, describe, expect, it } from "vitest";
import {
  createPostgresExperimentalCatalogueStore,
  EXPERIMENTAL_CATALOGUE_QUERY,
  EXPERIMENTAL_CORRECTION_QUERY,
  NANACO_P0_DEFINITION_HASH,
  P0_EXPERIMENTAL_CATALOGUE_LOOKUP_QUERY,
  type P0ExperimentalCatalogueRecord,
  type QueryClient,
  type QueryPool,
  type QueryResult,
} from "../src/index.js";

type JsonRecord = Record<string, unknown>;

let candidate: ProvisionalRuleCandidate;
type PaymentFixture = {
  readonly payment_family: string;
  readonly display_name_ja: string;
  readonly candidate: ProvisionalRuleCandidate;
};
let paymentCandidates: readonly PaymentFixture[] = [];

beforeAll(async () => {
  const [nanaco, payment] = await Promise.all([
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
  paymentCandidates = (
    JSON.parse(payment) as { readonly candidates: readonly PaymentFixture[] }
  ).candidates;
});

function row(overrides: JsonRecord = {}): JsonRecord {
  const candidateHash = hashCandidate(candidate, NANACO_P0_DEFINITION_HASH);
  return {
    candidate_hash: candidateHash,
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
    status: "machine_checked",
    machine_checked_at: candidate.machine_check.checked_at,
    admitted_at: candidate.machine_check.checked_at,
    ...overrides,
  };
}

function paymentRow(
  item: PaymentFixture,
  overrides: JsonRecord = {},
): JsonRecord {
  const paymentCandidate = item.candidate;
  return {
    candidate_hash: hashCandidate(
      paymentCandidate,
      hashDefinition(paymentCandidate.rule),
    ),
    definition_hash: hashDefinition(paymentCandidate.rule),
    candidate_id: paymentCandidate.candidate_id,
    candidate_payload: paymentCandidate,
    source_observation_id: "00000000-0000-0000-0000-000000000002",
    source_observation_key: paymentCandidate.observation_id,
    observation_fingerprint: paymentCandidate.observation_fingerprint,
    source_ids: [...paymentCandidate.source_ids],
    p0_family_id: paymentCandidate.p0_family_id,
    source_role_id: paymentCandidate.source_role_id,
    source_authority_role: paymentCandidate.source_authority_role,
    status: "active_experimental",
    machine_checked_at: paymentCandidate.machine_check.checked_at,
    admitted_at: paymentCandidate.machine_check.checked_at,
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

describe("PostgreSQL experimental catalogue store", () => {
  it("validates and reduces the exact Nanaco view row", async () => {
    const target = clientFor((text) =>
      text === EXPERIMENTAL_CATALOGUE_QUERY ? { rows: [row()] } : { rows: [] },
    );
    const records =
      await createPostgresExperimentalCatalogueStore(target).list();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      publication_id: candidate.candidate_id,
      candidate_hash: hashCandidate(candidate, NANACO_P0_DEFINITION_HASH),
      definition_hash: NANACO_P0_DEFINITION_HASH,
      status: "machine_checked",
      checked_at: candidate.machine_check.checked_at,
      valid_from: candidate.rule.validity.valid_from,
      source_id: "jp.nanaco.shopping-earning",
      source_label: "nanaco公式情報",
      rule_id: "rr_jp_cvs_006_nanaco_purchase_reward",
      rule_version: 1,
      reward_units: "1",
      spend_jpy: 200,
    });
    expect(
      Object.keys(records[0] as P0ExperimentalCatalogueRecord).sort(),
    ).toEqual([
      "admitted_at",
      "candidate_hash",
      "checked_at",
      "definition_hash",
      "kind",
      "publication_id",
      "reward_units",
      "rule_id",
      "rule_version",
      "source_id",
      "source_label",
      "spend_jpy",
      "status",
      "valid_from",
    ]);
    expect(JSON.stringify(records[0])).not.toMatch(
      /candidate_payload|https?:\/\//iu,
    );
  });

  it("fails closed for extra fields, raw payload drift, and an oversized view", async () => {
    const extraField = clientFor((text) =>
      text === EXPERIMENTAL_CATALOGUE_QUERY
        ? { rows: [row({ raw_payload: "secret" })] }
        : { rows: [] },
    );
    await expect(
      createPostgresExperimentalCatalogueStore(extraField).list(),
    ).rejects.toThrow("p0_catalogue_row_shape_invalid");

    const payloadDrift = clientFor((text) =>
      text === EXPERIMENTAL_CATALOGUE_QUERY
        ? {
            rows: [
              row({
                candidate_payload: {
                  ...candidate,
                  candidate_payload: "https://attacker.invalid/raw",
                },
              }),
            ],
          }
        : { rows: [] },
    );
    await expect(
      createPostgresExperimentalCatalogueStore(payloadDrift).list(),
    ).rejects.toThrow("p0_catalogue_candidate_shape_invalid");

    const tooMany = clientFor((text) =>
      text === EXPERIMENTAL_CATALOGUE_QUERY
        ? { rows: Array.from({ length: 129 }, () => row()) }
        : { rows: [] },
    );
    await expect(
      createPostgresExperimentalCatalogueStore(tooMany).list(),
    ).rejects.toThrow("p0_catalogue_too_many_rows");
  });

  it("returns a deterministic mixed Nanaco plus eleven-family catalogue", async () => {
    const paymentRows = paymentCandidates.map((item) => paymentRow(item));
    const target = clientFor((text) =>
      text === EXPERIMENTAL_CATALOGUE_QUERY
        ? { rows: [row(), ...paymentRows].reverse() }
        : { rows: [] },
    );
    const records =
      await createPostgresExperimentalCatalogueStore(target).list();
    expect(records).toHaveLength(12);
    expect(records.filter((item) => item.kind === "reward_rate")).toHaveLength(
      1,
    );
    expect(
      records.filter((item) => item.kind === "payment_acceptance"),
    ).toHaveLength(11);
    expect(records.map((item) => item.candidate_hash)).toEqual(
      [...records]
        .map((item) => item.candidate_hash)
        .sort((left, right) => left.localeCompare(right)),
    );
    expect(
      records
        .filter((item) => item.kind === "payment_acceptance")
        .map((item) => item.display_name_ja),
    ).toEqual(
      expect.arrayContaining(
        paymentCandidates.map((item) => item.display_name_ja),
      ),
    );
  });

  it("rejects an unsupported twelfth payment family and duplicate union rows", async () => {
    const source = paymentCandidates[0];
    if (!source) throw new Error("payment fixture missing");
    const unsupported = {
      ...source,
      candidate: {
        ...source.candidate,
        rule: {
          ...source.candidate.rule,
          rule_id: "rr_p0_seveneleven_accept_unknown_family",
        },
      },
    } as PaymentFixture;
    const unsupportedTarget = clientFor((text) =>
      text === EXPERIMENTAL_CATALOGUE_QUERY
        ? {
            rows: [
              row(),
              ...paymentCandidates.map((item) => paymentRow(item)),
              paymentRow(unsupported),
            ],
          }
        : { rows: [] },
    );
    await expect(
      createPostgresExperimentalCatalogueStore(unsupportedTarget).list(),
    ).rejects.toThrow("p0_catalogue_payment_family_invalid");

    const duplicateTarget = clientFor((text) =>
      text === EXPERIMENTAL_CATALOGUE_QUERY
        ? { rows: [row(), row()] }
        : { rows: [] },
    );
    await expect(
      createPostgresExperimentalCatalogueStore(duplicateTarget).list(),
    ).rejects.toThrow("p0_catalogue_publication_duplicate");
  });

  it("creates a credible normal correction with a canonical hash in one transaction", async () => {
    const calls: Array<{ text: string; values?: readonly unknown[] }> = [];
    const target = clientFor((text, values) => {
      calls.push({ text, values });
      if (text === P0_EXPERIMENTAL_CATALOGUE_LOOKUP_QUERY)
        return { rows: [row({ status: "active_experimental" })] };
      if (text === EXPERIMENTAL_CORRECTION_QUERY) {
        const signal = JSON.parse(String(values?.[0])) as JsonRecord;
        expect(signal).toMatchObject({
          version: "provisional-correction.v1",
          candidate_hash: hashCandidate(candidate, NANACO_P0_DEFINITION_HASH),
          category: "rate_wrong",
          credible: true,
          severity: "normal",
        });
        expect(values?.[1]).toBe(hashCanonical(signal));
        return { rows: [{ disposition: "disputed" }] };
      }
      return { rows: [] };
    });

    const result = await createPostgresExperimentalCatalogueStore(
      target,
    ).reportCorrection({
      publication_id: candidate.candidate_id ?? "missing",
      category: "rate_wrong",
    });
    expect(result).toEqual({
      ok: true,
      publication_id: candidate.candidate_id,
      category: "rate_wrong",
      accepted: true,
    });
    expect(calls.map((call) => call.text)).toEqual([
      "BEGIN",
      P0_EXPERIMENTAL_CATALOGUE_LOOKUP_QUERY,
      EXPERIMENTAL_CORRECTION_QUERY,
      "COMMIT",
    ]);
  });

  it("corrects both discriminated record kinds through the same exact routine", async () => {
    const payment = paymentCandidates[0];
    if (!payment) throw new Error("payment fixture missing");
    const paymentRecord = paymentRow(payment);
    const rows = [row({ status: "active_experimental" }), paymentRecord];
    const target = clientFor((text, values) => {
      if (text === P0_EXPERIMENTAL_CATALOGUE_LOOKUP_QUERY) {
        const publicationId = values?.[0];
        const selected = rows.find(
          (value) => value.candidate_id === publicationId,
        );
        return { rows: selected ? [selected] : [] };
      }
      if (text === EXPERIMENTAL_CORRECTION_QUERY)
        return { rows: [{ disposition: "disputed" }] };
      return { rows: [] };
    });
    for (const publicationId of [
      candidate.candidate_id,
      payment.candidate.candidate_id,
    ]) {
      await expect(
        createPostgresExperimentalCatalogueStore(target).reportCorrection({
          publication_id: publicationId ?? "missing",
          category: "not_accepted",
        }),
      ).resolves.toMatchObject({ ok: true, publication_id: publicationId });
    }
  });

  it("returns not found without calling correction and rolls back pool failures", async () => {
    const notFoundCalls: string[] = [];
    const notFound = clientFor((text) => {
      notFoundCalls.push(text);
      if (text === P0_EXPERIMENTAL_CATALOGUE_LOOKUP_QUERY) return { rows: [] };
      return { rows: [] };
    });
    await expect(
      createPostgresExperimentalCatalogueStore(notFound).reportCorrection({
        publication_id: "candidate_unknown",
        category: "not_accepted",
      }),
    ).resolves.toEqual({ ok: false, code: "publication_not_found" });
    expect(notFoundCalls).toEqual([
      "BEGIN",
      P0_EXPERIMENTAL_CATALOGUE_LOOKUP_QUERY,
      "COMMIT",
    ]);

    const failure = new Error("correction query failed");
    const calls: string[] = [];
    let releaseError: Error | undefined;
    const pool: QueryPool = {
      query: async () => ({ rows: [] }),
      connect: async () => ({
        async query(text) {
          calls.push(text);
          if (text === P0_EXPERIMENTAL_CATALOGUE_LOOKUP_QUERY)
            return { rows: [row({ status: "active_experimental" })] };
          if (text === EXPERIMENTAL_CORRECTION_QUERY) throw failure;
          return { rows: [] };
        },
        release(error?: Error) {
          releaseError = error;
        },
      }),
    };
    await expect(
      createPostgresExperimentalCatalogueStore(pool).reportCorrection({
        publication_id: candidate.candidate_id ?? "missing",
        category: "not_accepted",
      }),
    ).rejects.toBe(failure);
    expect(calls).toEqual([
      "BEGIN",
      P0_EXPERIMENTAL_CATALOGUE_LOOKUP_QUERY,
      EXPERIMENTAL_CORRECTION_QUERY,
      "ROLLBACK",
    ]);
    expect(releaseError).toBe(failure);
  });
});
