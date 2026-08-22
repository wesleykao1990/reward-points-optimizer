import {
  hashCanonical,
  isActiveProvisionalRule,
  isCanonicalProvisionalDateTime,
  type RuleIRV1,
  scanPublicValue,
  validateRuleIR,
} from "@jro/provisional-rules";
import type {
  AssetDefinition,
  AssetInput,
  AssetLot,
  CapProgressState,
  Channel,
  Interface,
  PurchasePlan,
  RewardRule,
  StateValue,
  UserState,
  ValuationEntry,
} from "@jro/rule-engine";

import { recommend } from "./core.js";
import { type MerchantCatalog, resolveMerchant } from "./merchant.js";
import type { RecommendationResponse } from "./types.js";

export const EXECUTABLE_RULE_BUNDLE_VERSION =
  "executable-rule-bundle.v1" as const;
export const DIRECT_PURCHASE_GRAPH_INPUT_VERSION =
  "direct-purchase-graph-input.v1" as const;

export interface ExecutableRuleBundleDraftV1 {
  readonly version: typeof EXECUTABLE_RULE_BUNDLE_VERSION;
  readonly bundle_id: string;
  readonly rule_irs: readonly RuleIRV1[];
  readonly merchant_catalog: MerchantCatalog;
}

export interface ExecutableRuleBundleV1 extends ExecutableRuleBundleDraftV1 {
  readonly bundle_hash: `sha256:${string}`;
}

export interface DirectPurchaseGraphInputV1 {
  readonly version: typeof DIRECT_PURCHASE_GRAPH_INPUT_VERSION;
  readonly request_id: string;
  readonly merchant_id: string;
  readonly branch_id: string;
  readonly channel: Channel;
  readonly interface: Interface;
  readonly amount_jpy: number;
  readonly tax_exclusive_amount_jpy: number;
  readonly product_class: string;
  readonly effective_at: string;
  readonly owned_instrument_ids: readonly string[];
  readonly owned_loyalty_program_ids: readonly string[];
  readonly available_funding_source_ids: readonly string[];
  readonly asset_lots: readonly AssetLot[];
  readonly facts: Readonly<Record<string, StateValue>>;
  readonly cap_progress: Readonly<Record<string, CapProgressState>>;
  readonly valuation_profile: {
    readonly version: string;
    readonly entries: readonly ValuationEntry[];
  };
}

export type ExecutionBundleIssueCode =
  | "representation_invalid"
  | "shape_invalid"
  | "bundle_hash_mismatch"
  | "rule_ir_invalid"
  | "duplicate_rule"
  | "asset_conflict"
  | "merchant_catalog_invalid"
  | "input_invalid"
  | "rule_inactive"
  | "rule_not_applicable"
  | "ownership_missing"
  | "funding_source_missing"
  | "principal_mapping_invalid"
  | "principal_balance_insufficient"
  | "unsupported_operation";

export interface ExecutionBundleIssue {
  readonly code: ExecutionBundleIssueCode;
  readonly path: string;
  readonly message: string;
  readonly rule_id?: string;
}

export type ExecutionBundleResult =
  | {
      readonly ok: true;
      readonly value: ExecutableRuleBundleV1;
      readonly issues: readonly [];
    }
  | {
      readonly ok: false;
      readonly value: null;
      readonly issues: readonly ExecutionBundleIssue[];
    };

export interface DirectPurchaseGenerationResult {
  readonly plans: readonly PurchasePlan[];
  readonly rule_irs: readonly RuleIRV1[];
  readonly issues: readonly ExecutionBundleIssue[];
}

export interface ExecutionBundleRecommendation {
  readonly response: RecommendationResponse;
  readonly generation: DirectPurchaseGenerationResult;
}

export class ExecutionBundleError extends Error {
  readonly code: "bundle_invalid" | "input_invalid" | "no_executable_plan";

  constructor(code: ExecutionBundleError["code"]) {
    super(code);
    this.name = "ExecutionBundleError";
    this.code = code;
  }
}

