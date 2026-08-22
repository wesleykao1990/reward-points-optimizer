import type { Asset } from "@jro/contracts";
import {
  compileRuleIR,
  getNanacoEconomicPilotCandidate,
  hashCandidate,
  hashDefinition,
  RULE_IR_VERSION,
} from "@jro/provisional-rules";
import type { AssetLot, RewardRule } from "@jro/rule-engine";
import { describe, expect, it } from "vitest";

import {
  compileExecutionBundle,
  DIRECT_PURCHASE_GRAPH_INPUT_VERSION,
  EXECUTABLE_RULE_BUNDLE_VERSION,
  ExecutionBundleError,
  generateDirectPurchasePlans,
  recommendExecutionBundle,
  validateExecutionBundle,
} from "../src/index.js";

const SHA_A = `sha256:${"a".repeat(64)}` as const;
const SHA_B = `sha256:${"b".repeat(64)}` as const;

function nanacoAsset(): Asset {
  return {
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
      notes: "test principal",
    },
    status: "active",
    notes: "test principal",
  };
}

function pointAsset(): Asset {
  return {
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
      notes: "test reward",
    },
    status: "active",
    notes: "test reward",
  };
}

function externalAsset(): Asset {
  return {
    asset_id: "asset.jpy.external",
    asset_kind: "fiat",
    display_name: "外部資金",
    program_id: null,
    scale: 0,
    default_reward_class: null,
    default_expiry: {
      policy: "none",
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
      notes: "external funding",
    },
    status: "active",
    notes: "test external funding",
  };
}

function nanacoIr() {
  const candidate = getNanacoEconomicPilotCandidate();
  const rule = structuredClone(candidate.rule);
  const definitionHash = hashDefinition(rule);
  const result = compileRuleIR({
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
      candidate_id: candidate.candidate_id,
      candidate_hash: hashCandidate(candidate, definitionHash),
      definition_hash: definitionHash,
    },
    assets: [pointAsset(), nanacoAsset()],
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
  });
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}

function nanacoCampaignIr() {
  const base = getNanacoEconomicPilotCandidate();
  const rule = structuredClone(base.rule) as RewardRule;
  rule.rule_id = "rr_test_nanaco_campaign";
  rule.name = "Test Nanaco campaign";
  rule.provenance.evidence_ids = ["ev_test_nanaco_campaign"];
  rule.stacking.stack_group = rule.rule_id;
  const definitionHash = hashDefinition(rule);
  const result = compileRuleIR({
    version: RULE_IR_VERSION,
    rule,
    source_binding: {
      claim_id: "claim.point.nanaco.campaign.test.001",
      family_id: "point.nanaco",
      source_role_id: "campaign_terms",
      source_ids: ["source.nanaco.campaign.test"],
      observation_id: "observation.nanaco.campaign.test",
      observation_fingerprint: SHA_B,
      evidence_ids: ["ev_test_nanaco_campaign"],
      candidate_id: "candidate.nanaco.campaign.test",
      candidate_hash: SHA_B,
      definition_hash: definitionHash,
    },
    assets: [pointAsset(), nanacoAsset()],
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
  });
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}

function cardIr(overlapNanacoRoute = false) {
  const base = getNanacoEconomicPilotCandidate();
  const rule = structuredClone(base.rule) as RewardRule;
  const suffix = overlapNanacoRoute ? "external_overlap" : "direct_card";
  const evidenceId = `ev_test_${suffix}`;
  rule.rule_id = `rr_test_${suffix}`;
  rule.name = overlapNanacoRoute
    ? "Test overlapping external route"
    : "Test direct card";
  rule.eligibility.operation_match = {
    allowed_payment_instrument_ids: [
      overlapNanacoRoute ? "instrument.jp.nanaco" : "instrument.test.card",
    ],
    allowed_funding_source_ids: [
      overlapNanacoRoute ? "funding.jp.nanaco" : "funding.test.card",
    ],
    allowed_source_asset_ids: ["asset.jpy.external"],
    ...(overlapNanacoRoute
      ? { required_loyalty_program_ids: ["program.jp.nanaco"] }
      : {}),
  };
  rule.eligibility.transaction_conditions.eligible_amount_basis =
    "eligible_line_items";
  rule.provenance.evidence_ids = [evidenceId];
  rule.stacking.stack_group = rule.rule_id;
  const definitionHash = hashDefinition(rule);
  const result = compileRuleIR({
    version: RULE_IR_VERSION,
    rule,
    source_binding: {
      claim_id: `claim.card.test.${suffix}.001`,
      family_id: "card.test",
      source_role_id: "base_reward",
      source_ids: ["source.card.test"],
      observation_id: `observation.card.test.${suffix}`,
      observation_fingerprint: overlapNanacoRoute ? SHA_B : SHA_A,
      evidence_ids: [evidenceId],
      candidate_id: `candidate.card.test.${suffix}`,
      candidate_hash: overlapNanacoRoute ? SHA_B : SHA_A,
      definition_hash: definitionHash,
    },
    assets: [externalAsset(), pointAsset()],
    principal_edges: [
      {
        operation_type: "merchant_purchase",
        direction: "consume",
        role: "external_funding",
        asset: {
          asset_id: "asset.jpy.external",
          asset_kind: "fiat",
          program_id: null,
          reward_class: null,
          scale: 0,
        },
        conservation: "engine_enforced",
      },
    ],
  });
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}

