import { Decimal } from "decimal.js";
import { canonicalDecimal, D, decimal } from "./math.js";

/** The six cap kinds in the reward-rule contract. */
export type CapType =
  | "per_operation"
  | "per_day"
  | "per_month"
  | "per_campaign"
  | "per_year"
  | "lifetime";

export type CapProgressStatus =
  | "known"
  | "estimated"
  | "unknown"
  | "not_applicable";

export type CapAvailability =
  | "available"
  | "partial"
  | "exhausted"
  | "unknown"
  | "blocked";

export type DecimalLike = string | number | bigint | Decimal;

/** A deliberately local shape so the kernel can be used before shared adapters exist. */
export interface CapRuleLike {
  cap_id: string;
  cap_type: CapType | string;
  max_reward_units: string | null;
  max_eligible_spend_jpy: number | null;
  shared_cap_group: string | null;
  progress_source?:
    | "not_required"
    | "user_input"
    | "transaction_aggregation"
    | "provider_api"
    | "unknown"
    | string;
  reset: {
    period:
      | "operation"
      | "day"
      | "month"
      | "campaign"
      | "year"
      | "never"
      | string;
    timezone: string;
    boundary:
      | "calendar"
      | "anniversary"
      | "campaign_defined"
      | "not_applicable"
      | string;
  };
  partial_consumption: boolean;
  unknown_progress_policy?:
    | "return_range"
    | "ask_user"
    | "suppress_bonus"
    | "use_lower_bound"
    | "not_applicable"
    | string;
}

export interface CapProgressLike {
  status: CapProgressStatus;
  eligible_spend_jpy_min?: number | null;
  eligible_spend_jpy_max?: number | null;
  reward_earned_units_min?: string | null;
  reward_earned_units_max?: string | null;
  period_start?: string | null;
  period_end?: string | null;
  observed_at?: string | null;
  source?: string;
}

export interface NumericRange<T extends string | number = string> {
  minimum: T;
  maximum: T | null;
  expected: T | null;
}

export interface CapCandidate {
  reward_units?: DecimalLike | undefined;
  eligible_spend_jpy?: number | null | undefined;
}

export interface CapEvaluationInput {
  cap: CapRuleLike;
  /** A progress record may be keyed by cap_id or by shared_cap_group. */
  progress?: CapProgressLike | null | undefined;
  operation_timestamp?: string | null | undefined;
  /** camelCase is accepted for adapters that expose TypeScript-native names. */
  operationTimestamp?: string | null | undefined;
  candidate?: CapCandidate | null | undefined;
  reward_units?: DecimalLike | undefined;
  eligible_spend_jpy?: number | null | undefined;
}

export interface CapEvaluation {
  cap_id: string;
  cap_type: string;
  shared_cap_group: string | null;
  progress_status: CapProgressStatus;
  /** The period actually used for this observation, if known. */
  reset_period: {
    period: string;
    timezone: string;
    boundary: string;
    start: string | null;
    end: string | null;
    applied: boolean;
    observation_in_period: boolean | null;
  };
  remaining_reward_units: NumericRange<string>;
  remaining_eligible_spend_jpy: NumericRange<number>;
  allowed_reward_units: NumericRange<string>;
  allowed_eligible_spend_jpy: NumericRange<number>;
  availability: CapAvailability;
  /** A compact derived state useful to UIs and scenario assertions. */
  state: CapAvailability;
  consumption: "none" | "full" | "partial" | "uncertain";
  policy_action:
    | "apply"
    | "apply_partial"
    | "return_range"
    | "ask_user"
    | "suppress_bonus"
    | "use_lower_bound";
  exhausted: boolean | null;
  partially_remaining: boolean | null;
  uncertain: boolean;
  reasons: string[];
  /** camelCase aliases are intentionally non-authoritative convenience fields. */
  capId: string;
  progressStatus: CapProgressStatus;
  remainingRewardUnits: NumericRange<string>;
  remainingEligibleSpendJpy: NumericRange<number>;
  allowedRewardUnits: NumericRange<string>;
  allowedEligibleSpendJpy: NumericRange<number>;
}

