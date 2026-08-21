/**
 * Types used at the rule-engine boundary.  They intentionally mirror the
 * snake_case documents in `schemas/` while keeping calculated/native values
 * separate from candidate input documents.
 *
 * The contracts package owns structural/schema validation.  This package only
 * performs the graph and accounting invariants required at calculation time.
 */

export type RewardClass =
  | "normal"
  | "limited_period"
  | "usage_limited"
  | "merchant_limited"
  | "pending"
  | "promotional"
  | "other"
  | null;

export type AssetKind =
  | "fiat"
  | "reward_point"
  | "airline_mile"
  | "hotel_point"
  | "cashback"
  | "stored_value"
  | "voucher"
  | "discount"
  | "credit_limit"
  | "other";

export interface AssetRef {
  asset_id: string;
  asset_kind: AssetKind;
  program_id: string | null;
  reward_class: RewardClass;
  scale: number;
}

export interface Quantity {
  asset: AssetRef;
  amount: string;
}

export interface Settlement {
  status:
    | "pending"
    | "posted"
    | "available"
    | "reversed"
    | "expired"
    | "unknown";
  expected_posting_from: string | null;
  expected_posting_to: string | null;
  posted_at: string | null;
}

export interface Expiry {
  policy:
    | "none"
    | "fixed_date"
    | "relative_to_posting"
    | "provider_defined"
    | "unknown";
  expires_at: string | null;
  duration_days: number | null;
  timezone: string | null;
}

export interface UsageRestrictions {
  transferable: boolean | null;
  redeemable_for_cash: boolean | null;
  usable_for_payment: boolean | null;
  investable: boolean | null;
  permitted_destination_ids: string[];
  notes: string;
}

export interface ClawbackPolicy {
  on_refund: "none" | "proportional" | "full" | "provider_defined" | "unknown";
  posting_delay_days: number | null;
  notes: string;
}

export interface Certainty {
  type: "guaranteed" | "probabilistic" | "conditional_selection";
  probability: string | null;
  probability_source:
    | "official_disclosed"
    | "historical_estimate"
    | "undisclosed"
    | null;
}

export interface AssetDefinition {
  asset_id: string;
  asset_kind: AssetKind;
  display_name: string;
  program_id: string | null;
  scale: number;
  default_reward_class: RewardClass;
  default_expiry: Expiry;
  default_usage_restrictions: UsageRestrictions;
  status: "active" | "inactive" | "retired" | "synthetic";
  notes: string;
}

export interface AssetLot {
  lot_id: string;
  quantity: Quantity;
  acquired_at: string | null;
  source_operation_id: string | null;
  settlement: Settlement;
  expiry: Expiry;
  restrictions: UsageRestrictions;
  provenance_rule_ids: string[];
}

export interface AssetMovement {
  movement_id: string;
  operation_id: string;
  direction: "consume" | "create" | "return" | "expire";
  movement_role:
    | "external_funding"
    | "principal_tender"
    | "principal_output"
    | "fee"
    | "refund"
    | "reversal"
    | "transfer"
    | "redemption"
    | "other";
  quantity: Quantity;
  source_lot_id: string | null;
  destination_lot_id: string | null;
  notes: string;
}

export interface RewardComponent {
  component_id: string;
  operation_id: string;
  rule_id: string;
  sign: "credit" | "debit";
  quantity: Quantity;
  value_jpy: JpyValueRange;
  certainty: Certainty;
  settlement: Settlement;
  expiry: Expiry;
  restrictions: UsageRestrictions;
  clawback: ClawbackPolicy;
  calculation_trace: {
    eligible_basis: string;
    rounding_stage: string;
    [key: string]: unknown;
  };
}

export interface JpyValueRange {
  minimum_jpy: number | string;
  maximum_jpy: number | string;
  expected_jpy: number | string | null;
}

export type OperationType =
  | "merchant_purchase"
  | "stored_value_top_up"
  | "voucher_purchase"
  | "point_transfer"
  | "point_redemption"
  | "refund"
  | "reversal"
  | "portal_clickout";

export type Channel =
  | "in_store"
  | "online"
  | "mobile_order"
  | "delivery"
  | "drive_through"
  | "in_app"
  | "portal_clickout"
  | "transfer"
  | "not_applicable";

