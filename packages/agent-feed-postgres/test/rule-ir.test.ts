import { readFile } from "node:fs/promises";
import {
  hashCandidate,
  hashDefinition,
  type ProvisionalRuleCandidate,
} from "@jro/provisional-rules";
import { beforeAll, describe, expect, it } from "vitest";
import {
  compileP0EconomicCandidateRow,
  loadCurrentP0EconomicRuleIRs,
  type P0TrustedRuleIRBindings,
} from "../src/index.js";

type JsonRecord = Record<string, unknown>;

let candidate: ProvisionalRuleCandidate;

beforeAll(async () => {
  candidate = JSON.parse(
    await readFile(
      new URL(
        "../../../fixtures/m3/provisional/p0-nanaco-economic-candidate.v0.1.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as ProvisionalRuleCandidate;
});

const assets = [
  {
    asset_id: "asset.jp.nanaco",
    asset_kind: "stored_value",
    display_name: "nanaco電子マネー",
    program_id: "program.jp.nanaco",
    scale: 0,
    default_reward_class: null,
    default_expiry: {
      policy: "unknown",
      expires_at: null,
      duration_days: null,
      timezone: "Asia/Tokyo",
    },
    default_usage_restrictions: {
      transferable: null,
      redeemable_for_cash: null,
      usable_for_payment: true,
      investable: null,
      permitted_destination_ids: [],
      notes: "principal",
    },
    status: "active",
    notes: "trusted fixture asset",
  },
  {
    asset_id: "asset.jp.nanaco-point",
    asset_kind: "reward_point",
    display_name: "nanacoポイント",
    program_id: "program.jp.nanaco",
    scale: 0,
    default_reward_class: "normal",
    default_expiry: {
      policy: "unknown",
      expires_at: null,
      duration_days: null,
      timezone: "Asia/Tokyo",
    },
    default_usage_restrictions: {
      transferable: null,
      redeemable_for_cash: null,
      usable_for_payment: null,
      investable: null,
      permitted_destination_ids: ["asset.jp.nanaco"],
      notes: "reward",
    },
    status: "active",
    notes: "trusted fixture asset",
  },
] as const;

const bindings: P0TrustedRuleIRBindings = {
  claim_id: "claim.point.nanaco.earn.shopping-immediate.004",
  evidence_ids: ["ev_m3_nanaco_shopping_earning_20260820"],
  assets,
  principal_edges: [
    {
      operation_type: "merchant_purchase",
      direction: "consume",
      role: "principal_tender",
      asset: {
        asset_id: "asset.jp.nanaco",
        asset_kind: "stored_value",
        program_id: "program.jp.nanaco",
        reward_class: null,
        scale: 0,
      },
      conservation: "engine_enforced",
    },
  ],
};

function row(overrides: JsonRecord = {}): JsonRecord {
  return {
    candidate_hash: hashCandidate(candidate, hashDefinition(candidate.rule)),
    definition_hash: hashDefinition(candidate.rule),
    candidate_id: candidate.candidate_id,
    candidate_payload: structuredClone(candidate),
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

describe("database candidate to Rule IR boundary", () => {
  it("compiles only with a separate trusted asset/edge/evidence binding", () => {
    const first = compileP0EconomicCandidateRow(
      row(),
      "2026-08-22T00:00:00Z",
      bindings,
    );
    const second = compileP0EconomicCandidateRow(
      row(),
      "2026-08-22T00:00:00Z",
      bindings,
    );
    expect(first.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.value.bundle_hash).toBe(second.value.bundle_hash);
      expect(first.value.source_binding.candidate_id).toBe(
        candidate.candidate_id,
      );
      expect(first.value.assets).toHaveLength(2);
    }
  });

  it("normalizes only the two node-postgres timestamptz columns", () => {
    const checkedAt = new Date(candidate.machine_check.checked_at);
    const result = compileP0EconomicCandidateRow(
      row({ machine_checked_at: checkedAt, admitted_at: checkedAt }),
      "2026-08-22T00:00:00Z",
      bindings,
    );
    expect(result.ok).toBe(true);

    const unexpectedDate = compileP0EconomicCandidateRow(
      row({ candidate_id: checkedAt }),
      "2026-08-22T00:00:00Z",
      bindings,
    );
    expect(unexpectedDate.ok).toBe(false);
    expect(unexpectedDate.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "representation_invalid",
          path: "/candidate_id",
        }),
      ]),
    );
  });

  it("reports incomplete rows instead of inventing graph material", () => {
    const result = compileP0EconomicCandidateRow(row(), "2026-08-22T00:00:00Z");
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "incomplete", path: "/bindings" }),
      ]),
    );
  });

  it("rejects extra, accessor-backed, and proxy rows before field use", () => {
    expect(
      compileP0EconomicCandidateRow(
        row({ unexpected: true }),
        "2026-08-22T00:00:00Z",
        bindings,
      ),
    ).toMatchObject({
      ok: false,
      issues: [expect.objectContaining({ code: "shape_invalid" })],
    });
    const accessor = row();
    Object.defineProperty(accessor, "candidate_id", {
      enumerable: true,
      get: () => candidate.candidate_id,
    });
    expect(
      compileP0EconomicCandidateRow(accessor, "2026-08-22T00:00:00Z", bindings),
    ).toMatchObject({
      ok: false,
      issues: [expect.objectContaining({ code: "representation_invalid" })],
    });
    expect(
      compileP0EconomicCandidateRow(
        new Proxy(row(), {}),
        "2026-08-22T00:00:00Z",
        bindings,
      ),
    ).toMatchObject({
      ok: false,
      issues: [expect.objectContaining({ code: "representation_invalid" })],
    });
  });

  it("rejects definition/evidence drift and inactive candidates", () => {
    const drifted = compileP0EconomicCandidateRow(
      row({ definition_hash: `sha256:${"0".repeat(64)}` }),
      "2026-08-22T00:00:00Z",
      bindings,
    );
    expect(drifted.ok).toBe(false);
    expect(drifted.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "definition_hash_mismatch" }),
      ]),
    );
    const evidence = compileP0EconomicCandidateRow(
      row(),
      "2026-08-22T00:00:00Z",
      { ...bindings, evidence_ids: ["ev_other"] },
    );
    expect(evidence.ok).toBe(false);
    expect(evidence.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "evidence_mismatch" }),
      ]),
    );
    const inactive = compileP0EconomicCandidateRow(
      row({ status: "disputed" }),
      "2026-08-22T00:00:00Z",
      bindings,
    );
    expect(inactive.ok).toBe(false);
    expect(inactive.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "inactive" })]),
    );
  });

  it("binds database identity, authority, and machine-check time", () => {
    const cases: readonly [JsonRecord, "shape_invalid" | "binding_mismatch"][] =
      [
        [{ source_observation_id: "not-a-uuid" }, "shape_invalid"],
        [{ source_authority_role: "corroborating" }, "binding_mismatch"],
        [{ machine_checked_at: "2026-08-22T00:00:00Z" }, "binding_mismatch"],
        [{ admitted_at: "2026-09-31T00:00:00Z" }, "shape_invalid"],
      ];
    for (const [overrides, code] of cases) {
      const result = compileP0EconomicCandidateRow(
        row(overrides),
        "2026-08-22T00:00:00Z",
        bindings,
      );
      expect(result.ok).toBe(false);
      expect(result.issues).toEqual(
        expect.arrayContaining([expect.objectContaining({ code })]),
      );
    }
  });

  it("loads current rows in deterministic Rule IR order", async () => {
    const target = {
      query: async () => ({ rows: [row()] }),
    };
    const result = await loadCurrentP0EconomicRuleIRs(target, {
      effective_at: "2026-08-22T00:00:00Z",
      bindings: { [candidate.candidate_id as string]: bindings },
      rule_ids: [candidate.rule.rule_id],
    });
    expect(result.issues).toEqual([]);
    expect(result.rule_irs.map((item) => item.bundle_hash)).toEqual([
      result.rule_irs[0]?.bundle_hash,
    ]);
  });
});
