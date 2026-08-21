import { createHash } from "node:crypto";
import {
  hashDefinition,
  isActiveProvisionalRule,
  isCanonicalProvisionalDateTime,
  NANACO_CREDIT_CHARGE_CANDIDATE_ARTIFACT_HASH,
  NANACO_CREDIT_CHARGE_CLAIM_IDS,
  NANACO_CREDIT_CHARGE_DEFINITION_HASH,
  NANACO_CREDIT_CHARGE_EVIDENCE_IDS,
  NANACO_CREDIT_CHARGE_FINDING_ID,
  NANACO_CREDIT_CHARGE_RULE_ID,
  NANACO_CREDIT_CHARGE_SOURCE_IDS,
  type Sha256,
  scanPublicValue,
} from "@jro/provisional-rules";
import {
  type AssetDefinition,
  type AssetLot,
  type AssetRef,
  evaluatePlan,
  type Operation,
  type PurchasePlan,
  type RewardRule,
  ruleIsExperimentalCandidate,
  type UserState,
} from "@jro/rule-engine";
import type {
  NanacoCreditChargeRecommendationInput,
  NanacoCreditChargeRecommendationPlan,
  NanacoCreditChargeRecommendationPort,
  NanacoCreditChargeRecommendationResult,
} from "./contracts.js";
import {
  EXPERIMENTAL_NANACO_CREDIT_CHARGE_PAYMENT_METHOD,
  EXPERIMENTAL_NANACO_CREDIT_CHARGE_SELECTION_ID,
} from "./contracts.js";

export const NANACO_CREDIT_CHARGE_PUBLICATION_ID =
  EXPERIMENTAL_NANACO_CREDIT_CHARGE_SELECTION_ID;
export const NANACO_CREDIT_CHARGE_INSTRUMENT_ID =
  "instrument.jp.seven-card-plus" as const;
export const NANACO_CREDIT_CHARGE_FUNDING_SOURCE_ID =
  "funding.jp.seven-card-plus" as const;
export const NANACO_CREDIT_CHARGE_FUNDING_ASSET_ID =
  "asset.jp.seven-card-plus-credit" as const;
export const NANACO_CREDIT_CHARGE_ASSET_ID = "asset.jp.nanaco" as const;
export const NANACO_CREDIT_CHARGE_POINT_ASSET_ID =
  "asset.jp.nanaco-point" as const;
export const NANACO_CREDIT_CHARGE_MINIMUM_JPY = 5_000 as const;
export const NANACO_CREDIT_CHARGE_INCREMENT_JPY = 1_000 as const;
export const NANACO_CREDIT_CHARGE_MAXIMUM_JPY = 30_000 as const;
export const NANACO_CREDIT_CHARGE_BALANCE_LIMIT_JPY = 50_000 as const;
export const NANACO_CREDIT_CHARGE_REWARD_QUANTUM_JPY = 200 as const;
export const NANACO_CREDIT_CHARGE_PLAN_ID =
  "plan_experimental_nanaco_credit_charge" as const;
export const NANACO_CREDIT_CHARGE_RECOMMENDATION_VERSION =
  "real-experimental-nanaco-credit-charge-recommendation.v1" as const;
export const NANACO_CREDIT_CHARGE_PUBLIC_ASSUMPTIONS = Object.freeze([
  "セブンカード・プラスの所有とnanacoクレジットチャージの事前登録を確認しました。",
  "標準カードのチャージ条件（5,000円以上、1,000円単位、1回30,000円まで、チャージ後残高50,000円まで）を適用します。",
  "チャージ元のクレジット資金、nanaco残高、nanacoポイントは別々に記録します。ポイントの円換算は行いません。",
  "本結果は先行実験（実データ・未検証）であり、本番のおすすめではありません。",
] as const);
export const NANACO_CREDIT_CHARGE_PUBLIC_BLOCKERS = Object.freeze([
  "production_authorization_unavailable",
] as const);

export interface NanacoCreditChargeAvailability {
  readonly route_id: string;
  readonly candidate_id: string;
  readonly candidate_hash: Sha256;
  readonly definition_hash: Sha256;
  readonly finding_id: typeof NANACO_CREDIT_CHARGE_FINDING_ID;
  readonly claim_ids: readonly string[];
  readonly evidence_ids: readonly string[];
  readonly source_ids: readonly string[];
  readonly reward_rule: RewardRule;
}

