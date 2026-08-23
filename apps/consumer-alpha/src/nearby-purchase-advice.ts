import {
  createPostgresActiveRewardClaimStore,
  type QueryPool,
} from "@jro/agent-feed-postgres";
import { createActiveRewardCalculationPort } from "./active-reward-calculation.js";
import {
  P0_PRODUCT_FAMILY_IDS,
  representativeBranchId,
  type P0ProductFamilyId,
  type UnifiedMerchantId,
  UNIFIED_MERCHANT_IDS,
} from "./contracts.js";

const ALLOWED_FAMILIES = new Set<string>(P0_PRODUCT_FAMILY_IDS);
const ALLOWED_MERCHANTS = new Set<string>(UNIFIED_MERCHANT_IDS);

const PAYMENT_ACCEPTANCE_KEY_BY_FAMILY: Readonly<Record<string, string>> =
  Object.freeze({
    "wallet.aeonpay": "instrument.wallet.aeonpay",
    "wallet.aupay": "instrument.wallet.aupay",
    "wallet.dbarai": "instrument.wallet.dbarai",
    "wallet.famipay": "instrument.wallet.famipay",
    "wallet.paypay": "instrument.wallet.paypay",
    "wallet.rakutenpay": "instrument.wallet.rakutenpay",
    "card.aeon": "instrument.payment.credit_card_general",
    "card.aupay": "instrument.payment.credit_card_general",
    "card.d": "instrument.payment.credit_card_general",
    "card.paypay": "instrument.payment.credit_card_general",
    "card.rakuten": "instrument.payment.credit_card_general",
    "card.smbc": "instrument.payment.credit_card_general",
    "card.view": "instrument.payment.credit_card_general",
  });

const POINT_ACCEPTANCE_KEY_BY_FAMILY: Readonly<Record<string, string>> =
  Object.freeze({
    "point.d": "program.jp.dpoint",
    "point.jre": "program.jp.jrepoint",
    "point.ponta": "program.jp.ponta",
    "point.rakuten": "program.jp.rakutenpoint",
    "point.v": "program.jp.vpoint",
  });

const FAMILY_LABELS: Readonly<Record<string, string>> = Object.freeze({
  "point.d": "dポイント",
  "point.jre": "JRE POINT",
  "point.nanaco": "nanacoポイント",
  "point.paypay": "PayPayポイント",
  "point.ponta": "Ponta",
  "point.rakuten": "楽天ポイント",
  "point.v": "Vポイント",
  "point.waon": "WAON POINT",
  "wallet.aeonpay": "AEON Pay",
  "wallet.aupay": "au PAY",
  "wallet.dbarai": "d払い",
  "wallet.famipay": "FamiPay",
  "wallet.paypay": "PayPay",
  "wallet.rakutenpay": "楽天ペイ",
  "card.aeon": "イオンカード",
  "card.aupay": "au PAY カード",
  "card.d": "dカード",
  "card.paypay": "PayPayカード",
  "card.rakuten": "楽天カード",
  "card.smbc": "三井住友カード",
  "card.view": "ビューカード",
});

export interface NearbyPurchasePreferences {
  readonly walletFamilyIds: readonly P0ProductFamilyId[];
  readonly amountJpy: number | null;
}

export interface NearbyAdviceAcceptance {
  readonly instrument_key: string;
  readonly action: "pay" | "earn" | "redeem";
  readonly state: "yes" | "no" | "unknown" | "conflicting";
}

export interface NearbyAdviceLocation {
  readonly location_key: string;
  readonly merchant_key: string;
  readonly accepted: readonly NearbyAdviceAcceptance[];
}

interface PurchaseContextRow {
  readonly location_key: string;
  readonly rule_model: string;
  readonly chain_inherited_fact_count: number | string;
  readonly branch_specific_fact_count: number | string;
  readonly branch_exception_count: number | string;
  readonly branch_confirmation_count: number | string;
  readonly branch_only_count: number | string;
}

