import {
  exactKeys,
  plainInput,
  type PlainRecord,
  validDateTime,
} from "./input-guard.js";
import {
  evaluateTransfer,
  type TransferCalculationSpec,
} from "./m1b-calculations.js";
import { canonicalDecimal, canonicalHash, decimalString } from "./math.js";
import type { AssetRef } from "./types.js";

export const POINT_SPEND_OPTIMIZER_VERSION =
  "point-spend-optimizer.v1" as const;

export type PointSpendObjective =
  | "maximize_target"
  | "fastest"
  | "preserve_expiring";

export interface PointSpendEdge {
  readonly rule_id: string;
  readonly label_ja: string;
  readonly source_claim_ids: readonly string[];
  readonly source_asset: AssetRef;
  readonly destination_asset: AssetRef;
  readonly source_units: string;
  readonly destination_units: string;
  readonly minimum_source_units: string | null;
  readonly increment_source_units: string | null;
  readonly maximum_source_units_per_request: string | null;
  readonly maximum_source_units_per_period: string | null;
  readonly maximum_period: "year" | "campaign_period" | null;
  readonly fee_source_units: string;
  readonly processing_time_days_min: number | null;
  readonly processing_time_days_max: number | null;
  readonly cancellation_policy: "not_cancelable" | "provider_defined";
  readonly valid_from: string | null;
  readonly valid_to: string | null;
  readonly required_conditions_ja: readonly string[];
}

export interface PointSpendBalance {
  readonly asset: AssetRef;
  readonly amount: string;
  readonly expires_at: string | null;
}

export interface PointSpendRequest {
  readonly effective_at: string;
  readonly objective: PointSpendObjective;
  readonly target_asset_id: string;
  readonly balances: readonly PointSpendBalance[];
  readonly edges: readonly PointSpendEdge[];
  readonly confirmed_rule_ids: readonly string[];
  readonly period_source_used_by_rule: Readonly<Record<string, string>>;
  readonly max_steps: number;
}

export interface PointSpendRouteStep {
  readonly rule_id: string;
  readonly label_ja: string;
  readonly source_asset_id: string;
  readonly destination_asset_id: string;
  readonly source_amount: string;
  readonly destination_amount: string;
  readonly processing_time_days_min: number | null;
  readonly processing_time_days_max: number | null;
  readonly source_claim_ids: readonly string[];
}

export interface PointSpendRoute {
  readonly route_id: `sha256:${string}`;
  readonly source_asset: AssetRef;
  readonly source_amount: string;
  readonly target_asset: AssetRef;
  readonly target_amount: string;
  readonly residual_source_amount: string;
  readonly expires_at: string | null;
  readonly expiry_preserved_amount: string;
  readonly processing_time_days_min: number | null;
  readonly processing_time_days_max: number | null;
  readonly irreversible_step_count: number;
  readonly steps: readonly PointSpendRouteStep[];
}

export interface PointSpendOptimizationResult {
  readonly version: typeof POINT_SPEND_OPTIMIZER_VERSION;
  readonly objective: PointSpendObjective;
  readonly target_asset_id: string;
  readonly winner: PointSpendRoute | null;
  readonly routes: readonly PointSpendRoute[];
  readonly skipped: readonly { rule_id: string; reason_code: string }[];
  readonly result_hash: `sha256:${string}`;
}

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
] as const;

function assertAsset(value: unknown): asserts value is AssetRef {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("point_spend_asset_invalid");
  const record = value as PlainRecord;
  exactKeys(record, ASSET_KEYS, "point_spend_asset_shape_invalid");
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
    throw new TypeError("point_spend_asset_invalid");
}

function assertBalance(value: unknown): asserts value is PointSpendBalance {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("point_spend_balance_invalid");
  const record = value as PlainRecord;
  exactKeys(record, BALANCE_KEYS, "point_spend_balance_shape_invalid");
  assertAsset(record.asset);
  if (
    typeof record.amount !== "string" ||
    (record.expires_at !== null &&
      (typeof record.expires_at !== "string" ||
        !validDateTime(record.expires_at)))
  )
    throw new TypeError("point_spend_balance_invalid");
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

function assertEdge(value: unknown): asserts value is PointSpendEdge {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("point_spend_edge_invalid");
  const record = value as PlainRecord;
  exactKeys(record, EDGE_KEYS, "point_spend_edge_shape_invalid");
  assertAsset(record.source_asset);
  assertAsset(record.destination_asset);
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
    ![null, "year", "campaign_period"].includes(
      record.maximum_period as never,
    ) ||
    typeof record.fee_source_units !== "string" ||
    ![null, "number"].includes(
      record.processing_time_days_min === null
        ? null
        : typeof record.processing_time_days_min,
    ) ||
    ![null, "number"].includes(
      record.processing_time_days_max === null
        ? null
        : typeof record.processing_time_days_max,
    ) ||
    !["not_cancelable", "provider_defined"].includes(
      record.cancellation_policy as string,
    ) ||
    (record.valid_from !== null && typeof record.valid_from !== "string") ||
    (record.valid_to !== null && typeof record.valid_to !== "string") ||
    !Array.isArray(record.required_conditions_ja) ||
    !record.required_conditions_ja.every(
      (item) => typeof item === "string" && item.length <= 120,
    )
  )
    throw new TypeError("point_spend_edge_invalid");
  decimalString(record.source_units);
  decimalString(record.destination_units);
  decimalString(record.fee_source_units);
}

