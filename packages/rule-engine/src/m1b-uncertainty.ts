import { Decimal } from "decimal.js";
import { canonicalDecimal, D } from "./math.js";

export type UncertaintyNumber = string | number | bigint | Decimal;

export type ProbabilityPolicy =
  | "guaranteed_only"
  | "expected_if_official_probability"
  | "include_user_estimate"
  | string;

export interface ProbabilisticComponentLike {
  value?: UncertaintyNumber;
  value_jpy?: UncertaintyNumber;
  valueJpy?: UncertaintyNumber;
  sign?: "credit" | "debit" | "positive" | "negative" | string;
  certainty?: "guaranteed" | "probabilistic" | "conditional_selection" | string;
  probability?: UncertaintyNumber | null;
  probability_source?:
    | "official_disclosed"
    | "historical_estimate"
    | "undisclosed"
    | null
    | string;
  probabilitySource?:
    | "official_disclosed"
    | "historical_estimate"
    | "undisclosed"
    | null
    | string;
  rule_id?: string;
  component_id?: string;
  [key: string]: unknown;
}

export interface ProbabilitySeparation {
  guaranteed_value_jpy: string;
  probabilistic_expected_value_jpy: string;
  expected_value_jpy: string;
  included_probabilistic_component_ids: string[];
  excluded_probabilistic_component_ids: string[];
  excluded_reasons: Record<string, string>;
  guaranteedValueJpy: string;
  probabilisticExpectedValueJpy: string;
  expectedValueJpy: string;
}

export interface JpyRange {
  minimum_jpy: string;
  maximum_jpy: string;
  expected_jpy: string | null;
}

export interface FeasibleStatePlanValue {
  value?: FeasiblePlanValueInput;
  guaranteed_value?: FeasiblePlanValueInput;
  guaranteedValue?: FeasiblePlanValueInput;
  expected_value?: FeasiblePlanValueInput;
  expectedValue?: FeasiblePlanValueInput;
  minimum?: UncertaintyNumber;
  maximum?: UncertaintyNumber;
  expected?: UncertaintyNumber | null;
  minimum_jpy?: UncertaintyNumber;
  maximum_jpy?: UncertaintyNumber;
  expected_jpy?: UncertaintyNumber | null;
  eligible?: boolean;
  components?: readonly ProbabilisticComponentLike[];
  probabilistic_components?: readonly ProbabilisticComponentLike[];
  probabilisticComponents?: readonly ProbabilisticComponentLike[];
  conditions?: readonly string[];
  [key: string]: unknown;
}

export type FeasiblePlanValueInput =
  | UncertaintyNumber
  | FeasibleStatePlanValue
  | JpyRange;

export interface FeasibleState {
  state_id?: string;
  stateId?: string;
  assignments?: Readonly<Record<string, unknown>>;
  unknown_keys?: readonly string[];
  unknownKeys?: readonly string[];
  conditions?: readonly string[];
  questions?: Readonly<Record<string, string>>;
  plans?: Readonly<Record<string, FeasiblePlanValueInput>>;
  values?: Readonly<Record<string, FeasiblePlanValueInput>>;
}

export interface FeasiblePlan {
  plan_id?: string;
  planId?: string;
  values?: Readonly<Record<string, FeasiblePlanValueInput>>;
  feasible_states?: readonly FeasiblePlanState[];
  feasibleStates?: readonly FeasiblePlanState[];
  value?: FeasiblePlanValueInput;
  guaranteed_value?: FeasiblePlanValueInput;
  guaranteedValue?: FeasiblePlanValueInput;
  [key: string]: unknown;
}

export interface FeasiblePlanState {
  state_id?: string;
  stateId?: string;
  value?: FeasiblePlanValueInput;
  guaranteed_value?: FeasiblePlanValueInput;
  guaranteedValue?: FeasiblePlanValueInput;
  expected_value?: FeasiblePlanValueInput;
  expectedValue?: FeasiblePlanValueInput;
  eligible?: boolean;
  assignments?: Readonly<Record<string, unknown>>;
  conditions?: readonly string[];
}

