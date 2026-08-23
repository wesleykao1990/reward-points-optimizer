import { hashCanonical } from "./canonical.js";
import type { P0SpendAsset } from "./p0-spend-rules.js";
import { deepFreeze } from "./security.js";

/**
 * Compile the payment-channel subset of the P0 research wave.
 *
 * Paying well is usually a stack rather than a single instrument: a card funds
 * a wallet, the wallet pays the merchant, and a loyalty identifier is shown on
 * top.  The rule engine can price such a stack, but only if something turns
 * the research claims into the layered options it expects.  That is this
 * module.
 *
 * It reads only the claim shapes it can read exactly.  A claim that states a
 * maximum rate, a conditional step rate, or a rate "as an example" is not a
 * rate, and receives a non-executable disposition instead of a guess — the
 * same rule the spend compiler follows.
 *
 * Two facts from the same research wave make this worth doing carefully:
 * issuers are withdrawing rewards for charging wallets, and several already
 * publish an exclusion saying charges earn nothing.  Those exclusions are
 * compiled as first-class records so a charge option is never offered for a
 * card whose issuer has said it does not pay.
 */

export const P0_PAYMENT_LAYER_SET_VERSION =
  "p0-payment-layer-set.v0.1" as const;

export type P0PaymentLayer =
  | "funding"
  | "charge"
  | "payment"
  | "loyalty"
  | "bonus";

export interface P0PaymentLayerOption {
  readonly option_id: string;
  readonly layer: P0PaymentLayer;
  readonly family_id: string;
  readonly label_ja: string;
  readonly reward_asset: P0SpendAsset;
  readonly reward_units_per_basis: string;
  readonly basis_unit_jpy: number;
  readonly cap_reward_units_per_period: string | null;
  readonly cap_period: "day" | "month" | "year" | null;
  /** Option ids that must also be selected for this option to apply. */
  readonly requires_option_ids: readonly string[];
  readonly merchant_scope: string | null;
  readonly source_claim_ids: readonly string[];
  readonly source_ids: readonly string[];
  readonly status: "active_experimental";
}

/** An issuer statement that charging a wallet earns nothing. */
export interface P0ChargeExclusion {
  readonly family_id: string;
  readonly excluded_examples: readonly string[];
  readonly source_claim_ids: readonly string[];
  readonly source_ids: readonly string[];
}

/** A published redemption value, used to price what an asset is worth. */
export interface P0ExitOption {
  readonly exit_id: string;
  readonly asset_id: string;
  readonly label_ja: string;
  readonly jpy_per_unit: string;
  readonly source_claim_ids: readonly string[];
  readonly source_ids: readonly string[];
}

export type P0PaymentDispositionStatus =
  | "executable"
  | "maximum_or_conditional_only"
  | "no_asset_binding"
  | "information_only";

export interface P0PaymentClaimDisposition {
  readonly claim_id: string;
  readonly status: P0PaymentDispositionStatus;
  readonly reason: string;
  readonly derived_option_ids: readonly string[];
}

export interface P0PaymentLayerSet {
  readonly version: typeof P0_PAYMENT_LAYER_SET_VERSION;
  readonly source_artifact_ids: readonly string[];
  readonly options: readonly P0PaymentLayerOption[];
  readonly charge_exclusions: readonly P0ChargeExclusion[];
  readonly exit_options: readonly P0ExitOption[];
  readonly dispositions: readonly P0PaymentClaimDisposition[];
  readonly set_hash: `sha256:${string}`;
}

type JsonRecord = Record<string, unknown>;

interface Claim {
  readonly claim_id: string;
  readonly family_id: string;
  readonly claim_type: string;
  readonly source_role_id: string;
  readonly predicate: string;
  readonly subject: string;
  readonly source_ids: readonly string[];
  readonly value: unknown;
}

const asset = (
  asset_id: string,
  program_id: string,
  label_ja: string,
): P0SpendAsset => ({
  asset_id,
  asset_kind: "reward_point",
  program_id,
  reward_class: "normal",
  scale: 0,
  label_ja,
});

/**
 * Which reward asset each product family pays in.
 *
 * This is a declared binding, not an inference from prose.  When a claim also
 * names the programme it pays in, the name must match this table or the claim
 * is left uncompiled: a silent mismatch would attach one programme's rate to
 * another programme's balance.
 */
