import {
  type AssetDefinition,
  type AssetRef,
  canonicalHash,
  type EngineContext,
  type Expiry,
  evaluateCandidates,
  type Operation,
  type PurchasePlan,
  type Recommendation,
  type RewardRule,
  type RuleOutput,
  type Settlement,
  type UsageRestrictions,
  type ValuedPlanResult,
} from "@jro/rule-engine";

/**
 * JP-CVS-006 is deliberately kept as a candidate fixture.  It is not a
 * canonical database seed and does not claim that the scenario has completed
 * its integrated M3 review.
 */

export const JP_CVS_006_SCENARIO_ID = "JP-CVS-006" as const;

export const JP_CVS_006_PRIMARY_SOURCE_IDS = [
  "merchant.seveneleven.nanaco",
  "jp.nanaco.redemption-value",
  "jp.nanaco.sevencard-earning",
  "jp.nanaco.shopping-earning",
  "jp.sevencard.nanaco-charge",
] as const;

export const JP_CVS_006_EVIDENCE_IDS = [
  "ev_m3_seveneleven_nanaco_20260820",
  "ev_m3_nanaco_redemption_value_20260820",
  "ev_m3_nanaco_sevencard_earning_20260820",
  "ev_m3_nanaco_shopping_earning_20260820",
  "ev_m3_sevencard_nanaco_charge_20260820",
] as const;

export const JP_CVS_006_TIMES = {
  transaction: "2026-08-20T05:42:00+09:00",
  purchase: "2026-08-20T05:43:00+09:00",
  replayKnowledge: "2026-08-20T05:56:00+09:00",
  independentCalculation: "2026-08-20T05:47:00+09:00",
  ruleReview: "2026-08-20T05:52:00+09:00",
  engineReplay: "2026-08-20T05:57:00+09:00",
} as const;

/** One immutable replay identity is shared by the admitted engine result and
 * the rejected preflight result.  Both are recorded only after the manual
 * calculation artifact has completed. */
export const JP_CVS_006_REPLAY_ID = "replay_jp_cvs_006_candidate" as const;
export const JP_CVS_006_INTEGRATED_REPLAY_ARTIFACT_ID =
  "integrated_replay_jp_cvs_006_candidate_v0_1" as const;
export const JP_CVS_006_INTEGRATED_REPLAY_ARTIFACT_PATH =
  "fixtures/m3/real-data/jp-cvs-006/integrated-replay.v0.1.json" as const;

/** Credit-charge limits from the Seven Card Plus route. */
export const JP_CVS_006_CREDIT_CHARGE_BOUNDARIES = {
  minimumJpy: 5_000,
  incrementJpy: 1_000,
  maximumJpy: 30_000,
  postChargeBalanceLimitJpy: 50_000,
} as const;

/** Cash-at-register limits from a separate Seven-Eleven nanaco source. */
export const JP_CVS_006_CASH_REGISTER_BOUNDARIES = {
  incrementJpy: 1_000,
  singleChargeLimitJpy: 49_000,
  postChargeBalanceLimitJpy: 50_000,
} as const;

export const JP_CVS_006_PURCHASE = {
  grossAmountJpy: 660,
  taxExclusiveAmountJpy: 600,
  productClass: "ordinary",
} as const;

export const JP_CVS_006_REWARD_QUANTUM_JPY = 200 as const;

export const JP_CVS_006_PLAN_IDS = {
  valid: "plan_jp_cvs_006_valid_5000_topup",
  belowMinimum: "plan_jp_cvs_006_invalid_4000_topup",
} as const;

export const JP_CVS_006_OPERATION_IDS = {
  validTopUp: "op_jp_cvs_006_topup_5000",
  validPurchase: "op_jp_cvs_006_purchase_5000",
  belowMinimumTopUp: "op_jp_cvs_006_topup_4000",
  belowMinimumPurchase: "op_jp_cvs_006_purchase_4000",
} as const;

export const JP_CVS_006_ASSET_IDS = {
  externalFunding: "asset.jp.seven-card-plus-credit",
  nanaco: "asset.jp.nanaco",
  nanacoPoint: "asset.jp.nanaco-point",
} as const;

export const JP_CVS_006_INSTRUMENT_IDS = {
  sevenCardPlus: "instrument.jp.seven-card-plus",
  nanaco: "instrument.jp.nanaco",
} as const;

export const JP_CVS_006_FUNDING_SOURCE_IDS = {
  sevenCardPlus: "funding.jp.seven-card-plus",
  nanaco: "funding.jp.nanaco",
} as const;

export const JP_CVS_006_PREREGISTRATION_FACT_KEY =
  "nanaco_credit_charge_preregistered" as const;

const PREREGISTRATION_CONDITION = {
  fact_key: JP_CVS_006_PREREGISTRATION_FACT_KEY,
  operator: "eq" as const,
  value: true,
  unknown_policy: "suppress_rule" as const,
};

const NO_EXPIRY: Expiry = {
  policy: "unknown",
  expires_at: null,
  duration_days: null,
  timezone: "Asia/Tokyo",
};

const POSTED_SETTLEMENT: Settlement = {
  status: "posted",
  expected_posting_from: null,
  expected_posting_to: null,
  posted_at: null,
};

const NANACO_RESTRICTIONS: UsageRestrictions = {
  transferable: null,
  redeemable_for_cash: null,
  usable_for_payment: true,
  investable: null,
  permitted_destination_ids: [],
  notes:
    "nanaco principal is a stored-value tender; its residual is conserved as principal.",
};

const NANACO_POINT_RESTRICTIONS: UsageRestrictions = {
  transferable: null,
  redeemable_for_cash: null,
  usable_for_payment: null,
  investable: null,
  permitted_destination_ids: [JP_CVS_006_ASSET_IDS.nanaco],
  notes:
    "nanaco points are recorded separately from nanaco principal and are not a second top-up principal balance.",
};

export const JP_CVS_006_ASSETS: AssetDefinition[] = [
  {
    asset_id: JP_CVS_006_ASSET_IDS.externalFunding,
    asset_kind: "credit_limit",
    display_name: "Seven Card Plus external credit funding",
    program_id: "program.jp.seven-card-plus",
    scale: 0,
    default_reward_class: null,
    default_expiry: NO_EXPIRY,
    default_usage_restrictions: {
      ...NANACO_RESTRICTIONS,
      usable_for_payment: false,
      notes: "External funding is never a reusable internal lot.",
    },
    status: "active",
    notes:
      "Accounting reference for explicit Seven Card Plus funding; the engine excludes external funding from reusable-lot conservation.",
  },
  {
    asset_id: JP_CVS_006_ASSET_IDS.nanaco,
    asset_kind: "stored_value",
    display_name: "nanaco electronic money",
    program_id: "program.jp.nanaco",
    scale: 0,
    default_reward_class: null,
    default_expiry: NO_EXPIRY,
    default_usage_restrictions: NANACO_RESTRICTIONS,
    status: "active",
    notes:
      "Principal created by a standard Seven Card Plus nanaco credit charge.",
  },
  {
    asset_id: JP_CVS_006_ASSET_IDS.nanacoPoint,
    asset_kind: "reward_point",
    display_name: "nanaco point",
    program_id: "program.jp.nanaco",
    scale: 0,
    default_reward_class: "normal",
    default_expiry: NO_EXPIRY,
    default_usage_restrictions: NANACO_POINT_RESTRICTIONS,
    status: "active",
    notes:
      "Reward quantity is attached to the operation that earns it; it is not merged into nanaco principal.",
  },
];

const NANACO_ASSET: AssetRef = {
  asset_id: JP_CVS_006_ASSET_IDS.nanaco,
  asset_kind: "stored_value",
  program_id: "program.jp.nanaco",
  reward_class: null,
  scale: 0,
};

const NANACO_POINT_ASSET: AssetRef = {
  asset_id: JP_CVS_006_ASSET_IDS.nanacoPoint,
  asset_kind: "reward_point",
  program_id: "program.jp.nanaco",
  reward_class: "normal",
  scale: 0,
};

const EXTERNAL_FUNDING_ASSET: AssetRef = {
  asset_id: JP_CVS_006_ASSET_IDS.externalFunding,
  asset_kind: "credit_limit",
  program_id: "program.jp.seven-card-plus",
  reward_class: null,
  scale: 0,
};