export interface CapsEvaluationInput {
  caps: readonly CapRuleLike[];
  /** Preferred form for user_state.cap_progress. */
  progress?: Readonly<Record<string, CapProgressLike | undefined>> | undefined;
  cap_progress?:
    | Readonly<Record<string, CapProgressLike | undefined>>
    | undefined;
  operation_timestamp?: string | null | undefined;
  operationTimestamp?: string | null | undefined;
  candidate?: CapCandidate | null | undefined;
  reward_units?: DecimalLike | undefined;
  eligible_spend_jpy?: number | null | undefined;
}

export interface SharedCapEvaluation {
  shared_cap_group: string;
  cap_ids: string[];
  evaluations: CapEvaluation[];
  availability: CapAvailability;
  state: CapAvailability;
  remaining_reward_units: NumericRange<string>;
  remaining_eligible_spend_jpy: NumericRange<number>;
  allowed_reward_units: NumericRange<string>;
  allowed_eligible_spend_jpy: NumericRange<number>;
  uncertain: boolean;
}

export interface CapsEvaluation {
  evaluations: CapEvaluation[];
  by_cap_id: Record<string, CapEvaluation>;
  shared_groups: SharedCapEvaluation[];
  allowed_reward_units: NumericRange<string>;
  allowed_eligible_spend_jpy: NumericRange<number>;
  availability: CapAvailability;
  state: CapAvailability;
  uncertain: boolean;
  cap_ids: string[];
}

type RewardRange = NumericRange<string>;
type SpendRange = NumericRange<number>;

const ZERO_REWARD: RewardRange = {
  minimum: "0",
  maximum: "0",
  expected: "0",
};
const ZERO_SPEND: SpendRange = { minimum: 0, maximum: 0, expected: 0 };

function reward(value: DecimalLike): Decimal {
  if (value instanceof Decimal) return new D(value.toString());
  if (typeof value === "number" && !Number.isSafeInteger(value))
    throw new Error("binary_number_not_allowed");
  const parsed = new D(value.toString());
  if (!parsed.isFinite() || parsed.isNegative())
    throw new Error("invalid_nonnegative_reward_units");
  return parsed;
}

function nonNegativeSpend(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error("invalid_nonnegative_eligible_spend");
  return value;
}

function decimalRange(
  minimum: Decimal,
  maximum: Decimal | null,
  expected: Decimal | null,
): RewardRange {
  const low = minimum.isNegative() ? D(0) : minimum;
  const high = maximum === null ? null : maximum.lt(low) ? low : maximum;
  const exp =
    expected === null
      ? null
      : expected.lt(low)
        ? low
        : high && expected.gt(high)
          ? high
          : expected;
  return {
    minimum: canonicalDecimal(low),
    maximum: high === null ? null : canonicalDecimal(high),
    expected: exp === null ? null : canonicalDecimal(exp),
  };
}

function spendRange(
  minimum: number,
  maximum: number | null,
  expected: number | null,
): SpendRange {
  const low = Math.max(0, Math.trunc(minimum));
  const high = maximum === null ? null : Math.max(low, Math.trunc(maximum));
  return {
    minimum: low,
    maximum: high,
    expected:
      expected === null
        ? null
        : Math.min(high ?? Math.max(low, expected), Math.max(low, expected)),
  };
}

function decimalMin(values: readonly (Decimal | null)[]): Decimal | null {
  const present = values.filter((value): value is Decimal => value !== null);
  if (present.length === 0) return null;
  return present.reduce(
    (min, value) => (value.lt(min) ? value : min),
    present[0]!,
  );
}

function numberMin(values: readonly (number | null)[]): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length === 0 ? null : Math.min(...present);
}

function isFiniteLimit(value: string | number | null): boolean {
  return value !== null;
}

function parseTimestamp(timestamp: string | null | undefined): number | null {
  if (!timestamp) return null;
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : null;
}

function iso(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

function timezoneOffsetMinutes(
  timestamp: number,
  timezone: string,
): number | null {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const parts = Object.fromEntries(
      formatter
        .formatToParts(new Date(timestamp))
        .map((part) => [part.type, part.value]),
    );
    const asUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour) === 24 ? 0 : Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
    return Math.round((asUtc - timestamp) / 60_000);
  } catch {
    return null;
  }
}

