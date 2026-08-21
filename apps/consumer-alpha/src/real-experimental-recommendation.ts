import { createHash } from "node:crypto";
import {
  getNanacoEconomicPilotRule,
  isActiveProvisionalRule,
  isCanonicalProvisionalDateTime,
  NANACO_PILOT_MERCHANT_ID,
} from "@jro/provisional-rules";
import {
  type RecommendationRequest,
  type RecommendationResponse,
  recommend,
} from "@jro/recommendation-api";
import {
  type AssetDefinition,
  type AssetLot,
  type AssetRef,
  type Operation,
  type PurchasePlan,
  type RewardRule,
  ruleIsExperimentalCandidate,
  type UserState,
} from "@jro/rule-engine";
import type {
  ExperimentalRecommendationInput,
  ExperimentalRecommendationPlan,
  ExperimentalRecommendationPort,
  ExperimentalRecommendationResult,
} from "./contracts.js";

export const NANACO_EXPERIMENTAL_PUBLICATION_ID =
  "candidate_p0_nanaco_shopping_earning_20260821_v0_1" as const;
export const NANACO_EXPERIMENTAL_BRANCH_ID =
  "location.seveneleven.representative" as const;
export const NANACO_EXPERIMENTAL_INSTRUMENT_ID =
  "instrument.jp.nanaco" as const;
export const NANACO_EXPERIMENTAL_FUNDING_SOURCE_ID =
  "funding.jp.nanaco" as const;
export const NANACO_EXPERIMENTAL_ASSET_ID = "asset.jp.nanaco" as const;
export const NANACO_EXPERIMENTAL_POINT_ASSET_ID =
  "asset.jp.nanaco-point" as const;
export const NANACO_EXPERIMENTAL_ACCEPTANCE_PUBLICATION_ID =
  "candidate_p0_seveneleven_nanaco_20260821_v0_1" as const;
export const NANACO_EXPERIMENTAL_ACCEPTANCE_RULE_ID =
  "rr_p0_seveneleven_accept_nanaco" as const;
export const REAL_EXPERIMENTAL_RECOMMENDATION_VERSION =
  "real-experimental-recommendation.v1" as const;

/**
 * A host-owned source proves the two current routes needed by this narrow
 * experiment.  The rule body is returned separately so the host can bind a
 * sealed definition to the current database route without exposing database
 * metadata to the browser.
 */
export interface NanacoExperimentalAvailability {
  readonly reward_candidate_id: string;
  readonly reward_rule: RewardRule;
  readonly acceptance_candidate_id: string;
  readonly acceptance_rule_id: string;
}

export interface NanacoExperimentalRuleSource {
  current(effectiveAt: string): Promise<NanacoExperimentalAvailability>;
}

export class ExperimentalRecommendationError extends Error {
  readonly code:
    | "selection_not_supported"
    | "amount_invalid"
    | "tax_exclusive_amount_invalid"
    | "balance_invalid"
    | "effective_at_invalid"
    | "rule_not_current"
    | "source_unavailable"
    | "recommendation_unavailable";

