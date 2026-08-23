import type { Decimal } from "decimal.js";

import {
  exactKeys,
  plainInput,
  type PlainRecord,
  validDate,
  validDateTime,
} from "./input-guard.js";
import { resolveStacking, type StackingCandidate } from "./m1b-stacking.js";
import { canonicalDecimal, canonicalHash, D, decimalString } from "./math.js";
import { type JpyValuation, type ValuationProfile, valueQuantity } from "./point-valuation.js";
import type { AssetRef } from "./types.js";

/**
 * Enumerate and rank the ways one purchase can be paid for.
 *
 * The best way to pay is rarely a single instrument.  Charging a wallet from a
 * credit card, paying with that wallet, and presenting a loyalty card earns on
 * three channels at once, and the combined rate is what decides the winner.
 * The engine could already *score* such a plan; nothing generated the
 * combinations, so the caller had to know the answer in order to ask the
 * question.
 *
 * This module owns that synthesis.  It enumerates layer combinations, drops
 * the ones the declared prerequisites and conflicts forbid, prices each
 * surviving combination through the existing stacking resolver, and ranks by
 * declared JPY value.
 *
 * Charge-layer eligibility is the volatile part of this domain: issuers
 * withdraw rewards for charging specific wallets, and the withdrawal is
 * issuer-and-wallet specific.  That is expressed as an ordinary validity
 * window on the charge option rather than as a special case here, so the
 * change is data, not code.
 */

export const PAYMENT_STACK_SYNTHESIZER_VERSION =
  "payment-stack-synthesizer.v1" as const;

export type PaymentLayer =
  /** The instrument the money ultimately comes from. */
  | "funding"
  /** Moving value from the funding instrument into a wallet or stored value. */
  | "charge"
  /** The tender presented at the merchant. */
  | "payment"
  /** A loyalty identifier shown at the register. */
  | "loyalty"
  /** Anything additive on top: a campaign, a portal, a member rate. */
  | "bonus";

export type RewardRounding = "floor" | "ceil" | "half_up";

export interface PaymentLayerOption {
  readonly option_id: string;
  readonly layer: PaymentLayer;
  readonly label_ja: string;
  readonly reward_asset: AssetRef;
  /** Reward units earned per `basis_unit_jpy` of qualifying spend. */
  readonly reward_units_per_basis: string;
  readonly basis_unit_jpy: number;
  readonly reward_rounding: RewardRounding;
  /** Cap on reward units in the current period, if any. */
  readonly cap_reward_units_per_period: string | null;
  readonly cap_reward_units_used: string | null;
  /** Every listed option must also be selected for this one to apply. */
  readonly requires_option_ids: readonly string[];
  /** This option cannot be selected alongside any listed option. */
  readonly conflicts_with_option_ids: readonly string[];
  /** Merchants that accept this option.  Empty means "any merchant". */
  readonly merchant_ids: readonly string[];
  readonly stack_group: string;
  readonly stacking_mode: "additive" | "best_of_group" | "replaces_group";
  readonly valid_from: string | null;
  readonly valid_to: string | null;
  readonly required_conditions_ja: readonly string[];
  readonly source_claim_ids: readonly string[];
}

export interface PaymentStackRequest {
  readonly effective_at: string;
  readonly merchant_id: string;
  readonly amount_jpy: number;
  readonly options: readonly PaymentLayerOption[];
  readonly confirmed_option_ids: readonly string[];
  readonly max_bonus_options: number;
  readonly valuation: ValuationProfile;
}

export interface PaymentLayerContribution {
  readonly option_id: string;
  readonly layer: PaymentLayer;
  readonly label_ja: string;
  readonly reward_asset_id: string;
  readonly reward_reward_class: string | null;
  readonly reward_units: string;
  readonly uncapped_reward_units: string;
  readonly cap_limited: boolean;
  readonly rate_percent: string | null;
  readonly value: JpyValuation | null;
  readonly source_claim_ids: readonly string[];
}

export interface PaymentStackPlan {
  readonly plan_id: `sha256:${string}`;
  readonly option_ids: readonly string[];
  readonly layers: readonly PaymentLayerContribution[];
  readonly rejected_option_ids: readonly string[];
  readonly total_value_jpy: string | null;
  readonly total_rate_percent: string | null;
  readonly value_status: "valued" | "unvalued";
  readonly channel_count: number;
  readonly required_conditions_ja: readonly string[];
}

