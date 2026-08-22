import {
  NANACO_CREDIT_CHARGE_CANDIDATE,
  NANACO_CREDIT_CHARGE_CANDIDATE_ARTIFACT_HASH,
  NANACO_CREDIT_CHARGE_CLAIM_IDS,
  NANACO_CREDIT_CHARGE_DEFINITION_HASH,
  NANACO_CREDIT_CHARGE_EVIDENCE_IDS,
  NANACO_CREDIT_CHARGE_FINDING_ID,
  NANACO_CREDIT_CHARGE_SOURCE_IDS,
} from "@jro/provisional-rules";
import { describe, expect, it } from "vitest";

import {
  createPostgresNanacoCreditChargeRouteStore,
  reduceNanacoCreditChargeRouteRow,
} from "../src/index.js";

const row = () => ({
  candidate_hash: NANACO_CREDIT_CHARGE_CANDIDATE_ARTIFACT_HASH,
  definition_hash: NANACO_CREDIT_CHARGE_DEFINITION_HASH,
  candidate_id: NANACO_CREDIT_CHARGE_CANDIDATE.candidate_id,
  candidate_payload: structuredClone(NANACO_CREDIT_CHARGE_CANDIDATE),
  source_observation_id: "00000000-0000-0000-0000-000000000001",
  source_observation_key: NANACO_CREDIT_CHARGE_CANDIDATE.observation_id,
  observation_fingerprint:
    NANACO_CREDIT_CHARGE_CANDIDATE.observation_fingerprint,
  source_ids: [...NANACO_CREDIT_CHARGE_SOURCE_IDS],
  p0_family_id: "point.nanaco",
  source_role_id: "earn_rules",
  source_authority_role: "primary",
  status: "active_experimental",
  machine_checked_at: "2026-08-22T00:06:00Z",
  admitted_at: "2026-08-22T00:06:30Z",
  route_id: NANACO_CREDIT_CHARGE_CANDIDATE.candidate_id,
  claim_ids: [...NANACO_CREDIT_CHARGE_CLAIM_IDS],
  evidence_ids: [...NANACO_CREDIT_CHARGE_EVIDENCE_IDS],
  bound_source_ids: [...NANACO_CREDIT_CHARGE_SOURCE_IDS],
  finding_id: NANACO_CREDIT_CHARGE_FINDING_ID,
});

describe("PostgreSQL Nanaco credit-charge route adapter", () => {
  it("reduces only the exact source/evidence/rule-bound row", async () => {
    const target = {
      query: async () => ({ rows: [row()], rowCount: 1 }),
    };
    const result = await createPostgresNanacoCreditChargeRouteStore(
      target,
    ).current("2026-08-22T00:00:00+09:00");

    expect(result.route_id).toBe(NANACO_CREDIT_CHARGE_CANDIDATE.candidate_id);
    expect(result.reward_rule.scope.operation_types).toEqual([
      "stored_value_top_up",
    ]);
  });

  it("rejects rule drift, duplicate rows, proxies, and hidden fields", async () => {
    const drifted = row();
    drifted.candidate_payload.rule.calculation.spend_jpy = 201;
    expect(() => reduceNanacoCreditChargeRouteRow(drifted)).toThrow();
    expect(() =>
      reduceNanacoCreditChargeRouteRow(new Proxy(row(), {})),
    ).toThrow();
    const hidden = row() as Record<string, unknown>;
    Object.defineProperty(hidden, "secret", { value: "hidden" });
    expect(() => reduceNanacoCreditChargeRouteRow(hidden)).toThrow();
    const nestedProxy = row();
    nestedProxy.candidate_payload = new Proxy(
      nestedProxy.candidate_payload,
      {},
    );
    expect(() => reduceNanacoCreditChargeRouteRow(nestedProxy)).toThrow();
    expect(() =>
      reduceNanacoCreditChargeRouteRow({
        ...row(),
        machine_checked_at: "2026-09-31T00:00:00+09:00",
      }),
    ).toThrow();

    const target = {
      query: async () => ({ rows: [row(), row()], rowCount: 2 }),
    };
    await expect(
      createPostgresNanacoCreditChargeRouteStore(target).current(
        "2026-08-22T00:00:00+09:00",
      ),
    ).rejects.toThrow(/not_current/u);
  });
});
