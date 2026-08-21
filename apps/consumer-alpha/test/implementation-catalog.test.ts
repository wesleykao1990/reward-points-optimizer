import { readFileSync } from "node:fs";
import type {
  P0ImplementationFact,
  P0ImplementationFactSearchInput,
} from "@jro/agent-feed-postgres";
import { describe, expect, it } from "vitest";
import {
  createPostgresImplementationFactCataloguePort,
  resetImplementationFactCatalogue,
} from "../src/implementation-catalog.js";
import {
  IMPLEMENTATION_PREDICATE_LABEL_COUNT,
  IMPLEMENTATION_SUMMARY_TRANSLATION_COUNT,
  localizeImplementationPredicate,
  localizeImplementationSubject,
  localizeImplementationSummary,
} from "../src/implementation-localization.js";
import { handleRequest, resetIssuedRecommendationIds } from "../src/server.js";

type JsonRecord = Record<string, unknown>;

const jsonBody = (response: { body: string }) =>
  JSON.parse(response.body) as JsonRecord;

const jsonRequest = (method: string, pathname: string, body: unknown) => {
  const serialized = JSON.stringify(body);
  return handleRequest({
    method,
    pathname,
    headers: {
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(serialized, "utf8")),
    },
    body: serialized,
  });
};

const hasJapanese = (value: string) =>
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(value);

const numericTokens = (value: string) =>
  (value.match(/\d+(?:[.,]\d+)?/gu) ?? []).sort();