export interface PaymentStackSkip {
  readonly option_id: string;
  readonly reason_code: string;
}

export interface PaymentStackResult {
  readonly version: typeof PAYMENT_STACK_SYNTHESIZER_VERSION;
  readonly merchant_id: string;
  readonly amount_jpy: number;
  readonly valuation_profile_hash: `sha256:${string}`;
  readonly winner: PaymentStackPlan | null;
  readonly plans: readonly PaymentStackPlan[];
  readonly skipped: readonly PaymentStackSkip[];
  readonly combination_search_truncated: boolean;
  readonly result_hash: `sha256:${string}`;
}

const MAX_COMBINATIONS = 4_096;
const MAX_RETURNED_PLANS = 10;

const SINGLE_SELECT_LAYERS: readonly PaymentLayer[] = [
  "funding",
  "charge",
  "payment",
  "loyalty",
];

const OPTION_KEYS = [
  "option_id",
  "layer",
  "label_ja",
  "reward_asset",
  "reward_units_per_basis",
  "basis_unit_jpy",
  "reward_rounding",
  "cap_reward_units_per_period",
  "cap_reward_units_used",
  "requires_option_ids",
  "conflicts_with_option_ids",
  "merchant_ids",
  "stack_group",
  "stacking_mode",
  "valid_from",
  "valid_to",
  "required_conditions_ja",
  "source_claim_ids",
] as const;

const REQUEST_KEYS = [
  "effective_at",
  "merchant_id",
  "amount_jpy",
  "options",
  "confirmed_option_ids",
  "max_bonus_options",
  "valuation",
] as const;

const ASSET_KEYS = [
  "asset_id",
  "asset_kind",
  "program_id",
  "reward_class",
  "scale",
] as const;

const LAYERS: readonly PaymentLayer[] = [
  "funding",
  "charge",
  "payment",
  "loyalty",
  "bonus",
];

