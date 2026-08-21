import type {
  AssetDefinition,
  AssetLot,
  EngineObjective,
  FeasibleState,
  JpyValueRange,
  PurchasePlan,
  RewardRule,
  UserState,
  ValuationEntry,
  ValuedPlanResult,
} from "@jro/rule-engine";
import type {
  MerchantCatalog,
  MerchantQuery,
  ResolvedMerchant,
} from "./merchant.js";
import type {
  RuleAssurance,
  RuleTrustAssessment as TrustAssessment,
} from "./security.js";

export const RECOMMENDATION_API_VERSION = "1" as const;
export type RecommendationApiVersion = typeof RECOMMENDATION_API_VERSION;

export type RecommendationMode =
  | "production"
  | "synthetic_internal"
  | "experimental_real_data";
export type VerificationStatus =
  | "verified"
  | "synthetic_only"
  | "experimental_unverified"
  | "blocked";
export type RecommendationOutcome =
  | "definite"
  | "conditional"
  | "no_valid_plan"
  | "blocked";

export type SourceMaintenanceDecisionStatus =
  | "insufficient_data"
  | "green"
  | "amber"
  | "red";

export interface SourceMaintenanceStatus {
  readonly [key: string]: unknown;
  readonly status: SourceMaintenanceDecisionStatus;
  readonly rehearsal_version?: string;
  readonly cohort_hash?: string;
  readonly recorded_at?: string;
  readonly rationale?: readonly string[];
}

export interface FrozenLineItem {
  readonly [key: string]: unknown;
  readonly line_item_id?: string;
  readonly product_class: string;
  readonly amount_jpy: number;
  readonly quantity: number;
  readonly eligible_for_rewards?: boolean | null;
}

export interface FrozenComparisonFacts {
  readonly [key: string]: unknown;
  readonly merchant_id: string;
  readonly merchant_location_id: string;
  readonly amount_jpy: number;
  readonly channel: string;
  readonly interface: string;
  readonly line_items: readonly FrozenLineItem[];
  readonly merchant?: string | Readonly<Record<string, unknown>>;
  readonly location?: string | Readonly<Record<string, unknown>>;
  readonly amount?: number;
  readonly payment_channel?: string;
  readonly payment_interface?: string;
  readonly items?: readonly FrozenLineItem[];
}

export interface FreshnessInfo {
  readonly checked_at?: string;
  readonly source_ids?: readonly string[];
  readonly rule_valid_from?: Readonly<Record<string, string>>;
  readonly rule_valid_to?: Readonly<Record<string, string | null>>;
  readonly notes?: readonly string[];
}

export interface EvidenceReference {
  readonly evidence_id: string;
  readonly source_id?: string | null;
  readonly locator?: string | null;
  readonly captured_at?: string | null;
  readonly content_hash?: string | null;
}

export interface RecommendationRequest {
  readonly [key: string]: unknown;
  readonly version: RecommendationApiVersion;
  readonly request_id: string;
  readonly mode: RecommendationMode;
  /** Host-only admission marker for the bounded provisional experiment. */
  readonly experimental_rule_admission?: "unverified_host";
  /** Explicitly prevents implicit JPY valuation in the experimental lane. */
  readonly experimental_value_policy?: "unvalued";
  readonly transaction_time: string;
  readonly replay_knowledge_at: string;
  readonly timezone: "Asia/Tokyo";
  readonly source_maintenance_status:
    | SourceMaintenanceStatus
    | SourceMaintenanceDecisionStatus;
  readonly operational_source_maintenance_status?:
    | SourceMaintenanceStatus
    | SourceMaintenanceDecisionStatus;
  readonly merchant_query: MerchantQuery;
  readonly merchant_catalog: MerchantCatalog;
  readonly comparison:
    | FrozenComparisonFacts
    | Readonly<Record<string, unknown>>;
  readonly candidate_plans: readonly PurchasePlan[];
  readonly rules: readonly RewardRule[];
  readonly assets:
    | readonly AssetDefinition[]
    | Readonly<Record<string, AssetDefinition>>;
  readonly user_state: UserState;
  readonly opening_asset_lots?: readonly AssetLot[];
  readonly valuation_profile?: readonly ValuationEntry[];
  readonly objective: EngineObjective;
  readonly rule_assurances?: readonly RuleAssurance[];
  readonly freshness?: FreshnessInfo;
  readonly evidence_refs?: readonly EvidenceReference[];
  readonly assumptions?: readonly string[];
  readonly questions?: readonly string[];
  readonly feasible_states?: readonly FeasibleState[];
  readonly feasibleStates?: readonly FeasibleState[];
  /** Compatibility alias accepted by the pure adapter; canonical field remains comparison. */
  readonly frozen_comparison?: FrozenComparisonFacts;
  readonly frozen_comparison_facts?: FrozenComparisonFacts;
  readonly assurances?: readonly RuleAssurance[];
}

export interface PlanRejection {
  readonly code: string;
  readonly message: string;
  readonly operation_id?: string;
  readonly rule_id?: string;
}

export interface RecommendationPlan {
  readonly plan_id: string;
  readonly eligible: boolean;
  readonly operations: readonly Record<string, unknown>[];
  readonly principal_movements: readonly Record<string, unknown>[];
  readonly asset_movements: readonly Record<string, unknown>[];
  readonly rewards: readonly Record<string, unknown>[];
  readonly reward_components: readonly Record<string, unknown>[];
  readonly ending_assets: readonly Record<string, unknown>[];
  readonly ending_asset_lots: readonly Record<string, unknown>[];
  readonly economics: Record<string, unknown> | null;
  readonly objective_score_jpy: string | null;
  readonly applied_rule_ids: readonly string[];
  readonly rejected_rule_ids: readonly string[];
  readonly rejection_reasons: readonly PlanRejection[];
  readonly native_snapshot_hash: string | null;
}

export interface RecommendationReplayHashes {
  readonly contract_version: RecommendationApiVersion;
  readonly input_hash: string;
  readonly output_hash: string;
}

export interface RecommendationResponse {
  readonly version: RecommendationApiVersion;
  readonly request_id: string;
  readonly mode: RecommendationMode;
  readonly verification_status: VerificationStatus;
  readonly outcome: RecommendationOutcome;
  readonly winner_plan_id: string | null;
  readonly safe_plan_id: string | null;
  readonly runner_up_plan_id: string | null;
  readonly winner: RecommendationPlan | null;
  readonly safe_plan: RecommendationPlan | null;
  readonly runner_up: RecommendationPlan | null;
  readonly conditional_winners: readonly Record<string, unknown>[];
  readonly eligible_plans: readonly RecommendationPlan[];
  readonly rejected_plans: readonly RecommendationPlan[];
  readonly plans: readonly RecommendationPlan[];
  readonly merchant: ResolvedMerchant;
  readonly comparison: FrozenComparisonFacts;
  readonly assumptions: readonly string[];
  readonly questions: readonly string[];
  readonly freshness: FreshnessInfo;
  readonly evidence_refs: readonly EvidenceReference[];
  readonly valuation_sensitivities: readonly Record<string, unknown>[];
  readonly trust_assessments: readonly TrustAssessment[];
  readonly blockers: readonly string[];
  readonly replay: RecommendationReplayHashes;
}

/** Kept as a public alias for consumers that use the engine's terminology. */
export type PublicPlanResult = RecommendationPlan;
export type EnginePlanResult = ValuedPlanResult;
export type RecommendationInput = RecommendationRequest;
export type RecommendationResult = RecommendationResponse;
export type FrozenComparison = FrozenComparisonFacts;
export type { JpyValueRange };
