import type { Decimal } from "decimal.js";

import {
  addCalendarDays,
  exactKeys,
  type PlainRecord,
  plainInput,
  validDate,
  validDateTime,
} from "./input-guard.js";
import {
  evaluateTransfer,
  type TransferCalculationSpec,
} from "./m1b-calculations.js";
import { canonicalDecimal, canonicalHash, D, decimalString } from "./math.js";
import {
  type JpyValuation,
  lookupValuation,
  type ValuationProfile,
  valueQuantity,
} from "./point-valuation.js";
import type { AssetRef } from "./types.js";

/**
 * Value-maximising multi-hop point routing.
 *
 * `point-spend-optimizer.v1` answers "which chain of transfers produces the
 * most units of one chosen target".  That is not the question people actually
 * ask.  The observed practice routes a balance through several intermediaries
 * because the composed rate beats every direct exchange, and the binding
 * constraint is usually a per-period cap on one hop rather than the rate — so
 * the honest answer is an allocation across several routes, priced in JPY,
 * with the stranded remainder and the cap that bound it made explicit.
 *
 * This module therefore differs from v1 in five ways:
 *
 *   1. it ranks by declared JPY value, not by native units, so routes that end
 *      in different assets are comparable and `target_asset_id` may be null
 *      ("what is the best exit for this balance");
 *   2. it splits one balance across several routes against a shared cap
 *      ledger, because a monthly cap on one hop makes a single route unable to
 *      absorb the whole balance;
 *   3. it accounts for the remainder stranded at *every* hop, not only the
 *      first, since a coarse increment deep in a route silently destroys value;
 *   4. it evaluates each hop at the date that hop would actually be initiated,
 *      so a route that takes weeks is checked against the validity window in
 *      force when it gets there rather than today's;
 *   5. it honours path-dependent eligibility, which no shortest-path
 *      formulation can express.
 *
 * v1 is left untouched: its results are hash-bound and still referenced.
 */

export const POINT_ROUTE_OPTIMIZER_VERSION =
  "point-route-optimizer.v2" as const;

/** Periods a per-period transfer cap can reset on. */
export type CapPeriod =
  | "day"
  | "month"
  | "year"
  /** Japan provider year: April 1 through the following March 31. */
  | "fiscal_year_april"
  | "campaign_period"
  | "lifetime"
  /** A caller-supplied usage value over the provider's trailing 30-day window. */
  | "rolling_30_day";

export type PointRouteObjective =
  /** Rank by declared JPY value of the resulting holdings. */
  | "maximize_value"
  /** Rank by native units of the target asset. */
  | "maximize_target"
  | "fastest"
  | "preserve_expiring";

export interface PointRouteEdge {
  readonly rule_id: string;
  readonly label_ja: string;
  readonly source_claim_ids: readonly string[];
  readonly source_asset: AssetRef;
  readonly destination_asset: AssetRef;
  readonly source_units: string;
  readonly destination_units: string;
  readonly minimum_source_units: string | null;
  readonly increment_source_units: string | null;
  /** Provider-published discrete principals when no uniform increment exists. */
  readonly allowed_source_amounts?: readonly string[];
  readonly maximum_source_units_per_request: string | null;
  readonly maximum_source_units_per_period: string | null;
  readonly maximum_period: CapPeriod | null;
  readonly fee_source_units: string;
  /**
   * Optional variable fee added to `fee_source_units`.
   * The percentage is applied to the aligned source principal and rounded
   * before it is debited from the same source balance.
   */
  readonly fee_schedule?: {
    readonly model: "percentage_of_source";
    readonly numerator: string;
    readonly denominator: string;
    readonly rounding: "ceil" | "floor";
  };
  /** Shared provider counter/cap identity; defaults to `rule_id`. */
  readonly period_usage_key?: string;
  /** Tier is available at or above this prior-period source usage. */
  readonly period_usage_min_source_units?: string | null;
  /** Tier is unavailable at or above this prior-period source usage. */
  readonly period_usage_max_source_units_exclusive?: string | null;
  readonly processing_time_days_min: number | null;
  readonly processing_time_days_max: number | null;
  readonly cancellation_policy: "not_cancelable" | "provider_defined";
  readonly valid_from: string | null;
  readonly valid_to: string | null;
  readonly required_conditions_ja: readonly string[];
  /** Structured rule dependencies.  Every id must be explicitly confirmed. */
  readonly requires_rule_ids?: readonly string[];
  /**
   * Whether a request may consume the remaining cap when it does not fit in
   * full.  Omitted preserves the historical partial-consumption behaviour.
   */
  readonly partial_consumption?: boolean;
  /**
   * The rule only applies to units held directly in the source program.
   *
   * Campaign uplifts are commonly withdrawn when the units arrived through an
   * intermediary, which makes eligibility depend on the path travelled rather
   * than on the current asset alone.
   */
  readonly requires_direct_source: boolean;
}

export interface PointRouteBalance {
  readonly asset: AssetRef;
  readonly amount: string;
  readonly expires_at: string | null;
}

export interface PointRouteRequest {
  readonly effective_at: string;
  readonly objective: PointRouteObjective;
  /** `null` ranks every reachable terminal asset instead of one chosen target. */
  readonly target_asset_id: string | null;
  readonly balances: readonly PointRouteBalance[];
  readonly edges: readonly PointRouteEdge[];
  readonly confirmed_rule_ids: readonly string[];
  /** Optional separate confirmation channel for structured prerequisites. */
  readonly confirmed_prerequisite_ids?: readonly string[];
  readonly period_source_used_by_rule: Readonly<Record<string, string>>;
  readonly max_steps: number;
  readonly max_legs: number;
  readonly valuation: ValuationProfile;
}

/** Which constraint clamped a hop.  This is what the user needs to be told. */
export type BindingConstraint =
  | "balance"
  | "increment"
  | "request_maximum"
  | "period_cap";

export interface PointRouteHop {
  readonly rule_id: string;
  readonly label_ja: string;
  readonly source_asset_id: string;
  readonly destination_asset_id: string;
  readonly destination_reward_class: string | null;
  readonly source_amount: string;
  readonly destination_amount: string;
  readonly fee_source_units: string;
  /** Remainder left behind at this hop by the increment, cap, or request cap. */
  readonly stranded_source_amount: string;
  readonly binding_constraint: BindingConstraint;
  /** Date this hop would be initiated, or null when a lead time is unknown. */
  readonly initiated_on: string | null;
  readonly processing_time_days_min: number | null;
  readonly processing_time_days_max: number | null;
  readonly cap_period: CapPeriod | null;
  readonly cap_remaining_before: string | null;
  readonly cap_remaining_after: string | null;
  readonly source_claim_ids: readonly string[];
}

export interface StrandedAmount {
  readonly asset_id: string;
  readonly reward_class: string | null;
  readonly amount: string;
}

/** One allocated path.  A plan may hold several when a cap splits the balance. */
export interface PointRouteLeg {
  readonly leg_id: `sha256:${string}`;
  readonly rule_ids: readonly string[];
  readonly allocated_source_amount: string;
  readonly target_amount: string;
  readonly hops: readonly PointRouteHop[];
  readonly processing_time_days_min: number | null;
  readonly processing_time_days_max: number | null;
  readonly irreversible_step_count: number;
  readonly binding_constraint: BindingConstraint;
  readonly binding_rule_id: string;
}