function calendarResetWindow(
  timestamp: string | null | undefined,
  period: string,
  timezone: string,
): { start: string | null; end: string | null } {
  const parsed = parseTimestamp(timestamp);
  if (parsed === null || !["day", "month", "year"].includes(period))
    return { start: null, end: null };
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts = Object.fromEntries(
      formatter
        .formatToParts(new Date(parsed))
        .map((part) => [part.type, part.value]),
    );
    const year = Number(parts.year);
    const month = Number(parts.month);
    const day = Number(parts.day);
    const startLocal = new Date(
      Date.UTC(
        year,
        period === "year" ? 0 : month - 1,
        period === "day" ? day : 1,
      ),
    );
    const endLocal =
      period === "day"
        ? new Date(Date.UTC(year, month - 1, day + 1))
        : period === "month"
          ? new Date(Date.UTC(year, month, 1))
          : new Date(Date.UTC(year + 1, 0, 1));
    const startOffset = timezoneOffsetMinutes(startLocal.getTime(), timezone);
    const endOffset = timezoneOffsetMinutes(endLocal.getTime(), timezone);
    if (startOffset === null || endOffset === null)
      return { start: null, end: null };
    return {
      start: iso(startLocal.getTime() - startOffset * 60_000),
      end: iso(endLocal.getTime() - endOffset * 60_000),
    };
  } catch {
    return { start: null, end: null };
  }
}

function resetDetails(
  cap: CapRuleLike,
  progress: CapProgressLike | null | undefined,
  operationTimestamp: string | null | undefined,
): CapEvaluation["reset_period"] {
  const period = cap.reset?.period ?? "never";
  const timezone = cap.reset?.timezone ?? "UTC";
  const boundary = cap.reset?.boundary ?? "not_applicable";
  const observedStart = progress?.period_start ?? null;
  const observedEnd = progress?.period_end ?? null;
  const derived = calendarResetWindow(operationTimestamp, period, timezone);
  const start = observedStart ?? derived.start;
  const end = observedEnd ?? derived.end;
  const operation = parseTimestamp(operationTimestamp);
  const startMs = parseTimestamp(start);
  const endMs = parseTimestamp(end);
  const inPeriod =
    operation === null || (startMs === null && endMs === null)
      ? period === "operation" || period === "never"
        ? true
        : null
      : (startMs === null || operation >= startMs) &&
        (endMs === null || operation < endMs);
  const hasReset =
    !!progress &&
    period !== "operation" &&
    inPeriod === false &&
    (startMs !== null || endMs !== null);
  return {
    period,
    timezone,
    boundary,
    start,
    end,
    applied: hasReset,
    observation_in_period: inPeriod,
  };
}

