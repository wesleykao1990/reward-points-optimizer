import { createHash } from "node:crypto";
import {
  type AssetDefinition,
  type EvaluatePlanOptions,
  evaluateCandidates,
  evaluatePlan,
  type NativePlanResult,
  type PurchasePlan,
  type RewardRule,
  ruleIsExperimentalCandidate,
  type ValuedPlanResult,
} from "@jro/rule-engine";
import {
  type MerchantCatalog,
  normalizeMerchantAlias,
  type ResolvedMerchant,
  resolveMerchant,
} from "./merchant.js";
import {
  assertAdmitted,
  assessRuleTrust,
  canonicalSnapshot,
  type RuleAssurance,
  type RuleTrustAssessment as TrustAssessment,
} from "./security.js";
import {
  type FreshnessInfo,
  type FrozenComparisonFacts,
  type FrozenLineItem,
  type PlanRejection,
  RECOMMENDATION_API_VERSION,
  type RecommendationMode,
  type RecommendationOutcome,
  type RecommendationPlan,
  type RecommendationRequest,
  type RecommendationResponse,
  type VerificationStatus,
} from "./types.js";

type JsonRecord = Record<string, unknown>;
const BLOCKED_OBJECTIVE_VALUES = new Set([
  "minimize_net_cost",
  "maximize_destination_value",
]);
const SUPPORTED_OBJECTIVE_VALUES = new Set([
  "maximize_guaranteed_net_value",
  "maximize_expected_net_value",
]);
const BAD_TRUST_VALUES = new Set([
  "stale",
  "degraded",
  "unknown",
  "lead",
  "lead_only",
  "missing",
  "incomplete",
  "unresolved",
  "high_risk",
  "high-risk",
  "not_approved",
  "rejected",
  "blocked",
  "needs_review",
  "needs_more_evidence",
  "capture_required",
]);
const TRUST_STATUS_KEYS = new Set([
  "status",
  "trust_status",
  "trustState",
  "trust_state",
  "evidence_status",
  "review_status",
  "reviewState",
  "review_state",
  "freshness_status",
  "freshnessState",
  "freshness_state",
  "terms_status",
  "termsState",
  "terms_state",
  "decision",
  "disposition",
]);
const PROHIBITED_OUTPUT_KEYS = new Set([
  "canonical_input",
  "canonical_output",
  "engine_canonical_input",
  "engine_canonical_output",
  "raw_credentials",
  "credential",
  "credentials",
  "secret",
  "token",
  "password",
  "api_key",
  "access_token",
  "refresh_token",
]);

export class RecommendationRequestError extends Error {
  readonly code: string;

  constructor(code: string, message = code) {
    super(message === code ? code : `${code}:${message}`);
    this.name = "RecommendationRequestError";
    this.code = code;
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value))
    return value;
  for (const child of Object.values(value as JsonRecord)) deepFreeze(child);
  return Object.freeze(value);
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new RecommendationRequestError("non_finite_number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as JsonRecord;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  throw new RecommendationRequestError(
    "unsupported_canonical_type",
    `unsupported canonical type ${typeof value}`,
  );
}

