import { describe, expect, it } from "vitest";
import { projectConsumerReference } from "../src/consumer-reference.js";
import type {
  ImplementationFactCard,
  ImplementationFactCatalogueSnapshot,
} from "../src/contracts.js";
import { handleRequest } from "../src/server.js";

const fact = (
  overrides: Partial<ImplementationFactCard> = {},
): ImplementationFactCard => ({
  fact_key: "11111111-1111-4111-8111-111111111111",
  family_id: "point.rakuten",
  claim_type: "expiry_rule",
  family: "楽天ポイント",
  claim: "有効期限",
  subject: "通常ポイント",
  predicate: "期限があります",
  summary: "通常ポイントの期限に関する情報です。",
  use_in_comparison: false,
  source_url: "https://example.com/official",
  checked_at: "2026-08-20T00:00:00Z",
  effective_from: null,
  effective_to: null,
  ...overrides,
});

const snapshot = (
  facts: readonly ImplementationFactCard[],
): ImplementationFactCatalogueSnapshot => ({
  status: "ready",
  updated_at: "2026-08-22T00:00:00Z",
  facts,
});

describe("consumer reference projection", () => {
  it("groups source-backed wallet and merchant facts without calculation authority", () => {
    const result = projectConsumerReference(
      snapshot([
        fact(),
        fact({
          fact_key: "22222222-2222-4222-8222-222222222222",
          family_id: "merchant.lawson",
          family: "ローソン",
          claim_type: "merchant_acceptance",
          claim: "利用できるお店",
          effective_from: "2026-08-01",
          effective_to: "2026-08-31",
        }),
        fact({
          fact_key: "33333333-3333-4333-8333-333333333333",
          family_id: "card.rakuten",
          family: "楽天カード",
          claim_type: "earn_rule",
        }),
      ]),
      "2026-08-23T00:00:00Z",
    );
    expect(result).toMatchObject({
      version: "consumer-reference.v1",
      automatic_application: true,
      manual_promotion_required: false,
      coverage: {
        wallet_program_count: 1,
        merchant_count: 1,
        fact_count: 2,
      },
    });
    expect(result.wallet_programs[0]?.family_id).toBe("point.rakuten");
    expect(result.merchants[0]?.facts[0]).toMatchObject({
      claim_type: "merchant_acceptance",
      validity_state: "active",
      logic_role: "merchant_eligibility",
      source_url: "https://example.com/official",
    });
    expect(JSON.stringify(result)).not.toContain("parent_claim_id");
  });

  it("classifies scheduled and expired applicability without inventing dates", () => {
    const result = projectConsumerReference(
      snapshot([
        fact({ effective_from: "2026-09-01" }),
        fact({
          fact_key: "22222222-2222-4222-8222-222222222222",
          effective_to: "2026-08-01",
        }),
      ]),
      "2026-08-23T12:00:00Z",
    );
    expect(
      result.wallet_programs[0]?.facts.map((item) => item.validity_state),
    ).toEqual(["scheduled", "expired"]);
  });

  it("rejects an invalid effective timestamp", () => {
    expect(() =>
      projectConsumerReference(snapshot([fact()]), "not-a-date"),
    ).toThrow("consumer_reference_effective_at_invalid");
  });

  it("serves the bounded reference through a GET-only endpoint", async () => {
    const source = snapshot([fact()]);
    const dependency = {
      implementationFacts: {
        async list() {
          return source;
        },
        async reportCorrection() {
          return { ok: false as const, code: "fact_not_found" as const };
        },
      },
    };
    const response = await handleRequest(
      { method: "GET", pathname: "/api/consumer/reference" },
      dependency,
    );
    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      version: "consumer-reference.v1",
      automatic_application: true,
      manual_promotion_required: false,
      coverage: { wallet_program_count: 1 },
    });
    const rejected = await handleRequest(
      { method: "POST", pathname: "/api/consumer/reference" },
      dependency,
    );
    expect(rejected.status).toBe(405);
    expect(rejected.headers.Allow).toBe("GET");
  });
});