  constructor(code: ExperimentalRecommendationError["code"], message = code) {
    super(message);
    this.name = "ExperimentalRecommendationError";
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertSafeInput(value: ExperimentalRecommendationInput): void {
  if (!isRecord(value))
    throw new ExperimentalRecommendationError("recommendation_unavailable");
  if (
    value.selection_id !== NANACO_EXPERIMENTAL_PUBLICATION_ID &&
    value.selection_id !== "nanaco"
  )
    throw new ExperimentalRecommendationError("selection_not_supported");
  if (!Number.isSafeInteger(value.amount_jpy) || value.amount_jpy <= 0)
    throw new ExperimentalRecommendationError("amount_invalid");
  if (
    !Number.isSafeInteger(value.tax_exclusive_amount_jpy) ||
    value.tax_exclusive_amount_jpy < 0 ||
    value.tax_exclusive_amount_jpy > value.amount_jpy
  )
    throw new ExperimentalRecommendationError("tax_exclusive_amount_invalid");
  if (
    !Number.isSafeInteger(value.nanaco_balance_jpy) ||
    value.nanaco_balance_jpy < value.amount_jpy
  )
    throw new ExperimentalRecommendationError("balance_invalid");
  if (!isCanonicalProvisionalDateTime(value.effective_at))
    throw new ExperimentalRecommendationError("effective_at_invalid");
}

function assertCurrentAvailability(
  availability: NanacoExperimentalAvailability,
  effectiveAt: string,
): NanacoExperimentalAvailability {
  if (
    !isRecord(availability) ||
    availability.reward_candidate_id !== NANACO_EXPERIMENTAL_PUBLICATION_ID ||
    availability.acceptance_candidate_id !==
      NANACO_EXPERIMENTAL_ACCEPTANCE_PUBLICATION_ID ||
    availability.acceptance_rule_id !== NANACO_EXPERIMENTAL_ACCEPTANCE_RULE_ID
  )
    throw new ExperimentalRecommendationError("source_unavailable");
  const rewardRule = availability.reward_rule;
  if (
    !isRecord(rewardRule) ||
    rewardRule.rule_id !== "rr_jp_cvs_006_nanaco_purchase_reward" ||
    !ruleIsExperimentalCandidate(rewardRule) ||
    !isActiveProvisionalRule(rewardRule, effectiveAt)
  )
    throw new ExperimentalRecommendationError("rule_not_current");
  return Object.freeze({
    reward_candidate_id: availability.reward_candidate_id,
    reward_rule: structuredClone(rewardRule),
    acceptance_candidate_id: availability.acceptance_candidate_id,
    acceptance_rule_id: availability.acceptance_rule_id,
  });
}

function nanacoAsset(): AssetRef {
  return {
    asset_id: NANACO_EXPERIMENTAL_ASSET_ID,
    asset_kind: "stored_value",
    program_id: "program.jp.nanaco",
    reward_class: null,
    scale: 0,
  };
}

function restrictions(
  payment: boolean,
): AssetDefinition["default_usage_restrictions"] {
  return {
    transferable: null,
    redeemable_for_cash: null,
    usable_for_payment: payment,
    investable: null,
    permitted_destination_ids: payment ? [] : [NANACO_EXPERIMENTAL_ASSET_ID],
    notes: payment
      ? "Experimental Nanaco principal balance used as the tender asset."
      : "Experimental Nanaco points remain separate from principal.",
  };
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
      asset_id: NANACO_EXPERIMENTAL_ASSET_ID,
      asset_kind: "stored_value" as const,
      display_name: "nanaco電子マネー",
      program_id: "program.jp.nanaco",
      scale: 0,
      default_reward_class: null,
      default_expiry: noExpiry,
      default_usage_restrictions: restrictions(true),
      status: "active" as const,
      notes: "Sealed experimental Nanaco route asset.",
    },
    {
      asset_id: NANACO_EXPERIMENTAL_POINT_ASSET_ID,
      asset_kind: "reward_point" as const,
      display_name: "nanacoポイント",
      program_id: "program.jp.nanaco",
      scale: 0,
      default_reward_class: "normal" as const,
      default_expiry: noExpiry,
      default_usage_restrictions: restrictions(false),
      status: "active" as const,
      notes: "Sealed experimental Nanaco reward asset.",
    },
  ]);
}

function openingLot(input: ExperimentalRecommendationInput): AssetLot {
  return {
    lot_id: "lot_experimental_nanaco_balance",
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
  };
}

function purchaseOperation(input: ExperimentalRecommendationInput): Operation {
  return {
    operation_id: "op_experimental_nanaco_purchase",
    sequence: 1,
    occurred_at: input.effective_at,
    operation_type: "merchant_purchase",
    merchant_id: NANACO_PILOT_MERCHANT_ID,
    merchant_location_id: NANACO_EXPERIMENTAL_BRANCH_ID,
    channel: "in_store",
    interface: "not_applicable",
    payment_instrument_id: NANACO_EXPERIMENTAL_INSTRUMENT_ID,
    funding_source_id: NANACO_EXPERIMENTAL_FUNDING_SOURCE_ID,
    amount_jpy: input.amount_jpy,
    asset_inputs: [
      {
        input_id: "in_experimental_nanaco_tender",
        source_lot_id: "lot_experimental_nanaco_balance",
        quantity: { asset: nanacoAsset(), amount: String(input.amount_jpy) },
        role: "stored_value_tender",
      },
    ],
    output_requests: [],
    original_operation_id: null,
    portal_id: null,
    line_items: [
      {
        line_item_id: "line_experimental_nanaco_ordinary",
        product_class: "ordinary",
        amount_jpy: input.amount_jpy,
        tax_exclusive_amount_jpy: input.tax_exclusive_amount_jpy,
        quantity: 1,
        eligible_for_rewards: true,
      },
    ],
    notes:
      "The caller supplied gross and tax-exclusive amounts independently; no tax conversion is inferred.",
  };
}

