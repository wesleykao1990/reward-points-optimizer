import type {
  ActiveRewardClaimRecord,
  ActiveRewardClaimStore,
} from "@jro/agent-feed-postgres";
import {
  compileRewardClaims,
  freezeP0CoverageIndex,
} from "@jro/provisional-rules";

import type {
  P0ProductFamilyId,
  UnifiedBranchId,
  UnifiedMerchantId,
} from "./contracts.js";
import {
  p0ProductFamilyDefinition,
  type SelectedProductPurchaseCalculation,
} from "./point-spend-recommendation.js";

export interface ActiveRewardCalculationInput {
  readonly selected_p0_products: readonly P0ProductFamilyId[];
  readonly merchant_id: UnifiedMerchantId;
  readonly branch_id: UnifiedBranchId;
  readonly amount_jpy: number;
  readonly tax_exclusive_amount_jpy: number;
  readonly effective_at: string;
}

export interface ActiveRewardCalculationPort {
  readonly calculate: (
    input: ActiveRewardCalculationInput,
  ) => Promise<readonly SelectedProductPurchaseCalculation[]>;
}

type RewardRule = ActiveRewardClaimRecord["candidate_payload"]["rule"];
type RewardCalculation = NonNullable<RewardRule["calculation"]>;

interface Decimal {
  readonly numerator: bigint;
  readonly scale: number;
}

interface EvaluatedCandidate {
  readonly record: ActiveRewardClaimRecord;
  readonly source_claim_id: string;
  readonly reward_scaled: bigint;
  readonly reward_scale: number;
  readonly rate_percent: string;
  readonly calculation_note: string;
}

const FAMILY_REWARD_LABELS: Readonly<Record<string, string>> = Object.freeze({
  "card.aeon": "WAON POINT",
  "card.aupay": "Pontaポイント",
  "card.d": "dポイント",
  "card.paypay": "PayPayポイント",
  "card.rakuten": "楽天ポイント",
  "card.smbc": "Vポイント",
  "card.view": "JRE POINT",
  "wallet.aeonpay": "WAON POINT",
  "wallet.aupay": "Pontaポイント",
  "wallet.dbarai": "dポイント",
  "wallet.famipay": "ファミペイボーナス",
  "wallet.paypay": "PayPayポイント",
  "wallet.rakutenpay": "楽天ポイント",
});

const ASSET_REWARD_LABELS: Readonly<Record<string, string>> = Object.freeze({
  "asset.jp.d-point": "dポイント",
  "asset.jp.jre-point": "JRE POINT",
  "asset.jp.nanaco-point": "nanacoポイント",
  "asset.jp.paypay-point": "PayPayポイント",
  "asset.jp.ponta-point": "Pontaポイント",
  "asset.jp.rakuten-point": "楽天ポイント",
  "asset.jp.v-point": "Vポイント",
  "asset.jp.waon-point": "WAON POINT",
});

const ONLINE_MERCHANTS = new Set<UnifiedMerchantId>([
  "merchant.amazon-jp",
  "merchant.rakuten-market",
  "merchant.yahoo-shopping",
]);

const pow10 = (scale: number): bigint => 10n ** BigInt(scale);

function parseDecimal(value: string): Decimal | null {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,9})?$/u.test(value)) return null;
  const [integer, fraction = ""] = value.split(".");
  const numerator = BigInt(`${integer}${fraction}`);
  if (numerator <= 0n) return null;
  return { numerator, scale: fraction.length };
}

function formatScaled(value: bigint, scale: number): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  if (scale === 0) return `${negative ? "-" : ""}${absolute}`;
  const padded = absolute.toString().padStart(scale + 1, "0");
  const integer = padded.slice(0, -scale);
  const fraction = padded.slice(-scale).replace(/0+$/u, "");
  return `${negative ? "-" : ""}${integer}${fraction ? `.${fraction}` : ""}`;
}

function roundRatio(
  numerator: bigint,
  denominator: bigint,
  mode: RewardCalculation["rounding"]["reward_rounding_mode"],
): bigint | null {
  if (denominator <= 0n || numerator < 0n) return null;
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  if (mode === "floor" || mode === "exact")
    return mode === "exact" && remainder !== 0n ? null : quotient;
  if (mode === "ceil") return remainder === 0n ? quotient : quotient + 1n;
  if (mode === "half_up")
    return remainder * 2n >= denominator ? quotient + 1n : quotient;
  return null;
}

