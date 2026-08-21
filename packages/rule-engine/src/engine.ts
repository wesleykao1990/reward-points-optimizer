import { validateDocument as validateContractDocument } from "@jro/contracts";
import type { Decimal } from "decimal.js";
import { selectApprovedRules } from "./bitemporal.js";
import {
  evaluateFixedReward,
  evaluateMultiplierReward,
  evaluateTieredReward,
  evaluateTransfer,
} from "./m1b-calculations.js";
import { evaluateCaps } from "./m1b-caps.js";
import {
  calculateRefundAdjustment,
  calculateReversalAdjustment,
  lifecycleTargetFromRewardComponent,
} from "./m1b-lifecycle.js";
import { resolveStacking } from "./m1b-stacking.js";
import {
  evaluateFeasibleStates,
  type FeasibleState,
} from "./m1b-uncertainty.js";
import {
  amountFromUnits,
  calculatePercentage,
  calculatePointsPerUnit,
  canonicalHash,
  canonicalize,
  D,
  decimal,
  formatRatio,
  parseTime,
  power10,
  trimDecimal,
  unitsFromAmount,
  valueOfUnits,
} from "./math.js";
import type {
  AssetDefinition,
  AssetLot,
  AssetMovement,
  AssetRef,
  CapProgressState,
  EconomicSummary,
  EngineContext,
  EngineObjective,
  Expiry,
  JpyValueRange,
  NativePlanResult,
  NativeQuantity,
  Operation,
  PurchasePlan,
  Quantity,
  Recommendation,
  Rejection,
  RewardClass,
  RewardComponent,
  RewardRule,
  Settlement,
  StateValue,
  UsageRestrictions,
  UserCondition,
  UserState,
  ValuationEntry,
  ValuationSensitivity,
  ValuedPlanResult,
  ValuedRewardComponent,
} from "./types.js";
import {
  SemanticValidationError,
  validateConservation,
  validatePurchasePlan,
} from "./validation.js";

const ZERO = new D(0);
const ONE = new D(1);
const ENGINE_VERSION = "0.4.1-m1b";

interface MutableLot {
  lot: AssetLot;
  units: bigint;
  scale: number;
  createdInPlan: boolean;
}

interface InternalContext {
  rules: RewardRule[];
  assetDefinitions: Map<string, AssetDefinition>;
  openingLots: AssetLot[];
  valuation: Map<string, string>;
  transactionTime: string;
  replayKnowledgeAt: string;
  objective: Required<EngineObjective>;
  facts: Record<string, StateValue>;
  capProgress: Record<string, CapProgressState>;
}

interface NativeLedger {
  movements: AssetMovement[];
  rewards: RewardComponent[];
  endingLots: AssetLot[];
  appliedRuleIds: string[];
  rejectedRuleIds: string[];
  rejections: Rejection[];
  externalFundingJpy: bigint;
  merchantValueJpy: bigint;
  openingConsumed: NativeQuantity[];
  fees: NativeQuantity[];
}

export interface EvaluatePlanOptions extends EngineContext {
  /** Alias accepted by callers that use the direct rule-engine vocabulary. */
  openingLots?: AssetLot[];
  ruleset?: RewardRule[];
  valuation?: ValuationEntry[];
  transactionTime?: string;
  replayKnowledgeTime?: string;
  /** Explicit, mutually compatible state assignments for conditional ranking. */
  feasibleStates?: readonly FeasibleState[];
}

function defaultSettlement(): Settlement {
  return {
    status: "posted",
    expected_posting_from: null,
    expected_posting_to: null,
    posted_at: null,
  };
}

function defaultExpiry(): Expiry {
  return {
    policy: "none",
    expires_at: null,
    duration_days: null,
    timezone: null,
  };
}

function defaultRestrictions(): UsageRestrictions {
  return {
    transferable: null,
    redeemable_for_cash: null,
    usable_for_payment: true,
    investable: null,
    permitted_destination_ids: [],
    notes: "",
  };
}

function defaultAssetRef(
  assetId: string,
  scale = 0,
  rewardClass: RewardClass = null,
): AssetRef {
  return {
    asset_id: assetId,
    asset_kind: "other",
    program_id: null,
    reward_class: rewardClass,
    scale,
  };
}

