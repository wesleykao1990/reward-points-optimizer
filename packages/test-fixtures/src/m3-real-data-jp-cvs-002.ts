import {
  canonicalHash,
  canonicalize,
  type EngineContext,
  evaluateCandidates,
  evaluateNativePlan,
  type NativePlanResult,
  type Operation,
  type PurchasePlan,
  type Recommendation,
  type RewardRule,
  type UserState,
} from "@jro/rule-engine";

/**
 * Executable M3 candidate slice for JP-CVS-002.
 *
 * The source evidence is deliberately used only to identify one accepted
 * payment family.  It does not imply any reward rate.  Both rules below are
 * non-financial payment-acceptance rules and neither has a calculation or an
 * output.  The second rule is a negative synthetic tender used to prove that
 * an unsupported tender is denied without a zero-point reward placeholder.
 */

export const JP_CVS_002_SCENARIO_ID = "JP-CVS-002" as const;
export const JP_CVS_002_SOURCE_ID = "merchant.seveneleven.payment-methods";
export const JP_CVS_002_EVIDENCE_ID =
  "ev_m3_seveneleven_payment_methods_20260820";
export const JP_CVS_002_SNAPSHOT_ID =
  "snap_m3_seveneleven_payment_methods_20260820";

export const JP_CVS_002_TRANSACTION_TIME = "2026-08-20T05:40:00+09:00";
export const JP_CVS_002_REPLAY_KNOWLEDGE_AT = "2026-08-20T05:51:00+09:00";
export const JP_CVS_002_INDEPENDENT_COMPLETED_AT = "2026-08-20T05:50:00+09:00";
export const JP_CVS_002_ENGINE_REPLAY_AT = "2026-08-20T05:52:00+09:00";
export const JP_CVS_002_AMOUNT_JPY = 640;

export const JP_CVS_002_ACCEPTED_PLAN_ID =
  "plan_jp_cvs_002_accepted_credit_card";
export const JP_CVS_002_UNSUPPORTED_PLAN_ID =
  "plan_jp_cvs_002_unsupported_tender";
export const JP_CVS_002_ACCEPTED_INSTRUMENT_ID =
  "instrument.seveneleven.credit_card";
export const JP_CVS_002_UNSUPPORTED_INSTRUMENT_ID =
  "instrument.seveneleven.synthetic_unsupported";

export const JP_CVS_002_DENY_RULE_ID =
  "rr_jp_cvs_002_a_deny_unsupported_tender";
export const JP_CVS_002_ACCEPT_RULE_ID = "rr_jp_cvs_002_b_accept_credit_card";

/**
 * The golden fixture intentionally has no opening lots or valuation entries.
 * These values are nevertheless explicit so the replay input records the
 * engine defaults instead of relying on omitted fields.
 */
export const JP_CVS_002_GOLDEN_USER_STATE: UserState = {
  owned_instrument_ids: [
    JP_CVS_002_ACCEPTED_INSTRUMENT_ID,
    JP_CVS_002_UNSUPPORTED_INSTRUMENT_ID,
  ],
  owned_loyalty_program_ids: [],
  facts: {},
  asset_lots: [],
  valuation_profile: {
    version: "valuation.jp-cvs-002.empty.v1",
    entries: [],
  },
  cap_progress: {},
};

export const JP_CVS_002_GOLDEN_OBJECTIVE = {
  primary: "maximize_guaranteed_net_value" as const,
  probabilistic_reward_policy: "guaranteed_only" as const,
  ending_asset_valuation: "use_user_profile" as const,
  tie_breakers: ["lower_external_funding", "fewer_operations"],
};

const EXTERNAL_FUNDING_ASSET = {
  asset_id: "asset.jp-cvs-002.external-funding",
  asset_kind: "credit_limit" as const,
  program_id: null,
  reward_class: null,
  scale: 0,
};

const EMPTY_OPERATION_MATCH = {
  required_loyalty_program_ids: [],
  excluded_payment_instrument_ids: [],
  allowed_funding_source_ids: [],
  excluded_funding_source_ids: [],
  allowed_source_asset_ids: [],
  excluded_source_asset_ids: [],
  allowed_destination_asset_ids: [],
  required_interfaces: [],
  excluded_interfaces: [],
  must_present_before_payment: false,
};

