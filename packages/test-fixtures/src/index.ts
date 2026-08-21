import type {
  AssetDefinition,
  AssetLot,
  AssetRef,
  EngineContext,
  Expiry,
  Operation,
  PurchasePlan,
  RewardClass,
  RewardRule,
  RuleOutput,
  Settlement,
  UsageRestrictions,
  UserState,
  ValuationEntry,
} from "@jro/rule-engine";

export type {
  M3BlockedExperimentManifest,
  M3CandidateEvaluator,
  M3ExperimentArtifactVerificationResult,
  M3ExperimentBlocker,
  M3ExperimentBlockerCode,
  M3ExperimentFileReader,
  M3ExperimentFileReference,
  M3ExperimentManifest,
  M3ExperimentPromotionGateResult,
  M3ExperimentReplayOptions,
  M3ExperimentReplayResult,
  M3ExperimentReview,
  M3ExperimentSetReplayResult,
  M3ExperimentStatus,
  M3ExperimentValidationResult,
  M3IndependentCalculationMethod,
  M3IndependentExpectedArtifact,
  M3NonTransferSeedScenarioId,
  M3RunnableExperimentManifest,
  M3VerifiedExperimentArtifact,
} from "./m3-experiment.js";
export {
  composeM3ExperimentPromotionGate,
  evaluateM3ExperimentPromotionGate,
  loadM3Experiment,
  loadM3ExperimentManifest,
  M3_NON_TRANSFER_SEED_SCENARIO_IDS,
  replayM3Experiment,
  replayM3ExperimentSet,
  replayM3Experiments,
  runM3Experiment,
  runM3ExperimentReplay,
  validateM3ExperimentManifest,
  validateM3ExperimentSeedScenarioIds,
  validateM3NonTransferSeedScenarioIds,
  verifyM3ExperimentArtifactHashes,
  verifyM3ExperimentArtifacts,
  verifyM3ExperimentHashes,
} from "./m3-experiment.js";
export type {
  M3ArtifactCheck,
  M3CandidatePlan,
  M3CheckStatus,
  M3EngineReplay,
  M3EngineReplayStatus,
  M3EvidenceReference,
  M3EvidenceStatus,
  M3GateBlocker,
  M3GateBlockerCode,
  M3IndependentCalculationArtifact,
  M3IndependentCalculationStatus,
  M3NegativeAssertion,
  M3PlanResult,
  M3Review,
  M3ReviewEvent,
  M3ReviewMode,
  M3ScenarioGateResult,
  M3ScenarioRecord,
  M3ScenarioSourceReadiness,
  M3ScenarioStatus,
  M3SeedPromotionGateResult,
  M3SeedScenarioId,
  M3SourceGateResultInput,
} from "./m3-gate.js";
export {
  evaluateM3PromotionGate,
  evaluateM3Scenario,
  evaluateM3ScenarioPromotion,
  evaluateM3SeedPromotionGate,
  evaluateM3SeedSet,
  M3_AUTHORITATIVE_PRIMARY_SOURCE_IDS,
  M3_SEED_SCENARIO_IDS,
  requiredM3ReviewModes,
  validateM3SeedScenarioIds,
} from "./m3-gate.js";

export type {
  M3AssessmentValue,
  M3CandidateSourceDescriptor,
  M3CoveredSourceBlocker,
  M3FailedExperimentInput,
  M3FailedExperimentScenario,
  M3FailedExperimentSourceGate,
  M3FailedExperimentSourceReadiness,
  M3RawSourceBlocker,
  M3RemediationAction,
  M3RemediationApproval,
  M3RemediationAssessment,
  M3RemediationClassification,
  M3RemediationDraftMapping,
  M3RemediationMappingAfter,
  M3RemediationPromotion,
  M3RemediationProposal,
  M3RemediationProposalSetInput,
  M3RemediationSummary,
  M3RemediationValidationCode,
  M3RemediationValidationIssue,
  M3RemediationValidationResult,
  M3ReplacementBasis,
  M3ScenarioScopedSourceBlocker,
  M3SourcePromotionBlockerCode,
} from "./m3-remediation.js";
export {
  classifyM3Remediation,
  classifyM3RemediationProposal,
  createM3RemediationProposalId,
  M3_REMEDIATION_ACTIONS,
  M3_SOURCE_PROMOTION_BLOCKER_CODES,
  summarizeM3Remediation,
  summarizeM3RemediationProposalSet,
  validateM3RemediationProposalSet,
} from "./m3-remediation.js";