export type AllocationOptimality =
  /** One route absorbed the whole balance, so no split could beat it. */
  | "exact_single_leg"
  /** Only one route was feasible at all. */
  | "exact_only_route"
  /**
   * Several routes were combined by marginal value.  Transfer minimums make
   * the throughput of a route a step function rather than a concave one, so
   * greedy allocation is not provably optimal and is labelled as such.
   */
  | "greedy_marginal_value";

export interface PointRoutePlan {
  readonly plan_id: `sha256:${string}`;
  readonly source_asset: AssetRef;
  readonly target_asset: AssetRef;
  readonly source_amount_available: string;
  readonly source_amount_used: string;
  readonly target_amount: string;
  readonly value: JpyValuation | null;
  readonly value_status: "valued" | "unvalued";
  readonly effective_rate_percent: string | null;
  readonly legs: readonly PointRouteLeg[];
  readonly allocation_optimality: AllocationOptimality;
  readonly stranded: readonly StrandedAmount[];
  readonly stranded_value_jpy: string | null;
  readonly processing_time_days_min: number | null;
  readonly processing_time_days_max: number | null;
  readonly irreversible_step_count: number;
  readonly expires_at: string | null;
  readonly expiry_preserved_amount: string;
}

export interface PointRouteSkip {
  readonly rule_id: string;
  readonly reason_code: string;
}

export interface PointRouteOptimizationResult {
  readonly version: typeof POINT_ROUTE_OPTIMIZER_VERSION;
  readonly objective: PointRouteObjective;
  readonly target_asset_id: string | null;
  readonly valuation_profile_hash: `sha256:${string}`;
  readonly winner: PointRoutePlan | null;
  readonly plans: readonly PointRoutePlan[];
  /**
   * Rules that never carried flow, with why.  A rule that succeeded on any
   * route is never listed, so a reason here is a real dead end rather than an
   * artefact of one search branch.
   */
  readonly skipped: readonly PointRouteSkip[];
  readonly path_search_truncated: boolean;
  readonly unvalued_asset_ids: readonly string[];
  readonly result_hash: `sha256:${string}`;
}

const MAX_ENUMERATED_PATHS = 2_048;

const ASSET_KEYS = [
  "asset_id",
  "asset_kind",
  "program_id",
  "reward_class",
  "scale",
] as const;

const BALANCE_KEYS = ["asset", "amount", "expires_at"] as const;

const EDGE_KEYS = [
  "rule_id",
  "label_ja",
  "source_claim_ids",
  "source_asset",
  "destination_asset",
  "source_units",
  "destination_units",
  "minimum_source_units",
  "increment_source_units",
  "maximum_source_units_per_request",
  "maximum_source_units_per_period",
  "maximum_period",
  "fee_source_units",
  "processing_time_days_min",
  "processing_time_days_max",
  "cancellation_policy",
  "valid_from",
  "valid_to",
  "required_conditions_ja",
  "requires_direct_source",
] as const;

const EDGE_OPTIONAL_KEYS = [
  "requires_rule_ids",
  "partial_consumption",
  "fee_schedule",
  "period_usage_key",
  "period_usage_min_source_units",
  "period_usage_max_source_units_exclusive",
  "allowed_source_amounts",
] as const;

const REQUEST_KEYS = [
  "effective_at",
  "objective",
  "target_asset_id",
  "balances",
  "edges",
  "confirmed_rule_ids",
  "period_source_used_by_rule",
  "max_steps",
  "max_legs",
  "valuation",
] as const;

const REQUEST_OPTIONAL_KEYS = ["confirmed_prerequisite_ids"] as const;

const CAP_PERIODS: readonly CapPeriod[] = [
  "day",
  "month",
  "year",
  "fiscal_year_april",
  "campaign_period",
  "lifetime",
  "rolling_30_day",
];

const CONFIRMATION_ID = /^[a-z0-9][a-z0-9.-]{1,119}$/u;
const MAX_CONFIRMATION_IDS = 64;

const OBJECTIVES: readonly PointRouteObjective[] = [
  "maximize_value",
  "maximize_target",
  "fastest",
  "preserve_expiring",
];

/**
 * Validate a legacy exact shape while allowing explicitly additive fields.
 *
 * `exactKeys` remains the authoritative primitive for fixed shapes.  Route
 * edges and requests predate structured prerequisites and cap policy, so they
 * need this narrow compatibility wrapper rather than a broad index signature.
 */
function exactKeysWithOptional(
  record: PlainRecord,
  required: readonly string[],
  optional: readonly string[],
  code: string,
): void {
  const allowed = new Set([...required, ...optional]);
  const actual = Object.keys(record);
  if (
    actual.length !== new Set(actual).size ||
    actual.some((key) => !allowed.has(key)) ||
    required.some((key) => !Object.hasOwn(record, key))
  )
    throw new TypeError(code);
}

function assertAsset(value: unknown): asserts value is AssetRef {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("point_route_asset_invalid");
  const record = value as PlainRecord;
  exactKeys(record, ASSET_KEYS, "point_route_asset_shape_invalid");
  if (
    typeof record.asset_id !== "string" ||
    !/^asset\.[a-z0-9.-]{2,80}$/u.test(record.asset_id) ||
    typeof record.asset_kind !== "string" ||
    (record.program_id !== null && typeof record.program_id !== "string") ||
    (record.reward_class !== null && typeof record.reward_class !== "string") ||
    !Number.isInteger(record.scale) ||
    Number(record.scale) < 0 ||
    Number(record.scale) > 9
  )
    throw new TypeError("point_route_asset_invalid");
}

function assertBalance(value: unknown): asserts value is PointRouteBalance {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("point_route_balance_invalid");
  const record = value as PlainRecord;
  exactKeys(record, BALANCE_KEYS, "point_route_balance_shape_invalid");
  assertAsset(record.asset);
  if (
    typeof record.amount !== "string" ||
    (record.expires_at !== null &&
      (typeof record.expires_at !== "string" ||
        !validDateTime(record.expires_at)))
  )
    throw new TypeError("point_route_balance_invalid");
  decimalString(record.amount);
}

function optionalDecimal(value: unknown): boolean {
  if (value === null) return true;
  if (typeof value !== "string") return false;
  try {
    decimalString(value);
    return true;
  } catch {
    return false;
  }
}

function optionalDays(value: unknown): boolean {
  return (
    value === null ||
    (typeof value === "number" &&
      Number.isInteger(value) &&
      value >= 0 &&
      value <= 3_650)
  );
}

function optionalDate(value: unknown): boolean {
  return value === null || (typeof value === "string" && validDate(value));
}