function progressRange(
  cap: CapRuleLike,
  progress: CapProgressLike | null | undefined,
  reset: CapEvaluation["reset_period"],
): {
  status: CapProgressStatus;
  rewardMin: Decimal;
  rewardMax: Decimal | null;
  rewardExpected: Decimal | null;
  spendMin: number;
  spendMax: number | null;
  spendExpected: number | null;
  uncertain: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];
  const source = cap.progress_source ?? "unknown";
  const operationReset =
    cap.cap_type === "per_operation" || cap.reset.period === "operation";
  if (reset.applied) {
    reasons.push("progress_period_does_not_match_operation_reset_applied");
    return {
      status: "known",
      rewardMin: D(0),
      rewardMax: D(0),
      rewardExpected: D(0),
      spendMin: 0,
      spendMax: 0,
      spendExpected: 0,
      uncertain: false,
      reasons,
    };
  }
  if (!progress && (operationReset || source === "not_required")) {
    reasons.push("progress_not_required_for_operation_scope");
    return {
      status: "known",
      rewardMin: D(0),
      rewardMax: D(0),
      rewardExpected: D(0),
      spendMin: 0,
      spendMax: 0,
      spendExpected: 0,
      uncertain: false,
      reasons,
    };
  }
  const status = progress?.status ?? "unknown";
  if (
    status === "not_applicable" &&
    (operationReset || source === "not_required")
  ) {
    reasons.push("progress_not_applicable_for_operation_scope");
    return {
      status,
      rewardMin: D(0),
      rewardMax: D(0),
      rewardExpected: D(0),
      spendMin: 0,
      spendMax: 0,
      spendExpected: 0,
      uncertain: false,
      reasons,
    };
  }
  if (status === "known") {
    const rewardMin = progress?.reward_earned_units_min ?? "0";
    const rewardMax = progress?.reward_earned_units_max ?? rewardMin;
    const spendMin = progress?.eligible_spend_jpy_min ?? 0;
    const spendMax = progress?.eligible_spend_jpy_max ?? spendMin;
    reasons.push("progress_known");
    return {
      status,
      rewardMin: reward(rewardMin),
      rewardMax: reward(rewardMax),
      rewardExpected: reward(rewardMin),
      spendMin: nonNegativeSpend(spendMin) ?? 0,
      spendMax: nonNegativeSpend(spendMax) ?? 0,
      spendExpected: nonNegativeSpend(spendMin) ?? 0,
      uncertain: false,
      reasons,
    };
  }
  if (status === "estimated") {
    const rewardMin = reward(progress?.reward_earned_units_min ?? "0");
    const rewardMax = reward(progress?.reward_earned_units_max ?? rewardMin);
    const spendMin = nonNegativeSpend(progress?.eligible_spend_jpy_min) ?? 0;
    const spendMax =
      nonNegativeSpend(progress?.eligible_spend_jpy_max) ?? spendMin;
    reasons.push("progress_estimated_range");
    return {
      status,
      rewardMin,
      rewardMax,
      rewardExpected: null,
      spendMin,
      spendMax,
      spendExpected: null,
      uncertain: !rewardMin.eq(rewardMax) || spendMin !== spendMax,
      reasons,
    };
  }
  reasons.push("progress_unknown_not_treated_as_zero");
  return {
    status,
    rewardMin: D(0),
    rewardMax: null,
    rewardExpected: null,
    spendMin: 0,
    spendMax: null,
    spendExpected: null,
    uncertain: true,
    reasons,
  };
}

function capLimitReward(cap: CapRuleLike): Decimal | null {
  return cap.max_reward_units === null ? null : reward(cap.max_reward_units);
}

function capLimitSpend(cap: CapRuleLike): number | null {
  return nonNegativeSpend(cap.max_eligible_spend_jpy);
}

function subtractRewardLimit(
  max: Decimal | null,
  progress: Decimal,
  limit: Decimal | null,
): Decimal | null {
  if (limit === null) return null;
  const value = limit.minus(progress);
  return value.isNegative() ? D(0) : value;
}

function subtractSpendLimit(
  max: number | null,
  progress: number,
  limit: number | null,
): number | null {
  if (limit === null) return null;
  return Math.max(0, limit - progress);
}

function requestedCandidate(input: CapEvaluationInput): CapCandidate {
  return {
    reward_units: input.candidate?.reward_units ?? input.reward_units,
    eligible_spend_jpy:
      input.candidate?.eligible_spend_jpy ?? input.eligible_spend_jpy ?? null,
  };
}

function constrainRewardBySpend(
  requested: Decimal | null,
  spend: number | null,
  remainingSpend: SpendRange,
): RewardRange | null {
  if (requested === null) return null;
  if (spend === null || spend <= 0 || remainingSpend.maximum === null)
    return decimalRange(D(0), requested, requested);
  const maxFraction = Math.min(1, remainingSpend.maximum / spend);
  const minFraction = Math.min(1, remainingSpend.minimum / spend);
  return decimalRange(
    requested.mul(minFraction),
    requested.mul(maxFraction),
    remainingSpend.expected === null
      ? null
      : requested.mul(Math.min(1, remainingSpend.expected / spend)),
  );
}