const FAMILY_REWARD_ASSET: Readonly<Record<string, P0SpendAsset>> =
  Object.freeze({
    "card.aeon": asset("asset.point.waon", "program.waon-point", "WAON POINT"),
    "card.aupay": asset("asset.point.ponta", "program.ponta", "Pontaポイント"),
    "card.d": asset("asset.point.d", "program.d-point", "dポイント"),
    "card.paypay": asset(
      "asset.point.paypay",
      "program.paypay-point",
      "PayPayポイント",
    ),
    "card.rakuten": asset(
      "asset.point.rakuten",
      "program.rakuten-point",
      "楽天ポイント",
    ),
    "card.smbc": asset("asset.point.v", "program.v-point", "Vポイント"),
    "card.view": asset("asset.point.jre", "program.jre-point", "JRE POINT"),
    "wallet.aeonpay": asset(
      "asset.point.waon",
      "program.waon-point",
      "WAON POINT",
    ),
    "wallet.aupay": asset(
      "asset.point.ponta",
      "program.ponta",
      "Pontaポイント",
    ),
    "wallet.dbarai": asset("asset.point.d", "program.d-point", "dポイント"),
    "wallet.paypay": asset(
      "asset.point.paypay",
      "program.paypay-point",
      "PayPayポイント",
    ),
    "wallet.rakutenpay": asset(
      "asset.point.rakuten",
      "program.rakuten-point",
      "楽天ポイント",
    ),
    "point.nanaco": asset(
      "asset.point.nanaco",
      "program.nanaco",
      "nanacoポイント",
    ),
  });

/** Families whose payment option represents a credit card presented directly. */
const CARD_FAMILY_PREFIX = "card.";

/**
 * Charge rewards, with the pairing each one depends on.
 *
 * A charge only earns towards a purchase when the purchase is paid from what
 * the charge filled, and the research claims state the funding instrument and
 * the balance separately.  The pairing is therefore declared here rather than
 * inferred, and the option is dropped whenever either side is missing.
 */
const CHARGE_BINDINGS: readonly {
  readonly claim_id: string;
  readonly funding_family_id: string;
  readonly payment_family_id: string;
}[] = Object.freeze([
  {
    claim_id: "claim.card.aupay.bonus.autocharge.002",
    funding_family_id: "card.aupay",
    payment_family_id: "wallet.aupay",
  },
  {
    claim_id: "claim.point.nanaco.earn.credit-charge.003",
    funding_family_id: "point.nanaco",
    payment_family_id: "point.nanaco",
  },
]);

const BASE_RATE_ROLES = new Set([
  "base_point_rules",
  "base_reward_rules",
  "earn_rules",
]);

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function claimRecord(value: unknown): Claim {
  if (!isRecord(value)) throw new TypeError("p0_payment_claim_invalid");
  const claimId = value.claim_id;
  const familyId = value.family_id;
  const claimType = value.claim_type;
  const roleId = value.source_role_id;
  const predicate = value.predicate;
  const subject = value.subject;
  const sourceIds = value.source_ids;
  if (
    typeof claimId !== "string" ||
    typeof familyId !== "string" ||
    typeof claimType !== "string" ||
    typeof roleId !== "string" ||
    typeof predicate !== "string" ||
    typeof subject !== "string" ||
    !Array.isArray(sourceIds) ||
    !sourceIds.every((item) => typeof item === "string")
  )
    throw new TypeError("p0_payment_claim_invalid");
  return {
    claim_id: claimId,
    family_id: familyId,
    claim_type: claimType,
    source_role_id: roleId,
    predicate,
    subject,
    source_ids: Object.freeze([...sourceIds].sort()),
    value: value.value,
  };
}

function positiveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function positiveInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) > 0
    ? Number(value)
    : null;
}

/** Trim a fixed-point decimal without ever reaching exponent notation. */
function decimalText(value: number): string {
  const text = value.toFixed(6);
  const trimmed = text.replace(/0+$/u, "").replace(/\.$/u, "");
  return trimmed === "" || trimmed === "-0" ? "0" : trimmed;
}

interface ExactRate {
  readonly units: string;
  readonly basis: number;
}

/**
 * Read a rate only from the shapes that state one exactly.
 *
 * `{spend_yen, points}` and `{calculation_unit_yen, balance_rate}` are exact.
 * A `max_rate`, a conditional step rate, or a range is not: it describes a
 * ceiling or a spread the buyer may not reach, so it is refused here and
 * reported as a disposition.
 */