function assertEdge(value: unknown): asserts value is PointRouteEdge {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("point_route_edge_invalid");
  const record = value as PlainRecord;
  exactKeysWithOptional(
    record,
    EDGE_KEYS,
    EDGE_OPTIONAL_KEYS,
    "point_route_edge_shape_invalid",
  );
  assertAsset(record.source_asset);
  assertAsset(record.destination_asset);
  const requiresRuleIds = record.requires_rule_ids;
  const feeSchedule = record.fee_schedule;
  const periodUsageKey = record.period_usage_key;
  const allowedSourceAmounts = record.allowed_source_amounts;
  if (
    typeof record.rule_id !== "string" ||
    !/^[a-z0-9][a-z0-9.-]{1,119}$/u.test(record.rule_id) ||
    typeof record.label_ja !== "string" ||
    record.label_ja.length < 1 ||
    record.label_ja.length > 120 ||
    !Array.isArray(record.source_claim_ids) ||
    record.source_claim_ids.length < 1 ||
    record.source_claim_ids.length > 16 ||
    !record.source_claim_ids.every((item) => typeof item === "string") ||
    typeof record.source_units !== "string" ||
    typeof record.destination_units !== "string" ||
    !optionalDecimal(record.minimum_source_units) ||
    !optionalDecimal(record.increment_source_units) ||
    !optionalDecimal(record.maximum_source_units_per_request) ||
    !optionalDecimal(record.maximum_source_units_per_period) ||
    (record.maximum_period !== null &&
      !CAP_PERIODS.includes(record.maximum_period as CapPeriod)) ||
    typeof record.fee_source_units !== "string" ||
    !optionalDays(record.processing_time_days_min) ||
    !optionalDays(record.processing_time_days_max) ||
    !["not_cancelable", "provider_defined"].includes(
      record.cancellation_policy as string,
    ) ||
    !optionalDate(record.valid_from) ||
    !optionalDate(record.valid_to) ||
    !Array.isArray(record.required_conditions_ja) ||
    !record.required_conditions_ja.every(
      (item) => typeof item === "string" && item.length <= 120,
    ) ||
    (requiresRuleIds !== undefined &&
      (!Array.isArray(requiresRuleIds) ||
        new Set(requiresRuleIds).size !== requiresRuleIds.length ||
        !requiresRuleIds.every(
          (item) => typeof item === "string" && CONFIRMATION_ID.test(item),
        ))) ||
    (record.partial_consumption !== undefined &&
      typeof record.partial_consumption !== "boolean") ||
    (periodUsageKey !== undefined &&
      (typeof periodUsageKey !== "string" ||
        !CONFIRMATION_ID.test(periodUsageKey))) ||
    (record.period_usage_min_source_units !== undefined &&
      !optionalDecimal(record.period_usage_min_source_units)) ||
    (record.period_usage_max_source_units_exclusive !== undefined &&
      !optionalDecimal(record.period_usage_max_source_units_exclusive)) ||
    (allowedSourceAmounts !== undefined &&
      (!Array.isArray(allowedSourceAmounts) ||
        allowedSourceAmounts.length < 1 ||
        allowedSourceAmounts.length > 64 ||
        new Set(allowedSourceAmounts).size !== allowedSourceAmounts.length ||
        !allowedSourceAmounts.every((item) => typeof item === "string"))) ||
    typeof record.requires_direct_source !== "boolean"
  )
    throw new TypeError("point_route_edge_invalid");
  decimalString(record.source_units);
  decimalString(record.destination_units);
  decimalString(record.fee_source_units);
  if (feeSchedule !== undefined) {
    if (
      !feeSchedule ||
      typeof feeSchedule !== "object" ||
      Array.isArray(feeSchedule)
    )
      throw new TypeError("point_route_edge_fee_schedule_invalid");
    const schedule = feeSchedule as PlainRecord;
    exactKeys(
      schedule,
      ["model", "numerator", "denominator", "rounding"],
      "point_route_edge_fee_schedule_shape_invalid",
    );
    if (
      schedule.model !== "percentage_of_source" ||
      typeof schedule.numerator !== "string" ||
      typeof schedule.denominator !== "string" ||
      !["ceil", "floor"].includes(schedule.rounding as string)
    )
      throw new TypeError("point_route_edge_fee_schedule_invalid");
    const numerator = decimalString(schedule.numerator);
    const denominator = decimalString(schedule.denominator);
    if (
      !numerator.isInteger() ||
      numerator.lt(0) ||
      !denominator.isInteger() ||
      denominator.lte(0) ||
      numerator.gte(denominator)
    )
      throw new TypeError("point_route_edge_fee_schedule_invalid");
  }
  if (allowedSourceAmounts !== undefined) {
    const parsed = allowedSourceAmounts.map((item) => decimalString(item));
    if (
      parsed.some((item) => !item.isInteger() || item.lte(0)) ||
      parsed.some((item, index, values) => {
        const previous = values[index - 1];
        return previous !== undefined && item.lte(previous);
      })
    )
      throw new TypeError("point_route_edge_allowed_amounts_invalid");
    if (record.increment_source_units !== null)
      throw new TypeError("point_route_edge_allowed_amounts_conflict");
  }
  const tierMin =
    record.period_usage_min_source_units === undefined ||
    record.period_usage_min_source_units === null
      ? null
      : decimalString(record.period_usage_min_source_units as string);
  const tierMax =
    record.period_usage_max_source_units_exclusive === undefined ||
    record.period_usage_max_source_units_exclusive === null
      ? null
      : decimalString(record.period_usage_max_source_units_exclusive as string);
  if (
    tierMin?.lt(0) === true ||
    tierMax?.lte(0) === true ||
    (tierMin !== null && tierMax !== null && tierMin.gte(tierMax))
  )
    throw new TypeError("point_route_edge_period_tier_invalid");
  const hasPeriodConstraint =
    record.maximum_source_units_per_period !== null ||
    tierMin !== null ||
    tierMax !== null;
  if (hasPeriodConstraint !== (record.maximum_period !== null))
    throw new TypeError("point_route_edge_cap_period_mismatch");
  if (
    typeof record.processing_time_days_min === "number" &&
    typeof record.processing_time_days_max === "number" &&
    record.processing_time_days_min > record.processing_time_days_max
  )
    throw new TypeError("point_route_edge_processing_time_inverted");
  if (
    typeof record.valid_from === "string" &&
    typeof record.valid_to === "string" &&
    record.valid_to <= record.valid_from
  )
    throw new TypeError("point_route_edge_validity_inverted");
}

function transferSpec(
  edge: PointRouteEdge,
  feeAmount = decimalString(edge.fee_source_units),
): TransferCalculationSpec {
  return {
    model: "transfer_ratio",
    source_asset: edge.source_asset,
    destination_asset: edge.destination_asset,
    source_units: edge.source_units,
    destination_units: edge.destination_units,
    minimum_source_units: edge.minimum_source_units,
    increment_source_units: edge.increment_source_units,
    maximum_source_units_per_request: edge.maximum_source_units_per_request,
    maximum_source_units_per_period: edge.maximum_source_units_per_period,
    // The transfer kernel only needs a cap-present/absent distinction.  For
    // a rolling 30-day window the caller's supplied usage is already the
    // authoritative trailing-window aggregate, so retain the public period
    // label on the route while using the kernel's compatible day token.
    maximum_period:
      edge.maximum_period === "rolling_30_day"
        ? "day"
        : edge.maximum_period === "fiscal_year_april"
          ? "year"
          : edge.maximum_period,
    fee: feeAmount.eq(0)
      ? null
      : { asset: edge.source_asset, amount: canonicalDecimal(feeAmount) },
    rounding: {
      aggregation_scope: "transfer_request",
      eligible_spend_quantum_jpy: null,
      reward_rounding_mode: "floor",
    },
    processing_time_days_min: edge.processing_time_days_min,
    processing_time_days_max: edge.processing_time_days_max,
    cancellation_policy: edge.cancellation_policy,
  };
}