function hash(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`;
}

function jsonValue(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(jsonValue);
  if (value !== null && typeof value === "object") {
    const output: JsonRecord = {};
    for (const [key, child] of Object.entries(value as JsonRecord)) {
      const normalizedKey = key
        .replace(/([a-z])([A-Z])/gu, "$1_$2")
        .toLowerCase();
      if (
        PROHIBITED_OUTPUT_KEYS.has(key) ||
        PROHIBITED_OUTPUT_KEYS.has(normalizedKey)
      )
        continue;
      output[key] = jsonValue(child);
    }
    return output;
  }
  return value;
}

function record(value: unknown): JsonRecord {
  const converted = jsonValue(value);
  return isRecord(converted) ? converted : {};
}

function records(value: unknown): readonly JsonRecord[] {
  return Array.isArray(value) ? value.map(record) : [];
}

function validIsoTime(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(
      value,
    )
  )
    return false;
  const timestamp = Date.parse(value);
  return (
    Number.isFinite(timestamp) &&
    new Date(timestamp).toISOString() !== "Invalid Date"
  );
}

function requiredString(value: unknown, code: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0)
    throw new RecommendationRequestError(code);
}

function assertSecurityAdmission(request: RecommendationRequest): void {
  assertAdmitted(request);
}

function canonicalFrozenSnapshot<T>(request: T): T {
  return deepFreeze(clone(canonicalSnapshot(request).value as T));
}

function securityRuleAssessment(
  rules: readonly RewardRule[],
  assurances: readonly unknown[],
): TrustAssessment {
  const result = assessRuleTrust({
    rule_ids: rules.map((rule) => rule.rule_id),
    assurances: assurances as readonly RuleAssurance[],
  });
  return deepFreeze(clone(result as unknown as TrustAssessment));
}

function assuranceRuleId(value: unknown): string | null {
  if (!isRecord(value)) return null;
  for (const key of ["rule_id", "ruleId", "subject_id", "id"]) {
    if (typeof value[key] === "string") return value[key] as string;
  }
  return null;
}

function assuranceVersion(value: unknown): number | null {
  if (!isRecord(value)) return null;
  for (const key of ["version", "rule_version", "ruleVersion"]) {
    if (Number.isSafeInteger(value[key])) return value[key] as number;
  }
  return null;
}

function assuranceEvidenceCount(value: unknown): number {
  if (!isRecord(value)) return 0;
  let count = 0;
  for (const key of [
    "canonical_evidence_ids",
    "canonicalEvidenceIds",
    "evidence_ids",
    "evidenceIds",
    "evidence_refs",
    "evidenceRefs",
  ]) {
    if (Array.isArray(value[key]))
      count += value[key].filter(
        (item) => typeof item === "string" && item.length > 0,
      ).length;
  }
  for (const key of ["canonical_evidence", "canonicalEvidence"]) {
    if (Array.isArray(value[key])) count += value[key].length;
  }
  return count;
}

function suppliedAssurances(
  request: RecommendationRequest,
): readonly RuleAssurance[] {
  return (request.rule_assurances ??
    request.assurances ??
    []) as readonly RuleAssurance[];
}

function trustBadValues(value: unknown, key = ""): readonly string[] {
  const reasons: string[] = [];
  if (isRecord(value)) {
    for (const [childKey, child] of Object.entries(value)) {
      if (
        (childKey === "ok" ||
          childKey === "trusted" ||
          childKey === "verified" ||
          childKey === "review_complete") &&
        child === false
      )
        reasons.push(`${childKey}:false`);
      if (TRUST_STATUS_KEYS.has(childKey) && typeof child === "string") {
        const normalized = child
          .toLocaleLowerCase("en-US")
          .replaceAll("-", "_");
        if (BAD_TRUST_VALUES.has(normalized))
          reasons.push(`${childKey}:${normalized}`);
      }
      if (
        (childKey === "blockers" ||
          childKey === "issues" ||
          childKey === "missing" ||
          childKey === "unresolved") &&
        Array.isArray(child) &&
        child.length > 0
      )
        reasons.push(`${childKey}:non_empty`);
      reasons.push(...trustBadValues(child, childKey));
    }
  } else if (Array.isArray(value)) {
    for (const child of value) reasons.push(...trustBadValues(child, key));
  }
  return reasons;
}

function validateRuleTrust(
  request: RecommendationRequest,
): readonly TrustAssessment[] {
  const rules = request.rules ?? [];
  const assurances = suppliedAssurances(request);
  if (!Array.isArray(rules) || !Array.isArray(assurances))
    throw new RecommendationRequestError("rule_assurances_required");
  if (rules.length === 0) {
    if (assurances.length > 0)
      throw new RecommendationRequestError("rule_assurance_unexpected");
    return [];
  }
  const assuranceByKey = new Map<string, unknown[]>();
  for (const assurance of assurances) {
    const id = assuranceRuleId(assurance);
    if (!id)
      throw new RecommendationRequestError("rule_assurance_rule_id_missing");
    const version = assuranceVersion(assurance);
    if (version === null)
      throw new RecommendationRequestError("rule_assurance_version_missing");
    const key = `${id}@${version}`;
    assuranceByKey.set(key, [...(assuranceByKey.get(key) ?? []), assurance]);
  }
  const assessments: TrustAssessment[] = [];
  for (const rule of rules) {
    const matches = assuranceByKey.get(`${rule.rule_id}@${rule.version}`) ?? [];
    if (matches.length === 0)
      throw new RecommendationRequestError(
        "rule_assurance_missing",
        rule.rule_id,
      );
    if (matches.length > 1)
      throw new RecommendationRequestError(
        "rule_assurance_duplicate",
        rule.rule_id,
      );
    const assurance = matches[0];
    if (assuranceEvidenceCount(assurance) === 0)
      throw new RecommendationRequestError(
        "rule_assurance_evidence_missing",
        rule.rule_id,
      );
  }
  const expectedKeys = new Set(
    rules.map((rule) => `${rule.rule_id}@${rule.version}`),
  );
  for (const assurance of assurances) {
    const id = assuranceRuleId(assurance);
    if (!id) continue;
    const version = assuranceVersion(assurance);
    if (version === null || !expectedKeys.has(`${id}@${version}`))
      throw new RecommendationRequestError(
        "rule_assurance_unexpected",
        version === null ? id : `${id}@${version}`,
      );
  }
  const assessment = securityRuleAssessment(rules, assurances);
  const bad = trustBadValues(assessment);
  if (bad.length > 0)
    throw new RecommendationRequestError("rule_trust_blocked", bad.join(","));
  assessments.push(assessment);
  return assessments;
}

/**
 * Experimental recommendations deliberately carry no trust assurance.  The
 * host proves the route and explicitly opts into this lane; this function
 * only checks that the supplied rule is still an unmodified under-review
 * candidate.  In particular, it rejects a caller that changes the candidate
 * to a published or human-reviewed rule and then labels it experimental.
 */
function validateExperimentalRuleAdmission(
  request: RecommendationRequest,
): readonly TrustAssessment[] {
  if (request.experimental_rule_admission !== "unverified_host")
    throw new RecommendationRequestError("experimental_admission_required");
  if (request.experimental_value_policy !== "unvalued")
    throw new RecommendationRequestError("experimental_value_policy_required");
  if (
    (request.rule_assurances ?? []).length > 0 ||
    (request.assurances ?? []).length > 0
  )
    throw new RecommendationRequestError("experimental_assurances_forbidden");
  if (!Array.isArray(request.rules) || request.rules.length === 0)
    throw new RecommendationRequestError("experimental_rules_required");
  for (const rule of request.rules) {
    if (!ruleIsExperimentalCandidate(rule))
      throw new RecommendationRequestError(
        "experimental_rule_not_unverified",
        rule.rule_id,
      );
  }
  return [];
}

interface LineItemLike {
  readonly product_class: string;
  readonly amount_jpy: number;
  readonly quantity: number;
  readonly eligible_for_rewards?: boolean | null;
}

function normalizeLineItems(
  items: readonly LineItemLike[],
): readonly Record<string, unknown>[] {
  return items
    .map((item) => {
      requiredString(item.product_class, "line_item_product_class_required");
      if (!Number.isSafeInteger(item.amount_jpy) || item.amount_jpy < 0)
        throw new RecommendationRequestError("line_item_amount_invalid");
      if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0)
        throw new RecommendationRequestError("line_item_quantity_invalid");
      return {
        product_class: item.product_class,
        amount_jpy: item.amount_jpy,
        quantity: item.quantity,
        ...(item.eligible_for_rewards === undefined
          ? {}
          : { eligible_for_rewards: item.eligible_for_rewards }),
      };
    })
    .sort((left, right) =>
      canonicalJson(left).localeCompare(canonicalJson(right)),
    );
}

function lineItemSignature(items: readonly LineItemLike[]): string {
  return canonicalJson(normalizeLineItems(items));
}

function comparisonFromRequest(
  request: RecommendationRequest,
): FrozenComparisonFacts {
  const source =
    request.comparison ??
    request.frozen_comparison ??
    request.frozen_comparison_facts;
  if (!source)
    throw new RecommendationRequestError("frozen_comparison_required");
  const value = record(source);
  const merchantValue = value.merchant;
  const locationValue = value.location;
  const merchantId =
    typeof value.merchant_id === "string"
      ? value.merchant_id
      : isRecord(merchantValue) && typeof merchantValue.merchant_id === "string"
        ? merchantValue.merchant_id
        : typeof merchantValue === "string"
          ? merchantValue
          : undefined;
  const locationId =
    typeof value.merchant_location_id === "string"
      ? value.merchant_location_id
      : typeof value.location_id === "string"
        ? value.location_id
        : isRecord(locationValue) &&
            typeof locationValue.location_id === "string"
          ? locationValue.location_id
          : typeof locationValue === "string"
            ? locationValue
            : undefined;
  const amount = Number.isSafeInteger(value.amount_jpy)
    ? value.amount_jpy
    : value.amount;
  const channel =
    typeof value.channel === "string" ? value.channel : value.payment_channel;
  const interfaceValue =
    typeof value.interface === "string"
      ? value.interface
      : value.payment_interface;
  const lineItemsValue = Array.isArray(value.line_items)
    ? value.line_items
    : value.items;
  requiredString(merchantId, "comparison_merchant_id_required");
  requiredString(locationId, "comparison_merchant_location_id_required");
  if (!Number.isSafeInteger(amount) || (amount as number) <= 0)
    throw new RecommendationRequestError("comparison_amount_invalid");
  requiredString(channel, "comparison_channel_required");
  requiredString(interfaceValue, "comparison_interface_required");
  if (!Array.isArray(lineItemsValue))
    throw new RecommendationRequestError("comparison_line_items_required");
  return deepFreeze({
    merchant_id: merchantId,
    merchant_location_id: locationId,
    amount_jpy: amount as number,
    channel,
    interface: interfaceValue,
    line_items: normalizeLineItems(
      lineItemsValue as FrozenLineItem[],
    ) as unknown as FrozenLineItem[],
  });
}

function candidatePurchase(
  plan: PurchasePlan,
): readonly PurchasePlan["operations"][number][] {
  return (plan.operations ?? []).filter(
    (operation: PurchasePlan["operations"][number]) =>
      operation.operation_type === "merchant_purchase",
  );
}

function validateCandidatePurchase(
  plan: PurchasePlan,
  comparison: FrozenComparisonFacts,
  transactionTime: string,
): readonly string[] {
  const reasons: string[] = [];
  const purchases = candidatePurchase(plan);
  if (purchases.length === 0) return ["merchant_purchase_required"];
  const transactionDate = transactionTime.slice(0, 10);
  for (const purchase of purchases) {
    if (purchase.merchant_id !== comparison.merchant_id)
      reasons.push("merchant_mismatch");
    if (purchase.merchant_location_id !== comparison.merchant_location_id)
      reasons.push("branch_mismatch");
    if (purchase.amount_jpy !== comparison.amount_jpy)
      reasons.push("amount_mismatch");
    if (purchase.channel !== comparison.channel)
      reasons.push("channel_mismatch");
    if (purchase.interface !== comparison.interface)
      reasons.push("interface_mismatch");
    if (
      !validIsoTime(purchase.occurred_at) ||
      purchase.occurred_at.slice(0, 10) !== transactionDate
    )
      reasons.push("occurred_at_date_mismatch");
    if (
      lineItemSignature(purchase.line_items) !==
      lineItemSignature(comparison.line_items)
    )
      reasons.push("line_items_mismatch");
  }
  return [...new Set(reasons)];
}

function validateTimes(request: RecommendationRequest): void {
  if (!validIsoTime(request.transaction_time))
    throw new RecommendationRequestError("transaction_time_required_explicit");
  if (!validIsoTime(request.replay_knowledge_at))
    throw new RecommendationRequestError(
      "replay_knowledge_at_required_explicit",
    );
  if (
    Date.parse(request.replay_knowledge_at) <
    Date.parse(request.transaction_time)
  )
    throw new RecommendationRequestError("replay_knowledge_before_transaction");
}

function validateObjective(request: RecommendationRequest): void {
  const objective = request.objective;
  if (!objective || typeof objective.primary !== "string")
    throw new RecommendationRequestError("objective_primary_required");
  if (BLOCKED_OBJECTIVE_VALUES.has(objective.primary))
    throw new RecommendationRequestError(
      "unsupported_engine_objective",
      objective.primary,
    );
  if (!SUPPORTED_OBJECTIVE_VALUES.has(objective.primary))
    throw new RecommendationRequestError(
      "unsupported_engine_objective",
      objective.primary,
    );
  if (!objective.probabilistic_reward_policy)
    throw new RecommendationRequestError(
      "objective_probability_policy_required",
    );
  if (!objective.ending_asset_valuation)
    throw new RecommendationRequestError("objective_valuation_policy_required");
  if (!Array.isArray(objective.tie_breakers))
    throw new RecommendationRequestError("objective_tie_breakers_required");
}

function normalizeAssetInput(
  assets: RecommendationRequest["assets"],
): readonly AssetDefinition[] {
  if (Array.isArray(assets))
    return [...assets].sort((left, right) =>
      left.asset_id.localeCompare(right.asset_id),
    );
  return Object.values(assets).sort((left, right) =>
    left.asset_id.localeCompare(right.asset_id),
  );
}

function normalizeUserStateForHash(request: RecommendationRequest): JsonRecord {
  const state = clone(request.user_state) as unknown as JsonRecord;
  if (Array.isArray(state.owned_instrument_ids))
    state.owned_instrument_ids = [...state.owned_instrument_ids].sort();
  if (Array.isArray(state.owned_loyalty_program_ids))
    state.owned_loyalty_program_ids = [
      ...state.owned_loyalty_program_ids,
    ].sort();
  if (Array.isArray(state.asset_lots))
    state.asset_lots = [...state.asset_lots].sort((left, right) =>
      String((left as JsonRecord).lot_id).localeCompare(
        String((right as JsonRecord).lot_id),
      ),
    );
  const valuation = state.valuation_profile;
  if (isRecord(valuation) && Array.isArray(valuation.entries)) {
    state.valuation_profile = {
      ...valuation,
      entries: [...valuation.entries].sort((left, right) =>
        canonicalJson(left).localeCompare(canonicalJson(right)),
      ),
    };
  }
  return state;
}

function normalizeCatalog(catalog: MerchantCatalog): MerchantCatalog {
  return {
    version: catalog.version,
    merchants: [...catalog.merchants]
      .map((merchant) => ({
        ...merchant,
        ...(merchant.aliases
          ? {
              aliases: [...merchant.aliases].sort((a, b) =>
                normalizeMerchantAlias(a).localeCompare(
                  normalizeMerchantAlias(b),
                ),
              ),
            }
          : {}),
        branches: [...merchant.branches]
          .map((branch) => ({
            ...branch,
            ...(branch.aliases
              ? {
                  aliases: [...branch.aliases].sort((a, b) =>
                    normalizeMerchantAlias(a).localeCompare(
                      normalizeMerchantAlias(b),
                    ),
                  ),
                }
              : {}),
          }))
          .sort((a, b) => a.branch_id.localeCompare(b.branch_id)),
      }))
      .sort((a, b) => a.merchant_id.localeCompare(b.merchant_id)),
  };
}

function normalizedRequestForHash(
  request: RecommendationRequest,
  comparison: FrozenComparisonFacts,
): JsonRecord {
  const normalized: JsonRecord = {
    ...record(request),
    version: RECOMMENDATION_API_VERSION,
    comparison,
    candidate_plans: [...request.candidate_plans].sort((left, right) =>
      left.plan_id.localeCompare(right.plan_id),
    ),
    frozen_comparison: undefined,
    frozen_comparison_facts: undefined,
    assurances: undefined,
    operational_source_maintenance_status: undefined,
    merchant_catalog: normalizeCatalog(request.merchant_catalog),
    assets: [...normalizeAssetInput(request.assets)],
    user_state: normalizeUserStateForHash(request),
    rules: [...request.rules].sort((left, right) =>
      `${left.rule_id}@${left.version}`.localeCompare(
        `${right.rule_id}@${right.version}`,
      ),
    ),
    rule_assurances: [...suppliedAssurances(request)].sort((left, right) =>
      canonicalJson(left).localeCompare(canonicalJson(right)),
    ),
    evidence_refs: [...(request.evidence_refs ?? [])].sort((left, right) =>
      left.evidence_id.localeCompare(right.evidence_id),
    ),
  };
  return normalized;
}

function freshness(request: RecommendationRequest): FreshnessInfo {
  return deepFreeze(
    clone(request.freshness ?? { notes: ["freshness_is_input_metadata_only"] }),
  );
}

function assuranceBlockResponse(
  request: RecommendationRequest,
  merchant: ResolvedMerchant,
  comparison: FrozenComparisonFacts,
  blockers: readonly string[],
  assessments: readonly TrustAssessment[],
  inputHash: string,
): RecommendationResponse {
  const payload: Omit<RecommendationResponse, "replay"> = {
    version: RECOMMENDATION_API_VERSION,
    request_id: request.request_id,
    mode: request.mode,
    verification_status: "blocked",
    outcome: "blocked",
    winner_plan_id: null,
    safe_plan_id: null,
    runner_up_plan_id: null,
    winner: null,
    safe_plan: null,
    runner_up: null,
    conditional_winners: [],
    eligible_plans: [],
    rejected_plans: [],
    plans: [],
    merchant,
    comparison,
    assumptions: [...(request.assumptions ?? [])],
    questions: [...(request.questions ?? [])],
    freshness: freshness(request),
    evidence_refs: [...(request.evidence_refs ?? [])],
    valuation_sensitivities: [],
    trust_assessments: [...assessments],
    blockers: [...blockers],
  };
  return deepFreeze({
    ...payload,
    replay: {
      contract_version: RECOMMENDATION_API_VERSION,
      input_hash: inputHash,
      output_hash: hash(payload),
    },
  });
}

function planRejection(
  plan: PurchasePlan,
  reasons: readonly string[],
): RecommendationPlan {
  return {
    plan_id: plan.plan_id,
    eligible: false,
    operations: records(plan.operations),
    principal_movements: [],
    asset_movements: [],
    rewards: [],
    reward_components: [],
    ending_assets: [],
    ending_asset_lots: [],
    economics: null,
    objective_score_jpy: null,
    applied_rule_ids: [],
    rejected_rule_ids: [],
    rejection_reasons: reasons.map((message) => ({
      code: message,
      message,
    })),
    native_snapshot_hash: null,
  };
}

function evaluatedPlan(
  value: NativePlanResult | ValuedPlanResult,
): RecommendationPlan {
  const input = record(value);
  const movements = records(value.asset_movements);
  const rewards = records(value.reward_components);
  const rejected: readonly PlanRejection[] = records(
    value.rejection_reasons,
  ).map((reason) => {
    const code =
      typeof reason.code === "string" && /^[a-z0-9_]+$/u.test(reason.code)
        ? reason.code
        : "engine_plan_rejected";
    return { code, message: code };
  });
  return {
    plan_id: value.plan_id,
    eligible: value.eligible,
    operations: records(value.operations),
    principal_movements: movements.filter((movement) =>
      ["external_funding", "principal_tender", "principal_output"].includes(
        String(movement.movement_role),
      ),
    ),
    asset_movements: movements,
    rewards,
    reward_components: rewards,
    ending_assets: records(value.ending_asset_lots),
    ending_asset_lots: records(value.ending_asset_lots),
    economics: "economics" in input ? record(input.economics) : null,
    objective_score_jpy:
      typeof input.objective_score_jpy === "string"
        ? input.objective_score_jpy
        : null,
    applied_rule_ids: [...value.applied_rule_ids],
    rejected_rule_ids: [...value.rejected_rule_ids],
    rejection_reasons: rejected,
    native_snapshot_hash:
      typeof value.native_snapshot === "string" ? value.native_snapshot : null,
  };
}

function engineContext(request: RecommendationRequest): EvaluatePlanOptions {
  const valuation =
    request.valuation_profile ?? request.user_state.valuation_profile.entries;
  return {
    rules: [...request.rules],
    assets: [...normalizeAssetInput(request.assets)],
    user_state: clone(request.user_state),
    opening_asset_lots: [
      ...clone(request.opening_asset_lots ?? request.user_state.asset_lots),
    ],
    valuation_profile: [...clone(valuation)],
    transaction_time: request.transaction_time,
    replay_knowledge_at: request.replay_knowledge_at,
    objective: clone(request.objective),
    feasibleStates: clone(
      request.feasible_states ?? request.feasibleStates ?? [],
    ),
    rule_evaluation_policy:
      request.mode === "experimental_real_data"
        ? "experimental_unverified"
        : "approved",
    valuation_policy:
      request.mode === "experimental_real_data" ? "unvalued" : "explicit",
  };
}

function combinedAssumptions(
  request: RecommendationRequest,
): readonly string[] {
  const output: string[] = [];
  const seen = new Set<string>();
  for (const item of request.assumptions ?? []) {
    if (seen.has(item)) continue;
    seen.add(item);
    output.push(item);
  }
  for (const plan of request.candidate_plans) {
    for (const item of plan.assumptions ?? []) {
      if (seen.has(item)) continue;
      seen.add(item);
      output.push(item);
    }
  }
  return output.sort((left, right) => left.localeCompare(right));
}

function engineQuestions(
  engineRecommendation: JsonRecord,
  request: RecommendationRequest,
): readonly string[] {
  const result = [...(request.questions ?? [])];
  const seen = new Set(result);
  const questions = Array.isArray(engineRecommendation.questions_to_resolve)
    ? engineRecommendation.questions_to_resolve
    : [];
  for (const question of questions) {
    const value =
      isRecord(question) && typeof question.question === "string"
        ? question.question
        : null;
    if (value && !seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }
  return result.sort((left, right) => left.localeCompare(right));
}

function ensureProductionGate(
  request: RecommendationRequest,
): readonly string[] {
  // V1 is an internal/synthetic foundation.  A caller-provided green source
  // status is evidence metadata, not production authorization.
  if (request.mode === "production")
    return ["production_authorization_unavailable"];
  return [];
}

function validateRequestShape(request: RecommendationRequest): void {
  if (!request || typeof request !== "object")
    throw new RecommendationRequestError("request_required");
  if (request.version !== RECOMMENDATION_API_VERSION)
    throw new RecommendationRequestError("unsupported_api_version");
  requiredString(request.request_id, "request_id_required");
  if (
    !(
      [
        "production",
        "synthetic_internal",
        "experimental_real_data",
      ] as readonly RecommendationMode[]
    ).includes(request.mode)
  )
    throw new RecommendationRequestError("mode_required");
  if (request.mode === "experimental_real_data") {
    if (request.experimental_rule_admission !== "unverified_host")
      throw new RecommendationRequestError("experimental_admission_required");
    if (request.experimental_value_policy !== "unvalued")
      throw new RecommendationRequestError(
        "experimental_value_policy_required",
      );
  }
  if (request.timezone !== "Asia/Tokyo")
    throw new RecommendationRequestError("timezone_must_be_asia_tokyo");
  validateTimes(request);
  validateObjective(request);
  const sourceStatus =
    request.source_maintenance_status ??
    request.operational_source_maintenance_status;
  if (
    !sourceStatus ||
    (typeof sourceStatus !== "string" &&
      typeof sourceStatus.status !== "string")
  )
    throw new RecommendationRequestError("source_maintenance_status_required");
  if (
    !Array.isArray(request.candidate_plans) ||
    request.candidate_plans.length === 0
  )
    throw new RecommendationRequestError("candidate_plans_required");
  const planIds = request.candidate_plans.map((plan) => plan.plan_id);
  if (
    planIds.some(
      (planId) => typeof planId !== "string" || planId.length === 0,
    ) ||
    new Set(planIds).size !== planIds.length
  )
    throw new RecommendationRequestError("candidate_plan_ids_invalid");
  if (!Array.isArray(request.rules))
    throw new RecommendationRequestError("rules_required");
  if (
    !request.assets ||
    (!Array.isArray(request.assets) && !isRecord(request.assets))
  )
    throw new RecommendationRequestError("assets_required");
  if (!request.user_state || !Array.isArray(request.user_state.asset_lots))
    throw new RecommendationRequestError("user_state_required");
  if (!request.merchant_catalog)
    throw new RecommendationRequestError("merchant_catalog_required");
}

/**
 * Evaluate the pure, synchronous V1 recommendation boundary.
 *
 * Security admission and canonical freezing happen before this function hashes
 * or evaluates any user-provided value.  The engine's native canonical input
 * and output are intentionally discarded at this boundary.
 */
export function recommend(
  input: RecommendationRequest,
): RecommendationResponse {
  assertSecurityAdmission(input);
  const snapshot = canonicalFrozenSnapshot(input);
  const request = snapshot as RecommendationRequest;
  validateRequestShape(request);
  const comparison = comparisonFromRequest(request);
  const merchant = resolveMerchant(
    request.merchant_query,
    request.merchant_catalog,
  );
  if (
    comparison.merchant_id !== merchant.merchant_id ||
    comparison.merchant_location_id !== merchant.branch_id
  )
    throw new RecommendationRequestError(
      "comparison_merchant_resolution_mismatch",
    );
  const inputHash = hash(normalizedRequestForHash(request, comparison));
  const trustAssessments =
    request.mode === "experimental_real_data"
      ? validateExperimentalRuleAdmission(request)
      : validateRuleTrust(request);
  const gateBlockers = ensureProductionGate(request);
  if (gateBlockers.length > 0)
    return assuranceBlockResponse(
      request,
      merchant,
      comparison,
      gateBlockers,
      trustAssessments,
      inputHash,
    );

  const context = engineContext(request);
  const candidatePlans = [...request.candidate_plans].sort((left, right) =>
    left.plan_id.localeCompare(right.plan_id),
  );
  const acceptedPlans: PurchasePlan[] = [];
  const candidateById = new Map(
    candidatePlans.map((plan) => [plan.plan_id, plan]),
  );
  const rejectedById = new Map<string, RecommendationPlan>();
  for (const plan of candidatePlans) {
    const reasons = validateCandidatePurchase(
      plan,
      comparison,
      request.transaction_time,
    );
    if (reasons.length > 0)
      rejectedById.set(plan.plan_id, planRejection(plan, reasons));
    else acceptedPlans.push(plan);
  }
  const individual = new Map<string, RecommendationPlan>();
  for (const plan of acceptedPlans) {
    try {
      const evaluated = evaluatePlan(plan, context);
      const publicPlan = evaluatedPlan(evaluated);
      individual.set(plan.plan_id, publicPlan);
      if (!publicPlan.eligible) rejectedById.set(plan.plan_id, publicPlan);
    } catch {
      rejectedById.set(
        plan.plan_id,
        planRejection(plan, ["engine_evaluation_failed"]),
      );
    }
  }

  let engineRecommendation: JsonRecord = {};
  let aggregateEvaluationFailed = false;
  if (acceptedPlans.length > 0) {
    try {
      engineRecommendation = record(evaluateCandidates(acceptedPlans, context));
    } catch {
      aggregateEvaluationFailed = true;
      for (const plan of acceptedPlans) {
        const evaluated = individual.get(plan.plan_id);
        if (evaluated?.eligible) individual.delete(plan.plan_id);
        if (!rejectedById.has(plan.plan_id))
          rejectedById.set(
            plan.plan_id,
            planRejection(plan, ["engine_evaluation_failed"]),
          );
      }
    }
  }
  const rankedIds = Array.isArray(engineRecommendation.plans)
    ? [
        ...new Set(
          engineRecommendation.plans
            .filter(isRecord)
            .map((plan) => plan.plan_id)
            .filter((planId): planId is string => typeof planId === "string"),
        ),
      ]
    : [...individual.values()]
        .filter((plan) => plan.eligible)
        .map((plan) => plan.plan_id);
  const eligible = rankedIds
    .map((id) => individual.get(id))
    .filter((plan): plan is RecommendationPlan => plan?.eligible === true);
  for (const plan of individual.values())
    if (!plan.eligible) rejectedById.set(plan.plan_id, plan);
  const eligibleIds = new Set(eligible.map((plan) => plan.plan_id));
  if (Array.isArray(engineRecommendation.plans) && !aggregateEvaluationFailed) {
    for (const plan of individual.values()) {
      if (plan.eligible && !eligibleIds.has(plan.plan_id)) {
        const candidate = candidateById.get(plan.plan_id);
        if (!candidate) continue;
        rejectedById.set(
          plan.plan_id,
          planRejection(candidate, ["engine_plan_not_ranked"]),
        );
      }
    }
  }
  for (const plan of candidatePlans) {
    if (!eligibleIds.has(plan.plan_id) && !rejectedById.has(plan.plan_id))
      rejectedById.set(
        plan.plan_id,
        planRejection(plan, ["candidate_not_accounted"]),
      );
  }
  const rejected = candidatePlans
    .map((plan) => rejectedById.get(plan.plan_id))
    .filter((plan): plan is RecommendationPlan => plan !== undefined);
  const byId = new Map(
    [...eligible, ...rejected].map((plan) => [plan.plan_id, plan]),
  );
  const proposedWinnerId =
    typeof engineRecommendation.definite_winner_plan_id === "string"
      ? engineRecommendation.definite_winner_plan_id
      : typeof engineRecommendation.winner === "object" &&
          isRecord(engineRecommendation.winner) &&
          typeof engineRecommendation.winner.plan_id === "string"
        ? engineRecommendation.winner.plan_id
        : (eligible[0]?.plan_id ?? null);
  const engineOutcome = engineRecommendation.outcome_mode;
  const outcome: RecommendationOutcome =
    engineOutcome === "conditional"
      ? "conditional"
      : eligible.length === 0
        ? "no_valid_plan"
        : "definite";
  const winnerId =
    outcome === "conditional" || !eligibleIds.has(proposedWinnerId ?? "")
      ? null
      : proposedWinnerId;
  const requestedSafeId =
    typeof engineRecommendation.safe_plan_id === "string"
      ? engineRecommendation.safe_plan_id
      : winnerId;
  const safeId = eligibleIds.has(requestedSafeId ?? "")
    ? requestedSafeId
    : null;
  const runnerValue = isRecord(engineRecommendation.runner_up)
    ? engineRecommendation.runner_up.plan_id
    : undefined;
  const fallbackRunnerId = eligible.find(
    (plan) => plan.plan_id !== winnerId,
  )?.plan_id;
  const requestedRunnerId =
    typeof runnerValue === "string" ? runnerValue : fallbackRunnerId;
  const runnerId = eligibleIds.has(requestedRunnerId ?? "")
    ? requestedRunnerId
    : null;
  const verificationStatus: VerificationStatus =
    request.mode === "experimental_real_data"
      ? "experimental_unverified"
      : "synthetic_only";
  const conditionalWinners = records(engineRecommendation.conditional_winners)
    .filter(
      (candidate) =>
        typeof candidate.plan_id === "string" &&
        eligibleIds.has(candidate.plan_id),
    )
    .sort((left, right) =>
      String(left.plan_id).localeCompare(String(right.plan_id)),
    );
  const payload: Omit<RecommendationResponse, "replay"> = {
    version: RECOMMENDATION_API_VERSION,
    request_id: request.request_id,
    mode: request.mode,
    verification_status: verificationStatus,
    outcome,
    winner_plan_id: outcome === "conditional" ? null : winnerId,
    safe_plan_id: safeId,
    runner_up_plan_id: runnerId ?? null,
    winner: winnerId ? (byId.get(winnerId) ?? null) : null,
    safe_plan: safeId ? (byId.get(safeId) ?? null) : null,
    runner_up: runnerId ? (byId.get(runnerId) ?? null) : null,
    conditional_winners: conditionalWinners,
    eligible_plans: eligible,
    rejected_plans: rejected,
    plans: candidatePlans
      .map((plan) => byId.get(plan.plan_id))
      .filter((plan): plan is RecommendationPlan => plan !== undefined),
    merchant,
    comparison,
    assumptions: combinedAssumptions(request),
    questions: engineQuestions(engineRecommendation, request),
    freshness: freshness(request),
    evidence_refs: [...(request.evidence_refs ?? [])].sort((left, right) =>
      left.evidence_id.localeCompare(right.evidence_id),
    ),
    valuation_sensitivities: records(
      engineRecommendation.valuation_sensitivities,
    ),
    trust_assessments: [...trustAssessments],
    blockers: [],
  };
  return deepFreeze({
    ...payload,
    replay: {
      contract_version: RECOMMENDATION_API_VERSION,
      input_hash: inputHash,
      output_hash: hashRecommendationPayload(payload),
    },
  });
}

export const evaluateRecommendation = recommend;
export const evaluate = recommend;
export const recommendRewards = recommend;
export const evaluateRecommendationRequest = recommend;
export const runRecommendation = recommend;
export const createRecommendation = recommend;

/**
 * Hash only the public recommendation payload.  The replay envelope is
 * intentionally excluded so consumers can recompute `replay.output_hash`
 * from a serialized response without circularity or ambiguity.
 */
export function hashRecommendationPayload(
  value: Omit<RecommendationResponse, "replay"> | RecommendationResponse,
): string {
  const payload: Record<string, unknown> = { ...value };
  delete payload.replay;
  return hash(payload);
}

/** Verify the public output hash without trusting the replay envelope. */
export function verifyRecommendationHashes(
  value: RecommendationResponse,
): boolean {
  return (
    isRecord(value.replay) &&
    typeof value.replay.output_hash === "string" &&
    value.replay.output_hash === hashRecommendationPayload(value)
  );
}

export function serializeRecommendation(value: RecommendationResponse): string {
  return canonicalJson(jsonValue(value));
}

export function isRecommendationResponse(
  value: unknown,
): value is RecommendationResponse {
  return (
    isRecord(value) &&
    value.version === RECOMMENDATION_API_VERSION &&
    typeof value.request_id === "string"
  );
}