function acceptanceRule(
  ruleId: string,
  decision: "allow" | "deny",
  instrumentId: string,
  reasonCode: string,
): RewardRule {
  return {
    rule_id: ruleId,
    version: 1,
    status: "under_review",
    rule_type: "payment_acceptance",
    name:
      decision === "allow"
        ? "Seven-Eleven credit-card acceptance"
        : "Seven-Eleven unsupported tender denial",
    description:
      decision === "allow"
        ? "Acceptance-only candidate rule for the evidenced credit-card family."
        : "Negative candidate rule for a deliberately unsupported synthetic tender.",
    subject: {
      entity_type: "merchant",
      entity_id: "merchant.seveneleven",
    },
    scope: {
      countries: ["JP"],
      operation_types: ["merchant_purchase"],
      merchant_ids: ["merchant.seveneleven"],
      channels: ["in_store"],
      included_product_classes: ["ordinary"],
      excluded_product_classes: [],
      tax_basis: "tax_inclusive",
    },
    eligibility: {
      operation_match: {
        ...EMPTY_OPERATION_MATCH,
        allowed_payment_instrument_ids: [instrumentId],
      },
      user_conditions: [],
      transaction_conditions: {
        eligible_amount_basis: "not_applicable",
        requires_single_operation: true,
      },
      campaign_conditions: {
        entry_required: false,
        targeted_offer: false,
        identity_verification_required: false,
        first_use_only: false,
      },
    },
    effect: {
      decision,
      effect_target: "operation_eligibility",
      target_rule_ids: [],
      target_stack_groups: [],
      reason_code: reasonCode,
    },
    caps: [],
    stacking: {
      stack_group: "jp_cvs_002_payment_acceptance",
      mode: "non_reward_acceptance",
      precedence: decision === "deny" ? 20 : 10,
      conflicts_with_rule_ids: [],
      requires_rule_ids: [],
      notes: "Payment acceptance is intentionally non-financial.",
    },
    validity: {
      valid_from: "2026-08-20T05:39:00+09:00",
      valid_to: null,
      timezone: "Asia/Tokyo",
      recorded_at: "2026-08-20T05:45:00+09:00",
      superseded_at: null,
    },
    provenance: {
      evidence_ids: [JP_CVS_002_EVIDENCE_ID],
      minimum_source_tier: "T1_CANONICAL",
      confidence: 0.95,
      human_verified: false,
      review_notes:
        "Payment family was reviewed from the first-party Seven-Eleven payment-methods source; this rule carries no reward calculation.",
    },
    audit: {
      created_at: "2026-08-20T05:42:00+09:00",
      created_by: "m3-jp-cvs-002-builder",
      review_events: [],
      required_review_modes: ["solo_dual_pass", "agent_challenged"],
      review_mode: null,
      reviewed_at: null,
      reviewed_by: null,
      change_reason:
        "Initial M3 under-review acceptance candidate; not a canonical publication.",
    },
  };
}

export const JP_CVS_002_RULES: readonly RewardRule[] = Object.freeze([
  acceptanceRule(
    JP_CVS_002_DENY_RULE_ID,
    "deny",
    JP_CVS_002_UNSUPPORTED_INSTRUMENT_ID,
    "unsupported_tender_not_accepted",
  ),
  acceptanceRule(
    JP_CVS_002_ACCEPT_RULE_ID,
    "allow",
    JP_CVS_002_ACCEPTED_INSTRUMENT_ID,
    "accepted_payment_family_credit_card",
  ),
]);

function makeOperation(operationId: string, instrumentId: string): Operation {
  return {
    operation_id: operationId,
    sequence: 1,
    occurred_at: JP_CVS_002_TRANSACTION_TIME,
    operation_type: "merchant_purchase",
    merchant_id: "merchant.seveneleven",
    merchant_location_id: "location.seveneleven.representative",
    channel: "in_store",
    interface: "physical_card",
    payment_instrument_id: instrumentId,
    funding_source_id: `funding.${instrumentId.replaceAll(".", "_")}`,
    amount_jpy: JP_CVS_002_AMOUNT_JPY,
    asset_inputs: [
      {
        input_id: `in_${operationId}_funding`,
        source_lot_id: null,
        quantity: {
          asset: EXTERNAL_FUNDING_ASSET,
          amount: JP_CVS_002_AMOUNT_JPY.toString(),
        },
        role: "external_funding",
      },
    ],
    output_requests: [],
    original_operation_id: null,
    portal_id: null,
    line_items: [
      {
        line_item_id: `line_${operationId}_ordinary`,
        product_class: "ordinary",
        amount_jpy: JP_CVS_002_AMOUNT_JPY,
        quantity: 1,
        eligible_for_rewards: true,
      },
    ],
    notes:
      "Frozen ordinary in-store purchase for JP-CVS-002; no reward rule is included.",
  };
}

