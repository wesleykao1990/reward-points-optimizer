import type {
  P0ChargeExclusion,
  P0PaymentLayerOption,
  P0PaymentLayerSet,
} from "@jro/provisional-rules";
import {
  type PaymentLayerOption,
  type PaymentStackPlan,
  synthesizePaymentStacks,
  type ValuationProfile,
} from "@jro/rule-engine";

import {
  loadPointSpendBundle,
  p0ProductFamilyDefinition,
  pointValuationProfile,
} from "./point-spend-recommendation.js";

/**
 * Browser surface for "how should I pay for this".
 *
 * The answer is usually a stack rather than one instrument, so the response is
 * shaped around the stack: each channel, what it contributes, and the combined
 * rate.  Anything the buyer does not hold is excluded before ranking, because
 * a plan they cannot execute is not advice.
 */

export const MAX_PAYMENT_STACK_BODY_BYTES = 4_096;

export type PaymentStackLayerKind =
  | "funding"
  | "charge"
  | "payment"
  | "loyalty"
  | "bonus";

export interface PaymentStackBrowserInput {
  readonly merchant_id: string;
  readonly amount_jpy: number;
  /** Product families the buyer holds.  Empty means "consider everything". */
  readonly owned_family_ids: readonly string[];
  readonly effective_at: string;
  readonly confirmed_option_ids: readonly string[];
}

export interface PaymentStackBrowserLayer {
  readonly layer: PaymentStackLayerKind;
  readonly label: string;
  readonly action: string;
  readonly reward_label: string;
  readonly reward_points: string;
  readonly rate_percent: string | null;
  readonly cap_note: string | null;
}

export interface PaymentStackBrowserPlan {
  readonly recommendation_id: string;
  readonly total_value_jpy: string | null;
  readonly total_rate_percent: string | null;
  /** Native total, shown when the channels cannot be priced in yen. */
  readonly native_reward_points: string | null;
  readonly native_reward_label: string | null;
  readonly channel_count: number;
  readonly layers: readonly PaymentStackBrowserLayer[];
  readonly conditions: readonly string[];
}

export interface PaymentStackBrowserWarning {
  readonly label: string;
  readonly note: string;
}

export interface PaymentStackBrowserResult {
  readonly version: "p0-payment-stack-browser.v1";
  readonly status: "ready" | "no_plan";
  readonly experimental: true;
  readonly current_advice: false;
  readonly amount_jpy: number;
  readonly winner: PaymentStackBrowserPlan | null;
  readonly alternatives: readonly PaymentStackBrowserPlan[];
  readonly message: string;
  /** Issuer statements that charging a wallet with a held card earns nothing. */
  readonly charge_warnings: readonly PaymentStackBrowserWarning[];
  readonly option_count: number;
  /** Merchants whose presentment programme this result could have used. */
  readonly merchants: readonly PaymentStackMerchant[];
}

type JsonRecord = Record<string, unknown>;

const REQUEST_KEYS = Object.freeze([
  "merchant_id",
  "amount_jpy",
  "owned_family_ids",
  "effective_at",
  "confirmed_option_ids",
] as const);

const FAMILY_ID_PATTERN = /^[a-z]+\.[a-z0-9-]{1,40}$/u;
const OPTION_ID_PATTERN = /^p0\.pay\.[a-z]+\.[a-z0-9.-]{2,60}$/u;

function parseRecord(value: unknown): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("payment_stack_request_invalid");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Object.keys(descriptors).sort();
  const expected = [...REQUEST_KEYS].sort();
  if (
    keys.length !== expected.length ||
    keys.some((key, index) => key !== expected[index]) ||
    Object.getOwnPropertySymbols(value).length > 0
  )
    throw new TypeError("payment_stack_request_invalid");
  const output = Object.create(null) as JsonRecord;
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (
      !descriptor ||
      descriptor.enumerable !== true ||
      !("value" in descriptor)
    )
      throw new TypeError("payment_stack_request_invalid");
    output[key] = descriptor.value;
  }
  return output;
}

function canonicalDateTime(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/u.test(
      value,
    ) &&
    Number.isFinite(Date.parse(value))
  );
}

