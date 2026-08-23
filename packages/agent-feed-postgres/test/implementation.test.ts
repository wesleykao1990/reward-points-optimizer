import { describe, expect, it } from "vitest";
import {
  createPostgresP0ImplementationCatalogueStore,
  P0_IMPLEMENTATION_FACT_CORRECTION_QUERY,
  P0_IMPLEMENTATION_FACTS_QUERY,
  type QueryClient,
  type QueryPool,
  type QueryResult,
} from "../src/index.js";

type JsonRecord = Record<string, unknown>;

function factRow(overrides: JsonRecord = {}): JsonRecord {
  return {
    fact_id: "11111111-1111-4111-8111-111111111111",
    implementation_version: "p0-point-rules-a.implementation.v0.1",
    fact_version: 1,
    family_id: "point.d",
    source_role_id: "earn_rules",
    source_ids: ["jp.dpoint.earn-mobile"],
    claim_type: "earn_rule",
    subject: "ドコモ料金",
    predicate: "awards_points_per_amount",
    short_paraphrase: "Eligible fees earn points.",
    disposition: "catalogue_fact",
    reason: "insufficient_operation_mapping",
    reason_detail: "Searchable fact.",
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

const correctionInput = {
  fact_id: "11111111-1111-4111-8111-111111111111",
  correction_id: "p0_impl_correction_test_001",
  reason: "exact fact correction",
} as const;

describe("PostgreSQL generic implementation catalogue", () => {
  it("searches with bounded parameters and returns a stable safe projection", async () => {
    const rows = [
      factRow({
        fact_id: "22222222-2222-4222-8222-222222222222",
        implementation_version: "p0-point-rules-b.implementation.v0.1",
      }),
      factRow({ fact_id: "11111111-1111-4111-8111-111111111111" }),
    ];
    let valuesSeen: readonly unknown[] | undefined;
    const target = clientFor((text, values) => {
      expect(text).toBe(P0_IMPLEMENTATION_FACTS_QUERY);
      valuesSeen = values;
      return { rows };
    });
    const result = await createPostgresP0ImplementationCatalogueStore(target, {
      clock: () => new Date("2026-08-22T00:00:00.000Z"),
    }).search({
      query: "%_' OR 1=1 --",
      family_id: "point.d",
      source_role_id: "earn_rules",
      claim_type: "earn_rule",
      limit: 1,
    });
    expect(result.has_more).toBe(true);
    expect(result.facts.map((fact) => fact.fact_id)).toEqual([
      "11111111-1111-4111-8111-111111111111",
    ]);
    expect(result.next_cursor).toBe("11111111-1111-4111-8111-111111111111");
    expect(valuesSeen).toEqual([
      "\\%\\_' OR 1=1 --",
      "point.d",
      "earn_rules",
      "earn_rule",
      null,
      2,
      "2026-08-22T00:00:00.000Z",
    ]);
    expect(JSON.stringify(result)).not.toMatch(
      /implementation_hash|https?:\/\/|evidence_locator|"value"/iu,
    );
  });

  it("normalizes node-postgres timestamptz Date values in the provenance projection", async () => {
    const target = clientFor(() => ({
      rows: [
        factRow({
          source_url: "https://example.test/official",
          checked_at: new Date("2026-08-22T00:00:00.000Z"),
          effective_from: "2026-08-20",
          effective_to: null,
        }),
      ],
    }));
    const result =
      await createPostgresP0ImplementationCatalogueStore(target).list();
    expect(result[0]).toMatchObject({
      source_url: "https://example.test/official",
      checked_at: "2026-08-22T00:00:00.000Z",
      effective_from: "2026-08-20",
      effective_to: null,
    });
  });

  it("binds an injected host clock as the effective-at instant", async () => {
    let valuesSeen: readonly unknown[] | undefined;
    const target = clientFor((text, values) => {
      expect(text).toBe(P0_IMPLEMENTATION_FACTS_QUERY);
      valuesSeen = values;
      return { rows: [] };
    });
    await createPostgresP0ImplementationCatalogueStore(target, {
      clock: () => new Date("2026-08-31T14:59:59.000Z"),
    }).list();
    expect(valuesSeen?.at(-1)).toBe("2026-08-31T14:59:59.000Z");
  });

  it("uses one caller-captured effective-at instant without rereading the clock", async () => {
    let clockCalls = 0;
    let valuesSeen: readonly unknown[] | undefined;
    const target = clientFor((_text, values) => {
      valuesSeen = values;
      return { rows: [] };
    });
    await createPostgresP0ImplementationCatalogueStore(target, {
      clock() {
        clockCalls += 1;
        return new Date("2026-09-01T00:00:00.000Z");
      },
    }).search({
      effective_at: "2026-08-31T14:59:59.000Z",
    });
    expect(clockCalls).toBe(0);
    expect(valuesSeen?.at(-1)).toBe("2026-08-31T14:59:59.000Z");
  });

  it("fails closed for an invalid injected clock", async () => {
    const target = clientFor(() => ({ rows: [] }));
    await expect(
      createPostgresP0ImplementationCatalogueStore(target, {
        clock: () => new Date("not-a-date"),
      }).list(),
    ).rejects.toThrow("p0_implementation_clock_invalid");
  });

  it("accepts Japanese paraphrases containing pan as a word and rejects card data", async () => {
    const accepted = clientFor((text) =>
      text === P0_IMPLEMENTATION_FACTS_QUERY
        ? {
            rows: [
              factRow({
                short_paraphrase: "One d point is usable as one Japanese yen.",
              }),
            ],
          }
        : { rows: [] },
    );
    await expect(
      createPostgresP0ImplementationCatalogueStore(accepted).list(),
    ).resolves.toHaveLength(1);

    const pan = clientFor((text) =>
      text === P0_IMPLEMENTATION_FACTS_QUERY
        ? { rows: [factRow({ short_paraphrase: "PAN: 4111111111111111" })] }
        : { rows: [] },
    );
    await expect(
      createPostgresP0ImplementationCatalogueStore(pan).list(),
    ).rejects.toThrow("p0_implementation_short_paraphrase_invalid");

    const creditCard = clientFor((text) =>
      text === P0_IMPLEMENTATION_FACTS_QUERY
        ? {
            rows: [
              factRow({
                short_paraphrase: "credit-card: 4111 1111 1111 1111",
              }),
            ],
          }
        : { rows: [] },
    );
    await expect(
      createPostgresP0ImplementationCatalogueStore(creditCard).list(),
    ).rejects.toThrow("p0_implementation_short_paraphrase_invalid");
  });

  it("fails closed for row shape drift, overflow, proxies, and non-enumerable input", async () => {
    const extra = clientFor((text) =>
      text === P0_IMPLEMENTATION_FACTS_QUERY
        ? { rows: [factRow({ value: "raw" })] }
        : { rows: [] },
    );
    await expect(
      createPostgresP0ImplementationCatalogueStore(extra).list(),
    ).rejects.toThrow("p0_implementation_fact_row_shape_invalid");

    const tooMany = clientFor((text) =>
      text === P0_IMPLEMENTATION_FACTS_QUERY
        ? {
            rows: Array.from({ length: 130 }, (_, index) =>
              factRow({
                fact_id: `11111111-1111-4111-8111-${String(index + 1).padStart(12, "0")}`,
              }),
            ),
          }
        : { rows: [] },
    );
    await expect(
      createPostgresP0ImplementationCatalogueStore(tooMany).search({
        limit: 128,
      }),
    ).rejects.toThrow("p0_implementation_too_many_rows");

    const proxy = new Proxy({ query: "safe" }, {});
    await expect(
      createPostgresP0ImplementationCatalogueStore(
        clientFor(() => ({ rows: [] })),
      ).search(proxy),
    ).rejects.toThrow("p0_implementation_search_input_shape_invalid");

    const nonEnumerable = { query: "safe" } as {
      query: string;
      cursor?: string;
    };
    Object.defineProperty(nonEnumerable, "cursor", {
      value: "11111111-1111-4111-8111-111111111111",
      enumerable: false,
    });
    await expect(
      createPostgresP0ImplementationCatalogueStore(
        clientFor(() => ({ rows: [] })),
      ).search(nonEnumerable),
    ).rejects.toThrow("p0_implementation_search_input_shape_invalid");
  });

  it("reports exact corrections in one transaction and releases a pool client", async () => {
    const calls: string[] = [];
    let releaseError: Error | undefined;
    const pool: QueryPool = {
      async query() {
        throw new Error("pool.query must not be used");
      },
      async connect() {
        return {
          async query(text) {
            calls.push(text);
            if (text === P0_IMPLEMENTATION_FACT_CORRECTION_QUERY)
              return {
                rows: [
                  {
                    outcome: "recorded",
                    fact_id: correctionInput.fact_id,
                  },
                ],
              };
            return { rows: [] };
          },
          release(error?: Error) {
            releaseError = error;
          },
        };
      },
    };
    await expect(
      createPostgresP0ImplementationCatalogueStore(pool).reportCorrection(
        correctionInput,
      ),
    ).resolves.toEqual({
      ok: true,
      outcome: "recorded",
      fact_id: correctionInput.fact_id,
    });
    expect(calls).toEqual([
      "BEGIN",
      P0_IMPLEMENTATION_FACT_CORRECTION_QUERY,
      "COMMIT",
    ]);
    expect(releaseError).toBeUndefined();
  });

  it("rejects a correction result bound to a different opaque fact", async () => {
    const target = clientFor((text) => {
      if (text === P0_IMPLEMENTATION_FACT_CORRECTION_QUERY)
        return {
          rows: [
            {
              outcome: "recorded",
              fact_id: "22222222-2222-4222-8222-222222222222",
            },
          ],
        };
      return { rows: [] };
    });
    await expect(
      createPostgresP0ImplementationCatalogueStore(target).reportCorrection(
        correctionInput,
      ),
    ).rejects.toThrow("p0_implementation_correction_fact_mismatch");
  });

  it("rolls back and preserves correction query errors", async () => {
    const failure = new Error("correction failure");
    const calls: string[] = [];
    const target = clientFor((text) => {
      calls.push(text);
      if (text === P0_IMPLEMENTATION_FACT_CORRECTION_QUERY) throw failure;
      return { rows: [] };
    });
    await expect(
      createPostgresP0ImplementationCatalogueStore(target).reportCorrection(
        correctionInput,
      ),
    ).rejects.toBe(failure);
    expect(calls).toEqual([
      "BEGIN",
      P0_IMPLEMENTATION_FACT_CORRECTION_QUERY,
      "ROLLBACK",
    ]);
  });
});