function makePlan(
  planId: string,
  operationId: string,
  instrumentId: string,
): PurchasePlan {
  return {
    plan_id: planId,
    operations: [makeOperation(operationId, instrumentId)],
    dependencies: [],
    loyalty_presentments: [],
    assumptions: [
      "The purchase amount is frozen at JPY 640.",
      "Payment acceptance is evaluated independently from reward earning.",
    ],
  };
}

export const JP_CVS_002_ACCEPTED_PLAN = makePlan(
  JP_CVS_002_ACCEPTED_PLAN_ID,
  "op_jp_cvs_002_accepted_credit_card",
  JP_CVS_002_ACCEPTED_INSTRUMENT_ID,
);

export const JP_CVS_002_UNSUPPORTED_PLAN = makePlan(
  JP_CVS_002_UNSUPPORTED_PLAN_ID,
  "op_jp_cvs_002_unsupported_tender",
  JP_CVS_002_UNSUPPORTED_INSTRUMENT_ID,
);

/** Exactly the two candidate plans required by the JP-CVS-002 seed. */
export const JP_CVS_002_PLANS: readonly PurchasePlan[] = Object.freeze([
  JP_CVS_002_ACCEPTED_PLAN,
  JP_CVS_002_UNSUPPORTED_PLAN,
]);

const JP_CVS_002_REPLAY_RULES: RewardRule[] = JP_CVS_002_RULES.map((rule) => ({
  ...structuredClone(rule),
  status: "published",
  provenance: {
    ...rule.provenance,
    human_verified: true,
    review_notes:
      "Ephemeral fixture-replay admission only; the source candidate remains under_review and is not publishable.",
  },
  audit: {
    ...rule.audit,
    review_events: [
      {
        mode: "solo_dual_pass",
        reviewer_id: "m3-jp-cvs-002-fixture-replay-admission",
        completed_at: "2026-08-20T05:46:00+09:00",
        decision: "approved",
        notes:
          "Technical admission for this isolated replay only; not a rule-publication decision.",
      },
    ],
    required_review_modes: ["solo_dual_pass"],
    review_mode: "solo_dual_pass",
    reviewed_at: "2026-08-20T05:46:00+09:00",
    reviewed_by: "m3-jp-cvs-002-fixture-replay-admission",
  },
}));

export const JP_CVS_002_CONTEXT: EngineContext = {
  rules: JP_CVS_002_REPLAY_RULES,
  assets: [],
  transaction_time: JP_CVS_002_TRANSACTION_TIME,
  replay_knowledge_at: JP_CVS_002_REPLAY_KNOWLEDGE_AT,
  user_state: JP_CVS_002_GOLDEN_USER_STATE,
  objective: JP_CVS_002_GOLDEN_OBJECTIVE,
};

export interface JpCvs002Replay {
  accepted: NativePlanResult;
  unsupported: NativePlanResult;
  recommendation: Recommendation;
}

/** Run both native ledgers and the ranked recommendation in one replay. */
export function replayJpCvs002(): JpCvs002Replay {
  const accepted = evaluateNativePlan(
    JP_CVS_002_ACCEPTED_PLAN,
    JP_CVS_002_CONTEXT,
  );
  const unsupported = evaluateNativePlan(
    JP_CVS_002_UNSUPPORTED_PLAN,
    JP_CVS_002_CONTEXT,
  );
  const recommendation = evaluateCandidates(
    JP_CVS_002_PLANS,
    JP_CVS_002_CONTEXT,
  );
  return { accepted, unsupported, recommendation };
}

/** Stable projection used by the fixture test and the manual artifact. */
export function projectJpCvs002Replay(replay: JpCvs002Replay) {
  const unsupportedFirstRejection = replay.unsupported.rejection_reasons.find(
    (reason) => reason.rule_id === JP_CVS_002_DENY_RULE_ID,
  );
  return {
    plan_count: JP_CVS_002_PLANS.length,
    accepted: {
      plan_id: replay.accepted.plan_id,
      eligible: replay.accepted.eligible,
      applied_rule_ids: replay.accepted.applied_rule_ids,
      reward_components: replay.accepted.reward_components,
      zero_point_placeholder: replay.accepted.reward_components.some(
        (component) => component.quantity.amount === "0",
      ),
      financially_ranked_plan_ids: replay.recommendation.plans.map(
        (plan) => plan.plan_id,
      ),
    },
    unsupported: {
      plan_id: replay.unsupported.plan_id,
      eligible: replay.unsupported.eligible,
      first_acceptance_rejection_rule_id:
        unsupportedFirstRejection?.rule_id ?? null,
      first_acceptance_rejection_code: unsupportedFirstRejection?.code ?? null,
      reward_components: replay.unsupported.reward_components,
      zero_point_placeholder: replay.unsupported.reward_components.some(
        (component) => component.quantity.amount === "0",
      ),
      financially_ranked: replay.recommendation.plans.some(
        (plan) => plan.plan_id === JP_CVS_002_UNSUPPORTED_PLAN_ID,
      ),
    },
  };
}

