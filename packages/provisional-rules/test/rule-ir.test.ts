import type { Asset, RewardRule } from "@jro/contracts";
import { describe, expect, it } from "vitest";

import {
  compileRuleIR,
  getNanacoEconomicPilotCandidate,
  hashCandidate,
  hashDefinition,
  hashRuleIR,
  RULE_IR_VERSION,
  validateRuleIR,
} from "../src/index.js";

function assets(): Asset[] {
  return [
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
        notes: "source-bound reward output",
      },
      status: "active",
      notes: "Rule IR test asset.",
    },
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
        notes: "source-bound principal asset",
      },
      status: "active",
      notes: "Rule IR test principal asset.",
    },
  ];
}

function draft() {
  const candidate = getNanacoEconomicPilotCandidate();
  const rule = structuredClone(candidate.rule) as RewardRule;
  const definitionHash = hashDefinition(rule);
  return {
    version: RULE_IR_VERSION,
    rule,
    source_binding: {
      claim_id: "claim.point.nanaco.earn.shopping-immediate.004",
      family_id: candidate.p0_family_id,
      source_role_id: candidate.source_role_id,
      source_ids: [...candidate.source_ids],
      observation_id: candidate.observation_id,
      observation_fingerprint: candidate.observation_fingerprint,
      evidence_ids: [...rule.provenance.evidence_ids],
      candidate_id: candidate.candidate_id as string,
      candidate_hash: hashCandidate(candidate, definitionHash),
      definition_hash: definitionHash,
    },
    assets: assets(),
    principal_edges: [
      {
        operation_type: "merchant_purchase" as const,
        direction: "consume" as const,
        role: "principal_tender" as const,
        asset: {
          asset_id: "asset.jp.nanaco",
          asset_kind: "stored_value" as const,
          program_id: "program.jp.nanaco",
          reward_class: null,
          scale: 0,
        },
        conservation: "engine_enforced" as const,
      },
    ],
  };
}

describe("Rule IR v1", () => {
  it("compiles a source-bound RewardRule into a frozen deterministic envelope", () => {
    const result = compileRuleIR(draft());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.bundle_hash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(hashRuleIR(result.value)).toBe(result.value.bundle_hash);
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(Object.isFrozen(result.value.rule)).toBe(true);
    expect(validateRuleIR(structuredClone(result.value)).ok).toBe(true);
  });

  it("normalizes set-like binding, asset, and edge order before hashing", () => {
    const left = draft();
    const right = structuredClone(left);
    right.assets.reverse();
    right.source_binding.source_ids.reverse();
    right.source_binding.evidence_ids.reverse();
    const compiledLeft = compileRuleIR(left);
    const compiledRight = compileRuleIR(right);
    expect(compiledLeft.ok).toBe(true);
    expect(compiledRight.ok).toBe(true);
    if (!compiledLeft.ok || !compiledRight.ok) return;
    expect(compiledRight.value.bundle_hash).toBe(
      compiledLeft.value.bundle_hash,
    );
    expect(compiledRight.value.assets.map((asset) => asset.asset_id)).toEqual([
      "asset.jp.nanaco",
      "asset.jp.nanaco-point",
    ]);
  });

  it("rejects loose catalogue facts, extra fields, missing evidence, and unresolved assets", () => {
    expect(compileRuleIR({ claim_id: "claim.only" }).ok).toBe(false);

    const extra = { ...draft(), forged_extra: true };
    expect(compileRuleIR(extra)).toMatchObject({
      ok: false,
      issues: [{ code: "shape_invalid" }],
    });

    const missingEvidence = draft();
    missingEvidence.source_binding.evidence_ids = [];
    expect(compileRuleIR(missingEvidence).ok).toBe(false);

    const unresolved = draft();
    unresolved.assets = unresolved.assets.filter(
      (asset) => asset.asset_id !== "asset.jp.nanaco-point",
    );
    expect(compileRuleIR(unresolved)).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "asset_unresolved" }),
      ]),
    });

    const unboundPrincipal = draft();
    delete unboundPrincipal.rule.eligibility.operation_match
      .allowed_source_asset_ids;
    expect(compileRuleIR(unboundPrincipal)).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "edge_mismatch" }),
      ]),
    });
  });

  it("requires a stored-value principal output for top-up edges", () => {
    const malformed = draft();
    malformed.rule.scope.operation_types = ["stored_value_top_up"];
    malformed.rule.scope.channels = ["not_applicable"];
    malformed.rule.scope.merchant_ids = [];
    malformed.rule.scope.tax_basis = "tax_inclusive";
    delete malformed.rule.scope.included_product_classes;
    delete malformed.rule.scope.excluded_product_classes;
    malformed.source_binding.definition_hash = hashDefinition(malformed.rule);
    malformed.principal_edges = [
      {
        operation_type: "stored_value_top_up",
        direction: "consume",
        role: "external_funding",
        asset: {
          asset_id: "asset.jp.nanaco",
          asset_kind: "stored_value",
          program_id: "program.jp.nanaco",
          reward_class: null,
          scale: 0,
        },
        conservation: "engine_enforced",
      },
      {
        operation_type: "stored_value_top_up",
        direction: "create",
        role: "principal_output",
        asset: {
          asset_id: "asset.jp.nanaco-point",
          asset_kind: "reward_point",
          program_id: "program.jp.nanaco",
          reward_class: "normal",
          scale: 0,
        },
        conservation: "engine_enforced",
      },
    ];
    expect(compileRuleIR(malformed)).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({
          code: "edge_mismatch",
          message: expect.stringContaining("stored_value"),
        }),
      ]),
    });
  });

  it("binds definition and bundle hashes to every semantic dependency", () => {
    const compiled = compileRuleIR(draft());
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    const changedBinding = draft();
    changedBinding.source_binding.claim_id = "claim.point.nanaco.changed.999";
    const changed = compileRuleIR(changedBinding);
    expect(changed.ok).toBe(true);
    if (changed.ok)
      expect(changed.value.bundle_hash).not.toBe(compiled.value.bundle_hash);

    const tampered = structuredClone(compiled.value);
    tampered.source_binding.claim_id = "claim.point.nanaco.tampered.999";
    expect(validateRuleIR(tampered)).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "bundle_hash_mismatch" }),
      ]),
    });

    const changedRule = draft();
    if (changedRule.rule.calculation?.model === "points_per_unit")
      changedRule.rule.calculation.spend_jpy = 201;
    expect(compileRuleIR(changedRule)).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "definition_hash_mismatch" }),
      ]),
    });
  });

  it("rejects hostile representation before dereferencing it", () => {
    let getterReads = 0;
    const getter = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(getter, "version", {
      enumerable: true,
      get() {
        getterReads += 1;
        return RULE_IR_VERSION;
      },
    });
    expect(compileRuleIR(getter).ok).toBe(false);
    expect(getterReads).toBe(0);

    expect(compileRuleIR(new Proxy(draft(), {})).ok).toBe(false);

    const hidden = draft();
    Object.defineProperty(hidden, "hidden", {
      enumerable: false,
      value: "x",
    });
    expect(compileRuleIR(hidden).ok).toBe(false);

    const symbol = draft() as ReturnType<typeof draft> & {
      [key: symbol]: unknown;
    };
    symbol[Symbol("hidden")] = "x";
    expect(compileRuleIR(symbol).ok).toBe(false);

    const sparse = draft();
    sparse.assets = new Array(2);
    sparse.assets[1] = assets()[0] as Asset;
    expect(compileRuleIR(sparse).ok).toBe(false);
  });
});