export const SYNTHETIC_TRANSACTION_TIME = "2026-08-17T12:00:00+09:00";
export const SYNTHETIC_REPLAY_KNOWLEDGE_TIME = "2026-08-17T12:30:00+09:00";

export const externalFundingAsset: AssetRef = {
  asset_id: "asset.synthetic.card-funding",
  asset_kind: "credit_limit",
  program_id: "program.synthetic.card",
  reward_class: null,
  scale: 0,
};

export const walletAsset: AssetRef = {
  asset_id: "asset.synthetic.wallet",
  asset_kind: "stored_value",
  program_id: "program.synthetic.wallet",
  // Stored-value principal has no reward class in the canonical asset schema.
  // Conservation still keys this bucket explicitly as `(asset_id, null)`.
  reward_class: null,
  scale: 0,
};

export const normalPointAsset: AssetRef = {
  asset_id: "asset.synthetic.point",
  asset_kind: "reward_point",
  program_id: "program.synthetic.points",
  reward_class: "normal",
  scale: 0,
};

export const limitedPointAsset: AssetRef = {
  ...normalPointAsset,
  reward_class: "limited_period",
};

const noExpiry: Expiry = {
  policy: "none",
  expires_at: null,
  duration_days: null,
  timezone: null,
};
const posted: Settlement = {
  status: "posted",
  expected_posting_from: null,
  expected_posting_to: null,
  posted_at: null,
};
const walletRestrictions: UsageRestrictions = {
  transferable: false,
  redeemable_for_cash: false,
  usable_for_payment: true,
  investable: false,
  permitted_destination_ids: [],
  notes: "Synthetic wallet is spendable only at the synthetic merchant.",
};

export function makeAssetDefinitions(): AssetDefinition[] {
  return [
    {
      asset_id: externalFundingAsset.asset_id,
      asset_kind: externalFundingAsset.asset_kind,
      display_name: "Synthetic card funding",
      program_id: externalFundingAsset.program_id,
      scale: externalFundingAsset.scale,
      default_reward_class: null,
      default_expiry: noExpiry,
      default_usage_restrictions: {
        ...walletRestrictions,
        usable_for_payment: false,
      },
      status: "synthetic",
      notes:
        "Synthetic external funding liability; never a reusable opening lot.",
    },
    {
      asset_id: walletAsset.asset_id,
      asset_kind: walletAsset.asset_kind,
      display_name: "Synthetic stored value",
      program_id: walletAsset.program_id,
      scale: walletAsset.scale,
      default_reward_class: walletAsset.reward_class,
      default_expiry: noExpiry,
      default_usage_restrictions: walletRestrictions,
      status: "synthetic",
      notes: "Synthetic stored-value balance.",
    },
    {
      asset_id: normalPointAsset.asset_id,
      asset_kind: normalPointAsset.asset_kind,
      display_name: "Synthetic normal points",
      program_id: normalPointAsset.program_id,
      scale: normalPointAsset.scale,
      default_reward_class: normalPointAsset.reward_class,
      default_expiry: noExpiry,
      default_usage_restrictions: {
        ...walletRestrictions,
        usable_for_payment: false,
        notes: "Synthetic normal points.",
      },
      status: "synthetic",
      notes: "Synthetic reward asset.",
    },
  ];
}

export function makeOperation(
  params: Partial<Operation> &
    Pick<
      Operation,
      "operation_id" | "sequence" | "occurred_at" | "operation_type"
    >,
): Operation {
  return {
    operation_id: params.operation_id,
    sequence: params.sequence,
    occurred_at: params.occurred_at,
    operation_type: params.operation_type,
    merchant_id: params.merchant_id ?? "merchant.synthetic",
    merchant_location_id: params.merchant_location_id ?? "location.synthetic",
    channel: params.channel ?? "in_store",
    interface: params.interface ?? "physical_card",
    payment_instrument_id:
      params.payment_instrument_id ?? "instrument.synthetic.card",
    funding_source_id: params.funding_source_id ?? "funding.synthetic.card",
    amount_jpy: params.amount_jpy ?? null,
    asset_inputs: params.asset_inputs ?? [],
    output_requests: params.output_requests ?? [],
    original_operation_id: params.original_operation_id ?? null,
    portal_id: params.portal_id ?? null,
    line_items:
      params.line_items ??
      (params.operation_type === "merchant_purchase"
        ? [
            {
              line_item_id: "line.synthetic",
              product_class: "ordinary",
              amount_jpy: params.amount_jpy ?? 0,
              quantity: 1,
              eligible_for_rewards: true,
            },
          ]
        : []),
    notes: params.notes ?? "Synthetic fixture operation.",
  };
}