export type Interface =
  | "physical_card"
  | "magstripe"
  | "chip"
  | "contactless_card"
  | "mobile_contactless"
  | "qr_code"
  | "barcode"
  | "merchant_app"
  | "provider_app"
  | "web_checkout"
  | "portal_redirect"
  | "cash"
  | "manual_transfer"
  | "automatic"
  | "not_applicable";

export interface LineItem {
  line_item_id: string;
  product_class: string;
  amount_jpy: number;
  tax_exclusive_amount_jpy?: number | null;
  quantity: number;
  eligible_for_rewards: boolean | null;
}

export interface AssetInput {
  input_id: string;
  source_lot_id: string | null;
  quantity: Quantity;
  role:
    | "external_funding"
    | "stored_value_tender"
    | "points_tender"
    | "transfer_source"
    | "redemption_source"
    | "fee"
    | "refund_source"
    | "other";
}

export interface OutputRequest {
  request_id: string;
  created_lot_id: string;
  asset: AssetRef;
  requested_amount: string | null;
  role:
    | "stored_value"
    | "voucher"
    | "transfer_destination"
    | "redemption_destination"
    | "refund"
    | "other";
}

export interface Operation {
  operation_id: string;
  sequence: number;
  occurred_at: string;
  operation_type: OperationType;
  merchant_id: string | null;
  merchant_location_id: string | null;
  channel: Channel;
  interface: Interface;
  payment_instrument_id: string | null;
  funding_source_id: string | null;
  amount_jpy: number | null;
  asset_inputs: AssetInput[];
  output_requests: OutputRequest[];
  original_operation_id: string | null;
  portal_id: string | null;
  line_items: LineItem[];
  notes: string;
}

export interface Dependency {
  from_operation_id: string;
  to_operation_id: string;
  dependency_type: "funds" | "eligibility" | "attribution";
}

export interface LoyaltyPresentment {
  operation_id: string;
  loyalty_program_id: string;
  interface: Interface;
  presentation_mode: "manual" | "linked" | "automatic";
  sequence: number;
}

export interface PurchasePlan {
  plan_id: string;
  operations: Operation[];
  dependencies: Dependency[];
  loyalty_presentments: LoyaltyPresentment[];
  assumptions: string[];
}

export interface StateValue {
  status: "known" | "estimated" | "unknown" | "not_applicable";
  value?: unknown;
  lower_bound?: number | string | null;
  upper_bound?: number | string | null;
  observed_at?: string | null;
  source:
    | "user_input"
    | "transaction_history"
    | "provider_api"
    | "inferred"
    | "manual_review"
    | "unknown";
  confidence?: string | null;
}

export interface CapProgressState {
  status: "known" | "estimated" | "unknown" | "not_applicable";
  eligible_spend_jpy_min?: number | null;
  eligible_spend_jpy_max?: number | null;
  reward_earned_units_min?: string | null;
  reward_earned_units_max?: string | null;
  period_start: string | null;
  period_end: string | null;
  observed_at?: string | null;
  source:
    | "user_input"
    | "transaction_history"
    | "provider_api"
    | "inferred"
    | "unknown";
}

export interface ValuationEntry {
  valuation_id?: string;
  asset_id: string;
  reward_class: RewardClass;
  expiry_horizon_days?: number | null;
  jpy_per_unit: string;
  basis?:
    | "face_value"
    | "user_preference"
    | "market_estimate"
    | "transfer_goal"
    | "restricted_value";
}

export interface UserState {
  owned_instrument_ids: string[];
  owned_loyalty_program_ids: string[];
  facts: Record<string, StateValue>;
  asset_lots: AssetLot[];
  valuation_profile: { version: string; entries: ValuationEntry[] };
  cap_progress: Record<string, CapProgressState>;
}

export interface RuleScope {
  countries: string[];
  operation_types: OperationType[];
  merchant_ids?: string[];
  excluded_merchant_ids?: string[];
  merchant_group_ids?: string[];
  excluded_merchant_group_ids?: string[];
  merchant_location_ids?: string[];
  excluded_merchant_location_ids?: string[];
  merchant_category_codes?: string[];
  excluded_merchant_category_codes?: string[];
  channels: Channel[];
  included_product_classes?: string[];
  excluded_product_classes?: string[];
  tax_basis?: string;
}