function bundle(order = [nanacoIr(), cardIr()]) {
  const result = compileExecutionBundle({
    version: EXECUTABLE_RULE_BUNDLE_VERSION,
    bundle_id: "bundle.seveneleven.direct.v1",
    rule_irs: order,
    merchant_catalog: {
      version: "merchant-test-v1",
      merchants: [
        {
          merchant_id: "merchant.seveneleven",
          name: "セブン‐イレブン",
          aliases: ["Seven-Eleven"],
          branches: [
            {
              branch_id: "location.seveneleven.representative",
              name: "代表店舗",
              aliases: [],
            },
          ],
        },
      ],
    },
  });
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}

function openingLot(amount = "1000"): AssetLot {
  const asset = nanacoAsset();
  return {
    lot_id: "lot_nanaco_opening",
    quantity: {
      asset: {
        asset_id: asset.asset_id,
        asset_kind: asset.asset_kind,
        program_id: asset.program_id,
        reward_class: asset.default_reward_class,
        scale: asset.scale,
      },
      amount,
    },
    acquired_at: "2026-08-21T00:00:00+09:00",
    source_operation_id: null,
    settlement: {
      status: "posted",
      expected_posting_from: null,
      expected_posting_to: null,
      posted_at: null,
    },
    expiry: asset.default_expiry,
    restrictions: asset.default_usage_restrictions,
    provenance_rule_ids: [],
  };
}

function input(options: { lot?: string; effective_at?: string } = {}) {
  return {
    version: DIRECT_PURCHASE_GRAPH_INPUT_VERSION,
    request_id: "request_test_direct_graph",
    merchant_id: "merchant.seveneleven",
    branch_id: "location.seveneleven.representative",
    channel: "in_store" as const,
    interface: "not_applicable" as const,
    amount_jpy: 220,
    tax_exclusive_amount_jpy: 200,
    product_class: "ordinary",
    effective_at: options.effective_at ?? "2026-08-22T12:00:00+09:00",
    owned_instrument_ids: ["instrument.jp.nanaco", "instrument.test.card"],
    owned_loyalty_program_ids: ["program.jp.nanaco"],
    available_funding_source_ids: ["funding.jp.nanaco", "funding.test.card"],
    asset_lots: [openingLot(options.lot ?? "1000")],
    facts: {},
    cap_progress: {},
    valuation_profile: { version: "unvalued-v1", entries: [] },
  };
}