function percentText(numerator: bigint, denominator: bigint): string {
  if (denominator <= 0n) return "0";
  const precision = 4;
  const scaled = (numerator * 100n * pow10(precision)) / denominator;
  return formatScaled(scaled, precision);
}

function requestChannel(
  merchantId: UnifiedMerchantId,
): "in_store" | "online" | null {
  if (merchantId === "merchant.synthetic") return null;
  return ONLINE_MERCHANTS.has(merchantId) ? "online" : "in_store";
}

function emptyCampaignConditions(
  value: RewardRule["eligibility"]["campaign_conditions"],
): boolean {
  return Object.values(value).every(
    (item) => item === undefined || item === null || item === false,
  );
}

function scopeApplies(
  rule: RewardRule,
  input: ActiveRewardCalculationInput,
): boolean {
  const scope = rule.scope;
  if (
    !scope.countries.includes("JP") ||
    !scope.operation_types.includes("merchant_purchase") ||
    scope.excluded_merchant_ids?.includes(input.merchant_id) ||
    scope.excluded_merchant_location_ids?.includes(input.branch_id)
  )
    return false;
  if (
    scope.merchant_ids?.length &&
    !scope.merchant_ids.includes(input.merchant_id)
  )
    return false;
  if (
    scope.merchant_location_ids?.length &&
    !scope.merchant_location_ids.includes(input.branch_id)
  )
    return false;
  // The request currently has no merchant-group or product-class identity.
  // A rule that depends on one is not silently broadened.
  if (
    scope.merchant_group_ids?.length ||
    scope.excluded_merchant_group_ids?.length ||
    scope.merchant_category_codes?.length ||
    scope.excluded_merchant_category_codes?.length ||
    scope.included_product_classes?.length ||
    scope.excluded_product_classes?.length
  )
    return false;
  const channel = requestChannel(input.merchant_id);
  return channel === null || scope.channels.includes(channel);
}

function eligibleAmount(
  rule: RewardRule,
  input: ActiveRewardCalculationInput,
): number | null {
  const conditions = rule.eligibility;
  if (
    conditions.user_conditions.length > 0 ||
    !emptyCampaignConditions(conditions.campaign_conditions) ||
    conditions.transaction_conditions.excluded_tender_components?.length
  )
    return null;
  const minimum = conditions.transaction_conditions.minimum_amount_jpy;
  const maximum = conditions.transaction_conditions.maximum_amount_jpy;
  if (
    (minimum !== undefined && minimum !== null && input.amount_jpy < minimum) ||
    (maximum !== undefined && maximum !== null && input.amount_jpy > maximum)
  )
    return null;
  const basis = conditions.transaction_conditions.eligible_amount_basis;
  if (
    basis !== undefined &&
    !["gross_paid", "operation_amount", "eligible_line_items"].includes(basis)
  )
    return null;
  if (rule.scope.tax_basis === "tax_inclusive") return input.amount_jpy;
  if (rule.scope.tax_basis === "tax_exclusive")
    return input.tax_exclusive_amount_jpy;
  return null;
}

function applyPerOperationCaps(
  reward: bigint,
  scale: number,
  amount: number,
  rule: RewardRule,
): bigint | null {
  let result = reward;
  for (const cap of rule.caps) {
    if (
      cap.cap_type !== "per_operation" ||
      cap.progress_source !== "not_required"
    )
      return null;
    if (
      cap.max_eligible_spend_jpy !== null &&
      amount > cap.max_eligible_spend_jpy
    )
      return null;
    if (cap.max_reward_units !== null) {
      const maximum = parseDecimal(cap.max_reward_units);
      if (!maximum || maximum.scale > scale) return null;
      const scaledMaximum = maximum.numerator * pow10(scale - maximum.scale);
      if (result > scaledMaximum) result = scaledMaximum;
    }
  }
  return result;
}

