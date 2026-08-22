import {
  type Asset,
  type AssetRef,
  type RewardRule,
  tryValidateDocument,
} from "@jro/contracts";

import { hashCanonical, hashDefinition } from "./canonical.js";
import { deepFreeze, scanPublicValue } from "./security.js";
import type { Sha256 } from "./types.js";

export const RULE_IR_VERSION = "rule-ir.v1" as const;

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{2,255}$/u;
const OPERATION_TYPES = new Set([
  "merchant_purchase",
  "stored_value_top_up",
  "voucher_purchase",
  "point_transfer",
  "point_redemption",
  "refund",
  "reversal",
  "portal_clickout",
]);
const EDGE_DIRECTIONS = new Set(["consume", "create"]);
const EDGE_ROLES = new Set([
  "external_funding",
  "principal_tender",
  "principal_output",
  "fee",
]);

export type RuleIROperationType =
  | "merchant_purchase"
  | "stored_value_top_up"
  | "voucher_purchase"
  | "point_transfer"
  | "point_redemption"
  | "refund"
  | "reversal"
  | "portal_clickout";

export interface RuleIRSourceBindingV1 {
  readonly claim_id: string;
  readonly family_id: string;
  readonly source_role_id: string;
  readonly source_ids: readonly string[];
  readonly observation_id: string;
  readonly observation_fingerprint: string;
  readonly evidence_ids: readonly string[];
  readonly candidate_id: string;
  readonly candidate_hash: Sha256;
  readonly definition_hash: Sha256;
}

export interface PrincipalEdgeV1 {
  readonly operation_type: RuleIROperationType;
  readonly direction: "consume" | "create";
  readonly role:
    | "external_funding"
    | "principal_tender"
    | "principal_output"
    | "fee";
  readonly asset: AssetRef;
  readonly conservation: "engine_enforced";
}

export interface RuleIRDraftV1 {
  readonly version: typeof RULE_IR_VERSION;
  readonly rule: RewardRule;
  readonly source_binding: RuleIRSourceBindingV1;
  readonly assets: readonly Asset[];
  readonly principal_edges: readonly PrincipalEdgeV1[];
}

export interface RuleIRV1 extends RuleIRDraftV1 {
  readonly bundle_hash: Sha256;
}

export type RuleIRIssueCode =
  | "representation_invalid"
  | "shape_invalid"
  | "rule_invalid"
  | "binding_invalid"
  | "definition_hash_mismatch"
  | "asset_invalid"
  | "asset_duplicate"
  | "asset_unresolved"
  | "edge_invalid"
  | "edge_duplicate"
  | "edge_mismatch"
  | "validity_invalid"
  | "bundle_hash_mismatch";

export interface RuleIRIssue {
  readonly code: RuleIRIssueCode;
  readonly path: string;
  readonly message: string;
}

export type RuleIRResult =
  | {
      readonly ok: true;
      readonly value: RuleIRV1;
      readonly issues: readonly [];
    }
  | {
      readonly ok: false;
      readonly value: null;
      readonly issues: readonly RuleIRIssue[];
    };

const DRAFT_KEYS = [
  "assets",
  "principal_edges",
  "rule",
  "source_binding",
  "version",
] as const;
const IR_KEYS = [...DRAFT_KEYS, "bundle_hash"].sort();
const BINDING_KEYS = [
  "candidate_hash",
  "candidate_id",
  "claim_id",
  "definition_hash",
  "evidence_ids",
  "family_id",
  "observation_fingerprint",
  "observation_id",
  "source_ids",
  "source_role_id",
] as const;
const EDGE_KEYS = [
  "asset",
  "conservation",
  "direction",
  "operation_type",
  "role",
] as const;
const ASSET_REF_KEYS = [
  "asset_id",
  "asset_kind",
  "program_id",
  "reward_class",
  "scale",
] as const;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return (
    actual.length === wanted.length &&
    actual.every((key, index) => key === wanted[index])
  );
}