describe("generic execution bundle", () => {
  it("hashes Rule IR order deterministically and rejects tampering", () => {
    const left = bundle();
    const right = bundle([cardIr(), nanacoIr()]);
    expect(right.bundle_hash).toBe(left.bundle_hash);
    expect(validateExecutionBundle(structuredClone(left)).ok).toBe(true);

    const tampered = structuredClone(left);
    tampered.bundle_id = "bundle.tampered";
    expect(validateExecutionBundle(tampered)).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "bundle_hash_mismatch" }),
      ]),
    });
    expect(compileExecutionBundle(new Proxy(left, {})).ok).toBe(false);
  });

  it("generates explicit stored-value and external-funding plans", () => {
    const generated = generateDirectPurchasePlans(bundle(), input());
    expect(generated.plans).toHaveLength(2);
    expect(generated.plans.map((plan) => plan.plan_id)).toEqual(
      [...generated.plans.map((plan) => plan.plan_id)].sort(),
    );
    const nanaco = generated.plans.find(
      (plan) =>
        plan.operations[0]?.payment_instrument_id === "instrument.jp.nanaco",
    )?.operations[0];
    const card = generated.plans.find(
      (plan) =>
        plan.operations[0]?.payment_instrument_id === "instrument.test.card",
    )?.operations[0];
    expect(nanaco?.asset_inputs[0]).toMatchObject({
      source_lot_id: "lot_nanaco_opening",
      role: "stored_value_tender",
      quantity: { amount: "220" },
    });
    expect(card?.asset_inputs[0]).toMatchObject({
      source_lot_id: null,
      role: "external_funding",
      quantity: { amount: "220" },
    });
    expect(nanaco?.line_items[0]).toMatchObject({
      amount_jpy: 220,
      tax_exclusive_amount_jpy: 200,
    });
  });

  it("deduplicates a payment route while preserving stacked rules", () => {
    const grouped = bundle([nanacoCampaignIr(), cardIr(), nanacoIr()]);
    const generated = generateDirectPurchasePlans(grouped, input());
    expect(generated.plans).toHaveLength(2);
    expect(generated.rule_irs.map((item) => item.rule.rule_id)).toEqual([
      "rr_jp_cvs_006_nanaco_purchase_reward",
      "rr_test_direct_card",
      "rr_test_nanaco_campaign",
    ]);

    const result = recommendExecutionBundle(grouped, input());
    const nanacoPlan = result.response.plans.find(
      (plan) =>
        plan.operations[0]?.payment_instrument_id === "instrument.jp.nanaco",
    );
    expect(nanacoPlan?.rewards.map((reward) => reward.quantity.amount)).toEqual(
      ["1", "1"],
    );
  });

  it("keeps rules isolated when instrument and funding match but principal assets differ", () => {
    const separated = bundle([cardIr(true), nanacoIr()]);
    const generated = generateDirectPurchasePlans(separated, input());
    expect(generated.plans).toHaveLength(2);
    expect(
      new Set(
        generated.plans.map(
          (plan) =>
            plan.operations[0]?.asset_inputs[0]?.quantity.asset.asset_id,
        ),
      ),
    ).toEqual(new Set(["asset.jpy.external", "asset.jp.nanaco"]));

    const result = recommendExecutionBundle(separated, input());
    expect(result.response.plans).toHaveLength(2);
    expect(
      result.response.plans.map((plan) => plan.rewards.length).sort(),
    ).toEqual([1, 1]);
  });

  it("runs generated plans through the deterministic recommendation engine", () => {
    const result = recommendExecutionBundle(bundle(), input());
    expect(result.response.verification_status).toBe("experimental_unverified");
    expect(result.response.plans).toHaveLength(2);
    expect(result.response.eligible_plans).toHaveLength(2);
    expect(
      result.response.plans.every((plan) => {
        const economics = plan.economics as {
          guaranteed_reward_value_jpy?: { expected_jpy?: string };
        } | null;
        return economics?.guaranteed_reward_value_jpy?.expected_jpy === "0";
      }),
    ).toBe(true);
    expect(
      result.response.plans.every(
        (plan) =>
          plan.rewards.length === 1 &&
          (plan.rewards[0] as { quantity?: { amount?: string } }).quantity
            ?.amount === "1",
      ),
    ).toBe(true);
  });

  it("omits unfunded and inactive routes with deterministic issues", () => {
    const insufficient = generateDirectPurchasePlans(
      bundle(),
      input({ lot: "100" }),
    );
    expect(insufficient.plans).toHaveLength(1);
    expect(insufficient.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "principal_balance_insufficient",
          rule_id: "rr_jp_cvs_006_nanaco_purchase_reward",
        }),
      ]),
    );

    expect(() =>
      recommendExecutionBundle(
        compileExecutionBundle({
          version: EXECUTABLE_RULE_BUNDLE_VERSION,
          bundle_id: "nanaco-only",
          rule_irs: [nanacoIr()],
          merchant_catalog: bundle().merchant_catalog,
        }).value,
        input({ lot: "0" }),
      ),
    ).toThrowError(ExecutionBundleError);

    const inactive = generateDirectPurchasePlans(
      bundle(),
      input({ effective_at: "2026-08-19T12:00:00+09:00" }),
    );
    expect(inactive.plans).toHaveLength(0);
    expect(inactive.issues.every((item) => item.code === "rule_inactive")).toBe(
      true,
    );
  });
});