const DRAFT_KEYS = ["bundle_id", "merchant_catalog", "rule_irs", "version"];
const BUNDLE_KEYS = [...DRAFT_KEYS, "bundle_hash"].sort();
const INPUT_KEYS = [
  "amount_jpy",
  "asset_lots",
  "available_funding_source_ids",
  "branch_id",
  "cap_progress",
  "channel",
  "effective_at",
  "facts",
  "interface",
  "merchant_id",
  "owned_instrument_ids",
  "owned_loyalty_program_ids",
  "product_class",
  "request_id",
  "tax_exclusive_amount_jpy",
  "valuation_profile",
  "version",
].sort();

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
) {
  const keys = Object.keys(value).sort();
  return (
    keys.length === expected.length &&
    keys.every((key, index) => key === expected[index])
  );
}

function sortedIssues(
  issues: readonly ExecutionBundleIssue[],
): readonly ExecutionBundleIssue[] {
  return Object.freeze(
    [...issues].sort(
      (left, right) =>
        (left.rule_id ?? "").localeCompare(right.rule_id ?? "") ||
        left.path.localeCompare(right.path) ||
        left.code.localeCompare(right.code) ||
        left.message.localeCompare(right.message),
    ),
  );
}

function issue(
  issues: ExecutionBundleIssue[],
  code: ExecutionBundleIssueCode,
  path: string,
  message: string,
  rule_id?: string,
) {
  issues.push({ code, path, message, ...(rule_id ? { rule_id } : {}) });
}

function idArray(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    new Set(value).size === value.length &&
    value.every((item) => typeof item === "string" && item.length > 0)
  );
}

function sameAsset(left: AssetDefinition, right: AssetDefinition): boolean {
  return hashCanonical(left) === hashCanonical(right);
}

function bundleProjection(draft: ExecutableRuleBundleDraftV1) {
  return {
    version: draft.version,
    bundle_id: draft.bundle_id,
    rule_ir_hashes: draft.rule_irs.map((item) => item.bundle_hash),
    merchant_catalog: draft.merchant_catalog,
  };
}

function parseBundle(value: unknown, withHash: boolean): ExecutionBundleResult {
  const scan = scanPublicValue(value);
  if (!scan.valid)
    return {
      ok: false,
      value: null,
      issues: sortedIssues(
        scan.issues.map((item) => ({
          code: "representation_invalid" as const,
          path: item.path,
          message: item.message,
        })),
      ),
    };
  const input = scan.value;
  const issues: ExecutionBundleIssue[] = [];
  if (
    !record(input) ||
    !exactKeys(input, withHash ? BUNDLE_KEYS : DRAFT_KEYS)
  ) {
    issue(issues, "shape_invalid", "", "execution bundle shape is invalid");
    return { ok: false, value: null, issues: sortedIssues(issues) };
  }
  if (
    input.version !== EXECUTABLE_RULE_BUNDLE_VERSION ||
    typeof input.bundle_id !== "string" ||
    input.bundle_id.length === 0 ||
    !Array.isArray(input.rule_irs) ||
    input.rule_irs.length === 0 ||
    !record(input.merchant_catalog)
  ) {
    issue(issues, "shape_invalid", "", "execution bundle values are invalid");
    return { ok: false, value: null, issues: sortedIssues(issues) };
  }

  const ruleIrs: RuleIRV1[] = [];
  for (const [index, candidate] of input.rule_irs.entries()) {
    const checked = validateRuleIR(candidate);
    if (!checked.ok) {
      issue(
        issues,
        "rule_ir_invalid",
        `/rule_irs/${index}`,
        "Rule IR failed hash-bound validation",
      );
      continue;
    }
    ruleIrs.push(checked.value);
  }
  ruleIrs.sort((left, right) =>
    left.rule.rule_id.localeCompare(right.rule.rule_id),
  );
  const ruleIds = ruleIrs.map((item) => item.rule.rule_id);
  if (new Set(ruleIds).size !== ruleIds.length)
    issue(issues, "duplicate_rule", "/rule_irs", "rule IDs must be unique");

  const assets = new Map<string, AssetDefinition>();
  for (const ruleIr of ruleIrs) {
    for (const asset of ruleIr.assets as readonly AssetDefinition[]) {
      const previous = assets.get(asset.asset_id);
      if (previous && !sameAsset(previous, asset))
        issue(
          issues,
          "asset_conflict",
          "/rule_irs",
          `conflicting definitions for ${asset.asset_id}`,
          ruleIr.rule.rule_id,
        );
      else assets.set(asset.asset_id, asset);
    }
  }

  const merchantCatalog = input.merchant_catalog as unknown as MerchantCatalog;
  try {
    for (const merchant of merchantCatalog.merchants ?? [])
      for (const branch of merchant.branches ?? [])
        resolveMerchant(
          { merchant_id: merchant.merchant_id, branch_id: branch.branch_id },
          merchantCatalog,
        );
  } catch {
    issue(
      issues,
      "merchant_catalog_invalid",
      "/merchant_catalog",
      "merchant catalogue is invalid",
    );
  }
  if (issues.length > 0)
    return { ok: false, value: null, issues: sortedIssues(issues) };

  const draft: ExecutableRuleBundleDraftV1 = {
    version: EXECUTABLE_RULE_BUNDLE_VERSION,
    bundle_id: input.bundle_id,
    rule_irs: ruleIrs,
    merchant_catalog: merchantCatalog,
  };
  const bundleHash = hashCanonical(bundleProjection(draft));
  if (withHash && input.bundle_hash !== bundleHash) {
    issue(
      issues,
      "bundle_hash_mismatch",
      "/bundle_hash",
      "execution bundle hash mismatch",
    );
    return { ok: false, value: null, issues: sortedIssues(issues) };
  }
  return {
    ok: true,
    value: Object.freeze({ ...draft, bundle_hash: bundleHash }),
    issues: [],
  };
}