function activeAt(edge: PointSpendEdge, effectiveAt: string): boolean {
  const date = effectiveAt.slice(0, 10);
  return (
    (edge.valid_from === null || edge.valid_from <= date) &&
    (edge.valid_to === null || edge.valid_to >= date)
  );
}

function alignedAmount(edge: PointSpendEdge, available: string): string | null {
  let amount = decimalString(available);
  const fee = decimalString(edge.fee_source_units);
  if (fee.gt(amount)) return null;
  amount = amount.minus(fee);
  if (edge.maximum_source_units_per_request !== null) {
    const maximum = decimalString(edge.maximum_source_units_per_request);
    if (amount.gt(maximum)) amount = maximum;
  }
  const minimum =
    edge.minimum_source_units === null
      ? null
      : decimalString(edge.minimum_source_units);
  if (minimum !== null && amount.lt(minimum)) return null;
  if (edge.increment_source_units !== null) {
    const increment = decimalString(edge.increment_source_units);
    const origin = minimum ?? decimalString("0");
    amount = origin.plus(
      amount.minus(origin).div(increment).floor().mul(increment),
    );
  }
  if (amount.lte(0)) return null;
  return canonicalDecimal(amount);
}

function transferSpec(edge: PointSpendEdge): TransferCalculationSpec {
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
    maximum_period: edge.maximum_period,
    fee:
      edge.fee_source_units === "0"
        ? null
        : { asset: edge.source_asset, amount: edge.fee_source_units },
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

interface SearchState {
  readonly origin: PointSpendBalance;
  readonly asset: AssetRef;
  readonly amount: string;
  readonly residual: string;
  readonly steps: readonly PointSpendRouteStep[];
  readonly visited: readonly string[];
  readonly minDays: number | null;
  readonly maxDays: number | null;
  readonly irreversible: number;
}

function addDays(current: number | null, next: number | null): number | null {
  return current === null || next === null ? null : current + next;
}

function routeFrom(state: SearchState): PointSpendRoute {
  const expiryPreserved =
    state.origin.expires_at === null
      ? "0"
      : (state.steps[0]?.source_amount ?? "0");
  const projection = {
    source_asset: state.origin.asset,
    source_amount: state.origin.amount,
    target_asset: state.asset,
    target_amount: state.amount,
    residual_source_amount: state.residual,
    expires_at: state.origin.expires_at,
    expiry_preserved_amount: expiryPreserved,
    processing_time_days_min: state.minDays,
    processing_time_days_max: state.maxDays,
    irreversible_step_count: state.irreversible,
    steps: state.steps,
  };
  return {
    route_id: canonicalHash(projection) as `sha256:${string}`,
    ...projection,
  };
}

function compareRoutes(
  left: PointSpendRoute,
  right: PointSpendRoute,
  objective: PointSpendObjective,
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
  const amount = decimalString(right.target_amount).cmp(
    decimalString(left.target_amount),
  );
  if (amount !== 0) return amount;
  const leftDays = left.processing_time_days_max ?? Number.MAX_SAFE_INTEGER;
  const rightDays = right.processing_time_days_max ?? Number.MAX_SAFE_INTEGER;
  if (leftDays !== rightDays) return leftDays - rightDays;
  if (left.irreversible_step_count !== right.irreversible_step_count)
    return left.irreversible_step_count - right.irreversible_step_count;
  return left.route_id.localeCompare(right.route_id);
}

/** Enumerate bounded acyclic routes and validate every hop with calculateTransfer. */
export function optimizePointSpend(
  raw: PointSpendRequest,
): PointSpendOptimizationResult {
  const input = plainInput(raw, "point_spend_input_invalid") as PointSpendRequest;
  exactKeys(
    input as unknown as PlainRecord,
    [
      "effective_at",
      "objective",
      "target_asset_id",
      "balances",
      "edges",
      "confirmed_rule_ids",
      "period_source_used_by_rule",
      "max_steps",
    ],
    "point_spend_request_shape_invalid",
  );
  if (!validDateTime(input.effective_at))
    throw new TypeError("point_spend_effective_at_invalid");
  if (
    !(["maximize_target", "fastest", "preserve_expiring"] as const).includes(
      input.objective,
    )
  )
    throw new TypeError("point_spend_objective_invalid");
  if (
    !Number.isInteger(input.max_steps) ||
    input.max_steps < 1 ||
    input.max_steps > 6
  )
    throw new TypeError("point_spend_max_steps_invalid");
  if (
    !Array.isArray(input.balances) ||
    !Array.isArray(input.edges) ||
    input.balances.length > 64 ||
    input.edges.length > 256
  )
    throw new TypeError("point_spend_collection_invalid");
  input.balances.forEach(assertBalance);
  input.edges.forEach(assertEdge);
  if (
    !Array.isArray(input.confirmed_rule_ids) ||
    new Set(input.confirmed_rule_ids).size !==
      input.confirmed_rule_ids.length ||
    input.confirmed_rule_ids.some((item) => typeof item !== "string") ||
    !input.period_source_used_by_rule ||
    typeof input.period_source_used_by_rule !== "object" ||
    Array.isArray(input.period_source_used_by_rule)
  )
    throw new TypeError("point_spend_state_invalid");
  for (const value of Object.values(input.period_source_used_by_rule))
    decimalString(value);
  if (
    new Set(input.edges.map((edge) => edge.rule_id)).size !== input.edges.length
  )
    throw new TypeError("point_spend_rule_duplicate");

  const confirmed = new Set(input.confirmed_rule_ids);
  const skipped = new Map<string, string>();
  const activeEdges = [...input.edges]
    .filter((edge) => {
      if (!activeAt(edge, input.effective_at)) {
        skipped.set(edge.rule_id, "outside_validity_window");
        return false;
      }
      if (
        edge.required_conditions_ja.length > 0 &&
        !confirmed.has(edge.rule_id)
      ) {
        skipped.set(edge.rule_id, "condition_confirmation_required");
        return false;
      }
      return true;
    })
    .sort((left, right) => left.rule_id.localeCompare(right.rule_id));

  const routes: PointSpendRoute[] = [];
  for (const balance of [...input.balances].sort((left, right) =>
    left.asset.asset_id.localeCompare(right.asset.asset_id),
  )) {
    decimalString(balance.amount);
    const queue: SearchState[] = [
      {
        origin: balance,
        asset: balance.asset,
        amount: balance.amount,
        residual: balance.amount,
        steps: [],
        visited: [balance.asset.asset_id],
        minDays: 0,
        maxDays: 0,
        irreversible: 0,
      },
    ];
    while (queue.length > 0) {
      const state = queue.shift();
      if (!state) break;
      if (state.steps.length >= input.max_steps) continue;
      for (const edge of activeEdges) {
        if (
          edge.source_asset.asset_id !== state.asset.asset_id ||
          state.visited.includes(edge.destination_asset.asset_id)
        )
          continue;
        const sourceAmount = alignedAmount(edge, state.amount);
        if (sourceAmount === null) {
          skipped.set(edge.rule_id, "insufficient_or_unaligned_balance");
          continue;
        }
        const evaluated = evaluateTransfer(transferSpec(edge), {
          source_amount: sourceAmount,
          visited_asset_ids: state.visited.slice(0, -1),
          ...(edge.maximum_source_units_per_period === null
            ? {}
            : {
                period_source_used:
                  input.period_source_used_by_rule[edge.rule_id],
              }),
        });
        if (
          evaluated.status !== "applied" ||
          evaluated.destination_amount === null
        ) {
          skipped.set(edge.rule_id, evaluated.reason_code ?? evaluated.status);
          continue;
        }
        const residual = canonicalDecimal(
          decimalString(state.amount)
            .minus(sourceAmount)
            .minus(edge.fee_source_units),
        );
        const step: PointSpendRouteStep = {
          rule_id: edge.rule_id,
          label_ja: edge.label_ja,
          source_asset_id: edge.source_asset.asset_id,
          destination_asset_id: edge.destination_asset.asset_id,
          source_amount: sourceAmount,
          destination_amount: evaluated.destination_amount,
          processing_time_days_min: edge.processing_time_days_min,
          processing_time_days_max: edge.processing_time_days_max,
          source_claim_ids: edge.source_claim_ids,
        };
        const next: SearchState = {
          origin: state.origin,
          asset: edge.destination_asset,
          amount: evaluated.destination_amount,
          residual: state.steps.length === 0 ? residual : state.residual,
          steps: [...state.steps, step],
          visited: [...state.visited, edge.destination_asset.asset_id],
          minDays: addDays(state.minDays, edge.processing_time_days_min),
          maxDays: addDays(state.maxDays, edge.processing_time_days_max),
          irreversible:
            state.irreversible +
            (edge.cancellation_policy === "not_cancelable" ? 1 : 0),
        };
        if (next.asset.asset_id === input.target_asset_id)
          routes.push(routeFrom(next));
        queue.push(next);
      }
    }
  }
  routes.sort((left, right) => compareRoutes(left, right, input.objective));
  const projection = {
    version: POINT_SPEND_OPTIMIZER_VERSION,
    objective: input.objective,
    target_asset_id: input.target_asset_id,
    winner: routes[0] ?? null,
    routes,
    skipped: [...skipped.entries()]
      .map(([rule_id, reason_code]) => ({ rule_id, reason_code }))
      .sort((left, right) => left.rule_id.localeCompare(right.rule_id)),
  };
  return {
    ...projection,
    result_hash: canonicalHash(projection) as `sha256:${string}`,
  };
}