function quantityUnits(quantity: Quantity): bigint {
  return unitsFromAmount(quantity.amount, quantity.asset.scale, "exact");
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function key(assetId: string, rewardClass: RewardClass): string {
  return `${assetId}::${rewardClass ?? "<none>"}`;
}

function quantityKey(quantity: Quantity): string {
  return key(quantity.asset.asset_id, quantity.asset.reward_class);
}

function assetRefEqual(left: AssetRef, right: AssetRef): boolean {
  return (
    left.asset_id === right.asset_id &&
    left.asset_kind === right.asset_kind &&
    left.program_id === right.program_id &&
    left.reward_class === right.reward_class &&
    left.scale === right.scale
  );
}

function quantityFromUnits(asset: AssetRef, units: bigint): Quantity {
  return { asset: clone(asset), amount: amountFromUnits(units, asset.scale) };
}

function assetDefinitionsById(
  context: EvaluatePlanOptions,
): Map<string, AssetDefinition> {
  const map = new Map<string, AssetDefinition>();
  const definitions = context.assets;
  if (Array.isArray(definitions))
    for (const definition of definitions)
      map.set(definition.asset_id, clone(definition));
  if (definitions && !Array.isArray(definitions))
    for (const [assetId, definition] of Object.entries(definitions))
      map.set(assetId, clone(definition));
  return map;
}

function valuationEntries(context: EvaluatePlanOptions): ValuationEntry[] {
  if (context.valuation) return context.valuation.map(clone);
  if (context.valuation_profile) return context.valuation_profile.map(clone);
  return context.user_state?.valuation_profile.entries.map(clone) ?? [];
}

function makeInternalContext(
  context: EvaluatePlanOptions = {},
): InternalContext {
  const objective: Required<EngineObjective> = {
    primary: context.objective?.primary ?? "maximize_guaranteed_net_value",
    probabilistic_reward_policy:
      context.objective?.probabilistic_reward_policy ?? "guaranteed_only",
    ending_asset_valuation:
      context.objective?.ending_asset_valuation ?? "use_user_profile",
    tie_breakers: context.objective?.tie_breakers ?? [
      "lower_external_funding",
      "fewer_operations",
    ],
  };
  const openingLots = clone(
    context.opening_asset_lots ??
      context.openingLots ??
      context.user_state?.asset_lots ??
      [],
  );
  const valuation = new Map<string, string>();
  for (const entry of valuationEntries(context)) {
    // Exact class entries take precedence over a class-less fallback.
    valuation.set(key(entry.asset_id, entry.reward_class), entry.jpy_per_unit);
  }
  return {
    rules: clone(context.rules ?? context.ruleset ?? []),
    assetDefinitions: assetDefinitionsById(context),
    openingLots,
    valuation,
    transactionTime:
      context.transaction_time ??
      context.transactionTime ??
      "1970-01-01T00:00:00Z",
    replayKnowledgeAt:
      context.replay_knowledge_at ??
      context.replayKnowledgeTime ??
      context.transaction_time ??
      context.transactionTime ??
      "1970-01-01T00:00:00Z",
    objective,
    facts: clone(context.user_state?.facts ?? {}),
    capProgress: clone(context.user_state?.cap_progress ?? {}),
  };
}

function assetDefinitionFor(
  asset: AssetRef,
  context: InternalContext,
): AssetDefinition | undefined {
  return context.assetDefinitions.get(asset.asset_id);
}

function lotFromRequest(
  operation: Operation,
  request: Operation["output_requests"][number],
  units: bigint,
  context: InternalContext,
  ruleIds: string[],
): MutableLot {
  const definition = assetDefinitionFor(request.asset, context);
  const lot: AssetLot = {
    lot_id: request.created_lot_id,
    quantity: quantityFromUnits(request.asset, units),
    acquired_at: operation.occurred_at,
    source_operation_id: operation.operation_id,
    settlement: definition?.default_expiry
      ? defaultSettlement()
      : defaultSettlement(),
    expiry: definition?.default_expiry
      ? clone(definition.default_expiry)
      : defaultExpiry(),
    restrictions: definition?.default_usage_restrictions
      ? clone(definition.default_usage_restrictions)
      : defaultRestrictions(),
    provenance_rule_ids: [...new Set(ruleIds)].sort(),
  };
  return { lot, units, scale: request.asset.scale, createdInPlan: true };
}

function addRejection(ledger: NativeLedger, rejection: Rejection): void {
  ledger.rejections.push(rejection);
  if (rejection.rule_id && !ledger.rejectedRuleIds.includes(rejection.rule_id))
    ledger.rejectedRuleIds.push(rejection.rule_id);
}

function addAppliedRule(ledger: NativeLedger, ruleId: string): void {
  if (!ledger.appliedRuleIds.includes(ruleId))
    ledger.appliedRuleIds.push(ruleId);
}

function compareStringLists(
  required: readonly string[] | undefined,
  actual: readonly string[],
): string | null {
  if (!required || required.length === 0) return null;
  const set = new Set(actual);
  const missing = required.find((value) => !set.has(value));
  return missing ? `missing:${missing}` : null;
}

function ruleMatchesOperation(
  rule: RewardRule,
  operation: Operation,
  plan: PurchasePlan,
  context: InternalContext,
): string | null {
  if (!rule.scope.operation_types.includes(operation.operation_type))
    return "operation_type_outside_scope";
  if (
    !rule.scope.channels.includes(operation.channel) &&
    !rule.scope.channels.includes("not_applicable")
  )
    return "channel_outside_scope";
  if (
    rule.scope.merchant_ids &&
    rule.scope.merchant_ids.length > 0 &&
    (!operation.merchant_id ||
      !rule.scope.merchant_ids.includes(operation.merchant_id))
  )
    return "merchant_outside_scope";
  if (rule.scope.excluded_merchant_ids?.includes(operation.merchant_id ?? ""))
    return "merchant_excluded";
  if (
    rule.scope.merchant_location_ids &&
    rule.scope.merchant_location_ids.length > 0 &&
    (!operation.merchant_location_id ||
      !rule.scope.merchant_location_ids.includes(
        operation.merchant_location_id,
      ))
  )
    return "location_outside_scope";
  if (
    rule.scope.excluded_merchant_location_ids?.includes(
      operation.merchant_location_id ?? "",
    )
  )
    return "location_excluded";
  const includedProducts = rule.scope.included_product_classes ?? [];
  const excludedProducts = new Set(rule.scope.excluded_product_classes ?? []);
  if (
    operation.line_items.some((item) =>
      excludedProducts.has(item.product_class),
    )
  )
    return "product_excluded";
  if (
    includedProducts.length > 0 &&
    !operation.line_items.some((item) =>
      includedProducts.includes(item.product_class),
    )
  )
    return "product_outside_scope";

  const match = rule.eligibility.operation_match;
  if (
    match.allowed_payment_instrument_ids &&
    match.allowed_payment_instrument_ids.length > 0 &&
    (!operation.payment_instrument_id ||
      !match.allowed_payment_instrument_ids.includes(
        operation.payment_instrument_id,
      ))
  )
    return "payment_instrument_not_allowed";
  if (
    match.excluded_payment_instrument_ids?.includes(
      operation.payment_instrument_id ?? "",
    )
  )
    return "payment_instrument_excluded";
  if (
    match.allowed_funding_source_ids &&
    match.allowed_funding_source_ids.length > 0 &&
    (!operation.funding_source_id ||
      !match.allowed_funding_source_ids.includes(operation.funding_source_id))
  )
    return "funding_source_not_allowed";
  if (
    match.excluded_funding_source_ids?.includes(
      operation.funding_source_id ?? "",
    )
  )
    return "funding_source_excluded";
  if (
    match.required_interfaces &&
    match.required_interfaces.length > 0 &&
    !match.required_interfaces.includes(operation.interface)
  )
    return "interface_not_allowed";
  if (match.excluded_interfaces?.includes(operation.interface))
    return "interface_excluded";
  const presentments = plan.loyalty_presentments
    .filter(
      (presentment) =>
        presentment.operation_id === operation.operation_id &&
        presentment.sequence <= operation.sequence,
    )
    .map((presentment) => presentment.loyalty_program_id);
  const missingProgram = compareStringLists(
    match.required_loyalty_program_ids,
    presentments,
  );
  if (missingProgram) return `loyalty_presentment_${missingProgram}`;
  const sourceAssetIds = operation.asset_inputs.map(
    (input) => input.quantity.asset.asset_id,
  );
  const destinationAssetIds = operation.output_requests.map(
    (request) => request.asset.asset_id,
  );
  if (
    match.allowed_source_asset_ids &&
    match.allowed_source_asset_ids.length > 0 &&
    !sourceAssetIds.some((assetId) =>
      match.allowed_source_asset_ids?.includes(assetId),
    )
  )
    return "source_asset_not_allowed";
  if (
    match.excluded_source_asset_ids?.some((assetId) =>
      sourceAssetIds.includes(assetId),
    )
  )
    return "source_asset_excluded";
  if (
    match.allowed_destination_asset_ids &&
    match.allowed_destination_asset_ids.length > 0 &&
    !destinationAssetIds.some((assetId) =>
      match.allowed_destination_asset_ids?.includes(assetId),
    )
  )
    return "destination_asset_not_allowed";

  const amount = operation.amount_jpy ?? 0;
  const conditions = rule.eligibility.transaction_conditions;
  if (
    conditions.minimum_amount_jpy !== undefined &&
    conditions.minimum_amount_jpy !== null &&
    amount < conditions.minimum_amount_jpy
  )
    return "amount_below_minimum";
  if (
    conditions.maximum_amount_jpy !== undefined &&
    conditions.maximum_amount_jpy !== null &&
    amount > conditions.maximum_amount_jpy
  )
    return "amount_above_maximum";
  const campaign = rule.eligibility.campaign_conditions;
  if (
    campaign.entry_deadline &&
    parseTime(operation.occurred_at) > parseTime(campaign.entry_deadline)
  )
    return "campaign_entry_deadline_passed";

  for (const condition of rule.eligibility.user_conditions) {
    const stateValue =
      context.openingLots.length >= 0
        ? contextUserFact(context, condition.fact_key)
        : undefined;
    if (
      !stateValue ||
      stateValue.status === "unknown" ||
      stateValue.status === "not_applicable"
    ) {
      if (condition.unknown_policy !== "use_lower_bound")
        return "user_condition_unknown";
      continue;
    }
    if (stateValue.status === "estimated") {
      if (condition.unknown_policy !== "use_lower_bound")
        return "user_condition_unknown";
    }
    if (
      !evaluateConditionValue(
        stateValue.value,
        condition.operator,
        condition.value,
      )
    )
      return "user_condition_failed";
  }
  return null;
}

/** User facts are carried on the internal context without making them part of native accounting. */
function contextUserFact(
  context: InternalContext,
  keyName: string,
): { status: string; value?: unknown } | undefined {
  // A non-enumerable side channel would make replay less transparent; use a
  // typed optional property attached by makeInternalContext instead.
  return context.facts[keyName];
}

function evaluateConditionValue(
  actual: unknown,
  operator: string,
  expected: unknown,
): boolean {
  switch (operator) {
    case "exists":
      return actual !== null && actual !== undefined;
    case "not_exists":
      return actual === null || actual === undefined;
    case "eq":
      return canonicalize(actual) === canonicalize(expected);
    case "neq":
      return canonicalize(actual) !== canonicalize(expected);
    case "in":
      return (
        Array.isArray(expected) &&
        expected.some((item) => canonicalize(item) === canonicalize(actual))
      );
    case "not_in":
      return (
        Array.isArray(expected) &&
        !expected.some((item) => canonicalize(item) === canonicalize(actual))
      );
    case "gte":
      return comparable(actual, expected) >= 0;
    case "lte":
      return comparable(actual, expected) <= 0;
    default:
      return false;
  }
}

function comparable(left: unknown, right: unknown): number {
  try {
    const l = decimal(String(left));
    const r = decimal(String(right));
    return l.comparedTo(r);
  } catch {
    const a = canonicalize(left);
    const b = canonicalize(right);
    return a < b ? -1 : a > b ? 1 : 0;
  }
}

function eligibleSpend(operation: Operation, rule: RewardRule): bigint {
  const basis =
    rule.eligibility.transaction_conditions.eligible_amount_basis ??
    "operation_amount";
  if (rule.scope.tax_basis === "tax_exclusive") {
    if (basis !== "eligible_line_items")
      throw new Error("tax_exclusive_basis_requires_eligible_line_items");
    return BigInt(
      operation.line_items
        .filter((line) => line.eligible_for_rewards !== false)
        .reduce((sum, line) => {
          const amount = line.tax_exclusive_amount_jpy;
          if (
            typeof amount !== "number" ||
            !Number.isSafeInteger(amount) ||
            amount < 0 ||
            amount > line.amount_jpy
          )
            throw new Error("tax_exclusive_amount_required");
          return sum + amount;
        }, 0),
    );
  }
  if (basis === "eligible_line_items") {
    return BigInt(
      operation.line_items
        .filter((line) => line.eligible_for_rewards !== false)
        .reduce((sum, line) => sum + line.amount_jpy, 0),
    );
  }
  return BigInt(operation.amount_jpy ?? 0);
}

function applySpendQuantum(
  spend: bigint,
  quantum: number | null | undefined,
): bigint {
  if (!quantum) return spend;
  const q = BigInt(quantum);
  return (spend / q) * q;
}

function calculateRewardUnits(
  rule: RewardRule,
  operation: Operation,
  context: InternalContext,
): { units: bigint; trace: Record<string, unknown> } | null {
  const calculation = rule.calculation;
  if (!calculation) return null;
  const spend = applySpendQuantum(
    eligibleSpend(operation, rule),
    calculation.rounding.eligible_spend_quantum_jpy,
  );
  const scale = rule.output?.asset.scale ?? 0;
  if (calculation.model === "percentage") {
    return {
      units: calculatePercentage(
        spend,
        calculation.rate_basis_points,
        scale,
        calculation.rounding.reward_rounding_mode,
      ),
      trace: {
        eligible_basis:
          rule.eligibility.transaction_conditions.eligible_amount_basis ??
          "operation_amount",
        rounding_stage: calculation.rounding.aggregation_scope,
        spend_jpy: spend.toString(),
        rate_basis_points: calculation.rate_basis_points,
      },
    };
  }
  if (calculation.model === "points_per_unit") {
    return {
      units: calculatePointsPerUnit(
        spend,
        calculation.reward_units,
        calculation.spend_jpy,
        scale,
        calculation.rounding.reward_rounding_mode,
      ),
      trace: {
        eligible_basis:
          rule.eligibility.transaction_conditions.eligible_amount_basis ??
          "operation_amount",
        rounding_stage: calculation.rounding.aggregation_scope,
        spend_jpy: spend.toString(),
        denominator_jpy: calculation.spend_jpy,
        reward_units: calculation.reward_units,
      },
    };
  }
  if (calculation.model === "fixed") {
    const result = evaluateFixedReward(calculation, {
      eligible_amount_jpy: spend.toString(),
      ...(rule.eligibility.transaction_conditions.minimum_amount_jpy ===
      undefined
        ? {}
        : {
            minimum_amount_jpy:
              rule.eligibility.transaction_conditions.minimum_amount_jpy,
          }),
      asset_scale: scale,
    });
    if (result.status === "rejected")
      throw new Error(
        result.conditions.map((condition) => condition.code).join(","),
      );
    return {
      units: result.units ?? 0n,
      trace: {
        eligible_basis:
          rule.eligibility.transaction_conditions.eligible_amount_basis ??
          "operation_amount",
        rounding_stage: calculation.rounding.aggregation_scope,
        spend_jpy: spend.toString(),
        threshold_jpy: result.threshold_jpy,
        calculation_model: "fixed",
      },
    };
  }
  if (calculation.model === "tiered") {
    const state =
      calculation.tier_basis.source === "transaction_amount"
        ? undefined
        : context.facts[calculation.tier_basis.key];
    const basisValue =
      calculation.tier_basis.source === "transaction_amount"
        ? operation.amount_jpy
        : state?.status === "known" || state?.status === "estimated"
          ? state.value
          : undefined;
    const result = evaluateTieredReward(calculation, {
      basis_value: basisValue,
      spend_jpy: spend.toString(),
      asset_scale: scale,
    });
    if (result.status === "rejected")
      throw new Error(
        result.conditions.map((condition) => condition.code).join(","),
      );
    return {
      units: result.units ?? 0n,
      trace: {
        eligible_basis: calculation.tier_basis.source,
        rounding_stage: calculation.rounding.aggregation_scope,
        spend_jpy: spend.toString(),
        tier_basis_key: calculation.tier_basis.key,
        tier_basis_value: result.basis_value,
        matched_tier_index: result.matched_tier_index,
        calculation_model: "tiered",
      },
    };
  }
  return null;
}

function valuePerUnit(
  context: InternalContext,
  asset: AssetRef,
  ending = false,
): string {
  const exact = context.valuation.get(key(asset.asset_id, asset.reward_class));
  const fallback = context.valuation.get(key(asset.asset_id, null));
  if (exact !== undefined) return exact;
  if (fallback !== undefined) return fallback;
  if (ending && context.objective.ending_asset_valuation === "exclude")
    return "0";
  // A unit valuation is explicit data in production.  The one-JPY fallback is
  // retained for synthetic fixtures and is replaced when a profile is given.
  return "1";
}

function rewardComponentFromRule(
  rule: RewardRule,
  operation: Operation,
  units: bigint,
  _context: InternalContext,
  componentIndex: number,
): RewardComponent {
  if (!rule.output) throw new Error("reward_output_missing");
  const output = rule.output;
  // Native calculation is intentionally valuation-free.  The contract keeps a
  // value field for a schema-complete component, but its canonical native
  // value is zero and is replaced in `valuedPlan` after all quantities/rules
  // are fixed.  This prevents a valuation profile from mutating replay input.
  const range: JpyValueRange = {
    minimum_jpy: "0",
    maximum_jpy: "0",
    expected_jpy: "0",
  };
  return {
    component_id: `cmp_${operation.operation_id.replace(/^op_/, "")}_${rule.rule_id.replace(/^rr_/, "")}_${componentIndex}`,
    operation_id: operation.operation_id,
    rule_id: rule.rule_id,
    sign: output.sign,
    quantity: quantityFromUnits(output.asset, units),
    value_jpy: range,
    certainty: clone(output.certainty),
    settlement: clone(output.settlement),
    expiry: clone(output.expiry),
    restrictions: clone(output.restrictions),
    clawback: clone(output.clawback),
    calculation_trace: { eligible_basis: "", rounding_stage: "" },
  };
}

function zeroLedger(): NativeLedger {
  return {
    movements: [],
    rewards: [],
    endingLots: [],
    appliedRuleIds: [],
    rejectedRuleIds: [],
    rejections: [],
    externalFundingJpy: 0n,
    merchantValueJpy: 0n,
    openingConsumed: [],
    fees: [],
  };
}

function reserveCapProgress(
  operationProgress: Record<string, CapProgressState>,
  planProgress: Record<string, CapProgressState>,
  caps: RewardRule["caps"],
  rewardAmount: string,
  eligibleSpendJpy: number,
): void {
  const capsByKey = new Map<string, RewardRule["caps"]>();
  for (const cap of caps) {
    const progressKey = cap.shared_cap_group ?? cap.cap_id;
    const grouped = capsByKey.get(progressKey) ?? [];
    grouped.push(cap);
    capsByKey.set(progressKey, grouped);
  }
  for (const [progressKey, groupedCaps] of capsByKey) {
    const firstCap = groupedCaps[0];
    if (!firstCap) continue;
    const previous =
      operationProgress[progressKey] ??
      operationProgress[firstCap.cap_id] ??
      null;
    if (previous?.status === "unknown") continue;
    const previousRewardMinimum = decimal(
      previous?.reward_earned_units_min ?? "0",
    );
    const previousRewardMaximum = decimal(
      previous?.reward_earned_units_max ??
        previous?.reward_earned_units_min ??
        "0",
    );
    const previousSpendMinimum = previous?.eligible_spend_jpy_min ?? 0;
    const previousSpendMaximum =
      previous?.eligible_spend_jpy_max ?? previousSpendMinimum;
    const reserved: CapProgressState = {
      status: previous?.status === "estimated" ? "estimated" : "known",
      reward_earned_units_min: trimDecimal(
        previousRewardMinimum.plus(rewardAmount).toString(),
      ),
      reward_earned_units_max: trimDecimal(
        previousRewardMaximum.plus(rewardAmount).toString(),
      ),
      eligible_spend_jpy_min: previousSpendMinimum + eligibleSpendJpy,
      eligible_spend_jpy_max: previousSpendMaximum + eligibleSpendJpy,
      period_start: previous?.period_start ?? null,
      period_end: previous?.period_end ?? null,
      observed_at: previous?.observed_at ?? null,
      source: previous?.source ?? "inferred",
    };
    operationProgress[progressKey] = reserved;
    if (
      groupedCaps.every(
        (cap) =>
          cap.cap_type !== "per_operation" && cap.reset.period !== "operation",
      )
    )
      planProgress[progressKey] = clone(reserved);
  }
}

function nativeQuantity(asset: AssetRef, units: bigint): NativeQuantity {
  return {
    asset_id: asset.asset_id,
    reward_class: asset.reward_class,
    scale: asset.scale,
    units,
  };
}

function addNativeQuantity(
  list: NativeQuantity[],
  asset: AssetRef,
  units: bigint,
): void {
  if (units === 0n) return;
  const existing = list.find(
    (item) =>
      item.asset_id === asset.asset_id &&
      item.reward_class === asset.reward_class &&
      item.scale === asset.scale,
  );
  if (existing) existing.units += units;
  else list.push(nativeQuantity(asset, units));
}

function movement(
  operation: Operation,
  direction: AssetMovement["direction"],
  role: AssetMovement["movement_role"],
  quantity: Quantity,
  sourceLotId: string | null,
  destinationLotId: string | null,
  index: number,
  notes: string,
): AssetMovement {
  return {
    movement_id: `mov_${operation.operation_id.replace(/^op_/, "")}_${index}`,
    operation_id: operation.operation_id,
    direction,
    movement_role: role,
    quantity: clone(quantity),
    source_lot_id: sourceLotId,
    destination_lot_id: destinationLotId,
    notes,
  };
}

function consumeLot(
  operation: Operation,
  input: Operation["asset_inputs"][number],
  lots: Map<string, MutableLot>,
  openingLotIds: Set<string>,
  ledger: NativeLedger,
  movementIndex: { value: number },
): boolean {
  if (!input.source_lot_id) {
    addRejection(ledger, {
      code: "asset_lot_missing",
      message: "reusable asset input requires a source lot",
      operation_id: operation.operation_id,
    });
    return false;
  }
  const current = lots.get(input.source_lot_id);
  if (!current) {
    addRejection(ledger, {
      code: "asset_lot_not_yet_created",
      message: `source lot ${input.source_lot_id} does not exist at this operation`,
      operation_id: operation.operation_id,
    });
    return false;
  }
  if (
    current.lot.quantity.asset.asset_id !== input.quantity.asset.asset_id ||
    current.lot.quantity.asset.reward_class !==
      input.quantity.asset.reward_class
  ) {
    addRejection(ledger, {
      code: "asset_lot_missing",
      message: "source lot asset/class does not match the input",
      operation_id: operation.operation_id,
    });
    return false;
  }
  try {
    const units = quantityUnits(input.quantity);
    if (units <= 0n || units > current.units) {
      addRejection(ledger, {
        code: "insufficient_asset_quantity",
        message: `source lot ${input.source_lot_id} has insufficient quantity`,
        operation_id: operation.operation_id,
      });
      return false;
    }
    if (
      current.lot.expiry.expires_at &&
      parseTime(operation.occurred_at) >=
        parseTime(current.lot.expiry.expires_at)
    ) {
      addRejection(ledger, {
        code: "asset_expired",
        message: `source lot ${input.source_lot_id} is expired`,
        operation_id: operation.operation_id,
      });
      return false;
    }
    if (
      current.lot.restrictions.usable_for_payment === false &&
      (input.role === "stored_value_tender" || input.role === "points_tender")
    ) {
      addRejection(ledger, {
        code: "asset_restricted",
        message: `source lot ${input.source_lot_id} cannot be used for payment`,
        operation_id: operation.operation_id,
      });
      return false;
    }
    current.units -= units;
    const consumedQuantity = quantityFromUnits(
      current.lot.quantity.asset,
      units,
    );
    ledger.movements.push(
      movement(
        operation,
        "consume",
        input.role === "fee"
          ? "fee"
          : input.role === "transfer_source"
            ? "transfer"
            : input.role === "redemption_source"
              ? "redemption"
              : input.role === "refund_source"
                ? "refund"
                : "principal_tender",
        consumedQuantity,
        input.source_lot_id,
        null,
        movementIndex.value++,
        "Consumed from an existing asset lot.",
      ),
    );
    if (openingLotIds.has(input.source_lot_id))
      addNativeQuantity(
        ledger.openingConsumed,
        current.lot.quantity.asset,
        units,
      );
    if (current.units === 0n) lots.delete(input.source_lot_id);
    else
      current.lot.quantity = quantityFromUnits(
        current.lot.quantity.asset,
        current.units,
      );
    return true;
  } catch (error) {
    addRejection(ledger, {
      code: "invalid_plan",
      message: error instanceof Error ? error.message : String(error),
      operation_id: operation.operation_id,
    });
    return false;
  }
}

function addOutput(
  operation: Operation,
  request: Operation["output_requests"][number],
  lots: Map<string, MutableLot>,
  externalFundingForOperation: bigint,
  ledger: NativeLedger,
  context: InternalContext,
  movementIndex: { value: number },
  ruleIds: string[],
): boolean {
  const requested =
    request.requested_amount ??
    (operation.amount_jpy === null ? null : operation.amount_jpy.toString());
  if (requested === null) {
    addRejection(ledger, {
      code: "unfunded_output",
      message: "output amount is not derivable",
      operation_id: operation.operation_id,
    });
    return false;
  }
  try {
    const units = unitsFromAmount(requested, request.asset.scale, "exact");
    if (units <= 0n) throw new Error("output_amount_must_be_positive");
    const amountJpy = decimal(requested);
    if (
      externalFundingForOperation === 0n ||
      amountJpy.gt(externalFundingForOperation.toString())
    ) {
      addRejection(ledger, {
        code: "unfunded_output",
        message: "principal output exceeds explicit external funding",
        operation_id: operation.operation_id,
      });
      return false;
    }
    if (lots.has(request.created_lot_id)) {
      addRejection(ledger, {
        code: "invalid_plan",
        message: `output lot ${request.created_lot_id} already exists`,
        operation_id: operation.operation_id,
      });
      return false;
    }
    const created = lotFromRequest(operation, request, units, context, ruleIds);
    lots.set(request.created_lot_id, created);
    ledger.movements.push(
      movement(
        operation,
        "create",
        "principal_output",
        created.lot.quantity,
        null,
        request.created_lot_id,
        movementIndex.value++,
        "Created a principal asset lot from explicit funding.",
      ),
    );
    return true;
  } catch (error) {
    addRejection(ledger, {
      code: "invalid_plan",
      message: error instanceof Error ? error.message : String(error),
      operation_id: operation.operation_id,
    });
    return false;
  }
}

function addDerivedOutput(
  operation: Operation,
  request: Operation["output_requests"][number],
  amount: string,
  lots: Map<string, MutableLot>,
  ledger: NativeLedger,
  context: InternalContext,
  movementIndex: { value: number },
  ruleIds: string[],
  direction: "create" | "return",
  role: "transfer" | "redemption" | "refund" | "reversal",
  settlement?: Settlement,
  ruleOutput?: NonNullable<RewardRule["output"]>,
): boolean {
  try {
    const units = unitsFromAmount(amount, request.asset.scale, "exact");
    if (units <= 0n) throw new Error("output_amount_must_be_positive");
    if (request.requested_amount !== null) {
      const requestedUnits = unitsFromAmount(
        request.requested_amount,
        request.asset.scale,
        "exact",
      );
      if (requestedUnits !== units)
        throw new Error("derived_output_amount_mismatch");
    }
    if (lots.has(request.created_lot_id))
      throw new Error(`output lot ${request.created_lot_id} already exists`);
    const created = lotFromRequest(operation, request, units, context, ruleIds);
    if (ruleOutput) {
      // AssetLot has no certainty/clawback fields. Preserve only the
      // representable output policy here; settlement below remains the
      // processing-time transfer result, not a caller-declared rule value.
      created.lot.expiry = clone(ruleOutput.expiry);
      created.lot.restrictions = clone(ruleOutput.restrictions);
    }
    if (settlement) created.lot.settlement = clone(settlement);
    lots.set(request.created_lot_id, created);
    ledger.movements.push(
      movement(
        operation,
        direction,
        role,
        created.lot.quantity,
        null,
        request.created_lot_id,
        movementIndex.value++,
        `${role} output derived from a reviewed Milestone 1B operation.`,
      ),
    );
    return true;
  } catch (error) {
    addRejection(ledger, {
      code: "invalid_plan",
      message: error instanceof Error ? error.message : String(error),
      operation_id: operation.operation_id,
    });
    return false;
  }
}

function pendingTransferSettlement(
  operation: Operation,
  minimumDays: number | null,
  maximumDays: number | null,
): Settlement {
  const occurred = parseTime(operation.occurred_at);
  const isoAfter = (days: number | null): string | null =>
    days === null ? null : new Date(occurred + days * 86_400_000).toISOString();
  return {
    status: "pending",
    expected_posting_from: isoAfter(minimumDays),
    expected_posting_to: isoAfter(maximumDays),
    posted_at: null,
  };
}

function processTransferOperation(
  operation: Operation,
  plan: PurchasePlan,
  context: InternalContext,
  lots: Map<string, MutableLot>,
  openingLotIds: Set<string>,
  ledger: NativeLedger,
  movementIndex: { value: number },
  visitedAssetIds: Set<string>,
): boolean {
  const selected = selectApprovedRules(
    context.rules,
    operation.occurred_at,
    context.replayKnowledgeAt,
  ).filter(
    (rule) =>
      rule.calculation?.model === "transfer_ratio" &&
      ruleMatchesOperation(rule, operation, plan, context) === null,
  );
  if (selected.length !== 1) {
    addRejection(ledger, {
      code:
        selected.length === 0
          ? "no_matching_rule"
          : "ambiguous_bitemporal_replay",
      message:
        selected.length === 0
          ? "transfer operation requires one applicable transfer-ratio rule"
          : "transfer operation matched multiple transfer-ratio rules",
      operation_id: operation.operation_id,
    });
    return false;
  }
  const rule = selected[0];
  if (!rule) return false;
  const calculation = rule.calculation;
  if (calculation?.model !== "transfer_ratio") return false;
  const sourceRole =
    operation.operation_type === "point_redemption"
      ? "redemption_source"
      : "transfer_source";
  const destinationRole =
    operation.operation_type === "point_redemption"
      ? "redemption_destination"
      : "transfer_destination";
  const sourceInputs = operation.asset_inputs.filter(
    (input) => input.role === sourceRole,
  );
  const feeInputs = operation.asset_inputs.filter(
    (input) => input.role === "fee",
  );
  const output = operation.output_requests[0];
  if (
    sourceInputs.length !== 1 ||
    !output ||
    operation.output_requests.length !== 1 ||
    output.role !== destinationRole ||
    feeInputs.length !== (calculation.fee === null ? 0 : 1) ||
    operation.asset_inputs.some(
      (input) => input.role !== sourceRole && input.role !== "fee",
    )
  ) {
    addRejection(ledger, {
      code: "invalid_plan",
      message:
        "transfer requires exactly one source input, one destination output, and the declared fee inputs",
      operation_id: operation.operation_id,
      rule_id: rule.rule_id,
    });
    return false;
  }
  const source = sourceInputs[0];
  const feeInput = feeInputs[0];
  if (!source || !output) return false;
  const sourceLot = source.source_lot_id
    ? lots.get(source.source_lot_id)
    : undefined;
  if (
    !assetRefEqual(source.quantity.asset, calculation.source_asset) ||
    !assetRefEqual(output.asset, calculation.destination_asset) ||
    !sourceLot ||
    !assetRefEqual(sourceLot.lot.quantity.asset, calculation.source_asset)
  ) {
    addRejection(ledger, {
      code: "rule_condition_failed",
      message: `${rule.rule_id}: transfer source or destination AssetRef mismatch`,
      operation_id: operation.operation_id,
      rule_id: rule.rule_id,
    });
    return false;
  }
  const feeLot = feeInput?.source_lot_id
    ? lots.get(feeInput.source_lot_id)
    : undefined;
  if (
    calculation.fee !== null &&
    (!feeInput ||
      !feeInput.source_lot_id ||
      !assetRefEqual(feeInput.quantity.asset, calculation.fee.asset) ||
      decimal(feeInput.quantity.amount).cmp(calculation.fee.amount) !== 0 ||
      !feeLot ||
      !assetRefEqual(feeLot.lot.quantity.asset, calculation.fee.asset))
  ) {
    addRejection(ledger, {
      code: "rule_condition_failed",
      message: `${rule.rule_id}: required transfer fee is missing or mismatched`,
      operation_id: operation.operation_id,
      rule_id: rule.rule_id,
    });
    return false;
  }
  if (
    rule.output &&
    (rule.output.sign !== "credit" ||
      !assetRefEqual(rule.output.asset, calculation.destination_asset))
  ) {
    addRejection(ledger, {
      code: "rule_condition_failed",
      message: `${rule.rule_id}: transfer rule output must credit the exact destination AssetRef`,
      operation_id: operation.operation_id,
      rule_id: rule.rule_id,
    });
    return false;
  }
  const transferLotIds = operation.asset_inputs.map(
    (input) => input.source_lot_id,
  );
  const nonNullTransferLotIds = transferLotIds.filter(
    (lotId): lotId is string => lotId !== null,
  );
  if (
    nonNullTransferLotIds.length !== transferLotIds.length ||
    new Set(nonNullTransferLotIds).size !== nonNullTransferLotIds.length
  ) {
    addRejection(ledger, {
      code: "invalid_plan",
      message: `${rule.rule_id}: transfer inputs must reference distinct reusable lots`,
      operation_id: operation.operation_id,
      rule_id: rule.rule_id,
    });
    return false;
  }
  for (const input of operation.asset_inputs) {
    const lotId = input.source_lot_id;
    const current = lotId === null ? undefined : lots.get(lotId);
    if (!current) {
      addRejection(ledger, {
        code: "asset_lot_not_yet_created",
        message: `${rule.rule_id}: transfer input source lot is unavailable`,
        operation_id: operation.operation_id,
        rule_id: rule.rule_id,
      });
      return false;
    }
    if (!assetRefEqual(current.lot.quantity.asset, input.quantity.asset)) {
      addRejection(ledger, {
        code: "asset_lot_missing",
        message: `${rule.rule_id}: transfer input source lot AssetRef mismatch`,
        operation_id: operation.operation_id,
        rule_id: rule.rule_id,
      });
      return false;
    }
    try {
      const units = quantityUnits(input.quantity);
      if (units <= 0n || units > current.units) {
        addRejection(ledger, {
          code: "insufficient_asset_quantity",
          message: `${rule.rule_id}: transfer input source lot has insufficient quantity`,
          operation_id: operation.operation_id,
          rule_id: rule.rule_id,
        });
        return false;
      }
      if (
        current.lot.expiry.expires_at &&
        parseTime(operation.occurred_at) >=
          parseTime(current.lot.expiry.expires_at)
      ) {
        addRejection(ledger, {
          code: "asset_expired",
          message: `${rule.rule_id}: transfer input source lot is expired`,
          operation_id: operation.operation_id,
          rule_id: rule.rule_id,
        });
        return false;
      }
    } catch (error) {
      addRejection(ledger, {
        code: "invalid_plan",
        message: error instanceof Error ? error.message : String(error),
        operation_id: operation.operation_id,
        rule_id: rule.rule_id,
      });
      return false;
    }
  }
  const periodState = context.facts[`transfer_period_used:${rule.rule_id}`];
  const periodUsed =
    periodState?.status === "known" || periodState?.status === "estimated"
      ? (periodState.value as string | number | bigint | undefined)
      : undefined;
  const settlement = pendingTransferSettlement(
    operation,
    calculation.processing_time_days_min,
    calculation.processing_time_days_max,
  );
  const transfer = evaluateTransfer(calculation, {
    source_amount: source.quantity.amount,
    ...(periodUsed === undefined ? {} : { period_source_used: periodUsed }),
    visited_asset_ids: [...visitedAssetIds],
    posting: settlement,
  });
  if (transfer.status !== "applied" || transfer.destination_amount === null) {
    addRejection(ledger, {
      code:
        transfer.status === "conditional"
          ? "rule_condition_unknown"
          : "rule_condition_failed",
      message: `${rule.rule_id}: ${transfer.reason_code ?? transfer.status}`,
      operation_id: operation.operation_id,
      rule_id: rule.rule_id,
    });
    return false;
  }
  let destinationUnits: bigint;
  try {
    destinationUnits = unitsFromAmount(
      transfer.destination_amount,
      output.asset.scale,
      "exact",
    );
    if (destinationUnits <= 0n)
      throw new Error("output_amount_must_be_positive");
    if (output.requested_amount !== null) {
      const requestedUnits = unitsFromAmount(
        output.requested_amount,
        output.asset.scale,
        "exact",
      );
      if (requestedUnits !== destinationUnits)
        throw new Error("derived_output_amount_mismatch");
    }
    if (lots.has(output.created_lot_id))
      throw new Error(`output lot ${output.created_lot_id} already exists`);
  } catch (error) {
    addRejection(ledger, {
      code: "invalid_plan",
      message: error instanceof Error ? error.message : String(error),
      operation_id: operation.operation_id,
      rule_id: rule.rule_id,
    });
    return false;
  }
  const lotsBefore = new Map<string, MutableLot>();
  for (const [lotId, entry] of lots.entries())
    lotsBefore.set(lotId, { ...entry, lot: clone(entry.lot) });
  const movementCountBefore = ledger.movements.length;
  const openingConsumedBefore = clone(ledger.openingConsumed);
  const movementIndexBefore = movementIndex.value;
  const rollbackTransfer = (): void => {
    lots.clear();
    for (const [lotId, entry] of lotsBefore.entries())
      lots.set(lotId, { ...entry, lot: clone(entry.lot) });
    ledger.movements.length = movementCountBefore;
    ledger.openingConsumed.splice(
      0,
      ledger.openingConsumed.length,
      ...openingConsumedBefore,
    );
    movementIndex.value = movementIndexBefore;
  };
  for (const input of operation.asset_inputs) {
    if (
      !consumeLot(operation, input, lots, openingLotIds, ledger, movementIndex)
    ) {
      rollbackTransfer();
      return false;
    }
  }
  const added = addDerivedOutput(
    operation,
    output,
    transfer.destination_amount,
    lots,
    ledger,
    context,
    movementIndex,
    [rule.rule_id],
    "create",
    operation.operation_type === "point_redemption" ? "redemption" : "transfer",
    settlement,
    rule.output,
  );
  if (!added) {
    rollbackTransfer();
    return false;
  }
  visitedAssetIds.add(calculation.source_asset.asset_id);
  addAppliedRule(ledger, rule.rule_id);
  return true;
}

function processLifecycleOperation(
  operation: Operation,
  plan: PurchasePlan,
  context: InternalContext,
  lots: Map<string, MutableLot>,
  ledger: NativeLedger,
  movementIndex: { value: number },
): boolean {
  const original = plan.operations.find(
    (candidate) => candidate.operation_id === operation.original_operation_id,
  );
  const output = operation.output_requests[0];
  if (
    !original ||
    original.sequence >= operation.sequence ||
    !output ||
    output.role !== "refund" ||
    operation.output_requests.length !== 1
  ) {
    addRejection(ledger, {
      code: "invalid_plan",
      message:
        "refund/reversal requires one earlier original operation and one return output",
      operation_id: operation.operation_id,
    });
    return false;
  }
  const amount =
    output.requested_amount ??
    (operation.amount_jpy === null ? null : operation.amount_jpy.toString());
  if (amount === null) {
    addRejection(ledger, {
      code: "invalid_plan",
      message: "refund/reversal amount is required",
      operation_id: operation.operation_id,
    });
    return false;
  }
  if (!decimal(amount).eq((operation.amount_jpy ?? -1).toString())) {
    addRejection(ledger, {
      code: "invalid_plan",
      message:
        "refund/reversal returned quantity must equal the declared operation amount",
      operation_id: operation.operation_id,
    });
    return false;
  }
  const originalAmount = original.amount_jpy;
  if (
    originalAmount === null ||
    operation.amount_jpy === null ||
    operation.amount_jpy <= 0 ||
    operation.amount_jpy > originalAmount ||
    (operation.operation_type === "reversal" &&
      operation.amount_jpy !== originalAmount)
  ) {
    addRejection(ledger, {
      code: "invalid_plan",
      message:
        "refund/reversal JPY amount must be positive and no greater than the original operation",
      operation_id: operation.operation_id,
    });
    return false;
  }
  const matchingTender = original.asset_inputs.filter(
    (input) =>
      input.role !== "fee" &&
      input.role !== "refund_source" &&
      quantityKey(input.quantity) ===
        key(output.asset.asset_id, output.asset.reward_class),
  );
  if (matchingTender.length === 0) {
    addRejection(ledger, {
      code: "invalid_plan",
      message:
        "refund/reversal output asset must match an original tender asset and reward class",
      operation_id: operation.operation_id,
    });
    return false;
  }
  const originalTenderUnits = matchingTender.reduce(
    (sum, input) => sum + quantityUnits(input.quantity),
    0n,
  );
  const returnedUnits = unitsFromAmount(amount, output.asset.scale, "exact");
  const cumulativeReturnedUnits = plan.operations
    .filter(
      (candidate) =>
        candidate.sequence <= operation.sequence &&
        candidate.original_operation_id === original.operation_id &&
        (candidate.operation_type === "refund" ||
          candidate.operation_type === "reversal"),
    )
    .flatMap((candidate) =>
      candidate.output_requests.map((request) => ({
        request,
        operationAmountJpy: candidate.amount_jpy,
      })),
    )
    .filter(
      ({ request }) =>
        key(request.asset.asset_id, request.asset.reward_class) ===
        key(output.asset.asset_id, output.asset.reward_class),
    )
    .reduce((sum, { request, operationAmountJpy }) => {
      const candidateAmount =
        request.requested_amount ?? operationAmountJpy?.toString() ?? null;
      return candidateAmount === null
        ? sum
        : sum + unitsFromAmount(candidateAmount, request.asset.scale, "exact");
    }, 0n);
  if (
    returnedUnits <= 0n ||
    cumulativeReturnedUnits > originalTenderUnits ||
    (operation.operation_type === "reversal" &&
      returnedUnits !== originalTenderUnits)
  ) {
    addRejection(ledger, {
      code: "invalid_plan",
      message:
        "refund/reversal output quantity exceeds the original matching tender",
      operation_id: operation.operation_id,
    });
    return false;
  }
  const cumulativeRefundJpy = plan.operations
    .filter(
      (candidate) =>
        candidate.sequence <= operation.sequence &&
        candidate.original_operation_id === original.operation_id &&
        (candidate.operation_type === "refund" ||
          candidate.operation_type === "reversal"),
    )
    .reduce((sum, candidate) => sum + (candidate.amount_jpy ?? 0), 0);
  if (cumulativeRefundJpy > originalAmount) {
    addRejection(ledger, {
      code: "invalid_plan",
      message:
        "cumulative refunds/reversals exceed the original operation amount",
      operation_id: operation.operation_id,
    });
    return false;
  }
  const principal = { asset: clone(output.asset), amount };
  const added = addDerivedOutput(
    operation,
    output,
    amount,
    lots,
    ledger,
    context,
    movementIndex,
    [],
    "return",
    operation.operation_type === "refund" ? "refund" : "reversal",
  );
  if (!added) return false;
  const originalRewards = ledger.rewards.filter(
    (reward) => reward.operation_id === original.operation_id,
  );
  for (const reward of originalRewards) {
    const lifecycleTarget = lifecycleTargetFromRewardComponent(reward);
    const adjustment =
      operation.operation_type === "refund"
        ? calculateRefundAdjustment({
            operation_id: operation.operation_id,
            original_operation_id: original.operation_id,
            principal_quantity: principal,
            reward: lifecycleTarget,
            refund_amount_jpy: amount,
            original_amount_jpy: originalAmount,
          })
        : calculateReversalAdjustment({
            operation_id: operation.operation_id,
            original_operation_id: original.operation_id,
            principal_quantity: principal,
            reward: lifecycleTarget,
          });
    if (adjustment.status === "conditional") {
      addRejection(ledger, {
        code: "rule_condition_unknown",
        message: `${reward.rule_id}: ${adjustment.reason_code}`,
        operation_id: operation.operation_id,
        rule_id: reward.rule_id,
      });
      continue;
    }
    const instruction = adjustment.reward_instruction;
    if (!instruction || adjustment.status !== "applied") continue;
    ledger.rewards.push({
      ...clone(reward),
      component_id: `cmp_${operation.operation_id.replace(/^op_/, "")}_${reward.rule_id.replace(/^rr_/, "")}_${ledger.rewards.length}`,
      operation_id: operation.operation_id,
      sign: "debit",
      quantity: clone(instruction.quantity),
      value_jpy: { minimum_jpy: "0", maximum_jpy: "0", expected_jpy: "0" },
      settlement: {
        status: "reversed",
        expected_posting_from: null,
        expected_posting_to: null,
        posted_at: operation.occurred_at,
      },
      calculation_trace: {
        eligible_basis: "original_operation",
        rounding_stage: "lifecycle_adjustment",
        lifecycle_kind: operation.operation_type,
        source_component_id: reward.component_id,
        reason_code: adjustment.reason_code,
      },
    });
  }
  ledger.merchantValueJpy -= BigInt(decimal(amount).toFixed(0));
  return true;
}

function initialLots(context: InternalContext): {
  lots: Map<string, MutableLot>;
  openingLotIds: Set<string>;
} {
  const lots = new Map<string, MutableLot>();
  const openingLotIds = new Set<string>();
  for (const lot of context.openingLots) {
    const units = quantityUnits(lot.quantity);
    if (lots.has(lot.lot_id))
      throw new Error(`duplicate_opening_lot:${lot.lot_id}`);
    lots.set(lot.lot_id, {
      lot: clone(lot),
      units,
      scale: lot.quantity.asset.scale,
      createdInPlan: false,
    });
    openingLotIds.add(lot.lot_id);
  }
  return { lots, openingLotIds };
}

/**
 * Every public evaluation crosses the shared structural + semantic contracts
 * validator. The engine's local checks remain deliberately narrow: they add
 * calculation-time graph and conservation invariants, never a second schema
 * implementation. `validateContractDocument` is intentionally not injectable
 * or optional, so callers cannot bypass the contract boundary.
 */
function validateContractInputs(
  plan: PurchasePlan,
  context: InternalContext,
  userState: EngineContext["user_state"],
): void {
  const openingLotIds = new Set(context.openingLots.map((lot) => lot.lot_id));
  const options = {
    openingLots: context.openingLots as unknown as never[],
    openingLotIds,
    relatedRules: context.rules as unknown as never[],
    transactionTime: context.transactionTime,
    replayKnowledgeTime: context.replayKnowledgeAt,
  };
  if (userState) validateContractDocument(userState, "user-state");
  for (const definition of context.assetDefinitions.values())
    validateContractDocument(definition, "asset");
  for (const rule of context.rules)
    validateContractDocument(rule, "reward-rule", options);
  validateContractDocument(plan, "purchase-plan", options);
}

function nativeSnapshot(
  result: Omit<NativePlanResult, "native_snapshot">,
): string {
  return canonicalize({
    plan_id: result.plan_id,
    eligible: result.eligible,
    operations: result.operations,
    asset_movements: result.asset_movements,
    reward_components: result.reward_components,
    ending_asset_lots: result.ending_asset_lots,
    applied_rule_ids: result.applied_rule_ids,
    rejected_rule_ids: result.rejected_rule_ids,
    rejection_reasons: result.rejection_reasons,
  });
}

export function evaluateNativePlan(
  plan: PurchasePlan,
  inputContext: EvaluatePlanOptions = {},
): NativePlanResult {
  const context = makeInternalContext(inputContext);
  validateContractInputs(plan, context, inputContext.user_state);
  validatePurchasePlan(plan);
  const { lots, openingLotIds } = initialLots(context);
  const ledger = zeroLedger();
  const movementIndex = { value: 0 };
  const transferVisitedAssetIds = new Set<string>();
  const planCapProgress = clone(context.capProgress);
  let valid = true;

  for (const operation of [...plan.operations].sort(
    (left, right) => left.sequence - right.sequence,
  )) {
    if (
      operation.operation_type === "point_transfer" ||
      operation.operation_type === "point_redemption"
    ) {
      valid =
        processTransferOperation(
          operation,
          plan,
          context,
          lots,
          openingLotIds,
          ledger,
          movementIndex,
          transferVisitedAssetIds,
        ) && valid;
      continue;
    }
    if (
      operation.operation_type === "refund" ||
      operation.operation_type === "reversal"
    ) {
      valid =
        processLifecycleOperation(
          operation,
          plan,
          context,
          lots,
          ledger,
          movementIndex,
        ) && valid;
      continue;
    }
    if (
      operation.operation_type !== "merchant_purchase" &&
      operation.operation_type !== "stored_value_top_up" &&
      operation.operation_type !== "voucher_purchase"
    ) {
      addRejection(ledger, {
        code: "unsupported_operation_type",
        message: `${operation.operation_type} is outside Milestone 1B`,
        operation_id: operation.operation_id,
      });
      valid = false;
      continue;
    }
    const operationCapProgress = clone(planCapProgress);
    let externalFundingForOperation = 0n;
    for (const input of operation.asset_inputs) {
      let consumed = true;
      if (input.role === "external_funding") {
        try {
          const units = quantityUnits(input.quantity);
          if (units <= 0n) throw new Error("external funding must be positive");
          const funding = decimal(input.quantity.amount);
          if (!funding.isInteger())
            throw new Error("external_funding_must_be_integer_jpy");
          externalFundingForOperation += BigInt(funding.toFixed(0));
          ledger.externalFundingJpy += BigInt(funding.toFixed(0));
          ledger.movements.push(
            movement(
              operation,
              "consume",
              "external_funding",
              input.quantity,
              null,
              null,
              movementIndex.value++,
              "Explicit external funding; not a reusable lot.",
            ),
          );
        } catch (error) {
          addRejection(ledger, {
            code: "invalid_plan",
            message: error instanceof Error ? error.message : String(error),
            operation_id: operation.operation_id,
          });
          consumed = false;
        }
      } else {
        consumed = consumeLot(
          operation,
          input,
          lots,
          openingLotIds,
          ledger,
          movementIndex,
        );
      }
      valid = valid && consumed;
    }

    const requestedOutputJpy = operation.output_requests.reduce(
      (sum, request) => {
        const amount =
          request.requested_amount ??
          (operation.amount_jpy === null
            ? "0"
            : operation.amount_jpy.toString());
        return sum.plus(decimal(amount));
      },
      ZERO,
    );
    if (
      operation.operation_type === "stored_value_top_up" ||
      operation.operation_type === "voucher_purchase"
    ) {
      if (
        externalFundingForOperation === 0n ||
        !requestedOutputJpy.eq(externalFundingForOperation.toString())
      ) {
        addRejection(ledger, {
          code: "funding_amount_mismatch",
          message: "acquisition output must equal explicit external funding",
          operation_id: operation.operation_id,
        });
        valid = false;
      }
    } else if (
      operation.operation_type === "merchant_purchase" &&
      externalFundingForOperation > 0n &&
      !operation.asset_inputs.some(
        (input) =>
          input.role !== "external_funding" &&
          input.role !== "fee" &&
          input.role !== "refund_source",
      ) &&
      externalFundingForOperation !== BigInt(operation.amount_jpy ?? 0)
    ) {
      addRejection(ledger, {
        code: "funding_amount_mismatch",
        message: "direct external funding must equal merchant amount",
        operation_id: operation.operation_id,
      });
      valid = false;
    }
    if (operation.operation_type === "merchant_purchase") {
      const principalTender = operation.asset_inputs
        .filter(
          (input) => input.role !== "fee" && input.role !== "refund_source",
        )
        .reduce((sum, input) => sum.plus(decimal(input.quantity.amount)), ZERO);
      if (!principalTender.eq((operation.amount_jpy ?? 0).toString())) {
        addRejection(ledger, {
          code: "tender_amount_mismatch",
          message: `merchant principal tender ${principalTender.toString()} does not equal amount_jpy ${operation.amount_jpy ?? 0}`,
          operation_id: operation.operation_id,
        });
        valid = false;
      }
    }

    const rules =
      context.rules.length > 0
        ? selectApprovedRules(
            context.rules,
            operation.occurred_at,
            context.replayKnowledgeAt,
          )
        : [];
    const operationRuleIds: string[] = [];
    const candidateRewards: Array<{
      rule: RewardRule;
      units: bigint;
      trace: Record<string, unknown>;
    }> = [];
    const multiplierRules: RewardRule[] = [];
    const suppressedRuleIds = new Set<string>();
    const suppressedStackGroups = new Set<string>();
    for (const exclusion of rules) {
      const matchReason = ruleMatchesOperation(
        exclusion,
        operation,
        plan,
        context,
      );
      if (
        matchReason ||
        exclusion.effect?.decision !== "deny" ||
        exclusion.effect.effect_target !== "reward_earning"
      )
        continue;
      const targetRuleIds = exclusion.effect.target_rule_ids;
      const targetStackGroups = exclusion.effect.target_stack_groups;
      if (targetRuleIds.length === 0 && targetStackGroups.length === 0) {
        addRejection(ledger, {
          code: "rule_excluded",
          message: `${exclusion.rule_id}: reward_earning exclusion has no supported target`,
          operation_id: operation.operation_id,
          rule_id: exclusion.rule_id,
        });
        valid = false;
        continue;
      }
      for (const target of targetRuleIds) suppressedRuleIds.add(target);
      for (const target of targetStackGroups) suppressedStackGroups.add(target);
      addAppliedRule(ledger, exclusion.rule_id);
    }
    for (const rule of rules) {
      const matchReason = ruleMatchesOperation(rule, operation, plan, context);
      if (matchReason) {
        if (
          rule.rule_type === "payment_acceptance" ||
          rule.rule_type === "exclusion"
        )
          addRejection(ledger, {
            code: "rule_excluded",
            message: `${rule.rule_id}: ${matchReason}`,
            operation_id: operation.operation_id,
            rule_id: rule.rule_id,
          });
        continue;
      }
      if (rule.effect?.decision === "deny") {
        addRejection(ledger, {
          code:
            rule.effect.effect_target === "operation_eligibility"
              ? "rule_excluded"
              : "rule_condition_failed",
          message: `${rule.rule_id}: ${rule.effect.reason_code}`,
          operation_id: operation.operation_id,
          rule_id: rule.rule_id,
        });
        if (rule.effect.effect_target === "operation_eligibility")
          valid = false;
        continue;
      }
      if (
        suppressedRuleIds.has(rule.rule_id) ||
        suppressedStackGroups.has(rule.stacking.stack_group)
      ) {
        addRejection(ledger, {
          code: "rule_excluded",
          message: `${rule.rule_id}: reward_earning exclusion suppressed this rule`,
          operation_id: operation.operation_id,
          rule_id: rule.rule_id,
        });
        continue;
      }
      if (
        rule.rule_type === "payment_acceptance" ||
        rule.rule_type === "exclusion"
      ) {
        addAppliedRule(ledger, rule.rule_id);
        continue;
      }
      if (!rule.calculation) {
        addRejection(ledger, {
          code: "unsupported_calculation",
          message: `${rule.rule_id}: financial rule has no calculation`,
          operation_id: operation.operation_id,
          rule_id: rule.rule_id,
        });
        continue;
      }
      if (rule.calculation.model === "transfer_ratio") {
        addRejection(ledger, {
          code: "unsupported_calculation",
          message: `${rule.rule_id}: transfer ratios apply only to transfer/redemption operations`,
          operation_id: operation.operation_id,
          rule_id: rule.rule_id,
        });
        continue;
      }
      if (rule.calculation.rounding.aggregation_scope !== "per_operation") {
        addRejection(ledger, {
          code: "unsupported_aggregation_scope",
          message: `${rule.rule_id}: ${rule.calculation.rounding.aggregation_scope} aggregation is outside Milestone 1a`,
          operation_id: operation.operation_id,
          rule_id: rule.rule_id,
        });
        continue;
      }
      if (!rule.output) {
        addRejection(ledger, {
          code: "rule_condition_failed",
          message: `${rule.rule_id}: reward output is missing`,
          operation_id: operation.operation_id,
          rule_id: rule.rule_id,
        });
        continue;
      }
      if (rule.calculation.model === "multiplier") {
        multiplierRules.push(rule);
        continue;
      }
      try {
        const calculation = calculateRewardUnits(rule, operation, context);
        if (!calculation || calculation.units <= 0n) {
          addAppliedRule(ledger, rule.rule_id);
          continue;
        }
        candidateRewards.push({ rule, ...calculation });
      } catch (error) {
        addRejection(ledger, {
          code: "rule_condition_failed",
          message: error instanceof Error ? error.message : String(error),
          operation_id: operation.operation_id,
          rule_id: rule.rule_id,
        });
      }
    }
    for (const rule of multiplierRules) {
      const calculation = rule.calculation;
      if (calculation?.model !== "multiplier" || !rule.output) continue;
      const baseUnits = candidateRewards
        .filter(
          (candidate) =>
            candidate.rule.stacking.stack_group ===
            calculation.applies_to_stack_group,
        )
        .reduce((sum, candidate) => sum + candidate.units, 0n);
      const result = evaluateMultiplierReward(calculation, {
        base_units: baseUnits > 0n ? baseUnits : null,
        asset_scale: rule.output.asset.scale,
        output_mode: "increment",
      });
      if (result.status !== "applied" || !result.units || result.units <= 0n) {
        addRejection(ledger, {
          code: "rule_condition_failed",
          message: `${rule.rule_id}: ${result.conditions.map((item) => item.code).join(",")}`,
          operation_id: operation.operation_id,
          rule_id: rule.rule_id,
        });
        continue;
      }
      candidateRewards.push({
        rule,
        units: result.units,
        trace: {
          eligible_basis: calculation.applies_to_stack_group,
          rounding_stage: calculation.rounding.aggregation_scope,
          calculation_model: "multiplier",
          multiplier_milli: calculation.multiplier_milli,
          base_units: result.base_units?.toString() ?? null,
          multiplied_units: result.multiplied_units?.toString() ?? null,
          increment_units: result.increment_units?.toString() ?? null,
        },
      });
    }
    const cappedCandidates = candidateRewards.flatMap((candidate) => {
      if (candidate.rule.caps.length === 0) return [candidate];
      const scale = candidate.rule.output?.asset.scale ?? 0;
      const requestedAmount = amountFromUnits(candidate.units, scale);
      const caps = evaluateCaps({
        caps: candidate.rule.caps,
        progress: operationCapProgress,
        candidate: {
          reward_units: requestedAmount,
          eligible_spend_jpy: Number(eligibleSpend(operation, candidate.rule)),
        },
        operation_timestamp: operation.occurred_at,
      });
      const allowed = unitsFromAmount(
        caps.allowed_reward_units.minimum,
        scale,
        "exact",
      );
      const trace = {
        ...candidate.trace,
        cap_ids: caps.cap_ids,
        cap_state: caps.state,
        cap_reward_minimum: caps.allowed_reward_units.minimum,
        cap_reward_maximum: caps.allowed_reward_units.maximum,
      };
      if (allowed <= 0n) {
        addRejection(ledger, {
          code: caps.uncertain
            ? "rule_condition_unknown"
            : "rule_condition_failed",
          message: `${candidate.rule.rule_id}: cap ${caps.state}`,
          operation_id: operation.operation_id,
          rule_id: candidate.rule.rule_id,
        });
        return [];
      }
      return [{ ...candidate, units: allowed, trace }];
    });
    const stacking = resolveStacking(
      cappedCandidates.map((candidate) => ({
        rule_id: candidate.rule.rule_id,
        stack_group: candidate.rule.stacking.stack_group,
        mode: candidate.rule.stacking.mode,
        precedence: candidate.rule.stacking.precedence,
        value: candidate.units,
        reward_units: candidate.units,
        base_reward_included:
          candidate.rule.stacking.mode === "includes_base" ||
          ((candidate.rule.calculation?.model === "percentage" ||
            candidate.rule.calculation?.model === "points_per_unit") &&
            candidate.rule.calculation.base_reward_included === true),
        is_base_reward: candidate.rule.rule_type === "base_reward",
        requires_rule_ids: candidate.rule.stacking.requires_rule_ids,
        conflicts_with_rule_ids:
          candidate.rule.stacking.conflicts_with_rule_ids,
      })),
    );
    for (const rejection of stacking.rejected) {
      if (!rejection.rule_id) continue;
      addRejection(ledger, {
        code: "rule_excluded",
        message: `${rejection.rule_id}: stacking ${rejection.reason}`,
        operation_id: operation.operation_id,
        rule_id: rejection.rule_id,
      });
    }
    const selectedIds = new Set(stacking.applied_rule_ids);
    for (const candidate of cappedCandidates) {
      if (!selectedIds.has(candidate.rule.rule_id)) continue;
      let selectedUnits = candidate.units;
      let selectedTrace = candidate.trace;
      if (candidate.rule.caps.length > 0) {
        const scale = candidate.rule.output?.asset.scale ?? 0;
        const caps = evaluateCaps({
          caps: candidate.rule.caps,
          progress: operationCapProgress,
          candidate: {
            reward_units: amountFromUnits(candidate.units, scale),
            eligible_spend_jpy: Number(
              eligibleSpend(operation, candidate.rule),
            ),
          },
          operation_timestamp: operation.occurred_at,
        });
        selectedUnits = unitsFromAmount(
          caps.allowed_reward_units.minimum,
          scale,
          "exact",
        );
        selectedTrace = {
          ...selectedTrace,
          cap_ids: caps.cap_ids,
          cap_state:
            selectedTrace.cap_state === "partial" || caps.state === "partial"
              ? "partial"
              : caps.state,
          cap_reward_minimum: caps.allowed_reward_units.minimum,
          cap_reward_maximum: caps.allowed_reward_units.maximum,
        };
        if (selectedUnits <= 0n) {
          addRejection(ledger, {
            code: caps.uncertain
              ? "rule_condition_unknown"
              : "rule_condition_failed",
            message: `${candidate.rule.rule_id}: cap ${caps.state}`,
            operation_id: operation.operation_id,
            rule_id: candidate.rule.rule_id,
          });
          continue;
        }
        reserveCapProgress(
          operationCapProgress,
          planCapProgress,
          candidate.rule.caps,
          amountFromUnits(selectedUnits, scale),
          Number(eligibleSpend(operation, candidate.rule)),
        );
      }
      const component = rewardComponentFromRule(
        candidate.rule,
        operation,
        selectedUnits,
        context,
        ledger.rewards.length,
      );
      component.calculation_trace = {
        ...component.calculation_trace,
        ...selectedTrace,
        stacking_mode: candidate.rule.stacking.mode,
      };
      ledger.rewards.push(component);
      operationRuleIds.push(candidate.rule.rule_id);
      addAppliedRule(ledger, candidate.rule.rule_id);
    }
    for (const request of operation.output_requests) {
      const outputAdded = addOutput(
        operation,
        request,
        lots,
        externalFundingForOperation,
        ledger,
        context,
        movementIndex,
        operationRuleIds,
      );
      valid = valid && outputAdded;
    }
    if (operation.operation_type === "merchant_purchase")
      ledger.merchantValueJpy += BigInt(operation.amount_jpy ?? 0);
  }

  ledger.endingLots = [...lots.values()]
    .filter((entry) => entry.units > 0n)
    .sort((left, right) => left.lot.lot_id.localeCompare(right.lot.lot_id))
    .map((entry) => ({
      ...clone(entry.lot),
      quantity: quantityFromUnits(entry.lot.quantity.asset, entry.units),
    }));
  try {
    validateConservation(
      context.openingLots,
      ledger.movements,
      ledger.endingLots,
    );
  } catch (error) {
    valid = false;
    addRejection(ledger, {
      code: "conservation_failed",
      message: error instanceof Error ? error.message : String(error),
    });
  }
  const resultWithoutSnapshot: Omit<NativePlanResult, "native_snapshot"> = {
    plan_id: plan.plan_id,
    eligible: valid,
    operations: clone(plan.operations),
    asset_movements: ledger.movements,
    reward_components: ledger.rewards,
    ending_asset_lots: ledger.endingLots,
    applied_rule_ids: [...new Set(ledger.appliedRuleIds)].sort(),
    rejected_rule_ids: [...new Set(ledger.rejectedRuleIds)].sort(),
    rejection_reasons: ledger.rejections,
    external_funding_jpy: ledger.externalFundingJpy,
    merchant_value_jpy: ledger.merchantValueJpy,
    opening_asset_units_consumed: ledger.openingConsumed,
  };
  return {
    ...resultWithoutSnapshot,
    native_snapshot: nativeSnapshot(resultWithoutSnapshot),
  };
}

function valuationFor(
  context: InternalContext,
  asset: AssetRef,
  ending = false,
): string {
  return valuePerUnit(context, asset, ending);
}

function range(value: Decimal): {
  minimum_jpy: string;
  maximum_jpy: string;
  expected_jpy: string;
} {
  const stringValue = trimDecimal(
    value.toFixed(Math.max(0, value.decimalPlaces())),
  );
  return {
    minimum_jpy: stringValue,
    maximum_jpy: stringValue,
    expected_jpy: stringValue,
  };
}

function valuedPlan(
  native: NativePlanResult,
  context: InternalContext,
): ValuedPlanResult {
  let endingValue = ZERO;
  for (const lot of native.ending_asset_lots)
    endingValue = endingValue.plus(
      valueOfUnits(
        quantityUnits(lot.quantity),
        lot.quantity.asset.scale,
        valuationFor(context, lot.quantity.asset, true),
      ),
    );
  let openingValue = ZERO;
  for (const consumed of native.opening_asset_units_consumed)
    openingValue = openingValue.plus(
      valueOfUnits(
        consumed.units,
        consumed.scale,
        valuationFor(context, {
          ...defaultAssetRef(
            consumed.asset_id,
            consumed.scale,
            consumed.reward_class,
          ),
          asset_kind: "other",
          program_id: null,
        }),
      ),
    );
  let rewardValue = ZERO;
  let probabilisticExpected = ZERO;
  const rewards: ValuedRewardComponent[] = native.reward_components.map(
    (reward) => {
      const units = quantityUnits(reward.quantity);
      const unitValue = valueOfUnits(
        units,
        reward.quantity.asset.scale,
        valuationFor(context, reward.quantity.asset),
      );
      const signed = reward.sign === "debit" ? unitValue.neg() : unitValue;
      if (reward.certainty.type === "guaranteed")
        rewardValue = rewardValue.plus(signed);
      else if (reward.certainty.type === "probabilistic") {
        const source = reward.certainty.probability_source;
        const probabilitySupported =
          source === "official_disclosed" ||
          (source === "historical_estimate" &&
            context.objective.probabilistic_reward_policy ===
              "include_user_estimate");
        const probability =
          context.objective.probabilistic_reward_policy !== "guaranteed_only" &&
          probabilitySupported &&
          reward.certainty.probability
            ? decimal(reward.certainty.probability)
            : ZERO;
        probabilisticExpected = probabilisticExpected.plus(
          signed.mul(probability),
        );
      }
      const valueString = trimDecimal(
        signed.toFixed(Math.max(0, signed.decimalPlaces())),
      );
      return {
        ...clone(reward),
        value_jpy: {
          minimum_jpy: valueString,
          maximum_jpy: valueString,
          expected_jpy: valueString,
        },
        value_jpy_decimal: valueString,
      };
    },
  );
  let feeValue = ZERO;
  for (const fee of native.asset_movements.filter(
    (movementItem) => movementItem.movement_role === "fee",
  ))
    feeValue = feeValue.plus(
      valueOfUnits(
        quantityUnits(fee.quantity),
        fee.quantity.asset.scale,
        valuationFor(context, fee.quantity.asset),
      ),
    );
  const merchant = decimal(native.merchant_value_jpy);
  const external = decimal(native.external_funding_jpy);
  const guaranteed = merchant
    .plus(endingValue)
    .plus(rewardValue)
    .minus(external)
    .minus(openingValue)
    .minus(feeValue);
  const expected = guaranteed.plus(probabilisticExpected);
  const economics: EconomicSummary = {
    merchant_value_received_jpy: range(merchant),
    external_funding_jpy: range(external),
    opening_asset_value_consumed_jpy: range(openingValue),
    ending_asset_value_jpy: range(endingValue),
    guaranteed_reward_value_jpy: range(rewardValue),
    probabilistic_expected_reward_value_jpy: range(probabilisticExpected),
    fee_value_jpy: range(feeValue),
    guaranteed_net_value_change_jpy: range(guaranteed),
    expected_net_value_change_jpy: range(expected),
  };
  const score =
    context.objective.primary === "maximize_expected_net_value"
      ? expected
      : guaranteed;
  return {
    ...clone(native),
    reward_components: rewards,
    economics,
    objective_score_jpy: trimDecimal(
      score.toFixed(Math.max(0, score.decimalPlaces())),
    ),
  };
}

function score(
  result: ValuedPlanResult,
  objective: Required<EngineObjective>,
): Decimal {
  const text =
    objective.primary === "maximize_expected_net_value"
      ? result.economics.expected_net_value_change_jpy.expected_jpy
      : result.economics.guaranteed_net_value_change_jpy.expected_jpy;
  return decimal(text ?? "0");
}

function rankPlans(
  plans: ValuedPlanResult[],
  objective: Required<EngineObjective>,
): ValuedPlanResult[] {
  return [...plans].sort((left, right) => {
    const diff = score(right, objective).minus(score(left, objective));
    if (!diff.isZero()) return diff.isNegative() ? -1 : 1;
    if (objective.tie_breakers.includes("lower_external_funding")) {
      const fundingDiff = decimal(
        left.economics.external_funding_jpy.expected_jpy ?? "0",
      ).minus(
        decimal(right.economics.external_funding_jpy.expected_jpy ?? "0"),
      );
      if (!fundingDiff.isZero()) return fundingDiff.isNegative() ? -1 : 1;
    }
    if (objective.tie_breakers.includes("fewer_operations")) {
      const operationsDiff = left.operations.length - right.operations.length;
      if (operationsDiff !== 0) return operationsDiff;
    }
    return left.plan_id.localeCompare(right.plan_id);
  });
}

function nativeBaseExcludingAsset(
  result: ValuedPlanResult,
  assetKey: string,
  context: InternalContext,
): Decimal {
  let value = decimal(
    result.economics.merchant_value_received_jpy.expected_jpy ?? "0",
  )
    .plus(
      decimal(result.economics.guaranteed_reward_value_jpy.expected_jpy ?? "0"),
    )
    .minus(decimal(result.economics.external_funding_jpy.expected_jpy ?? "0"))
    .minus(
      decimal(
        result.economics.opening_asset_value_consumed_jpy.expected_jpy ?? "0",
      ),
    )
    .minus(decimal(result.economics.fee_value_jpy.expected_jpy ?? "0"));
  for (const lot of result.ending_asset_lots) {
    if (quantityKey(lot.quantity) === assetKey) continue;
    value = value.plus(
      valueOfUnits(
        quantityUnits(lot.quantity),
        lot.quantity.asset.scale,
        valuationFor(context, lot.quantity.asset, true),
      ),
    );
  }
  return value;
}

function sensitivityForPair(
  left: ValuedPlanResult,
  right: ValuedPlanResult,
  context: InternalContext,
): ValuationSensitivity | null {
  const keys = new Set<string>();
  for (const lot of left.ending_asset_lots) keys.add(quantityKey(lot.quantity));
  for (const lot of lotArray(right.ending_asset_lots))
    keys.add(quantityKey(lot.quantity));
  for (const assetKey of keys) {
    const leftLot = left.ending_asset_lots.find(
      (lot) => quantityKey(lot.quantity) === assetKey,
    );
    const rightLot = right.ending_asset_lots.find(
      (lot) => quantityKey(lot.quantity) === assetKey,
    );
    if (!leftLot && !rightLot) continue;
    const sample = leftLot ?? rightLot;
    if (!sample) continue;
    const scale = sample.quantity.asset.scale;
    const leftUnits = leftLot ? quantityUnits(leftLot.quantity) : 0n;
    const rightUnits = rightLot ? quantityUnits(rightLot.quantity) : 0n;
    if (leftUnits === rightUnits) continue;
    const coefficientDelta = new D(leftUnits.toString())
      .minus(rightUnits.toString())
      .div(power10(scale).toString());
    const constantsDelta = nativeBaseExcludingAsset(
      right,
      assetKey,
      context,
    ).minus(nativeBaseExcludingAsset(left, assetKey, context));
    const threshold = constantsDelta.div(coefficientDelta);
    if (!threshold.isFinite() || threshold.isNegative()) continue;
    const lowPlan = coefficientDelta.gte(0) ? right.plan_id : left.plan_id;
    const highPlan = coefficientDelta.gte(0) ? left.plan_id : right.plan_id;
    return {
      asset_id: sample.quantity.asset.asset_id,
      reward_class: sample.quantity.asset.reward_class,
      current_jpy_per_unit: valuationFor(context, sample.quantity.asset, true),
      break_even_jpy_per_unit: formatRatio(threshold, ONE, 30),
      winner_at_or_below_threshold_plan_id: lowPlan,
      winner_above_threshold_plan_id: highPlan,
    };
  }
  return null;
}

function lotArray(lots: AssetLot[]): AssetLot[] {
  return lots;
}

function invalidNativePlan(
  plan: PurchasePlan,
  reason: Rejection,
): NativePlanResult {
  const empty: Omit<NativePlanResult, "native_snapshot"> = {
    plan_id: plan.plan_id,
    eligible: false,
    operations: clone(plan.operations ?? []),
    asset_movements: [],
    reward_components: [],
    ending_asset_lots: [],
    applied_rule_ids: [],
    rejected_rule_ids: reason.rule_id ? [reason.rule_id] : [],
    rejection_reasons: [reason],
    external_funding_jpy: 0n,
    merchant_value_jpy: 0n,
    opening_asset_units_consumed: [],
  };
  return { ...empty, native_snapshot: nativeSnapshot(empty) };
}

function conditionDomain(condition: UserCondition): unknown[] {
  const sentinel = `__not_${condition.fact_key}__`;
  switch (condition.operator) {
    case "eq":
      return [condition.value, sentinel];
    case "neq":
      return [sentinel, condition.value];
    case "in":
      return [
        ...(Array.isArray(condition.value) ? condition.value : []),
        sentinel,
      ];
    case "not_in":
      return [
        sentinel,
        ...(Array.isArray(condition.value) ? condition.value : []),
      ];
    case "gte": {
      const threshold = Number(condition.value);
      return Number.isFinite(threshold)
        ? [condition.value, threshold - 1]
        : [condition.value, sentinel];
    }
    case "lte": {
      const threshold = Number(condition.value);
      return Number.isFinite(threshold)
        ? [condition.value, threshold + 1]
        : [condition.value, sentinel];
    }
    case "exists":
      return [condition.value ?? true, null];
    case "not_exists":
      return [null, condition.value ?? true];
  }
}

function derivedFeasibleStates(
  plans: readonly PurchasePlan[],
  context: EvaluatePlanOptions,
): FeasibleState[] {
  const baseUserState = context.user_state;
  if (!baseUserState) return [];
  const conditionsByKey = new Map<string, UserCondition[]>();
  for (const rule of context.rules ?? context.ruleset ?? []) {
    for (const condition of rule.eligibility.user_conditions) {
      if (
        condition.unknown_policy !== "return_conditional" &&
        condition.unknown_policy !== "ask_user"
      )
        continue;
      const state = baseUserState.facts[condition.fact_key];
      if (state?.status === "known") continue;
      const conditions = conditionsByKey.get(condition.fact_key) ?? [];
      conditions.push(condition);
      conditionsByKey.set(condition.fact_key, conditions);
    }
  }
  if (conditionsByKey.size === 0) return [];
  const domains = [...conditionsByKey.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([factKey, conditions]) => {
      const values: unknown[] = [];
      const seen = new Set<string>();
      for (const condition of conditions) {
        for (const value of conditionDomain(condition)) {
          const encoded = canonicalize(value);
          if (seen.has(encoded)) continue;
          seen.add(encoded);
          values.push(value);
        }
      }
      return { factKey, values };
    });
  let assignments: Array<Record<string, unknown>> = [{}];
  for (const domain of domains) {
    assignments = assignments.flatMap((assignment) =>
      domain.values.map((value) => ({
        ...assignment,
        [domain.factKey]: value,
      })),
    );
    if (assignments.length > 64)
      throw new Error("feasible_state_limit_exceeded:64");
  }
  const { feasibleStates: _ignored, ...baseContext } = context;
  return assignments.map((assignment, stateIndex) => {
    const userState: UserState = clone(baseUserState);
    for (const [factKey, value] of Object.entries(assignment)) {
      userState.facts[factKey] = {
        status: "known",
        value,
        observed_at:
          context.transaction_time ??
          context.transactionTime ??
          "1970-01-01T00:00:00Z",
        source: "user_input",
      };
    }
    const scenarioContext: EvaluatePlanOptions = {
      ...baseContext,
      user_state: userState,
    };
    const scenarioInternal = makeInternalContext(scenarioContext);
    const values: Record<
      string,
      { guaranteed_value: string; expected_value: string; eligible: boolean }
    > = {};
    for (const plan of plans) {
      try {
        const native = evaluateNativePlan(plan, scenarioContext);
        const valued = valuedPlan(native, scenarioInternal);
        values[plan.plan_id] = {
          guaranteed_value:
            valued.economics.guaranteed_net_value_change_jpy.expected_jpy ??
            "0",
          expected_value:
            valued.economics.expected_net_value_change_jpy.expected_jpy ?? "0",
          eligible: native.eligible,
        };
      } catch {
        values[plan.plan_id] = {
          guaranteed_value: "0",
          expected_value: "0",
          eligible: false,
        };
      }
    }
    return {
      state_id: `derived_${stateIndex + 1}`,
      assignments: assignment,
      unknown_keys: domains.map((domain) => domain.factKey),
      questions: Object.fromEntries(
        domains.map((domain) => [
          domain.factKey,
          `What is the current value of ${domain.factKey}?`,
        ]),
      ),
      plans: values,
    };
  });
}

export function evaluatePlan(
  plan: PurchasePlan,
  context: EvaluatePlanOptions = {},
): NativePlanResult | ValuedPlanResult {
  const native = evaluateNativePlan(plan, context);
  if (
    context.valuation ||
    context.valuation_profile ||
    context.user_state?.valuation_profile.entries
  )
    return valuedPlan(native, makeInternalContext(context));
  return native;
}

export function evaluateCandidates(
  plans: readonly PurchasePlan[],
  context: EvaluatePlanOptions = {},
): Recommendation {
  const internal = makeInternalContext(context);
  const nativeResults: NativePlanResult[] = [];
  for (const plan of plans) {
    try {
      nativeResults.push(evaluateNativePlan(plan, context));
    } catch (error) {
      if (error instanceof SemanticValidationError)
        nativeResults.push(
          invalidNativePlan(plan, {
            code: "invalid_plan",
            message: error.message,
          }),
        );
      else throw error;
    }
  }
  const valued = nativeResults
    .filter((result) => result.eligible)
    .map((result) => valuedPlan(result, internal));
  const ranked = rankPlans(valued, internal.objective);
  const sensitivities: ValuationSensitivity[] = [];
  const firstRanked = ranked[0];
  const secondRanked = ranked[1];
  if (firstRanked && secondRanked) {
    const sensitivity = sensitivityForPair(firstRanked, secondRanked, internal);
    if (sensitivity) sensitivities.push(sensitivity);
  }
  const feasibleStates =
    context.feasibleStates ?? derivedFeasibleStates(plans, context);
  const uncertainty =
    feasibleStates.length > 0
      ? evaluateFeasibleStates({
          states: feasibleStates,
          objective:
            internal.objective.primary === "maximize_expected_net_value"
              ? "maximize_expected"
              : "maximize_guaranteed",
          probability_policy: internal.objective.probabilistic_reward_policy,
        })
      : null;
  const uncertaintyRanking = uncertainty
    ? internal.objective.primary === "maximize_expected_net_value"
      ? uncertainty.expected_ranking
      : uncertainty.guaranteed_ranking
    : [];
  const valuedByPlanId = new Map(
    valued.map((candidate) => [candidate.plan_id, candidate]),
  );
  const uncertaintyRanked = uncertainty
    ? [
        ...uncertaintyRanking.flatMap((planId) => {
          const candidate = valuedByPlanId.get(planId);
          return candidate ? [candidate] : [];
        }),
        ...ranked.filter(
          (candidate) => !uncertaintyRanking.includes(candidate.plan_id),
        ),
      ]
    : ranked;
  const uncertaintyWinner =
    uncertainty?.outcome_mode === "definite" &&
    uncertainty.definite_winner_plan_id
      ? (valuedByPlanId.get(uncertainty.definite_winner_plan_id) ?? null)
      : null;
  const uncertaintyRunnerUp =
    uncertainty?.outcome_mode === "definite" && uncertainty.runner_up_plan_id
      ? (valuedByPlanId.get(uncertainty.runner_up_plan_id) ?? null)
      : null;
  const withoutReplay = {
    winner: uncertainty ? uncertaintyWinner : (ranked[0] ?? null),
    runner_up: uncertainty ? uncertaintyRunnerUp : (ranked[1] ?? null),
    plans: uncertaintyRanked,
    valuation_sensitivities: uncertainty ? [] : sensitivities,
    ...(uncertainty
      ? {
          outcome_mode: uncertainty.outcome_mode,
          definite_winner_plan_id: uncertainty.definite_winner_plan_id,
          safe_plan_id: uncertainty.safe_plan_id,
          conditional_winners: uncertainty.conditional_winners,
          questions_to_resolve: uncertainty.questions_to_resolve,
          explanation_tokens: [
            "uncertainty.explicit_feasible_states",
            ...(uncertainty.outcome_mode === "conditional"
              ? ["ranking.conditional_winner"]
              : uncertainty.outcome_mode === "definite"
                ? ["ranking.definite_winner"]
                : ["ranking.no_valid_plan"]),
          ],
        }
      : {
          outcome_mode:
            ranked.length > 0
              ? ("definite" as const)
              : ("no_valid_plan" as const),
          definite_winner_plan_id: ranked[0]?.plan_id ?? null,
          safe_plan_id: ranked[0]?.plan_id ?? null,
          conditional_winners: [],
          questions_to_resolve: [],
          explanation_tokens:
            ranked.length > 0
              ? ["ranking.guaranteed_exact"]
              : ["ranking.no_valid_plan"],
        }),
  };
  const canonicalInput = canonicalize({
    plans,
    context: { ...context, validate_document: undefined },
  });
  const canonicalOutput = canonicalize(withoutReplay);
  const recommendation: Recommendation = {
    ...withoutReplay,
    replay: {
      contract_version: "0.4.1",
      engine_version: ENGINE_VERSION,
      input_hash: canonicalHash({
        plans,
        context: { ...context, validate_document: undefined },
      }),
      canonical_input: canonicalInput,
      canonical_output: canonicalOutput,
    },
  };
  return recommendation;
}

export function serializeReplay(
  value: Recommendation | NativePlanResult | ValuedPlanResult,
): string {
  return canonicalize(value);
}

export const serializeRecommendation = serializeReplay;

export function replayByteStable(
  first: Recommendation,
  second: Recommendation,
): boolean {
  return serializeReplay(first) === serializeReplay(second);
}

export function calculateBreakEvenResidualValue(
  lowerPlan: ValuedPlanResult,
  higherPlan: ValuedPlanResult,
  assetId: string,
  rewardClass: RewardClass,
  context: EvaluatePlanOptions = {},
): string | null {
  const internal = makeInternalContext(context);
  const left = lowerPlan.ending_asset_lots.find(
    (lot) =>
      lot.quantity.asset.asset_id === assetId &&
      lot.quantity.asset.reward_class === rewardClass,
  );
  const right = higherPlan.ending_asset_lots.find(
    (lot) =>
      lot.quantity.asset.asset_id === assetId &&
      lot.quantity.asset.reward_class === rewardClass,
  );
  if (!left && !right) return null;
  const sample = left ?? right;
  if (!sample) return null;
  const scale = sample.quantity.asset.scale;
  const leftUnits = left ? quantityUnits(left.quantity) : 0n;
  const rightUnits = right ? quantityUnits(right.quantity) : 0n;
  if (leftUnits === rightUnits) return null;
  const coefficientDelta = new D(leftUnits.toString())
    .minus(rightUnits.toString())
    .div(power10(scale).toString());
  const constantsDelta = nativeBaseExcludingAsset(
    higherPlan,
    key(assetId, rewardClass),
    internal,
  ).minus(
    nativeBaseExcludingAsset(lowerPlan, key(assetId, rewardClass), internal),
  );
  const threshold = constantsDelta.div(coefficientDelta);
  if (!threshold.isFinite() || threshold.isNegative()) return null;
  return formatRatio(threshold, ONE, 30);
}