export interface FeasibleEvaluationOptions {
  objective?:
    | "maximize_guaranteed"
    | "maximize_expected"
    | "guaranteed"
    | "expected"
    | string;
  probability_policy?: ProbabilityPolicy;
  probabilityPolicy?: ProbabilityPolicy;
  questions?: Readonly<Record<string, string>>;
}

export interface FeasibleEvaluationInput extends FeasibleEvaluationOptions {
  states?: readonly FeasibleState[];
  feasible_states?: readonly FeasibleState[];
  feasibleStates?: readonly FeasibleState[];
  plans?: readonly FeasiblePlan[];
}

export interface StateRanking {
  state_id: string;
  winner_plan_id: string | null;
  possible_winner_plan_ids: string[];
  eligible_plan_ids: string[];
  rankings: Array<{
    plan_id: string;
    value_range_jpy: JpyRange;
    robust: boolean;
  }>;
  conditions: string[];
  assignments: Record<string, unknown>;
}

export interface ConditionalWinner {
  plan_id: string;
  conditions: string[];
  value_range_jpy: JpyRange;
}

export interface ResolutionQuestion {
  fact_key: string;
  question: string;
  could_change_winner: boolean;
}

export interface PlanFeasibleSummary {
  plan_id: string;
  value_range_jpy: JpyRange;
  possible_winner: boolean;
  state_ids: string[];
  eligible_all_states?: boolean;
  guaranteed_worst_case_jpy: string | null;
  expected_worst_case_jpy: string | null;
}

export interface FeasibleEvaluationResult {
  outcome_mode: "definite" | "conditional" | "no_valid_plan";
  definite_winner_plan_id: string | null;
  safe_plan_id: string | null;
  runner_up_plan_id: string | null;
  conditional_winners: ConditionalWinner[];
  questions_to_resolve: ResolutionQuestion[];
  states: StateRanking[];
  plan_summaries: PlanFeasibleSummary[];
  warnings: string[];
  guaranteed_ranking: string[];
  expected_ranking: string[];
  enumerated_state_ids: string[];
  /** Schema-shaped aliases used by scenario adapters. */
  outcomeMode: "definite" | "conditional" | "no_valid_plan";
  definiteWinnerPlanId: string | null;
  safePlanId: string | null;
  runnerUpPlanId: string | null;
  conditionalWinners: ConditionalWinner[];
  questionsToResolve: ResolutionQuestion[];
}

export interface RankedPlan {
  plan_id: string;
  value_jpy: string;
  rank: number;
}

function numeric(value: UncertaintyNumber): Decimal {
  if (value instanceof Decimal) return new D(value.toString());
  if (typeof value === "number" && !Number.isSafeInteger(value))
    throw new Error("binary_number_not_allowed");
  const parsed = new D(value.toString());
  if (!parsed.isFinite()) throw new Error("invalid_uncertainty_number");
  return parsed;
}

function signedValue(component: ProbabilisticComponentLike): Decimal {
  const value = numeric(
    component.value_jpy ?? component.valueJpy ?? component.value ?? 0,
  );
  const sign = component.sign;
  return sign === "debit" || sign === "negative" ? value.neg() : value;
}

function componentId(
  component: ProbabilisticComponentLike,
  index: number,
): string {
  return component.component_id ?? component.rule_id ?? `component_${index}`;
}