export function parsePaymentStackBrowserInput(
  value: unknown,
): PaymentStackBrowserInput {
  const record = parseRecord(value);
  const merchant = record.merchant_id;
  const amount = record.amount_jpy;
  const owned = record.owned_family_ids;
  const effectiveAt = record.effective_at;
  const confirmed = record.confirmed_option_ids;
  if (
    typeof merchant !== "string" ||
    !/^[a-z0-9][a-z0-9._-]{1,119}$/u.test(merchant) ||
    !Number.isSafeInteger(amount) ||
    Number(amount) < 1 ||
    Number(amount) > 10_000_000 ||
    !Array.isArray(owned) ||
    owned.length > 32 ||
    !owned.every(
      (item) => typeof item === "string" && FAMILY_ID_PATTERN.test(item),
    ) ||
    !canonicalDateTime(effectiveAt) ||
    !Array.isArray(confirmed) ||
    confirmed.length > 32 ||
    !confirmed.every(
      (item) => typeof item === "string" && OPTION_ID_PATTERN.test(item),
    )
  )
    throw new TypeError("payment_stack_request_invalid");
  return {
    merchant_id: merchant,
    amount_jpy: Number(amount),
    owned_family_ids: Object.freeze([...new Set(owned)].sort()),
    effective_at: effectiveAt,
    confirmed_option_ids: Object.freeze([...new Set(confirmed)].sort()),
  };
}

/**
 * Merchant programmes are not wallet families, so they carry their own labels.
 * A presentment option is displayed by the shop that publishes it.
 */
const MERCHANT_LABELS: Readonly<Record<string, string>> = Object.freeze({
  "merchant.aeon-group": "イオングループ対象店",
  "merchant.biccamera": "ビックカメラ",
  "merchant.newdays": "NewDays",
});

function familyLabel(familyId: string): string {
  return (
    p0ProductFamilyDefinition(familyId)?.label ??
    MERCHANT_LABELS[familyId] ??
    familyId
  );
}

export interface PaymentStackMerchant {
  readonly merchant_id: string;
  readonly label: string;
}

/** Merchants with a presentment programme the buyer can be asked about. */
export async function listPaymentStackMerchants(): Promise<{
  readonly version: "p0-payment-stack-merchants.v1";
  readonly merchants: readonly PaymentStackMerchant[];
}> {
  const { paymentLayers } = await loadPointSpendBundle();
  const merchants = new Map<string, PaymentStackMerchant>();
  for (const option of paymentLayers.options) {
    if (option.merchant_scope === null) continue;
    merchants.set(option.merchant_scope, {
      merchant_id: option.merchant_scope,
      label: familyLabel(option.family_id),
    });
  }
  return {
    version: "p0-payment-stack-merchants.v1",
    merchants: [...merchants.values()].sort((left, right) =>
      left.label.localeCompare(right.label, "ja"),
    ),
  };
}

/**
 * Say what the buyer physically does at each layer.
 *
 * The compiled option carries the issuer's own subject line, which is useful
 * for audit but not for a register queue, so the display action is built from
 * the layer and the product family instead.
 */
function layerAction(layer: PaymentStackLayerKind, familyId: string): string {
  const label = familyLabel(familyId);
  if (layer === "funding") return `${label}を用意する`;
  if (layer === "charge") return `${label}のチャージで貯める`;
  if (layer === "payment") return `${label}で支払う`;
  if (layer === "loyalty") return `${label}を提示する`;
  return `${label}の特典を適用する`;
}

function engineOption(option: P0PaymentLayerOption): PaymentLayerOption {
  return {
    option_id: option.option_id,
    layer: option.layer,
    label_ja: layerAction(option.layer, option.family_id),
    reward_asset: {
      asset_id: option.reward_asset.asset_id,
      asset_kind: option.reward_asset.asset_kind,
      program_id: option.reward_asset.program_id,
      reward_class: option.reward_asset.reward_class,
      scale: option.reward_asset.scale,
    },
    reward_units_per_basis: option.reward_units_per_basis,
    basis_unit_jpy: option.basis_unit_jpy,
    reward_rounding: "floor",
    cap_reward_units_per_period: option.cap_reward_units_per_period,
    // No stored per-period usage exists in this lane, so a capped channel is
    // priced from a full period rather than from an assumed partial one.
    cap_reward_units_used:
      option.cap_reward_units_per_period === null ? null : "0",
    requires_option_ids: option.requires_option_ids,
    conflicts_with_option_ids: [],
    // Scoped to the merchant that published the rate, not to the merchant
    // being asked about: a presentment rate belongs to one chain and must
    // never follow the buyer to another.
    merchant_ids: option.merchant_scope === null ? [] : [option.merchant_scope],
    stack_group: option.layer,
    stacking_mode: "additive",
    valid_from: null,
    valid_to: null,
    required_conditions_ja: option.required_conditions_ja,
    source_claim_ids: option.source_claim_ids,
  };
}