function issue(
  issues: RuleIRIssue[],
  code: RuleIRIssueCode,
  path: string,
  message: string,
): void {
  issues.push({ code, path, message });
}

function sortedIssues(issues: readonly RuleIRIssue[]): readonly RuleIRIssue[] {
  return Object.freeze(
    [...issues].sort(
      (left, right) =>
        left.path.localeCompare(right.path) ||
        left.code.localeCompare(right.code) ||
        left.message.localeCompare(right.message),
    ),
  );
}

function stringArray(
  value: unknown,
  path: string,
  issues: RuleIRIssue[],
): string[] | null {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((item) => typeof item !== "string" || !ID.test(item)) ||
    new Set(value).size !== value.length
  ) {
    issue(
      issues,
      "binding_invalid",
      path,
      "must be a non-empty unique ID array",
    );
    return null;
  }
  return [...value].sort((left, right) => left.localeCompare(right));
}

function assetRef(value: unknown): value is AssetRef {
  if (!record(value) || !exactKeys(value, ASSET_REF_KEYS)) return false;
  return (
    typeof value.asset_id === "string" &&
    value.asset_id.length > 0 &&
    typeof value.asset_kind === "string" &&
    (typeof value.program_id === "string" || value.program_id === null) &&
    (typeof value.reward_class === "string" || value.reward_class === null) &&
    Number.isSafeInteger(value.scale) &&
    Number(value.scale) >= 0
  );
}

function sameAssetRef(left: AssetRef, right: AssetRef): boolean {
  return (
    left.asset_id === right.asset_id &&
    left.asset_kind === right.asset_kind &&
    left.program_id === right.program_id &&
    left.reward_class === right.reward_class &&
    left.scale === right.scale
  );
}

function assetDefinitionRef(asset: Asset): AssetRef {
  return {
    asset_id: asset.asset_id,
    asset_kind: asset.asset_kind,
    program_id: asset.program_id,
    reward_class: asset.default_reward_class,
    scale: asset.scale,
  };
}

function edgeKey(edge: PrincipalEdgeV1): string {
  return [
    edge.operation_type,
    edge.direction,
    edge.role,
    edge.asset.asset_id,
    edge.asset.asset_kind,
    edge.asset.program_id ?? "",
    edge.asset.reward_class ?? "",
    String(edge.asset.scale),
  ].join("\u0000");
}

function parseBinding(
  value: unknown,
  issues: RuleIRIssue[],
): RuleIRSourceBindingV1 | null {
  if (!record(value) || !exactKeys(value, BINDING_KEYS)) {
    issue(
      issues,
      "binding_invalid",
      "/source_binding",
      "source binding has an invalid shape",
    );
    return null;
  }
  for (const key of [
    "claim_id",
    "family_id",
    "source_role_id",
    "observation_id",
    "candidate_id",
  ] as const) {
    if (typeof value[key] !== "string" || !ID.test(value[key] as string))
      issue(
        issues,
        "binding_invalid",
        `/source_binding/${key}`,
        "must be a stable ID",
      );
  }
  if (
    typeof value.observation_fingerprint !== "string" ||
    value.observation_fingerprint.length < 8
  )
    issue(
      issues,
      "binding_invalid",
      "/source_binding/observation_fingerprint",
      "must bind the source observation fingerprint",
    );
  for (const key of ["candidate_hash", "definition_hash"] as const)
    if (typeof value[key] !== "string" || !SHA256.test(value[key] as string))
      issue(
        issues,
        "binding_invalid",
        `/source_binding/${key}`,
        "must be canonical sha256",
      );
  const sourceIds = stringArray(
    value.source_ids,
    "/source_binding/source_ids",
    issues,
  );
  const evidenceIds = stringArray(
    value.evidence_ids,
    "/source_binding/evidence_ids",
    issues,
  );
  if (
    issues.some((item) => item.code === "binding_invalid") ||
    !sourceIds ||
    !evidenceIds
  )
    return null;
  return {
    claim_id: value.claim_id as string,
    family_id: value.family_id as string,
    source_role_id: value.source_role_id as string,
    source_ids: sourceIds,
    observation_id: value.observation_id as string,
    observation_fingerprint: value.observation_fingerprint as string,
    evidence_ids: evidenceIds,
    candidate_id: value.candidate_id as string,
    candidate_hash: value.candidate_hash as Sha256,
    definition_hash: value.definition_hash as Sha256,
  };
}