export interface OperationMatch {
  required_loyalty_program_ids?: string[];
  allowed_payment_instrument_ids?: string[];
  excluded_payment_instrument_ids?: string[];
  allowed_payment_instrument_types?: string[];
  allowed_funding_source_ids?: string[];
  excluded_funding_source_ids?: string[];
  allowed_source_asset_ids?: string[];
  excluded_source_asset_ids?: string[];
  allowed_destination_asset_ids?: string[];
  required_interfaces?: Interface[];
  excluded_interfaces?: Interface[];
  must_present_before_payment?: boolean;
}

export interface UserCondition {
  fact_key: string;
  operator:
    | "eq"
    | "neq"
    | "in"
    | "not_in"
    | "gte"
    | "lte"
    | "exists"
    | "not_exists";
  value: unknown;
  unknown_policy:
    | "return_conditional"
    | "ask_user"
    | "suppress_rule"
    | "use_lower_bound";
}

export interface RuleEligibility {
  operation_match: OperationMatch;
  user_conditions: UserCondition[];
  transaction_conditions: {
    minimum_amount_jpy?: number | null;
    maximum_amount_jpy?: number | null;
    eligible_amount_basis?: string;
    excluded_tender_components?: string[];
    requires_single_operation?: boolean;
  };
  campaign_conditions: {
    campaign_id?: string | null;
    entry_required?: boolean;
    entry_deadline?: string | null;
    targeted_offer?: boolean;
    identity_verification_required?: boolean;
    first_use_only?: boolean;
  };
}

export interface Rounding {
  aggregation_scope:
    | "per_line_item"
    | "per_operation"
    | "per_day"
    | "per_statement"
    | "per_campaign_period"
    | "transfer_request";
  eligible_spend_quantum_jpy?: number | null;
  reward_rounding_mode: "floor" | "ceil" | "half_up" | "exact";
}

export interface PercentageCalculation {
  model: "percentage";
  rate_basis_points: number;
  rounding: Rounding;
  base_reward_included?: boolean;
}

export interface PointsPerUnitCalculation {
  model: "points_per_unit";
  reward_units: string;
  spend_jpy: number;
  rounding: Rounding;
  base_reward_included?: boolean;
}

export interface FixedCalculation {
  model: "fixed";
  reward_units: string;
  rounding: Rounding;
}

export type TierAward =
  | { model: "percentage"; rate_basis_points: number }
  | { model: "fixed"; reward_units: string }
  | { model: "points_per_unit"; reward_units: string; spend_jpy: number };

export interface TieredCalculation {
  model: "tiered";
  tier_basis: {
    source:
      | "transaction_amount"
      | "user_fact"
      | "period_aggregate"
      | "event_counter";
    key: string;
    period:
      | null
      | "current_day"
      | "current_month"
      | "previous_month"
      | "current_year"
      | "membership_year"
      | "campaign_period";
  };
  tiers: [
    {
      operator: "eq" | "in" | "gte" | "range";
      value: unknown;
      award: TierAward;
    },
    ...{
      operator: "eq" | "in" | "gte" | "range";
      value: unknown;
      award: TierAward;
    }[],
  ];
  rounding: Rounding;
}

export interface MultiplierCalculation {
  model: "multiplier";
  multiplier_milli: number;
  applies_to_stack_group: string;
  rounding: Rounding;
}

export interface TransferCalculation {
  model: "transfer_ratio";
  source_asset: AssetRef;
  destination_asset: AssetRef;
  source_units: string;
  destination_units: string;
  minimum_source_units: string | null;
  increment_source_units: string | null;
  maximum_source_units_per_request: string | null;
  maximum_source_units_per_period: string | null;
  maximum_period:
    | null
    | "day"
    | "month"
    | "year"
    | "campaign_period"
    | "lifetime";
  fee: Quantity | null;
  rounding: Rounding;
  processing_time_days_min: number | null;
  processing_time_days_max: number | null;
  cancellation_policy:
    | "not_cancelable"
    | "cancelable_before_posting"
    | "provider_defined"
    | "unknown";
  bonus_rule_ids?: string[];
}