export interface NearbyPurchaseAdvice {
  readonly amount_jpy: number | null;
  readonly wallet_configured: boolean;
  readonly compatible_payment_family_ids: readonly P0ProductFamilyId[];
  readonly incompatible_payment_family_ids: readonly P0ProductFamilyId[];
  readonly compatible_point_family_ids: readonly P0ProductFamilyId[];
  readonly best_payment: Readonly<{
    readonly family_id: P0ProductFamilyId;
    readonly label: string;
    readonly reward_label: string;
    readonly reward_points: string;
    readonly rate_percent: string;
    readonly source_url?: string;
    readonly checked_at: string;
  }> | null;
  readonly point_card: Readonly<{
    readonly recommended_family_id: P0ProductFamilyId | null;
    readonly candidates: readonly Readonly<{
      readonly family_id: P0ProductFamilyId;
      readonly label: string;
    }>[];
    readonly decision_basis:
      | "only_owned_earn_program_accepted"
      | "multiple_owned_earn_programs_accepted"
      | "no_owned_earn_program_accepted"
      | "wallet_not_configured";
  }>;
  readonly rule_context: Readonly<{
    readonly rule_model: string;
    readonly chain_inherited_fact_count: number;
    readonly branch_specific_fact_count: number;
    readonly branch_exception_count: number;
    readonly branch_confirmation_count: number;
    readonly branch_only_count: number;
  }>;
}

function safeCount(value: number | string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function parseAmount(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > 1_000_000
  )
    throw new TypeError("nearby_amount_invalid");
  return value;
}

export function parseNearbyPurchasePreferences(
  record: Readonly<Record<string, unknown>>,
): NearbyPurchasePreferences {
  const rawFamilies = record.wallet_family_ids ?? [];
  if (!Array.isArray(rawFamilies) || rawFamilies.length > 32)
    throw new TypeError("nearby_wallet_invalid");
  const familyIds: P0ProductFamilyId[] = [];
  for (const raw of rawFamilies) {
    if (typeof raw !== "string" || !ALLOWED_FAMILIES.has(raw))
      throw new TypeError("nearby_wallet_invalid");
    if (!familyIds.includes(raw as P0ProductFamilyId))
      familyIds.push(raw as P0ProductFamilyId);
  }
  familyIds.sort();
  return Object.freeze({
    walletFamilyIds: Object.freeze(familyIds),
    amountJpy: parseAmount(record.amount_jpy),
  });
}

function paymentFamilies(preferences: NearbyPurchasePreferences) {
  return preferences.walletFamilyIds.filter(
    (familyId) => PAYMENT_ACCEPTANCE_KEY_BY_FAMILY[familyId] !== undefined,
  );
}

function pointFamilies(preferences: NearbyPurchasePreferences) {
  return preferences.walletFamilyIds.filter(
    (familyId) => POINT_ACCEPTANCE_KEY_BY_FAMILY[familyId] !== undefined,
  );
}

function acceptedKeys(
  location: NearbyAdviceLocation,
  action: NearbyAdviceAcceptance["action"],
): ReadonlySet<string> {
  return new Set(
    location.accepted
      .filter((item) => item.action === action && item.state === "yes")
      .map((item) => item.instrument_key),
  );
}

export function compatiblePaymentFamilies(
  preferences: NearbyPurchasePreferences,
  location: NearbyAdviceLocation,
): readonly P0ProductFamilyId[] {
  const accepted = acceptedKeys(location, "pay");
  return Object.freeze(
    paymentFamilies(preferences).filter((familyId) => {
      const acceptanceKey = PAYMENT_ACCEPTANCE_KEY_BY_FAMILY[familyId];
      return acceptanceKey !== undefined && accepted.has(acceptanceKey);
    }),
  );
}

export function compatiblePointFamilies(
  preferences: NearbyPurchasePreferences,
  location: NearbyAdviceLocation,
): readonly P0ProductFamilyId[] {
  const accepted = acceptedKeys(location, "earn");
  return Object.freeze(
    pointFamilies(preferences).filter((familyId) => {
      const acceptanceKey = POINT_ACCEPTANCE_KEY_BY_FAMILY[familyId];
      return acceptanceKey !== undefined && accepted.has(acceptanceKey);
    }),
  );
}

function numericReward(value: string): number {
  if (!/^\d{1,24}(?:\.\d{1,9})?$/u.test(value)) return -1;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : -1;
}

function pointCardAdvice(
  preferences: NearbyPurchasePreferences,
  compatible: readonly P0ProductFamilyId[],
): NearbyPurchaseAdvice["point_card"] {
  const candidates = Object.freeze(
    compatible.map((familyId) =>
      Object.freeze({
        family_id: familyId,
        label: FAMILY_LABELS[familyId] ?? familyId,
      }),
    ),
  );
  if (preferences.walletFamilyIds.length === 0)
    return Object.freeze({
      recommended_family_id: null,
      candidates,
      decision_basis: "wallet_not_configured" as const,
    });
  if (compatible.length === 1)
    return Object.freeze({
      recommended_family_id: compatible[0] ?? null,
      candidates,
      decision_basis: "only_owned_earn_program_accepted" as const,
    });
  if (compatible.length > 1)
    return Object.freeze({
      recommended_family_id: null,
      candidates,
      decision_basis: "multiple_owned_earn_programs_accepted" as const,
    });
  return Object.freeze({
    recommended_family_id: null,
    candidates,
    decision_basis: "no_owned_earn_program_accepted" as const,
  });
}