/**
 * A compact deterministic input fingerprint helps callers bind the manual
 * artifact to the exact two plans/rules without storing engine output in it.
 */
export const JP_CVS_002_INPUT_FINGERPRINT = canonicalize({
  plans: JP_CVS_002_PLANS,
  rules: JP_CVS_002_RULES,
  transaction_time: JP_CVS_002_TRANSACTION_TIME,
  replay_knowledge_at: JP_CVS_002_REPLAY_KNOWLEDGE_AT,
});

export const JP_CVS_002_SCENARIO_RECORD = {
  scenario_id: JP_CVS_002_SCENARIO_ID,
  status: "reviewed" as const,
  primary_source_ids: [JP_CVS_002_SOURCE_ID],
  evidence_ids: [JP_CVS_002_EVIDENCE_ID],
  evidence: [
    {
      evidence_id: JP_CVS_002_EVIDENCE_ID,
      first_party: true,
      status: "verified" as const,
      review_decision: "approved" as const,
      source_id: JP_CVS_002_SOURCE_ID,
    },
  ],
  candidate_plans: JP_CVS_002_PLANS.map((plan) => ({ plan_id: plan.plan_id })),
  plan_results: JP_CVS_002_PLANS.map((plan) => ({
    plan_id: plan.plan_id,
    result_artifact_id: `result_${plan.plan_id}`,
    replay_id: "replay_jp_cvs_002_candidate",
    produced_by: "engine" as const,
  })),
  independent_calculation: {
    artifact_id: "calc_jp_cvs_002_independent_manual",
    status: "completed" as const,
    completed_at: JP_CVS_002_INDEPENDENT_COMPLETED_AT,
    method: "manual" as const,
    plan_ids: JP_CVS_002_PLANS.map((plan) => plan.plan_id),
  },
  engine_replay: {
    replay_id: "replay_jp_cvs_002_candidate",
    status: "passed" as const,
    completed_at: JP_CVS_002_ENGINE_REPLAY_AT,
    result_plan_ids: JP_CVS_002_PLANS.map((plan) => plan.plan_id),
  },
  required_negative_assertions: [
    "unsupported_tender_denied_before_reward_calculation",
  ],
  negative_assertions: [
    {
      assertion_id: "unsupported_tender_denied_before_reward_calculation",
      status: "passed" as const,
      checked_at: JP_CVS_002_ENGINE_REPLAY_AT,
      artifact_id: "assertion_jp_cvs_002_no_zero_point_placeholder",
    },
  ],
  conservation: {
    artifact_id: "conservation_jp_cvs_002_candidate",
    status: "passed" as const,
    checked_at: JP_CVS_002_ENGINE_REPLAY_AT,
  },
  replay: {
    artifact_id: "replay_jp_cvs_002_candidate_ci",
    status: "passed" as const,
    checked_at: JP_CVS_002_ENGINE_REPLAY_AT,
  },
  builder_id: "m3-jp-cvs-002-builder",
  primary_reviewer_id: "m3-jp-cvs-002-primary-solo-reviewer",
  review: {
    required_review_modes: ["solo_dual_pass", "agent_challenged"],
    review_mode: "agent_challenged" as const,
    calculated_by: "m3-jp-cvs-002-builder",
    decision: "approved" as const,
    review_events: [
      {
        mode: "solo_dual_pass" as const,
        reviewer_id: "m3-jp-cvs-002-primary-solo-reviewer",
        completed_at: "2026-08-20T06:24:00+09:00",
        decision: "approved" as const,
        notes:
          "Cooling-off reread reproduced the approved source mapping, the manual expectation, the accepted credit-card result, and the unsupported-tender rejection without reward output.",
      },
      {
        mode: "agent_challenged" as const,
        reviewer_id: "m3-scenario-challenge-verifier",
        completed_at: "2026-08-20T06:38:55+09:00",
        decision: "approved" as const,
        notes:
          "Independent challenge recomputed both plan outcomes, verified the evidence hash and authoritative manual source readiness, and found no promotion-gate discrepancy.",
      },
    ],
  },
} satisfies import("./m3-gate.js").M3ScenarioRecord;

type JpCvs002JpyRange = {
  minimum_jpy: number;
  maximum_jpy: number;
  expected_jpy: number | null;
};