const fixture = JSON.parse(
  readFileSync(
    new URL(
      "../../../fixtures/m3/provisional/p0-point-rules-a.implementation.v0.1.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as {
  entries: readonly {
    predicate: string;
    short_paraphrase: string;
    subject: string;
  }[];
};

const implementationFixturePaths = [
  "p0-point-rules-a.implementation.v0.1.json",
  "p0-point-rules-b.implementation.v0.4.json",
  "p0-wallet-card-rules.implementation.v0.5.json",
  "p0-merchant-transit-regulatory-rules.implementation.v0.6.json",
] as const;

const allFixtureEntries = implementationFixturePaths.flatMap((filename) => {
  const document = JSON.parse(
    readFileSync(
      new URL(`../../../fixtures/m3/provisional/${filename}`, import.meta.url),
      "utf8",
    ),
  ) as {
    entries: readonly {
      predicate: string;
      short_paraphrase: string;
      subject: string;
    }[];
  };
  return document.entries;
});

describe("P0 implementation-fact information catalogue", () => {
  it("covers every fixture predicate and paraphrase with Japanese text", () => {
    expect(fixture.entries).toHaveLength(87);
    expect(IMPLEMENTATION_PREDICATE_LABEL_COUNT).toBe(295);
    expect(IMPLEMENTATION_SUMMARY_TRANSLATION_COUNT).toBe(364);
    for (const [index, entry] of fixture.entries.entries()) {
      const predicate = localizeImplementationPredicate(entry.predicate);
      const summary = localizeImplementationSummary(
        entry.short_paraphrase,
        entry.subject,
        "条件",
      );
      expect(hasJapanese(predicate)).toBe(true);
      expect(predicate).not.toBe(entry.predicate);
      expect(predicate).not.toBe("適用条件");
      expect(hasJapanese(summary)).toBe(true);
      expect(summary).not.toContain(entry.short_paraphrase);
      expect(numericTokens(summary), `fixture entry ${index}`).toEqual(
        numericTokens(entry.short_paraphrase),
      );
    }
    const fallback = localizeImplementationSummary(
      "future_machine_predicate details",
      "future_internal_subject",
      "条件",
      "ポイント情報",
    );
    expect(fallback).toBe(
      "「このサービス」のポイント情報・条件に関する情報です。",
    );
    expect(hasJapanese(fallback)).toBe(true);
    expect(fallback).not.toContain("future_machine_predicate");
  });

  it("localizes every implementation subject and summary across the 364-fact wave", () => {
    expect(allFixtureEntries).toHaveLength(364);
    expect(IMPLEMENTATION_PREDICATE_LABEL_COUNT).toBe(295);
    expect(IMPLEMENTATION_SUMMARY_TRANSLATION_COUNT).toBe(364);
    for (const [index, entry] of allFixtureEntries.entries()) {
      const predicate = localizeImplementationPredicate(entry.predicate);
      const subject = localizeImplementationSubject(entry.subject);
      const summary = localizeImplementationSummary(
        entry.short_paraphrase,
        subject,
        "条件",
        "ポイント情報",
      );
      expect(predicate, `predicate ${index}`).not.toBe("適用条件");
      expect(subject, `subject ${index}`).not.toBe("このサービス");
      expect(hasJapanese(subject), `subject ${index}`).toBe(true);
      expect(hasJapanese(predicate), `predicate ${index}`).toBe(true);
      expect(hasJapanese(summary), `summary ${index}`).toBe(true);
      expect(summary, `summary ${index}`).not.toContain(entry.short_paraphrase);
      expect(numericTokens(summary), `summary ${index}`).toEqual(
        numericTokens(entry.short_paraphrase),
      );
    }
    expect(localizeImplementationSubject("future_internal_subject")).toBe(
      "このサービス",
    );
  });

  it("hides an unknown machine subject and summary from a database-backed row", async () => {
    const store = {
      async search() {
        return {
          facts: [
            {
              fact_id: "11111111-1111-4111-8111-111111111111",
              implementation_version: "future",
              fact_version: 1,
              family_id: "point.future",
              source_role_id: "future",
              source_ids: ["future"],
              claim_type: "future_claim",
              subject: "future_internal_subject",
              predicate: "future_machine_predicate",
              short_paraphrase: "Future English implementation prose.",
              disposition: "catalogue_fact",
              reason: "non_calculable_fact",
              reason_detail: "private",
            },
          ],
          has_more: false,
        };
      },
      async reportCorrection() {
        return {
          ok: true as const,
          outcome: "recorded" as const,
          fact_id: "11111111-1111-4111-8111-111111111111",
        };
      },
    };
    const snapshot =
      await createPostgresImplementationFactCataloguePort(store).list();
    const fact = snapshot.facts[0];
    expect(fact?.subject).toBe("このサービス");
    expect(fact?.predicate).toBe("適用条件");
    expect(fact?.summary).not.toContain("Future English implementation prose");
    expect(fact?.summary).toContain("ポイント情報");
    expect(fact?.summary).toContain("その他の条件");
  });

  it("returns exactly the 87 browser-safe facts with Japanese facets", async () => {
    resetImplementationFactCatalogue();
    const response = await handleRequest({
      method: "GET",
      pathname: "/api/experimental/facts",
    });
    expect(response.status).toBe(200);
    const body = jsonBody(response);
    expect(Object.keys(body).sort()).toEqual(["facts", "status", "updated_at"]);
    expect(body.status).toBe("partial");
    const facts = body.facts as JsonRecord[];
    expect(facts).toHaveLength(87);
    expect(new Set(facts.map((fact) => fact.family))).toEqual(
      new Set(["dポイント", "JRE POINT", "nanacoポイント", "PayPayポイント"]),
    );
    expect(facts.every((fact) => fact.use_in_comparison === false)).toBe(true);
    for (const fact of facts) {
      expect(Object.keys(fact).sort()).toEqual([
        "claim",
        "fact_key",
        "family",
        "predicate",
        "subject",
        "summary",
        "use_in_comparison",
      ]);
      expect(fact.fact_key).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,
      );
      expect(hasJapanese(String(fact.predicate))).toBe(true);
      expect(hasJapanese(String(fact.summary))).toBe(true);
    }
    expect(JSON.stringify(body)).not.toMatch(
      /implementation_hash|source_ids|evidence_locator|parent_claim_id|reason_detail|candidate_hash|https?:\/\//iu,
    );
  });

  it("binds a correction to exactly one fact, is idempotent, and keeps siblings", async () => {
    resetImplementationFactCatalogue();
    const before = jsonBody(
      await handleRequest({
        method: "GET",
        pathname: "/api/experimental/facts",
      }),
    ).facts as JsonRecord[];
    const first = before[0];
    const sibling = before[1];
    expect(first?.fact_key).toBeTypeOf("string");
    expect(sibling?.fact_key).toBeTypeOf("string");

    const recorded = await jsonRequest(
      "POST",
      "/api/experimental/fact-corrections",
      { fact_key: first?.fact_key, category: "fact_incorrect" },
    );
    expect(recorded.status).toBe(200);
    expect(jsonBody(recorded)).toEqual({
      correction: {
        fact_key: first?.fact_key,
        category: "fact_incorrect",
        accepted: true,
      },
    });

    const after = jsonBody(
      await handleRequest({
        method: "GET",
        pathname: "/api/experimental/facts",
      }),
    ).facts as JsonRecord[];
    expect(after).toHaveLength(86);
    expect(after.some((fact) => fact.fact_key === first?.fact_key)).toBe(false);
    expect(after.some((fact) => fact.fact_key === sibling?.fact_key)).toBe(
      true,
    );

    const duplicate = await jsonRequest(
      "POST",
      "/api/experimental/fact-corrections",
      { fact_key: first?.fact_key, category: "fact_incorrect" },
    );
    expect(duplicate.status).toBe(200);
    const stale = await jsonRequest(
      "POST",
      "/api/experimental/fact-corrections",
      { fact_key: first?.fact_key, category: "fact_outdated" },
    );
    expect(stale.status).toBe(409);
    expect(jsonBody(stale)).toMatchObject({
      error: { code: "fact_not_active" },
    });
  });

  it("pages through a database catalogue instead of truncating at one page", async () => {
    const records: P0ImplementationFact[] = Array.from(
      { length: 130 },
      (_, index) => ({
        fact_id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        implementation_version: "p0-point-rules-a.implementation.v0.1",
        fact_version: 1,
        family_id: "point.d",
        source_role_id: "earn_rules",
        source_ids: ["source.d.earn"],
        claim_type: "earn_rule",
        subject: `件名 ${index + 1}`,
        predicate: "awards_points_per_amount",
        short_paraphrase: `要約 ${index + 1}`,
        disposition: "catalogue_fact",
        reason: "non_calculable_fact",
        reason_detail: "Catalogue fact.",
      }),
    );
    let page = 0;
    const effectiveTimes: string[] = [];
    const store = {
      async search(input: P0ImplementationFactSearchInput = {}) {
        if (typeof input.effective_at === "string")
          effectiveTimes.push(input.effective_at);
        const start = page === 0 ? 0 : 128;
        page += 1;
        return {
          facts: records.slice(start, start === 0 ? 128 : undefined),
          has_more: start === 0,
          ...(start === 0 ? { next_cursor: records[127]?.fact_id } : {}),
        };
      },
      async list() {
        throw new Error("list should not be used for pagination");
      },
      async reportCorrection() {
        return {
          ok: true as const,
          outcome: "recorded" as const,
          fact_id:
            records[0]?.fact_id ?? "00000000-0000-4000-8000-000000000001",
        };
      },
    };
    let clockCalls = 0;
    const snapshot = await createPostgresImplementationFactCataloguePort(
      store,
      {
        clock() {
          clockCalls += 1;
          return new Date("2026-08-31T14:59:59.000Z");
        },
      },
    ).list();
    expect(page).toBe(2);
    expect(clockCalls).toBe(1);
    expect(effectiveTimes).toEqual([
      "2026-08-31T14:59:59.000Z",
      "2026-08-31T14:59:59.000Z",
    ]);
    expect(snapshot.status).toBe("ready");
    expect(snapshot.facts).toHaveLength(130);
  });

  it("rejects forged identifiers, categories, and hostile injected snapshots", async () => {
    resetImplementationFactCatalogue();
    const badId = await jsonRequest(
      "POST",
      "/api/experimental/fact-corrections",
      { fact_key: "claim.point.d.earn.001", category: "fact_incorrect" },
    );
    expect(badId.status).toBe(400);
    expect(jsonBody(badId)).toMatchObject({
      error: { code: "fact_key_invalid" },
    });

    const badCategory = await jsonRequest(
      "POST",
      "/api/experimental/fact-corrections",
      {
        fact_key: "11111111-1111-4111-8111-111111111111",
        category: "approval_required",
      },
    );
    expect(badCategory.status).toBe(400);
    expect(jsonBody(badCategory)).toMatchObject({
      error: { code: "implementation_fact_correction_category_invalid" },
    });

    const hostile = {
      implementationFacts: {
        async list() {
          return {
            status: "ready",
            updated_at: null,
            facts: [
              {
                fact_key: "11111111-1111-4111-8111-111111111111",
                family: "dポイント",
                claim: "貯まる条件",
                subject: "safe",
                predicate: "safe",
                summary: "safe",
                use_in_comparison: false,
                implementation_hash: "sha256:secret",
              },
            ],
          };
        },
        async reportCorrection() {
          return { ok: true, outcome: "recorded" };
        },
      },
    };
    const response = await handleRequest(
      { method: "GET", pathname: "/api/experimental/facts" },
      hostile,
    );
    expect(response.status).toBe(503);
    expect(response.body).not.toContain("implementation_hash");
  });

  it("keeps the information tab and correction rendering DOM-safe", () => {
    const html = readFileSync(
      new URL("../public/index.html", import.meta.url),
      "utf8",
    );
    const source = readFileSync(
      new URL("../public/app.js", import.meta.url),
      "utf8",
    );
    expect(html).toContain('data-tab-target="information"');
    expect(html).toContain("情報");
    expect(source).toContain("/api/experimental/facts");
    expect(source).toContain("/api/experimental/fact-corrections");
    expect(source).toContain("textContent");
    expect(source).not.toContain("innerHTML");
    expect(source).not.toContain("localStorage");
    expect(source).not.toContain("sessionStorage");
    resetIssuedRecommendationIds();
  });
});