function exactRate(value: unknown): ExactRate | null {
  if (!isRecord(value)) return null;
  const spendYen = positiveInteger(value.spend_yen);
  const points = positiveNumber(value.points);
  if (spendYen !== null && points !== null)
    return { units: decimalText(points), basis: spendYen };
  const unitYen = positiveInteger(value.calculation_unit_yen);
  const balanceRate = positiveNumber(value.balance_rate);
  if (unitYen !== null && balanceRate !== null)
    return { units: decimalText(unitYen * balanceRate), basis: unitYen };
  const amount = positiveInteger(value.amount);
  const amountPoints = positiveNumber(value.points);
  if (amount !== null && amountPoints !== null)
    return { units: decimalText(amountPoints), basis: amount };
  return null;
}

/** A stated programme name must agree with the declared asset binding. */
function programmeMatches(value: unknown, rewardAsset: P0SpendAsset): boolean {
  if (!isRecord(value)) return true;
  const stated = value.point;
  if (typeof stated !== "string" || stated.length === 0) return true;
  return stated === rewardAsset.label_ja;
}

function optionId(layer: P0PaymentLayer, familyId: string): string {
  return `p0.pay.${layer}.${familyId}`;
}

function chargeOption(
  claim: Claim,
  binding: (typeof CHARGE_BINDINGS)[number],
  rewardAsset: P0SpendAsset,
  availablePaymentFamilies: ReadonlySet<string>,
): P0PaymentLayerOption | null {
  if (!availablePaymentFamilies.has(binding.payment_family_id)) return null;
  const value = claim.value;
  if (!isRecord(value)) return null;
  // A per-card table states the rate for the ordinary card explicitly; the
  // upgraded tiers are separate products and are not assumed.
  const regular = isRecord(value.regular_card) ? value.regular_card : null;
  const perTwoHundred = regular
    ? positiveNumber(regular.points_per_200_yen)
    : null;
  const rate: ExactRate | null =
    perTwoHundred !== null
      ? { units: decimalText(perTwoHundred), basis: 200 }
      : exactRate(value);
  if (!rate) return null;
  const monthlyCap = regular
    ? positiveNumber(regular.monthly_cap_points)
    : null;
  const requires = [optionId("payment", binding.payment_family_id)];
  if (binding.funding_family_id.startsWith(CARD_FAMILY_PREFIX))
    requires.push(optionId("funding", binding.funding_family_id));
  return {
    option_id: optionId("charge", claim.family_id),
    layer: "charge",
    family_id: claim.family_id,
    label_ja: claim.subject,
    reward_asset: rewardAsset,
    reward_units_per_basis: rate.units,
    basis_unit_jpy: rate.basis,
    cap_reward_units_per_period:
      monthlyCap === null ? null : decimalText(monthlyCap),
    cap_period: monthlyCap === null ? null : "month",
    requires_option_ids: Object.freeze(requires.sort()),
    merchant_scope: null,
    source_claim_ids: Object.freeze([claim.claim_id]),
    source_ids: claim.source_ids,
    status: "active_experimental",
  };
}

function exitOptions(claim: Claim): readonly P0ExitOption[] {
  const value = claim.value;
  if (!isRecord(value)) return [];
  const results: P0ExitOption[] = [];
  const rewardAsset = FAMILY_REWARD_ASSET[claim.family_id];
  const direct = positiveInteger(value.points);
  const yen = positiveNumber(value.yen_value);
  if (rewardAsset && direct !== null && yen !== null)
    results.push({
      exit_id: `p0.exit.${claim.claim_id}`,
      asset_id: rewardAsset.asset_id,
      label_ja: claim.subject,
      jpy_per_unit: decimalText(yen / direct),
      source_claim_ids: Object.freeze([claim.claim_id]),
      source_ids: claim.source_ids,
    });
  // A named sub-route states its own pair; only the ones whose asset binding
  // is unambiguous are compiled.
  const namedRoute = value.jre_point_to_suica;
  if (isRecord(namedRoute)) {
    const points = positiveInteger(namedRoute.points);
    const routeYen = positiveNumber(namedRoute.yen_value);
    if (points !== null && routeYen !== null)
      results.push({
        exit_id: `p0.exit.${claim.claim_id}.jre-suica`,
        asset_id: "asset.point.jre",
        label_ja: "JRE POINTをSuica残高へ",
        jpy_per_unit: decimalText(routeYen / points),
        source_claim_ids: Object.freeze([claim.claim_id]),
        source_ids: claim.source_ids,
      });
  }
  return Object.freeze(results);
}