function candidateAudit(ruleId: string): RewardRule["audit"] {
  return {
    created_at: "2026-08-20T05:50:00+09:00",
    created_by: "codex-m3-jp-cvs-006-builder",
    review_events: [],
    required_review_modes: ["solo_dual_pass", "agent_challenged"],
    review_mode: null,
    reviewed_at: null,
    reviewed_by: null,
    change_reason: `Under-review candidate encoding for ${ruleId}; not a canonical publication.`,
  };
}

function rewardOutput(
  asset: AssetRef,
  settlement: Settlement = POSTED_SETTLEMENT,
): RuleOutput {
  return {
    asset,
    sign: "credit",
    certainty: {
      type: "guaranteed",
      probability: null,
      probability_source: null,
    },
    settlement,
    expiry: NO_EXPIRY,
    restrictions: NANACO_POINT_RESTRICTIONS,
    clawback: {
      on_refund: "unknown",
      posting_delay_days: null,
      notes: "No refund operation is included in this narrow candidate slice.",
    },
  };
}

function makeAcceptanceRule(params: {
  ruleId: string;
  name: string;
  subject: RewardRule["subject"];
  operationTypes: RewardRule["scope"]["operation_types"];
  channels: RewardRule["scope"]["channels"];
  merchantIds?: string[];
  operationMatch: RewardRule["eligibility"]["operation_match"];
  userConditions?: RewardRule["eligibility"]["user_conditions"];
  transactionConditions: RewardRule["eligibility"]["transaction_conditions"];
  evidenceIds: string[];
  reasonCode: string;
}): RewardRule {
  return {
    rule_id: params.ruleId,
    version: 1,
    status: "under_review",
    rule_type: "payment_acceptance",
    name: params.name,
    description:
      "Reviewed candidate acceptance rule; it contributes no reward quantity.",
    subject: params.subject,
    scope: {
      countries: ["JP"],
      operation_types: params.operationTypes,
      channels: params.channels,
      ...(params.merchantIds ? { merchant_ids: params.merchantIds } : {}),
    },
    eligibility: {
      operation_match: params.operationMatch,
      user_conditions: params.userConditions ?? [],
      transaction_conditions: params.transactionConditions,
      campaign_conditions: {},
    },
    effect: {
      decision: "allow",
      effect_target: "operation_eligibility",
      target_rule_ids: [],
      target_stack_groups: [],
      reason_code: params.reasonCode,
    },
    caps: [],
    stacking: {
      stack_group: `${params.ruleId}_acceptance`,
      mode: "non_reward_acceptance",
      precedence: 0,
      conflicts_with_rule_ids: [],
      requires_rule_ids: [],
    },
    validity: {
      valid_from: "2026-08-20T05:39:00+09:00",
      valid_to: null,
      timezone: "Asia/Tokyo",
      recorded_at: "2026-08-20T05:50:00+09:00",
      superseded_at: null,
    },
    provenance: {
      evidence_ids: params.evidenceIds,
      minimum_source_tier: "T1_CANONICAL",
      confidence: 0.95,
      human_verified: false,
      review_notes:
        "Normalized first-party evidence only; cash and credit charge boundaries are not merged.",
    },
    audit: candidateAudit(params.ruleId),
  };
}

function makeRewardRule(params: {
  ruleId: string;
  ruleType: "base_reward" | "card_benefit";
  name: string;
  subject: RewardRule["subject"];
  operationTypes: RewardRule["scope"]["operation_types"];
  channels: RewardRule["scope"]["channels"];
  merchantIds?: string[];
  includedProductClasses?: string[];
  taxBasis?: string;
  operationMatch: RewardRule["eligibility"]["operation_match"];
  userConditions?: RewardRule["eligibility"]["user_conditions"];
  transactionConditions: RewardRule["eligibility"]["transaction_conditions"];
  calculation: NonNullable<RewardRule["calculation"]>;
  evidenceIds: string[];
  settlement?: Settlement;
}): RewardRule {
  return {
    rule_id: params.ruleId,
    version: 1,
    status: "under_review",
    rule_type: params.ruleType,
    name: params.name,
    description:
      "Reviewed candidate reward rule with operation-scoped attribution.",
    subject: params.subject,
    scope: {
      countries: ["JP"],
      operation_types: params.operationTypes,
      channels: params.channels,
      ...(params.merchantIds ? { merchant_ids: params.merchantIds } : {}),
      ...(params.includedProductClasses
        ? { included_product_classes: params.includedProductClasses }
        : {}),
      ...(params.taxBasis ? { tax_basis: params.taxBasis } : {}),
    },
    eligibility: {
      operation_match: params.operationMatch,
      user_conditions: params.userConditions ?? [],
      transaction_conditions: params.transactionConditions,
      campaign_conditions: {},
    },
    calculation: params.calculation,
    output: rewardOutput(NANACO_POINT_ASSET, params.settlement),
    caps: [],
    stacking: {
      stack_group: params.ruleId,
      mode: "additive",
      precedence: 0,
      conflicts_with_rule_ids: [],
      requires_rule_ids: [],
    },
    validity: {
      valid_from: "2026-08-20T05:39:00+09:00",
      valid_to: null,
      timezone: "Asia/Tokyo",
      recorded_at: "2026-08-20T05:50:00+09:00",
      superseded_at: null,
    },
    provenance: {
      evidence_ids: params.evidenceIds,
      minimum_source_tier: "T1_CANONICAL",
      confidence: 0.95,
      human_verified: false,
      review_notes:
        "Reward is attached only to the operation matched by this rule; no acquisition reward is copied onto later tender.",
    },
    audit: candidateAudit(params.ruleId),
  };
}

const POINTS_PER_200 = {
  model: "points_per_unit" as const,
  reward_units: "1",
  spend_jpy: JP_CVS_006_REWARD_QUANTUM_JPY,
  rounding: {
    aggregation_scope: "per_operation" as const,
    eligible_spend_quantum_jpy: JP_CVS_006_REWARD_QUANTUM_JPY,
    reward_rounding_mode: "floor" as const,
  },
};

export const JP_CVS_006_RULES: RewardRule[] = [
  makeAcceptanceRule({
    ruleId: "rr_jp_cvs_006_sevencard_credit_acceptance",
    name: "Seven Card Plus nanaco credit-charge acceptance",
    subject: {
      entity_type: "credit_card",
      entity_id: JP_CVS_006_INSTRUMENT_IDS.sevenCardPlus,
    },
    operationTypes: ["stored_value_top_up"],
    channels: ["not_applicable"],
    operationMatch: {
      allowed_payment_instrument_ids: [JP_CVS_006_INSTRUMENT_IDS.sevenCardPlus],
      allowed_funding_source_ids: [JP_CVS_006_FUNDING_SOURCE_IDS.sevenCardPlus],
      allowed_destination_asset_ids: [JP_CVS_006_ASSET_IDS.nanaco],
    },
    userConditions: [PREREGISTRATION_CONDITION],
    transactionConditions: {
      minimum_amount_jpy: JP_CVS_006_CREDIT_CHARGE_BOUNDARIES.minimumJpy,
      maximum_amount_jpy: JP_CVS_006_CREDIT_CHARGE_BOUNDARIES.maximumJpy,
      eligible_amount_basis: "operation_amount",
    },
    evidenceIds: ["ev_m3_sevencard_nanaco_charge_20260820"],
    reasonCode: "sevencard_plus_credit_charge_route",
  }),
  makeRewardRule({
    ruleId: "rr_jp_cvs_006_sevencard_credit_topup_reward",
    ruleType: "card_benefit",
    name: "Seven Card Plus nanaco credit-charge earning",
    subject: {
      entity_type: "credit_card",
      entity_id: JP_CVS_006_INSTRUMENT_IDS.sevenCardPlus,
    },
    operationTypes: ["stored_value_top_up"],
    channels: ["not_applicable"],
    operationMatch: {
      allowed_payment_instrument_ids: [JP_CVS_006_INSTRUMENT_IDS.sevenCardPlus],
      allowed_funding_source_ids: [JP_CVS_006_FUNDING_SOURCE_IDS.sevenCardPlus],
      allowed_destination_asset_ids: [JP_CVS_006_ASSET_IDS.nanaco],
    },
    userConditions: [PREREGISTRATION_CONDITION],
    transactionConditions: {
      minimum_amount_jpy: JP_CVS_006_CREDIT_CHARGE_BOUNDARIES.minimumJpy,
      maximum_amount_jpy: JP_CVS_006_CREDIT_CHARGE_BOUNDARIES.maximumJpy,
      eligible_amount_basis: "operation_amount",
    },
    calculation: POINTS_PER_200,
    evidenceIds: [
      "ev_m3_sevencard_nanaco_charge_20260820",
      "ev_m3_nanaco_sevencard_earning_20260820",
    ],
    settlement: {
      status: "pending",
      expected_posting_from: null,
      expected_posting_to: null,
      posted_at: null,
    },
  }),
  makeAcceptanceRule({
    ruleId: "rr_jp_cvs_006_nanaco_payment_acceptance",
    name: "Seven-Eleven nanaco tender acceptance",
    subject: {
      entity_type: "payment_method",
      entity_id: JP_CVS_006_INSTRUMENT_IDS.nanaco,
    },
    operationTypes: ["merchant_purchase"],
    channels: ["in_store"],
    merchantIds: ["merchant.seveneleven"],
    operationMatch: {
      allowed_payment_instrument_ids: [JP_CVS_006_INSTRUMENT_IDS.nanaco],
      allowed_funding_source_ids: [JP_CVS_006_FUNDING_SOURCE_IDS.nanaco],
      allowed_source_asset_ids: [JP_CVS_006_ASSET_IDS.nanaco],
      required_loyalty_program_ids: ["program.jp.nanaco"],
    },
    transactionConditions: {},
    evidenceIds: ["ev_m3_seveneleven_nanaco_20260820"],
    reasonCode: "seveneleven_nanaco_tender_accepted",
  }),
  makeRewardRule({
    ruleId: "rr_jp_cvs_006_nanaco_purchase_reward",
    ruleType: "base_reward",
    name: "Seven-Eleven ordinary nanaco purchase earning",
    subject: {
      entity_type: "stored_value_program",
      entity_id: "program.jp.nanaco",
    },
    operationTypes: ["merchant_purchase"],
    channels: ["in_store"],
    merchantIds: ["merchant.seveneleven"],
    includedProductClasses: [JP_CVS_006_PURCHASE.productClass],
    taxBasis: "tax_exclusive",
    operationMatch: {
      required_loyalty_program_ids: ["program.jp.nanaco"],
      allowed_payment_instrument_ids: [JP_CVS_006_INSTRUMENT_IDS.nanaco],
      allowed_funding_source_ids: [JP_CVS_006_FUNDING_SOURCE_IDS.nanaco],
      allowed_source_asset_ids: [JP_CVS_006_ASSET_IDS.nanaco],
    },
    transactionConditions: {
      eligible_amount_basis: "eligible_line_items",
    },
    calculation: POINTS_PER_200,
    evidenceIds: [
      "ev_m3_nanaco_shopping_earning_20260820",
      "ev_m3_seveneleven_nanaco_20260820",
    ],
  }),
];