export function compileExecutionBundle(value: unknown): ExecutionBundleResult {
  return parseBundle(value, false);
}

export function validateExecutionBundle(value: unknown): ExecutionBundleResult {
  return parseBundle(value, true);
}

function parseInput(value: unknown): DirectPurchaseGraphInputV1 | null {
  const scan = scanPublicValue(value);
  if (!scan.valid || !record(scan.value) || !exactKeys(scan.value, INPUT_KEYS))
    return null;
  const input = scan.value;
  if (
    input.version !== DIRECT_PURCHASE_GRAPH_INPUT_VERSION ||
    typeof input.request_id !== "string" ||
    input.request_id.length === 0 ||
    typeof input.merchant_id !== "string" ||
    typeof input.branch_id !== "string" ||
    typeof input.product_class !== "string" ||
    typeof input.effective_at !== "string" ||
    !isCanonicalProvisionalDateTime(input.effective_at) ||
    !Number.isSafeInteger(input.amount_jpy) ||
    Number(input.amount_jpy) <= 0 ||
    !Number.isSafeInteger(input.tax_exclusive_amount_jpy) ||
    Number(input.tax_exclusive_amount_jpy) < 0 ||
    Number(input.tax_exclusive_amount_jpy) > Number(input.amount_jpy) ||
    !idArray(input.owned_instrument_ids) ||
    !idArray(input.owned_loyalty_program_ids) ||
    !idArray(input.available_funding_source_ids) ||
    !Array.isArray(input.asset_lots) ||
    !record(input.facts) ||
    !record(input.cap_progress) ||
    !record(input.valuation_profile)
  )
    return null;
  return input as unknown as DirectPurchaseGraphInputV1;
}

function assetRefEqual(
  left: AssetLot["quantity"]["asset"],
  right: RuleIRV1["principal_edges"][number]["asset"],
) {
  return (
    left.asset_id === right.asset_id &&
    left.asset_kind === right.asset_kind &&
    left.program_id === right.program_id &&
    left.reward_class === right.reward_class &&
    left.scale === right.scale
  );
}