function assertAsset(value: unknown): asserts value is AssetRef {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("payment_stack_asset_invalid");
  const record = value as PlainRecord;
  exactKeys(record, ASSET_KEYS, "payment_stack_asset_shape_invalid");
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
    throw new TypeError("payment_stack_asset_invalid");
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

function stringArray(value: unknown, limit: number): boolean {
  return (
    Array.isArray(value) &&
    value.length <= limit &&
    value.every((item) => typeof item === "string" && item.length <= 160)
  );
}

function assertOption(value: unknown): asserts value is PaymentLayerOption {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("payment_stack_option_invalid");
  const record = value as PlainRecord;
  exactKeys(record, OPTION_KEYS, "payment_stack_option_shape_invalid");
  assertAsset(record.reward_asset);
  if (
    typeof record.option_id !== "string" ||
    !/^[a-z0-9][a-z0-9._-]{1,119}$/u.test(record.option_id) ||
    typeof record.layer !== "string" ||
    !LAYERS.includes(record.layer as PaymentLayer) ||
    typeof record.label_ja !== "string" ||
    record.label_ja.length < 1 ||
    record.label_ja.length > 120 ||
    typeof record.reward_units_per_basis !== "string" ||
    !Number.isInteger(record.basis_unit_jpy) ||
    Number(record.basis_unit_jpy) < 1 ||
    Number(record.basis_unit_jpy) > 1_000_000 ||
    !["floor", "ceil", "half_up"].includes(record.reward_rounding as string) ||
    !optionalDecimal(record.cap_reward_units_per_period) ||
    !optionalDecimal(record.cap_reward_units_used) ||
    !stringArray(record.requires_option_ids, 8) ||
    !stringArray(record.conflicts_with_option_ids, 16) ||
    !stringArray(record.merchant_ids, 64) ||
    typeof record.stack_group !== "string" ||
    record.stack_group.length > 64 ||
    !["additive", "best_of_group", "replaces_group"].includes(
      record.stacking_mode as string,
    ) ||
    (record.valid_from !== null &&
      (typeof record.valid_from !== "string" || !validDate(record.valid_from))) ||
    (record.valid_to !== null &&
      (typeof record.valid_to !== "string" || !validDate(record.valid_to))) ||
    !stringArray(record.required_conditions_ja, 8) ||
    !stringArray(record.source_claim_ids, 16) ||
    (record.source_claim_ids as readonly string[]).length < 1
  )
    throw new TypeError("payment_stack_option_invalid");
  decimalString(record.reward_units_per_basis);
  if (
    (record.cap_reward_units_per_period === null) !==
    (record.cap_reward_units_used === null)
  )
    throw new TypeError("payment_stack_option_cap_usage_mismatch");
}

function activeOn(option: PaymentLayerOption, date: string): boolean {
  return (
    (option.valid_from === null || option.valid_from <= date) &&
    (option.valid_to === null || option.valid_to >= date)
  );
}

function roundUnits(value: Decimal, mode: RewardRounding): Decimal {
  if (mode === "floor") return value.floor();
  if (mode === "ceil") return value.ceil();
  return value.toDecimalPlaces(0, 4);
}

/**
 * Reward this option earns on `amountJpy`, before stacking is resolved.
 *
 * Rewards accrue per whole basis unit, so a 200 JPY basis earns nothing on the
 * trailing 199 JPY.  The uncapped figure is kept alongside the capped one so
 * the caller can say the cap is what limited the result.
 */
function contributionFor(
  option: PaymentLayerOption,
  amountJpy: number,
  profile: ValuationProfile,
): PaymentLayerContribution {
  const basisCount = D(amountJpy).div(option.basis_unit_jpy).floor();
  const uncapped = roundUnits(
    basisCount.mul(decimalString(option.reward_units_per_basis)),
    option.reward_rounding,
  );
  let units = uncapped;
  let capLimited = false;
  if (option.cap_reward_units_per_period !== null) {
    const remaining = decimalString(option.cap_reward_units_per_period).minus(
      decimalString(option.cap_reward_units_used ?? "0"),
    );
    const headroom = remaining.lt(0) ? D(0) : remaining;
    if (units.gt(headroom)) {
      units = headroom;
      capLimited = true;
    }
  }
  const amount = canonicalDecimal(units);
  const value = valueQuantity(
    profile,
    option.reward_asset.asset_id,
    option.reward_asset.reward_class,
    amount,
  );
  return {
    option_id: option.option_id,
    layer: option.layer,
    label_ja: option.label_ja,
    reward_asset_id: option.reward_asset.asset_id,
    reward_reward_class: option.reward_asset.reward_class,
    reward_units: amount,
    uncapped_reward_units: canonicalDecimal(uncapped),
    cap_limited: capLimited,
    rate_percent:
      value && amountJpy > 0
        ? canonicalDecimal(
            decimalString(value.expected_jpy)
              .div(amountJpy)
              .mul(100)
              .toDecimalPlaces(3),
          )
        : null,
    value,
    source_claim_ids: option.source_claim_ids,
  };
}

/** Cartesian product over the single-select layers, plus a bonus subset. */
function* combinations(
  byLayer: ReadonlyMap<PaymentLayer, readonly PaymentLayerOption[]>,
  bonusOptions: readonly PaymentLayerOption[],
  maxBonus: number,
): Generator<readonly PaymentLayerOption[]> {
  const choiceLists = SINGLE_SELECT_LAYERS.map((layer) => [
    null,
    ...(byLayer.get(layer) ?? []),
  ]);
  const bonusSubsets: (readonly PaymentLayerOption[])[] = [[]];
  for (const option of bonusOptions) {
    for (const subset of [...bonusSubsets]) {
      if (subset.length >= maxBonus) continue;
      bonusSubsets.push([...subset, option]);
    }
  }

  const walk = function* (
    index: number,
    chosen: readonly PaymentLayerOption[],
  ): Generator<readonly PaymentLayerOption[]> {
    if (index === choiceLists.length) {
      for (const bonus of bonusSubsets) yield [...chosen, ...bonus];
      return;
    }
    for (const choice of choiceLists[index] ?? [null]) {
      yield* walk(index + 1, choice === null ? chosen : [...chosen, choice]);
    }
  };
  yield* walk(0, []);
}

function stackingCandidate(
  option: PaymentLayerOption,
  contribution: PaymentLayerContribution,
): StackingCandidate {
  return {
    rule_id: option.option_id,
    stack_group: option.stack_group,
    mode: option.stacking_mode,
    // Selection inside a `best_of_group` is decided by native units, which is
    // only comparable within a group that pays the same asset.
    value: contribution.reward_units,
    reward_units: contribution.reward_units,
    eligible: true,
    requires_rule_ids: option.requires_option_ids,
    conflicts_with_rule_ids: option.conflicts_with_option_ids,
  };
}

function assertRequest(input: PaymentStackRequest): void {
  exactKeys(
    input as unknown as PlainRecord,
    REQUEST_KEYS,
    "payment_stack_request_shape_invalid",
  );
  if (!validDateTime(input.effective_at))
    throw new TypeError("payment_stack_effective_at_invalid");
  if (
    typeof input.merchant_id !== "string" ||
    !/^[a-z0-9][a-z0-9._-]{1,119}$/u.test(input.merchant_id)
  )
    throw new TypeError("payment_stack_merchant_invalid");
  if (
    !Number.isSafeInteger(input.amount_jpy) ||
    input.amount_jpy < 1 ||
    input.amount_jpy > 10_000_000
  )
    throw new TypeError("payment_stack_amount_invalid");
  if (
    !Number.isInteger(input.max_bonus_options) ||
    input.max_bonus_options < 0 ||
    input.max_bonus_options > 4
  )
    throw new TypeError("payment_stack_max_bonus_invalid");
  if (!Array.isArray(input.options) || input.options.length > 128)
    throw new TypeError("payment_stack_options_invalid");
  input.options.forEach(assertOption);
  if (
    new Set(input.options.map((option) => option.option_id)).size !==
    input.options.length
  )
    throw new TypeError("payment_stack_option_duplicate");
  if (
    !Array.isArray(input.confirmed_option_ids) ||
    input.confirmed_option_ids.length > 64 ||
    input.confirmed_option_ids.some((item) => typeof item !== "string")
  )
    throw new TypeError("payment_stack_confirmation_invalid");
  if (
    !input.valuation ||
    typeof input.valuation !== "object" ||
    typeof input.valuation.profile_hash !== "string" ||
    !Array.isArray(input.valuation.entries)
  )
    throw new TypeError("payment_stack_valuation_invalid");
}

/**
 * Rank the ways to pay for one purchase, best combined value first.
 *
 * A combination is only offered when every prerequisite it declares is also
 * selected, so a charge reward that exists solely because a particular card
 * funds a particular wallet cannot be counted without that pairing.
 */
export function synthesizePaymentStacks(
  raw: PaymentStackRequest,
): PaymentStackResult {
  const input = plainInput(
    raw,
    "payment_stack_input_invalid",
  ) as PaymentStackRequest;
  assertRequest(input);

  const effectiveDate = input.effective_at.slice(0, 10);
  const confirmed = new Set(input.confirmed_option_ids);
  const skipped = new Map<string, string>();

  const usable = input.options.filter((option) => {
    if (!activeOn(option, effectiveDate)) {
      skipped.set(
        option.option_id,
        option.valid_to !== null && option.valid_to < effectiveDate
          ? "reward_withdrawn_or_expired"
          : "outside_validity_window",
      );
      return false;
    }
    if (
      option.merchant_ids.length > 0 &&
      !option.merchant_ids.includes(input.merchant_id)
    ) {
      skipped.set(option.option_id, "merchant_not_accepted");
      return false;
    }
    if (
      option.required_conditions_ja.length > 0 &&
      !confirmed.has(option.option_id)
    ) {
      skipped.set(option.option_id, "condition_confirmation_required");
      return false;
    }
    return true;
  });

  const available = new Set(usable.map((option) => option.option_id));
  const byLayer = new Map<PaymentLayer, PaymentLayerOption[]>();
  for (const option of [...usable].sort((left, right) =>
    left.option_id.localeCompare(right.option_id),
  )) {
    const list = byLayer.get(option.layer);
    if (list) list.push(option);
    else byLayer.set(option.layer, [option]);
  }

  const plans: PaymentStackPlan[] = [];
  const seen = new Set<string>();
  const usedOptionIds = new Set<string>();
  let truncated = false;
  let examined = 0;

  for (const combination of combinations(
    byLayer,
    byLayer.get("bonus") ?? [],
    input.max_bonus_options,
  )) {
    if (examined >= MAX_COMBINATIONS) {
      truncated = true;
      break;
    }
    examined += 1;
    if (combination.length === 0) continue;
    const selected = new Set(combination.map((option) => option.option_id));

    let viable = true;
    // Charging a wallet only earns towards *this* purchase if the purchase is
    // then paid from it.  Without a payment layer the charge is a transfer the
    // buyer has not spent, and counting it would claim a reward for money that
    // never reached the merchant.  Which payment instrument a charge belongs
    // to is data: the charge option names it in `requires_option_ids`.
    const layersPresent = new Set(combination.map((option) => option.layer));
    if (layersPresent.has("charge") && !layersPresent.has("payment"))
      viable = false;
    for (const option of combination) {
      for (const required of option.requires_option_ids)
        if (!selected.has(required)) {
          viable = false;
          if (!available.has(required))
            skipped.set(option.option_id, "prerequisite_unavailable");
        }
      for (const conflict of option.conflicts_with_option_ids)
        if (selected.has(conflict)) viable = false;
    }
    if (!viable) continue;

    const contributions = combination.map((option) =>
      contributionFor(option, input.amount_jpy, input.valuation),
    );
    const byOption = new Map(
      combination.map((option, index) => [
        option.option_id,
        contributions[index] as PaymentLayerContribution,
      ]),
    );
    const resolution = resolveStacking(
      combination.map((option) =>
        stackingCandidate(
          option,
          byOption.get(option.option_id) as PaymentLayerContribution,
        ),
      ),
    );
    const appliedIds = [...resolution.applied_rule_ids].sort();
    if (appliedIds.length === 0) continue;
    const key = appliedIds.join("|");
    if (seen.has(key)) continue;
    seen.add(key);

    const layers = appliedIds
      .map((id) => byOption.get(id))
      .filter((item): item is PaymentLayerContribution => item !== undefined)
      .sort(
        (left, right) =>
          LAYERS.indexOf(left.layer) - LAYERS.indexOf(right.layer) ||
          left.option_id.localeCompare(right.option_id),
      );
    // A plan whose every layer is priced can be summed; one unpriced layer
    // makes the total a guess, so the plan is reported without one.
    const valued = layers.every((layer) => layer.value !== null);
    const total = valued
      ? layers.reduce<Decimal>(
          (accumulator, layer) =>
            accumulator.plus(
              decimalString(
                (layer.value as JpyValuation).expected_jpy,
              ),
            ),
          D(0),
        )
      : null;
    for (const id of appliedIds) usedOptionIds.add(id);

    const projection = {
      option_ids: appliedIds,
      layers,
      rejected_option_ids: [...resolution.rejected_rule_ids].sort(),
      total_value_jpy: total === null ? null : canonicalDecimal(total),
      total_rate_percent:
        total === null
          ? null
          : canonicalDecimal(
              total.div(input.amount_jpy).mul(100).toDecimalPlaces(3),
            ),
      value_status: (valued ? "valued" : "unvalued") as "valued" | "unvalued",
      channel_count: layers.length,
      required_conditions_ja: [
        ...new Set(
          combination
            .filter((option) => selected.has(option.option_id))
            .flatMap((option) => option.required_conditions_ja),
        ),
      ].sort(),
    };
    plans.push({
      plan_id: canonicalHash(projection) as `sha256:${string}`,
      ...projection,
    });
  }

  for (const id of usedOptionIds) skipped.delete(id);
  plans.sort((left, right) => {
    if (left.value_status !== right.value_status)
      return left.value_status === "valued" ? -1 : 1;
    if (left.total_value_jpy !== null && right.total_value_jpy !== null) {
      const value = decimalString(right.total_value_jpy).cmp(
        decimalString(left.total_value_jpy),
      );
      if (value !== 0) return value;
    }
    // Fewer channels is less to get wrong at the register, so a tie goes to
    // the simpler plan.
    if (left.channel_count !== right.channel_count)
      return left.channel_count - right.channel_count;
    return left.plan_id.localeCompare(right.plan_id);
  });

  const ranked = plans.slice(0, MAX_RETURNED_PLANS);
  const projection = {
    version: PAYMENT_STACK_SYNTHESIZER_VERSION,
    merchant_id: input.merchant_id,
    amount_jpy: input.amount_jpy,
    valuation_profile_hash: input.valuation.profile_hash,
    winner: ranked[0] ?? null,
    plans: ranked,
    skipped: [...skipped.entries()]
      .map(([option_id, reason_code]) => ({ option_id, reason_code }))
      .sort((left, right) => left.option_id.localeCompare(right.option_id)),
    combination_search_truncated: truncated,
  };
  return {
    ...projection,
    result_hash: canonicalHash(projection) as `sha256:${string}`,
  };
}