export interface JpCvs002GoldenPlanResult {
  plan_id: string;
  eligible: boolean;
  asset_movements: NativePlanResult["asset_movements"];
  reward_components: NativePlanResult["reward_components"];
  ending_asset_lots: NativePlanResult["ending_asset_lots"];
  economics: {
    merchant_value_received_jpy: JpCvs002JpyRange;
    external_funding_jpy: JpCvs002JpyRange;
    opening_asset_value_consumed_jpy: JpCvs002JpyRange;
    ending_asset_value_jpy: JpCvs002JpyRange;
    guaranteed_reward_value_jpy: JpCvs002JpyRange;
    probabilistic_expected_reward_value_jpy: JpCvs002JpyRange;
    fee_value_jpy: JpCvs002JpyRange;
    guaranteed_net_value_change_jpy: JpCvs002JpyRange;
    expected_net_value_change_jpy: JpCvs002JpyRange;
  };
  objective_score_jpy: JpCvs002JpyRange;
  nominal_return_basis_points: null;
  applied_rule_ids: string[];
  rejected_rule_ids: string[];
  rejection_reasons: string[];
  result_origin: "engine";
  result_artifact_hash: string;
  preflight_rejection: null;
}

export interface JpCvs002GoldenScenario {
  scenario_id: typeof JP_CVS_002_SCENARIO_ID;
  version: 1;
  status: "golden";
  level: "L1_SINGLE_RULE";
  title: string;
  description: string;
  as_of: string;
  replay_knowledge_at: string;
  timezone: "Asia/Tokyo";
  user_state: UserState;
  asset_definitions: readonly [];
  objective: typeof JP_CVS_002_GOLDEN_OBJECTIVE;
  candidate_plans: readonly PurchasePlan[];
  expected: {
    outcome_mode: "definite";
    definite_winner_plan_id: string;
    safe_plan_id: string;
    runner_up_plan_id: string | null;
    conditional_winners: readonly unknown[];
    plan_results: readonly JpCvs002GoldenPlanResult[];
    assertions: readonly {
      assertion_type: string;
      target_id: string;
      expected: unknown;
      reason: string;
    }[];
    explanation_tokens: readonly string[];
    questions_to_resolve: readonly unknown[];
    valuation_sensitivities: readonly unknown[];
  };
  evidence_ids: readonly string[];
  rule_version_bindings: readonly {
    rule_id: string;
    version: number;
    roles: readonly string[];
    source_candidate_status: RewardRule["status"];
    definition_hash: string;
    validity: RewardRule["validity"];
    evidence_ids: readonly string[];
  }[];
  replay_provenance: {
    replay_id: string;
    rule_admission: "ephemeral_published_clone";
    publication_authorized: false;
    engine_version: string;
    contracts_version: string;
    valuation_profile_version: string;
    input_hash: string;
    output_hash: string;
    completed_at: string;
    replay_knowledge_at: string;
  };
  review: {
    review_mode: "agent_challenged";
    calculated_by: string;
    verified_by: string;
    verified_at: string;
    cooling_off_completed_at: string;
    independent_calculation_artifact: string;
    decision: "approved";
    notes: string;
    required_review_modes: readonly string[];
    review_events: readonly {
      mode: string;
      reviewer_id: string;
      completed_at: string;
      decision: string;
      notes: string;
    }[];
  };
}

function integerJpy(value: unknown, label: string): number {
  if (typeof value === "bigint") {
    const minimum = BigInt(Number.MIN_SAFE_INTEGER);
    const maximum = BigInt(Number.MAX_SAFE_INTEGER);
    if (value < minimum || value > maximum)
      throw new Error(`non_safe_integer_jpy:${label}`);
    return Number(value);
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value))
      throw new Error(`non_safe_integer_jpy:${label}`);
    return value;
  }
  if (typeof value !== "string" || !/^-?[0-9]+(?:\.0+)?$/.test(value))
    throw new Error(`non_integer_jpy:${label}`);
  const integer = BigInt(value.split(".")[0] ?? value);
  const minimum = BigInt(Number.MIN_SAFE_INTEGER);
  const maximum = BigInt(Number.MAX_SAFE_INTEGER);
  if (integer < minimum || integer > maximum)
    throw new Error(`non_safe_integer_jpy:${label}`);
  return Number(integer);
}

function integerRange(value: unknown, label: string): JpCvs002JpyRange {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`missing_jpy_range:${label}`);
  const range = value as Record<string, unknown>;
  const minimum = integerJpy(range.minimum_jpy, `${label}.minimum_jpy`);
  const maximum = integerJpy(range.maximum_jpy, `${label}.maximum_jpy`);
  const expected =
    range.expected_jpy === null
      ? null
      : integerJpy(range.expected_jpy, `${label}.expected_jpy`);
  if (minimum > maximum) throw new Error(`reversed_jpy_range:${label}`);
  if (expected !== null && (expected < minimum || expected > maximum))
    throw new Error(`expected_outside_jpy_range:${label}`);
  return { minimum_jpy: minimum, maximum_jpy: maximum, expected_jpy: expected };
}