function parseAssets(value: unknown, issues: RuleIRIssue[]): Asset[] {
  if (!Array.isArray(value)) {
    issue(issues, "shape_invalid", "/assets", "assets must be an array");
    return [];
  }
  const assets: Asset[] = [];
  for (const [index, candidate] of value.entries()) {
    const result = tryValidateDocument<Asset>(candidate, "asset");
    if (!result.valid) {
      issue(
        issues,
        "asset_invalid",
        `/assets/${index}`,
        "asset definition is invalid",
      );
      continue;
    }
    assets.push(result.value as Asset);
  }
  const ids = assets.map((asset) => asset.asset_id);
  if (new Set(ids).size !== ids.length)
    issue(issues, "asset_duplicate", "/assets", "asset IDs must be unique");
  return [...assets].sort((left, right) =>
    left.asset_id.localeCompare(right.asset_id),
  );
}

function parseEdges(value: unknown, issues: RuleIRIssue[]): PrincipalEdgeV1[] {
  if (!Array.isArray(value)) {
    issue(
      issues,
      "shape_invalid",
      "/principal_edges",
      "principal_edges must be an array",
    );
    return [];
  }
  const edges: PrincipalEdgeV1[] = [];
  for (const [index, candidate] of value.entries()) {
    const path = `/principal_edges/${index}`;
    if (!record(candidate) || !exactKeys(candidate, EDGE_KEYS)) {
      issue(
        issues,
        "edge_invalid",
        path,
        "principal edge has an invalid shape",
      );
      continue;
    }
    if (
      typeof candidate.operation_type !== "string" ||
      !OPERATION_TYPES.has(candidate.operation_type) ||
      typeof candidate.direction !== "string" ||
      !EDGE_DIRECTIONS.has(candidate.direction) ||
      typeof candidate.role !== "string" ||
      !EDGE_ROLES.has(candidate.role) ||
      candidate.conservation !== "engine_enforced" ||
      !assetRef(candidate.asset)
    ) {
      issue(issues, "edge_invalid", path, "principal edge values are invalid");
      continue;
    }
    edges.push(candidate as unknown as PrincipalEdgeV1);
  }
  const keys = edges.map(edgeKey);
  if (new Set(keys).size !== keys.length)
    issue(
      issues,
      "edge_duplicate",
      "/principal_edges",
      "principal edges must be unique",
    );
  return [...edges].sort((left, right) =>
    edgeKey(left).localeCompare(edgeKey(right)),
  );
}

function referencedAssetRefs(rule: RewardRule): AssetRef[] {
  const refs: AssetRef[] = [];
  if (rule.output && assetRef(rule.output.asset)) refs.push(rule.output.asset);
  if (rule.calculation?.model === "transfer_ratio") {
    if (assetRef(rule.calculation.source_asset))
      refs.push(rule.calculation.source_asset);
    if (assetRef(rule.calculation.destination_asset))
      refs.push(rule.calculation.destination_asset);
    if (rule.calculation.fee && assetRef(rule.calculation.fee.asset))
      refs.push(rule.calculation.fee.asset);
  }
  return refs;
}