export type Calculation =
  | PercentageCalculation
  | PointsPerUnitCalculation
  | FixedCalculation
  | TieredCalculation
  | MultiplierCalculation
  | TransferCalculation;

export interface RuleOutput {
  asset: AssetRef;
  sign: "credit" | "debit";
  certainty: Certainty;
  settlement: Settlement;
  expiry: Expiry;
  restrictions: UsageRestrictions;
  clawback: ClawbackPolicy;
}

export interface NonFinancialEffect {
  decision: "allow" | "deny";
  effect_target:
    | "operation_eligibility"
    | "reward_earning"
    | "tier_progress"
    | "campaign_progress"
    | "transfer_eligibility"
    | "asset_use";
  target_rule_ids: string[];
  target_stack_groups: string[];
  reason_code: string;
}

export interface RuleCap {
  cap_id: string;
  cap_type:
    | "per_operation"
    | "per_day"
    | "per_month"
    | "per_campaign"
    | "per_year"
    | "lifetime";
  max_reward_units: string | null;
  max_eligible_spend_jpy: number | null;
  shared_cap_group: string | null;
  progress_source:
    | "not_required"
    | "user_input"
    | "transaction_aggregation"
    | "provider_api"
    | "unknown";
  reset: {
    period: "operation" | "day" | "month" | "campaign" | "year" | "never";
    timezone: string;
    boundary:
      | "calendar"
      | "anniversary"
      | "campaign_defined"
      | "not_applicable";
  };
  partial_consumption: boolean;
  unknown_progress_policy:
    | "return_range"
    | "ask_user"
    | "suppress_bonus"
    | "use_lower_bound"
    | "not_applicable";
}

export interface RuleStacking {
  stack_group: string;
  mode:
    | "additive"
    | "replaces_group"
    | "best_of_group"
    | "includes_base"
    | "non_reward_acceptance";
  precedence: number;
  conflicts_with_rule_ids: string[];
  requires_rule_ids: string[];
  notes?: string;
}

export interface RuleValidity {
  announced_at?: string | null;
  valid_from: string;
  valid_to: string | null;
  timezone: "Asia/Tokyo" | string;
  recorded_at: string;
  superseded_at: string | null;
}

export interface RuleAudit {
  created_at: string;
  created_by: string;
  review_events: ReviewEvent[];
  required_review_modes: ReviewMode[];
  review_mode: ReviewMode | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  change_reason: string;
}

export interface RuleProvenance {
  evidence_ids: string[];
  minimum_source_tier: string;
  confidence: number;
  human_verified: boolean;
  review_notes?: string;
}

export interface RewardRule {
  rule_id: string;
  version: number;
  status:
    | "draft"
    | "under_review"
    | "published"
    | "superseded"
    | "retired"
    | "rejected";
  rule_type: string;
  name: string;
  description?: string;
  subject: { entity_type: string; entity_id: string };
  scope: RuleScope;
  eligibility: RuleEligibility;
  effect?: NonFinancialEffect;
  calculation?: Calculation;
  output?: RuleOutput;
  caps: RuleCap[];
  stacking: RuleStacking;
  validity: RuleValidity;
  provenance: RuleProvenance;
  audit: RuleAudit;
}

export type ReviewMode =
  | "solo_dual_pass"
  | "agent_challenged"
  | "human_second_review"
  | "expert_review";

export interface ReviewEvent {
  mode: ReviewMode;
  reviewer_id: string;
  completed_at: string;
  decision: "approved" | "rejected" | "needs_more_evidence";
  notes: string;
}

export type RejectionCode =
  | "invalid_plan"
  | "duplicate_operation_id"
  | "duplicate_sequence"
  | "dependency_missing"
  | "dependency_not_prior"
  | "timestamp_backwards"
  | "duplicate_asset_input_id"
  | "duplicate_output_request_id"
  | "calculated_field_supplied"
  | "asset_lot_missing"
  | "asset_lot_not_yet_created"
  | "asset_expired"
  | "asset_restricted"
  | "insufficient_asset_quantity"
  | "funding_amount_mismatch"
  | "tender_amount_mismatch"
  | "external_funding_source_lot"
  | "unfunded_output"
  | "unsupported_operation_type"
  | "no_matching_rule"
  | "rule_not_approved"
  | "rule_outside_scope"
  | "rule_excluded"
  | "rule_condition_failed"
  | "rule_condition_unknown"
  | "unsupported_calculation"
  | "unsupported_aggregation_scope"
  | "conservation_failed"
  | "reconciliation_failed"
  | "valuation_missing"
  | "ambiguous_bitemporal_replay";