/** Is the edge usable on the date the hop would actually be initiated? */
function activeOn(edge: PointRouteEdge, date: string): boolean {
  return (
    (edge.valid_from === null || edge.valid_from <= date) &&
    // RewardRule validity is half-open: valid_to is the first date on which
    // the rule no longer applies.
    (edge.valid_to === null || date < edge.valid_to)
  );
}

interface Alignment {
  readonly source: Decimal;
  readonly fee: Decimal;
  readonly stranded: Decimal;
  readonly binding: BindingConstraint;
}

/**
 * Largest amount this edge will accept out of `available`, and what that
 * leaves behind.
 *
 * The fee is taken from the same balance, so it is removed before the
 * request cap, the remaining period cap, and the increment are applied in
 * turn.  Whichever of those actually clamped the amount is reported, because
 * "you are capped at 20,000 this month" and "you lost 800 to a 1,000-unit
 * increment" call for different advice.
 */
function feeForSource(edge: PointRouteEdge, source: Decimal): Decimal {
  let fee = decimalString(edge.fee_source_units);
  if (edge.fee_schedule === undefined) return fee;
  const raw = source
    .mul(decimalString(edge.fee_schedule.numerator))
    .div(decimalString(edge.fee_schedule.denominator));
  fee = fee.plus(
    edge.fee_schedule.rounding === "ceil" ? raw.ceil() : raw.floor(),
  );
  return fee;
}

function usageKey(edge: PointRouteEdge): string {
  return edge.period_usage_key ?? edge.rule_id;
}

function alignSource(
  edge: PointRouteEdge,
  available: Decimal,
  capRemaining: Decimal | null,
  tierRemaining: Decimal | null = null,
): Alignment | null {
  const fixedFee = decimalString(edge.fee_source_units);
  if (fixedFee.gt(available)) return null;
  let amount = available.minus(fixedFee);
  if (edge.fee_schedule !== undefined) {
    const numerator = decimalString(edge.fee_schedule.numerator);
    const denominator = decimalString(edge.fee_schedule.denominator);
    amount = available
      .minus(fixedFee)
      .mul(denominator)
      .div(denominator.plus(numerator))
      .floor();
  }
  let binding: BindingConstraint = "balance";
  if (edge.maximum_source_units_per_request !== null) {
    const requestMaximum = decimalString(edge.maximum_source_units_per_request);
    if (amount.gt(requestMaximum)) {
      amount = requestMaximum;
      binding = "request_maximum";
    }
  }
  if (capRemaining !== null && amount.gt(capRemaining)) {
    amount = capRemaining;
    binding = "period_cap";
  }
  if (tierRemaining !== null && amount.gt(tierRemaining)) {
    amount = tierRemaining;
    binding = "period_cap";
  }
  const minimum =
    edge.minimum_source_units === null
      ? null
      : decimalString(edge.minimum_source_units);
  if (edge.increment_source_units !== null) {
    const increment = decimalString(edge.increment_source_units);
    const origin = minimum ?? D(0);
    if (amount.lt(origin)) return null;
    const aligned = origin.plus(
      amount.minus(origin).div(increment).floor().mul(increment),
    );
    if (aligned.lt(amount) && binding === "balance") binding = "increment";
    amount = aligned;
  } else if (edge.allowed_source_amounts !== undefined) {
    const allowed = edge.allowed_source_amounts
      .map((item) => decimalString(item))
      .filter((item) => item.lte(amount));
    const selected = allowed.at(-1);
    if (selected === undefined) return null;
    if (selected.lt(amount) && binding === "balance") binding = "increment";
    amount = selected;
  }
  if (minimum !== null && amount.lt(minimum)) return null;
  if (amount.lte(0)) return null;
  // Percentage rounding can make the algebraic upper bound one unit too
  // optimistic. Align down without ever iterating in proportion to balance.
  const decrement =
    edge.increment_source_units === null
      ? edge.allowed_source_amounts === undefined
        ? D(1)
        : D(0)
      : decimalString(edge.increment_source_units);
  let fee = feeForSource(edge, amount);
  if (amount.plus(fee).gt(available)) {
    if (decrement.eq(0)) return null;
    amount = amount.minus(decrement);
    if (minimum !== null && amount.lt(minimum)) return null;
    fee = feeForSource(edge, amount);
  }
  if (amount.lte(0) || amount.plus(fee).gt(available)) return null;
  // Reaching the remaining period cap exactly is itself the binding
  // constraint, whether the amount arrived clamped here or was already
  // limited upstream by `backwardCapacity`: either way nothing more can move
  // through this rule until the period resets.
  if (capRemaining !== null && amount.eq(capRemaining)) binding = "period_cap";
  return {
    source: amount,
    fee,
    stranded: available.minus(amount).minus(fee),
    binding,
  };
}

type CapLedger = Map<string, Decimal>;
type UsageLedger = Map<string, Decimal>;

function capRemaining(ledger: CapLedger, edge: PointRouteEdge): Decimal | null {
  if (edge.maximum_source_units_per_period === null) return null;
  return ledger.get(usageKey(edge)) ?? D(0);
}

/**
 * Largest input the first hop can accept without stranding units downstream.
 *
 * Capacity is propagated backwards because the tightest constraint on a route
 * is usually not on its first hop.  Feeding a whole balance into a route whose
 * final hop is capped at 20,000 a month converts the excess into an
 * intermediate currency and abandons it there, which reads as a good rate
 * while destroying most of the balance.  Walking the caps back through each
 * ratio gives the amount actually worth sending, and leaves the rest free for
 * a second route.
 *
 * `null` means no hop constrains the input.
 */
function backwardCapacity(
  path: readonly PointRouteEdge[],
  ledger: CapLedger,
  usageLedger: UsageLedger,
): Decimal | null {
  let capacity: Decimal | null = null;
  for (let index = path.length - 1; index >= 0; index -= 1) {
    const edge = path[index] as PointRouteEdge;
    let hopMaximum: Decimal | null = null;
    if (edge.maximum_source_units_per_request !== null)
      hopMaximum = decimalString(edge.maximum_source_units_per_request);
    const remaining = capRemaining(ledger, edge);
    if (remaining !== null)
      hopMaximum =
        hopMaximum === null || remaining.lt(hopMaximum)
          ? remaining
          : hopMaximum;
    if (edge.period_usage_max_source_units_exclusive != null) {
      const tierRemaining = decimalString(
        edge.period_usage_max_source_units_exclusive,
      ).minus(usageLedger.get(usageKey(edge)) ?? D(0));
      hopMaximum =
        hopMaximum === null || tierRemaining.lt(hopMaximum)
          ? tierRemaining
          : hopMaximum;
    }
    if (capacity !== null) {
      // Source units that produce at most `capacity` destination units.  The
      // forward calculation floors, so flooring here cannot overshoot.
      const fromDownstream: Decimal = capacity
        .mul(decimalString(edge.source_units))
        .div(decimalString(edge.destination_units))
        .floor();
      hopMaximum =
        hopMaximum === null || fromDownstream.lt(hopMaximum)
          ? fromDownstream
          : hopMaximum;
    }
    capacity =
      hopMaximum === null
        ? null
        : hopMaximum.plus(feeForSource(edge, hopMaximum));
  }
  return capacity;
}