function validateCrossFields(
  rule: RewardRule,
  binding: RuleIRSourceBindingV1,
  assets: readonly Asset[],
  edges: readonly PrincipalEdgeV1[],
  issues: RuleIRIssue[],
): void {
  if (hashDefinition(rule) !== binding.definition_hash)
    issue(
      issues,
      "definition_hash_mismatch",
      "/source_binding/definition_hash",
      "definition hash does not match the embedded RewardRule",
    );
  if (
    [...rule.provenance.evidence_ids].sort().join("\u0000") !==
    [...binding.evidence_ids].sort().join("\u0000")
  )
    issue(
      issues,
      "binding_invalid",
      "/source_binding/evidence_ids",
      "source binding evidence must equal RewardRule provenance evidence",
    );

  const validFrom = Date.parse(rule.validity.valid_from);
  const validTo =
    rule.validity.valid_to === null ? null : Date.parse(rule.validity.valid_to);
  if (
    !Number.isFinite(validFrom) ||
    (validTo !== null && (!Number.isFinite(validTo) || validTo <= validFrom))
  )
    issue(
      issues,
      "validity_invalid",
      "/rule/validity",
      "economic validity must be half-open and increasing",
    );

  const byId = new Map(assets.map((asset) => [asset.asset_id, asset]));
  for (const [index, ref] of referencedAssetRefs(rule).entries()) {
    const definition = byId.get(ref.asset_id);
    if (!definition || !sameAssetRef(ref, assetDefinitionRef(definition)))
      issue(
        issues,
        "asset_unresolved",
        `/rule/referenced_assets/${index}`,
        `asset ${ref.asset_id} does not resolve exactly`,
      );
  }
  for (const [index, edge] of edges.entries()) {
    const definition = byId.get(edge.asset.asset_id);
    if (
      !definition ||
      !sameAssetRef(edge.asset, assetDefinitionRef(definition))
    )
      issue(
        issues,
        "asset_unresolved",
        `/principal_edges/${index}/asset`,
        `asset ${edge.asset.asset_id} does not resolve exactly`,
      );
  }

  if (rule.calculation?.model === "transfer_ratio") {
    const source = rule.calculation.source_asset;
    const destination = rule.calculation.destination_asset;
    if (!rule.output || !sameAssetRef(rule.output.asset, destination))
      issue(
        issues,
        "edge_mismatch",
        "/rule/output/asset",
        "transfer output must equal the calculation destination asset",
      );
    const transferOperationTypes = rule.scope.operation_types.filter(
      (operationType) =>
        operationType === "point_transfer" ||
        operationType === "point_redemption",
    );
    for (const operationType of transferOperationTypes) {
      const operationEdges = edges.filter(
        (edge) => edge.operation_type === operationType,
      );
      const sourceEdges = operationEdges.filter(
        (edge) =>
          edge.direction === "consume" && edge.role === "principal_tender",
      );
      const destinationEdges = operationEdges.filter(
        (edge) =>
          edge.direction === "create" && edge.role === "principal_output",
      );
      const feeEdges = operationEdges.filter(
        (edge) => edge.direction === "consume" && edge.role === "fee",
      );
      const expectedFeeEdges = rule.calculation.fee === null ? 0 : 1;
      if (
        operationEdges.length !== 2 + expectedFeeEdges ||
        sourceEdges.length !== 1 ||
        destinationEdges.length !== 1 ||
        feeEdges.length !== expectedFeeEdges ||
        !sourceEdges[0] ||
        !destinationEdges[0] ||
        !sameAssetRef(sourceEdges[0].asset, source) ||
        !sameAssetRef(destinationEdges[0].asset, destination) ||
        (expectedFeeEdges === 1 &&
          (!feeEdges[0] ||
            !rule.calculation.fee ||
            !sameAssetRef(feeEdges[0].asset, rule.calculation.fee.asset)))
      )
        issue(
          issues,
          "edge_mismatch",
          "/principal_edges",
          `${operationType} transfer rules require exactly one matching source-consume, destination-create, and declared fee edge`,
        );
    }
  }

  if (rule.scope.operation_types.includes("stored_value_top_up")) {
    const topUpEdges = edges.filter(
      (edge) => edge.operation_type === "stored_value_top_up",
    );
    const externalFundingEdges = topUpEdges.filter(
      (edge) =>
        edge.direction === "consume" && edge.role === "external_funding",
    );
    const principalOutputEdges = topUpEdges.filter(
      (edge) => edge.direction === "create" && edge.role === "principal_output",
    );
    if (
      topUpEdges.length !== 2 ||
      externalFundingEdges.length !== 1 ||
      principalOutputEdges.length !== 1 ||
      principalOutputEdges[0]?.asset.asset_kind !== "stored_value"
    )
      issue(
        issues,
        "edge_mismatch",
        "/principal_edges",
        "stored-value top-up rules require exactly one external-funding consume and one stored_value principal-output create edge",
      );
  }

  if (rule.scope.operation_types.includes("merchant_purchase")) {
    const purchaseEdges = edges.filter(
      (edge) =>
        edge.operation_type === "merchant_purchase" &&
        edge.direction === "consume" &&
        (edge.role === "principal_tender" || edge.role === "external_funding"),
    );
    const allowedSourceAssets =
      rule.eligibility.operation_match.allowed_source_asset_ids ?? [];
    if (
      purchaseEdges.length !== 1 ||
      allowedSourceAssets.length !== 1 ||
      purchaseEdges[0]?.asset.asset_id !== allowedSourceAssets[0]
    )
      issue(
        issues,
        "edge_mismatch",
        "/principal_edges",
        "merchant purchase v1 requires one consume edge exactly bound by allowed_source_asset_ids",
      );
  }
}

