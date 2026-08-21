import { createHash } from "node:crypto";
import type {
  EvidenceReference,
  FreshnessInfo,
  RecommendationPlan,
  RecommendationResponse,
} from "@jro/recommendation-api";

/**
 * Presentation is deliberately a smaller contract than the recommendation
 * response.  It is a view-model boundary, not a renderer: a client can put
 * these strings into text nodes without ever interpreting them as markup.
 *
 * M6 does not accept `verified` responses.  The only advice that this package
 * can display is synthetic/internal advice with an explicit not-current label.
 */

export type PresentationState =
  | "definite"
  | "conditional"
  | "no_valid_plan"
  | "blocked";

export type PresentationRouteRole =
  | "primary"
  | "fallback"
  | "safe"
  | "conditional";

export interface PresentationMerchant {
  readonly merchant_id: string;
  readonly merchant_name: string;
  readonly branch_id: string;
  readonly branch_name: string;
}

export interface PresentationStep {
  readonly kind: "operation" | "asset_movement" | "reward";
  readonly sequence: number | null;
  readonly operation_id: string | null;
  readonly operation_type: string | null;
  readonly occurred_at: string | null;
  readonly merchant_id: string | null;
  readonly branch_id: string | null;
  readonly channel: string | null;
  readonly interface: string | null;
  readonly amount_jpy: number | null;
  readonly movement_id: string | null;
  readonly movement_role: string | null;
  readonly direction: string | null;
  readonly asset_id: string | null;
  readonly reward_class: string | null;
  readonly units: string | null;
  readonly scale: number | null;
  readonly component_id: string | null;
  readonly rule_id: string | null;
  readonly sign: string | null;
}

export interface PresentationReward {
  readonly component_id: string;
  readonly operation_id: string;
  readonly rule_id: string;
  readonly sign: string;
  readonly asset_id: string;
  readonly reward_class: string | null;
  readonly units: string;
  readonly scale: number;
  readonly value_jpy: PresentationJpyRange | null;
  readonly certainty: PresentationCertainty | null;
}

export interface PresentationCertainty {
  readonly type: string | null;
  readonly probability: string | null;
  readonly probability_source: string | null;
}

export interface PresentationAsset {
  readonly lot_id: string;
  readonly asset_id: string;
  readonly reward_class: string | null;
  readonly units: string;
  readonly scale: number;
  readonly acquired_at: string | null;
  readonly source_operation_id: string | null;
  readonly settlement_status: string | null;
  readonly expiry_policy: string | null;
  readonly expires_at: string | null;
}

export interface PresentationJpyRange {
  readonly minimum_jpy: string;
  readonly maximum_jpy: string;
  readonly expected_jpy: string | null;
}

export interface PresentationEconomics {
  readonly merchant_value_received_jpy: PresentationJpyRange | null;
  readonly external_funding_jpy: PresentationJpyRange | null;
  readonly opening_asset_value_consumed_jpy: PresentationJpyRange | null;
  readonly ending_asset_value_jpy: PresentationJpyRange | null;
  readonly guaranteed_reward_value_jpy: PresentationJpyRange | null;
  readonly probabilistic_expected_reward_value_jpy: PresentationJpyRange | null;
  readonly fee_value_jpy: PresentationJpyRange | null;
  readonly guaranteed_net_value_change_jpy: PresentationJpyRange | null;
  readonly expected_net_value_change_jpy: PresentationJpyRange | null;
}

export interface PresentationSensitivity {
  readonly asset_id: string;
  readonly reward_class: string | null;
  readonly current_jpy_per_unit: string;
  readonly break_even_jpy_per_unit: string;
  readonly winner_at_or_below_threshold_plan_id: string | null;
  readonly winner_above_threshold_plan_id: string | null;
}

