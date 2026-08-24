import { describe, expect, it } from "vitest";
import {
  ACTIVE_MERCHANT_PAYMENT_ACCEPTANCE_QUERY,
  ACTIVE_RULE_FAMILIES_QUERY,
  AGENT_FEED_TYPED_RULE_RECORDS_QUERY,
  createPostgresAgentFeedTypedRuleRecordStore,
  MAX_AGENT_FEED_TYPED_RULE_RECORDS,
  type QueryClient,
  type QueryResult,
} from "../src/index.js";

type JsonRecord = Record<string, unknown>;

const RECORD_ID = "11111111-1111-4111-8111-111111111111";
const SOURCE_ID = "22222222-2222-4222-8222-222222222222";
const RULE_ID = `atr_${"a".repeat(64)}`;

function typedRuleRow(overrides: JsonRecord = {}): JsonRecord {
  return {
    record_id: RECORD_ID,
    rule_id: RULE_ID,
    rule_version: 1,
    source_kind: "source_observation",
    source_id: SOURCE_ID,
    source_identity: {
      semantic_fingerprint_version: 1,
      semantic_fingerprint: `sha256:${"b".repeat(64)}`,
    },
    family_id: "family.dynamic",
    source_role_id: "earn_rules",
    rule_class: "arithmetic_reward",
    calculable: true,
    merchant_id: "merchant.dynamic",
    payment_family: "card",
    subjects: [{ type: "merchant", id: "merchant.dynamic", name: "Dynamic" }],
    raw_attributes: {
      calculable: true,
      calculation: {
        model: "points_per_unit",
        spend_jpy: 100,
        reward_units: "1",
      },
    },
    applicability: {},
    payload_hash: `sha256:${"c".repeat(64)}`,
    observed_at: "2026-08-24T00:00:00.000Z",
    ...overrides,
  };
}

function familyRow(overrides: JsonRecord = {}): JsonRecord {
  return {
    family_id: "family.dynamic",
    rule_count: "1",
    calculable_rule_count: "1",
    acceptance_count: "1",
    ...overrides,
  };
}

function acceptanceRow(overrides: JsonRecord = {}): JsonRecord {
  return {
    merchant_id: "merchant.dynamic",
    payment_family: "card",
    accepted: true,
    rule_id: RULE_ID,
    rule_version: 1,
    source_kind: "source_observation",
    source_id: SOURCE_ID,
    observed_at: "2026-08-24T00:00:00.000Z",
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

describe("PostgreSQL universal typed Agent Feed rule store", () => {
  it("lists dynamic records, families, and merchant authority without an approval/evidence query", async () => {
    const seen: string[] = [];
    const target = clientFor((text, values) => {
      expect(values).toEqual(["2026-08-24T00:01:00Z"]);
      seen.push(text);
      if (text === AGENT_FEED_TYPED_RULE_RECORDS_QUERY)
        return { rows: [typedRuleRow()] };
      if (text === ACTIVE_RULE_FAMILIES_QUERY) return { rows: [familyRow()] };
      if (text === ACTIVE_MERCHANT_PAYMENT_ACCEPTANCE_QUERY)
        return { rows: [acceptanceRow()] };
      throw new Error("unexpected query");
    });

    const store = createPostgresAgentFeedTypedRuleRecordStore(target);
    const records = await store.list("2026-08-24T00:01:00Z");
    const families = await store.listFamilies("2026-08-24T00:01:00Z");
    const acceptance = await store.listMerchantPaymentAcceptance(
      "2026-08-24T00:01:00Z",
    );

    expect(records[0]).toMatchObject({
      family_id: "family.dynamic",
      calculable: true,
      raw_attributes: {
        calculation: { model: "points_per_unit" },
      },
    });
    expect(families).toEqual([
      {
        family_id: "family.dynamic",
        rule_count: 1,
        calculable_rule_count: 1,
        acceptance_count: 1,
      },
    ]);
    expect(acceptance[0]).toMatchObject({
      merchant_id: "merchant.dynamic",
      payment_family: "card",
      accepted: true,
    });
    expect(seen).toEqual([
      AGENT_FEED_TYPED_RULE_RECORDS_QUERY,
      ACTIVE_RULE_FAMILIES_QUERY,
      ACTIVE_MERCHANT_PAYMENT_ACCEPTANCE_QUERY,
    ]);
  });

  it("fails closed for raw attribute secrets, shape drift, oversized results, and invalid time", async () => {
    const secret = clientFor((text) =>
      text === AGENT_FEED_TYPED_RULE_RECORDS_QUERY
        ? {
            rows: [
              typedRuleRow({ raw_attributes: { api_token: "secret-value" } }),
            ],
          }
        : { rows: [] },
    );
    await expect(
      createPostgresAgentFeedTypedRuleRecordStore(secret).list(
        "2026-08-24T00:01:00Z",
      ),
    ).rejects.toThrow("agent_feed_typed_rule_raw_attributes_invalid");

    const drift = clientFor((text) =>
      text === AGENT_FEED_TYPED_RULE_RECORDS_QUERY
        ? { rows: [typedRuleRow({ unexpected: true })] }
        : { rows: [] },
    );
    await expect(
      createPostgresAgentFeedTypedRuleRecordStore(drift).list(
        "2026-08-24T00:01:00Z",
      ),
    ).rejects.toThrow("agent_feed_typed_rule_row_shape_invalid");

    const tooMany = clientFor((text) =>
      text === AGENT_FEED_TYPED_RULE_RECORDS_QUERY
        ? {
            rows: Array.from(
              { length: MAX_AGENT_FEED_TYPED_RULE_RECORDS + 1 },
              (_, index) =>
                typedRuleRow({
                  record_id: `11111111-1111-4111-8111-${String(index + 1).padStart(12, "0")}`,
                }),
            ),
          }
        : { rows: [] },
    );
    await expect(
      createPostgresAgentFeedTypedRuleRecordStore(tooMany).list(
        "2026-08-24T00:01:00Z",
      ),
    ).rejects.toThrow("agent_feed_typed_rule_too_many_rows");

    const unreachable = clientFor(() => {
      throw new Error("database should not be called");
    });
    await expect(
      createPostgresAgentFeedTypedRuleRecordStore(unreachable).list(
        "not-a-date",
      ),
    ).rejects.toThrow("agent_feed_typed_rule_effective_at_invalid");
    await expect(
      createPostgresAgentFeedTypedRuleRecordStore(unreachable).list(
        "2026-09-31T00:00:00+09:00",
      ),
    ).rejects.toThrow("agent_feed_typed_rule_effective_at_invalid");
  });
});