interface LegEvaluation {
  readonly leg: PointRouteLeg;
  readonly consumed: string;
  readonly stranded: readonly StrandedAmount[];
  readonly capConsumption: ReadonlyMap<string, Decimal>;
}

interface LegFailure {
  readonly rule_id: string;
  readonly reason_code: string;
}

/**
 * Check all-or-nothing cap rules before backward capacity can truncate input.
 *
 * Backward capacity is deliberately allowed for the historical partial-cap
 * mode: it is what makes a capped route split cleanly onto a fallback route.
 * A provider may instead reject a request that exceeds either the request cap
 * or the remaining rolling/period cap.  In that mode, seeing only the
 * backward-propagated 10,000 would incorrectly turn a 20,000 request into a
 * successful partial transfer.  This preflight walks the untruncated request
 * through prior partial hops and fails at the first non-partial cap.
 */
function nonPartialCapFailure(
  path: readonly PointRouteEdge[],
  input: Decimal,
  ledger: CapLedger,
  usageLedger: UsageLedger,
): LegFailure | null {
  let amount = input;
  for (let index = 0; index < path.length; index += 1) {
    const edge = path[index] as PointRouteEdge;
    if (edge.partial_consumption === false) {
      if (edge.maximum_source_units_per_request !== null) {
        const maximum = decimalString(edge.maximum_source_units_per_request);
        if (amount.gt(maximum.plus(feeForSource(edge, maximum))))
          return {
            rule_id: edge.rule_id,
            reason_code: "transfer_request_maximum_exceeded",
          };
      }
      const remaining = capRemaining(ledger, edge);
      if (
        remaining !== null &&
        amount.gt(remaining.plus(feeForSource(edge, remaining)))
      )
        return {
          rule_id: edge.rule_id,
          reason_code: "transfer_period_maximum_exceeded",
        };
    }

    const remaining = capRemaining(ledger, edge);
    const used = usageLedger.get(usageKey(edge)) ?? D(0);
    const tierMaximum =
      edge.period_usage_max_source_units_exclusive == null
        ? null
        : decimalString(edge.period_usage_max_source_units_exclusive);
    const tierRemaining = tierMaximum === null ? null : tierMaximum.minus(used);
    const alignment = alignSource(edge, amount, remaining, tierRemaining);
    if (alignment === null) return null;
    const sourceAmount = canonicalDecimal(alignment.source);
    const evaluated = evaluateTransfer(transferSpec(edge, alignment.fee), {
      source_amount: sourceAmount,
      visited_asset_ids: path
        .slice(0, index)
        .map((item) => item.source_asset.asset_id),
      ...(edge.maximum_source_units_per_period === null
        ? {}
        : {
            period_source_used: canonicalDecimal(
              decimalString(edge.maximum_source_units_per_period).minus(
                remaining ?? D(0),
              ),
            ),
          }),
    });
    if (evaluated.status !== "applied" || evaluated.destination_amount === null)
      return null;
    amount = decimalString(evaluated.destination_amount);
  }
  return null;
}

function addDays(current: number | null, next: number | null): number | null {
  return current === null || next === null ? null : current + next;
}

/**
 * Walk one path with a concrete input amount against a cap ledger snapshot.
 *
 * Returns the realised leg, or the first rule that stopped it.  Nothing here
 * mutates the ledger: the caller commits only the leg it actually allocates.
 */
function evaluateLeg(
  path: readonly PointRouteEdge[],
  input: Decimal,
  ledger: CapLedger,
  usageLedger: UsageLedger,
  effectiveDate: string,
  balanceExpiresOn: string | null,
): LegEvaluation | LegFailure {
  const nonPartialFailure = nonPartialCapFailure(
    path,
    input,
    ledger,
    usageLedger,
  );
  if (nonPartialFailure) return nonPartialFailure;
  const capacity = backwardCapacity(path, ledger, usageLedger);
  let amount = capacity?.lt(input) ? capacity : input;
  let minDays: number | null = 0;
  let maxDays: number | null = 0;
  let irreversible = 0;
  const hops: PointRouteHop[] = [];
  const stranded: StrandedAmount[] = [];
  const capConsumption = new Map<string, Decimal>();
  let binding: BindingConstraint = "balance";
  let bindingRuleId = path[0]?.rule_id ?? "";

  for (const edge of path) {
    const initiatedOn =
      maxDays === null ? null : addCalendarDays(effectiveDate, maxDays);
    // Validity is checked on the date the hop is reached, not today: a route
    // that takes weeks can arrive after the rule it depends on has closed.
    if (initiatedOn !== null && !activeOn(edge, initiatedOn))
      return {
        rule_id: edge.rule_id,
        reason_code:
          edge.valid_to !== null && edge.valid_to <= initiatedOn
            ? "closes_before_hop_is_reached"
            : "outside_validity_window",
      };
    if (
      hops.length === 0 &&
      balanceExpiresOn !== null &&
      initiatedOn !== null &&
      initiatedOn > balanceExpiresOn
    )
      return { rule_id: edge.rule_id, reason_code: "source_balance_expired" };

    const key = usageKey(edge);
    const used = (usageLedger.get(key) ?? D(0)).plus(
      capConsumption.get(key) ?? D(0),
    );
    const tierMinimum =
      edge.period_usage_min_source_units == null
        ? null
        : decimalString(edge.period_usage_min_source_units);
    const tierMaximum =
      edge.period_usage_max_source_units_exclusive == null
        ? null
        : decimalString(edge.period_usage_max_source_units_exclusive);
    if (tierMinimum !== null && used.lt(tierMinimum))
      return {
        rule_id: edge.rule_id,
        reason_code: "period_tier_not_active",
      };
    if (tierMaximum !== null && used.gte(tierMaximum))
      return {
        rule_id: edge.rule_id,
        reason_code: "period_tier_exhausted",
      };
    const remaining = capRemaining(ledger, edge);
    const tierRemaining = tierMaximum === null ? null : tierMaximum.minus(used);
    const alignment = alignSource(edge, amount, remaining, tierRemaining);
    if (alignment === null)
      return {
        rule_id: edge.rule_id,
        reason_code: remaining?.lte(0)
          ? "period_cap_exhausted"
          : "insufficient_or_unaligned_balance",
      };

    const sourceAmount = canonicalDecimal(alignment.source);
    const evaluated = evaluateTransfer(transferSpec(edge, alignment.fee), {
      source_amount: sourceAmount,
      visited_asset_ids: path
        .slice(0, hops.length)
        .map((item) => item.source_asset.asset_id),
      ...(edge.maximum_source_units_per_period === null
        ? {}
        : {
            // The ledger already holds `cap - prior usage`, so the usage
            // presented to the calculator is the portion consumed so far.
            period_source_used: canonicalDecimal(
              decimalString(edge.maximum_source_units_per_period).minus(
                remaining ?? D(0),
              ),
            ),
          }),
    });
    if (evaluated.status !== "applied" || evaluated.destination_amount === null)
      return {
        rule_id: edge.rule_id,
        reason_code: evaluated.reason_code ?? evaluated.status,
      };

    if (alignment.stranded.gt(0))
      stranded.push({
        asset_id: edge.source_asset.asset_id,
        reward_class: edge.source_asset.reward_class,
        amount: canonicalDecimal(alignment.stranded),
      });
    if (
      remaining !== null ||
      tierMinimum !== null ||
      tierMaximum !== null ||
      edge.period_usage_key !== undefined
    )
      capConsumption.set(
        key,
        (capConsumption.get(key) ?? D(0)).plus(alignment.source),
      );

    hops.push({
      rule_id: edge.rule_id,
      label_ja: edge.label_ja,
      source_asset_id: edge.source_asset.asset_id,
      destination_asset_id: edge.destination_asset.asset_id,
      destination_reward_class: edge.destination_asset.reward_class,
      source_amount: sourceAmount,
      destination_amount: evaluated.destination_amount,
      fee_source_units: canonicalDecimal(alignment.fee),
      stranded_source_amount: canonicalDecimal(alignment.stranded),
      binding_constraint: alignment.binding,
      initiated_on: initiatedOn,
      processing_time_days_min: edge.processing_time_days_min,
      processing_time_days_max: edge.processing_time_days_max,
      cap_period: edge.maximum_period,
      cap_remaining_before:
        remaining === null ? null : canonicalDecimal(remaining),
      cap_remaining_after:
        remaining === null
          ? null
          : canonicalDecimal(remaining.minus(alignment.source)),
      source_claim_ids: edge.source_claim_ids,
    });

    // The tightest hop decides what the whole route can carry, so the last
    // non-balance constraint encountered is the one worth reporting.
    if (alignment.binding !== "balance") {
      binding = alignment.binding;
      bindingRuleId = edge.rule_id;
    }
    minDays = addDays(minDays, edge.processing_time_days_min);
    maxDays = addDays(maxDays, edge.processing_time_days_max);
    irreversible += edge.cancellation_policy === "not_cancelable" ? 1 : 0;
    amount = decimalString(evaluated.destination_amount);
  }

  const firstHop = hops[0];
  if (!firstHop) return { rule_id: "", reason_code: "empty_path" };
  const consumed = decimalString(firstHop.source_amount).plus(
    decimalString(firstHop.fee_source_units),
  );
  const projection = {
    rule_ids: path.map((edge) => edge.rule_id),
    allocated_source_amount: canonicalDecimal(consumed),
    target_amount: canonicalDecimal(amount),
    hops,
    processing_time_days_min: minDays,
    processing_time_days_max: maxDays,
    irreversible_step_count: irreversible,
    binding_constraint: binding,
    binding_rule_id: bindingRuleId,
  };
  return {
    leg: {
      leg_id: canonicalHash(projection) as `sha256:${string}`,
      ...projection,
    },
    consumed: canonicalDecimal(consumed),
    stranded,
    capConsumption,
  };
}