function ruleApplicable(
  rule: RewardRule,
  input: DirectPurchaseGraphInputV1,
): boolean {
  const scope = rule.scope;
  return (
    scope.operation_types.includes("merchant_purchase") &&
    scope.channels.includes(input.channel) &&
    (!scope.merchant_ids || scope.merchant_ids.includes(input.merchant_id)) &&
    !scope.excluded_merchant_ids?.includes(input.merchant_id) &&
    (!scope.merchant_location_ids ||
      scope.merchant_location_ids.includes(input.branch_id)) &&
    !scope.excluded_merchant_location_ids?.includes(input.branch_id) &&
    (!scope.included_product_classes ||
      scope.included_product_classes.includes(input.product_class)) &&
    !scope.excluded_product_classes?.includes(input.product_class)
  );
}

function inputsForPrincipal(
  ruleIr: RuleIRV1,
  input: DirectPurchaseGraphInputV1,
  issues: ExecutionBundleIssue[],
): AssetInput[] | null {
  const edges = ruleIr.principal_edges.filter(
    (edge) =>
      edge.operation_type === "merchant_purchase" &&
      edge.direction === "consume" &&
      (edge.role === "external_funding" || edge.role === "principal_tender"),
  );
  if (edges.length !== 1) {
    issue(
      issues,
      "principal_mapping_invalid",
      "/principal_edges",
      "direct purchase requires exactly one principal consume edge",
      ruleIr.rule.rule_id,
    );
    return null;
  }
  const edge = edges[0];
  if (!edge || edge.asset.scale !== 0) {
    issue(
      issues,
      "principal_mapping_invalid",
      "/principal_edges",
      "JPY purchase principal edge must use scale zero",
      ruleIr.rule.rule_id,
    );
    return null;
  }
  if (edge.role === "external_funding")
    return [
      {
        input_id: `in_${slug(ruleIr.rule.rule_id)}_external`,
        source_lot_id: null,
        quantity: { asset: edge.asset, amount: String(input.amount_jpy) },
        role: "external_funding",
      },
    ];

  let remaining = BigInt(input.amount_jpy);
  const result: AssetInput[] = [];
  const lots = [...input.asset_lots]
    .filter((lot) => assetRefEqual(lot.quantity.asset, edge.asset))
    .sort((left, right) => left.lot_id.localeCompare(right.lot_id));
  for (const lot of lots) {
    if (!/^\d+$/u.test(lot.quantity.amount)) continue;
    const available = BigInt(lot.quantity.amount);
    if (available <= 0n) continue;
    const consumed = available < remaining ? available : remaining;
    result.push({
      input_id: `in_${slug(ruleIr.rule.rule_id)}_${result.length + 1}`,
      source_lot_id: lot.lot_id,
      quantity: { asset: edge.asset, amount: consumed.toString() },
      role:
        edge.asset.asset_kind === "reward_point"
          ? "points_tender"
          : "stored_value_tender",
    });
    remaining -= consumed;
    if (remaining === 0n) break;
  }
  if (remaining !== 0n) {
    issue(
      issues,
      "principal_balance_insufficient",
      "/asset_lots",
      `insufficient ${edge.asset.asset_id} principal`,
      ruleIr.rule.rule_id,
    );
    return null;
  }
  return result;
}

function slug(value: string) {
  return value.replace(/[^A-Za-z0-9_-]+/gu, "_").slice(0, 80);
}