function chargeExclusion(claim: Claim): P0ChargeExclusion | null {
  const value = claim.value;
  if (!isRecord(value)) return null;
  const examples = value.excluded_examples ?? value.examples;
  if (
    !Array.isArray(examples) ||
    !examples.every((item) => typeof item === "string")
  )
    return null;
  return {
    family_id: claim.family_id,
    excluded_examples: Object.freeze([...examples].sort()),
    source_claim_ids: Object.freeze([claim.claim_id]),
    source_ids: claim.source_ids,
  };
}

const CHARGE_EXCLUSION_PREDICATES = new Set([
  "excludes_wallet_and_prepaid_charges",
  "excludes_wallet_and_e_money_charges",
  "excludes_other_wallet_charges",
]);

/**
 * Compile payment layers, charge exclusions, and redemption values.
 *
 * Every claim in the wave receives a disposition, so a claim that produced no
 * option is visibly refused rather than quietly dropped.
 */
export function compileP0PaymentLayerSet(input: unknown): P0PaymentLayerSet {
  if (!Array.isArray(input))
    throw new TypeError("p0_payment_artifacts_invalid");
  const claims = new Map<string, Claim>();
  const artifactIds: string[] = [];
  for (const artifact of input) {
    if (!isRecord(artifact)) throw new TypeError("p0_payment_artifact_invalid");
    const metadata = artifact.metadata;
    const artifactId = isRecord(metadata) ? metadata.artifact_id : undefined;
    if (typeof artifactId !== "string" || !Array.isArray(artifact.claims))
      throw new TypeError("p0_payment_artifact_invalid");
    artifactIds.push(artifactId);
    for (const rawClaim of artifact.claims) {
      const claim = claimRecord(rawClaim);
      if (claims.has(claim.claim_id))
        throw new TypeError(`p0_payment_claim_duplicate:${claim.claim_id}`);
      claims.set(claim.claim_id, claim);
    }
  }

  const options = new Map<string, P0PaymentLayerOption>();
  const derivedByClaim = new Map<string, string[]>();
  const dispositions = new Map<string, P0PaymentClaimDisposition>();
  const exits = new Map<string, P0ExitOption>();
  const exclusions: P0ChargeExclusion[] = [];

  const note = (
    claim: Claim,
    status: P0PaymentDispositionStatus,
    reason: string,
  ): void => {
    if (!dispositions.has(claim.claim_id))
      dispositions.set(claim.claim_id, {
        claim_id: claim.claim_id,
        status,
        reason,
        derived_option_ids: Object.freeze([]),
      });
  };

  const record = (claimId: string, option: P0PaymentLayerOption): void => {
    options.set(option.option_id, option);
    derivedByClaim.set(claimId, [
      ...(derivedByClaim.get(claimId) ?? []),
      option.option_id,
    ]);
  };

  const ordered = [...claims.values()].sort((left, right) =>
    left.claim_id.localeCompare(right.claim_id),
  );

  // Pass 1: payment-layer rates.  A family may publish several base rates; the
  // lowest exact one is used, because a higher published figure is normally
  // the conditional ceiling rather than what an ordinary purchase earns.
  const bestPayment = new Map<string, { claim: Claim; rate: ExactRate }>();
  for (const claim of ordered) {
    if (
      claim.claim_type !== "earn_rule" ||
      !BASE_RATE_ROLES.has(claim.source_role_id)
    )
      continue;
    const rewardAsset = FAMILY_REWARD_ASSET[claim.family_id];
    if (!rewardAsset) {
      note(
        claim,
        "no_asset_binding",
        "no declared reward-asset binding for this family",
      );
      continue;
    }
    if (!programmeMatches(claim.value, rewardAsset)) {
      note(
        claim,
        "no_asset_binding",
        "stated programme does not match the declared reward-asset binding",
      );
      continue;
    }
    const rate = exactRate(claim.value);
    if (!rate) {
      note(
        claim,
        "maximum_or_conditional_only",
        "claim states a maximum, a range, or a conditional rate rather than an exact one",
      );
      continue;
    }
    const current = bestPayment.get(claim.family_id);
    const density = Number(rate.units) / rate.basis;
    if (!current || density < Number(current.rate.units) / current.rate.basis)
      bestPayment.set(claim.family_id, { claim, rate });
  }

  for (const [familyId, { claim, rate }] of bestPayment) {
    const rewardAsset = FAMILY_REWARD_ASSET[familyId] as P0SpendAsset;
    record(claim.claim_id, {
      option_id: optionId("payment", familyId),
      layer: "payment",
      family_id: familyId,
      label_ja: claim.subject,
      reward_asset: rewardAsset,
      reward_units_per_basis: rate.units,
      basis_unit_jpy: rate.basis,
      cap_reward_units_per_period: null,
      cap_period: null,
      requires_option_ids: Object.freeze([]),
      merchant_scope: null,
      source_claim_ids: Object.freeze([claim.claim_id]),
      source_ids: claim.source_ids,
      status: "active_experimental",
    });
    // Presenting the card is what funds a direct card payment, so each card
    // family that can pay also gets the funding option a charge can require.
    if (familyId.startsWith(CARD_FAMILY_PREFIX))
      record(claim.claim_id, {
        option_id: optionId("funding", familyId),
        layer: "funding",
        family_id: familyId,
        label_ja: claim.subject,
        reward_asset: rewardAsset,
        reward_units_per_basis: "0",
        basis_unit_jpy: 1,
        cap_reward_units_per_period: null,
        cap_period: null,
        requires_option_ids: Object.freeze([]),
        merchant_scope: null,
        source_claim_ids: Object.freeze([claim.claim_id]),
        source_ids: claim.source_ids,
        status: "active_experimental",
      });
  }

  // Pass 2: charge rewards, only for the declared pairings.
  const paymentFamilies = new Set(bestPayment.keys());
  for (const binding of CHARGE_BINDINGS) {
    const claim = claims.get(binding.claim_id);
    if (!claim) continue;
    const rewardAsset = FAMILY_REWARD_ASSET[claim.family_id];
    if (!rewardAsset) {
      note(claim, "no_asset_binding", "no declared reward-asset binding");
      continue;
    }
    const option = chargeOption(claim, binding, rewardAsset, paymentFamilies);
    if (!option) {
      note(
        claim,
        "information_only",
        "charge reward has no exact rate or its paired payment option is unavailable",
      );
      continue;
    }
    record(claim.claim_id, option);
  }

  // Pass 3: exclusions and redemption values.
  for (const claim of ordered) {
    if (claim.claim_type === "redemption_value") {
      const derived = exitOptions(claim);
      for (const exit of derived) exits.set(exit.exit_id, exit);
      if (derived.length === 0)
        note(
          claim,
          "information_only",
          "redemption value is not stated as an exact points-to-yen pair",
        );
      else
        derivedByClaim.set(claim.claim_id, [
          ...(derivedByClaim.get(claim.claim_id) ?? []),
          ...derived.map((exit) => exit.exit_id),
        ]);
    }
  }

  for (const claim of ordered) {
    if (claim.claim_type !== "exclusion") continue;
    if (!CHARGE_EXCLUSION_PREDICATES.has(claim.predicate)) continue;
    const exclusion = chargeExclusion(claim);
    if (exclusion) {
      exclusions.push(exclusion);
      derivedByClaim.set(claim.claim_id, [
        ...(derivedByClaim.get(claim.claim_id) ?? []),
        `exclusion:${exclusion.family_id}`,
      ]);
    }
  }

  for (const claim of ordered) {
    const derived = derivedByClaim.get(claim.claim_id);
    if (derived)
      dispositions.set(claim.claim_id, {
        claim_id: claim.claim_id,
        status: "executable",
        reason: "compiled into an exact payment-layer option",
        derived_option_ids: Object.freeze([...new Set(derived)].sort()),
      });
    else
      note(
        claim,
        "information_only",
        "claim is not an exact payment-layer rate, exclusion, or redemption value",
      );
  }

  const projection = {
    version: P0_PAYMENT_LAYER_SET_VERSION,
    source_artifact_ids: [...new Set(artifactIds)].sort(),
    options: [...options.values()].sort((left, right) =>
      left.option_id.localeCompare(right.option_id),
    ),
    charge_exclusions: exclusions.sort((left, right) =>
      left.family_id.localeCompare(right.family_id),
    ),
    exit_options: [...exits.values()].sort((left, right) =>
      left.exit_id.localeCompare(right.exit_id),
    ),
    dispositions: [...dispositions.values()].sort((left, right) =>
      left.claim_id.localeCompare(right.claim_id),
    ),
  };
  return deepFreeze({
    ...projection,
    set_hash: hashCanonical(projection),
  }) as P0PaymentLayerSet;
}
