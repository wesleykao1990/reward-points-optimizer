import {
  amountFromUnits,
  canonicalDecimal,
  decimal,
  decimalString,
  decimalToBigInt,
  power10,
  type RoundingMode,
  roundDecimal,
} from "./math.js";
import type { AssetRef, Quantity, Rounding, Settlement } from "./types.js";

/** Values accepted at the boundary of a calculation kernel.
 *
 * Decimal quantities should normally be supplied as strings.  Numbers are
 * accepted only when they are safe integers, matching the existing math
 * helpers' no-binary-float convention.
 */
export type DecimalInput = string | number | bigint;

export type CalculationStatus =
  | "applied"
  | "not_eligible"
  | "rejected"
  | "conditional";

export interface CalculationCondition {
  code: string;
  message: string;
}

export interface RewardCalculationResult {
  status: CalculationStatus;
  units: bigint | null;
  amount: string | null;
  asset_scale: number;
  conditions: CalculationCondition[];
}

export interface FixedCalculationSpec {
  model: "fixed";
  reward_units: string;
  rounding: Rounding;
}

/** Schema-shaped aliases used by adapters that prefer the shorter names. */
export type FixedCalculation = FixedCalculationSpec;

export interface FixedRewardInput {
  /** Amount used for the threshold check. */
  eligible_amount_jpy?: DecimalInput | null;
  transaction_amount_jpy?: DecimalInput | null;
  /** Both names are accepted because the schema calls this minimum while
   * callers often call it a threshold.  If both are present, the stricter
   * (larger) threshold is used. */
  minimum_amount_jpy?: DecimalInput | null;
  threshold_jpy?: DecimalInput | null;
  asset_scale?: number;
}

export interface FixedCalculationResult extends RewardCalculationResult {
  threshold_jpy: string | null;
  basis_amount_jpy: string | null;
}

export interface TierAwardPercentage {
  model: "percentage";
  rate_basis_points: number;
}

export interface TierAwardFixed {
  model: "fixed";
  reward_units: string;
}

export interface TierAwardPointsPerUnit {
  model: "points_per_unit";
  reward_units: string;
  spend_jpy: number;
}

export type TierAward =
  | TierAwardPercentage
  | TierAwardFixed
  | TierAwardPointsPerUnit;

export type TierBasisSource =
  | "transaction_amount"
  | "user_fact"
  | "period_aggregate"
  | "event_counter";