const JP_CVS_006_REPLAY_RULES: RewardRule[] = JP_CVS_006_RULES.map((rule) => ({
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
        reviewer_id: "m3-jp-cvs-006-fixture-replay-admission",
        completed_at: JP_CVS_006_TIMES.ruleReview,
        decision: "approved",
        notes:
          "Technical admission for this isolated replay only; not a rule-publication decision.",
      },
    ],
    required_review_modes: ["solo_dual_pass"],
    review_mode: "solo_dual_pass",
    reviewed_at: JP_CVS_006_TIMES.ruleReview,
    reviewed_by: "m3-jp-cvs-006-fixture-replay-admission",
  },
}));

function externalFundingInput(
  amountJpy: number,
  inputId: string,
): Operation["asset_inputs"][number] {
  return {
    input_id: inputId,
    source_lot_id: null,
    quantity: {
      asset: EXTERNAL_FUNDING_ASSET,
      amount: amountJpy.toString(),
    },
    role: "external_funding",
  };
}

function makeJpCvs006Plan(
  planId: string,
  topUpAmountJpy: number,
  topUpOperationId: string,
  purchaseOperationId: string,
): PurchasePlan {
  const nanacoLotId = `lot_jp_cvs_006_nanaco_${topUpAmountJpy}`;
  return {
    plan_id: planId,
    operations: [
      {
        operation_id: topUpOperationId,
        sequence: 1,
        occurred_at: JP_CVS_006_TIMES.transaction,
        operation_type: "stored_value_top_up",
        merchant_id: null,
        merchant_location_id: null,
        channel: "not_applicable",
        interface: "not_applicable",
        payment_instrument_id: JP_CVS_006_INSTRUMENT_IDS.sevenCardPlus,
        funding_source_id: JP_CVS_006_FUNDING_SOURCE_IDS.sevenCardPlus,
        amount_jpy: topUpAmountJpy,
        asset_inputs: [
          externalFundingInput(
            topUpAmountJpy,
            `in_jp_cvs_006_topup_${topUpAmountJpy}_funding`,
          ),
        ],
        output_requests: [
          {
            request_id: `out_jp_cvs_006_nanaco_${topUpAmountJpy}`,
            created_lot_id: nanacoLotId,
            asset: NANACO_ASSET,
            requested_amount: topUpAmountJpy.toString(),
            role: "stored_value",
          },
        ],
        original_operation_id: null,
        portal_id: null,
        line_items: [],
        notes:
          "Standard Seven Card Plus credit-funded nanaco charge; cash-at-register limits are not applied.",
      },
      {
        operation_id: purchaseOperationId,
        sequence: 2,
        occurred_at: JP_CVS_006_TIMES.purchase,
        operation_type: "merchant_purchase",
        merchant_id: "merchant.seveneleven",
        merchant_location_id: null,
        channel: "in_store",
        interface: "not_applicable",
        payment_instrument_id: JP_CVS_006_INSTRUMENT_IDS.nanaco,
        funding_source_id: JP_CVS_006_FUNDING_SOURCE_IDS.nanaco,
        amount_jpy: JP_CVS_006_PURCHASE.grossAmountJpy,
        asset_inputs: [
          {
            input_id: `in_jp_cvs_006_nanaco_tender_${topUpAmountJpy}`,
            source_lot_id: nanacoLotId,
            quantity: {
              asset: NANACO_ASSET,
              amount: JP_CVS_006_PURCHASE.grossAmountJpy.toString(),
            },
            role: "stored_value_tender",
          },
        ],
        output_requests: [],
        original_operation_id: null,
        portal_id: null,
        line_items: [
          {
            line_item_id: `line_jp_cvs_006_ordinary_${topUpAmountJpy}`,
            product_class: JP_CVS_006_PURCHASE.productClass,
            amount_jpy: JP_CVS_006_PURCHASE.grossAmountJpy,
            tax_exclusive_amount_jpy: JP_CVS_006_PURCHASE.taxExclusiveAmountJpy,
            quantity: 1,
            eligible_for_rewards: true,
          },
        ],
        notes:
          "Ordinary Seven-Eleven purchase; explicit JPY 600 tax-exclusive basis is used for nanaco purchase earning.",
      },
    ],
    dependencies: [
      {
        from_operation_id: topUpOperationId,
        to_operation_id: purchaseOperationId,
        dependency_type: "funds",
      },
    ],
    loyalty_presentments: [
      {
        operation_id: purchaseOperationId,
        loyalty_program_id: "program.jp.nanaco",
        interface: "not_applicable",
        presentation_mode: "manual",
        sequence: 2,
      },
    ],
    assumptions: [
      "The route uses the evidenced standard Seven Card Plus credit-charge boundary: JPY 5,000 minimum, JPY 1,000 increments, JPY 30,000 maximum per charge, and JPY 50,000 post-charge balance limit.",
      "The separate Seven-Eleven cash-at-register JPY 49,000 single-charge limit is not reused for credit-funded top-ups.",
      "The merchant purchase is one ordinary eligible line with gross tender JPY 660 and explicit tax-exclusive amount JPY 600.",
      "Top-up reward attribution is limited to the stored-value acquisition operation; the later nanaco tender cannot re-award that acquisition reward.",
    ],
  };
}

export const JP_CVS_006_VALID_PLAN = makeJpCvs006Plan(
  JP_CVS_006_PLAN_IDS.valid,
  JP_CVS_006_CREDIT_CHARGE_BOUNDARIES.minimumJpy,
  JP_CVS_006_OPERATION_IDS.validTopUp,
  JP_CVS_006_OPERATION_IDS.validPurchase,
);

export const JP_CVS_006_BELOW_MINIMUM_PLAN = makeJpCvs006Plan(
  JP_CVS_006_PLAN_IDS.belowMinimum,
  JP_CVS_006_CREDIT_CHARGE_BOUNDARIES.minimumJpy -
    JP_CVS_006_CREDIT_CHARGE_BOUNDARIES.incrementJpy,
  JP_CVS_006_OPERATION_IDS.belowMinimumTopUp,
  JP_CVS_006_OPERATION_IDS.belowMinimumPurchase,
);