/**
 * Narrow to what the buyer can actually execute.
 *
 * A merchant's own presentment programme is not something the buyer holds —
 * it belongs to the shop — so it survives the wallet filter and is instead
 * confined by its merchant scope.
 */
function ownedOptions(
  layers: P0PaymentLayerSet,
  owned: readonly string[],
): readonly P0PaymentLayerOption[] {
  if (owned.length === 0) return layers.options;
  const held = new Set(owned);
  return layers.options.filter(
    (option) => held.has(option.family_id) || option.merchant_scope !== null,
  );
}

function chargeWarnings(
  exclusions: readonly P0ChargeExclusion[],
  owned: readonly string[],
): readonly PaymentStackBrowserWarning[] {
  const held = new Set(owned);
  return exclusions
    .filter((item) => held.size === 0 || held.has(item.family_id))
    .map((item) => ({
      label: familyLabel(item.family_id),
      note: "このカードは電子マネー・プリペイドへのチャージがポイント付与の対象外と案内されています。",
    }))
    .sort((left, right) => left.label.localeCompare(right.label, "ja"));
}

function rewardLabel(
  optionId: string,
  compiled: readonly P0PaymentLayerOption[],
): string {
  return (
    compiled.find((option) => option.option_id === optionId)?.reward_asset
      .label_ja ?? "ポイント"
  );
}

function browserPlan(
  plan: PaymentStackPlan,
  compiled: readonly P0PaymentLayerOption[],
): PaymentStackBrowserPlan {
  return {
    recommendation_id: plan.plan_id,
    total_value_jpy: plan.total_value_jpy,
    total_rate_percent: plan.total_rate_percent,
    native_reward_points: plan.native_reward_units,
    native_reward_label:
      plan.native_reward_asset_id === null
        ? null
        : (compiled.find(
            (option) =>
              option.reward_asset.asset_id === plan.native_reward_asset_id,
          )?.reward_asset.label_ja ?? null),
    channel_count: plan.channel_count,
    layers: plan.layers.map((layer) => {
      const source = compiled.find(
        (option) => option.option_id === layer.option_id,
      );
      return {
        layer: layer.layer,
        label: source ? familyLabel(source.family_id) : layer.label_ja,
        action: layer.label_ja,
        reward_label: rewardLabel(layer.option_id, compiled),
        reward_points: layer.reward_units,
        rate_percent: layer.rate_percent,
        cap_note: layer.cap_limited
          ? `上限のため${layer.uncapped_reward_units}から${layer.reward_units}に調整しています。`
          : null,
      };
    }),
    conditions: plan.required_conditions_ja,
  };
}

/**
 * Rank the ways to pay, best combined value first.
 *
 * Channels whose contribution cannot be priced are still shown inside a plan,
 * but such a plan carries no total: adding an unpriced reward to a priced one
 * would present a guess as a sum.
 */
export async function recommendPaymentStack(
  raw: unknown,
): Promise<PaymentStackBrowserResult> {
  const input = parsePaymentStackBrowserInput(raw);
  const { ruleSet, paymentLayers } = await loadPointSpendBundle();
  const compiled = ownedOptions(paymentLayers, input.owned_family_ids);
  const valuation: ValuationProfile = pointValuationProfile(
    ruleSet,
    paymentLayers,
    null,
    null,
  );
  const result = synthesizePaymentStacks({
    effective_at: input.effective_at,
    merchant_id: input.merchant_id,
    amount_jpy: input.amount_jpy,
    options: compiled.map(engineOption),
    confirmed_option_ids: input.confirmed_option_ids,
    max_bonus_options: 2,
    valuation,
  });
  const plans = result.plans
    .filter((plan) => plan.channel_count > 0)
    .slice(0, 3)
    .map((plan) => browserPlan(plan, compiled));
  return {
    version: "p0-payment-stack-browser.v1",
    status: plans.length > 0 ? "ready" : "no_plan",
    experimental: true,
    current_advice: false,
    amount_jpy: input.amount_jpy,
    winner: plans[0] ?? null,
    alternatives: plans.slice(1),
    message:
      plans.length > 0
        ? "収録した還元条件で組み合わせを比較した結果です。支払い前に提供元の条件を確認してください。"
        : "収録範囲では、この条件で計算できる支払い方法の組み合わせがありません。",
    charge_warnings: chargeWarnings(
      paymentLayers.charge_exclusions,
      input.owned_family_ids,
    ),
    option_count: compiled.length,
    merchants: (await listPaymentStackMerchants()).merchants,
  };
}