function evaluateRule(
  record: ActiveRewardClaimRecord,
  sourceClaimId: string,
  input: ActiveRewardCalculationInput,
): EvaluatedCandidate | null {
  const rule = record.candidate_payload.rule;
  if (
    !["base_reward", "card_benefit"].includes(rule.rule_type) ||
    !scopeApplies(rule, input) ||
    !rule.calculation ||
    !rule.output ||
    rule.output.sign !== "credit" ||
    rule.output.certainty.type !== "guaranteed" ||
    rule.stacking.requires_rule_ids.length > 0 ||
    rule.stacking.conflicts_with_rule_ids.length > 0
  )
    return null;
  const amount = eligibleAmount(rule, input);
  if (amount === null) return null;
  const calculation = rule.calculation;
  const rounding = calculation.rounding;
  if (rounding.aggregation_scope !== "per_operation") return null;
  const quantum = rounding.eligible_spend_quantum_jpy;
  if (
    quantum !== undefined &&
    quantum !== null &&
    (!Number.isSafeInteger(quantum) || quantum <= 0)
  )
    return null;
  const roundedAmount = quantum
    ? Math.floor(amount / quantum) * quantum
    : amount;
  const outputScale = rule.output.asset.scale;
  if (!Number.isSafeInteger(outputScale) || outputScale < 0 || outputScale > 9)
    return null;

  let reward: bigint | null = null;
  let rateNumerator = 0n;
  let rateDenominator = 1n;
  let note = "";
  if (calculation.model === "points_per_unit") {
    const units = parseDecimal(calculation.reward_units);
    if (
      !units ||
      !Number.isSafeInteger(calculation.spend_jpy) ||
      calculation.spend_jpy <= 0
    )
      return null;
    reward = roundRatio(
      BigInt(roundedAmount) * units.numerator * pow10(outputScale),
      BigInt(calculation.spend_jpy) * pow10(units.scale),
      rounding.reward_rounding_mode,
    );
    rateNumerator = units.numerator;
    rateDenominator = BigInt(calculation.spend_jpy) * pow10(units.scale);
    note = `${calculation.spend_jpy}円ごとに${calculation.reward_units}ポイントで計算`;
  } else if (calculation.model === "percentage") {
    if (
      !Number.isSafeInteger(calculation.rate_basis_points) ||
      calculation.rate_basis_points < 0
    )
      return null;
    reward = roundRatio(
      BigInt(roundedAmount) *
        BigInt(calculation.rate_basis_points) *
        pow10(outputScale),
      10_000n,
      rounding.reward_rounding_mode,
    );
    rateNumerator = BigInt(calculation.rate_basis_points);
    rateDenominator = 10_000n;
    note = `${percentText(rateNumerator, rateDenominator)}%で計算`;
  } else if (calculation.model === "fixed") {
    const units = parseDecimal(calculation.reward_units);
    if (!units || units.scale > outputScale) return null;
    reward = units.numerator * pow10(outputScale - units.scale);
    rateNumerator = units.numerator;
    rateDenominator = BigInt(Math.max(amount, 1)) * pow10(units.scale);
    note = `1回の支払いにつき${calculation.reward_units}ポイントで計算`;
  } else {
    return null;
  }
  if (reward === null) return null;
  reward = applyPerOperationCaps(reward, outputScale, amount, rule);
  if (reward === null) return null;
  return {
    record,
    source_claim_id: sourceClaimId,
    reward_scaled: reward,
    reward_scale: outputScale,
    rate_percent: percentText(rateNumerator, rateDenominator),
    calculation_note: note,
  };
}

function coverageFor(records: readonly ActiveRewardClaimRecord[]) {
  const entries = new Map<
    string,
    {
      family_id: string;
      source_role_id: string;
      known_source_ids: string[];
    }
  >();
  for (const record of records) {
    const key = `${record.p0_family_id}\u0000${record.source_role_id}`;
    const current = entries.get(key) ?? {
      family_id: record.p0_family_id,
      source_role_id: record.source_role_id,
      known_source_ids: [],
    };
    current.known_source_ids = [
      ...new Set([...current.known_source_ids, ...record.source_ids]),
    ].sort();
    entries.set(key, current);
  }
  return freezeP0CoverageIndex({
    version: "active-reward-calculation.v1",
    entries: [...entries.values()].sort(
      (left, right) =>
        left.family_id.localeCompare(right.family_id) ||
        left.source_role_id.localeCompare(right.source_role_id),
    ),
  });
}