function externalInput(
  amount: number,
  inputId: string,
): Operation["asset_inputs"][number] {
  return {
    input_id: inputId,
    source_lot_id: null,
    quantity: { asset: externalFundingAsset, amount: amount.toString() },
    role: "external_funding",
  };
}

export function makeDirectPurchasePlan(amountJpy = 640): PurchasePlan {
  return {
    plan_id: "plan_synthetic_direct_card",
    operations: [
      makeOperation({
        operation_id: "op_synthetic_direct",
        sequence: 1,
        occurred_at: SYNTHETIC_TRANSACTION_TIME,
        operation_type: "merchant_purchase",
        amount_jpy: amountJpy,
        asset_inputs: [externalInput(amountJpy, "in_synthetic_direct_funding")],
      }),
    ],
    dependencies: [],
    loyalty_presentments: [],
    assumptions: [
      "All values and acceptance facts are synthetic.",
      "External card funding is explicitly included.",
    ],
  };
}

export function makeTopupPurchasePlan(
  acquisitionAmountJpy = 1_000,
  purchaseAmountJpy = 640,
): PurchasePlan {
  return {
    plan_id: "plan_synthetic_topup_then_pay",
    operations: [
      makeOperation({
        operation_id: "op_synthetic_topup",
        sequence: 1,
        occurred_at: SYNTHETIC_TRANSACTION_TIME,
        operation_type: "stored_value_top_up",
        merchant_id: null,
        merchant_location_id: null,
        amount_jpy: acquisitionAmountJpy,
        asset_inputs: [
          externalInput(acquisitionAmountJpy, "in_synthetic_topup_funding"),
        ],
        output_requests: [
          {
            request_id: "out_synthetic_wallet",
            created_lot_id: "lot_synthetic_wallet",
            asset: walletAsset,
            requested_amount: acquisitionAmountJpy.toString(),
            role: "stored_value",
          },
        ],
      }),
      makeOperation({
        operation_id: "op_synthetic_wallet_purchase",
        sequence: 2,
        occurred_at: "2026-08-17T12:01:00+09:00",
        operation_type: "merchant_purchase",
        amount_jpy: purchaseAmountJpy,
        asset_inputs: [
          {
            input_id: "in_synthetic_wallet_tender",
            source_lot_id: "lot_synthetic_wallet",
            quantity: {
              asset: walletAsset,
              amount: purchaseAmountJpy.toString(),
            },
            role: "stored_value_tender",
          },
        ],
      }),
    ],
    dependencies: [
      {
        from_operation_id: "op_synthetic_topup",
        to_operation_id: "op_synthetic_wallet_purchase",
        dependency_type: "funds",
      },
    ],
    loyalty_presentments: [],
    assumptions: [
      "The top-up creates one stored-value lot.",
      "The wallet purchase consumes only the requested amount.",
    ],
  };
}

export function makeTenThousandFundingPlan(
  purchaseAmountJpy = 640,
): PurchasePlan {
  return makeTopupPurchasePlan(10_000, purchaseAmountJpy);
}

export function makeOpeningWalletLot(
  amount = "1000",
  lotId = "lot_opening_wallet",
): AssetLot {
  return {
    lot_id: lotId,
    quantity: { asset: walletAsset, amount },
    acquired_at: "2026-08-01T00:00:00+09:00",
    source_operation_id: "op_opening_wallet",
    settlement: posted,
    expiry: noExpiry,
    restrictions: walletRestrictions,
    provenance_rule_ids: [],
  };
}

function defaultRuleOutput(
  asset: AssetRef,
  sign: RuleOutput["sign"] = "credit",
): RuleOutput {
  return {
    asset,
    sign,
    certainty: {
      type: "guaranteed",
      probability: null,
      probability_source: null,
    },
    settlement: posted,
    expiry: noExpiry,
    restrictions: {
      ...walletRestrictions,
      usable_for_payment: false,
      notes: "Synthetic reward restriction.",
    },
    clawback: {
      on_refund: "none",
      posting_delay_days: 0,
      notes: "Synthetic fixture.",
    },
  };
}