function exactJpyRange(value: number): JpCvs002JpyRange {
  if (!Number.isSafeInteger(value)) throw new Error("non_safe_integer_jpy");
  return { minimum_jpy: value, maximum_jpy: value, expected_jpy: value };
}

const ZERO_JPY_RANGE = exactJpyRange(0);

function cloneZeroRange(): JpCvs002JpyRange {
  return { ...ZERO_JPY_RANGE };
}

function resultEconomics(
  native: NativePlanResult,
  conservativeZero: boolean,
): JpCvs002GoldenPlanResult["economics"] {
  // The denied route is retained as an engine result, but no real transaction
  // is claimed for it.  All economic fields are therefore conservatively zero.
  if (conservativeZero)
    return {
      merchant_value_received_jpy: cloneZeroRange(),
      external_funding_jpy: cloneZeroRange(),
      opening_asset_value_consumed_jpy: cloneZeroRange(),
      ending_asset_value_jpy: cloneZeroRange(),
      guaranteed_reward_value_jpy: cloneZeroRange(),
      probabilistic_expected_reward_value_jpy: cloneZeroRange(),
      fee_value_jpy: cloneZeroRange(),
      guaranteed_net_value_change_jpy: cloneZeroRange(),
      expected_net_value_change_jpy: cloneZeroRange(),
    };

  const merchant = integerJpy(native.merchant_value_jpy, "merchant_value_jpy");
  const external = integerJpy(
    native.external_funding_jpy,
    "external_funding_jpy",
  );
  if (native.opening_asset_units_consumed.length > 0)
    throw new Error("unexpected_opening_asset_consumption");
  const net = merchant - external;
  return {
    merchant_value_received_jpy: exactJpyRange(merchant),
    external_funding_jpy: exactJpyRange(external),
    opening_asset_value_consumed_jpy: cloneZeroRange(),
    ending_asset_value_jpy: cloneZeroRange(),
    guaranteed_reward_value_jpy: cloneZeroRange(),
    probabilistic_expected_reward_value_jpy: cloneZeroRange(),
    fee_value_jpy: cloneZeroRange(),
    guaranteed_net_value_change_jpy: exactJpyRange(net),
    expected_net_value_change_jpy: exactJpyRange(net),
  };
}

function projectGoldenRewardComponents(
  native: NativePlanResult,
): NativePlanResult["reward_components"] {
  return native.reward_components.map((component) => ({
    ...structuredClone(component),
    value_jpy: integerRange(component.value_jpy, "reward_component.value_jpy"),
  }));
}

/**
 * Project a native result into the golden result contract.  Native JPY values
 * are decimal strings/bigints; this boundary admits only exact safe integers.
 */
export function projectJpCvs002GoldenPlanResult(
  native: NativePlanResult,
): Omit<JpCvs002GoldenPlanResult, "result_artifact_hash"> {
  const conservativeZero = native.plan_id === JP_CVS_002_UNSUPPORTED_PLAN_ID;
  const economics = resultEconomics(native, conservativeZero);
  const result: Omit<JpCvs002GoldenPlanResult, "result_artifact_hash"> = {
    plan_id: native.plan_id,
    eligible: native.eligible,
    asset_movements: structuredClone(native.asset_movements),
    reward_components: projectGoldenRewardComponents(native),
    ending_asset_lots: structuredClone(native.ending_asset_lots),
    economics,
    objective_score_jpy: structuredClone(
      conservativeZero
        ? cloneZeroRange()
        : economics.guaranteed_net_value_change_jpy,
    ),
    nominal_return_basis_points: null,
    applied_rule_ids: [...native.applied_rule_ids],
    rejected_rule_ids: [...native.rejected_rule_ids],
    rejection_reasons: native.rejection_reasons.map(
      (reason) => `${reason.code}:${reason.message}`,
    ),
    result_origin: "engine",
    preflight_rejection: null,
  };
  return result;
}

/** The artifact hash excludes only `result_artifact_hash` itself. */
export function projectJpCvs002PlanResultForHash(
  result: JpCvs002GoldenPlanResult,
): Omit<JpCvs002GoldenPlanResult, "result_artifact_hash"> {
  const { result_artifact_hash: _excluded, ...withoutHash } = result;
  return withoutHash;
}