export const JP_CVS_006_CANDIDATE_PLANS: PurchasePlan[] = [
  JP_CVS_006_VALID_PLAN,
  JP_CVS_006_BELOW_MINIMUM_PLAN,
];

export interface JpCvs006CandidateCheck {
  plan_id: string;
  eligible: boolean;
  rejection_code?:
    | "credit_charge_below_minimum"
    | "credit_charge_not_increment"
    | "credit_charge_above_maximum"
    | "credit_balance_limit_exceeded"
    | "credit_charge_preregistration_missing"
    | "purchase_amount_mismatch"
    | "tax_exclusive_basis_missing";
  message?: string;
  reward_calculation_performed: boolean;
}

/**
 * Candidate preflight for facts that must be decided before reward calculation.
 * In particular, the engine treats a rule's minimum amount as a rule-match
 * condition; it does not turn a non-matching top-up into an invalid plan.  The
 * below-minimum candidate is therefore rejected here and is never evaluated by
 * the reward engine.
 */
export function validateJpCvs006Candidate(
  plan: PurchasePlan,
  context: EngineContext = JP_CVS_006_CONTEXT,
): JpCvs006CandidateCheck {
  const topUp = plan.operations.find(
    (operation) => operation.operation_type === "stored_value_top_up",
  );
  const purchase = plan.operations.find(
    (operation) => operation.operation_type === "merchant_purchase",
  );
  const amount = topUp?.amount_jpy ?? 0;
  const postChargeBalance = amount;
  const preregistration =
    context.user_state?.facts[JP_CVS_006_PREREGISTRATION_FACT_KEY];
  if (preregistration?.status !== "known" || preregistration.value !== true)
    return {
      plan_id: plan.plan_id,
      eligible: false,
      rejection_code: "credit_charge_preregistration_missing",
      message:
        "Seven Card Plus nanaco credit charge requires confirmed preregistration.",
      reward_calculation_performed: false,
    };
  if (amount < JP_CVS_006_CREDIT_CHARGE_BOUNDARIES.minimumJpy)
    return {
      plan_id: plan.plan_id,
      eligible: false,
      rejection_code: "credit_charge_below_minimum",
      message: `Seven Card Plus nanaco credit charge must be at least JPY ${JP_CVS_006_CREDIT_CHARGE_BOUNDARIES.minimumJpy}.`,
      reward_calculation_performed: false,
    };
  if (amount % JP_CVS_006_CREDIT_CHARGE_BOUNDARIES.incrementJpy !== 0)
    return {
      plan_id: plan.plan_id,
      eligible: false,
      rejection_code: "credit_charge_not_increment",
      message: `Seven Card Plus nanaco credit charge must use JPY ${JP_CVS_006_CREDIT_CHARGE_BOUNDARIES.incrementJpy} increments.`,
      reward_calculation_performed: false,
    };
  if (amount > JP_CVS_006_CREDIT_CHARGE_BOUNDARIES.maximumJpy)
    return {
      plan_id: plan.plan_id,
      eligible: false,
      rejection_code: "credit_charge_above_maximum",
      message: `Seven Card Plus nanaco credit charge cannot exceed JPY ${JP_CVS_006_CREDIT_CHARGE_BOUNDARIES.maximumJpy} per charge.`,
      reward_calculation_performed: false,
    };
  if (
    postChargeBalance >
    JP_CVS_006_CREDIT_CHARGE_BOUNDARIES.postChargeBalanceLimitJpy
  )
    return {
      plan_id: plan.plan_id,
      eligible: false,
      rejection_code: "credit_balance_limit_exceeded",
      message: `nanaco balance cannot exceed JPY ${JP_CVS_006_CREDIT_CHARGE_BOUNDARIES.postChargeBalanceLimitJpy} after the credit charge.`,
      reward_calculation_performed: false,
    };
  if (
    purchase?.amount_jpy !== JP_CVS_006_PURCHASE.grossAmountJpy ||
    purchase.line_items.length !== 1 ||
    purchase.line_items[0]?.amount_jpy !== JP_CVS_006_PURCHASE.grossAmountJpy
  )
    return {
      plan_id: plan.plan_id,
      eligible: false,
      rejection_code: "purchase_amount_mismatch",
      message: "The candidate must complete the frozen JPY 660 purchase.",
      reward_calculation_performed: false,
    };
  const line = purchase.line_items[0];
  if (
    line?.eligible_for_rewards !== false &&
    line?.tax_exclusive_amount_jpy !== JP_CVS_006_PURCHASE.taxExclusiveAmountJpy
  )
    return {
      plan_id: plan.plan_id,
      eligible: false,
      rejection_code: "tax_exclusive_basis_missing",
      message:
        "The tax-exclusive purchase reward requires the explicit JPY 600 eligible line-item amount.",
      reward_calculation_performed: false,
    };
  return {
    plan_id: plan.plan_id,
    eligible: true,
    reward_calculation_performed: false,
  };
}

/** Alias with plan-oriented naming for callers at the fixture boundary. */
export const validateJpCvs006Plan = validateJpCvs006Candidate;

export const JP_CVS_006_CONTEXT: EngineContext = {
  rules: JP_CVS_006_REPLAY_RULES,
  assets: JP_CVS_006_ASSETS,
  opening_asset_lots: [],
  user_state: {
    owned_instrument_ids: [JP_CVS_006_INSTRUMENT_IDS.sevenCardPlus],
    owned_loyalty_program_ids: ["program.jp.nanaco"],
    facts: {
      [JP_CVS_006_PREREGISTRATION_FACT_KEY]: {
        status: "known",
        value: true,
        observed_at: JP_CVS_006_TIMES.transaction,
        source: "manual_review",
        confidence: "1",
      },
    },
    asset_lots: [],
    valuation_profile: {
      version: "m3-jp-cvs-006-v0.1",
      entries: [
        {
          valuation_id: "valuation_jp_cvs_006_nanaco",
          asset_id: JP_CVS_006_ASSET_IDS.nanaco,
          reward_class: null,
          expiry_horizon_days: null,
          jpy_per_unit: "1",
          basis: "face_value",
        },
        {
          valuation_id: "valuation_jp_cvs_006_nanaco_point",
          asset_id: JP_CVS_006_ASSET_IDS.nanacoPoint,
          reward_class: "normal",
          expiry_horizon_days: null,
          jpy_per_unit: "1",
          basis: "face_value",
        },
      ],
    },
    cap_progress: {},
  },
  transaction_time: JP_CVS_006_TIMES.transaction,
  replay_knowledge_at: JP_CVS_006_TIMES.replayKnowledge,
  objective: {
    primary: "maximize_guaranteed_net_value",
    probabilistic_reward_policy: "guaranteed_only",
    ending_asset_valuation: "use_user_profile",
    tie_breakers: ["lower_external_funding", "fewer_operations"],
  },
};

export interface JpCvs006CandidateReplay {
  preflight: readonly JpCvs006CandidateCheck[];
  admitted_plan_ids: readonly string[];
  rejected_plan_ids: readonly string[];
  recommendation: Recommendation | null;
}

export type JpCvs006EngineEvaluator = (
  plans: readonly PurchasePlan[],
  context: EngineContext,
) => Recommendation;

/**
 * Mandatory candidate boundary: no plan reaches reward evaluation until its
 * prerequisite, amount, tender, and tax-basis preflight succeeds.
 */
export function replayJpCvs006Candidates(
  plans: readonly PurchasePlan[] = JP_CVS_006_CANDIDATE_PLANS,
  context: EngineContext = JP_CVS_006_CONTEXT,
  evaluator: JpCvs006EngineEvaluator = evaluateCandidates,
): JpCvs006CandidateReplay {
  const preflight = plans.map((plan) =>
    validateJpCvs006Candidate(plan, context),
  );
  const admittedPlans = plans.filter(
    (_plan, index) => preflight[index]?.eligible === true,
  );
  return {
    preflight,
    admitted_plan_ids: admittedPlans.map((plan) => plan.plan_id),
    rejected_plan_ids: preflight
      .filter((result) => !result.eligible)
      .map((result) => result.plan_id),
    recommendation:
      admittedPlans.length === 0 ? null : evaluator(admittedPlans, context),
  };
}