function probabilityAllowed(
  component: ProbabilisticComponentLike,
  policy: ProbabilityPolicy,
): { probability: Decimal | null; reason?: string } {
  if ((component.certainty ?? "guaranteed") !== "probabilistic")
    return { probability: null };
  const source =
    component.probability_source ?? component.probabilitySource ?? null;
  if (source === "undisclosed" || source === null || source === undefined)
    return { probability: null, reason: "probability_not_supported" };
  if (policy === "guaranteed_only")
    return {
      probability: null,
      reason: "guaranteed_objective_excludes_probability",
    };
  if (
    policy === "expected_if_official_probability" &&
    source !== "official_disclosed"
  )
    return { probability: null, reason: "probability_source_not_official" };
  if (
    policy === "include_user_estimate" &&
    source !== "official_disclosed" &&
    source !== "historical_estimate"
  )
    return { probability: null, reason: "probability_source_not_supported" };
  if (component.probability === null || component.probability === undefined)
    return { probability: null, reason: "probability_missing" };
  const probability = numeric(component.probability);
  if (probability.lt(0) || probability.gt(1))
    return { probability: null, reason: "probability_out_of_range" };
  return { probability };
}

/** Separate guaranteed value from supported probabilistic expected value. */
export function separateProbabilisticComponents(
  components: readonly ProbabilisticComponentLike[],
  options: {
    probability_policy?: ProbabilityPolicy;
    probabilityPolicy?: ProbabilityPolicy;
  } = {},
): ProbabilitySeparation {
  const policy =
    options.probability_policy ??
    options.probabilityPolicy ??
    "guaranteed_only";
  let guaranteed = D(0);
  let probabilisticExpected = D(0);
  const included: string[] = [];
  const excluded: string[] = [];
  const excludedReasons: Record<string, string> = {};
  components.forEach((component, index) => {
    const id = componentId(component, index);
    const value = signedValue(component);
    const certainty = component.certainty ?? "guaranteed";
    if (certainty === "guaranteed") {
      guaranteed = guaranteed.plus(value);
      return;
    }
    const allowed = probabilityAllowed(component, policy);
    if (allowed.probability === null) {
      excluded.push(id);
      excludedReasons[id] = allowed.reason ?? "probability_not_supported";
      return;
    }
    probabilisticExpected = probabilisticExpected.plus(
      value.mul(allowed.probability),
    );
    included.push(id);
  });
  const guaranteedValue = canonicalDecimal(guaranteed);
  const probabilisticValue = canonicalDecimal(probabilisticExpected);
  const expectedValue = canonicalDecimal(
    guaranteed.plus(probabilisticExpected),
  );
  return {
    guaranteed_value_jpy: guaranteedValue,
    probabilistic_expected_value_jpy: probabilisticValue,
    expected_value_jpy: expectedValue,
    included_probabilistic_component_ids: included.sort(),
    excluded_probabilistic_component_ids: excluded.sort(),
    excluded_reasons: excludedReasons,
    guaranteedValueJpy: guaranteedValue,
    probabilisticExpectedValueJpy: probabilisticValue,
    expectedValueJpy: expectedValue,
  };
}

export const separateProbabilisticValue = separateProbabilisticComponents;

function exactRange(value: Decimal): JpyRange {
  const text = canonicalDecimal(value);
  return { minimum_jpy: text, maximum_jpy: text, expected_jpy: text };
}

function rangeValue(
  minimum: Decimal,
  maximum: Decimal,
  expected: Decimal | null,
): JpyRange {
  const low = Decimal.min(minimum, maximum);
  const high = Decimal.max(minimum, maximum);
  const exp =
    expected === null ? null : Decimal.max(low, Decimal.min(high, expected));
  return {
    minimum_jpy: canonicalDecimal(low),
    maximum_jpy: canonicalDecimal(high),
    expected_jpy: exp === null ? null : canonicalDecimal(exp),
  };
}

function parseRange(input: FeasiblePlanValueInput | undefined): JpyRange {
  if (input === undefined) return exactRange(D(0));
  if (typeof input !== "object" || input instanceof Decimal)
    return exactRange(numeric(input as UncertaintyNumber));
  const candidate = input as FeasibleStatePlanValue;
  const minimum = candidate.minimum_jpy ?? candidate.minimum;
  const maximum = candidate.maximum_jpy ?? candidate.maximum;
  const expected = candidate.expected_jpy ?? candidate.expected;
  if (minimum !== undefined || maximum !== undefined) {
    const low = numeric(minimum ?? maximum ?? 0);
    const high = numeric(maximum ?? minimum ?? 0);
    const exp =
      expected === null || expected === undefined ? null : numeric(expected);
    return rangeValue(low, high, exp);
  }
  const direct =
    candidate.value ?? candidate.guaranteed_value ?? candidate.guaranteedValue;
  if (direct !== undefined) return parseRange(direct);
  return exactRange(D(0));
}