export interface PresentationRoute {
  readonly plan_id: string;
  readonly role: PresentationRouteRole;
  readonly conditions: readonly string[];
  readonly steps: readonly PresentationStep[];
  readonly rewards: readonly PresentationReward[];
  readonly ending_assets: readonly PresentationAsset[];
  readonly economics: PresentationEconomics | null;
  readonly objective_score_jpy: string | null;
  readonly native_snapshot_hash: string | null;
}

export interface ConsumerPresentation {
  readonly version: "1";
  readonly kind: "consumer_recommendation";
  readonly state: PresentationState;
  /** A stable, explicit label; synthetic output is never current advice. */
  readonly labels: readonly string[];
  readonly request_id: string;
  readonly merchant: PresentationMerchant | null;
  readonly amount_jpy: number | null;
  /** At most one primary and one fallback are populated. */
  readonly primary: PresentationRoute | null;
  readonly fallback: PresentationRoute | null;
  /** Conditional alternatives retain all named conditions for the safe route. */
  readonly conditional_alternatives: readonly PresentationRoute[];
  readonly assumptions: readonly string[];
  readonly questions: readonly string[];
  readonly freshness: PresentationFreshness;
  /** Evidence IDs only; evidence content and locators never cross this boundary. */
  readonly evidence_ids: readonly string[];
  readonly sensitivities: readonly PresentationSensitivity[];
  readonly response_hash: string | null;
  readonly blockers: readonly string[];
  readonly presentation_hash: string;
}

export interface PresentationFreshness {
  readonly checked_at: string | null;
  readonly source_ids: readonly string[];
  readonly rule_valid_from: Readonly<Record<string, string>>;
  readonly rule_valid_to: Readonly<Record<string, string | null>>;
  readonly notes: readonly string[];
}

export class PresentationError extends Error {
  readonly code:
    | "response_invalid"
    | "verified_response_not_supported"
    | "presentation_reference_invalid"
    | "conditional_safe_plan_missing"
    | "conditional_conditions_missing";

  constructor(code: PresentationError["code"], message: string = code) {
    super(message);
    this.name = "PresentationError";
    this.code = code;
  }
}

type RecordValue = Record<string, unknown>;

const ECONOMIC_KEYS = [
  "merchant_value_received_jpy",
  "external_funding_jpy",
  "opening_asset_value_consumed_jpy",
  "ending_asset_value_jpy",
  "guaranteed_reward_value_jpy",
  "probabilistic_expected_reward_value_jpy",
  "fee_value_jpy",
  "guaranteed_net_value_change_jpy",
  "expected_net_value_change_jpy",
] as const;

function isRecord(value: unknown): value is RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0)
    throw new PresentationError("response_invalid", `${field}_required`);
  return value;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function bigintSafeString(value: unknown): string | null {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function arrayValue(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function sortedStrings(value: unknown): readonly string[] {
  return [
    ...new Set(
      arrayValue(value).filter(
        (item): item is string => typeof item === "string",
      ),
    ),
  ].sort((left, right) => left.localeCompare(right));
}

function sortedUniqueRecords(value: unknown): readonly RecordValue[] {
  return arrayValue(value)
    .filter(isRecord)
    .sort((left, right) =>
      String(
        left.evidence_id ?? left.plan_id ?? left.asset_id ?? "",
      ).localeCompare(
        String(right.evidence_id ?? right.plan_id ?? right.asset_id ?? ""),
      ),
    );
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value as RecordValue))
    deepFreeze(child, seen);
  return Object.freeze(value);
}

function canonicalJson(value: unknown, seen = new WeakSet<object>()): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new PresentationError("response_invalid", "non_finite_output");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item, seen)).join(",")}]`;
  }
  if (typeof value === "object") {
    if (seen.has(value))
      throw new PresentationError("response_invalid", "cyclic_output");
    seen.add(value);
    const objectValue = value as RecordValue;
    const result = `{${Object.keys(objectValue)
      .sort((left, right) => left.localeCompare(right))
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalJson(objectValue[key], seen)}`,
      )
      .join(",")}}`;
    seen.delete(value);
    return result;
  }
  throw new PresentationError(
    "response_invalid",
    `unsupported_output:${typeof value}`,
  );
}

