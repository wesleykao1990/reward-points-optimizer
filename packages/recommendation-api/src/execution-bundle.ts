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
  AssetRef,
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
export const STORED_VALUE_TOP_UP_GRAPH_INPUT_VERSION =
  "stored-value-top-up-graph-input.v1" as const;
export const POINT_TRANSFER_GRAPH_INPUT_VERSION =
  "point-transfer-graph-input.v1" as const;

/** Compatibility aliases for callers that use the shorter operation names. */
export const TOP_UP_GRAPH_INPUT_VERSION =
  STORED_VALUE_TOP_UP_GRAPH_INPUT_VERSION;
export const TRANSFER_GRAPH_INPUT_VERSION = POINT_TRANSFER_GRAPH_INPUT_VERSION;

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

export interface StoredValueTopUpGraphInputV1 {
  readonly version: typeof STORED_VALUE_TOP_UP_GRAPH_INPUT_VERSION;
  readonly request_id: string;
  readonly channel: Channel;
  readonly interface: Interface;
  readonly amount_jpy: number;
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

export interface PointTransferGraphInputV1 {
  readonly version: typeof POINT_TRANSFER_GRAPH_INPUT_VERSION;
  readonly request_id: string;
  readonly operation_type: "point_transfer" | "point_redemption";
  readonly channel: Channel;
  readonly interface: Interface;
  readonly effective_at: string;
  readonly source_lot_id: string;
  readonly source_amount: string;
  /** Null delegates destination amount calculation to the rule engine. */
  readonly destination_amount: string | null;
  readonly fee_lot_id: string | null;
  readonly asset_lots: readonly AssetLot[];
  readonly facts: Readonly<Record<string, StateValue>>;
  readonly cap_progress: Readonly<Record<string, CapProgressState>>;
  readonly valuation_profile: {
    readonly version: string;
    readonly entries: readonly ValuationEntry[];
  };
  /** Optional only when the bundle contains more than one matching rule. */
  readonly rule_id?: string;
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
  | "unsupported_aggregation_scope"
  | "transfer_rule_ambiguous"
  | "destination_mapping_invalid"
  | "fee_mapping_invalid"
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

export interface StoredValueTopUpGenerationResult
  extends DirectPurchaseGenerationResult {}

export interface PointTransferGenerationResult
  extends DirectPurchaseGenerationResult {}

export type TopUpGraphInputV1 = StoredValueTopUpGraphInputV1;
export type TransferGraphInputV1 = PointTransferGraphInputV1;
export type TopUpGenerationResult = StoredValueTopUpGenerationResult;
export type TransferGenerationResult = PointTransferGenerationResult;
export type ExecutableGraphInputV1 =
  | DirectPurchaseGraphInputV1
  | StoredValueTopUpGraphInputV1
  | PointTransferGraphInputV1;

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
const TOP_UP_INPUT_KEYS = [
  "amount_jpy",
  "asset_lots",
  "available_funding_source_ids",
  "cap_progress",
  "channel",
  "effective_at",
  "facts",
  "interface",
  "owned_instrument_ids",
  "owned_loyalty_program_ids",
  "request_id",
  "valuation_profile",
  "version",
].sort();
const TRANSFER_INPUT_KEYS = [
  "asset_lots",
  "cap_progress",
  "channel",
  "destination_amount",
  "effective_at",
  "facts",
  "fee_lot_id",
  "interface",
  "operation_type",
  "request_id",
  "source_amount",
  "source_lot_id",
  "valuation_profile",
  "version",
].sort();
const TRANSFER_INPUT_KEYS_WITH_RULE = [
  ...TRANSFER_INPUT_KEYS,
  "rule_id",
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

function idArrayOrEmpty(value: unknown): value is readonly string[] {
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

function parseTopUpInput(value: unknown): StoredValueTopUpGraphInputV1 | null {
  const scan = scanPublicValue(value);
  if (!scan.valid || !record(scan.value)) return null;
  const input = scan.value;
  if (!exactKeys(input, TOP_UP_INPUT_KEYS)) return null;
  if (
    input.version !== STORED_VALUE_TOP_UP_GRAPH_INPUT_VERSION ||
    typeof input.request_id !== "string" ||
    input.request_id.length === 0 ||
    typeof input.effective_at !== "string" ||
    !isCanonicalProvisionalDateTime(input.effective_at) ||
    !Number.isSafeInteger(input.amount_jpy) ||
    Number(input.amount_jpy) <= 0 ||
    typeof input.channel !== "string" ||
    typeof input.interface !== "string" ||
    !idArrayOrEmpty(input.owned_instrument_ids) ||
    !idArrayOrEmpty(input.owned_loyalty_program_ids) ||
    !idArrayOrEmpty(input.available_funding_source_ids) ||
    !Array.isArray(input.asset_lots) ||
    !record(input.facts) ||
    !record(input.cap_progress) ||
    !record(input.valuation_profile)
  )
    return null;
  return input as unknown as StoredValueTopUpGraphInputV1;
}

function positiveDecimalString(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d+(?:\.\d+)?$/u.test(value))
    return false;
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole ?? "0") > 0n || BigInt(fraction || "0") > 0n;
}

function parseTransferInput(value: unknown): PointTransferGraphInputV1 | null {
  const scan = scanPublicValue(value);
  if (!scan.valid || !record(scan.value)) return null;
  const input = scan.value;
  if (
    !exactKeys(input, TRANSFER_INPUT_KEYS) &&
    !exactKeys(input, TRANSFER_INPUT_KEYS_WITH_RULE)
  )
    return null;
  if (
    input.version !== POINT_TRANSFER_GRAPH_INPUT_VERSION ||
    typeof input.request_id !== "string" ||
    input.request_id.length === 0 ||
    (input.operation_type !== "point_transfer" &&
      input.operation_type !== "point_redemption") ||
    typeof input.channel !== "string" ||
    typeof input.interface !== "string" ||
    typeof input.effective_at !== "string" ||
    !isCanonicalProvisionalDateTime(input.effective_at) ||
    typeof input.source_lot_id !== "string" ||
    input.source_lot_id.length === 0 ||
    !positiveDecimalString(input.source_amount) ||
    (input.destination_amount !== null &&
      !positiveDecimalString(input.destination_amount)) ||
    (input.fee_lot_id !== null &&
      (typeof input.fee_lot_id !== "string" ||
        input.fee_lot_id.length === 0)) ||
    ("rule_id" in input &&
      input.rule_id !== undefined &&
      (typeof input.rule_id !== "string" || input.rule_id.length === 0)) ||
    !Array.isArray(input.asset_lots) ||
    !record(input.facts) ||
    !record(input.cap_progress) ||
    !record(input.valuation_profile)
  )
    return null;
  return input as unknown as PointTransferGraphInputV1;
}

function assetRefEqual(left: AssetRef, right: AssetRef) {
  return (
    left.asset_id === right.asset_id &&
    left.asset_kind === right.asset_kind &&
    left.program_id === right.program_id &&
    left.reward_class === right.reward_class &&
    left.scale === right.scale
  );
}

function assetAmountUnits(amount: string, scale: number): bigint | null {
  if (!/^\d+(?:\.\d+)?$/u.test(amount)) return null;
  const [whole, fraction = ""] = amount.split(".");
  if (fraction.length > scale) return null;
  const padded = fraction.padEnd(scale, "0");
  try {
    return BigInt(whole ?? "0") * 10n ** BigInt(scale) + BigInt(padded || "0");
  } catch {
    return null;
  }
}

function canonicalPositiveDecimalAtScale(
  value: unknown,
  scale: number,
): value is string {
  if (
    typeof value !== "string" ||
    !/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(value)
  )
    return false;
  const units = assetAmountUnits(value, scale);
  return units !== null && units > 0n;
}

function exactPrincipalTopUpEdges(
  ruleIr: RuleIRV1,
  issues: ExecutionBundleIssue[],
): {
  readonly funding: RuleIRV1["principal_edges"][number];
  readonly output: RuleIRV1["principal_edges"][number];
} | null {
  const edges = ruleIr.principal_edges.filter(
    (edge) => edge.operation_type === "stored_value_top_up",
  );
  const funding = edges.filter(
    (edge) => edge.direction === "consume" && edge.role === "external_funding",
  );
  const output = edges.filter(
    (edge) => edge.direction === "create" && edge.role === "principal_output",
  );
  if (
    edges.length !== 2 ||
    funding.length !== 1 ||
    output.length !== 1 ||
    !funding[0] ||
    !output[0]
  ) {
    issue(
      issues,
      "principal_mapping_invalid",
      "/principal_edges",
      "stored-value top-up requires exactly one external-funding consume and one principal-output create edge",
      ruleIr.rule.rule_id,
    );
    return null;
  }
  if (output[0].asset.asset_kind !== "stored_value") {
    issue(
      issues,
      "principal_mapping_invalid",
      "/principal_edges",
      "stored-value top-up principal-output edge must reference a stored_value asset",
      ruleIr.rule.rule_id,
    );
    return null;
  }
  return { funding: funding[0], output: output[0] };
}

function exactTransferEdges(
  ruleIr: RuleIRV1,
  operationType: "point_transfer" | "point_redemption",
  issues: ExecutionBundleIssue[],
): {
  readonly source: RuleIRV1["principal_edges"][number];
  readonly destination: RuleIRV1["principal_edges"][number];
  readonly fee: RuleIRV1["principal_edges"][number] | null;
} | null {
  const calculation = ruleIr.rule.calculation;
  if (calculation?.model !== "transfer_ratio") {
    issue(
      issues,
      "unsupported_operation",
      "/rule/calculation",
      "point transfer generation requires a transfer-ratio calculation",
      ruleIr.rule.rule_id,
    );
    return null;
  }
  const edges = ruleIr.principal_edges.filter(
    (edge) => edge.operation_type === operationType,
  );
  const source = edges.filter(
    (edge) => edge.direction === "consume" && edge.role === "principal_tender",
  );
  const destination = edges.filter(
    (edge) => edge.direction === "create" && edge.role === "principal_output",
  );
  const fee = edges.filter(
    (edge) => edge.direction === "consume" && edge.role === "fee",
  );
  const expectedFeeCount = calculation.fee === null ? 0 : 1;
  if (
    edges.length !== 2 + expectedFeeCount ||
    source.length !== 1 ||
    destination.length !== 1 ||
    fee.length !== expectedFeeCount ||
    !source[0] ||
    !destination[0] ||
    !assetRefEqual(source[0].asset, calculation.source_asset) ||
    !assetRefEqual(destination[0].asset, calculation.destination_asset) ||
    (expectedFeeCount === 1 &&
      (!fee[0] ||
        !calculation.fee ||
        !assetRefEqual(fee[0].asset, calculation.fee.asset)))
  ) {
    issue(
      issues,
      "principal_mapping_invalid",
      "/principal_edges",
      `${operationType} generation requires exact source, destination, and declared fee edges`,
      ruleIr.rule.rule_id,
    );
    return null;
  }
  return {
    source: source[0],
    destination: destination[0],
    fee: fee[0] ?? null,
  };
}

function unsupportedAggregationScope(rule: RewardRule): string | null {
  const scope = rule.calculation?.rounding.aggregation_scope;
  if (
    scope === undefined ||
    scope === "per_operation" ||
    scope === "transfer_request"
  )
    return null;
  return scope;
}

function transferRouteMismatch(
  rule: RewardRule,
  input: PointTransferGraphInputV1,
  edges: {
    readonly source: RuleIRV1["principal_edges"][number];
    readonly destination: RuleIRV1["principal_edges"][number];
    readonly fee: RuleIRV1["principal_edges"][number] | null;
  },
): { readonly path: string; readonly message: string } | null {
  const scope = rule.scope;
  if ((scope.merchant_ids?.length ?? 0) > 0)
    return {
      path: "/rule/scope/merchant_ids",
      message: "transfer plans do not supply a merchant identity",
    };
  if ((scope.merchant_location_ids?.length ?? 0) > 0)
    return {
      path: "/rule/scope/merchant_location_ids",
      message: "transfer plans do not supply a merchant location",
    };
  if ((scope.included_product_classes?.length ?? 0) > 0)
    return {
      path: "/rule/scope/included_product_classes",
      message: "transfer plans do not supply product line items",
    };

  const match = rule.eligibility.operation_match;
  if ((match.allowed_payment_instrument_ids?.length ?? 0) > 0)
    return {
      path: "/rule/eligibility/operation_match/allowed_payment_instrument_ids",
      message: "transfer plans do not supply a payment instrument",
    };
  if ((match.allowed_funding_source_ids?.length ?? 0) > 0)
    return {
      path: "/rule/eligibility/operation_match/allowed_funding_source_ids",
      message: "transfer plans do not supply a funding source",
    };
  if ((match.required_loyalty_program_ids?.length ?? 0) > 0)
    return {
      path: "/rule/eligibility/operation_match/required_loyalty_program_ids",
      message: "transfer plans do not supply loyalty presentments",
    };
  if (
    match.allowed_source_asset_ids &&
    match.allowed_source_asset_ids.length > 0 &&
    !match.allowed_source_asset_ids.includes(edges.source.asset.asset_id)
  )
    return {
      path: "/rule/eligibility/operation_match/allowed_source_asset_ids",
      message: "the transfer principal source asset is not allowed",
    };
  if (
    match.excluded_source_asset_ids?.includes(edges.source.asset.asset_id) ||
    (edges.fee !== null &&
      match.excluded_source_asset_ids?.includes(edges.fee.asset.asset_id))
  )
    return {
      path: "/rule/eligibility/operation_match/excluded_source_asset_ids",
      message: "the transfer source asset is excluded",
    };
  if (
    match.allowed_destination_asset_ids &&
    match.allowed_destination_asset_ids.length > 0 &&
    !match.allowed_destination_asset_ids.includes(
      edges.destination.asset.asset_id,
    )
  )
    return {
      path: "/rule/eligibility/operation_match/allowed_destination_asset_ids",
      message: "the transfer destination asset is not allowed",
    };
  if (match.excluded_interfaces?.includes(input.interface))
    return {
      path: "/rule/eligibility/operation_match/excluded_interfaces",
      message: "transfer interface is excluded by the rule",
    };
  const minimum = rule.eligibility.transaction_conditions.minimum_amount_jpy;
  if (minimum !== undefined && minimum !== null && minimum > 0)
    return {
      path: "/rule/eligibility/transaction_conditions/minimum_amount_jpy",
      message: "transfer plans do not supply a JPY amount for this minimum",
    };
  return null;
}

function topUpRouteMatchesRule(
  rule: RewardRule,
  input: StoredValueTopUpGraphInputV1,
  fundingAsset: AssetRef,
  outputAsset: AssetRef,
): boolean {
  if (
    !rule.scope.operation_types.includes("stored_value_top_up") ||
    (!rule.scope.channels.includes(input.channel) &&
      !rule.scope.channels.includes("not_applicable"))
  )
    return false;
  if (
    (rule.scope.merchant_ids?.length ?? 0) > 0 ||
    (rule.scope.excluded_merchant_ids?.length ?? 0) > 0 ||
    (rule.scope.merchant_group_ids?.length ?? 0) > 0 ||
    (rule.scope.excluded_merchant_group_ids?.length ?? 0) > 0 ||
    (rule.scope.merchant_location_ids?.length ?? 0) > 0 ||
    (rule.scope.excluded_merchant_location_ids?.length ?? 0) > 0 ||
    (rule.scope.merchant_category_codes?.length ?? 0) > 0 ||
    (rule.scope.excluded_merchant_category_codes?.length ?? 0) > 0 ||
    (rule.scope.included_product_classes?.length ?? 0) > 0 ||
    (rule.scope.excluded_product_classes?.length ?? 0) > 0
  )
    return false;
  const match = rule.eligibility.operation_match;
  if (
    match.allowed_source_asset_ids &&
    match.allowed_source_asset_ids.length > 0 &&
    !match.allowed_source_asset_ids.includes(fundingAsset.asset_id)
  )
    return false;
  if (match.excluded_source_asset_ids?.includes(fundingAsset.asset_id))
    return false;
  if (
    match.allowed_destination_asset_ids &&
    match.allowed_destination_asset_ids.length > 0 &&
    !match.allowed_destination_asset_ids.includes(outputAsset.asset_id)
  )
    return false;
  return !match.excluded_interfaces?.includes(input.interface);
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
    const aggregationScope = unsupportedAggregationScope(rule);
    if (aggregationScope !== null) {
      issue(
        issues,
        "unsupported_aggregation_scope",
        "/rule/calculation/rounding/aggregation_scope",
        `${aggregationScope} aggregation is not representable by the direct purchase graph generator`,
        rule.rule_id,
      );
      continue;
    }
    if (rule.calculation?.model === "transfer_ratio") {
      issue(
        issues,
        "unsupported_operation",
        "/rule/calculation/model",
        "transfer-ratio rules require a point transfer or redemption graph",
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

function topUpPlan(
  input: StoredValueTopUpGraphInputV1,
  route: {
    readonly payment_instrument_id: string;
    readonly funding_source_id: string;
    readonly required_program_ids: readonly string[];
    readonly funding_asset: AssetRef;
    readonly output_asset: AssetRef;
  },
): PurchasePlan {
  const routeKey = hashCanonical({
    operation_type: "stored_value_top_up",
    channel: input.channel,
    interface: input.interface,
    amount_jpy: input.amount_jpy,
    payment_instrument_id: route.payment_instrument_id,
    funding_source_id: route.funding_source_id,
    required_program_ids: route.required_program_ids,
    funding_asset: route.funding_asset,
    output_asset: route.output_asset,
  });
  const token = routeKey.slice("sha256:".length, 23);
  const operationId = `op_topup_${token}`;
  return {
    plan_id: `plan_topup_${token}`,
    operations: [
      {
        operation_id: operationId,
        sequence: 1,
        occurred_at: input.effective_at,
        operation_type: "stored_value_top_up",
        merchant_id: null,
        merchant_location_id: null,
        channel: input.channel,
        interface: input.interface,
        payment_instrument_id: route.payment_instrument_id,
        funding_source_id: route.funding_source_id,
        amount_jpy: input.amount_jpy,
        asset_inputs: [
          {
            input_id: `in_topup_${token}_funding`,
            source_lot_id: null,
            quantity: {
              asset: route.funding_asset,
              amount: input.amount_jpy.toString(),
            },
            role: "external_funding",
          },
        ],
        output_requests: [
          {
            request_id: `out_topup_${token}_principal`,
            created_lot_id: `lot_topup_${token}_principal`,
            asset: route.output_asset,
            requested_amount: input.amount_jpy.toString(),
            role: "stored_value",
          },
        ],
        original_operation_id: null,
        portal_id: null,
        line_items: [],
        notes:
          "Generated deterministically from a host-supplied stored-value top-up Rule IR route.",
      },
    ],
    dependencies: [],
    loyalty_presentments: route.required_program_ids.map(
      (programId, index) => ({
        operation_id: operationId,
        loyalty_program_id: programId,
        interface: input.interface,
        presentation_mode: "linked" as const,
        sequence: index + 1,
      }),
    ),
    assumptions: [
      "The caller supplied the top-up amount, ownership, and funding availability explicitly.",
      "The caller supplied facts and cap progress; no enrollment or usage value was inferred.",
      "The principal output is created exactly once from the explicit external funding edge.",
    ],
  };
}

/**
 * Generate stored-value acquisition graphs while preserving all applicable
 * Rule IRs on one payment route.  Reward arithmetic, conditions, caps, and
 * conservation remain engine responsibilities.
 */
export function generateStoredValueTopUpPlans(
  bundleValue: unknown,
  inputValue: unknown,
): StoredValueTopUpGenerationResult {
  const bundleResult = validateExecutionBundle(bundleValue);
  if (!bundleResult.ok) throw new ExecutionBundleError("bundle_invalid");
  const input = parseTopUpInput(inputValue);
  if (!input) throw new ExecutionBundleError("input_invalid");

  const plansByRoute = new Map<string, PurchasePlan>();
  const selectedByRule = new Map<string, RuleIRV1>();
  const issues: ExecutionBundleIssue[] = [];
  for (const ruleIr of bundleResult.value.rule_irs) {
    const rule = ruleIr.rule as unknown as RewardRule;
    if (!rule.scope.operation_types.includes("stored_value_top_up")) {
      issue(
        issues,
        "unsupported_operation",
        "/rule/scope/operation_types",
        "only stored-value top-ups are generated by this graph builder",
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
    const edges = exactPrincipalTopUpEdges(ruleIr, issues);
    if (!edges) continue;
    if (
      !topUpRouteMatchesRule(
        rule,
        input,
        edges.funding.asset,
        edges.output.asset,
      )
    ) {
      issue(
        issues,
        "rule_not_applicable",
        "/rule/scope",
        "rule does not apply to the requested top-up route",
        rule.rule_id,
      );
      continue;
    }
    const aggregationScope = unsupportedAggregationScope(rule);
    if (aggregationScope !== null) {
      issue(
        issues,
        "unsupported_aggregation_scope",
        "/rule/calculation/rounding/aggregation_scope",
        `${aggregationScope} aggregation is not representable by the stored-value top-up graph generator`,
        rule.rule_id,
      );
      continue;
    }
    if (rule.calculation?.model === "transfer_ratio") {
      issue(
        issues,
        "unsupported_operation",
        "/rule/calculation/model",
        "transfer-ratio rules require a point transfer or redemption graph",
        rule.rule_id,
      );
      continue;
    }
    const match = rule.eligibility.operation_match;
    const instruments = [...(match.allowed_payment_instrument_ids ?? [])]
      .sort()
      .filter(
        (id) =>
          input.owned_instrument_ids.includes(id) &&
          !match.excluded_payment_instrument_ids?.includes(id),
      );
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
        (programId) => !input.owned_loyalty_program_ids.includes(programId),
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
      .filter(
        (id) =>
          input.available_funding_source_ids.includes(id) &&
          !match.excluded_funding_source_ids?.includes(id),
      );
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
        "required top-up interface is unavailable",
        rule.rule_id,
      );
      continue;
    }
    let addedRoute = false;
    for (const paymentInstrumentId of instruments) {
      for (const fundingSourceId of fundingSources) {
        const route = {
          payment_instrument_id: paymentInstrumentId,
          funding_source_id: fundingSourceId,
          required_program_ids: requiredPrograms,
          funding_asset: edges.funding.asset,
          output_asset: edges.output.asset,
        } as const;
        const routeKey = hashCanonical(route);
        if (!plansByRoute.has(routeKey))
          plansByRoute.set(routeKey, topUpPlan(input, route));
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

function transferPlan(
  input: PointTransferGraphInputV1,
  rule: RewardRule,
  edges: {
    readonly source: RuleIRV1["principal_edges"][number];
    readonly destination: RuleIRV1["principal_edges"][number];
    readonly fee: RuleIRV1["principal_edges"][number] | null;
  },
): PurchasePlan {
  const calculation = rule.calculation;
  if (calculation?.model !== "transfer_ratio")
    throw new TypeError("transfer_calculation_missing");
  const route = {
    operation_type: input.operation_type,
    channel: input.channel,
    interface: input.interface,
    source_lot_id: input.source_lot_id,
    source_amount: input.source_amount,
    destination_amount: input.destination_amount,
    fee_lot_id: input.fee_lot_id,
    source_asset: edges.source.asset,
    destination_asset: edges.destination.asset,
    fee_asset: edges.fee?.asset ?? null,
    fee_amount: calculation.fee?.amount ?? null,
    rule_id: rule.rule_id,
  };
  const routeKey = hashCanonical(route);
  const token = routeKey.slice("sha256:".length, 23);
  const operationId = `op_transfer_${token}`;
  const sourceRole =
    input.operation_type === "point_redemption"
      ? "redemption_source"
      : "transfer_source";
  const destinationRole =
    input.operation_type === "point_redemption"
      ? "redemption_destination"
      : "transfer_destination";
  const assetInputs: AssetInput[] = [
    {
      input_id: `in_transfer_${token}_source`,
      source_lot_id: input.source_lot_id,
      quantity: {
        asset: edges.source.asset,
        amount: input.source_amount,
      },
      role: sourceRole,
    },
  ];
  if (calculation.fee !== null && input.fee_lot_id !== null)
    assetInputs.push({
      input_id: `in_transfer_${token}_fee`,
      source_lot_id: input.fee_lot_id,
      quantity: {
        asset: calculation.fee.asset,
        amount: calculation.fee.amount,
      },
      role: "fee",
    });
  return {
    plan_id: `plan_transfer_${token}`,
    operations: [
      {
        operation_id: operationId,
        sequence: 1,
        occurred_at: input.effective_at,
        operation_type: input.operation_type,
        merchant_id: null,
        merchant_location_id: null,
        channel: input.channel,
        interface: input.interface,
        payment_instrument_id: null,
        funding_source_id: null,
        amount_jpy: null,
        asset_inputs: assetInputs,
        output_requests: [
          {
            request_id: `out_transfer_${token}_destination`,
            created_lot_id: `lot_transfer_${token}_destination`,
            asset: edges.destination.asset,
            requested_amount: input.destination_amount,
            role: destinationRole,
          },
        ],
        original_operation_id: null,
        portal_id: null,
        line_items: [],
        notes:
          "Generated deterministically from a host-supplied transfer Rule IR route; ratio and limits remain engine-evaluated.",
      },
    ],
    dependencies: [],
    loyalty_presentments: [],
    assumptions: [
      "The caller supplied the exact source lot and source amount.",
      "The destination amount is either supplied explicitly or left null for engine derivation.",
      "Transfer limits, rounding, settlement, fees, and cycle checks remain engine responsibilities.",
    ],
  };
}

/**
 * Generate one exact point transfer or redemption graph.  A caller must
 * disambiguate multiple matching transfer rules rather than allowing the
 * engine's single-rule transfer invariant to be violated.
 */
export function generatePointTransferPlans(
  bundleValue: unknown,
  inputValue: unknown,
): PointTransferGenerationResult {
  const bundleResult = validateExecutionBundle(bundleValue);
  if (!bundleResult.ok) throw new ExecutionBundleError("bundle_invalid");
  const input = parseTransferInput(inputValue);
  if (!input) throw new ExecutionBundleError("input_invalid");
  const issues: ExecutionBundleIssue[] = [];
  const sourceLot = input.asset_lots.find(
    (lot) => lot.lot_id === input.source_lot_id,
  );
  if (!sourceLot) {
    issue(
      issues,
      "principal_balance_insufficient",
      "/source_lot_id",
      "the exact source lot is not present in asset_lots",
    );
    return { plans: [], rule_irs: [], issues: sortedIssues(issues) };
  }
  const sourceUnits = assetAmountUnits(
    input.source_amount,
    sourceLot.quantity.asset.scale,
  );
  const availableUnits = assetAmountUnits(
    sourceLot.quantity.amount,
    sourceLot.quantity.asset.scale,
  );
  if (
    sourceUnits === null ||
    availableUnits === null ||
    sourceUnits <= 0n ||
    sourceUnits > availableUnits
  ) {
    issue(
      issues,
      "principal_balance_insufficient",
      "/source_amount",
      "the exact source lot cannot cover the requested source amount",
    );
    return { plans: [], rule_irs: [], issues: sortedIssues(issues) };
  }

  const candidates: Array<{
    readonly ruleIr: RuleIRV1;
    readonly edges: NonNullable<ReturnType<typeof exactTransferEdges>>;
  }> = [];
  for (const ruleIr of bundleResult.value.rule_irs) {
    const rule = ruleIr.rule as unknown as RewardRule;
    if (!rule.scope.operation_types.includes(input.operation_type)) {
      if (
        rule.scope.operation_types.includes("point_transfer") ||
        rule.scope.operation_types.includes("point_redemption")
      )
        issue(
          issues,
          "rule_not_applicable",
          "/rule/scope/operation_types",
          "transfer rule targets a different requested operation type",
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
    if (input.rule_id !== undefined && input.rule_id !== rule.rule_id) continue;
    const edges = exactTransferEdges(ruleIr, input.operation_type, issues);
    if (!edges) continue;
    if (!assetRefEqual(sourceLot.quantity.asset, edges.source.asset)) {
      issue(
        issues,
        "rule_not_applicable",
        "/asset_lots",
        "the exact source lot AssetRef does not match the transfer rule",
        rule.rule_id,
      );
      continue;
    }
    const match = rule.eligibility.operation_match;
    if (
      !rule.scope.channels.includes(input.channel) &&
      !rule.scope.channels.includes("not_applicable")
    ) {
      issue(
        issues,
        "rule_not_applicable",
        "/channel",
        "transfer channel is outside the rule scope",
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
        "transfer interface is outside the rule scope",
        rule.rule_id,
      );
      continue;
    }
    const mismatch = transferRouteMismatch(rule, input, edges);
    if (mismatch !== null) {
      issue(
        issues,
        "rule_not_applicable",
        mismatch.path,
        mismatch.message,
        rule.rule_id,
      );
      continue;
    }
    if (
      input.destination_amount !== null &&
      !canonicalPositiveDecimalAtScale(
        input.destination_amount,
        edges.destination.asset.scale,
      )
    ) {
      issue(
        issues,
        "destination_mapping_invalid",
        "/destination_amount",
        "explicit destination amount must be canonical and representable at the destination asset scale",
        rule.rule_id,
      );
      continue;
    }
    candidates.push({ ruleIr, edges });
  }
  if (candidates.length === 0) {
    if (input.rule_id !== undefined)
      issue(
        issues,
        "rule_not_applicable",
        "/rule_id",
        "the requested transfer rule is not active and applicable",
        input.rule_id,
      );
    else
      issue(
        issues,
        "rule_not_applicable",
        "/rule/scope",
        "no active transfer rule matches the exact source lot",
      );
    return { plans: [], rule_irs: [], issues: sortedIssues(issues) };
  }
  if (candidates.length > 1) {
    issue(
      issues,
      "transfer_rule_ambiguous",
      "/rule_irs",
      "multiple transfer rules match; supply rule_id to select exactly one",
    );
    return { plans: [], rule_irs: [], issues: sortedIssues(issues) };
  }
  const selected = candidates[0];
  if (!selected)
    return { plans: [], rule_irs: [], issues: sortedIssues(issues) };
  const rule = selected.ruleIr.rule as unknown as RewardRule;
  const calculation = rule.calculation;
  if (calculation?.model !== "transfer_ratio")
    return { plans: [], rule_irs: [], issues: sortedIssues(issues) };
  if (calculation.fee === null && input.fee_lot_id !== null) {
    issue(
      issues,
      "fee_mapping_invalid",
      "/fee_lot_id",
      "the selected transfer rule declares no fee lot",
      rule.rule_id,
    );
    return { plans: [], rule_irs: [], issues: sortedIssues(issues) };
  }
  if (calculation.fee !== null && input.fee_lot_id === null) {
    issue(
      issues,
      "fee_mapping_invalid",
      "/fee_lot_id",
      "the selected transfer rule requires an exact fee lot",
      rule.rule_id,
    );
    return { plans: [], rule_irs: [], issues: sortedIssues(issues) };
  }
  if (input.fee_lot_id !== null && input.fee_lot_id === input.source_lot_id) {
    issue(
      issues,
      "fee_mapping_invalid",
      "/fee_lot_id",
      "source and fee lots must be distinct",
      rule.rule_id,
    );
    return { plans: [], rule_irs: [], issues: sortedIssues(issues) };
  }
  if (calculation.fee !== null && input.fee_lot_id !== null) {
    const feeLot = input.asset_lots.find(
      (lot) => lot.lot_id === input.fee_lot_id,
    );
    const feeUnits = feeLot
      ? assetAmountUnits(feeLot.quantity.amount, feeLot.quantity.asset.scale)
      : null;
    const requiredUnits = assetAmountUnits(
      calculation.fee.amount,
      calculation.fee.asset.scale,
    );
    if (
      !feeLot ||
      requiredUnits === null ||
      feeUnits === null ||
      !assetRefEqual(feeLot.quantity.asset, calculation.fee.asset) ||
      feeUnits < requiredUnits
    ) {
      issue(
        issues,
        "fee_mapping_invalid",
        "/fee_lot_id",
        "the exact fee lot AssetRef or quantity does not match the transfer rule",
        rule.rule_id,
      );
      return { plans: [], rule_irs: [], issues: sortedIssues(issues) };
    }
  }
  const plan = transferPlan(input, rule, selected.edges);
  return {
    plans: Object.freeze([plan]),
    rule_irs: Object.freeze([selected.ruleIr]),
    issues: sortedIssues(issues),
  };
}

/** Compatibility alias for callers that name the operation as a conversion. */
export const generatePointConversionPlans = generatePointTransferPlans;
export const generatePointRedemptionPlans = generatePointTransferPlans;
export const generateTopUpPlans = generateStoredValueTopUpPlans;
export const generateTransferPlans = generatePointTransferPlans;

/** Dispatch the exact discriminated graph input to its bounded generator. */
export function generateExecutableGraphPlans(
  bundleValue: unknown,
  inputValue: unknown,
): DirectPurchaseGenerationResult {
  const scan = scanPublicValue(inputValue);
  if (scan.valid && record(scan.value)) {
    if (scan.value.version === DIRECT_PURCHASE_GRAPH_INPUT_VERSION)
      return generateDirectPurchasePlans(bundleValue, scan.value);
    if (scan.value.version === STORED_VALUE_TOP_UP_GRAPH_INPUT_VERSION)
      return generateStoredValueTopUpPlans(bundleValue, scan.value);
    if (scan.value.version === POINT_TRANSFER_GRAPH_INPUT_VERSION)
      return generatePointTransferPlans(bundleValue, scan.value);
  }
  throw new ExecutionBundleError("input_invalid");
}

export const generateGraphPlans = generateExecutableGraphPlans;

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