function hashProjection(draft: RuleIRDraftV1): Sha256 {
  return hashCanonical(draft);
}

function parseDraft(value: unknown, withHash: boolean): RuleIRResult {
  const scan = scanPublicValue(value);
  if (!scan.valid) {
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
  }
  const input = scan.value;
  const issues: RuleIRIssue[] = [];
  if (!record(input) || !exactKeys(input, withHash ? IR_KEYS : DRAFT_KEYS)) {
    issue(
      issues,
      "shape_invalid",
      "",
      "Rule IR has an invalid top-level shape",
    );
    return { ok: false, value: null, issues: sortedIssues(issues) };
  }
  if (input.version !== RULE_IR_VERSION)
    issue(issues, "shape_invalid", "/version", "unsupported Rule IR version");

  const ruleResult = tryValidateDocument<RewardRule>(input.rule, "reward-rule");
  if (!ruleResult.valid)
    issue(issues, "rule_invalid", "/rule", "embedded RewardRule is invalid");
  const binding = parseBinding(input.source_binding, issues);
  const assets = parseAssets(input.assets, issues);
  const edges = parseEdges(input.principal_edges, issues);
  const rule = ruleResult.valid ? (ruleResult.value as RewardRule) : null;
  if (rule && binding)
    validateCrossFields(rule, binding, assets, edges, issues);
  if (issues.length > 0)
    return { ok: false, value: null, issues: sortedIssues(issues) };

  const draft: RuleIRDraftV1 = {
    version: RULE_IR_VERSION,
    rule: rule as RewardRule,
    source_binding: binding as RuleIRSourceBindingV1,
    assets,
    principal_edges: edges,
  };
  const computed = hashProjection(draft);
  if (withHash && input.bundle_hash !== computed) {
    issue(
      issues,
      "bundle_hash_mismatch",
      "/bundle_hash",
      "bundle hash does not match the normalized Rule IR",
    );
    return { ok: false, value: null, issues: sortedIssues(issues) };
  }
  return {
    ok: true,
    value: deepFreeze({ ...draft, bundle_hash: computed }),
    issues: [],
  };
}

/** Compile a trusted structured-rule draft into a deterministic executable envelope. */
export function compileRuleIR(value: unknown): RuleIRResult {
  return parseDraft(value, false);
}

/** Revalidate and hash-bind a persisted Rule IR envelope before host use. */
export function validateRuleIR(value: unknown): RuleIRResult {
  return parseDraft(value, true);
}

export function hashRuleIR(value: RuleIRV1): Sha256 {
  const result = validateRuleIR(value);
  if (!result.ok) throw new TypeError("rule_ir_invalid");
  return result.value.bundle_hash;
}