function isFailure(value: LegEvaluation | LegFailure): value is LegFailure {
  return "reason_code" in value;
}

/** Bounded depth-first path enumeration with path-dependent eligibility. */
function enumeratePaths(
  edges: readonly PointRouteEdge[],
  sourceAssetId: string,
  maxSteps: number,
): { paths: readonly (readonly PointRouteEdge[])[]; truncated: boolean } {
  const bySource = new Map<string, PointRouteEdge[]>();
  for (const edge of edges) {
    const list = bySource.get(edge.source_asset.asset_id);
    if (list) list.push(edge);
    else bySource.set(edge.source_asset.asset_id, [edge]);
  }
  const paths: (readonly PointRouteEdge[])[] = [];
  let truncated = false;

  const walk = (
    assetId: string,
    visited: readonly string[],
    prefix: readonly PointRouteEdge[],
  ): void => {
    if (prefix.length >= maxSteps) return;
    for (const edge of bySource.get(assetId) ?? []) {
      if (paths.length >= MAX_ENUMERATED_PATHS) {
        truncated = true;
        return;
      }
      if (visited.includes(edge.destination_asset.asset_id)) continue;
      // A rule restricted to directly held units cannot be reached through an
      // intermediary, so it only ever appears as the first hop.
      if (edge.requires_direct_source && prefix.length > 0) continue;
      const next = [...prefix, edge];
      paths.push(next);
      walk(
        edge.destination_asset.asset_id,
        [...visited, edge.destination_asset.asset_id],
        next,
      );
    }
  };

  walk(sourceAssetId, [sourceAssetId], []);
  return { paths, truncated };
}

function valueOfPlanTarget(
  profile: ValuationProfile,
  asset: AssetRef,
  amount: string,
): JpyValuation | null {
  return valueQuantity(profile, asset.asset_id, asset.reward_class, amount);
}

function strandedValue(
  profile: ValuationProfile,
  stranded: readonly StrandedAmount[],
): string | null {
  let total = D(0);
  for (const item of stranded) {
    const valued = valueQuantity(
      profile,
      item.asset_id,
      item.reward_class,
      item.amount,
    );
    if (!valued) return null;
    total = total.plus(decimalString(valued.expected_jpy));
  }
  return canonicalDecimal(total);
}

function mergeStranded(
  entries: readonly StrandedAmount[],
): readonly StrandedAmount[] {
  const merged = new Map<string, StrandedAmount>();
  for (const entry of entries) {
    const key = `${entry.asset_id} ${entry.reward_class ?? ""}`;
    const current = merged.get(key);
    merged.set(
      key,
      current
        ? {
            ...current,
            amount: canonicalDecimal(
              decimalString(current.amount).plus(decimalString(entry.amount)),
            ),
          }
        : entry,
    );
  }
  return [...merged.values()].sort(
    (left, right) =>
      left.asset_id.localeCompare(right.asset_id) ||
      (left.reward_class ?? "").localeCompare(right.reward_class ?? ""),
  );
}

interface AllocationOutcome {
  readonly legs: readonly PointRouteLeg[];
  readonly used: Decimal;
  readonly produced: Decimal;
  readonly stranded: readonly StrandedAmount[];
  readonly optimality: AllocationOptimality;
  readonly failures: readonly LegFailure[];
}

/**
 * Spread one balance across the candidate paths that reach a target.
 *
 * Each round re-evaluates every remaining path against what is left of the
 * balance and of the shared cap ledger, then commits the path with the best
 * output per source unit consumed.  Committing changes the ledger, so the
 * next round genuinely re-prices the alternatives instead of assuming the
 * first ranking still holds.
 */