function rangeAvailability(
  remainingReward: RewardRange,
  remainingSpend: SpendRange,
  candidate: CapCandidate,
  partialConsumption: boolean,
  uncertainProgress: boolean,
): {
  allowedReward: RewardRange;
  allowedSpend: SpendRange;
  availability: CapAvailability;
  consumption: CapEvaluation["consumption"];
} {
  const requestedReward =
    candidate.reward_units === undefined || candidate.reward_units === null
      ? null
      : reward(candidate.reward_units);
  const requestedSpend = nonNegativeSpend(candidate.eligible_spend_jpy);
  const rewardMaximum =
    requestedReward === null || remainingReward.maximum === null
      ? requestedReward
        ? requestedReward
        : remainingReward.maximum === null
          ? null
          : new D(remainingReward.maximum)
      : Decimal.min(requestedReward, new D(remainingReward.maximum));
  const rewardMinimum =
    requestedReward === null
      ? D(0)
      : Decimal.min(requestedReward, new D(remainingReward.minimum));
  let allowedReward = decimalRange(
    partialConsumption
      ? rewardMinimum
      : rewardMinimum.gte(requestedReward ?? D(0))
        ? rewardMinimum
        : D(0),
    rewardMaximum,
    null,
  );

  const spendMaximum =
    requestedSpend === null || remainingSpend.maximum === null
      ? requestedSpend
      : Math.min(requestedSpend, remainingSpend.maximum);
  const spendMinimum =
    requestedSpend === null
      ? 0
      : Math.min(requestedSpend, remainingSpend.minimum);
  const spendAllowedMin =
    partialConsumption ||
    requestedSpend === null ||
    spendMinimum >= (requestedSpend ?? 0)
      ? spendMinimum
      : 0;
  let allowedSpend = spendRange(spendAllowedMin, spendMaximum, null);
  const rewardBySpend = constrainRewardBySpend(
    allowedReward.maximum === null ? null : new D(allowedReward.maximum),
    requestedSpend,
    remainingSpend,
  );
  if (rewardBySpend) {
    allowedReward = decimalRange(
      Decimal.max(
        allowedReward.minimum === "0" ? D(0) : new D(allowedReward.minimum),
        new D(rewardBySpend.minimum),
      ),
      decimalMin([
        allowedReward.maximum === null ? null : new D(allowedReward.maximum),
        rewardBySpend.maximum === null ? null : new D(rewardBySpend.maximum),
      ]),
      rewardBySpend.expected === null ? null : new D(rewardBySpend.expected),
    );
  }
  const requestedExceedsReward =
    requestedReward !== null &&
    (remainingReward.maximum === null
      ? false
      : requestedReward.gt(new D(remainingReward.maximum)));
  const requestedExceedsSpend =
    requestedSpend !== null &&
    remainingSpend.maximum !== null &&
    requestedSpend > remainingSpend.maximum;
  if (
    !partialConsumption &&
    !uncertainProgress &&
    (requestedExceedsReward || requestedExceedsSpend)
  ) {
    // A non-partial cap is all-or-nothing.  A known over-cap request cannot
    // leak a partially allowed maximum through the returned range.
    allowedReward = decimalRange(D(0), D(0), D(0));
    allowedSpend = spendRange(0, 0, 0);
  }
  const definitelyExhausted =
    remainingReward.maximum === "0" || remainingSpend.maximum === 0;
  const maybeExhausted =
    remainingReward.minimum === "0" && remainingSpend.minimum === 0;
  let availability: CapAvailability;
  let consumption: CapEvaluation["consumption"];
  if (definitelyExhausted) {
    availability = "exhausted";
    consumption = "none";
  } else if (requestedExceedsReward || requestedExceedsSpend) {
    availability = partialConsumption
      ? uncertainProgress && !maybeExhausted
        ? "unknown"
        : "partial"
      : "blocked";
    consumption = uncertainProgress
      ? "uncertain"
      : partialConsumption
        ? "partial"
        : "none";
  } else if (uncertainProgress || maybeExhausted) {
    availability = "unknown";
    consumption = "uncertain";
  } else {
    availability = "available";
    consumption = "full";
  }
  if (requestedReward === null && requestedSpend === null) {
    availability = definitelyExhausted
      ? "exhausted"
      : uncertainProgress
        ? "unknown"
        : "available";
    consumption = "uncertain";
  }
  allowedSpend = spendRange(
    allowedSpend.minimum,
    allowedSpend.maximum,
    allowedSpend.maximum === null ? null : allowedSpend.maximum,
  );
  allowedReward = decimalRange(
    new D(allowedReward.minimum),
    allowedReward.maximum === null ? null : new D(allowedReward.maximum),
    allowedReward.expected === null ? null : new D(allowedReward.expected),
  );
  return { allowedReward, allowedSpend, availability, consumption };
}