async function contextByLocation(
  target: QueryPool,
  locations: readonly NearbyAdviceLocation[],
): Promise<ReadonlyMap<string, PurchaseContextRow>> {
  if (locations.length === 0) return new Map();
  const result = await target.query<PurchaseContextRow>(
    `select location_key, rule_model, chain_inherited_fact_count,
            branch_specific_fact_count, branch_exception_count,
            branch_confirmation_count, branch_only_count
       from app_api.merchant_purchase_context
      where location_key = any($1::text[])`,
    [locations.map((location) => location.location_key)],
  );
  return new Map(result.rows.map((row) => [row.location_key, row]));
}

function emptyRuleContext(): NearbyPurchaseAdvice["rule_context"] {
  return Object.freeze({
    rule_model: "unknown",
    chain_inherited_fact_count: 0,
    branch_specific_fact_count: 0,
    branch_exception_count: 0,
    branch_confirmation_count: 0,
    branch_only_count: 0,
  });
}

function browserRuleContext(
  row: PurchaseContextRow | undefined,
): NearbyPurchaseAdvice["rule_context"] {
  if (!row) return emptyRuleContext();
  return Object.freeze({
    rule_model: row.rule_model,
    chain_inherited_fact_count: safeCount(row.chain_inherited_fact_count),
    branch_specific_fact_count: safeCount(row.branch_specific_fact_count),
    branch_exception_count: safeCount(row.branch_exception_count),
    branch_confirmation_count: safeCount(row.branch_confirmation_count),
    branch_only_count: safeCount(row.branch_only_count),
  });
}

export async function buildNearbyPurchaseAdvice(
  target: QueryPool,
  preferences: NearbyPurchasePreferences,
  locations: readonly NearbyAdviceLocation[],
): Promise<ReadonlyMap<string, NearbyPurchaseAdvice>> {
  const contexts = await contextByLocation(target, locations);
  const activeRewards = createActiveRewardCalculationPort(
    createPostgresActiveRewardClaimStore(target),
  );
  const advice = new Map<string, NearbyPurchaseAdvice>();

  for (const location of locations) {
    const compatiblePayments = compatiblePaymentFamilies(preferences, location);
    const compatiblePoints = compatiblePointFamilies(preferences, location);
    const allPayments = paymentFamilies(preferences);
    const incompatiblePayments = Object.freeze(
      allPayments.filter((familyId) => !compatiblePayments.includes(familyId)),
    );

    let bestPayment: NearbyPurchaseAdvice["best_payment"] = null;
    if (
      preferences.amountJpy !== null &&
      compatiblePayments.length > 0 &&
      ALLOWED_MERCHANTS.has(location.merchant_key)
    ) {
      try {
        const merchantId = location.merchant_key as UnifiedMerchantId;
        const calculations = await activeRewards.calculate({
          selected_p0_products: compatiblePayments,
          merchant_id: merchantId,
          branch_id: representativeBranchId(merchantId),
          amount_jpy: preferences.amountJpy,
          // Match the current consumer comparison fallback until tax-component
          // capture is added to the Nearby UI. The response is labelled as an
          // estimate, and exact branch acceptance is still enforced here.
          tax_exclusive_amount_jpy: preferences.amountJpy,
          effective_at: new Date().toISOString(),
        });
        const winner = [...calculations].sort(
          (left, right) =>
            numericReward(right.reward_points) - numericReward(left.reward_points),
        )[0];
        if (winner) {
          bestPayment = Object.freeze({
            family_id: winner.family_id,
            label: winner.label,
            reward_label: winner.reward_label,
            reward_points: winner.reward_points,
            rate_percent: winner.rate_percent,
            ...(winner.source_url ? { source_url: winner.source_url } : {}),
            checked_at: winner.checked_at,
          });
        }
      } catch {
        bestPayment = null;
      }
    }

    advice.set(
      location.location_key,
      Object.freeze({
        amount_jpy: preferences.amountJpy,
        wallet_configured: preferences.walletFamilyIds.length > 0,
        compatible_payment_family_ids: compatiblePayments,
        incompatible_payment_family_ids: incompatiblePayments,
        compatible_point_family_ids: compatiblePoints,
        best_payment: bestPayment,
        point_card: pointCardAdvice(preferences, compatiblePoints),
        rule_context: browserRuleContext(contexts.get(location.location_key)),
      }),
    );
  }

  return advice;
}