export interface NanacoCreditChargeRuleSource {
  current(effectiveAt: string): Promise<NanacoCreditChargeAvailability>;
}

export class NanacoCreditChargeRecommendationError extends Error {
  readonly code:
    | "selection_not_supported"
    | "charge_below_minimum"
    | "charge_not_increment"
    | "charge_above_maximum"
    | "balance_limit_exceeded"
    | "balance_invalid"
    | "ownership_required"
    | "preregistration_required"
    | "effective_at_invalid"
    | "source_unavailable"
    | "rule_not_current"
    | "recommendation_unavailable";

  constructor(
    code: NanacoCreditChargeRecommendationError["code"],
    message = code,
  ) {
    super(message);
    this.name = "NanacoCreditChargeRecommendationError";
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactArray(
  actual: readonly string[],
  expected: readonly string[],
): boolean {
  return (
    actual.length === expected.length &&
    actual.every((item, index) => item === expected[index])
  );
}

function assertSafeInput(input: NanacoCreditChargeRecommendationInput): void {
  if (!isRecord(input))
    throw new NanacoCreditChargeRecommendationError(
      "recommendation_unavailable",
    );
  if (
    input.selection_id !== NANACO_CREDIT_CHARGE_PUBLICATION_ID &&
    input.selection_id !== "nanaco-credit-charge"
  )
    throw new NanacoCreditChargeRecommendationError("selection_not_supported");
  if (!Number.isSafeInteger(input.charge_amount_jpy))
    throw new NanacoCreditChargeRecommendationError("charge_below_minimum");
  if (input.charge_amount_jpy < NANACO_CREDIT_CHARGE_MINIMUM_JPY)
    throw new NanacoCreditChargeRecommendationError("charge_below_minimum");
  if (input.charge_amount_jpy > NANACO_CREDIT_CHARGE_MAXIMUM_JPY)
    throw new NanacoCreditChargeRecommendationError("charge_above_maximum");
  if (
    (input.charge_amount_jpy - NANACO_CREDIT_CHARGE_MINIMUM_JPY) %
      NANACO_CREDIT_CHARGE_INCREMENT_JPY !==
    0
  )
    throw new NanacoCreditChargeRecommendationError("charge_not_increment");
  if (
    !Number.isSafeInteger(input.nanaco_balance_jpy) ||
    input.nanaco_balance_jpy < 0
  )
    throw new NanacoCreditChargeRecommendationError("balance_invalid");
  if (
    input.nanaco_balance_jpy + input.charge_amount_jpy >
    NANACO_CREDIT_CHARGE_BALANCE_LIMIT_JPY
  )
    throw new NanacoCreditChargeRecommendationError("balance_limit_exceeded");
  if (input.seven_card_plus_owned !== true)
    throw new NanacoCreditChargeRecommendationError("ownership_required");
  if (input.nanaco_credit_charge_preregistered !== true)
    throw new NanacoCreditChargeRecommendationError("preregistration_required");
  if (!isCanonicalProvisionalDateTime(input.effective_at))
    throw new NanacoCreditChargeRecommendationError("effective_at_invalid");
}

function assertCurrentAvailability(
  availability: NanacoCreditChargeAvailability,
  effectiveAt: string,
): NanacoCreditChargeAvailability {
  const scanned = scanPublicValue(availability);
  if (!scanned.valid || !isRecord(scanned.value))
    throw new NanacoCreditChargeRecommendationError("source_unavailable");
  const current = scanned.value as unknown as NanacoCreditChargeAvailability;
  if (
    current.route_id !== NANACO_CREDIT_CHARGE_PUBLICATION_ID ||
    current.candidate_id !== NANACO_CREDIT_CHARGE_PUBLICATION_ID ||
    current.finding_id !== NANACO_CREDIT_CHARGE_FINDING_ID ||
    current.candidate_hash !== NANACO_CREDIT_CHARGE_CANDIDATE_ARTIFACT_HASH ||
    current.definition_hash !== NANACO_CREDIT_CHARGE_DEFINITION_HASH ||
    !exactArray(current.claim_ids, NANACO_CREDIT_CHARGE_CLAIM_IDS) ||
    !exactArray(current.evidence_ids, NANACO_CREDIT_CHARGE_EVIDENCE_IDS) ||
    !exactArray(current.source_ids, NANACO_CREDIT_CHARGE_SOURCE_IDS)
  )
    throw new NanacoCreditChargeRecommendationError("source_unavailable");
  const rule = current.reward_rule;
  if (
    !isRecord(rule) ||
    hashDefinition(rule) !== NANACO_CREDIT_CHARGE_DEFINITION_HASH ||
    rule.rule_id !== NANACO_CREDIT_CHARGE_RULE_ID ||
    !ruleIsExperimentalCandidate(rule) ||
    !isActiveProvisionalRule(rule, effectiveAt) ||
    !exactArray(
      rule.provenance.evidence_ids,
      NANACO_CREDIT_CHARGE_EVIDENCE_IDS,
    ) ||
    rule.scope.operation_types.length !== 1 ||
    rule.scope.operation_types[0] !== "stored_value_top_up"
  )
    throw new NanacoCreditChargeRecommendationError("rule_not_current");
  return Object.freeze({
    ...current,
    reward_rule: structuredClone(rule),
  });
}

function nanacoAsset(): AssetRef {
  return {
    asset_id: NANACO_CREDIT_CHARGE_ASSET_ID,
    asset_kind: "stored_value",
    program_id: "program.jp.nanaco",
    reward_class: null,
    scale: 0,
  };
}

function restrictions(payment: boolean) {
  return {
    transferable: null,
    redeemable_for_cash: null,
    usable_for_payment: payment,
    investable: null,
    permitted_destination_ids: payment ? [] : [NANACO_CREDIT_CHARGE_ASSET_ID],
    notes: payment
      ? "nanaco principal is a stored-value balance and is conserved separately from points."
      : "nanaco points remain separate from nanaco principal and are not a second balance lot.",
  } as const;
}

function assets(): readonly AssetDefinition[] {
  const noExpiry: AssetDefinition["default_expiry"] = {
    policy: "unknown",
    expires_at: null,
    duration_days: null,
    timezone: "Asia/Tokyo",
  };
  return Object.freeze([
    {
      asset_id: NANACO_CREDIT_CHARGE_FUNDING_ASSET_ID,
      asset_kind: "credit_limit" as const,
      display_name: "Seven Card Plus external credit funding",
      program_id: "program.jp.seven-card-plus",
      scale: 0,
      default_reward_class: null,
      default_expiry: noExpiry,
      default_usage_restrictions: restrictions(false),
      status: "active" as const,
      notes: "External funding is not a reusable internal lot.",
    },
    {
      asset_id: NANACO_CREDIT_CHARGE_ASSET_ID,
      asset_kind: "stored_value" as const,
      display_name: "nanaco電子マネー",
      program_id: "program.jp.nanaco",
      scale: 0,
      default_reward_class: null,
      default_expiry: noExpiry,
      default_usage_restrictions: restrictions(true),
      status: "active" as const,
      notes:
        "Principal output created by the separate credit-charge operation.",
    },
    {
      asset_id: NANACO_CREDIT_CHARGE_POINT_ASSET_ID,
      asset_kind: "reward_point" as const,
      display_name: "nanacoポイント",
      program_id: "program.jp.nanaco",
      scale: 0,
      default_reward_class: "normal" as const,
      default_expiry: noExpiry,
      default_usage_restrictions: restrictions(false),
      status: "active" as const,
      notes: "Reward points are not merged into the stored-value principal.",
    },
  ]);
}

function openingLot(input: NanacoCreditChargeRecommendationInput): AssetLot[] {
  if (input.nanaco_balance_jpy === 0) return [];
  return [
    {
      lot_id: "lot_experimental_nanaco_credit_charge_opening_balance",
      quantity: {
        asset: nanacoAsset(),
        amount: String(input.nanaco_balance_jpy),
      },
      acquired_at: input.effective_at,
      source_operation_id: null,
      settlement: {
        status: "posted",
        expected_posting_from: null,
        expected_posting_to: null,
        posted_at: null,
      },
      expiry: {
        policy: "unknown",
        expires_at: null,
        duration_days: null,
        timezone: "Asia/Tokyo",
      },
      restrictions: restrictions(true),
      provenance_rule_ids: [],
    },
  ];
}

function topUpOperation(
  input: NanacoCreditChargeRecommendationInput,
): Operation {
  return {
    operation_id: "op_experimental_nanaco_credit_charge",
    sequence: 1,
    occurred_at: input.effective_at,
    operation_type: "stored_value_top_up",
    merchant_id: null,
    merchant_location_id: null,
    channel: "not_applicable",
    interface: "not_applicable",
    payment_instrument_id: NANACO_CREDIT_CHARGE_INSTRUMENT_ID,
    funding_source_id: NANACO_CREDIT_CHARGE_FUNDING_SOURCE_ID,
    amount_jpy: input.charge_amount_jpy,
    asset_inputs: [
      {
        input_id: "in_experimental_nanaco_credit_charge_funding",
        source_lot_id: null,
        quantity: {
          asset: {
            asset_id: NANACO_CREDIT_CHARGE_FUNDING_ASSET_ID,
            asset_kind: "credit_limit",
            program_id: "program.jp.seven-card-plus",
            reward_class: null,
            scale: 0,
          },
          amount: String(input.charge_amount_jpy),
        },
        role: "external_funding",
      },
    ],
    output_requests: [
      {
        request_id: "out_experimental_nanaco_credit_charge_principal",
        created_lot_id: "lot_experimental_nanaco_credit_charge_principal",
        asset: nanacoAsset(),
        requested_amount: String(input.charge_amount_jpy),
        role: "stored_value",
      },
    ],
    original_operation_id: null,
    portal_id: null,
    line_items: [],
    notes:
      "Seven Card Plus credit-funded nanaco top-up; stored-value principal is modeled separately from the reward points.",
  };
}

export function buildNanacoCreditChargePlan(
  input: NanacoCreditChargeRecommendationInput,
): PurchasePlan {
  assertSafeInput(input);
  return {
    plan_id: NANACO_CREDIT_CHARGE_PLAN_ID,
    operations: [topUpOperation(input)],
    dependencies: [],
    loyalty_presentments: [],
    assumptions: [
      "Seven Card Plus ownership and nanaco credit-charge preregistration were supplied explicitly.",
      "The charge uses the reviewed standard-card boundary: JPY 5,000 minimum, JPY 1,000 increments, JPY 30,000 per charge, and JPY 50,000 post-charge balance.",
      "The external credit funding and the one Nanaco principal output are conserved separately from nanaco points.",
      "This is an experimental real-data route; no canonical publication or JPY valuation is asserted.",
    ],
  };
}

function userState(
  input: NanacoCreditChargeRecommendationInput,
  lots: AssetLot[],
): UserState {
  return {
    owned_instrument_ids: [NANACO_CREDIT_CHARGE_INSTRUMENT_ID],
    owned_loyalty_program_ids: [],
    facts: {
      nanaco_credit_charge_preregistered: {
        status: "known",
        value: input.nanaco_credit_charge_preregistered,
        source: "user_input",
        observed_at: input.effective_at,
        confidence: "1",
      },
    },
    asset_lots: lots,
    valuation_profile: { version: "experimental-unvalued-v1", entries: [] },
    cap_progress: {},
  };
}

function rewardPoints(value: unknown): string {
  if (!isRecord(value) || !Array.isArray(value.reward_components)) return "0";
  let total = 0n;
  for (const component of value.reward_components) {
    if (!isRecord(component) || !isRecord(component.quantity)) continue;
    const quantity = component.quantity;
    if (!isRecord(quantity) || !isRecord(quantity.asset)) continue;
    if (quantity.asset.asset_id !== NANACO_CREDIT_CHARGE_POINT_ASSET_ID)
      continue;
    if (typeof quantity.amount !== "string" || !/^\d+$/u.test(quantity.amount))
      continue;
    total += BigInt(quantity.amount);
  }
  return total.toString();
}

function planSummary(
  value: Record<string, unknown>,
): NanacoCreditChargeRecommendationPlan {
  const reasons = Array.isArray(value.rejection_reasons)
    ? value.rejection_reasons
        .filter((reason): reason is Record<string, unknown> => isRecord(reason))
        .map((reason) => reason.code)
        .filter((code): code is string => typeof code === "string")
    : [];
  return Object.freeze({
    plan_id: typeof value.plan_id === "string" ? value.plan_id : "",
    eligible: value.eligible === true,
    reward_points: rewardPoints(value),
    objective_score_jpy: null,
    operation_count: Array.isArray(value.operations)
      ? value.operations.length
      : 0,
    conditions: Object.freeze(reasons),
  });
}

function resultFromEngine(
  input: NanacoCreditChargeRecommendationInput,
  evaluated: Record<string, unknown>,
): NanacoCreditChargeRecommendationResult {
  const plan = planSummary(evaluated);
  const eligible = plan.eligible;
  const plans = Object.freeze([plan]);
  return Object.freeze({
    version: NANACO_CREDIT_CHARGE_RECOMMENDATION_VERSION,
    request_id: `experimental_nanaco_credit_charge_${createHash("sha256")
      .update(
        JSON.stringify({
          selection_id: input.selection_id,
          charge_amount_jpy: input.charge_amount_jpy,
          nanaco_balance_jpy: input.nanaco_balance_jpy,
          effective_at: input.effective_at,
        }),
        "utf8",
      )
      .digest("hex")}`,
    mode: "experimental_real_data",
    verification_status: "experimental_unverified",
    outcome: eligible ? "definite" : "no_valid_plan",
    selection_id: input.selection_id,
    payment_method: EXPERIMENTAL_NANACO_CREDIT_CHARGE_PAYMENT_METHOD,
    destination: "nanaco",
    charge_amount_jpy: input.charge_amount_jpy,
    nanaco_balance_before_jpy: input.nanaco_balance_jpy,
    nanaco_balance_after_jpy:
      input.nanaco_balance_jpy + input.charge_amount_jpy,
    effective_at: input.effective_at,
    winner_plan_id: eligible ? plan.plan_id : null,
    winner: eligible ? plan : null,
    plans,
    assumptions: NANACO_CREDIT_CHARGE_PUBLIC_ASSUMPTIONS,
    blockers: Object.freeze(
      eligible ? NANACO_CREDIT_CHARGE_PUBLIC_BLOCKERS : reasonsFrom(evaluated),
    ),
  });
}

function reasonsFrom(value: Record<string, unknown>): readonly string[] {
  if (!Array.isArray(value.rejection_reasons)) return ["no_valid_plan"];
  const reasons = value.rejection_reasons
    .filter((reason): reason is Record<string, unknown> => isRecord(reason))
    .map((reason) => reason.code)
    .filter((code): code is string => typeof code === "string");
  return reasons.length > 0 ? Object.freeze(reasons) : ["no_valid_plan"];
}

export function buildNanacoCreditChargeRecommendationRequest(
  input: NanacoCreditChargeRecommendationInput,
  availability: NanacoCreditChargeAvailability,
): { readonly plan: PurchasePlan; readonly context: Record<string, unknown> } {
  assertSafeInput(input);
  const current = assertCurrentAvailability(availability, input.effective_at);
  const plan = buildNanacoCreditChargePlan(input);
  const lots = openingLot(input);
  const state = userState(input, lots);
  return {
    plan,
    context: {
      rules: [current.reward_rule],
      assets: assets(),
      user_state: state,
      opening_asset_lots: lots,
      valuation_profile: [],
      valuation_policy: "unvalued",
      rule_evaluation_policy: "experimental_unverified",
      ruleEvaluationPolicy: "experimental_unverified",
      transaction_time: input.effective_at,
      replay_knowledge_at: input.effective_at,
      objective: {
        primary: "maximize_guaranteed_net_value",
        probabilistic_reward_policy: "guaranteed_only",
        ending_asset_valuation: "exclude",
        tie_breakers: ["lower_external_funding", "fewer_operations"],
      },
    },
  };
}

export async function evaluateNanacoCreditChargeRecommendation(
  input: NanacoCreditChargeRecommendationInput,
  source: NanacoCreditChargeRuleSource,
): Promise<NanacoCreditChargeRecommendationResult> {
  assertSafeInput(input);
  try {
    const availability = await source.current(input.effective_at);
    const request = buildNanacoCreditChargeRecommendationRequest(
      input,
      availability,
    );
    const evaluated = evaluatePlan(
      request.plan,
      request.context as never,
    ) as unknown as Record<string, unknown>;
    return resultFromEngine(input, evaluated);
  } catch (error) {
    if (error instanceof NanacoCreditChargeRecommendationError) throw error;
    throw new NanacoCreditChargeRecommendationError(
      "recommendation_unavailable",
    );
  }
}

export function createNanacoCreditChargeRecommendationPort(
  source: NanacoCreditChargeRuleSource,
): NanacoCreditChargeRecommendationPort {
  return Object.freeze({
    async evaluate(input: NanacoCreditChargeRecommendationInput) {
      return evaluateNanacoCreditChargeRecommendation(input, source);
    },
  });
}

export function createUnavailableNanacoCreditChargeRecommendationPort(): NanacoCreditChargeRecommendationPort {
  return Object.freeze({
    async evaluate(_input: NanacoCreditChargeRecommendationInput) {
      throw new NanacoCreditChargeRecommendationError("source_unavailable");
    },
  });
}