export const JP_CVS_006_NEGATIVE_ASSERTION_IDS = {
  topUpRewardNotReapplied: "jp_cvs_006_topup_reward_not_reapplied_at_purchase",
  residualPrincipalNotDisappeared:
    "jp_cvs_006_residual_nanaco_principal_not_disappeared",
  cashBoundaryNotCreditBoundary:
    "jp_cvs_006_cash_register_49000_boundary_not_used_for_credit_charge",
  belowMinimumNoReward:
    "jp_cvs_006_below_minimum_topup_has_no_reward_calculation",
} as const;

export interface JpCvs006IntegratedRewardComponent {
  operation_id: string;
  reward_asset_id: string;
  reward_class: string | null;
  quantity: string;
  value_jpy: string;
  calculation_trace: {
    eligible_basis: string;
    spend_jpy: string;
    denominator_jpy: number;
    rounding_stage: string;
  };
}

export interface JpCvs006IntegratedPlanResult {
  plan_id: string;
  result_artifact_id: string;
  produced_by: "engine" | "preflight";
  eligible: boolean;
  reward_calculation_performed: boolean;
  external_funding_jpy: string | null;
  merchant_value_jpy: string | null;
  tax_exclusive_purchase_amount_jpy: string | null;
  reward_components: readonly JpCvs006IntegratedRewardComponent[];
  residual_nanaco_principal_jpy: string | null;
  rejection_code?: string;
  preflight_rejection?: {
    eligible: false;
    rejection_code: string;
    reward_calculation_performed: false;
  };
  preflight?: {
    top_up_amount_jpy: number;
    rejection_code: string;
    minimum_amount_jpy: number;
    reward_calculation_performed: false;
  };
}

export interface JpCvs006IntegratedNegativeAssertion {
  assertion_id: string;
  status: "passed";
  checked_at: string;
  observations: Readonly<Record<string, boolean | number | string>>;
}

export interface JpCvs006IntegratedReplayArtifact {
  record_type: "m3_jp_cvs_006_integrated_replay";
  record_version: "0.1.0";
  artifact_id: typeof JP_CVS_006_INTEGRATED_REPLAY_ARTIFACT_ID;
  scenario_id: typeof JP_CVS_006_SCENARIO_ID;
  independent_calculation: {
    artifact_id: "calc_jp_cvs_006_manual_v0_1";
    completed_at: typeof JP_CVS_006_TIMES.independentCalculation;
    method: "manual";
  };
  replay: {
    replay_id: typeof JP_CVS_006_REPLAY_ID;
    status: "passed";
    completed_at: typeof JP_CVS_006_TIMES.engineReplay;
    replay_knowledge_at: typeof JP_CVS_006_TIMES.replayKnowledge;
    result_plan_ids: readonly [
      typeof JP_CVS_006_PLAN_IDS.valid,
      typeof JP_CVS_006_PLAN_IDS.belowMinimum,
    ];
  };
  candidate_plan_ids: readonly [
    typeof JP_CVS_006_PLAN_IDS.valid,
    typeof JP_CVS_006_PLAN_IDS.belowMinimum,
  ];
  admitted_plan_ids: readonly [typeof JP_CVS_006_PLAN_IDS.valid];
  rejected_plan_ids: readonly [typeof JP_CVS_006_PLAN_IDS.belowMinimum];
  plan_results: readonly [
    JpCvs006IntegratedPlanResult,
    JpCvs006IntegratedPlanResult,
  ];
  recommendation: {
    winner_plan_id: typeof JP_CVS_006_PLAN_IDS.valid;
    ranked_plan_ids: readonly [typeof JP_CVS_006_PLAN_IDS.valid];
    outcome_mode: "definite";
  };
  negative_assertions: readonly JpCvs006IntegratedNegativeAssertion[];
  conservation: {
    status: "passed";
    created_nanaco_principal_jpy: string;
    consumed_nanaco_principal_jpy: string;
    residual_nanaco_principal_jpy: string;
    identity: string;
  };
  ci_replay: {
    artifact_id: typeof JP_CVS_006_INTEGRATED_REPLAY_ARTIFACT_ID;
    status: "passed";
    checked_at: typeof JP_CVS_006_TIMES.engineReplay;
  };
}

function asString(value: string | number | bigint | null | undefined): string {
  if (value === null || value === undefined)
    throw new Error("jp_cvs_006_integrated_value_missing");
  return value.toString();
}

/**
 * Project the wrapper output into a stable, JSON-safe integrated artifact.
 * The rejected plan is represented only by its preflight result; it is never
 * copied from an engine result and therefore cannot acquire a reward or rank.
 */