export interface Rejection {
  code: RejectionCode | string;
  message: string;
  operation_id?: string;
  rule_id?: string;
}

export interface NativePlanResult {
  plan_id: string;
  eligible: boolean;
  operations: Operation[];
  asset_movements: AssetMovement[];
  reward_components: RewardComponent[];
  ending_asset_lots: AssetLot[];
  applied_rule_ids: string[];
  rejected_rule_ids: string[];
  rejection_reasons: Rejection[];
  external_funding_jpy: bigint;
  merchant_value_jpy: bigint;
  opening_asset_units_consumed: NativeQuantity[];
  native_snapshot: string;
}

export interface NativeQuantity {
  asset_id: string;
  reward_class: RewardClass;
  scale: number;
  units: bigint;
}

export interface EconomicSummary {
  merchant_value_received_jpy: DecimalValueRange;
  external_funding_jpy: DecimalValueRange;
  opening_asset_value_consumed_jpy: DecimalValueRange;
  ending_asset_value_jpy: DecimalValueRange;
  guaranteed_reward_value_jpy: DecimalValueRange;
  probabilistic_expected_reward_value_jpy: DecimalValueRange;
  fee_value_jpy: DecimalValueRange;
  guaranteed_net_value_change_jpy: DecimalValueRange;
  expected_net_value_change_jpy: DecimalValueRange;
}

export interface DecimalValueRange {
  minimum_jpy: string;
  maximum_jpy: string;
  expected_jpy: string | null;
}

export interface ValuedRewardComponent extends RewardComponent {
  value_jpy_decimal: string;
}

export interface ValuedPlanResult
  extends Omit<NativePlanResult, "reward_components"> {
  reward_components: ValuedRewardComponent[];
  economics: EconomicSummary;
  objective_score_jpy: string;
  native_snapshot: string;
}

export interface EngineObjective {
  primary?:
    | "maximize_guaranteed_net_value"
    | "maximize_expected_net_value"
    | "minimize_net_cost"
    | "maximize_destination_value";
  probabilistic_reward_policy?:
    | "guaranteed_only"
    | "expected_if_official_probability"
    | "include_user_estimate";
  ending_asset_valuation?: "use_user_profile" | "face_value" | "exclude";
  tie_breakers?: string[];
}

export interface EngineContext {
  rules?: RewardRule[];
  assets?: AssetDefinition[] | Record<string, AssetDefinition>;
  user_state?: UserState;
  opening_asset_lots?: AssetLot[];
  valuation_profile?: ValuationEntry[];
  transaction_time?: string;
  replay_knowledge_at?: string;
  objective?: EngineObjective;
}

export interface ValuationSensitivity {
  asset_id: string;
  reward_class: RewardClass;
  current_jpy_per_unit: string;
  break_even_jpy_per_unit: string;
  winner_at_or_below_threshold_plan_id: string;
  winner_above_threshold_plan_id: string;
}

export interface ConditionalWinner {
  plan_id: string;
  conditions: string[];
  value_range_jpy: DecimalValueRange;
}

export interface ResolutionQuestion {
  fact_key: string;
  question: string;
  could_change_winner: boolean;
}

export interface Recommendation {
  winner: ValuedPlanResult | null;
  runner_up: ValuedPlanResult | null;
  plans: ValuedPlanResult[];
  valuation_sensitivities: ValuationSensitivity[];
  outcome_mode?: "definite" | "conditional" | "no_valid_plan";
  definite_winner_plan_id?: string | null;
  safe_plan_id?: string | null;
  conditional_winners?: ConditionalWinner[];
  questions_to_resolve?: ResolutionQuestion[];
  explanation_tokens?: string[];
  replay: ReplayRecord;
  synthetic?: boolean;
}

export interface ReplayRecord {
  contract_version: string;
  engine_version: string;
  input_hash: string;
  canonical_input: string;
  canonical_output: string;
}