export interface RuleOptions {
  ruleId: string;
  operationTypes: RewardRule["scope"]["operation_types"];
  calculation: NonNullable<RewardRule["calculation"]>;
  outputAsset?: AssetRef;
  rewardClass?: RewardClass;
  channel?: RewardRule["scope"]["channels"][number];
  ruleType?: string;
}

export function makeRewardRule(options: RuleOptions): RewardRule {
  const outputAsset = options.outputAsset ?? {
    ...normalPointAsset,
    reward_class: options.rewardClass ?? "normal",
  };
  return {
    rule_id: options.ruleId,
    version: 1,
    status: "published",
    rule_type: options.ruleType ?? "base_reward",
    name: `Synthetic ${options.ruleId}`,
    description: "Synthetic rule for deterministic Milestone 1a tests.",
    subject: { entity_type: "merchant", entity_id: "merchant.synthetic" },
    scope: {
      countries: ["JP"],
      operation_types: options.operationTypes,
      channels: [options.channel ?? "in_store"],
      merchant_ids: ["merchant.synthetic"],
    },
    eligibility: {
      operation_match: {},
      user_conditions: [],
      transaction_conditions: { eligible_amount_basis: "operation_amount" },
      campaign_conditions: {},
    },
    calculation: options.calculation,
    output: defaultRuleOutput(outputAsset),
    caps: [],
    stacking: {
      stack_group: options.ruleId,
      mode: "additive",
      precedence: 0,
      conflicts_with_rule_ids: [],
      requires_rule_ids: [],
    },
    validity: {
      valid_from: "2026-01-01T00:00:00+09:00",
      valid_to: null,
      timezone: "Asia/Tokyo",
      recorded_at: "2026-01-01T00:00:00+09:00",
      superseded_at: null,
    },
    provenance: {
      evidence_ids: [`ev_${options.ruleId.replace(/^rr_/, "")}`],
      minimum_source_tier: "T1_CANONICAL",
      confidence: 1,
      human_verified: true,
    },
    audit: {
      created_at: "2026-01-01T00:00:00+09:00",
      created_by: "synthetic-fixture",
      review_events: [
        {
          mode: "solo_dual_pass",
          reviewer_id: "synthetic-fixture",
          completed_at: "2026-01-01T01:00:00+09:00",
          decision: "approved",
          notes: "Synthetic deterministic fixture.",
        },
      ],
      required_review_modes: ["solo_dual_pass"],
      review_mode: "solo_dual_pass",
      reviewed_at: "2026-01-01T01:00:00+09:00",
      reviewed_by: "synthetic-fixture",
      change_reason: "Synthetic fixture.",
    },
  };
}

export function makeTopupRewardRule(): RewardRule {
  return makeRewardRule({
    ruleId: "rr_synthetic_topup",
    operationTypes: ["stored_value_top_up"],
    calculation: {
      model: "points_per_unit",
      reward_units: "1",
      spend_jpy: 100,
      rounding: {
        aggregation_scope: "per_operation",
        eligible_spend_quantum_jpy: 100,
        reward_rounding_mode: "floor",
      },
    },
  });
}

export function makePercentageRule(
  ruleId = "rr_synthetic_percentage",
  operationTypes: RewardRule["scope"]["operation_types"] = [
    "merchant_purchase",
  ],
  rateBasisPoints = 100,
  outputAsset = normalPointAsset,
): RewardRule {
  return makeRewardRule({
    ruleId,
    operationTypes,
    outputAsset,
    calculation: {
      model: "percentage",
      rate_basis_points: rateBasisPoints,
      rounding: {
        aggregation_scope: "per_operation",
        reward_rounding_mode: "floor",
      },
    },
  });
}

export function makePointsPerUnitRule(
  ruleId = "rr_synthetic_points",
  spendJpy = 100,
  rewardUnits = "1",
  outputAsset = normalPointAsset,
): RewardRule {
  return makeRewardRule({
    ruleId,
    operationTypes: ["merchant_purchase"],
    outputAsset,
    calculation: {
      model: "points_per_unit",
      spend_jpy: spendJpy,
      reward_units: rewardUnits,
      rounding: {
        aggregation_scope: "per_operation",
        eligible_spend_quantum_jpy: spendJpy,
        reward_rounding_mode: "floor",
      },
    },
  });
}

export function makeLimitedPeriodRule(): RewardRule {
  return makePercentageRule(
    "rr_synthetic_limited",
    ["merchant_purchase"],
    100,
    limitedPointAsset,
  );
}