export function projectJpCvs006IntegratedReplay(
  replay: JpCvs006CandidateReplay,
): JpCvs006IntegratedReplayArtifact {
  const valid = replay.recommendation?.plans.find(
    (plan) => plan.plan_id === JP_CVS_006_PLAN_IDS.valid,
  );
  const invalid = replay.preflight.find(
    (result) => result.plan_id === JP_CVS_006_PLAN_IDS.belowMinimum,
  );
  const purchase = JP_CVS_006_VALID_PLAN.operations.find(
    (operation) => operation.operation_type === "merchant_purchase",
  );
  const purchaseLine = purchase?.line_items[0];
  const residualLot = valid?.ending_asset_lots.find(
    (lot) => lot.quantity.asset.asset_id === JP_CVS_006_ASSET_IDS.nanaco,
  );

  if (
    !valid ||
    !invalid ||
    !purchaseLine ||
    !residualLot ||
    replay.admitted_plan_ids.length !== 1 ||
    replay.admitted_plan_ids[0] !== JP_CVS_006_PLAN_IDS.valid ||
    replay.rejected_plan_ids.length !== 1 ||
    replay.rejected_plan_ids[0] !== JP_CVS_006_PLAN_IDS.belowMinimum ||
    replay.recommendation?.plans.length !== 1 ||
    replay.recommendation?.winner?.plan_id !== JP_CVS_006_PLAN_IDS.valid
  ) {
    throw new Error("jp_cvs_006_integrated_replay_incomplete");
  }
  if (
    invalid.eligible ||
    !invalid.rejection_code ||
    invalid.reward_calculation_performed
  ) {
    throw new Error("jp_cvs_006_invalid_preflight_metadata");
  }

  const rewardComponents = valid.reward_components.map((reward) => ({
    operation_id: reward.operation_id,
    reward_asset_id: reward.quantity.asset.asset_id,
    reward_class: reward.quantity.asset.reward_class,
    quantity: reward.quantity.amount,
    value_jpy: asString(reward.value_jpy.expected_jpy),
    calculation_trace: {
      eligible_basis: reward.calculation_trace.eligible_basis,
      spend_jpy: asString(
        reward.calculation_trace.spend_jpy as string | number | bigint | null,
      ),
      denominator_jpy: Number(reward.calculation_trace.denominator_jpy),
      rounding_stage: reward.calculation_trace.rounding_stage,
    },
  }));
  const topUpReward = rewardComponents.find(
    (reward) => reward.operation_id === JP_CVS_006_OPERATION_IDS.validTopUp,
  );
  const purchaseReward = rewardComponents.find(
    (reward) => reward.operation_id === JP_CVS_006_OPERATION_IDS.validPurchase,
  );
  if (
    rewardComponents.length !== 2 ||
    topUpReward?.quantity !== "25" ||
    purchaseReward?.quantity !== "3" ||
    purchaseReward.calculation_trace.spend_jpy !== "600" ||
    valid.external_funding_jpy !== 5000n ||
    valid.merchant_value_jpy !== 660n ||
    residualLot.quantity.amount !== "4340"
  ) {
    throw new Error("jp_cvs_006_integrated_replay_values_mismatch");
  }

  return {
    record_type: "m3_jp_cvs_006_integrated_replay",
    record_version: "0.1.0",
    artifact_id: JP_CVS_006_INTEGRATED_REPLAY_ARTIFACT_ID,
    scenario_id: JP_CVS_006_SCENARIO_ID,
    independent_calculation: {
      artifact_id: "calc_jp_cvs_006_manual_v0_1",
      completed_at: JP_CVS_006_TIMES.independentCalculation,
      method: "manual",
    },
    replay: {
      replay_id: JP_CVS_006_REPLAY_ID,
      status: "passed",
      completed_at: JP_CVS_006_TIMES.engineReplay,
      replay_knowledge_at: JP_CVS_006_TIMES.replayKnowledge,
      result_plan_ids: [
        JP_CVS_006_PLAN_IDS.valid,
        JP_CVS_006_PLAN_IDS.belowMinimum,
      ],
    },
    candidate_plan_ids: [
      JP_CVS_006_PLAN_IDS.valid,
      JP_CVS_006_PLAN_IDS.belowMinimum,
    ],
    admitted_plan_ids: [JP_CVS_006_PLAN_IDS.valid],
    rejected_plan_ids: [JP_CVS_006_PLAN_IDS.belowMinimum],
    plan_results: [
      {
        plan_id: JP_CVS_006_PLAN_IDS.valid,
        result_artifact_id: "result_jp_cvs_006_valid_5000_topup",
        produced_by: "engine",
        eligible: true,
        reward_calculation_performed: true,
        external_funding_jpy: valid.external_funding_jpy.toString(),
        merchant_value_jpy: valid.merchant_value_jpy.toString(),
        tax_exclusive_purchase_amount_jpy: asString(
          purchaseLine.tax_exclusive_amount_jpy,
        ),
        reward_components: rewardComponents,
        residual_nanaco_principal_jpy: residualLot.quantity.amount,
      },
      {
        plan_id: JP_CVS_006_PLAN_IDS.belowMinimum,
        result_artifact_id: "preflight_jp_cvs_006_invalid_4000_topup",
        produced_by: "preflight",
        eligible: false,
        reward_calculation_performed: false,
        external_funding_jpy: null,
        merchant_value_jpy: null,
        tax_exclusive_purchase_amount_jpy: null,
        reward_components: [],
        residual_nanaco_principal_jpy: null,
        rejection_code: invalid.rejection_code,
        preflight_rejection: {
          eligible: false,
          rejection_code: invalid.rejection_code,
          reward_calculation_performed: false,
        },
        preflight: {
          top_up_amount_jpy: 4000,
          rejection_code: invalid.rejection_code,
          minimum_amount_jpy: JP_CVS_006_CREDIT_CHARGE_BOUNDARIES.minimumJpy,
          reward_calculation_performed: false,
        },
      },
    ],
    recommendation: {
      winner_plan_id: JP_CVS_006_PLAN_IDS.valid,
      ranked_plan_ids: [JP_CVS_006_PLAN_IDS.valid],
      outcome_mode: "definite",
    },
    negative_assertions: [
      {
        assertion_id: JP_CVS_006_NEGATIVE_ASSERTION_IDS.topUpRewardNotReapplied,
        status: "passed",
        checked_at: JP_CVS_006_TIMES.engineReplay,
        observations: {
          top_up_reward_quantity: topUpReward.quantity,
          purchase_reward_quantity: purchaseReward.quantity,
          top_up_reward_reapplied_at_purchase: false,
        },
      },
      {
        assertion_id:
          JP_CVS_006_NEGATIVE_ASSERTION_IDS.residualPrincipalNotDisappeared,
        status: "passed",
        checked_at: JP_CVS_006_TIMES.engineReplay,
        observations: {
          created_nanaco_principal_jpy: "5000",
          consumed_nanaco_principal_jpy: "660",
          residual_nanaco_principal_jpy: residualLot.quantity.amount,
        },
      },
      {
        assertion_id:
          JP_CVS_006_NEGATIVE_ASSERTION_IDS.cashBoundaryNotCreditBoundary,
        status: "passed",
        checked_at: JP_CVS_006_TIMES.engineReplay,
        observations: {
          credit_charge_maximum_jpy:
            JP_CVS_006_CREDIT_CHARGE_BOUNDARIES.maximumJpy,
          cash_register_single_charge_limit_jpy:
            JP_CVS_006_CASH_REGISTER_BOUNDARIES.singleChargeLimitJpy,
          boundaries_distinct: true,
        },
      },
      {
        assertion_id: JP_CVS_006_NEGATIVE_ASSERTION_IDS.belowMinimumNoReward,
        status: "passed",
        checked_at: JP_CVS_006_TIMES.engineReplay,
        observations: {
          rejection_code: invalid.rejection_code,
          reward_calculation_performed: false,
          reward_component_count: 0,
        },
      },
    ],
    conservation: {
      status: "passed",
      created_nanaco_principal_jpy: "5000",
      consumed_nanaco_principal_jpy: "660",
      residual_nanaco_principal_jpy: residualLot.quantity.amount,
      identity: "5000 - 660 = 4340",
    },
    ci_replay: {
      artifact_id: JP_CVS_006_INTEGRATED_REPLAY_ARTIFACT_ID,
      status: "passed",
      checked_at: JP_CVS_006_TIMES.engineReplay,
    },
  };
}

/** Evidence-backed fact used by the candidate's valuation explanation. */
export const JP_CVS_006_NANACO_POINT_REDEMPTION = {
  source_asset: JP_CVS_006_ASSET_IDS.nanacoPoint,
  source_quantity: 1,
  destination_asset: JP_CVS_006_ASSET_IDS.nanaco,
  destination_quantity: 1,
  conversion_fee_jpy: 0,
  evidence_id: "ev_m3_nanaco_redemption_value_20260820",
} as const;

export const JP_CVS_006_INDEPENDENT_CALCULATION_ARTIFACT_PATH =
  "fixtures/m3/real-data/jp-cvs-006/independent-calculation.v0.1.json" as const;

export const JP_CVS_006_SCENARIO_RECORD_PATH =
  "fixtures/m3/real-data/jp-cvs-006/reviewed-scenario.v0.1.json" as const;

/** Paths for the immutable v1 golden projection and its hash manifest. */
export const JP_CVS_006_GOLDEN_SCENARIO_PATH =
  "fixtures/m3/real-data/jp-cvs-006/golden-scenario.v1.json" as const;
export const JP_CVS_006_GOLDEN_MANIFEST_PATH =
  "fixtures/m3/real-data/jp-cvs-006/golden-scenario.v1.manifest.json" as const;

type GoldenJpyValueRange = {
  minimum_jpy: number;
  maximum_jpy: number;
  expected_jpy: number | null;
};

/**
 * The engine deliberately keeps calculated JPY values as decimal strings (and
 * native funding values as bigint).  The golden contract is a JSON document,
 * so this projection is the one place where exact integer JPY ranges are
 * materialized.  It refuses a fractional or non-finite value rather than
 * silently rounding a replay result.
 */
function exactJpyInteger(
  value: string | number | null,
  field: string,
): number | null {
  if (value === null) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0)
    throw new Error(`jp_cvs_006_non_integer_jpy:${field}:${String(value)}`);
  return parsed;
}

function projectJpyRange(
  value: {
    minimum_jpy: string | number;
    maximum_jpy: string | number;
    expected_jpy: string | number | null;
  },
  field: string,
): GoldenJpyValueRange {
  const minimum = exactJpyInteger(value.minimum_jpy, `${field}.minimum_jpy`);
  const maximum = exactJpyInteger(value.maximum_jpy, `${field}.maximum_jpy`);
  const expected = exactJpyInteger(value.expected_jpy, `${field}.expected_jpy`);
  if (minimum === null || maximum === null || minimum > maximum)
    throw new Error(`jp_cvs_006_invalid_jpy_range:${field}`);
  if (expected !== null && (expected < minimum || expected > maximum))
    throw new Error(`jp_cvs_006_expected_jpy_outside_range:${field}`);
  return { minimum_jpy: minimum, maximum_jpy: maximum, expected_jpy: expected };
}

function projectEngineRewardComponent(reward: {
  component_id: string;
  operation_id: string;
  rule_id: string;
  sign: "credit" | "debit";
  quantity: unknown;
  value_jpy: {
    minimum_jpy: string | number;
    maximum_jpy: string | number;
    expected_jpy: string | number | null;
  };
  certainty: unknown;
  settlement: unknown;
  expiry: unknown;
  restrictions: unknown;
  clawback: unknown;
  calculation_trace: Record<string, unknown>;
}): Record<string, unknown> {
  // value_jpy_decimal is a native engine convenience field and is not part of
  // asset.schema.json; explicitly omit it from the immutable contract.
  return {
    component_id: reward.component_id,
    operation_id: reward.operation_id,
    rule_id: reward.rule_id,
    sign: reward.sign,
    quantity: structuredClone(reward.quantity),
    value_jpy: projectJpyRange(
      reward.value_jpy,
      `reward.${reward.component_id}`,
    ),
    certainty: structuredClone(reward.certainty),
    settlement: structuredClone(reward.settlement),
    expiry: structuredClone(reward.expiry),
    restrictions: structuredClone(reward.restrictions),
    clawback: structuredClone(reward.clawback),
    calculation_trace: structuredClone(reward.calculation_trace),
  };
}