function allocate(
  paths: readonly (readonly PointRouteEdge[])[],
  available: Decimal,
  ledger: CapLedger,
  usageLedger: UsageLedger,
  effectiveDate: string,
  balanceExpiresOn: string | null,
  maxLegs: number,
): AllocationOutcome {
  const legs: PointRouteLeg[] = [];
  const stranded: StrandedAmount[] = [];
  const failures = new Map<string, LegFailure>();
  let remaining = available;
  let produced = D(0);
  let used = D(0);
  let feasiblePathCount = 0;

  while (legs.length < maxLegs && remaining.gt(0)) {
    let best: {
      readonly evaluation: LegEvaluation;
      readonly density: Decimal;
    } | null = null;
    let roundFeasible = 0;
    for (const path of paths) {
      const outcome = evaluateLeg(
        path,
        remaining,
        ledger,
        usageLedger,
        effectiveDate,
        balanceExpiresOn,
      );
      if (isFailure(outcome)) {
        if (outcome.rule_id) failures.set(outcome.rule_id, outcome);
        continue;
      }
      roundFeasible += 1;
      const consumed = decimalString(outcome.consumed);
      if (consumed.lte(0)) continue;
      const density = decimalString(outcome.leg.target_amount).div(consumed);
      if (
        !best ||
        density.gt(best.density) ||
        (density.eq(best.density) &&
          outcome.leg.leg_id.localeCompare(best.evaluation.leg.leg_id) < 0)
      )
        best = { evaluation: outcome, density };
    }
    if (legs.length === 0) feasiblePathCount = roundFeasible;
    if (!best) break;

    legs.push(best.evaluation.leg);
    stranded.push(...best.evaluation.stranded);
    for (const [key, consumption] of best.evaluation.capConsumption) {
      const current = ledger.get(key);
      if (current !== undefined) ledger.set(key, current.minus(consumption));
      usageLedger.set(key, (usageLedger.get(key) ?? D(0)).plus(consumption));
    }
    const consumed = decimalString(best.evaluation.consumed);
    used = used.plus(consumed);
    produced = produced.plus(decimalString(best.evaluation.leg.target_amount));
    remaining = remaining.minus(consumed);
  }

  const optimality: AllocationOptimality =
    legs.length === 1 && remaining.lte(0)
      ? "exact_single_leg"
      : legs.length === 1 && feasiblePathCount === 1
        ? "exact_only_route"
        : "greedy_marginal_value";

  return {
    legs,
    used,
    produced,
    stranded: mergeStranded(stranded),
    optimality,
    failures: [...failures.values()],
  };
}

function comparePlans(
  left: PointRoutePlan,
  right: PointRoutePlan,
  objective: PointRouteObjective,
): number {
  if (objective === "fastest") {
    const leftDays = left.processing_time_days_max ?? Number.MAX_SAFE_INTEGER;
    const rightDays = right.processing_time_days_max ?? Number.MAX_SAFE_INTEGER;
    if (leftDays !== rightDays) return leftDays - rightDays;
  }
  if (objective === "preserve_expiring") {
    const expiry = decimalString(right.expiry_preserved_amount).cmp(
      decimalString(left.expiry_preserved_amount),
    );
    if (expiry !== 0) return expiry;
  }
  if (objective === "maximize_value") {
    // An unvalued plan cannot be claimed to beat a valued one, so it ranks
    // below every valued plan rather than being scored at face value.
    if (left.value_status !== right.value_status)
      return left.value_status === "valued" ? -1 : 1;
    if (left.value && right.value) {
      const value = decimalString(right.value.expected_jpy).cmp(
        decimalString(left.value.expected_jpy),
      );
      if (value !== 0) return value;
    }
  }
  const amount = decimalString(right.target_amount).cmp(
    decimalString(left.target_amount),
  );
  if (amount !== 0) return amount;
  const leftDays = left.processing_time_days_max ?? Number.MAX_SAFE_INTEGER;
  const rightDays = right.processing_time_days_max ?? Number.MAX_SAFE_INTEGER;
  if (leftDays !== rightDays) return leftDays - rightDays;
  if (left.irreversible_step_count !== right.irreversible_step_count)
    return left.irreversible_step_count - right.irreversible_step_count;
  return left.plan_id.localeCompare(right.plan_id);
}

function assertRequest(input: PointRouteRequest): void {
  exactKeysWithOptional(
    input as unknown as PlainRecord,
    REQUEST_KEYS,
    REQUEST_OPTIONAL_KEYS,
    "point_route_request_shape_invalid",
  );
  if (!validDateTime(input.effective_at))
    throw new TypeError("point_route_effective_at_invalid");
  if (!OBJECTIVES.includes(input.objective))
    throw new TypeError("point_route_objective_invalid");
  if (
    input.target_asset_id !== null &&
    (typeof input.target_asset_id !== "string" ||
      !/^asset\.[a-z0-9.-]{2,80}$/u.test(input.target_asset_id))
  )
    throw new TypeError("point_route_target_invalid");
  if (
    !Number.isInteger(input.max_steps) ||
    input.max_steps < 1 ||
    input.max_steps > 6
  )
    throw new TypeError("point_route_max_steps_invalid");
  if (
    !Number.isInteger(input.max_legs) ||
    input.max_legs < 1 ||
    input.max_legs > 8
  )
    throw new TypeError("point_route_max_legs_invalid");
  if (
    !Array.isArray(input.balances) ||
    !Array.isArray(input.edges) ||
    input.balances.length < 1 ||
    input.balances.length > 64 ||
    input.edges.length > 256
  )
    throw new TypeError("point_route_collection_invalid");
  input.balances.forEach(assertBalance);
  input.edges.forEach(assertEdge);
  if (
    !Array.isArray(input.confirmed_rule_ids) ||
    input.confirmed_rule_ids.length > MAX_CONFIRMATION_IDS ||
    new Set(input.confirmed_rule_ids).size !==
      input.confirmed_rule_ids.length ||
    input.confirmed_rule_ids.some(
      (item) => typeof item !== "string" || !CONFIRMATION_ID.test(item),
    ) ||
    !input.period_source_used_by_rule ||
    typeof input.period_source_used_by_rule !== "object" ||
    Array.isArray(input.period_source_used_by_rule)
  )
    throw new TypeError("point_route_state_invalid");
  if (
    input.confirmed_prerequisite_ids !== undefined &&
    (!Array.isArray(input.confirmed_prerequisite_ids) ||
      input.confirmed_prerequisite_ids.length > MAX_CONFIRMATION_IDS ||
      new Set(input.confirmed_prerequisite_ids).size !==
        input.confirmed_prerequisite_ids.length ||
      input.confirmed_prerequisite_ids.some(
        (item) => typeof item !== "string" || !CONFIRMATION_ID.test(item),
      ))
  )
    throw new TypeError("point_route_prerequisite_state_invalid");
  for (const value of Object.values(input.period_source_used_by_rule))
    decimalString(value);
  if (
    new Set(input.edges.map((edge) => edge.rule_id)).size !== input.edges.length
  )
    throw new TypeError("point_route_rule_duplicate");
  if (
    !input.valuation ||
    typeof input.valuation !== "object" ||
    typeof input.valuation.profile_hash !== "string" ||
    !Array.isArray(input.valuation.entries)
  )
    throw new TypeError("point_route_valuation_invalid");
}

/**
 * Rank value-maximising allocations of the supplied balances.
 *
 * Every hop is still validated through `evaluateTransfer`, so no route can
 * claim a transfer the rule kernel would reject.
 */