function sourceClaimIdFor(
  record: ActiveRewardClaimRecord,
  coverage: ReturnType<typeof coverageFor>,
): string | null {
  const result = compileRewardClaims(record.observation, {
    binding: {
      p0_family_id: record.p0_family_id,
      source_role_id: record.source_role_id,
      source_ids: record.source_ids,
      p0_coverage_index: coverage,
    },
  });
  return (
    result.members.find(
      (member) => member.ok && member.candidate_hash === record.candidate_hash,
    )?.claim_id ?? null
  );
}

function compareCandidates(
  left: EvaluatedCandidate,
  right: EvaluatedCandidate,
): number {
  const scale = Math.max(left.reward_scale, right.reward_scale);
  const leftReward = left.reward_scaled * pow10(scale - left.reward_scale);
  const rightReward = right.reward_scaled * pow10(scale - right.reward_scale);
  if (leftReward !== rightReward) return leftReward > rightReward ? -1 : 1;
  const checked = right.record.checked_at.localeCompare(left.record.checked_at);
  return (
    checked ||
    left.record.candidate_hash.localeCompare(right.record.candidate_hash)
  );
}

function rewardLabel(record: ActiveRewardClaimRecord): string {
  const assetId = record.candidate_payload.rule.output?.asset.asset_id;
  return (
    (assetId ? ASSET_REWARD_LABELS[assetId] : undefined) ??
    FAMILY_REWARD_LABELS[record.p0_family_id] ??
    "ポイント"
  );
}

/**
 * Project machine-validated, active Agent Feed rules directly into purchase
 * arithmetic. There is intentionally no manual promotion or UI approval
 * between the active database state and this calculation port.
 */
export function createActiveRewardCalculationPort(
  store: ActiveRewardClaimStore,
): ActiveRewardCalculationPort {
  return Object.freeze({
    async calculate(input: ActiveRewardCalculationInput) {
      const records = await store.list(input.effective_at);
      const selected = new Set(input.selected_p0_products);
      const relevant = records.filter((record) => {
        const definition = p0ProductFamilyDefinition(record.p0_family_id);
        return (
          selected.has(record.p0_family_id as P0ProductFamilyId) &&
          definition !== null &&
          (definition.kind === "credit_card" ||
            definition.kind === "mobile_pay")
        );
      });
      if (relevant.length === 0) return Object.freeze([]);
      const coverage = coverageFor(relevant);
      const byFamily = new Map<string, EvaluatedCandidate[]>();
      for (const record of relevant) {
        try {
          const claimId = sourceClaimIdFor(record, coverage);
          if (!claimId) continue;
          const evaluated = evaluateRule(record, claimId, input);
          if (!evaluated) continue;
          byFamily.set(record.p0_family_id, [
            ...(byFamily.get(record.p0_family_id) ?? []),
            evaluated,
          ]);
        } catch {
          // One malformed or stale sibling must never suppress another active
          // family. The database adapter independently validates every row.
        }
      }
      const calculations: SelectedProductPurchaseCalculation[] = [];
      for (const [familyId, candidates] of byFamily) {
        const winner = [...candidates].sort(compareCandidates)[0];
        const definition = p0ProductFamilyDefinition(familyId);
        if (!winner || !definition) continue;
        calculations.push(
          Object.freeze({
            family_id: familyId as P0ProductFamilyId,
            label: definition.label,
            reward_label: rewardLabel(winner.record),
            reward_points: formatScaled(
              winner.reward_scaled,
              winner.reward_scale,
            ),
            rate_percent: winner.rate_percent,
            calculation_note: winner.calculation_note,
            source_claim_id: winner.source_claim_id,
            ...(winner.record.source_url
              ? { source_url: winner.record.source_url }
              : {}),
            checked_at: winner.record.checked_at,
            calculation_source: "agent_feed_structured",
          }),
        );
      }
      return Object.freeze(
        calculations.sort(
          (left, right) =>
            Number(right.reward_points) - Number(left.reward_points) ||
            left.label.localeCompare(right.label, "ja"),
        ),
      );
    },
  });
}