function projectEnginePlanResult(
  plan: ValuedPlanResult,
): Record<string, unknown> {
  const economics = Object.fromEntries(
    Object.entries(plan.economics).map(([field, value]) => [
      field,
      projectJpyRange(value, `plan.${plan.plan_id}.economics.${field}`),
    ]),
  );
  const withoutHash = {
    plan_id: plan.plan_id,
    eligible: plan.eligible,
    asset_movements: structuredClone(plan.asset_movements),
    reward_components: plan.reward_components.map(projectEngineRewardComponent),
    ending_asset_lots: structuredClone(plan.ending_asset_lots),
    economics,
    objective_score_jpy: projectJpyRange(
      {
        minimum_jpy: plan.objective_score_jpy,
        maximum_jpy: plan.objective_score_jpy,
        expected_jpy: plan.objective_score_jpy,
      },
      `plan.${plan.plan_id}.objective_score_jpy`,
    ),
    nominal_return_basis_points: null,
    applied_rule_ids: [...plan.applied_rule_ids],
    rejected_rule_ids: [...plan.rejected_rule_ids],
    rejection_reasons: plan.rejection_reasons.map((reason) => reason.message),
    result_origin: "engine" as const,
    preflight_rejection: null,
  };
  return {
    ...withoutHash,
    // The artifact hash intentionally covers the result with this field
    // absent, avoiding a self-referential hash.
    result_artifact_hash: canonicalHash(withoutHash),
  };
}

function projectJpCvs006PreflightResult(
  check: JpCvs006CandidateCheck,
): Record<string, unknown> {
  if (check.eligible || !check.rejection_code)
    throw new Error("jp_cvs_006_preflight_projection_requires_rejection");
  const zero = (field: string): GoldenJpyValueRange =>
    projectJpyRange(
      { minimum_jpy: 0, maximum_jpy: 0, expected_jpy: 0 },
      `plan.${check.plan_id}.${field}`,
    );
  const withoutHash = {
    plan_id: check.plan_id,
    eligible: false,
    asset_movements: [],
    reward_components: [],
    ending_asset_lots: [],
    economics: {
      merchant_value_received_jpy: zero("merchant_value_received_jpy"),
      external_funding_jpy: zero("external_funding_jpy"),
      opening_asset_value_consumed_jpy: zero(
        "opening_asset_value_consumed_jpy",
      ),
      ending_asset_value_jpy: zero("ending_asset_value_jpy"),
      guaranteed_reward_value_jpy: zero("guaranteed_reward_value_jpy"),
      probabilistic_expected_reward_value_jpy: zero(
        "probabilistic_expected_reward_value_jpy",
      ),
      fee_value_jpy: zero("fee_value_jpy"),
      guaranteed_net_value_change_jpy: zero("guaranteed_net_value_change_jpy"),
      expected_net_value_change_jpy: zero("expected_net_value_change_jpy"),
    },
    objective_score_jpy: zero("objective_score_jpy"),
    nominal_return_basis_points: null,
    applied_rule_ids: [],
    rejected_rule_ids: [],
    rejection_reasons: [check.rejection_code],
    result_origin: "preflight" as const,
    preflight_rejection: {
      rejection_code: check.rejection_code,
      reward_calculation_performed: false as const,
    },
  };
  return {
    ...withoutHash,
    result_artifact_hash: canonicalHash(withoutHash),
  };
}

function bindingRoles(ruleId: string): string[] {
  const valid = JP_CVS_006_VALID_PLAN.plan_id === JP_CVS_006_PLAN_IDS.valid;
  if (!valid) throw new Error("jp_cvs_006_valid_plan_identity_changed");
  const roles: string[] = [];
  const engineApplied = new Set([
    "rr_jp_cvs_006_sevencard_credit_acceptance",
    "rr_jp_cvs_006_sevencard_credit_topup_reward",
    "rr_jp_cvs_006_nanaco_payment_acceptance",
    "rr_jp_cvs_006_nanaco_purchase_reward",
  ]);
  const engineRejected = new Set([
    "rr_jp_cvs_006_sevencard_credit_acceptance",
    "rr_jp_cvs_006_nanaco_payment_acceptance",
  ]);
  if (engineApplied.has(ruleId)) roles.push("applied");
  if (engineRejected.has(ruleId)) roles.push("rejected");
  if (
    ruleId === "rr_jp_cvs_006_sevencard_credit_acceptance" ||
    ruleId === "rr_jp_cvs_006_sevencard_credit_topup_reward"
  )
    roles.push("boundary_source");
  if (roles.length === 0)
    throw new Error(`jp_cvs_006_rule_has_no_golden_role:${ruleId}`);
  return roles;
}

function sourceRuleDefinitionHash(rule: RewardRule): string {
  const definition = structuredClone(rule) as unknown as Record<
    string,
    unknown
  >;
  for (const field of [
    "version",
    "status",
    "validity",
    "provenance",
    "audit",
    "definition_hash",
  ])
    delete definition[field];
  return canonicalHash(definition);
}