export function generateDirectPurchasePlans(
  bundleValue: unknown,
  inputValue: unknown,
): DirectPurchaseGenerationResult {
  const bundleResult = validateExecutionBundle(bundleValue);
  if (!bundleResult.ok) throw new ExecutionBundleError("bundle_invalid");
  const input = parseInput(inputValue);
  if (!input) throw new ExecutionBundleError("input_invalid");
  resolveMerchant(
    { merchant_id: input.merchant_id, branch_id: input.branch_id },
    bundleResult.value.merchant_catalog,
  );

  const plansByRoute = new Map<string, PurchasePlan>();
  const selectedByRule = new Map<string, RuleIRV1>();
  const issues: ExecutionBundleIssue[] = [];
  for (const ruleIr of bundleResult.value.rule_irs) {
    const rule = ruleIr.rule as unknown as RewardRule;
    if (!rule.scope.operation_types.includes("merchant_purchase")) {
      issue(
        issues,
        "unsupported_operation",
        "/rule/scope/operation_types",
        "only direct merchant purchases are generated in v1",
        rule.rule_id,
      );
      continue;
    }
    if (!isActiveProvisionalRule(ruleIr.rule, input.effective_at)) {
      issue(
        issues,
        "rule_inactive",
        "/rule/validity",
        "rule is outside its economic window",
        rule.rule_id,
      );
      continue;
    }
    if (!ruleApplicable(rule, input)) {
      issue(
        issues,
        "rule_not_applicable",
        "/rule/scope",
        "rule does not apply to the requested purchase",
        rule.rule_id,
      );
      continue;
    }
    const match = rule.eligibility.operation_match;
    const instruments = [...(match.allowed_payment_instrument_ids ?? [])]
      .sort()
      .filter((id) => input.owned_instrument_ids.includes(id));
    if (instruments.length === 0) {
      issue(
        issues,
        "ownership_missing",
        "/owned_instrument_ids",
        "no explicitly allowed owned instrument is available",
        rule.rule_id,
      );
      continue;
    }
    const requiredPrograms = [
      ...(match.required_loyalty_program_ids ?? []),
    ].sort();
    if (
      requiredPrograms.some(
        (id) => !input.owned_loyalty_program_ids.includes(id),
      )
    ) {
      issue(
        issues,
        "ownership_missing",
        "/owned_loyalty_program_ids",
        "a required loyalty program is not owned",
        rule.rule_id,
      );
      continue;
    }
    const fundingSources = [...(match.allowed_funding_source_ids ?? [])]
      .sort()
      .filter((id) => input.available_funding_source_ids.includes(id));
    if (fundingSources.length === 0) {
      issue(
        issues,
        "funding_source_missing",
        "/available_funding_source_ids",
        "no explicitly allowed funding source is available",
        rule.rule_id,
      );
      continue;
    }
    if (
      match.required_interfaces &&
      !match.required_interfaces.includes(input.interface)
    ) {
      issue(
        issues,
        "rule_not_applicable",
        "/interface",
        "required payment interface is unavailable",
        rule.rule_id,
      );
      continue;
    }
    const assetInputs = inputsForPrincipal(ruleIr, input, issues);
    if (!assetInputs) continue;

    let addedRoute = false;
    for (const instrument of instruments) {
      for (const funding of fundingSources) {
        const route = {
          merchant_id: input.merchant_id,
          branch_id: input.branch_id,
          channel: input.channel,
          interface: input.interface,
          payment_instrument_id: instrument,
          funding_source_id: funding,
          required_program_ids: requiredPrograms,
          principal_inputs: assetInputs.map((assetInput) => ({
            source_lot_id: assetInput.source_lot_id,
            quantity: assetInput.quantity,
            role: assetInput.role,
          })),
        };
        const routeKey = hashCanonical(route);
        if (!plansByRoute.has(routeKey)) {
          const token = routeKey.slice("sha256:".length, 23);
          const operationId = `op_direct_${token}`;
          plansByRoute.set(routeKey, {
            plan_id: `plan_direct_${token}`,
            operations: [
              {
                operation_id: operationId,
                sequence: 1,
                occurred_at: input.effective_at,
                operation_type: "merchant_purchase",
                merchant_id: input.merchant_id,
                merchant_location_id: input.branch_id,
                channel: input.channel,
                interface: input.interface,
                payment_instrument_id: instrument,
                funding_source_id: funding,
                amount_jpy: input.amount_jpy,
                asset_inputs: assetInputs.map((assetInput, index) => ({
                  ...assetInput,
                  input_id: `in_direct_${token}_${index + 1}`,
                })),
                output_requests: [],
                original_operation_id: null,
                portal_id: null,
                line_items: [
                  {
                    line_item_id: `line_direct_${token}`,
                    product_class: input.product_class,
                    amount_jpy: input.amount_jpy,
                    tax_exclusive_amount_jpy: input.tax_exclusive_amount_jpy,
                    quantity: 1,
                    eligible_for_rewards: true,
                  },
                ],
                notes:
                  "Generated deterministically from a hash-bound Rule IR bundle route.",
              },
            ],
            dependencies: [],
            loyalty_presentments: requiredPrograms.map((programId, index) => ({
              operation_id: operationId,
              loyalty_program_id: programId,
              interface: input.interface,
              presentation_mode: "linked",
              sequence: index + 1,
            })),
            assumptions: [
              "Gross and tax-exclusive amounts were supplied explicitly.",
              "The host resolved the Rule IR and merchant catalogue.",
            ],
          });
        }
        addedRoute = true;
      }
    }
    if (addedRoute) selectedByRule.set(rule.rule_id, ruleIr);
  }
  const plans = [...plansByRoute.values()].sort((left, right) =>
    left.plan_id.localeCompare(right.plan_id),
  );
  const selected = [...selectedByRule.values()].sort((left, right) =>
    left.rule.rule_id.localeCompare(right.rule.rule_id),
  );
  return Object.freeze({
    plans: Object.freeze(plans),
    rule_irs: Object.freeze(selected),
    issues: sortedIssues(issues),
  });
}