function planValue(
  input: FeasiblePlanValueInput | undefined,
  policy: ProbabilityPolicy,
): {
  guaranteed: JpyRange;
  expected: JpyRange;
  eligible: boolean;
  conditions: string[];
} {
  if (input === undefined) {
    return {
      guaranteed: exactRange(D(0)),
      expected: exactRange(D(0)),
      eligible: true,
      conditions: [],
    };
  }
  if (typeof input !== "object" || input instanceof Decimal) {
    const exact = parseRange(input);
    return {
      guaranteed: exact,
      expected: exact,
      eligible: true,
      conditions: [],
    };
  }
  const value = input as FeasibleStatePlanValue;
  const eligible = value.eligible !== false;
  const components =
    value.components ??
    value.probabilistic_components ??
    value.probabilisticComponents;
  const base = value.guaranteed_value ?? value.guaranteedValue ?? value.value;
  let guaranteed = parseRange(base ?? value);
  let expected = parseRange(
    value.expected_value ?? value.expectedValue ?? base ?? value,
  );
  if (components && components.length > 0) {
    const separated = separateProbabilisticComponents(components, {
      probability_policy: policy,
    });
    const guaranteedComponent = numeric(separated.guaranteed_value_jpy);
    const expectedComponent = numeric(separated.expected_value_jpy);
    const baseGuaranteed =
      base === undefined
        ? D(0)
        : parseRange(base).expected_jpy === null
          ? D(0)
          : numeric(parseRange(base).expected_jpy!);
    guaranteed = exactRange(baseGuaranteed.plus(guaranteedComponent));
    expected = exactRange(baseGuaranteed.plus(expectedComponent));
  }
  return {
    guaranteed,
    expected,
    eligible,
    conditions: [...(value.conditions ?? [])].sort(),
  };
}

function stateId(state: FeasibleState, index: number): string {
  return state.state_id ?? state.stateId ?? `state_${index}`;
}

function planId(plan: FeasiblePlan, index: number): string {
  return plan.plan_id ?? plan.planId ?? `plan_${index}`;
}

function statePlans(
  state: FeasibleState,
): Readonly<Record<string, FeasiblePlanValueInput>> {
  return state.plans ?? state.values ?? {};
}