function policyAction(
  cap: CapRuleLike,
  availability: CapAvailability,
  uncertain: boolean,
): CapEvaluation["policy_action"] {
  if (!uncertain && availability === "available") return "apply";
  if (!uncertain && availability === "partial") return "apply_partial";
  switch (cap.unknown_progress_policy) {
    case "ask_user":
      return "ask_user";
    case "suppress_bonus":
      return "suppress_bonus";
    case "use_lower_bound":
      return "use_lower_bound";
    default:
      return "return_range";
  }
}

function normalizeCapInput(
  capOrInput: CapRuleLike | CapEvaluationInput,
  progress?: CapProgressLike | null,
  candidate?: CapCandidate | DecimalLike | null,
): CapEvaluationInput {
  if ("cap" in capOrInput) return capOrInput;
  const normalizedCandidate: CapCandidate | null =
    candidate === null || candidate === undefined
      ? null
      : typeof candidate === "object" && !(candidate instanceof Decimal)
        ? candidate
        : { reward_units: candidate as DecimalLike };
  return {
    cap: capOrInput,
    ...(progress === undefined ? {} : { progress }),
    candidate: normalizedCandidate,
  };
}

/** Evaluate one cap. Unknown progress never silently becomes zero. */
export function evaluateCap(input: CapEvaluationInput): CapEvaluation;
export function evaluateCap(
  cap: CapRuleLike,
  progress?: CapProgressLike | null,
  candidate?: CapCandidate | DecimalLike | null,
): CapEvaluation;
export function evaluateCap(
  capOrInput: CapRuleLike | CapEvaluationInput,
  progress?: CapProgressLike | null,
  candidate?: CapCandidate | DecimalLike | null,
): CapEvaluation {
  const input = normalizeCapInput(capOrInput, progress, candidate);
  const cap = input.cap;
  const operationTimestamp =
    input.operation_timestamp ?? input.operationTimestamp ?? null;
  const reset = resetDetails(cap, input.progress, operationTimestamp);
  const current = progressRange(cap, input.progress, reset);
  const rewardLimit = capLimitReward(cap);
  const spendLimit = capLimitSpend(cap);
  // For an unknown observation, the only safe bounded assumption is that the
  // cap may be unused through fully consumed.  Keep that interval explicit:
  // remaining = [0, limit], never [limit, limit].
  const rewardProgressForMin =
    current.status === "unknown" && rewardLimit !== null
      ? rewardLimit
      : (current.rewardMax ?? D(0));
  const rewardProgressForMax =
    current.status === "unknown" ? D(0) : current.rewardMin;
  const spendProgressForMin =
    current.status === "unknown" && spendLimit !== null
      ? spendLimit
      : (current.spendMax ?? 0);
  const spendProgressForMax =
    current.status === "unknown" ? 0 : current.spendMin;
  const remainingReward = decimalRange(
    subtractRewardLimit(rewardLimit, rewardProgressForMin, rewardLimit) ?? D(0),
    subtractRewardLimit(rewardLimit, rewardProgressForMax, rewardLimit),
    current.rewardExpected === null || rewardLimit === null
      ? null
      : subtractRewardLimit(rewardLimit, current.rewardExpected, rewardLimit),
  );
  const remainingSpend = spendRange(
    subtractSpendLimit(spendLimit, spendProgressForMin, spendLimit) ?? 0,
    subtractSpendLimit(spendLimit, spendProgressForMax, spendLimit),
    current.spendExpected === null || spendLimit === null
      ? null
      : subtractSpendLimit(spendLimit, current.spendExpected, spendLimit),
  );
  // An unbounded limit is represented as null maximum.  If no limit exists at all,
  // the remaining range is intentionally unbounded rather than a fake zero.
  const noRewardLimit = rewardLimit === null;
  const noSpendLimit = spendLimit === null;
  const normalizedRemainingReward = noRewardLimit
    ? { minimum: "0", maximum: null, expected: null }
    : remainingReward;
  const normalizedRemainingSpend = noSpendLimit
    ? { minimum: 0, maximum: null, expected: null }
    : remainingSpend;
  const constrained = rangeAvailability(
    normalizedRemainingReward,
    normalizedRemainingSpend,
    requestedCandidate(input),
    cap.partial_consumption,
    current.uncertain,
  );
  const uncertain = current.uncertain || constrained.availability === "unknown";
  const availability = constrained.availability;
  const result: CapEvaluation = {
    cap_id: cap.cap_id,
    cap_type: cap.cap_type,
    shared_cap_group: cap.shared_cap_group ?? null,
    progress_status: current.status,
    reset_period: reset,
    remaining_reward_units: normalizedRemainingReward,
    remaining_eligible_spend_jpy: normalizedRemainingSpend,
    allowed_reward_units: constrained.allowedReward,
    allowed_eligible_spend_jpy: constrained.allowedSpend,
    availability,
    state: availability,
    consumption: constrained.consumption,
    policy_action: policyAction(cap, availability, uncertain),
    exhausted:
      normalizedRemainingReward.maximum === null &&
      normalizedRemainingSpend.maximum === null
        ? null
        : normalizedRemainingReward.maximum === "0" ||
          normalizedRemainingSpend.maximum === 0,
    partially_remaining:
      normalizedRemainingReward.maximum === null &&
      normalizedRemainingSpend.maximum === null
        ? null
        : (normalizedRemainingReward.minimum !== "0" ||
            normalizedRemainingSpend.minimum !== 0) &&
          (normalizedRemainingReward.maximum !== "0" ||
            normalizedRemainingSpend.maximum !== 0),
    uncertain,
    reasons: [
      ...current.reasons,
      ...(reset.applied ? ["reset_applied"] : []),
    ].sort(),
    capId: cap.cap_id,
    progressStatus: current.status,
    remainingRewardUnits: normalizedRemainingReward,
    remainingEligibleSpendJpy: normalizedRemainingSpend,
    allowedRewardUnits: constrained.allowedReward,
    allowedEligibleSpendJpy: constrained.allowedSpend,
  };
  return result;
}