export function makeRewardExclusionRule(targetRuleId: string): RewardRule {
  const base = makeRewardRule({
    ruleId: "rr_synthetic_exclusion",
    operationTypes: ["merchant_purchase"],
    calculation: {
      model: "percentage",
      rate_basis_points: 0,
      rounding: {
        aggregation_scope: "per_operation",
        reward_rounding_mode: "floor",
      },
    },
  });
  const {
    calculation: _calculation,
    output: _output,
    ...withoutFinancialOutput
  } = base;
  return {
    ...withoutFinancialOutput,
    rule_type: "exclusion",
    effect: {
      decision: "deny",
      effect_target: "reward_earning",
      target_rule_ids: [targetRuleId],
      target_stack_groups: [],
      reason_code: "synthetic_exclusion",
    },
  };
}

export function makeSyntheticRules(): RewardRule[] {
  return [makeTopupRewardRule(), makePercentageRule(), makeLimitedPeriodRule()];
}

export function makeValuationProfile(
  walletJpyPerUnit = "0.95",
): ValuationEntry[] {
  return [
    {
      valuation_id: "valuation_wallet",
      asset_id: walletAsset.asset_id,
      reward_class: walletAsset.reward_class,
      expiry_horizon_days: null,
      jpy_per_unit: walletJpyPerUnit,
      basis: "user_preference",
    },
    {
      valuation_id: "valuation_normal_points",
      asset_id: normalPointAsset.asset_id,
      reward_class: "normal",
      expiry_horizon_days: null,
      jpy_per_unit: "1",
      basis: "face_value",
    },
    {
      valuation_id: "valuation_limited_points",
      asset_id: limitedPointAsset.asset_id,
      reward_class: "limited_period",
      expiry_horizon_days: null,
      jpy_per_unit: "0.8",
      basis: "restricted_value",
    },
  ];
}

export function makeEngineContext(
  walletJpyPerUnit = "0.95",
  overrides: Partial<EngineContext> = {},
): EngineContext {
  return {
    rules: makeSyntheticRules(),
    assets: makeAssetDefinitions(),
    opening_asset_lots: [],
    valuation_profile: makeValuationProfile(walletJpyPerUnit),
    transaction_time: SYNTHETIC_TRANSACTION_TIME,
    replay_knowledge_at: SYNTHETIC_REPLAY_KNOWLEDGE_TIME,
    ...overrides,
  };
}

export function makeValuationFlipFixture(walletJpyPerUnit = "0.95"): {
  plans: PurchasePlan[];
  context: EngineContext;
} {
  return {
    plans: [makeDirectPurchasePlan(), makeTopupPurchasePlan()],
    context: makeEngineContext(walletJpyPerUnit, {
      rules: [makeTopupRewardRule()],
    }),
  };
}

export function makeBitemporalRuleVersions(): RewardRule[] {
  const base = makePercentageRule(
    "rr_synthetic_bitemporal",
    ["merchant_purchase"],
    100,
  );
  const first = {
    ...base,
    validity: {
      ...base.validity,
      valid_to: null,
      superseded_at: "2027-01-01T00:00:00+09:00",
    },
  };
  const second = {
    ...makePercentageRule(
      "rr_synthetic_bitemporal",
      ["merchant_purchase"],
      200,
    ),
    version: 2,
    validity: {
      ...first.validity,
      valid_from: "2027-01-01T00:00:00+09:00",
      valid_to: null,
      recorded_at: "2027-01-01T00:00:00+09:00",
      superseded_at: null,
    },
  };
  return [first, second];
}

export function makeUserState(
  walletJpyPerUnit = "0.95",
  openingLots: AssetLot[] = [],
): UserState {
  return {
    owned_instrument_ids: ["instrument.synthetic.card"],
    owned_loyalty_program_ids: [],
    facts: {},
    asset_lots: openingLots,
    valuation_profile: {
      version: "synthetic-v1",
      entries: makeValuationProfile(walletJpyPerUnit),
    },
    cap_progress: {},
  };
}

export const syntheticFixtureManifest = {
  version: "0.4.1",
  transaction_time: SYNTHETIC_TRANSACTION_TIME,
  replay_knowledge_at: SYNTHETIC_REPLAY_KNOWLEDGE_TIME,
  plans: [
    "direct_purchase",
    "topup_then_purchase",
    "ten_thousand_topup_residual",
    "acquisition_only",
  ],
  guarantees: [
    "native-ledger-determinism",
    "reward-class-separation",
    "valuation-isolation",
    "exact-residual",
  ],
} as const;