function plan(input: ExperimentalRecommendationInput): PurchasePlan {
  return {
    plan_id: "plan_experimental_nanaco_direct_purchase",
    operations: [purchaseOperation(input)],
    dependencies: [],
    loyalty_presentments: [
      {
        operation_id: "op_experimental_nanaco_purchase",
        loyalty_program_id: "program.jp.nanaco",
        interface: "not_applicable",
        presentation_mode: "manual",
        sequence: 1,
      },
    ],
    assumptions: [
      "The caller supplied the gross and tax-exclusive eligible purchase amounts explicitly.",
      "The caller supplied an available Nanaco balance at least equal to the gross purchase amount.",
      "This is an experimental route; production publication and canonical recommendation remain blocked.",
    ],
  };
}

function userState(input: ExperimentalRecommendationInput): UserState {
  return {
    owned_instrument_ids: [NANACO_EXPERIMENTAL_INSTRUMENT_ID],
    owned_loyalty_program_ids: ["program.jp.nanaco"],
    facts: {},
    asset_lots: [openingLot(input)],
    // An empty profile is intentional.  The experimental engine policy also
    // rejects its implicit one-JPY fallback; native points remain unvalued.
    valuation_profile: {
      version: "experimental-nanaco-unvalued-v1",
      entries: [],
    },
    cap_progress: {},
  };
}

function merchantCatalog() {
  return {
    version: "experimental-seveneleven-catalog-v1",
    merchants: [
      {
        merchant_id: NANACO_PILOT_MERCHANT_ID,
        name: "セブン‐イレブン",
        aliases: ["Seven-Eleven"],
        branches: [
          {
            branch_id: NANACO_EXPERIMENTAL_BRANCH_ID,
            name: "代表店舗",
            aliases: [],
          },
        ],
      },
    ],
  } as const;
}

export function buildNanacoExperimentalRecommendationRequest(
  input: ExperimentalRecommendationInput,
  availability: NanacoExperimentalAvailability,
): RecommendationRequest {
  assertSafeInput(input);
  const current = assertCurrentAvailability(availability, input.effective_at);
  const currentPlan = plan(input);
  const state = userState(input);
  return {
    version: "1",
    request_id: "experimental_nanaco_seveneleven",
    mode: "experimental_real_data",
    experimental_rule_admission: "unverified_host",
    experimental_value_policy: "unvalued",
    transaction_time: input.effective_at,
    replay_knowledge_at: input.effective_at,
    timezone: "Asia/Tokyo",
    source_maintenance_status: { status: "insufficient_data" },
    merchant_query: {
      merchant_id: NANACO_PILOT_MERCHANT_ID,
      branch_id: NANACO_EXPERIMENTAL_BRANCH_ID,
    },
    merchant_catalog: merchantCatalog(),
    comparison: {
      merchant_id: NANACO_PILOT_MERCHANT_ID,
      merchant_location_id: NANACO_EXPERIMENTAL_BRANCH_ID,
      amount_jpy: input.amount_jpy,
      channel: "in_store",
      interface: "not_applicable",
      line_items: currentPlan.operations[0]?.line_items ?? [],
    },
    candidate_plans: [currentPlan],
    rules: [current.reward_rule],
    assets: assets(),
    user_state: state,
    opening_asset_lots: state.asset_lots,
    valuation_profile: [],
    objective: {
      primary: "maximize_guaranteed_net_value",
      probabilistic_reward_policy: "guaranteed_only",
      ending_asset_valuation: "exclude",
      tie_breakers: ["lower_external_funding", "fewer_operations"],
    },
    assumptions: [
      "This route executes only the exact host-bound Nanaco purchase-reward candidate.",
      "Seven-Eleven Nanaco payment acceptance was proven current by the host source.",
      "Native Nanaco points are shown without a JPY valuation.",
    ],
    freshness: {
      checked_at: input.effective_at,
      notes: ["Experimental host-bound candidate; not canonical publication."],
    },
  };
}

function rewardPoints(planResult: Record<string, unknown>): string {
  const rewards = Array.isArray(planResult.reward_components)
    ? planResult.reward_components
    : [];
  let total = 0n;
  for (const reward of rewards) {
    if (!isRecord(reward)) continue;
    const quantity = reward.quantity;
    if (!isRecord(quantity) || !isRecord(quantity.asset)) continue;
    if (quantity.asset.asset_id !== NANACO_EXPERIMENTAL_POINT_ASSET_ID)
      continue;
    const amount = quantity.amount;
    if (typeof amount !== "string" || !/^\d+$/u.test(amount)) continue;
    total += BigInt(amount);
  }
  return total.toString();
}