export function optimizePointRoute(
  raw: PointRouteRequest,
): PointRouteOptimizationResult {
  const input = plainInput(
    raw,
    "point_route_input_invalid",
  ) as PointRouteRequest;
  assertRequest(input);

  const effectiveDate = input.effective_at.slice(0, 10);
  const confirmed = new Set(input.confirmed_rule_ids);
  for (const prerequisiteId of input.confirmed_prerequisite_ids ?? [])
    confirmed.add(prerequisiteId);
  const skipped = new Map<string, string>();
  const usedRuleIds = new Set<string>();

  const usableEdges = input.edges.filter((edge) => {
    const requiredRuleIds = edge.requires_rule_ids ?? [];
    const missingPrerequisite = requiredRuleIds.find(
      (required) => !confirmed.has(required),
    );
    if (missingPrerequisite !== undefined) {
      skipped.set(edge.rule_id, "prerequisite_confirmation_required");
      return false;
    }
    if (
      edge.required_conditions_ja.length > 0 &&
      requiredRuleIds.length === 0 &&
      !confirmed.has(edge.rule_id)
    ) {
      skipped.set(edge.rule_id, "condition_confirmation_required");
      return false;
    }
    if (
      edge.maximum_source_units_per_period !== null ||
      edge.period_usage_min_source_units != null ||
      edge.period_usage_max_source_units_exclusive != null
    ) {
      const used = input.period_source_used_by_rule[usageKey(edge)];
      if (used === undefined) {
        // A capped rule with unknown prior usage is not assumed to be unused.
        skipped.set(edge.rule_id, "transfer_period_usage_unknown");
        return false;
      }
    }
    return true;
  });

  const ledger: CapLedger = new Map();
  const usageLedger: UsageLedger = new Map();
  for (const edge of usableEdges) {
    const key = usageKey(edge);
    const used = decimalString(input.period_source_used_by_rule[key] ?? "0");
    if (
      edge.maximum_source_units_per_period !== null ||
      edge.period_usage_min_source_units != null ||
      edge.period_usage_max_source_units_exclusive != null
    )
      usageLedger.set(key, used);
    if (edge.maximum_source_units_per_period === null) continue;
    const maximum = decimalString(edge.maximum_source_units_per_period);
    const remaining = maximum.minus(used);
    const normalized = remaining.lt(0) ? D(0) : remaining;
    const existing = ledger.get(key);
    if (existing !== undefined && !existing.eq(normalized))
      throw new TypeError("point_route_shared_cap_conflict");
    ledger.set(key, normalized);
  }

  const plans: PointRoutePlan[] = [];
  const unvalued = new Set<string>();
  let truncated = false;

  const balances = [...input.balances].sort((left, right) =>
    left.asset.asset_id.localeCompare(right.asset.asset_id),
  );

  for (const balance of balances) {
    const enumeration = enumeratePaths(
      usableEdges,
      balance.asset.asset_id,
      input.max_steps,
    );
    truncated = truncated || enumeration.truncated;
    const byTarget = new Map<string, (readonly PointRouteEdge[])[]>();
    for (const path of enumeration.paths) {
      const terminal = path[path.length - 1];
      if (!terminal) continue;
      const terminalId = terminal.destination_asset.asset_id;
      if (
        input.target_asset_id !== null &&
        terminalId !== input.target_asset_id
      )
        continue;
      const list = byTarget.get(terminalId);
      if (list) list.push(path);
      else byTarget.set(terminalId, [path]);
    }

    const balanceExpiresOn =
      balance.expires_at === null ? null : balance.expires_at.slice(0, 10);

    for (const targetId of [...byTarget.keys()].sort()) {
      const paths = (byTarget.get(targetId) ?? []).sort((left, right) =>
        left
          .map((edge) => edge.rule_id)
          .join(">")
          .localeCompare(right.map((edge) => edge.rule_id).join(">")),
      );
      // Each target is priced against the same starting cap state; the
      // committed winner is what actually consumes the shared ledger.
      const trialLedger: CapLedger = new Map(ledger);
      const trialUsageLedger: UsageLedger = new Map(usageLedger);
      const outcome = allocate(
        paths,
        decimalString(balance.amount),
        trialLedger,
        trialUsageLedger,
        effectiveDate,
        balanceExpiresOn,
        input.max_legs,
      );
      for (const failure of outcome.failures)
        if (!skipped.has(failure.rule_id))
          skipped.set(failure.rule_id, failure.reason_code);
      if (outcome.legs.length === 0) continue;
      for (const leg of outcome.legs)
        for (const ruleId of leg.rule_ids) usedRuleIds.add(ruleId);

      const targetAsset =
        paths[0]?.[paths[0].length - 1]?.destination_asset ?? balance.asset;
      const targetAmount = canonicalDecimal(outcome.produced);
      const value = valueOfPlanTarget(
        input.valuation,
        targetAsset,
        targetAmount,
      );
      if (!value)
        unvalued.add(
          `${targetAsset.asset_id}${
            targetAsset.reward_class ? `#${targetAsset.reward_class}` : ""
          }`,
        );
      const sourceValuation = lookupValuation(
        input.valuation,
        balance.asset.asset_id,
        balance.asset.reward_class,
      );
      const projection = {
        source_asset: balance.asset,
        target_asset: targetAsset,
        source_amount_available: balance.amount,
        source_amount_used: canonicalDecimal(outcome.used),
        target_amount: targetAmount,
        value,
        value_status: (value ? "valued" : "unvalued") as "valued" | "unvalued",
        // Rate is only meaningful when both ends are priced in the same unit.
        effective_rate_percent:
          value && sourceValuation && outcome.used.gt(0)
            ? canonicalDecimal(
                decimalString(value.expected_jpy)
                  .div(
                    outcome.used.mul(
                      decimalString(sourceValuation.jpy_per_unit_expected),
                    ),
                  )
                  .mul(100)
                  .toDecimalPlaces(2),
              )
            : null,
        legs: outcome.legs,
        allocation_optimality: outcome.optimality,
        stranded: outcome.stranded,
        stranded_value_jpy: strandedValue(input.valuation, outcome.stranded),
        processing_time_days_min: outcome.legs.reduce<number | null>(
          (accumulator, leg) =>
            accumulator === null || leg.processing_time_days_min === null
              ? null
              : Math.min(accumulator, leg.processing_time_days_min),
          Number.MAX_SAFE_INTEGER,
        ),
        processing_time_days_max: outcome.legs.reduce<number | null>(
          (accumulator, leg) =>
            accumulator === null || leg.processing_time_days_max === null
              ? null
              : Math.max(accumulator, leg.processing_time_days_max),
          0,
        ),
        irreversible_step_count: outcome.legs.reduce(
          (accumulator, leg) => accumulator + leg.irreversible_step_count,
          0,
        ),
        expires_at: balance.expires_at,
        expiry_preserved_amount:
          balance.expires_at === null ? "0" : canonicalDecimal(outcome.used),
      };
      plans.push({
        plan_id: canonicalHash(projection) as `sha256:${string}`,
        ...projection,
      });
    }
  }

  for (const ruleId of usedRuleIds) skipped.delete(ruleId);
  plans.sort((left, right) => comparePlans(left, right, input.objective));

  const projection = {
    version: POINT_ROUTE_OPTIMIZER_VERSION,
    objective: input.objective,
    target_asset_id: input.target_asset_id,
    valuation_profile_hash: input.valuation.profile_hash,
    winner: plans[0] ?? null,
    plans,
    skipped: [...skipped.entries()]
      .map(([rule_id, reason_code]) => ({ rule_id, reason_code }))
      .sort((left, right) => left.rule_id.localeCompare(right.rule_id)),
    path_search_truncated: truncated,
    unvalued_asset_ids: [...unvalued].sort(),
  };
  return {
    ...projection,
    result_hash: canonicalHash(projection) as `sha256:${string}`,
  };
}