export function hashJpCvs002PlanResult(
  result: JpCvs002GoldenPlanResult,
): string {
  return canonicalHash(projectJpCvs002PlanResultForHash(result));
}

function withResultArtifactHash(
  result: Omit<JpCvs002GoldenPlanResult, "result_artifact_hash">,
): JpCvs002GoldenPlanResult {
  const withPlaceholder = {
    ...result,
    result_artifact_hash: `sha256:${"0".repeat(64)}`,
  } as JpCvs002GoldenPlanResult;
  return {
    ...result,
    result_artifact_hash: hashJpCvs002PlanResult(withPlaceholder),
  };
}

function ruleDefinitionHash(rule: RewardRule): string {
  const definition = structuredClone(rule) as unknown as Record<
    string,
    unknown
  >;
  for (const key of [
    "version",
    "status",
    "validity",
    "provenance",
    "audit",
    "definition_hash",
  ])
    delete definition[key];
  return canonicalHash(definition);
}

function ruleVersionBindings(results: readonly JpCvs002GoldenPlanResult[]) {
  const roleOrder: ("applied" | "rejected")[] = ["applied", "rejected"];
  const rolesByRule = new Map<string, Set<"applied" | "rejected">>();
  for (const result of results) {
    for (const ruleId of result.applied_rule_ids) {
      const roles = rolesByRule.get(ruleId) ?? new Set();
      roles.add("applied");
      rolesByRule.set(ruleId, roles);
    }
    for (const ruleId of result.rejected_rule_ids) {
      const roles = rolesByRule.get(ruleId) ?? new Set();
      roles.add("rejected");
      rolesByRule.set(ruleId, roles);
    }
  }
  return JP_CVS_002_RULES.map((rule) => {
    const roles = rolesByRule.get(rule.rule_id);
    if (!roles || roles.size === 0)
      throw new Error(`unbound_result_rule:${rule.rule_id}`);
    return {
      rule_id: rule.rule_id,
      version: rule.version,
      roles: roleOrder.filter((role) => roles.has(role)) as (
        | "applied"
        | "rejected"
      )[],
      source_candidate_status: rule.status,
      definition_hash: ruleDefinitionHash(rule),
      validity: structuredClone(rule.validity),
      evidence_ids: [...rule.provenance.evidence_ids],
    };
  });
}

export function projectJpCvs002GoldenReplayOutput(
  expected: JpCvs002GoldenScenario["expected"],
) {
  return {
    outcome_mode: expected.outcome_mode,
    definite_winner_plan_id: expected.definite_winner_plan_id,
    safe_plan_id: expected.safe_plan_id,
    runner_up_plan_id: expected.runner_up_plan_id,
    plan_results: expected.plan_results,
  };
}

/**
 * Build the immutable JP-CVS-002 replay oracle.  Published clones exist only
 * inside `JP_CVS_002_CONTEXT`; the bound source candidates remain under_review
 * and this fixture never authorizes their publication.
 */