function hash(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`;
}

function planId(value: unknown): string | null {
  return isRecord(value) && typeof value.plan_id === "string"
    ? value.plan_id
    : null;
}

function planMap(
  response: RecommendationResponse,
): Map<string, RecommendationPlan> {
  const eligible = arrayValue(response.eligible_plans);
  const plans = new Map<string, RecommendationPlan>();
  for (const candidate of eligible) {
    if (!isRecord(candidate) || candidate.eligible !== true)
      throw new PresentationError(
        "presentation_reference_invalid",
        "eligible_partition_invalid",
      );
    const id = planId(candidate);
    if (!id || plans.has(id))
      throw new PresentationError(
        "presentation_reference_invalid",
        "eligible_plan_id_invalid",
      );
    plans.set(id, candidate as unknown as RecommendationPlan);
  }
  return plans;
}

function refPlan(
  plans: Map<string, RecommendationPlan>,
  id: string | null,
  object: RecommendationPlan | null,
  label: string,
): RecommendationPlan | null {
  if (id === null) {
    if (object !== null)
      throw new PresentationError(
        "presentation_reference_invalid",
        `${label}_id_missing`,
      );
    return null;
  }
  const plan = plans.get(id);
  if (!plan || plan.eligible !== true)
    throw new PresentationError(
      "presentation_reference_invalid",
      `${label}_not_eligible`,
    );
  if (!object || object.plan_id !== id || object.eligible !== true)
    throw new PresentationError(
      "presentation_reference_invalid",
      `${label}_object_mismatch`,
    );
  return plan;
}

function jpyRange(value: unknown): PresentationJpyRange | null {
  if (!isRecord(value)) return null;
  const minimum = bigintSafeString(value.minimum_jpy);
  const maximum = bigintSafeString(value.maximum_jpy);
  if (minimum === null || maximum === null) return null;
  return {
    minimum_jpy: minimum,
    maximum_jpy: maximum,
    expected_jpy: bigintSafeString(value.expected_jpy),
  };
}

function economics(value: unknown): PresentationEconomics | null {
  if (!isRecord(value)) return null;
  const output = {} as Record<string, PresentationJpyRange | null>;
  for (const key of ECONOMIC_KEYS) output[key] = jpyRange(value[key]);
  return output as unknown as PresentationEconomics;
}

function quantity(value: unknown): {
  readonly asset_id: string | null;
  readonly reward_class: string | null;
  readonly units: string | null;
  readonly scale: number | null;
} {
  if (!isRecord(value))
    return { asset_id: null, reward_class: null, units: null, scale: null };
  if (!isRecord(value.asset)) {
    return {
      asset_id: stringValue(value.asset_id),
      reward_class: stringValue(value.reward_class),
      units: bigintSafeString(value.amount ?? value.units),
      scale: numberValue(value.scale),
    };
  }
  return {
    asset_id: stringValue(value.asset.asset_id),
    reward_class: stringValue(value.asset.reward_class),
    units: bigintSafeString(value.amount ?? value.units),
    scale: numberValue(value.asset.scale),
  };
}

function operationSteps(plan: RecommendationPlan): readonly PresentationStep[] {
  return arrayValue(plan.operations)
    .filter(isRecord)
    .map((operation) => ({
      kind: "operation" as const,
      sequence: numberValue(operation.sequence),
      operation_id: stringValue(operation.operation_id),
      operation_type: stringValue(operation.operation_type),
      occurred_at: stringValue(operation.occurred_at),
      merchant_id: stringValue(operation.merchant_id),
      branch_id: stringValue(operation.merchant_location_id),
      channel: stringValue(operation.channel),
      interface: stringValue(operation.interface),
      amount_jpy: numberValue(operation.amount_jpy),
      movement_id: null,
      movement_role: null,
      direction: null,
      asset_id: null,
      reward_class: null,
      units: null,
      scale: null,
      component_id: null,
      rule_id: null,
      sign: null,
    }))
    .sort(stepCompare);
}

function movementSteps(plan: RecommendationPlan): readonly PresentationStep[] {
  return arrayValue(plan.asset_movements)
    .filter(isRecord)
    .map((movement) => {
      const q = quantity(movement.quantity);
      const operation = arrayValue(plan.operations).find(
        (candidate) =>
          isRecord(candidate) &&
          candidate.operation_id === movement.operation_id,
      );
      return {
        kind: "asset_movement" as const,
        sequence: isRecord(operation) ? numberValue(operation.sequence) : null,
        operation_id: stringValue(movement.operation_id),
        operation_type: isRecord(operation)
          ? stringValue(operation.operation_type)
          : null,
        occurred_at: isRecord(operation)
          ? stringValue(operation.occurred_at)
          : null,
        merchant_id: isRecord(operation)
          ? stringValue(operation.merchant_id)
          : null,
        branch_id: isRecord(operation)
          ? stringValue(operation.merchant_location_id)
          : null,
        channel: isRecord(operation) ? stringValue(operation.channel) : null,
        interface: isRecord(operation)
          ? stringValue(operation.interface)
          : null,
        amount_jpy: null,
        movement_id: stringValue(movement.movement_id),
        movement_role: stringValue(movement.movement_role),
        direction: stringValue(movement.direction),
        asset_id: q.asset_id,
        reward_class: q.reward_class,
        units: q.units,
        scale: q.scale,
        component_id: null,
        rule_id: null,
        sign: null,
      };
    })
    .sort(stepCompare);
}

function rewardComponents(plan: RecommendationPlan): readonly unknown[] {
  const components = arrayValue(plan.reward_components);
  return components.length > 0 ? components : arrayValue(plan.rewards);
}

function rewardSteps(plan: RecommendationPlan): readonly PresentationStep[] {
  return rewardComponents(plan)
    .filter(isRecord)
    .map((reward) => {
      const q = quantity(reward.quantity);
      const operation = arrayValue(plan.operations).find(
        (candidate) =>
          isRecord(candidate) && candidate.operation_id === reward.operation_id,
      );
      return {
        kind: "reward" as const,
        sequence: isRecord(operation) ? numberValue(operation.sequence) : null,
        operation_id: stringValue(reward.operation_id),
        operation_type: isRecord(operation)
          ? stringValue(operation.operation_type)
          : null,
        occurred_at: isRecord(operation)
          ? stringValue(operation.occurred_at)
          : null,
        merchant_id: isRecord(operation)
          ? stringValue(operation.merchant_id)
          : null,
        branch_id: isRecord(operation)
          ? stringValue(operation.merchant_location_id)
          : null,
        channel: isRecord(operation) ? stringValue(operation.channel) : null,
        interface: isRecord(operation)
          ? stringValue(operation.interface)
          : null,
        amount_jpy: null,
        movement_id: null,
        movement_role: null,
        direction: null,
        asset_id: q.asset_id,
        reward_class: q.reward_class,
        units: q.units,
        scale: q.scale,
        component_id: stringValue(reward.component_id),
        rule_id: stringValue(reward.rule_id),
        sign: stringValue(reward.sign),
      };
    })
    .sort(stepCompare);
}

function stepCompare(left: PresentationStep, right: PresentationStep): number {
  const sequence =
    (left.sequence ?? Number.MAX_SAFE_INTEGER) -
    (right.sequence ?? Number.MAX_SAFE_INTEGER);
  if (sequence !== 0) return sequence;
  const operation = (left.operation_id ?? "").localeCompare(
    right.operation_id ?? "",
  );
  if (operation !== 0) return operation;
  const kindOrder = { operation: 0, asset_movement: 1, reward: 2 } as const;
  const kind = kindOrder[left.kind] - kindOrder[right.kind];
  if (kind !== 0) return kind;
  return (left.movement_id ?? left.component_id ?? "").localeCompare(
    right.movement_id ?? right.component_id ?? "",
  );
}

function planSteps(plan: RecommendationPlan): readonly PresentationStep[] {
  return [
    ...operationSteps(plan),
    ...movementSteps(plan),
    ...rewardSteps(plan),
  ].sort(stepCompare);
}

function rewardLines(plan: RecommendationPlan): readonly PresentationReward[] {
  return rewardComponents(plan)
    .filter(isRecord)
    .map((reward) => {
      const q = quantity(reward.quantity);
      return {
        component_id: requiredString(
          reward.component_id,
          "reward_component_id",
        ),
        operation_id: requiredString(
          reward.operation_id,
          "reward_operation_id",
        ),
        rule_id: requiredString(reward.rule_id, "reward_rule_id"),
        sign: requiredString(reward.sign, "reward_sign"),
        asset_id: requiredString(q.asset_id, "reward_asset_id"),
        reward_class: q.reward_class,
        units: requiredString(q.units, "reward_units"),
        scale: q.scale ?? 1,
        value_jpy: jpyRange(reward.value_jpy),
        certainty: isRecord(reward.certainty)
          ? {
              type: stringValue(reward.certainty.type),
              probability: bigintSafeString(reward.certainty.probability),
              probability_source: stringValue(
                reward.certainty.probability_source,
              ),
            }
          : null,
      };
    })
    .sort((left, right) => left.component_id.localeCompare(right.component_id));
}

function endingAssets(plan: RecommendationPlan): readonly PresentationAsset[] {
  const lots = arrayValue(plan.ending_asset_lots);
  return (lots.length > 0 ? lots : arrayValue(plan.ending_assets))
    .filter(isRecord)
    .map((lot) => {
      const q = quantity(lot.quantity);
      const settlement = isRecord(lot.settlement) ? lot.settlement : {};
      const expiry = isRecord(lot.expiry) ? lot.expiry : {};
      return {
        lot_id: requiredString(lot.lot_id, "ending_asset_lot_id"),
        asset_id: requiredString(q.asset_id, "ending_asset_id"),
        reward_class: q.reward_class,
        units: requiredString(q.units, "ending_asset_units"),
        scale: q.scale ?? 1,
        acquired_at: stringValue(lot.acquired_at),
        source_operation_id: stringValue(lot.source_operation_id),
        settlement_status: stringValue(settlement.status),
        expiry_policy: stringValue(expiry.policy),
        expires_at: stringValue(expiry.expires_at),
      };
    })
    .sort((left, right) => left.lot_id.localeCompare(right.lot_id));
}

function conditions(value: unknown): readonly string[] {
  if (!isRecord(value)) return [];
  return sortedStrings(value.conditions ?? value.assumptions);
}

function route(
  plan: RecommendationPlan,
  role: PresentationRouteRole,
  conditionalConditions: readonly string[] = [],
): PresentationRoute {
  return {
    plan_id: requiredString(plan.plan_id, "plan_id"),
    role,
    conditions: conditionalConditions,
    steps: planSteps(plan),
    rewards: rewardLines(plan),
    ending_assets: endingAssets(plan),
    economics: economics(plan.economics),
    objective_score_jpy: bigintSafeString(plan.objective_score_jpy),
    native_snapshot_hash: stringValue(plan.native_snapshot_hash),
  };
}

function merchant(value: unknown): PresentationMerchant | null {
  if (!isRecord(value)) return null;
  const merchantId = stringValue(value.merchant_id);
  const branchId = stringValue(value.branch_id);
  if (!merchantId || !branchId) return null;
  return {
    merchant_id: merchantId,
    merchant_name: stringValue(value.merchant_name) ?? merchantId,
    branch_id: branchId,
    branch_name: stringValue(value.branch_name) ?? branchId,
  };
}

function freshness(value: FreshnessInfo | unknown): PresentationFreshness {
  const input = isRecord(value) ? value : {};
  const validFrom: Record<string, string> = {};
  if (isRecord(input.rule_valid_from)) {
    for (const key of Object.keys(input.rule_valid_from).sort()) {
      const item = input.rule_valid_from[key];
      if (typeof item === "string") validFrom[key] = item;
    }
  }
  const validTo: Record<string, string | null> = {};
  if (isRecord(input.rule_valid_to)) {
    for (const key of Object.keys(input.rule_valid_to).sort()) {
      const item = input.rule_valid_to[key];
      if (item === null || typeof item === "string") validTo[key] = item;
    }
  }
  return {
    checked_at: stringValue(input.checked_at),
    source_ids: sortedStrings(input.source_ids),
    rule_valid_from: validFrom,
    rule_valid_to: validTo,
    notes: sortedStrings(input.notes),
  };
}

function evidenceIds(
  value: readonly EvidenceReference[] | unknown,
): readonly string[] {
  return [
    ...new Set(
      arrayValue(value)
        .filter(isRecord)
        .map((item) => item.evidence_id)
        .filter((item): item is string => typeof item === "string"),
    ),
  ].sort((left, right) => left.localeCompare(right));
}

function sensitivities(value: unknown): readonly PresentationSensitivity[] {
  return sortedUniqueRecords(value)
    .flatMap((item) => {
      const assetId = stringValue(item.asset_id);
      const current = bigintSafeString(item.current_jpy_per_unit);
      const breakEven = bigintSafeString(item.break_even_jpy_per_unit);
      if (!assetId || current === null || breakEven === null) return [];
      return [
        {
          asset_id: assetId,
          reward_class: stringValue(item.reward_class),
          current_jpy_per_unit: current,
          break_even_jpy_per_unit: breakEven,
          winner_at_or_below_threshold_plan_id: stringValue(
            item.winner_at_or_below_threshold_plan_id,
          ),
          winner_above_threshold_plan_id: stringValue(
            item.winner_above_threshold_plan_id,
          ),
        },
      ];
    })
    .sort(
      (left, right) =>
        left.asset_id.localeCompare(right.asset_id) ||
        (left.reward_class ?? "").localeCompare(right.reward_class ?? "") ||
        left.current_jpy_per_unit.localeCompare(right.current_jpy_per_unit) ||
        left.break_even_jpy_per_unit.localeCompare(
          right.break_even_jpy_per_unit,
        ) ||
        (left.winner_at_or_below_threshold_plan_id ?? "").localeCompare(
          right.winner_at_or_below_threshold_plan_id ?? "",
        ) ||
        (left.winner_above_threshold_plan_id ?? "").localeCompare(
          right.winner_above_threshold_plan_id ?? "",
        ),
    );
}

function conditionalPlanRefs(
  response: RecommendationResponse,
  plans: Map<string, RecommendationPlan>,
): readonly {
  readonly plan: RecommendationPlan;
  readonly conditions: readonly string[];
}[] {
  const result: { plan: RecommendationPlan; conditions: readonly string[] }[] =
    [];
  const seen = new Set<string>();
  for (const candidate of arrayValue(response.conditional_winners)) {
    const id = planId(candidate);
    if (!id || seen.has(id))
      throw new PresentationError(
        "presentation_reference_invalid",
        "conditional_plan_id_invalid",
      );
    const plan = plans.get(id);
    if (!plan)
      throw new PresentationError(
        "presentation_reference_invalid",
        "conditional_plan_not_eligible",
      );
    const namedConditions = conditions(candidate);
    if (namedConditions.length === 0)
      throw new PresentationError("conditional_conditions_missing", id);
    seen.add(id);
    result.push({ plan, conditions: namedConditions });
  }
  return result.sort((left, right) =>
    left.plan.plan_id.localeCompare(right.plan.plan_id),
  );
}

function validateNoRoutes(response: RecommendationResponse): void {
  if (
    response.winner_plan_id !== null ||
    response.safe_plan_id !== null ||
    response.runner_up_plan_id !== null ||
    response.winner !== null ||
    response.safe_plan !== null ||
    response.runner_up !== null ||
    arrayValue(response.conditional_winners).length > 0
  )
    throw new PresentationError(
      "presentation_reference_invalid",
      "non_empty_routes_for_no_route_state",
    );
}

function labels(
  response: RecommendationResponse,
  state: PresentationState,
): readonly string[] {
  const output: string[] = [];
  if (response.verification_status === "synthetic_only") {
    output.push("synthetic_only", "not_current_advice");
  }
  if (state === "blocked") output.push("blocked");
  if (state === "conditional") output.push("conditional");
  if (state === "no_valid_plan") output.push("no_valid_plan");
  return output;
}

function baseModel(
  response: RecommendationResponse,
  state: PresentationState,
  plans: Map<string, RecommendationPlan>,
): Omit<ConsumerPresentation, "presentation_hash"> {
  const responseHash = stringValue(response.replay?.output_hash);
  const primaryId =
    response.outcome === "conditional"
      ? response.safe_plan_id
      : response.winner_plan_id;
  const primaryPlan =
    primaryId === null ? null : (plans.get(primaryId) ?? null);
  const safePlan = refPlan(
    plans,
    response.safe_plan_id,
    response.safe_plan,
    "safe_plan",
  );
  const winnerPlan = refPlan(
    plans,
    response.winner_plan_id,
    response.winner,
    "winner",
  );
  const runnerPlan = refPlan(
    plans,
    response.runner_up_plan_id,
    response.runner_up,
    "runner_up",
  );

  if (response.outcome === "conditional" && response.winner_plan_id !== null)
    throw new PresentationError(
      "presentation_reference_invalid",
      "conditional_winner_present",
    );

  if (response.outcome === "conditional" && !safePlan)
    throw new PresentationError("conditional_safe_plan_missing");
  if (response.outcome === "definite" && !winnerPlan)
    throw new PresentationError(
      "presentation_reference_invalid",
      "winner_not_eligible",
    );

  let primary: PresentationRoute | null = null;
  let fallback: PresentationRoute | null = null;
  let conditionalAlternatives: readonly PresentationRoute[] = [];
  if (response.outcome === "definite") {
    if (runnerPlan && winnerPlan && runnerPlan.plan_id === winnerPlan.plan_id)
      throw new PresentationError(
        "presentation_reference_invalid",
        "winner_runner_overlap",
      );
    primary = route(primaryPlan as RecommendationPlan, "primary");
    const fallbackPlan =
      runnerPlan && runnerPlan.plan_id !== primaryPlan?.plan_id
        ? runnerPlan
        : safePlan && safePlan.plan_id !== primaryPlan?.plan_id
          ? safePlan
          : null;
    fallback = fallbackPlan ? route(fallbackPlan, "fallback") : null;
  } else if (response.outcome === "conditional") {
    primary = route(primaryPlan as RecommendationPlan, "safe");
    const refs = conditionalPlanRefs(response, plans);
    if (refs.some((item) => item.plan.plan_id === primaryPlan?.plan_id))
      throw new PresentationError(
        "presentation_reference_invalid",
        "safe_conditional_overlap",
      );
    conditionalAlternatives = refs.map((item) =>
      route(item.plan, "conditional", item.conditions),
    );
    // Conditional alternatives are already the safe route's explicit
    // alternatives. Keeping `fallback` null avoids displaying the same plan
    // twice and makes the displayed route set disjoint.
    fallback = null;
  }

  if (primary && fallback && primary.plan_id === fallback.plan_id)
    throw new PresentationError(
      "presentation_reference_invalid",
      "routes_not_disjoint",
    );
  if (
    primary &&
    conditionalAlternatives.some((item) => item.plan_id === primary?.plan_id)
  )
    throw new PresentationError(
      "presentation_reference_invalid",
      "safe_conditional_overlap",
    );

  const stateLabels = labels(response, state);
  return {
    version: "1",
    kind: "consumer_recommendation",
    state,
    labels: stateLabels,
    request_id: requiredString(response.request_id, "request_id"),
    merchant: merchant(response.merchant),
    amount_jpy: isRecord(response.comparison)
      ? numberValue(
          response.comparison.amount_jpy ?? response.comparison.amount,
        )
      : null,
    primary,
    fallback,
    conditional_alternatives: conditionalAlternatives,
    assumptions: sortedStrings(response.assumptions),
    questions: sortedStrings(response.questions),
    freshness: freshness(response.freshness),
    evidence_ids: evidenceIds(response.evidence_refs),
    sensitivities: sensitivities(response.valuation_sensitivities),
    response_hash: responseHash,
    blockers: sortedStrings(response.blockers),
  };
}

/**
 * Convert one M5 response into the narrow M6 consumer view-model.
 *
 * This function does not render markup, create links, persist history, or
 * expose canonical replay/rule/evidence bodies.  It is safe to call from a
 * server adapter or a local synthetic test harness.
 */
export function buildPresentation(
  response: RecommendationResponse,
): ConsumerPresentation {
  if (!isRecord(response)) throw new PresentationError("response_invalid");
  if (response.verification_status === "verified")
    throw new PresentationError("verified_response_not_supported");
  if (
    response.verification_status !== "synthetic_only" &&
    response.verification_status !== "blocked"
  )
    throw new PresentationError(
      "response_invalid",
      "verification_status_invalid",
    );
  if (
    response.outcome !== "definite" &&
    response.outcome !== "conditional" &&
    response.outcome !== "no_valid_plan" &&
    response.outcome !== "blocked"
  )
    throw new PresentationError("response_invalid", "outcome_invalid");

  const state: PresentationState =
    response.mode !== "synthetic_internal" ||
    response.outcome === "blocked" ||
    response.verification_status !== "synthetic_only"
      ? "blocked"
      : response.outcome;
  const plans = planMap(response);

  let model: Omit<ConsumerPresentation, "presentation_hash">;
  if (state === "blocked") {
    // A production or blocked envelope is never allowed to carry route data
    // into the view-model.  Clear references before mapping so a malformed
    // upstream envelope fails closed by omission rather than accidentally
    // displaying a route.
    model = {
      ...baseModel(
        {
          ...response,
          outcome: "blocked",
          winner_plan_id: null,
          safe_plan_id: null,
          runner_up_plan_id: null,
          winner: null,
          safe_plan: null,
          runner_up: null,
          conditional_winners: [],
        },
        state,
        new Map(),
      ),
      primary: null,
      fallback: null,
      conditional_alternatives: [],
      sensitivities: [],
    };
  } else if (state === "no_valid_plan") {
    validateNoRoutes(response);
    model = {
      ...baseModel(
        {
          ...response,
          outcome: "no_valid_plan",
        },
        state,
        plans,
      ),
      primary: null,
      fallback: null,
      conditional_alternatives: [],
      sensitivities: [],
    };
  } else {
    model = baseModel(response, state, plans);
  }
  return deepFreeze({ ...model, presentation_hash: hash(model) });
}

export const buildConsumerPresentation = buildPresentation;
export const toConsumerPresentation = buildPresentation;
export const presentRecommendation = buildPresentation;

/** Compatibility aliases for hosts that name the view-model explicitly. */
export type RecommendationPresentation = ConsumerPresentation;
export type ConsumerPresentationModel = ConsumerPresentation;
export const buildRecommendationPresentation = buildPresentation;
export const mapRecommendationToPresentation = buildPresentation;