function planSummary(
  value: RecommendationResponse["plans"][number],
): ExperimentalRecommendationPlan {
  const input = value as unknown as Record<string, unknown>;
  return Object.freeze({
    plan_id: value.plan_id,
    eligible: value.eligible,
    reward_points: rewardPoints(input),
    // No point or stored-value JPY valuation is present in this lane.
    objective_score_jpy: null,
    operation_count: value.operations.length,
    conditions: Object.freeze(
      value.rejection_reasons.map((reason) => reason.code),
    ),
  });
}

function resultFromEngine(
  input: ExperimentalRecommendationInput,
  response: RecommendationResponse,
): ExperimentalRecommendationResult {
  const plans = Object.freeze(response.plans.map(planSummary));
  const winner = response.winner ? planSummary(response.winner) : null;
  const outcome =
    response.outcome === "definite" ? "definite" : "no_valid_plan";
  return Object.freeze({
    version: REAL_EXPERIMENTAL_RECOMMENDATION_VERSION,
    request_id: "experimental_nanaco_seveneleven",
    mode: "experimental_real_data",
    verification_status: "experimental_unverified",
    outcome,
    selection_id: input.selection_id,
    payment_method: "nanaco",
    merchant_id: NANACO_PILOT_MERCHANT_ID,
    branch_id: NANACO_EXPERIMENTAL_BRANCH_ID,
    amount_jpy: input.amount_jpy,
    tax_exclusive_amount_jpy: input.tax_exclusive_amount_jpy,
    effective_at: input.effective_at,
    winner_plan_id: winner?.plan_id ?? null,
    winner,
    plans,
    assumptions: Object.freeze([
      "対象はセブン‐イレブンでのnanaco利用に限定した先行実験です。",
      "入力された総額と税抜対象額をそのまま扱います。税額変換は推測しません。",
      "本結果は本番のおすすめではなく、nanaco実験ルートの確認用です。",
    ]),
    blockers: Object.freeze(
      response.blockers.length > 0
        ? ["production_authorization_unavailable"]
        : [],
    ),
  });
}

export async function evaluateNanacoExperimentalRecommendation(
  input: ExperimentalRecommendationInput,
  source: NanacoExperimentalRuleSource,
): Promise<ExperimentalRecommendationResult> {
  assertSafeInput(input);
  try {
    const availability = await source.current(input.effective_at);
    const request = buildNanacoExperimentalRecommendationRequest(
      input,
      availability,
    );
    return resultFromEngine(input, recommend(request));
  } catch (error) {
    if (error instanceof ExperimentalRecommendationError) throw error;
    throw new ExperimentalRecommendationError("recommendation_unavailable");
  }
}

/** Host-only port; the browser receives only the reduced result above. */
export function createNanacoExperimentalRecommendationPort(
  source: NanacoExperimentalRuleSource,
): ExperimentalRecommendationPort {
  return Object.freeze({
    async evaluate(input: ExperimentalRecommendationInput) {
      return evaluateNanacoExperimentalRecommendation(input, source);
    },
  });
}

/** Explicit unavailable port used when the host has not configured a source. */
export function createUnavailableNanacoExperimentalRecommendationPort(): ExperimentalRecommendationPort {
  return Object.freeze({
    async evaluate(_input: ExperimentalRecommendationInput) {
      throw new ExperimentalRecommendationError("source_unavailable");
    },
  });
}

export function deterministicExperimentalRequestKey(
  input: ExperimentalRecommendationInput,
): string {
  assertSafeInput(input);
  const canonical = JSON.stringify({
    selection_id: input.selection_id,
    amount_jpy: input.amount_jpy,
    tax_exclusive_amount_jpy: input.tax_exclusive_amount_jpy,
    nanaco_balance_jpy: input.nanaco_balance_jpy,
    effective_at: input.effective_at,
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export const buildRealExperimentalRecommendationRequest =
  buildNanacoExperimentalRecommendationRequest;
export const evaluateRealExperimentalRecommendation =
  evaluateNanacoExperimentalRecommendation;
export const createRealExperimentalRecommendationPort =
  createNanacoExperimentalRecommendationPort;

// Keep the trusted artifact accessor in one place so a route source can bind
// its current DB proof to the exact checked-in candidate without changing it.
export function sealedNanacoExperimentalRule(): RewardRule {
  return getNanacoEconomicPilotRule();
}