function combineRewardRanges(ranges: readonly RewardRange[]): RewardRange {
  if (ranges.length === 0) return { ...ZERO_REWARD };
  // The effective consumption is the minimum permitted amount across all
  // constraints.  Lower bounds therefore use the minimum as well; taking the
  // maximum lower bound would manufacture an impossible exact range when two
  // known caps have different maxima.
  const minimum = ranges.reduce(
    (value, item) => Decimal.min(value, new D(item.minimum)),
    new D(ranges[0]!.minimum),
  );
  const maximum = decimalMin(
    ranges.map((item) => (item.maximum === null ? null : new D(item.maximum))),
  );
  const expected = decimalMin(
    ranges.map((item) =>
      item.expected === null ? null : new D(item.expected),
    ),
  );
  return decimalRange(minimum, maximum, expected);
}

function combineSpendRanges(ranges: readonly SpendRange[]): SpendRange {
  if (ranges.length === 0) return { ...ZERO_SPEND };
  const minimum = ranges.reduce(
    (value, item) => Math.min(value, item.minimum),
    ranges[0]!.minimum,
  );
  const maximum = numberMin(ranges.map((item) => item.maximum));
  const expected = numberMin(ranges.map((item) => item.expected));
  return spendRange(minimum, maximum, expected);
}

function combineAvailability(
  evaluations: readonly CapEvaluation[],
): CapAvailability {
  if (evaluations.some((item) => item.availability === "exhausted"))
    return "exhausted";
  if (evaluations.some((item) => item.availability === "blocked"))
    return "blocked";
  if (evaluations.some((item) => item.availability === "unknown"))
    return "unknown";
  if (evaluations.some((item) => item.availability === "partial"))
    return "partial";
  return "available";
}