export function projectJpCvs006GoldenScenario(
  replay: JpCvs006CandidateReplay,
): Record<string, unknown> {
  const valid = replay.recommendation?.plans.find(
    (plan) => plan.plan_id === JP_CVS_006_PLAN_IDS.valid,
  );
  const invalid = replay.preflight.find(
    (check) => check.plan_id === JP_CVS_006_PLAN_IDS.belowMinimum,
  );
  if (
    !valid ||
    !invalid ||
    !replay.recommendation ||
    replay.recommendation.plans.length !== 1 ||
    replay.recommendation.winner?.plan_id !== JP_CVS_006_PLAN_IDS.valid ||
    replay.admitted_plan_ids.length !== 1 ||
    replay.admitted_plan_ids[0] !== JP_CVS_006_PLAN_IDS.valid ||
    replay.rejected_plan_ids.length !== 1 ||
    replay.rejected_plan_ids[0] !== JP_CVS_006_PLAN_IDS.belowMinimum
  )
    throw new Error("jp_cvs_006_golden_replay_incomplete");
  if (invalid.eligible || invalid.reward_calculation_performed)
    throw new Error("jp_cvs_006_golden_preflight_not_honest");

  const validResult = projectEnginePlanResult(valid);
  const invalidResult = projectJpCvs006PreflightResult(invalid);
  const recommendation = replay.recommendation;
  const review = {
    review_mode: "agent_challenged" as const,
    calculated_by: "codex-m3-jp-cvs-006-builder",
    verified_by: "m3-scenario-challenge-verifier",
    verified_at: "2026-08-20T06:38:55+09:00",
    cooling_off_completed_at: "2026-08-20T06:24:00+09:00",
    independent_calculation_artifact:
      JP_CVS_006_INDEPENDENT_CALCULATION_ARTIFACT_PATH,
    decision: "approved" as const,
    notes:
      "Golden projection of the reviewed JP-CVS-006 route. Rule admission remains ephemeral and does not publish the under_review source candidate.",
    required_review_modes: ["solo_dual_pass", "agent_challenged"] as const,
    review_events: [
      {
        mode: "solo_dual_pass" as const,
        reviewer_id: "m3-jp-cvs-006-primary-solo-reviewer",
        completed_at: "2026-08-20T06:24:00+09:00",
        decision: "approved" as const,
        notes:
          "Cooling-off reread reproduced all five approved source mappings, 25 top-up points, 3 purchase points, JPY 4,340 residual principal, and the below-minimum preflight rejection.",
      },
      {
        mode: "agent_challenged" as const,
        reviewer_id: "m3-scenario-challenge-verifier",
        completed_at: "2026-08-20T06:38:55+09:00",
        decision: "approved" as const,
        notes:
          "Independent challenge recomputed the arithmetic, verified all evidence hashes and authoritative manual source readiness, and reproduced zero evaluator calls for missing preregistration.",
      },
    ],
  };

  const ruleVersionBindings = JP_CVS_006_RULES.map((rule) => ({
    rule_id: rule.rule_id,
    version: rule.version,
    roles: bindingRoles(rule.rule_id),
    source_candidate_status: rule.status,
    definition_hash: sourceRuleDefinitionHash(rule),
    validity: structuredClone(rule.validity),
    evidence_ids: [...rule.provenance.evidence_ids],
  }));
  const replayOutput = JSON.parse(
    recommendation.replay.canonical_output,
  ) as unknown;
  const scenario = {
    scenario_id: JP_CVS_006_SCENARIO_ID,
    version: 1,
    status: "golden" as const,
    level: "L2_STACKING" as const,
    title:
      "Seven Card Plus nanaco route preserves residual principal and scoped rewards",
    description:
      "Reviewed JP-CVS-006 real-data route: an admitted JPY 5,000 credit-funded nanaco charge completes a JPY 660 ordinary purchase, earns 25 + 3 nanaco points, and conserves JPY 4,340 nanaco principal. The JPY 4,000 route remains an honest preflight rejection.",
    as_of: JP_CVS_006_TIMES.transaction,
    replay_knowledge_at: JP_CVS_006_TIMES.replayKnowledge,
    timezone: "Asia/Tokyo" as const,
    user_state: structuredClone(JP_CVS_006_CONTEXT.user_state),
    asset_definitions: structuredClone(JP_CVS_006_ASSETS),
    objective: structuredClone(JP_CVS_006_CONTEXT.objective),
    candidate_plans: structuredClone(JP_CVS_006_CANDIDATE_PLANS),
    expected: {
      outcome_mode: "definite" as const,
      definite_winner_plan_id: JP_CVS_006_PLAN_IDS.valid,
      safe_plan_id: JP_CVS_006_PLAN_IDS.valid,
      runner_up_plan_id: null,
      conditional_winners: [],
      plan_results: [validResult, invalidResult],
      assertions: [
        {
          assertion_type: "plan_is_eligible" as const,
          target_id: JP_CVS_006_PLAN_IDS.valid,
          expected: true,
          reason:
            "The JPY 5,000 credit charge satisfies the reviewed minimum, increment, balance, preregistration, and purchase preflight checks.",
        },
        {
          assertion_type: "reward_equals" as const,
          target_id: JP_CVS_006_OPERATION_IDS.validTopUp,
          expected: 25,
          reason:
            "The credit-funded nanaco top-up earns floor(5000 / 200) = 25 nanaco points.",
        },
        {
          assertion_type: "reward_equals" as const,
          target_id: JP_CVS_006_OPERATION_IDS.validPurchase,
          expected: 3,
          reason:
            "The ordinary purchase uses its explicit JPY 600 tax-exclusive basis: floor(600 / 200) = 3 nanaco points.",
        },
        {
          assertion_type: "asset_movement_equals" as const,
          target_id: `${JP_CVS_006_OPERATION_IDS.validPurchase}:tax_exclusive_amount_jpy`,
          expected: 600,
          reason:
            "The purchase reward calculation uses the explicit tax-exclusive JPY 600 line-item amount, not the JPY 660 gross tender.",
        },
        {
          assertion_type: "residual_asset_equals" as const,
          target_id: `lot_jp_cvs_006_nanaco_${JP_CVS_006_CREDIT_CHARGE_BOUNDARIES.minimumJpy}`,
          expected: "4340",
          reason:
            "JPY 5,000 created nanaco principal less JPY 660 tender leaves JPY 4,340 residual principal.",
        },
        {
          assertion_type: "reward_equals" as const,
          target_id: "jp_cvs_006_total_points",
          expected: 28,
          reason:
            "Operation-scoped rewards total 25 top-up points + 3 purchase points; the top-up reward is not counted again at purchase.",
        },
        {
          assertion_type: "rule_does_not_apply" as const,
          target_id: `${JP_CVS_006_OPERATION_IDS.validPurchase}:${"rr_jp_cvs_006_sevencard_credit_topup_reward"}`,
          expected: false,
          reason:
            "The Seven Card Plus top-up reward is attributed only to the top-up operation and is not reapplied to the later nanaco tender.",
        },
        {
          assertion_type: "plan_is_ineligible" as const,
          target_id: JP_CVS_006_PLAN_IDS.belowMinimum,
          expected: true,
          reason:
            "The JPY 4,000 credit charge is below the reviewed JPY 5,000 minimum.",
        },
        {
          assertion_type: "reward_equals" as const,
          target_id: `${JP_CVS_006_PLAN_IDS.belowMinimum}:reward_calculation_performed`,
          expected: false,
          reason:
            "The below-minimum route is rejected in preflight and receives no reward calculation or engine ledger.",
        },
        {
          assertion_type: "winner_is" as const,
          target_id: JP_CVS_006_PLAN_IDS.valid,
          expected: true,
          reason:
            "Only the admitted JPY 5,000 route is ranked; it is the definite and safe winner.",
        },
        {
          assertion_type: "net_value_equals" as const,
          target_id: JP_CVS_006_PLAN_IDS.valid,
          expected: 28,
          reason:
            "Native economics reconcile to JPY 660 merchant value + JPY 4,340 ending principal + JPY 28 rewards - JPY 5,000 external funding = JPY 28 net value change.",
        },
      ],
      explanation_tokens: [
        "TOPUP_FIRST",
        "EARN_TOPUP_POINTS",
        "PAY_WITH_NANACO",
        "EARN_PURCHASE_POINTS",
        "RESIDUAL_PRINCIPAL_CONSERVED",
        "OPERATION_SCOPED_REWARDS",
        "BELOW_MINIMUM_PREFLIGHT_REJECTED",
        "DEFINITE_WINNER",
      ],
      questions_to_resolve: [],
      valuation_sensitivities: [],
    },
    evidence_ids: [...JP_CVS_006_EVIDENCE_IDS],
    rule_version_bindings: ruleVersionBindings,
    replay_provenance: {
      replay_id: JP_CVS_006_REPLAY_ID,
      rule_admission: "ephemeral_published_clone" as const,
      publication_authorized: false,
      engine_version: recommendation.replay.engine_version,
      contracts_version: recommendation.replay.contract_version,
      valuation_profile_version:
        JP_CVS_006_CONTEXT.user_state?.valuation_profile.version ??
        "m3-jp-cvs-006-v0.1",
      input_hash: recommendation.replay.input_hash,
      output_hash: canonicalHash(replayOutput),
      completed_at: JP_CVS_006_TIMES.engineReplay,
      replay_knowledge_at: JP_CVS_006_TIMES.replayKnowledge,
    },
    review,
  };
  return scenario;
}

/**
 * Deterministically build the complete golden projection.  The supplied
 * evaluator is intentionally injectable for hostile call-count tests; the
 * default path invokes the existing preflight/replay wrapper exactly once.
 */
export function buildJpCvs006GoldenScenario(
  evaluator: JpCvs006EngineEvaluator = evaluateCandidates,
): Record<string, unknown> {
  const replay = replayJpCvs006Candidates(
    JP_CVS_006_CANDIDATE_PLANS,
    JP_CVS_006_CONTEXT,
    evaluator,
  );
  return projectJpCvs006GoldenScenario(replay);
}

/** Canonical fixture hash used by the companion manifest. */
export function canonicalJpCvs006GoldenScenarioHash(
  scenario: Record<string, unknown> = buildJpCvs006GoldenScenario(),
): string {
  return canonicalHash(scenario);
}

/** Hash manifest shape kept explicit so tests can recompute every hash. */
export function buildJpCvs006GoldenManifest(
  scenario: Record<string, unknown> = buildJpCvs006GoldenScenario(),
): Record<string, unknown> {
  const planResults = scenario.expected as {
    plan_results: readonly Record<string, unknown>[];
  };
  return {
    record_type: "m3_jp_cvs_006_golden_scenario_manifest",
    record_version: "1.0.0",
    scenario_id: JP_CVS_006_SCENARIO_ID,
    fixture_path: JP_CVS_006_GOLDEN_SCENARIO_PATH,
    fixture_hash: canonicalJpCvs006GoldenScenarioHash(scenario),
    canonical_fixture_hash: canonicalJpCvs006GoldenScenarioHash(scenario),
    result_artifact_hashes: planResults.plan_results.map((result) => ({
      plan_id: result.plan_id,
      result_artifact_hash: result.result_artifact_hash,
    })),
    replay_input_projection: {
      projection_version: "engine_candidates_input.v1",
      base_context: {
        rules: structuredClone(JP_CVS_006_REPLAY_RULES),
      },
      fixture_bindings: {
        plans: "candidate_plans[engine_origin]",
        "context.asset_definitions": "asset_definitions",
        "context.user_state": "user_state",
        "context.user_state.asset_lots": "user_state.asset_lots",
        "context.user_state.valuation_profile.entries":
          "user_state.valuation_profile.entries",
        "context.objective": "objective",
        "context.replay_knowledge_at": "replay_knowledge_at",
        "context.transaction_time": "as_of",
      },
    },
    hash_basis:
      "canonical JSON with lexicographically sorted object keys; plan result hashes exclude their own result_artifact_hash field; replay input binds every non-rule context field to the golden fixture and retains only definition-bound ephemeral rule clones",
  };
}