function stateConditionStrings(state: FeasibleState): string[] {
  const explicit = [...(state.conditions ?? [])];
  const assignments = state.assignments ?? {};
  const derived = Object.entries(assignments)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${String(value)}`);
  return [...new Set([...explicit, ...derived])];
}

function compareRanges(
  left: JpyRange,
  right: JpyRange,
): { lower: number; upper: number } {
  const lower = numeric(left.minimum_jpy).comparedTo(
    numeric(right.maximum_jpy),
  );
  const upper = numeric(left.maximum_jpy).comparedTo(
    numeric(right.minimum_jpy),
  );
  return { lower, upper };
}

function robustWinner(
  plans: Array<{
    plan_id: string;
    value_range_jpy: JpyRange;
    eligible: boolean;
  }>,
): string | null {
  const eligible = plans.filter((plan) => plan.eligible);
  if (eligible.length === 0) return null;
  const robust = eligible.filter((candidate) =>
    eligible.every(
      (other) =>
        other.plan_id === candidate.plan_id ||
        numeric(candidate.value_range_jpy.minimum_jpy).gt(
          numeric(other.value_range_jpy.maximum_jpy),
        ),
    ),
  );
  return robust.length === 1 ? robust[0]!.plan_id : null;
}

function possibleWinners(
  plans: Array<{
    plan_id: string;
    value_range_jpy: JpyRange;
    eligible: boolean;
  }>,
): string[] {
  const eligible = plans.filter((plan) => plan.eligible);
  return eligible
    .filter((candidate) =>
      eligible.every(
        (other) =>
          other.plan_id === candidate.plan_id ||
          numeric(candidate.value_range_jpy.maximum_jpy).gte(
            numeric(other.value_range_jpy.minimum_jpy),
          ),
      ),
    )
    .map((plan) => plan.plan_id)
    .sort();
}

function aggregateRanges(values: readonly JpyRange[]): JpyRange {
  if (values.length === 0) return exactRange(D(0));
  const min = values.reduce(
    (value, item) => Decimal.min(value, numeric(item.minimum_jpy)),
    numeric(values[0]!.minimum_jpy),
  );
  const max = values.reduce(
    (value, item) => Decimal.max(value, numeric(item.maximum_jpy)),
    numeric(values[0]!.maximum_jpy),
  );
  const expectedValues = values
    .map((item) => item.expected_jpy)
    .filter((item): item is string => item !== null);
  const expected =
    expectedValues.length === values.length &&
    new Set(expectedValues).size === 1
      ? numeric(expectedValues[0]!)
      : null;
  return rangeValue(min, max, expected);
}

function explicitStatesFromPlans(
  plans: readonly FeasiblePlan[],
  policy: ProbabilityPolicy,
): FeasibleState[] {
  const stateIds = new Set<string>();
  for (const plan of plans) {
    for (const state of plan.feasible_states ?? plan.feasibleStates ?? [])
      stateIds.add(state.state_id ?? state.stateId ?? "state_0");
    for (const key of Object.keys(plan.values ?? {})) stateIds.add(key);
  }
  if (stateIds.size === 0) {
    return [
      {
        state_id: "state_0",
        plans: Object.fromEntries(
          plans.map((plan, index) => [
            planId(plan, index),
            plan.value ?? plan.guaranteed_value ?? plan.guaranteedValue ?? 0,
          ]),
        ),
        conditions: ["only_explicit_state_available"],
      },
    ];
  }
  return [...stateIds].sort().map((id) => {
    const values: Record<string, FeasiblePlanValueInput> = {};
    plans.forEach((plan, index) => {
      const planStates = plan.feasible_states ?? plan.feasibleStates ?? [];
      const found = planStates.find(
        (state) => (state.state_id ?? state.stateId) === id,
      );
      const mapped = plan.values?.[id];
      if (found) {
        values[planId(plan, index)] = {
          ...(found.value !== undefined ? { value: found.value } : {}),
          ...(found.guaranteed_value !== undefined
            ? { guaranteed_value: found.guaranteed_value }
            : {}),
          ...(found.guaranteedValue !== undefined
            ? { guaranteedValue: found.guaranteedValue }
            : {}),
          ...(found.expected_value !== undefined
            ? { expected_value: found.expected_value }
            : {}),
          ...(found.expectedValue !== undefined
            ? { expectedValue: found.expectedValue }
            : {}),
          ...(found.eligible !== undefined ? { eligible: found.eligible } : {}),
          ...(found.conditions !== undefined
            ? { conditions: found.conditions }
            : {}),
        };
      } else if (mapped !== undefined) values[planId(plan, index)] = mapped;
    });
    return { state_id: id, plans: values };
  });
}

function normalizeEvaluationInput(
  inputOrStates: readonly FeasibleState[] | FeasibleEvaluationInput,
  options: FeasibleEvaluationOptions = {},
): FeasibleEvaluationInput {
  if (Array.isArray(inputOrStates))
    return { ...options, states: inputOrStates as readonly FeasibleState[] };
  return inputOrStates as FeasibleEvaluationInput;
}

function questionFor(
  key: string,
  states: readonly FeasibleState[],
  options: FeasibleEvaluationOptions,
): string {
  for (const state of states) {
    const question = state.questions?.[key];
    if (question) return question;
  }
  if (options.questions?.[key]) return options.questions[key]!;
  return `What is the value of ${key}?`;
}

/**
 * Evaluate only the explicitly supplied compatible states.  This is the
 * uncertainty boundary: no Cartesian product of independent per-fact maxima
 * is generated here.
 */
export function evaluateFeasibleStates(
  input: FeasibleEvaluationInput,
): FeasibleEvaluationResult;
export function evaluateFeasibleStates(
  states: readonly FeasibleState[],
  options?: FeasibleEvaluationOptions,
): FeasibleEvaluationResult;
export function evaluateFeasibleStates(
  inputOrStates: readonly FeasibleState[] | FeasibleEvaluationInput,
  options: FeasibleEvaluationOptions = {},
): FeasibleEvaluationResult {
  const input = normalizeEvaluationInput(inputOrStates, options);
  const probabilityPolicy =
    input.probability_policy ?? input.probabilityPolicy ?? "guaranteed_only";
  const explicit =
    input.states ?? input.feasible_states ?? input.feasibleStates;
  const plansInput = input.plans ?? [];
  const states = explicit
    ? [...explicit]
    : explicitStatesFromPlans(plansInput, probabilityPolicy);
  const warnings: string[] = [];
  if (!explicit) warnings.push("only_explicit_feasible_states_are_evaluated");
  const rankings: StateRanking[] = [];
  const planValueByState = new Map<
    string,
    Map<
      string,
      {
        guaranteed: JpyRange;
        expected: JpyRange;
        eligible: boolean;
        conditions: string[];
      }
    >
  >();
  const planIds = new Set<string>();
  states.forEach((state, index) => {
    const id = stateId(state, index);
    const values = statePlans(state);
    const rows: Array<{
      plan_id: string;
      value_range_jpy: JpyRange;
      eligible: boolean;
      expected_range_jpy: JpyRange;
      conditions: string[];
    }> = [];
    for (const [rawPlanId, rawValue] of Object.entries(values).sort(
      ([left], [right]) => left.localeCompare(right),
    )) {
      const parsed = planValue(rawValue, probabilityPolicy);
      planIds.add(rawPlanId);
      if (!planValueByState.has(rawPlanId))
        planValueByState.set(rawPlanId, new Map());
      planValueByState.get(rawPlanId)!.set(id, parsed);
      rows.push({
        plan_id: rawPlanId,
        value_range_jpy: parsed.guaranteed,
        expected_range_jpy: parsed.expected,
        eligible: parsed.eligible,
        conditions: parsed.conditions,
      });
    }
    const objectiveExpected = (
      input.objective ?? "maximize_guaranteed"
    ).includes("expected");
    const objectiveRows = rows.map((row) => ({
      plan_id: row.plan_id,
      value_range_jpy: objectiveExpected
        ? row.expected_range_jpy
        : row.value_range_jpy,
      eligible: row.eligible,
    }));
    const robust = robustWinner(objectiveRows);
    const possible = possibleWinners(objectiveRows);
    rankings.push({
      state_id: id,
      winner_plan_id: robust,
      possible_winner_plan_ids: possible,
      eligible_plan_ids: objectiveRows
        .filter((row) => row.eligible)
        .map((row) => row.plan_id)
        .sort(),
      rankings: objectiveRows
        .sort(
          (left, right) =>
            numeric(right.value_range_jpy.maximum_jpy).comparedTo(
              numeric(left.value_range_jpy.maximum_jpy),
            ) || left.plan_id.localeCompare(right.plan_id),
        )
        .map((row) => ({
          plan_id: row.plan_id,
          value_range_jpy: row.value_range_jpy,
          robust: row.plan_id === robust,
        })),
      conditions: [
        ...stateConditionStrings(state),
        ...rows.flatMap((row) => row.conditions),
      ]
        .filter((value, index, all) => all.indexOf(value) === index)
        .sort(),
      assignments: { ...(state.assignments ?? {}) },
    });
  });
  const stateWinners = rankings
    .map((ranking) => ranking.winner_plan_id)
    .filter((id): id is string => id !== null);
  const possibleWinnersAll = new Set(
    rankings.flatMap((ranking) => ranking.possible_winner_plan_ids),
  );
  const objectiveExpected = (input.objective ?? "maximize_guaranteed").includes(
    "expected",
  );
  const summaries: PlanFeasibleSummary[] = [...planIds].sort().map((id) => {
    const values = [...(planValueByState.get(id)?.values() ?? [])];
    const selected = values.map((value) =>
      objectiveExpected ? value.expected : value.guaranteed,
    );
    const worst =
      selected.length === 0
        ? null
        : selected.reduce(
            (value, item) => Decimal.min(value, numeric(item.minimum_jpy)),
            numeric(selected[0]!.minimum_jpy),
          );
    return {
      plan_id: id,
      value_range_jpy: aggregateRanges(selected),
      possible_winner: possibleWinnersAll.has(id),
      state_ids: [...(planValueByState.get(id)?.keys() ?? [])].sort(),
      eligible_all_states:
        values.length === rankings.length &&
        values.every((value) => value.eligible),
      guaranteed_worst_case_jpy:
        values.length === 0
          ? null
          : canonicalDecimal(
              values.reduce(
                (value, item) =>
                  Decimal.min(value, numeric(item.guaranteed.minimum_jpy)),
                numeric(values[0]!.guaranteed.minimum_jpy),
              ),
            ),
      expected_worst_case_jpy: worst === null ? null : canonicalDecimal(worst),
    };
  });
  const robustInvariant =
    rankings.length > 0 &&
    rankings.every((ranking) => ranking.winner_plan_id !== null) &&
    new Set(stateWinners).size === 1;
  const definiteWinner = robustInvariant ? stateWinners[0]! : null;
  const conditionalIds = [...possibleWinnersAll].sort();
  const conditionalWinners: ConditionalWinner[] = conditionalIds.map((id) => {
    const stateIds = rankings
      .filter((ranking) => ranking.possible_winner_plan_ids.includes(id))
      .map((ranking) => ranking.state_id);
    const values = stateIds
      .map((state) => planValueByState.get(id)?.get(state))
      .filter(
        (value): value is NonNullable<typeof value> => value !== undefined,
      )
      .map((value) => (objectiveExpected ? value.expected : value.guaranteed));
    const conditions = rankings
      .filter((ranking) => stateIds.includes(ranking.state_id))
      .flatMap((ranking) => ranking.conditions);
    return {
      plan_id: id,
      conditions: [...new Set(conditions)].sort(),
      value_range_jpy: aggregateRanges(values),
    };
  });
  const safe =
    summaries
      .filter(
        (summary) =>
          summary.guaranteed_worst_case_jpy !== null &&
          summary.eligible_all_states !== false,
      )
      .sort(
        (left, right) =>
          numeric(right.guaranteed_worst_case_jpy!).comparedTo(
            numeric(left.guaranteed_worst_case_jpy!),
          ) || left.plan_id.localeCompare(right.plan_id),
      )[0]?.plan_id ?? null;
  const rankingByWorst = [...summaries]
    .filter(
      (summary) =>
        summary.guaranteed_worst_case_jpy !== null &&
        summary.eligible_all_states !== false,
    )
    .sort(
      (left, right) =>
        numeric(right.guaranteed_worst_case_jpy!).comparedTo(
          numeric(left.guaranteed_worst_case_jpy!),
        ) || left.plan_id.localeCompare(right.plan_id),
    );
  const questions: ResolutionQuestion[] = [];
  const keys = new Set<string>();
  for (const state of states) {
    for (const key of state.unknown_keys ?? state.unknownKeys ?? [])
      keys.add(key);
    for (const key of Object.keys(state.assignments ?? {})) keys.add(key);
  }
  for (const key of [...keys].sort()) {
    const signatures = new Set(
      states.map((state) => JSON.stringify((state.assignments ?? {})[key])),
    );
    const explicitlyUnknown = states.some((state) =>
      (state.unknown_keys ?? state.unknownKeys ?? []).includes(key),
    );
    if (signatures.size <= 1 && !explicitlyUnknown) continue;
    const possibleWinnerSets = new Set(
      rankings.map((ranking) => ranking.possible_winner_plan_ids.join(",")),
    );
    if (possibleWinnerSets.size > 1 || !definiteWinner) {
      questions.push({
        fact_key: key,
        question: questionFor(key, states, input),
        could_change_winner: true,
      });
    }
  }
  const outcomeMode: FeasibleEvaluationResult["outcome_mode"] = rankings.every(
    (ranking) => ranking.eligible_plan_ids.length === 0,
  )
    ? "no_valid_plan"
    : definiteWinner
      ? "definite"
      : "conditional";
  const result: FeasibleEvaluationResult = {
    outcome_mode: outcomeMode,
    definite_winner_plan_id: definiteWinner,
    safe_plan_id: safe,
    runner_up_plan_id: rankingByWorst[1]?.plan_id ?? null,
    conditional_winners: definiteWinner ? [] : conditionalWinners,
    questions_to_resolve: questions,
    states: rankings,
    plan_summaries: summaries,
    warnings,
    guaranteed_ranking: [...summaries]
      .sort(
        (left, right) =>
          numeric(right.value_range_jpy.minimum_jpy).comparedTo(
            numeric(left.value_range_jpy.minimum_jpy),
          ) || left.plan_id.localeCompare(right.plan_id),
      )
      .map((summary) => summary.plan_id),
    expected_ranking: [...summaries]
      .sort(
        (left, right) =>
          numeric(
            right.value_range_jpy.expected_jpy ??
              right.value_range_jpy.maximum_jpy,
          ).comparedTo(
            numeric(
              left.value_range_jpy.expected_jpy ??
                left.value_range_jpy.maximum_jpy,
            ),
          ) || left.plan_id.localeCompare(right.plan_id),
      )
      .map((summary) => summary.plan_id),
    enumerated_state_ids: rankings.map((ranking) => ranking.state_id),
    outcomeMode,
    definiteWinnerPlanId: definiteWinner,
    safePlanId: safe,
    runnerUpPlanId: rankingByWorst[1]?.plan_id ?? null,
    conditionalWinners: definiteWinner ? [] : conditionalWinners,
    questionsToResolve: questions,
  };
  return result;
}

export function evaluateFeasiblePlans(
  plans: readonly FeasiblePlan[],
  options: FeasibleEvaluationOptions = {},
): FeasibleEvaluationResult {
  return evaluateFeasibleStates({ ...options, plans });
}

export const evaluateUncertainty = evaluateFeasibleStates;

/** Rank only guaranteed values; probabilistic components are intentionally ignored. */
export function rankGuaranteedPlans(
  plans:
    | readonly FeasiblePlan[]
    | readonly {
        plan_id?: string;
        planId?: string;
        guaranteed_value?: UncertaintyNumber;
        guaranteedValue?: UncertaintyNumber;
        value?: UncertaintyNumber;
      }[],
): RankedPlan[] {
  const normalizedPlans = plans.map((plan, index) => {
    const id = plan.plan_id ?? plan.planId ?? `plan_${index}`;
    const value =
      plan.guaranteed_value ?? plan.guaranteedValue ?? plan.value ?? 0;
    const range = parseRange(value);
    return { plan_id: id, value_jpy: range.minimum_jpy };
  });
  return normalizedPlans
    .sort(
      (left, right) =>
        numeric(right.value_jpy).comparedTo(numeric(left.value_jpy)) ||
        left.plan_id.localeCompare(right.plan_id),
    )
    .map((plan, index) => ({ ...plan, rank: index + 1 }));
}

export const rankPlansByGuaranteedValue = rankGuaranteedPlans;