function normalizeCapsInput(
  capsOrInput: readonly CapRuleLike[] | CapsEvaluationInput,
  progress?: Readonly<Record<string, CapProgressLike | undefined>>,
  candidate?: CapCandidate | null,
): CapsEvaluationInput {
  if (!Array.isArray(capsOrInput) && "caps" in capsOrInput) return capsOrInput;
  return {
    caps: capsOrInput,
    ...(progress === undefined ? {} : { progress }),
    ...(candidate === undefined ? {} : { candidate }),
  };
}

/** Evaluate all caps and collapse shared groups to one conservative pool. */
export function evaluateCaps(input: CapsEvaluationInput): CapsEvaluation;
export function evaluateCaps(
  caps: readonly CapRuleLike[],
  progress?: Readonly<Record<string, CapProgressLike | undefined>>,
  candidate?: CapCandidate | null,
): CapsEvaluation;
export function evaluateCaps(
  capsOrInput: readonly CapRuleLike[] | CapsEvaluationInput,
  progress?: Readonly<Record<string, CapProgressLike | undefined>>,
  candidate?: CapCandidate | null,
): CapsEvaluation {
  const input = normalizeCapsInput(capsOrInput, progress, candidate);
  const progressMap = input.progress ?? input.cap_progress ?? {};
  const operationTimestamp =
    input.operation_timestamp ?? input.operationTimestamp ?? null;
  const evaluations = input.caps
    .slice()
    .sort((left, right) => left.cap_id.localeCompare(right.cap_id))
    .map((cap) => {
      const key = cap.shared_cap_group ?? cap.cap_id;
      const observation = progressMap[key] ?? progressMap[cap.cap_id];
      return evaluateCap({
        cap,
        progress: observation,
        operation_timestamp: operationTimestamp,
        candidate: input.candidate,
        reward_units: input.reward_units,
        eligible_spend_jpy: input.eligible_spend_jpy,
      });
    });
  const groups = new Map<string, CapEvaluation[]>();
  for (const evaluation of evaluations) {
    if (!evaluation.shared_cap_group) continue;
    const group = groups.get(evaluation.shared_cap_group) ?? [];
    group.push(evaluation);
    groups.set(evaluation.shared_cap_group, group);
  }
  const sharedGroups: SharedCapEvaluation[] = [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([group, items]) => {
      const availability = combineAvailability(items);
      return {
        shared_cap_group: group,
        cap_ids: items.map((item) => item.cap_id).sort(),
        evaluations: items,
        availability,
        state: availability,
        remaining_reward_units: combineRewardRanges(
          items.map((item) => item.remaining_reward_units),
        ),
        remaining_eligible_spend_jpy: combineSpendRanges(
          items.map((item) => item.remaining_eligible_spend_jpy),
        ),
        allowed_reward_units: combineRewardRanges(
          items.map((item) => item.allowed_reward_units),
        ),
        allowed_eligible_spend_jpy: combineSpendRanges(
          items.map((item) => item.allowed_eligible_spend_jpy),
        ),
        uncertain: items.some((item) => item.uncertain),
      };
    });
  const effective = [
    ...evaluations,
    ...sharedGroups.map((group) => ({
      ...group,
      allowed_reward_units: group.allowed_reward_units,
      allowed_eligible_spend_jpy: group.allowed_eligible_spend_jpy,
    })),
  ];
  const effectiveAvailability = combineAvailability(evaluations);
  return {
    evaluations,
    by_cap_id: Object.fromEntries(
      evaluations.map((item) => [item.cap_id, item]),
    ),
    shared_groups: sharedGroups,
    allowed_reward_units: combineRewardRanges(
      effective.map((item) => item.allowed_reward_units),
    ),
    allowed_eligible_spend_jpy: combineSpendRanges(
      effective.map((item) => item.allowed_eligible_spend_jpy),
    ),
    availability: effectiveAvailability,
    state: effectiveAvailability,
    uncertain: evaluations.some((item) => item.uncertain),
    cap_ids: evaluations.map((item) => item.cap_id),
  };
}

export const applyCap = evaluateCap;
export const applyCaps = evaluateCaps;
export const evaluateCapProgress = evaluateCap;
