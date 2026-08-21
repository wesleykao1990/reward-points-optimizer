import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import {
  ContractValidationError,
  canonicalize,
  compileAllSchemas,
  type GoldenScenario,
  type PurchasePlan,
  type RewardRule,
  tryValidateDocument,
  type UserState,
  validateBitemporalReplay,
  validateDocument,
} from "../src/index.js";

const repositoryRoot = resolve(process.cwd(), "../..");
const example = <T>(file: string): T =>
  YAML.parse(
    readFileSync(resolve(repositoryRoot, "examples", file), "utf8"),
  ) as T;

describe("schema bundle", () => {
  it("compiles all twelve schemas with relative references", () => {
    expect(compileAllSchemas().size).toBe(12);
  });

  it("produces byte-stable canonical JSON independent of object insertion order", () => {
    const first = { z: 1, nested: { b: true, a: "x" }, a: [3, 2, 1] };
    const second = { a: [3, 2, 1], nested: { a: "x", b: true }, z: 1 };
    expect(canonicalize(first)).toBe(canonicalize(second));
  });
});

describe("semantic validation contract", () => {
  it("rejects estimated bounds whose lower value exceeds upper", () => {
    const state = structuredClone(
      example<GoldenScenario>("golden-scenario.example.yaml").user_state,
    ) as UserState;
    state.facts = {};
    state.facts["test.range"] = {
      status: "estimated",
      value: null,
      lower_bound: "10",
      upper_bound: "5",
      observed_at: "2026-08-17T12:00:00+09:00",
      source: "user_input",
      confidence: "0.5",
    };
    const result = tryValidateDocument(state, "user-state");
    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        path: "/facts/test.range",
        code: "estimated_bounds_order",
      }),
    );
  });

  it("rejects unequal known cap progress bounds", () => {
    const state = structuredClone(
      example<GoldenScenario>("golden-scenario.example.yaml").user_state,
    ) as UserState;
    state.cap_progress = {};
    state.cap_progress["test.cap"] = {
      status: "known",
      eligible_spend_jpy_min: 10,
      eligible_spend_jpy_max: 20,
      reward_earned_units_min: "1",
      reward_earned_units_max: "1",
      period_start: "2026-08-01T00:00:00+09:00",
      period_end: "2026-09-01T00:00:00+09:00",
      observed_at: "2026-08-17T12:00:00+09:00",
      source: "user_input",
    };
    const result = tryValidateDocument(state, "user-state");
    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        path: "/cap_progress/test.cap",
        code: "known_cap_bounds_unequal",
      }),
    );
  });

  it("rejects a tax-exclusive line amount above its tender amount", () => {
    const plan = structuredClone(
      example<PurchasePlan>("purchase-plan.example.yaml"),
    );
    const purchase = plan.operations.find(
      (operation) => operation.operation_type === "merchant_purchase",
    );
    if (!purchase?.line_items[0]) throw new Error("purchase line missing");
    purchase.line_items[0].tax_exclusive_amount_jpy =
      purchase.line_items[0].amount_jpy + 1;

    const result = tryValidateDocument(plan, "purchase-plan");
    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "invalid_tax_exclusive_amount" }),
    );
  });

  it("requires tax-exclusive rules to calculate from eligible line items", () => {
    const rule = structuredClone(
      example<RewardRule>("reward-rule.example.yaml"),
    );
    rule.scope.tax_basis = "tax_exclusive";
    rule.eligibility.transaction_conditions.eligible_amount_basis =
      "operation_amount";

    const result = tryValidateDocument(rule, "reward-rule");
    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: "tax_exclusive_basis_requires_eligible_line_items",
      }),
    );
  });

  it("rejects duplicate operations, backward dependencies, and pre-creation lot consumption", () => {
    const plan = structuredClone(
      example<PurchasePlan>("purchase-plan.example.yaml"),
    );
    plan.dependencies[0].from_operation_id = "op_purchase";
    plan.dependencies[0].to_operation_id = "op_topup";
    plan.operations[1].operation_id = plan.operations[0].operation_id;
    const result = tryValidateDocument(plan, "purchase-plan");
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "duplicate_operation_id",
        "dependency_unknown_operation",
      ]),
    );

    const precreation = structuredClone(
      example<PurchasePlan>("purchase-plan.example.yaml"),
    );
    precreation.operations[0].sequence = 2;
    precreation.operations[1].sequence = 1;
    precreation.dependencies[0].from_operation_id = "op_purchase";
    precreation.dependencies[0].to_operation_id = "op_topup";
    const precreationResult = tryValidateDocument(precreation, "purchase-plan");
    expect(precreationResult.issues.map((issue) => issue.code)).toContain(
      "asset_consumption_before_creation",
    );
  });

  it("rejects refund principal that does not match original tender", () => {
    const plan = structuredClone(
      example<PurchasePlan>("purchase-plan.example.yaml"),
    );
    const tender = plan.operations[1]?.asset_inputs[0]?.quantity.asset;
    if (!tender) throw new Error("purchase example tender missing");
    plan.operations.push({
      operation_id: "op_refund",
      sequence: 3,
      occurred_at: "2026-08-17T12:02:00+09:00",
      operation_type: "refund",
      merchant_id: "merchant.synthetic",
      merchant_location_id: null,
      channel: "in_store",
      interface: "qr_code",
      payment_instrument_id: "wallet.synthetic",
      funding_source_id: null,
      amount_jpy: 200,
      asset_inputs: [],
      output_requests: [
        {
          request_id: "out_refund",
          created_lot_id: "lot_refund",
          asset: { ...tender, asset_id: "asset.synthetic.point" },
          requested_amount: "200",
          role: "refund",
        },
      ],
      original_operation_id: "op_purchase",
      portal_id: null,
      line_items: [],
      notes: "Invalid asset-substitution refund.",
    });
    const result = tryValidateDocument(plan, "purchase-plan");
    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "lifecycle_return_asset_mismatch" }),
    );
  });

  it("rejects economic reconciliation failures and preserves reward-class conservation", () => {
    const scenario = structuredClone(
      example<GoldenScenario>("golden-scenario.example.yaml"),
    );
    const topup = scenario.expected.plan_results.find(
      (result) => result.plan_id === "plan_synthetic_topup_then_pay",
    )!;
    topup.economics.guaranteed_net_value_change_jpy.minimum_jpy += 1;
    topup.economics.guaranteed_net_value_change_jpy.maximum_jpy += 1;
    const first = tryValidateDocument(scenario, "golden-scenario");
    expect(first.valid).toBe(false);
    expect(first.issues.map((issue) => issue.code)).toContain(
      "economic_reconciliation_failed",
    );

    const conservation = structuredClone(
      example<GoldenScenario>("golden-scenario.example.yaml"),
    );
    const result = conservation.expected.plan_results.find(
      (item) => item.plan_id === "plan_synthetic_topup_then_pay",
    )!;
    result.asset_movements[1].quantity.asset.reward_class = "limited_period";
    const second = tryValidateDocument(conservation, "golden-scenario");
    expect(second.valid).toBe(false);
    expect(second.issues.map((issue) => issue.code)).toContain(
      "asset_conservation_failed",
    );
  });

  it("rejects duplicate golden asset definitions", () => {
    const scenario = structuredClone(
      example<GoldenScenario>("golden-scenario.example.yaml"),
    );
    scenario.asset_definitions.push(
      structuredClone(scenario.asset_definitions[0]),
    );
    const result = tryValidateDocument(scenario, "golden-scenario");
    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "duplicate_asset_definition_id" }),
    );
  });

  it("requires exact rule bindings when related rule definitions are supplied", () => {
    const missing = structuredClone(
      example<GoldenScenario>("golden-scenario.example.yaml"),
    ) as GoldenScenario;
    delete (missing as unknown as Record<string, unknown>)
      .rule_version_bindings;
    const missingResult = tryValidateDocument(missing, "golden-scenario");
    expect(missingResult.valid).toBe(false);
    expect(missingResult.issues).toContainEqual(
      expect.objectContaining({
        path: "/rule_version_bindings",
        code: "schema_required",
      }),
    );

    const mismatched = structuredClone(
      example<GoldenScenario>("golden-scenario.example.yaml"),
    ) as GoldenScenario;
    mismatched.rule_version_bindings[0].definition_hash = `sha256:${"a".repeat(64)}`;
    const related = example<RewardRule>("reward-rule.example.yaml");
    const mismatchResult = tryValidateDocument(mismatched, "golden-scenario", {
      relatedRules: [related],
    });
    expect(mismatchResult.valid).toBe(false);
    expect(mismatchResult.issues).toContainEqual(
      expect.objectContaining({
        code: "rule_binding_definition_hash_mismatch",
      }),
    );
  });

  it("rejects unauthorized ephemeral replay admission and non-empty preflight ledgers", () => {
    const ephemeral = structuredClone(
      example<GoldenScenario>("golden-scenario.example.yaml"),
    ) as GoldenScenario;
    ephemeral.replay_provenance.rule_admission = "ephemeral_published_clone";
    ephemeral.replay_provenance.publication_authorized = true;
    const ephemeralResult = tryValidateDocument(ephemeral, "golden-scenario");
    expect(ephemeralResult.valid).toBe(false);

    const preflight = structuredClone(
      example<GoldenScenario>("golden-scenario.example.yaml"),
    ) as GoldenScenario;
    const result = preflight.expected.plan_results[1];
    result.result_origin = "preflight";
    result.preflight_rejection = {
      rejection_code: "synthetic_preflight_rejection",
      reward_calculation_performed: false,
    };
    const preflightResult = tryValidateDocument(preflight, "golden-scenario");
    expect(preflightResult.valid).toBe(false);
    expect(
      preflightResult.issues.some((issue) =>
        issue.path.includes("plan_results/1"),
      ),
    ).toBe(true);
  });

  it("rejects ambiguous rule versions and result links without the matching role", () => {
    const ambiguous = structuredClone(
      example<GoldenScenario>("golden-scenario.example.yaml"),
    ) as GoldenScenario;
    ambiguous.rule_version_bindings = [
      ...ambiguous.rule_version_bindings,
      {
        ...ambiguous.rule_version_bindings[0],
        version: 2,
        roles: ["boundary_source"],
      },
    ];
    const ambiguousResult = tryValidateDocument(ambiguous, "golden-scenario");
    expect(ambiguousResult.issues).toContainEqual(
      expect.objectContaining({ code: "multiple_rule_versions_binding" }),
    );

    const roleless = structuredClone(
      example<GoldenScenario>("golden-scenario.example.yaml"),
    ) as GoldenScenario;
    roleless.rule_version_bindings[0].roles = ["boundary_source"];
    const rolelessResult = tryValidateDocument(roleless, "golden-scenario");
    expect(rolelessResult.issues).toContainEqual(
      expect.objectContaining({ code: "applied_rule_binding_role_missing" }),
    );
  });

  it("requires disclosed probabilities and all configured review modes", () => {
    const rule = structuredClone(
      example<RewardRule>("reward-rule.example.yaml"),
    );
    rule.output!.certainty = {
      type: "probabilistic",
      probability: null,
      probability_source: "official_disclosed",
    } as never;
    expect(tryValidateDocument(rule, "reward-rule").valid).toBe(false);

    const reviewed = structuredClone(
      example<RewardRule>("reward-rule.example.yaml"),
    );
    reviewed.audit.required_review_modes = [
      "solo_dual_pass",
      "human_second_review",
    ];
    reviewed.audit.review_events = reviewed.audit.review_events.filter(
      (event) => event.mode !== "human_second_review",
    );
    const result = tryValidateDocument(reviewed, "reward-rule");
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain(
      "required_review_mode_missing",
    );
  });

  it("accepts explicit transfer output while retaining legacy output-less rules", () => {
    const sourceAsset = {
      asset_id: "asset.synthetic.transfer.source",
      asset_kind: "reward_point" as const,
      program_id: "program.synthetic.source",
      reward_class: "normal" as const,
      scale: 0,
    };
    const destinationAsset = {
      asset_id: "asset.synthetic.transfer.destination",
      asset_kind: "reward_point" as const,
      program_id: "program.synthetic.destination",
      reward_class: "normal" as const,
      scale: 0,
    };
    const calculation = {
      model: "transfer_ratio" as const,
      source_asset: sourceAsset,
      destination_asset: destinationAsset,
      source_units: "1",
      destination_units: "2",
      minimum_source_units: null,
      increment_source_units: null,
      maximum_source_units_per_request: null,
      maximum_source_units_per_period: null,
      maximum_period: null,
      fee: null,
      rounding: {
        aggregation_scope: "transfer_request" as const,
        eligible_spend_quantum_jpy: null,
        reward_rounding_mode: "exact" as const,
      },
      processing_time_days_min: 1,
      processing_time_days_max: 3,
      cancellation_policy: "unknown" as const,
    };
    const legacy = structuredClone(
      example<RewardRule>("reward-rule.example.yaml"),
    );
    legacy.rule_type = "transfer";
    legacy.scope.operation_types = ["point_transfer"];
    legacy.scope.channels = ["transfer"];
    legacy.scope.tax_basis = "not_applicable";
    legacy.calculation = calculation;
    delete legacy.output;
    expect(tryValidateDocument(legacy, "reward-rule").valid).toBe(true);

    const explicit = structuredClone(legacy);
    explicit.rule_id = "rr_synthetic_transfer_explicit";
    explicit.output = {
      asset: destinationAsset,
      sign: "credit",
      certainty: {
        type: "guaranteed",
        probability: null,
        probability_source: null,
      },
      settlement: {
        status: "pending",
        expected_posting_from: null,
        expected_posting_to: null,
        posted_at: null,
      },
      expiry: {
        policy: "none",
        expires_at: null,
        duration_days: null,
        timezone: null,
      },
      restrictions: {
        transferable: true,
        redeemable_for_cash: false,
        usable_for_payment: true,
        investable: false,
        permitted_destination_ids: [],
        notes: "Synthetic transfer output.",
      },
      clawback: {
        on_refund: "none",
        posting_delay_days: null,
        notes: "Synthetic transfer output.",
      },
    };
    expect(tryValidateDocument(explicit, "reward-rule").valid).toBe(true);
  });

  it("rejects ambiguous bitemporal replay points while accepting half-open boundaries", () => {
    const base = example<RewardRule>("reward-rule.example.yaml");
    const left = structuredClone(base);
    const right = structuredClone(base);
    right.version = left.version + 1;
    right.validity.valid_from = "2026-08-01T00:00:00+09:00";
    right.validity.recorded_at = "2026-08-20T00:00:00+09:00";
    left.validity.valid_from = "2026-08-01T00:00:00+09:00";
    left.validity.valid_to = "2026-09-01T00:00:00+09:00";
    left.validity.recorded_at = "2026-08-01T00:00:00+09:00";
    left.validity.superseded_at = "2026-09-01T00:00:00+09:00";
    const ambiguous = validateBitemporalReplay(
      [left, right],
      "2026-08-21T00:00:00+09:00",
      "2026-08-21T00:00:00+09:00",
    );
    expect(ambiguous.valid).toBe(false);
    expect(ambiguous.issues).toContainEqual(
      expect.objectContaining({ code: "ambiguous_bitemporal_replay" }),
    );
    right.validity.valid_from = "2026-09-01T00:00:00+09:00";
    const adjacent = validateBitemporalReplay(
      [left, right],
      "2026-09-01T00:00:00+09:00",
      "2026-08-21T00:00:00+09:00",
    );
    expect(adjacent.valid).toBe(true);
  });

  it("throws a typed error for validateDocument and returns typed input on success", () => {
    const plan = example<PurchasePlan>("purchase-plan.example.yaml");
    expect(validateDocument<PurchasePlan>(plan, "purchase-plan").plan_id).toBe(
      plan.plan_id,
    );
    expect(() => validateDocument({}, "purchase-plan")).toThrow(
      ContractValidationError,
    );
  });
});