function assetsFor(ruleIrs: readonly RuleIRV1[]): AssetDefinition[] {
  const assets = new Map<string, AssetDefinition>();
  for (const ruleIr of ruleIrs)
    for (const asset of ruleIr.assets as readonly AssetDefinition[])
      assets.set(asset.asset_id, asset);
  return [...assets.values()].sort((left, right) =>
    left.asset_id.localeCompare(right.asset_id),
  );
}

export function recommendExecutionBundle(
  bundleValue: unknown,
  inputValue: unknown,
): ExecutionBundleRecommendation {
  const bundle = validateExecutionBundle(bundleValue);
  if (!bundle.ok) throw new ExecutionBundleError("bundle_invalid");
  const input = parseInput(inputValue);
  if (!input) throw new ExecutionBundleError("input_invalid");
  const generation = generateDirectPurchasePlans(bundle.value, input);
  if (generation.plans.length === 0)
    throw new ExecutionBundleError("no_executable_plan");

  const userState: UserState = {
    owned_instrument_ids: [...input.owned_instrument_ids].sort(),
    owned_loyalty_program_ids: [...input.owned_loyalty_program_ids].sort(),
    facts: input.facts as Record<string, StateValue>,
    asset_lots: [...input.asset_lots],
    valuation_profile: {
      version: input.valuation_profile.version,
      entries: [...input.valuation_profile.entries],
    },
    cap_progress: input.cap_progress as Record<string, CapProgressState>,
  };
  const response = recommend({
    version: "1",
    request_id: input.request_id,
    mode: "experimental_real_data",
    experimental_rule_admission: "unverified_host",
    experimental_value_policy: "unvalued",
    transaction_time: input.effective_at,
    replay_knowledge_at: input.effective_at,
    timezone: "Asia/Tokyo",
    source_maintenance_status: { status: "insufficient_data" },
    merchant_query: {
      merchant_id: input.merchant_id,
      branch_id: input.branch_id,
    },
    merchant_catalog: bundle.value.merchant_catalog,
    comparison: {
      merchant_id: input.merchant_id,
      merchant_location_id: input.branch_id,
      amount_jpy: input.amount_jpy,
      channel: input.channel,
      interface: input.interface,
      line_items: generation.plans[0]?.operations[0]?.line_items ?? [],
    },
    candidate_plans: generation.plans,
    rules: generation.rule_irs.map(
      (item) => item.rule as unknown as RewardRule,
    ),
    assets: assetsFor(generation.rule_irs),
    user_state: userState,
    opening_asset_lots: userState.asset_lots,
    valuation_profile: [],
    objective: {
      primary: "maximize_guaranteed_net_value",
      probabilistic_reward_policy: "guaranteed_only",
      ending_asset_valuation: "exclude",
      tie_breakers: ["lower_external_funding", "fewer_operations"],
    },
    assumptions: [
      "Plans were generated from a host-owned hash-bound Rule IR bundle.",
      "Native rewards are not assigned an implicit JPY value.",
    ],
    freshness: {
      checked_at: input.effective_at,
      notes: ["Experimental executable bundle; not canonical publication."],
    },
  });
  return Object.freeze({ response, generation });
}