export function buildJpCvs002GoldenScenario(): JpCvs002GoldenScenario {
  const replay = replayJpCvs002();
  if (!replay.accepted.eligible)
    throw new Error("jp_cvs_002_accepted_plan_not_eligible");
  if (replay.unsupported.eligible)
    throw new Error("jp_cvs_002_unsupported_plan_eligible");
  if (replay.accepted.reward_components.length > 0)
    throw new Error("jp_cvs_002_acceptance_created_reward");
  if (replay.unsupported.reward_components.length > 0)
    throw new Error("jp_cvs_002_unsupported_created_reward");
  if (
    replay.recommendation.plans.map((plan) => plan.plan_id).join("\u0000") !==
    JP_CVS_002_ACCEPTED_PLAN_ID
  )
    throw new Error("jp_cvs_002_ranked_route_changed");

  const planResults = [
    withResultArtifactHash(projectJpCvs002GoldenPlanResult(replay.accepted)),
    withResultArtifactHash(projectJpCvs002GoldenPlanResult(replay.unsupported)),
  ];
  const expected: JpCvs002GoldenScenario["expected"] = {
    outcome_mode: "definite",
    definite_winner_plan_id: JP_CVS_002_ACCEPTED_PLAN_ID,
    safe_plan_id: JP_CVS_002_ACCEPTED_PLAN_ID,
    runner_up_plan_id: null,
    conditional_winners: [],
    plan_results: planResults,
    assertions: [
      {
        assertion_type: "plan_is_eligible",
        target_id: JP_CVS_002_ACCEPTED_PLAN_ID,
        expected: true,
        reason:
          "The reviewed credit-card family is accepted by the engine-origin payment rule.",
      },
      {
        assertion_type: "plan_is_ineligible",
        target_id: JP_CVS_002_UNSUPPORTED_PLAN_ID,
        expected: true,
        reason:
          "The synthetic unsupported tender is denied before any reward calculation.",
      },
      {
        assertion_type: "reward_equals",
        target_id: JP_CVS_002_ACCEPTED_PLAN_ID,
        expected: [],
        reason:
          "Payment acceptance is non-financial and no reward-earning rule is present.",
      },
      {
        assertion_type: "reward_equals",
        target_id: JP_CVS_002_UNSUPPORTED_PLAN_ID,
        expected: [],
        reason:
          "An engine-denied tender must not create a zero-point reward placeholder.",
      },
      {
        assertion_type: "winner_is",
        target_id: JP_CVS_002_ACCEPTED_PLAN_ID,
        expected: true,
        reason:
          "Only the eligible accepted route enters the financial recommendation ranking.",
      },
      {
        assertion_type: "net_value_equals",
        target_id: JP_CVS_002_ACCEPTED_PLAN_ID,
        expected: 0,
        reason:
          "JPY 640 merchant value offsets JPY 640 external funding with no reward or fee.",
      },
    ],
    explanation_tokens: [
      "JP_CVS_002_ACCEPTED_CREDIT_CARD",
      "JP_CVS_002_PAYMENT_ACCEPTANCE_ONLY",
      "JP_CVS_002_UNSUPPORTED_TENDER_DENIED",
    ],
    questions_to_resolve: [],
    valuation_sensitivities: [],
  };

  const reviewEvents = JP_CVS_002_SCENARIO_RECORD.review.review_events;
  const challenge = reviewEvents.find(
    (event) => event.mode === "agent_challenged",
  );
  const coolingOff = reviewEvents.find(
    (event) => event.mode === "solo_dual_pass",
  );
  if (!challenge || !coolingOff)
    throw new Error("jp_cvs_002_review_events_incomplete");

  const scenario: JpCvs002GoldenScenario = {
    scenario_id: JP_CVS_002_SCENARIO_ID,
    version: 1,
    status: "golden",
    level: "L1_SINGLE_RULE",
    title: "Seven-Eleven Japan credit-card acceptance without reward earning",
    description:
      "Frozen reviewed replay oracle for the payment-family evidence. Rule bindings remain under_review; ephemeral published clones are admitted only for this replay and are not production-authorized.",
    as_of: JP_CVS_002_TRANSACTION_TIME,
    replay_knowledge_at: JP_CVS_002_REPLAY_KNOWLEDGE_AT,
    timezone: "Asia/Tokyo",
    user_state: structuredClone(JP_CVS_002_GOLDEN_USER_STATE),
    asset_definitions: [],
    objective: {
      ...JP_CVS_002_GOLDEN_OBJECTIVE,
      tie_breakers: [...JP_CVS_002_GOLDEN_OBJECTIVE.tie_breakers],
    },
    candidate_plans: structuredClone(JP_CVS_002_PLANS),
    expected,
    evidence_ids: [JP_CVS_002_EVIDENCE_ID],
    rule_version_bindings: ruleVersionBindings(planResults),
    replay_provenance: {
      replay_id: "replay_jp_cvs_002_golden_v1",
      rule_admission: "ephemeral_published_clone",
      publication_authorized: false,
      engine_version: replay.recommendation.replay.engine_version,
      contracts_version: replay.recommendation.replay.contract_version,
      valuation_profile_version:
        JP_CVS_002_GOLDEN_USER_STATE.valuation_profile.version,
      input_hash: replay.recommendation.replay.input_hash,
      output_hash: canonicalHash(projectJpCvs002GoldenReplayOutput(expected)),
      completed_at: JP_CVS_002_ENGINE_REPLAY_AT,
      replay_knowledge_at: JP_CVS_002_REPLAY_KNOWLEDGE_AT,
    },
    review: {
      review_mode: "agent_challenged",
      calculated_by: JP_CVS_002_SCENARIO_RECORD.review.calculated_by,
      verified_by: challenge.reviewer_id,
      verified_at: challenge.completed_at,
      cooling_off_completed_at: coolingOff.completed_at,
      independent_calculation_artifact:
        JP_CVS_002_SCENARIO_RECORD.independent_calculation.artifact_id,
      decision: "approved",
      notes:
        "Prior accountable review is carried into this immutable replay oracle. Approval freezes reviewed facts and replay output only; it does not publish or authorize either under-review rule.",
      required_review_modes: [
        ...JP_CVS_002_SCENARIO_RECORD.review.required_review_modes,
      ],
      review_events: structuredClone(reviewEvents),
    },
  };
  return scenario;
}