export interface TieredCalculationSpec {
  model: "tiered";
  tier_basis: {
    source: TierBasisSource;
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
  tiers: readonly {
    operator: "eq" | "in" | "gte" | "range";
    value: unknown;
    award: TierAward;
  }[];
  rounding: Rounding;
}

export type TieredCalculation = TieredCalculationSpec;

export interface TieredRewardInput {
  /** Explicit value of tier_basis.  Missing is never converted to zero. */
  basis_value?: unknown;
  /** Spend used by percentage and points-per-unit awards. */
  spend_jpy?: DecimalInput | null;
  eligible_amount_jpy?: DecimalInput | null;
  transaction_amount_jpy?: DecimalInput | null;
  asset_scale?: number;
}

export interface TieredCalculationResult extends RewardCalculationResult {
  basis_source: TierBasisSource;
  basis_key: string;
  basis_value: unknown;
  matched_tier_index: number | null;
}

export interface MultiplierCalculationSpec {
  model: "multiplier";
  multiplier_milli: number;
  applies_to_stack_group: string;
  rounding: Rounding;
}

export type MultiplierCalculation = MultiplierCalculationSpec;

export interface MultiplierRewardInput {
  /** Prior base reward in smallest units.  It must be explicit. */
  base_units?: bigint | number | string | null;
  asset_scale?: number;
  /** Return the incremental amount rather than the multiplied total. */
  output_mode?: "total" | "increment";
}

export interface MultiplierCalculationResult extends RewardCalculationResult {
  base_units: bigint | null;
  multiplied_units: bigint | null;
  increment_units: bigint | null;
  output_mode: "total" | "increment";
}

export interface TransferCalculationSpec {
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
  bonus_rule_ids?: readonly string[];
}

export type TransferCalculation = TransferCalculationSpec;

export interface TransferCalculationInput {
  /** Requested source quantity.  source_units is a compatibility alias. */
  source_amount?: DecimalInput;
  source_units?: DecimalInput;
  /** Already consumed source quantity in the active period. */
  period_source_used?: DecimalInput | null;
  /** Prior asset IDs in the directed path. */
  visited_asset_ids?: readonly string[];
  cycle_path_asset_ids?: readonly string[];
  posting?: Settlement | null;
  cancel_requested?: boolean;
  posted?: boolean;
}

export interface TransferCancellationResult {
  status: "cancelled" | "rejected" | "conditional";
  reason_code: string;
  message: string;
}

export interface TransferCalculationResult {
  status: "applied" | "rejected" | "conditional" | "cancelled";
  source_amount: string | null;
  destination_amount: string | null;
  source_asset: AssetRef;
  destination_asset: AssetRef;
  fee: Quantity | null;
  posting: Settlement | null;
  cancellation: TransferCancellationResult | null;
  conditions: CalculationCondition[];
  reason_code: string | null;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function parseInput(
  value: DecimalInput,
  label: string,
): ReturnType<typeof decimalString> {
  try {
    if (typeof value === "string") return decimalString(value);
    if (typeof value === "bigint") {
      if (value < 0n) throw new Error("negative");
      return decimalString(value.toString());
    }
    if (!Number.isSafeInteger(value) || value < 0)
      throw new Error("not_a_safe_nonnegative_integer");
    return decimalString(value.toString());
  } catch (error) {
    throw new Error(
      `invalid_${label}:${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function parseOptionalInput(
  value: DecimalInput | null | undefined,
  label: string,
): ReturnType<typeof decimalString> | null {
  return value === null || value === undefined
    ? null
    : parseInput(value, label);
}

function validScale(scale: number | undefined): number {
  const resolved = scale ?? 0;
  if (!Number.isInteger(resolved) || resolved < 0 || resolved > 18)
    throw new Error(`invalid_asset_scale:${resolved}`);
  return resolved;
}

function roundingMode(rounding: Rounding): RoundingMode {
  return rounding.reward_rounding_mode;
}

function decimalUnits(
  amount: ReturnType<typeof decimalString>,
  scale: number,
  mode: RoundingMode,
): bigint {
  return decimalToBigInt(amount.mul(power10(scale).toString()), mode);
}

function result(
  status: CalculationStatus,
  units: bigint | null,
  scale: number,
  conditions: CalculationCondition[] = [],
): RewardCalculationResult {
  return {
    status,
    units,
    amount: units === null ? null : amountFromUnits(units, scale),
    asset_scale: scale,
    conditions,
  };
}

function rejected(
  code: string,
  message: string,
  scale: number,
): RewardCalculationResult {
  return result("rejected", null, scale, [{ code, message }]);
}

function maxDecimal(
  first: ReturnType<typeof decimalString> | null,
  second: ReturnType<typeof decimalString> | null,
): ReturnType<typeof decimalString> | null {
  if (first === null) return second;
  if (second === null) return first;
  return first.gte(second) ? first : second;
}

function amountOrNull(
  value: DecimalInput | null | undefined,
  label: string,
): string | null {
  const parsed = parseOptionalInput(value, label);
  return parsed === null ? null : canonicalDecimal(parsed);
}

function numericEquality(left: unknown, right: unknown): boolean {
  if (
    (typeof left === "string" ||
      typeof left === "number" ||
      typeof left === "bigint") &&
    (typeof right === "string" ||
      typeof right === "number" ||
      typeof right === "bigint")
  ) {
    try {
      return parseInput(left as DecimalInput, "comparison").eq(
        parseInput(right as DecimalInput, "comparison"),
      );
    } catch {
      // Non-numeric strings are compared as strings below.
    }
  }
  return JSON.stringify(left) === JSON.stringify(right);
}

function numericValue(
  value: unknown,
  label: string,
): ReturnType<typeof decimalString> {
  if (
    typeof value !== "string" &&
    typeof value !== "number" &&
    typeof value !== "bigint"
  )
    throw new Error(`invalid_${label}`);
  return parseInput(value, label);
}

function spendForAward(
  input: TieredRewardInput,
  calculation: TieredCalculationSpec,
): ReturnType<typeof decimalString> | null {
  const explicit =
    input.spend_jpy ??
    input.eligible_amount_jpy ??
    input.transaction_amount_jpy;
  if (explicit !== null && explicit !== undefined)
    return parseInput(explicit, "spend_jpy");
  // For the transaction basis the basis value itself is the explicit spend
  // supplied by the caller.  Other bases must not invent a spend amount.
  if (
    calculation.tier_basis.source === "transaction_amount" &&
    input.basis_value !== undefined
  ) {
    try {
      return numericValue(input.basis_value, "transaction_amount");
    } catch {
      return null;
    }
  }
  return null;
}

function quantizedSpend(
  spend: ReturnType<typeof decimalString>,
  quantum: number | null | undefined,
): bigint {
  if (quantum === null || quantum === undefined)
    return decimalToBigInt(spend, "exact");
  if (!Number.isSafeInteger(quantum) || quantum < 1)
    throw new Error("invalid_eligible_spend_quantum");
  const q = BigInt(quantum);
  return (decimalToBigInt(spend, "floor") / q) * q;
}

/** Convert a fixed award to smallest reward units. */
export function calculateFixedUnits(
  calculation: FixedCalculationSpec,
  assetScale = 0,
): bigint {
  const scale = validScale(assetScale);
  if (calculation.model !== "fixed") throw new Error("invalid_fixed_model");
  const award = parseInput(calculation.reward_units, "fixed_reward_units");
  return decimalUnits(award, scale, roundingMode(calculation.rounding));
}

/**
 * Evaluate a fixed award, including the transaction threshold supplied by
 * eligibility rather than pretending the fixed calculation schema owns it.
 */
export function evaluateFixedReward(
  calculation: FixedCalculationSpec,
  input: FixedRewardInput = {},
): FixedCalculationResult {
  const scale = validScale(input.asset_scale);
  const basis = parseOptionalInput(
    input.eligible_amount_jpy ?? input.transaction_amount_jpy,
    "eligible_amount_jpy",
  );
  const threshold = maxDecimal(
    parseOptionalInput(input.minimum_amount_jpy, "minimum_amount_jpy"),
    parseOptionalInput(input.threshold_jpy, "threshold_jpy"),
  );
  const common = {
    threshold_jpy: threshold === null ? null : canonicalDecimal(threshold),
    basis_amount_jpy: basis === null ? null : canonicalDecimal(basis),
  };
  if (threshold !== null && basis === null) {
    return {
      ...rejected(
        "eligible_amount_required",
        "fixed reward threshold cannot be evaluated without an eligible amount",
        scale,
      ),
      ...common,
    };
  }
  if (threshold !== null && basis !== null && basis.lt(threshold)) {
    return {
      ...result("not_eligible", 0n, scale, [
        {
          code: "below_fixed_threshold",
          message: "eligible amount is below the fixed reward threshold",
        },
      ]),
      ...common,
    };
  }
  try {
    return {
      ...result("applied", calculateFixedUnits(calculation, scale), scale),
      ...common,
    };
  } catch (error) {
    return {
      ...rejected(
        "fixed_reward_invalid",
        error instanceof Error ? error.message : String(error),
        scale,
      ),
      ...common,
    };
  }
}

/** Alias kept intentionally small for adapters that name the operation after the schema model. */
export const calculateFixedReward = evaluateFixedReward;
export const calculateFixed = evaluateFixedReward;

function rangeBounds(value: unknown): {
  minimum: ReturnType<typeof decimalString>;
  maximum: ReturnType<typeof decimalString>;
} {
  let minimumValue: unknown;
  let maximumValue: unknown;
  if (Array.isArray(value) && value.length === 2) {
    minimumValue = value[0];
    maximumValue = value[1];
  } else if (typeof value === "object" && value !== null) {
    const object = value as Record<string, unknown>;
    minimumValue = object.min ?? object.minimum ?? object.minimum_value;
    maximumValue = object.max ?? object.maximum ?? object.maximum_value;
  }
  if (minimumValue === undefined || maximumValue === undefined)
    throw new Error("range_requires_two_bounds");
  const minimum = numericValue(minimumValue, "range_minimum");
  const maximum = numericValue(maximumValue, "range_maximum");
  if (maximum.lt(minimum)) throw new Error("range_bounds_reversed");
  return { minimum, maximum };
}

function tierMatches(
  tier: TieredCalculationSpec["tiers"][number],
  basisValue: unknown,
): boolean {
  switch (tier.operator) {
    case "eq":
      return numericEquality(basisValue, tier.value);
    case "in":
      return (
        Array.isArray(tier.value) &&
        tier.value.some((value) => numericEquality(basisValue, value))
      );
    case "gte":
      try {
        return numericValue(basisValue, "tier_basis").gte(
          numericValue(tier.value, "tier_threshold"),
        );
      } catch {
        return false;
      }
    case "range": {
      try {
        const bounds = rangeBounds(tier.value);
        const basis = numericValue(basisValue, "tier_basis");
        return basis.gte(bounds.minimum) && basis.lte(bounds.maximum);
      } catch {
        return false;
      }
    }
  }
}

function tierLowerBound(
  tier: TieredCalculationSpec["tiers"][number],
): ReturnType<typeof decimalString> | null {
  try {
    if (tier.operator === "gte")
      return numericValue(tier.value, "tier_threshold");
    if (tier.operator === "range") return rangeBounds(tier.value).minimum;
  } catch {
    return null;
  }
  return null;
}

function tierSpecificity(tier: TieredCalculationSpec["tiers"][number]): number {
  switch (tier.operator) {
    case "eq":
      return 4;
    case "in":
      return 3;
    case "range":
      return 2;
    case "gte":
      return 1;
  }
}

function chooseTier(
  calculation: TieredCalculationSpec,
  basisValue: unknown,
): { tier: TieredCalculationSpec["tiers"][number]; index: number } | null {
  const matches = calculation.tiers
    .map((tier, index) => ({ tier, index }))
    .filter(({ tier }) => tierMatches(tier, basisValue));
  matches.sort((left, right) => {
    const specificity =
      tierSpecificity(right.tier) - tierSpecificity(left.tier);
    if (specificity !== 0) return specificity;
    const rightLower = tierLowerBound(right.tier);
    const leftLower = tierLowerBound(left.tier);
    if (rightLower !== null && leftLower !== null && !rightLower.eq(leftLower))
      return rightLower.gt(leftLower) ? 1 : -1;
    // Last matching declaration wins ties, making ascending gte tiers work
    // deterministically while retaining explicit declaration order as a tie
    // breaker for otherwise identical rules.
    return right.index - left.index;
  });
  const selected = matches[0];
  return selected === undefined ? null : selected;
}

function calculateTierAward(
  award: TierAward,
  input: TieredRewardInput,
  calculation: TieredCalculationSpec,
  scale: number,
): bigint {
  switch (award.model) {
    case "fixed":
      return decimalUnits(
        parseInput(award.reward_units, "tier_fixed_reward_units"),
        scale,
        roundingMode(calculation.rounding),
      );
    case "percentage": {
      const spend = spendForAward(input, calculation);
      if (spend === null)
        throw new Error("spend_amount_required_for_tier_percentage");
      return decimalToBigInt(
        decimal(
          quantizedSpend(
            spend,
            calculation.rounding.eligible_spend_quantum_jpy,
          ).toString(),
        )
          .mul(award.rate_basis_points.toString())
          .div("10000")
          .mul(power10(scale).toString()),
        roundingMode(calculation.rounding),
      );
    }
    case "points_per_unit": {
      const spend = spendForAward(input, calculation);
      if (spend === null)
        throw new Error("spend_amount_required_for_tier_points");
      if (!Number.isSafeInteger(award.spend_jpy) || award.spend_jpy < 1)
        throw new Error("invalid_tier_spend_unit");
      const spendUnits = quantizedSpend(
        spend,
        calculation.rounding.eligible_spend_quantum_jpy,
      );
      return decimalToBigInt(
        decimal((spendUnits / BigInt(award.spend_jpy)).toString())
          .mul(parseInput(award.reward_units, "tier_points_reward_units"))
          .mul(power10(scale).toString()),
        roundingMode(calculation.rounding),
      );
    }
  }
}

/** Evaluate a tier from an explicit transaction/user/aggregate/event value. */
export function evaluateTieredReward(
  calculation: TieredCalculationSpec,
  input: TieredRewardInput,
): TieredCalculationResult {
  const scale = validScale(input.asset_scale);
  const basis = input.basis_value;
  const base = {
    basis_source: calculation.tier_basis.source,
    basis_key: calculation.tier_basis.key,
    basis_value: basis,
    matched_tier_index: null as number | null,
  };
  if (basis === undefined) {
    return {
      ...rejected(
        "tier_basis_required",
        "tier calculation requires an explicit basis value",
        scale,
      ),
      ...base,
    };
  }
  const selected = chooseTier(calculation, basis);
  if (selected === null) {
    return {
      ...result("not_eligible", 0n, scale, [
        {
          code: "no_tier_match",
          message: "explicit tier basis does not match any tier",
        },
      ]),
      ...base,
    };
  }
  try {
    return {
      ...result(
        "applied",
        calculateTierAward(selected.tier.award, input, calculation, scale),
        scale,
      ),
      ...base,
      matched_tier_index: selected.index,
    };
  } catch (error) {
    return {
      ...rejected(
        "tier_award_invalid",
        error instanceof Error ? error.message : String(error),
        scale,
      ),
      ...base,
      matched_tier_index: selected.index,
    };
  }
}

export const calculateTieredReward = evaluateTieredReward;
export const calculateTiered = evaluateTieredReward;

function parseBaseUnits(value: bigint | number | string): bigint {
  if (typeof value === "bigint") {
    if (value < 0n) throw new Error("negative_base_units");
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0)
      throw new Error("invalid_base_units");
    return BigInt(value);
  }
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) throw new Error("invalid_base_units");
  return BigInt(value);
}

export function calculateMultiplierUnits(
  calculation: MultiplierCalculationSpec,
  baseUnits: bigint | number | string,
): bigint {
  if (calculation.model !== "multiplier")
    throw new Error("invalid_multiplier_model");
  if (
    !Number.isSafeInteger(calculation.multiplier_milli) ||
    calculation.multiplier_milli < 0
  )
    throw new Error("invalid_multiplier_milli");
  const base = parseBaseUnits(baseUnits);
  const raw = decimal(base.toString())
    .mul(calculation.multiplier_milli.toString())
    .div("1000");
  return decimalToBigInt(
    roundDecimal(raw, roundingMode(calculation.rounding)),
    "exact",
  );
}

/** The multiplier result exposes both total and incremental units so the
 * shared stacking adapter can include a base reward exactly once. */
export function evaluateMultiplierReward(
  calculation: MultiplierCalculationSpec,
  input: MultiplierRewardInput,
): MultiplierCalculationResult {
  const scale = validScale(input.asset_scale);
  const mode = input.output_mode ?? "total";
  const base = input.base_units;
  const common = {
    base_units:
      base === null || base === undefined
        ? null
        : (() => {
            try {
              return parseBaseUnits(base);
            } catch {
              return null;
            }
          })(),
    multiplied_units: null as bigint | null,
    increment_units: null as bigint | null,
    output_mode: mode,
  };
  if (base === null || base === undefined) {
    return {
      ...rejected(
        "base_reward_required",
        "multiplier requires explicit prior base units",
        scale,
      ),
      ...common,
    };
  }
  try {
    const parsedBase = parseBaseUnits(base);
    const multiplied = calculateMultiplierUnits(calculation, parsedBase);
    const increment = multiplied - parsedBase;
    const output = mode === "increment" ? increment : multiplied;
    return {
      ...result("applied", output, scale),
      ...common,
      base_units: parsedBase,
      multiplied_units: multiplied,
      increment_units: increment,
    };
  } catch (error) {
    return {
      ...rejected(
        "multiplier_invalid",
        error instanceof Error ? error.message : String(error),
        scale,
      ),
      ...common,
    };
  }
}

export const calculateMultiplierReward = evaluateMultiplierReward;
export const calculateMultiplier = evaluateMultiplierReward;

function transferCondition(
  code: string,
  message: string,
): CalculationCondition[] {
  return [{ code, message }];
}

function transferRejected(
  calculation: TransferCalculationSpec,
  status: "rejected" | "conditional" | "cancelled",
  reasonCode: string,
  message: string,
  sourceAmount: string | null,
  posting: Settlement | null,
  cancellation: TransferCancellationResult | null = null,
): TransferCalculationResult {
  return {
    status,
    source_amount: sourceAmount,
    destination_amount: null,
    source_asset: clone(calculation.source_asset),
    destination_asset: clone(calculation.destination_asset),
    fee: calculation.fee === null ? null : clone(calculation.fee),
    posting: posting === null ? null : clone(posting),
    cancellation,
    conditions: transferCondition(reasonCode, message),
    reason_code: reasonCode,
  };
}

function transferCycle(
  sourceAssetId: string,
  destinationAssetId: string,
  visited: readonly string[],
): boolean {
  if (sourceAssetId === destinationAssetId) return true;
  const seen = new Set<string>();
  for (const assetId of visited) {
    if (seen.has(assetId)) return true;
    seen.add(assetId);
    if (assetId === sourceAssetId || assetId === destinationAssetId)
      return true;
  }
  return false;
}

/** Detect a directed cycle in a transfer path independent of calculation. */
export function hasTransferCycle(
  edges: readonly { source_asset_id: string; destination_asset_id: string }[],
): boolean {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.source_asset_id === edge.destination_asset_id) return true;
    const destinations = adjacency.get(edge.source_asset_id) ?? [];
    destinations.push(edge.destination_asset_id);
    adjacency.set(edge.source_asset_id, destinations);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (node: string): boolean => {
    if (visiting.has(node)) return true;
    if (visited.has(node)) return false;
    visiting.add(node);
    for (const destination of adjacency.get(node) ?? []) {
      if (visit(destination)) return true;
    }
    visiting.delete(node);
    visited.add(node);
    return false;
  };
  return [...adjacency.keys()].some((node) => visit(node));
}

function cancellationFor(
  calculation: TransferCalculationSpec,
  input: TransferCalculationInput,
): TransferCancellationResult | null {
  if (input.cancel_requested !== true) return null;
  // A cancellation policy is evaluated against a known posting state.  An
  // omitted state is not evidence that the transfer is still pending.
  if (input.posted === undefined && input.posting === undefined)
    return {
      status: "conditional",
      reason_code: "posting_state_required",
      message: "cancellation requires an explicit posted or pending state",
    };
  const posted =
    input.posted === true ||
    input.posting?.status === "posted" ||
    input.posting?.status === "available";
  switch (calculation.cancellation_policy) {
    case "cancelable_before_posting":
      return posted
        ? {
            status: "rejected",
            reason_code: "already_posted",
            message: "a posted transfer cannot be cancelled before posting",
          }
        : {
            status: "cancelled",
            reason_code: "cancelled_before_posting",
            message: "transfer cancelled before posting",
          };
    case "not_cancelable":
      return {
        status: "rejected",
        reason_code: "transfer_not_cancelable",
        message: "transfer cancellation is not permitted by the rule",
      };
    case "provider_defined":
    case "unknown":
      return {
        status: "conditional",
        reason_code: "cancellation_provider_defined",
        message: "transfer cancellation depends on provider-defined state",
      };
  }
}

/** Evaluate a directed transfer ratio without mutating either asset ledger. */
export function evaluateTransfer(
  calculation: TransferCalculationSpec,
  input: TransferCalculationInput,
): TransferCalculationResult {
  const rawSource = input.source_amount ?? input.source_units;
  const posting = input.posting ?? null;
  const source =
    rawSource === undefined
      ? null
      : (() => {
          try {
            return parseInput(rawSource, "transfer_source_amount");
          } catch {
            return null;
          }
        })();
  const sourceText = source === null ? null : canonicalDecimal(source);
  if (source === null)
    return transferRejected(
      calculation,
      "rejected",
      "source_amount_required",
      "transfer requires an explicit non-negative source amount",
      sourceText,
      posting,
    );

  const visited = input.cycle_path_asset_ids ?? input.visited_asset_ids ?? [];
  if (
    transferCycle(
      calculation.source_asset.asset_id,
      calculation.destination_asset.asset_id,
      visited,
    )
  )
    return transferRejected(
      calculation,
      "rejected",
      "transfer_cycle_detected",
      "directed transfer would revisit an asset and could manufacture unbounded value",
      sourceText,
      posting,
    );

  let minimum: ReturnType<typeof decimalString> | null;
  let increment: ReturnType<typeof decimalString> | null;
  let requestMaximum: ReturnType<typeof decimalString> | null;
  let periodMaximum: ReturnType<typeof decimalString> | null;
  let ratioSource: ReturnType<typeof decimalString>;
  let ratioDestination: ReturnType<typeof decimalString>;
  try {
    minimum = parseOptionalInput(
      calculation.minimum_source_units,
      "transfer_minimum",
    );
    increment = parseOptionalInput(
      calculation.increment_source_units,
      "transfer_increment",
    );
    requestMaximum = parseOptionalInput(
      calculation.maximum_source_units_per_request,
      "transfer_request_maximum",
    );
    periodMaximum = parseOptionalInput(
      calculation.maximum_source_units_per_period,
      "transfer_period_maximum",
    );
    ratioSource = parseInput(calculation.source_units, "transfer_ratio_source");
    ratioDestination = parseInput(
      calculation.destination_units,
      "transfer_ratio_destination",
    );
    if (ratioSource.lte(0) || ratioDestination.lt(0))
      throw new Error("invalid_transfer_ratio");
    if (minimum !== null && minimum.lte(0))
      throw new Error("transfer_minimum_must_be_positive");
    if (increment !== null && increment.lte(0))
      throw new Error("transfer_increment_must_be_positive");
    if (
      requestMaximum !== null &&
      minimum !== null &&
      requestMaximum.lt(minimum)
    )
      throw new Error("transfer_request_maximum_below_minimum");
  } catch (error) {
    return transferRejected(
      calculation,
      "rejected",
      "invalid_transfer_constraints",
      error instanceof Error ? error.message : String(error),
      sourceText,
      posting,
    );
  }

  if (minimum !== null && source.lt(minimum))
    return transferRejected(
      calculation,
      "rejected",
      "below_transfer_minimum",
      "source amount is below the transfer minimum",
      sourceText,
      posting,
    );
  if (increment !== null) {
    const origin = minimum ?? decimal("0");
    const steps = source.minus(origin).div(increment);
    if (!steps.isInteger())
      return transferRejected(
        calculation,
        "rejected",
        "transfer_increment_mismatch",
        "source amount is not aligned to the transfer increment",
        sourceText,
        posting,
      );
  }
  if (requestMaximum !== null && source.gt(requestMaximum))
    return transferRejected(
      calculation,
      "rejected",
      "transfer_request_maximum_exceeded",
      "source amount exceeds the per-request transfer maximum",
      sourceText,
      posting,
    );

  if (periodMaximum !== null) {
    const used = parseOptionalInput(
      input.period_source_used,
      "transfer_period_usage",
    );
    if (used === null)
      return transferRejected(
        calculation,
        "conditional",
        "transfer_period_usage_unknown",
        "period maximum exists but prior period usage was not supplied",
        sourceText,
        posting,
      );
    if (used.lt(0))
      return transferRejected(
        calculation,
        "rejected",
        "negative_transfer_period_usage",
        "prior period usage cannot be negative",
        sourceText,
        posting,
      );
    if (used.plus(source).gt(periodMaximum))
      return transferRejected(
        calculation,
        "rejected",
        "transfer_period_maximum_exceeded",
        "source amount exceeds the remaining per-period transfer maximum",
        sourceText,
        posting,
      );
  }

  const cancellation = cancellationFor(calculation, input);
  if (cancellation?.status === "rejected")
    return transferRejected(
      calculation,
      "rejected",
      cancellation.reason_code,
      cancellation.message,
      sourceText,
      posting,
      cancellation,
    );
  if (cancellation?.status === "conditional")
    return transferRejected(
      calculation,
      "conditional",
      cancellation.reason_code,
      cancellation.message,
      sourceText,
      posting,
      cancellation,
    );
  if (cancellation?.status === "cancelled")
    return transferRejected(
      calculation,
      "cancelled",
      cancellation.reason_code,
      cancellation.message,
      sourceText,
      posting,
      cancellation,
    );

  try {
    const rawDestination = source.mul(ratioDestination).div(ratioSource);
    const destinationUnits = decimalToBigInt(
      rawDestination.mul(
        power10(calculation.destination_asset.scale).toString(),
      ),
      calculation.rounding.reward_rounding_mode,
    );
    const destinationAmount = amountFromUnits(
      destinationUnits,
      calculation.destination_asset.scale,
    );
    const fee = calculation.fee === null ? null : clone(calculation.fee);
    if (fee !== null) parseInput(fee.amount, "transfer_fee");
    return {
      status: "applied",
      source_amount: sourceText,
      destination_amount: destinationAmount,
      source_asset: clone(calculation.source_asset),
      destination_asset: clone(calculation.destination_asset),
      fee,
      posting: posting === null ? null : clone(posting),
      cancellation: null,
      conditions: [],
      reason_code: null,
    };
  } catch (error) {
    return transferRejected(
      calculation,
      "rejected",
      "transfer_rounding_or_fee_invalid",
      error instanceof Error ? error.message : String(error),
      sourceText,
      posting,
    );
  }
}

export const calculateTransfer = evaluateTransfer;
export const evaluateTransferRatio = evaluateTransfer;
