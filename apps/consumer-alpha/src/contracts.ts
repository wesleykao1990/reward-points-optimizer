import {
  isCanonicalProvisionalDateTime,
  CORRECTION_CATEGORIES as PROVISIONAL_CORRECTION_CATEGORIES,
  type CorrectionCategory as ProvisionalCorrectionCategory,
} from "@jro/provisional-rules";
import { assertAdmitted } from "@jro/recommendation-api";
import type { FactInfluenceBrowserView } from "./fact-influence-graph.js";

export type { FactInfluenceBrowserView } from "./fact-influence-graph.js";

/**
 * The only state that may cross from the browser into the M6 host.
 *
 * This is deliberately not a recommendation request.  Rules, evidence,
 * plans, source URLs, and authorization material are server-owned inputs.
 */

export const MAX_EVALUATE_BODY_BYTES = 32 * 1024;
export const MAX_CORRECTION_BODY_BYTES = 12 * 1024;
export const MAX_EXPERIMENTAL_RECOMMENDATION_BODY_BYTES = 8 * 1024;
/** The single browser-to-host request for the unified comparison journey. */
export const MAX_UNIFIED_RECOMMENDATION_BODY_BYTES = 32 * 1024;
export const MAX_TEXT_LENGTH = 160;
export const MAX_EXPERIMENTAL_CATALOGUE_CARDS = 128;
export const MAX_EXPERIMENTAL_TITLE_LENGTH = 120;
export const MAX_EXPERIMENTAL_SUMMARY_LENGTH = 320;
export const MAX_EXPERIMENTAL_SOURCE_LABEL_LENGTH = 120;

/** Canonical ids are host-owned; aliases never cross the browser boundary. */
export const SYNTHETIC_MERCHANT_ID = "merchant.synthetic" as const;
export const SYNTHETIC_BRANCH_ID = "location.synthetic" as const;

export const MANUAL_INSTRUMENTS = [
  "synthetic_card",
  "synthetic_qr_wallet",
  "synthetic_stored_value",
] as const;
export type ManualInstrument = (typeof MANUAL_INSTRUMENTS)[number];

/** Exact P0 consumer families the browser may select. Economic definitions
 * remain host-owned; these identifiers bind user ownership only. */
export const P0_PRODUCT_FAMILY_IDS = Object.freeze([
  "point.d",
  "point.jre",
  "point.nanaco",
  "point.paypay",
  "point.ponta",
  "point.rakuten",
  "point.v",
  "point.waon",
  "wallet.aeonpay",
  "wallet.aupay",
  "wallet.dbarai",
  "wallet.famipay",
  "wallet.paypay",
  "wallet.rakutenpay",
  "card.aeon",
  "card.aupay",
  "card.d",
  "card.paypay",
  "card.rakuten",
  "card.smbc",
  "card.view",
] as const);
export type P0ProductFamilyId = (typeof P0_PRODUCT_FAMILY_IDS)[number];

export const STORED_VALUE_USE = ["yes", "no", "unknown"] as const;
export type StoredValueUse = (typeof STORED_VALUE_USE)[number];

export const STORED_VALUE_USAGE = [
  "within_30_days",
  "within_90_days",
  "eventually",
  "rarely",
  "custom",
] as const;
export type StoredValueUsage = (typeof STORED_VALUE_USAGE)[number];

export const CORRECTION_CATEGORIES = [
  "wrong_merchant",
  "wrong_branch",
  "wrong_plan",
  "missing_reward",
  "unexpected_reward",
  "wrong_reward_amount",
] as const;
export type CorrectionCategory = (typeof CORRECTION_CATEGORIES)[number];

export const CORRECTION_NOTE_CODES = [
  "merchant_not_recognized",
  "branch_not_recognized",
  "plan_not_available",
  "reward_not_posted",
  "reward_reversed",
  "amount_disagrees",
] as const;
export type CorrectionNoteCode = (typeof CORRECTION_NOTE_CODES)[number];

/**
 * The experimental catalogue has its own deliberately narrower correction
 * contract.  These categories are imported from the provisional-rules
 * package; the browser never supplies a candidate hash, credibility, or
 * severity assertion.
 */
export const EXPERIMENTAL_CORRECTION_CATEGORIES = Object.freeze([
  ...PROVISIONAL_CORRECTION_CATEGORIES,
]);
export type ExperimentalCorrectionCategory = ProvisionalCorrectionCategory;

export interface ExperimentalCorrectionInput {
  readonly publication_id: string;
  readonly category: ExperimentalCorrectionCategory;
}

/**
 * The browser-facing experimental catalogue is intentionally a small display
 * model.  It is not a projection of a rule envelope: hashes, evidence,
 * source identifiers, URLs, and lifecycle assertions stay behind the host
 * port.  `experimental_unverified` is an internal display status used to
 * keep this lane separate from canonical recommendations; the UI presents
 * the calmer Japanese `先行公開` label instead.
 */
export const EXPERIMENTAL_CATALOGUE_KINDS = Object.freeze([
  "reward_rate",
  "campaign",
  "transfer",
  "payment_acceptance",
  "other",
] as const);
export type ExperimentalCatalogueKind =
  (typeof EXPERIMENTAL_CATALOGUE_KINDS)[number];

export const EXPERIMENTAL_DISPLAY_STATUSES = Object.freeze([
  "experimental_unverified",
] as const);
export type ExperimentalDisplayStatus =
  (typeof EXPERIMENTAL_DISPLAY_STATUSES)[number];

export const EXPERIMENTAL_CONFIDENCE_LEVELS = Object.freeze([
  "high",
  "medium",
  "limited",
] as const);
export type ExperimentalConfidence =
  (typeof EXPERIMENTAL_CONFIDENCE_LEVELS)[number];

export const EXPERIMENTAL_CATALOGUE_STATUSES = Object.freeze([
  "ready",
  "partial",
] as const);
export type ExperimentalCatalogueStatus =
  (typeof EXPERIMENTAL_CATALOGUE_STATUSES)[number];

export interface ExperimentalCatalogueCard {
  readonly publication_id: string;
  readonly kind: ExperimentalCatalogueKind;
  readonly title: string;
  readonly summary: string;
  readonly display_status: ExperimentalDisplayStatus;
  readonly confidence: ExperimentalConfidence;
  readonly source_label: string;
  /** First-party source URL when the host has one; null means unavailable. */
  readonly source_url: string | null;
  readonly checked_at: string;
  readonly valid_from: string;
  readonly valid_to: string | null;
}

export interface ExperimentalCatalogueSnapshot {
  readonly status: ExperimentalCatalogueStatus;
  readonly updated_at: string | null;
  readonly rules: readonly ExperimentalCatalogueCard[];
}

/**
 * The implementation-fact catalogue is a separate, deliberately smaller
 * browser contract.  `fact_key` is an opaque UUID: it is useful only for
 * binding one correction back to the trusted host and has no claim identity
 * or source meaning in the UI.  Family and claim remain localized display
 * labels; the stable family/claim-type identifiers are exposed separately so
 * downstream projections do not need to reverse-map localized text.
 */
export const IMPLEMENTATION_FACT_CORRECTION_CATEGORIES = Object.freeze([
  "fact_incorrect",
  "fact_outdated",
  "source_unavailable",
  "scope_incorrect",
  "other",
] as const);
export type ImplementationFactCorrectionCategory =
  (typeof IMPLEMENTATION_FACT_CORRECTION_CATEGORIES)[number];

export interface ImplementationFactCard {
  readonly fact_key: string;
  /** Stable host-owned family identifier; not a localized display label. */
  readonly family_id: string;
  /** Stable host-owned claim-type identifier; not a localized display label. */
  readonly claim_type: string;
  readonly family: string;
  readonly claim: string;
  readonly subject: string;
  readonly predicate: string;
  readonly summary: string;
  readonly use_in_comparison: boolean;
  /** First-party source URL when the source registry contains one. */
  readonly source_url: string | null;
  /** Snapshot `as_of`; null is explicit when a backend cannot provide it. */
  readonly checked_at: string | null;
  /** Source-declared applicability window; dates may be date-only strings. */
  readonly effective_from: string | null;
  readonly effective_to: string | null;
}

export const IMPLEMENTATION_FACT_CATALOGUE_STATUSES = Object.freeze([
  "ready",
  "partial",
] as const);
export type ImplementationFactCatalogueStatus =
  (typeof IMPLEMENTATION_FACT_CATALOGUE_STATUSES)[number];

export interface ImplementationFactCatalogueSnapshot {
  readonly status: ImplementationFactCatalogueStatus;
  readonly updated_at: string | null;
  readonly facts: readonly ImplementationFactCard[];
}

export interface ImplementationFactCorrectionInput {
  readonly fact_key: string;
  readonly category: ImplementationFactCorrectionCategory;
}

export interface ImplementationFactCorrectionSuccess {
  readonly ok: true;
  readonly fact_key: string;
  readonly category: ImplementationFactCorrectionCategory;
  readonly outcome: "recorded" | "duplicate";
}

export interface ImplementationFactCorrectionFailure {
  readonly ok: false;
  readonly code:
    | "fact_not_found"
    | "fact_not_active"
    | "correction_not_applied";
}

export type ImplementationFactCorrectionResult =
  | ImplementationFactCorrectionSuccess
  | ImplementationFactCorrectionFailure;

/** Browser-safe host port for the implementation-fact catalogue. */
export interface ImplementationFactCataloguePort {
  list(): Promise<ImplementationFactCatalogueSnapshot>;
  reportCorrection(
    input: ImplementationFactCorrectionInput,
  ): Promise<ImplementationFactCorrectionResult>;
}

/**
 * Trusted-host integration boundary for the experimental catalogue.  The
 * implementation may be backed by a database adapter, while the alpha demo
 * uses an explicit fixture port.  Correction results are intentionally
 * opaque here: the host owns hashes, credibility, severity, timestamps, and
 * any persistence details.
 */
export interface ExperimentalCataloguePort {
  list(effectiveAt?: string): Promise<ExperimentalCatalogueSnapshot>;
  reportCorrection(input: ExperimentalCorrectionInput): Promise<unknown>;
}

/**
 * The bounded real-data experiment accepts only a host-owned catalogue
 * selection and explicit economic inputs.  It is intentionally separate from
 * the synthetic manual state and from the 364 implementation facts.
 */
export const EXPERIMENTAL_NANACO_SELECTION_ID =
  "candidate_p0_nanaco_shopping_earning_20260821_v0_1" as const;
export const EXPERIMENTAL_NANACO_PAYMENT_METHOD = "nanaco" as const;
export const EXPERIMENTAL_NANACO_BRANCH_ID =
  "location.seveneleven.representative" as const;

export interface ExperimentalRecommendationInput {
  readonly selection_id: string;
  /** Gross purchase amount supplied by the caller. */
  readonly amount_jpy: number;
  /** Tax-exclusive eligible amount; never inferred from gross. */
  readonly tax_exclusive_amount_jpy: number;
  readonly nanaco_balance_jpy: number;
  readonly effective_at: string;
}

export interface ExperimentalRecommendationPlan {
  readonly plan_id: string;
  readonly eligible: boolean;
  readonly reward_points: string;
  readonly objective_score_jpy: string | null;
  readonly operation_count: number;
  readonly conditions: readonly string[];
}

export interface ExperimentalRecommendationResult {
  readonly version: "real-experimental-recommendation.v1";
  readonly request_id: string;
  readonly mode: "experimental_real_data";
  readonly verification_status: "experimental_unverified";
  readonly outcome: "definite" | "no_valid_plan";
  readonly selection_id: string;
  readonly payment_method: "nanaco";
  readonly merchant_id: "merchant.seveneleven";
  readonly branch_id: string;
  readonly amount_jpy: number;
  readonly tax_exclusive_amount_jpy: number;
  readonly effective_at: string;
  readonly winner_plan_id: string | null;
  readonly winner: ExperimentalRecommendationPlan | null;
  readonly plans: readonly ExperimentalRecommendationPlan[];
  readonly assumptions: readonly string[];
  readonly blockers: readonly string[];
  /** Optional host projection; raw fact material never enters this DTO. */
  readonly fact_influence?: FactInfluenceBrowserView;
}

/** Trusted host boundary for the one executable Nanaco recommendation lane. */
export interface ExperimentalRecommendationPort {
  evaluate(
    input: ExperimentalRecommendationInput,
  ): Promise<ExperimentalRecommendationResult>;
}

/** Browser-safe request for the separate Seven Card Plus -> nanaco route. */
export const EXPERIMENTAL_NANACO_CREDIT_CHARGE_SELECTION_ID =
  "candidate_p0_nanaco_sevencard_credit_charge_20260822_v0_1" as const;
export const EXPERIMENTAL_NANACO_CREDIT_CHARGE_PAYMENT_METHOD =
  "seven_card_plus" as const;

export interface NanacoCreditChargeRecommendationInput {
  readonly selection_id: string;
  readonly charge_amount_jpy: number;
  readonly nanaco_balance_jpy: number;
  readonly seven_card_plus_owned: boolean;
  readonly nanaco_credit_charge_preregistered: boolean;
  readonly effective_at: string;
}

export interface NanacoCreditChargeRecommendationPlan {
  readonly plan_id: string;
  readonly eligible: boolean;
  readonly reward_points: string;
  readonly objective_score_jpy: string | null;
  readonly operation_count: number;
  readonly conditions: readonly string[];
}

export interface NanacoCreditChargeRecommendationResult {
  readonly version: "real-experimental-nanaco-credit-charge-recommendation.v1";
  readonly request_id: string;
  readonly mode: "experimental_real_data";
  readonly verification_status: "experimental_unverified";
  readonly outcome: "definite" | "no_valid_plan";
  readonly selection_id: string;
  readonly payment_method: "seven_card_plus";
  readonly destination: "nanaco";
  readonly charge_amount_jpy: number;
  readonly nanaco_balance_before_jpy: number;
  readonly nanaco_balance_after_jpy: number;
  readonly effective_at: string;
  readonly winner_plan_id: string | null;
  readonly winner: NanacoCreditChargeRecommendationPlan | null;
  readonly plans: readonly NanacoCreditChargeRecommendationPlan[];
  readonly assumptions: readonly string[];
  readonly blockers: readonly string[];
  /** Optional host projection; raw fact material never enters this DTO. */
  readonly fact_influence?: FactInfluenceBrowserView;
}

export interface NanacoCreditChargeRecommendationPort {
  evaluate(
    input: NanacoCreditChargeRecommendationInput,
  ): Promise<NanacoCreditChargeRecommendationResult>;
}

export interface ManualFactInput {
  readonly key: string;
  readonly status: "known" | "unknown";
  readonly value?: string;
}

export interface ManualCapInput {
  readonly key: string;
  readonly status: "known" | "unknown";
  readonly spend_jpy?: number;
}

export interface ManualAlphaState {
  readonly merchant_id: typeof SYNTHETIC_MERCHANT_ID;
  readonly branch_id: typeof SYNTHETIC_BRANCH_ID;
  readonly amount_jpy: number;
  readonly owned_instruments: readonly ManualInstrument[];
  readonly stored_value_use: StoredValueUse;
  readonly stored_value_usage?: StoredValueUsage;
  readonly stored_value_value_jpy_per_unit?: string;
  readonly facts: readonly ManualFactInput[];
  readonly caps: readonly ManualCapInput[];
}

export interface CorrectionDraftInput {
  readonly category: CorrectionCategory;
  readonly note_code: CorrectionNoteCode;
  /** The full-input SHA-256 id returned by a successful evaluation. */
  readonly recommendation_id: `sha256:${string}`;
}

/** Merchant families currently supplied by the structured P0 catalogue. */
export const UNIFIED_MERCHANT_IDS = Object.freeze([
  SYNTHETIC_MERCHANT_ID,
  "merchant.seveneleven",
  "merchant.aeon-group",
  "merchant.amazon-jp",
  "merchant.biccamera",
  "merchant.familymart",
  "merchant.itoyokado",
  "merchant.lawson",
  "merchant.matsukiyo",
  "merchant.mcdonalds",
  "merchant.newdays",
  "merchant.rakuten-market",
  "merchant.starbucks",
  "merchant.welcia",
  "merchant.yahoo-shopping",
  "merchant.yodobashi",
] as const);

export type UnifiedMerchantId = (typeof UNIFIED_MERCHANT_IDS)[number];
export type UnifiedBranchId =
  | typeof SYNTHETIC_BRANCH_ID
  | `location.${string}.representative`;

export function representativeBranchId(
  merchantId: UnifiedMerchantId,
): UnifiedBranchId {
  return merchantId === SYNTHETIC_MERCHANT_ID
    ? SYNTHETIC_BRANCH_ID
    : (`location.${merchantId.slice("merchant.".length)}.representative` as const);
}

/** Browser-safe, host-owned input for `/api/recommendations`. */
export interface UnifiedRecommendationInput {
  readonly merchant_id: UnifiedMerchantId;
  readonly branch_id: UnifiedBranchId;
  readonly amount_jpy: number;
  readonly tax_exclusive_amount_jpy: number;
  readonly nanaco_balance_jpy: number;
  readonly nanaco_credit_charge_balance_jpy: number;
  readonly charge_amount_jpy: number;
  readonly seven_card_plus_owned: boolean;
  readonly nanaco_credit_charge_preregistered: boolean;
  readonly effective_at: string;
  readonly owned_instruments: readonly ManualInstrument[];
  readonly selected_p0_products: readonly P0ProductFamilyId[];
  readonly stored_value_use: StoredValueUse;
  readonly stored_value_usage?: StoredValueUsage;
  readonly stored_value_value_jpy_per_unit?: string;
  readonly facts: readonly ManualFactInput[];
  readonly caps: readonly ManualCapInput[];
}

const RECOMMENDATION_ID_PATTERN = /^sha256:[0-9a-f]{64}$/u;

export function isCanonicalRecommendationId(
  value: unknown,
): value is `sha256:${string}` {
  return (
    typeof value === "string" &&
    value.length <= 80 &&
    RECOMMENDATION_ID_PATTERN.test(value)
  );
}

const TOP_LEVEL_MANUAL_KEYS = new Set([
  "merchant_id",
  "branch_id",
  "amount_jpy",
  "owned_instruments",
  "stored_value_use",
  "stored_value_usage",
  "stored_value_value_jpy_per_unit",
  "facts",
  "caps",
]);
const TOP_LEVEL_CORRECTION_KEYS = new Set([
  "category",
  "note_code",
  "recommendation_id",
]);
const TOP_LEVEL_EXPERIMENTAL_CORRECTION_KEYS = new Set([
  "publication_id",
  "category",
]);
const TOP_LEVEL_IMPLEMENTATION_FACT_CORRECTION_KEYS = new Set([
  "fact_key",
  "category",
]);
const TOP_LEVEL_EXPERIMENTAL_RECOMMENDATION_KEYS = new Set([
  "selection_id",
  "amount_jpy",
  "tax_exclusive_amount_jpy",
  "nanaco_balance_jpy",
  "effective_at",
]);
const TOP_LEVEL_NANACO_CREDIT_CHARGE_RECOMMENDATION_KEYS = new Set([
  "selection_id",
  "charge_amount_jpy",
  "nanaco_balance_jpy",
  "seven_card_plus_owned",
  "nanaco_credit_charge_preregistered",
  "effective_at",
]);
/**
 * Route inputs are deliberately flat and boring. They describe the user's
 * state and transaction only; rule, evidence, source, and applied-claim
 * material remains host-owned and is never admitted by this parser.
 */
const TOP_LEVEL_UNIFIED_RECOMMENDATION_KEYS = new Set([
  "merchant_id",
  "branch_id",
  "amount_jpy",
  "tax_exclusive_amount_jpy",
  "nanaco_balance_jpy",
  "nanaco_credit_charge_balance_jpy",
  "charge_amount_jpy",
  "seven_card_plus_owned",
  "nanaco_credit_charge_preregistered",
  "effective_at",
  "owned_instruments",
  "selected_p0_products",
  "stored_value_use",
  "stored_value_usage",
  "stored_value_value_jpy_per_unit",
  "facts",
  "caps",
]);
const FORBIDDEN_KEY_PARTS = [
  "rule",
  "assurance",
  "evidence",
  "plan",
  "source",
  "url",
  "authorization",
  "authorisation",
  "token",
  "credential",
  "password",
  "secret",
  "cookie",
  "session",
  "port",
  "canonical",
  "replay",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function safeText(value: unknown, maxLength: number): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength
  )
    return false;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x1f || codePoint === 0x7f) return false;
  }
  return true;
}

const EMAIL_PATTERN = /[^\s@]+@[^\s@]+\.[^\s@]+/u;

function assertAdmittedInput(value: unknown): void {
  try {
    assertAdmitted(value);
  } catch {
    // The shared boundary emits only stable, redacted security issues.  The
    // browser contract intentionally reduces all of them to one generic code.
    throw new InputContractError("prohibited_data");
  }
}

function safeManualFactValue(value: unknown): value is string {
  if (!safeText(value, MAX_TEXT_LENGTH)) return false;
  if (EMAIL_PATTERN.test(value))
    throw new InputContractError("prohibited_data");
  return true;
}

function isForbiddenKey(key: string): boolean {
  const normalized = key.replace(/[^a-z0-9]/giu, "").toLocaleLowerCase("en-US");
  return FORBIDDEN_KEY_PARTS.some((part) => normalized.includes(part));
}

function scanForbiddenInput(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1)
      scanForbiddenInput(value[index], `${path}[${index}]`);
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (isForbiddenKey(key)) throw new InputContractError("forbidden_field");
    scanForbiddenInput(child, `${path}.${key}`);
  }
}

/** Reject suspicious keys at every depth before interpreting any input. */
export function assertNoForbiddenInput(value: unknown, path = "$"): void {
  assertAdmittedInput(value);
  scanForbiddenInput(value, path);
}

export class InputContractError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "InputContractError";
    this.code = code;
  }
}

function assertExactKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new InputContractError("unknown_field");
  }
}

function parseFacts(value: unknown): readonly ManualFactInput[] {
  if (!Array.isArray(value) || value.length > 12)
    throw new InputContractError("facts_invalid");
  const output: ManualFactInput[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!isPlainRecord(item)) throw new InputContractError("fact_invalid");
    assertExactKeys(item, new Set(["key", "status", "value"]));
    if (!safeText(item.key, 48) || !/^[a-z][a-z0-9_.-]*$/u.test(item.key))
      throw new InputContractError("fact_key_invalid");
    if (seen.has(item.key)) throw new InputContractError("fact_duplicate");
    seen.add(item.key);
    if (item.status !== "known" && item.status !== "unknown")
      throw new InputContractError("fact_status_invalid");
    if (item.status === "known" && !safeManualFactValue(item.value))
      throw new InputContractError("fact_value_invalid");
    output.push(
      Object.freeze({
        key: item.key as string,
        status: item.status as "known" | "unknown",
        ...(item.status === "known" ? { value: item.value as string } : {}),
      }),
    );
  }
  output.sort((left, right) =>
    left.key < right.key ? -1 : left.key > right.key ? 1 : 0,
  );
  return Object.freeze(output);
}

function parseCaps(value: unknown): readonly ManualCapInput[] {
  if (!Array.isArray(value) || value.length > 12)
    throw new InputContractError("caps_invalid");
  const output: ManualCapInput[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!isPlainRecord(item)) throw new InputContractError("cap_invalid");
    assertExactKeys(item, new Set(["key", "status", "spend_jpy"]));
    if (!safeText(item.key, 48) || !/^[a-z][a-z0-9_.-]*$/u.test(item.key))
      throw new InputContractError("cap_key_invalid");
    if (seen.has(item.key)) throw new InputContractError("cap_duplicate");
    seen.add(item.key);
    if (item.status !== "known" && item.status !== "unknown")
      throw new InputContractError("cap_status_invalid");
    if (
      item.status === "known" &&
      (!Number.isSafeInteger(item.spend_jpy) ||
        (item.spend_jpy as number) < 0 ||
        (item.spend_jpy as number) > 10_000_000)
    )
      throw new InputContractError("cap_value_invalid");
    output.push(
      Object.freeze({
        key: item.key as string,
        status: item.status as "known" | "unknown",
        ...(item.status === "known"
          ? { spend_jpy: item.spend_jpy as number }
          : {}),
      }),
    );
  }
  output.sort((left, right) =>
    left.key < right.key ? -1 : left.key > right.key ? 1 : 0,
  );
  return Object.freeze(output);
}

/**
 * Parse the custom valuation without going through binary floating point.
 * The returned representation is the canonical decimal used by the engine:
 * no leading integer zeroes, no trailing fractional zeroes, and 0 < value <=
 * 1.  This also makes request ids stable for equivalent user input such as
 * `0.7500` and `0.75`.
 */
function canonicalPositiveValuation(value: unknown): string {
  if (!safeText(value, 64) || !/^\d+(?:\.\d+)?$/u.test(value))
    throw new InputContractError("stored_value_valuation_invalid");
  const [integerPart, fractionPart = ""] = value.split(".");
  const normalizedInteger = integerPart.replace(/^0+(?=\d)/u, "");
  if (normalizedInteger !== "0" && normalizedInteger !== "1")
    throw new InputContractError("stored_value_valuation_invalid");
  if (normalizedInteger === "1" && /[1-9]/u.test(fractionPart))
    throw new InputContractError("stored_value_valuation_invalid");
  const normalizedFraction = fractionPart.replace(/0+$/u, "");
  const normalized = normalizedFraction
    ? `${normalizedInteger}.${normalizedFraction}`
    : normalizedInteger;
  if (normalized === "0")
    throw new InputContractError("stored_value_valuation_invalid");
  return normalized;
}

export function parseManualAlphaState(value: unknown): ManualAlphaState {
  assertNoForbiddenInput(value);
  if (!isPlainRecord(value)) throw new InputContractError("body_invalid");
  assertExactKeys(value, TOP_LEVEL_MANUAL_KEYS);
  if (value.merchant_id !== SYNTHETIC_MERCHANT_ID)
    throw new InputContractError("merchant_id_invalid");
  if (value.branch_id !== SYNTHETIC_BRANCH_ID)
    throw new InputContractError("branch_id_invalid");
  if (
    !Number.isSafeInteger(value.amount_jpy) ||
    (value.amount_jpy as number) < 1 ||
    (value.amount_jpy as number) > 1_000_000
  )
    throw new InputContractError("amount_invalid");
  if (
    !Array.isArray(value.owned_instruments) ||
    value.owned_instruments.length > 8
  )
    throw new InputContractError("owned_instruments_invalid");
  const owned = [...new Set(value.owned_instruments)];
  if (
    owned.length !== value.owned_instruments.length ||
    owned.some(
      (item) => !(MANUAL_INSTRUMENTS as readonly string[]).includes(item),
    )
  )
    throw new InputContractError("owned_instruments_invalid");
  // The synthetic fixture has only a card purchase plan.  QR-only, stored-
  // only, and empty selections must terminate before any evaluator input is
  // assembled, regardless of the other optional answers.
  if (!owned.includes("synthetic_card"))
    throw new InputContractError("no_supported_owned_instrument");
  if (
    !(STORED_VALUE_USE as readonly string[]).includes(
      value.stored_value_use as string,
    )
  )
    throw new InputContractError("stored_value_use_invalid");
  let valuation: string | undefined;
  if (value.stored_value_value_jpy_per_unit !== undefined)
    valuation = canonicalPositiveValuation(
      value.stored_value_value_jpy_per_unit,
    );
  const usage = value.stored_value_usage as StoredValueUsage | undefined;
  if (
    usage !== undefined &&
    !(STORED_VALUE_USAGE as readonly string[]).includes(usage)
  )
    throw new InputContractError("stored_value_usage_invalid");
  if (value.stored_value_use === "yes" && usage === undefined)
    throw new InputContractError("stored_value_usage_required");
  if (value.stored_value_use !== "yes" && usage !== undefined)
    throw new InputContractError("stored_value_usage_without_asset");
  if (usage === "custom" && valuation === undefined)
    throw new InputContractError("stored_value_custom_value_required");
  if (usage !== "custom" && valuation !== undefined)
    throw new InputContractError("stored_value_custom_value_unexpected");
  if (
    value.stored_value_use === "yes" &&
    !owned.includes("synthetic_stored_value")
  )
    throw new InputContractError("stored_value_asset_not_owned");
  const amount = value.amount_jpy as number;
  const ownedInstruments = owned.sort() as ManualInstrument[];
  const storedValueUse = value.stored_value_use as StoredValueUse;
  return Object.freeze({
    merchant_id: SYNTHETIC_MERCHANT_ID,
    branch_id: SYNTHETIC_BRANCH_ID,
    amount_jpy: amount,
    owned_instruments: Object.freeze(
      ownedInstruments,
    ) as readonly ManualInstrument[],
    stored_value_use: storedValueUse,
    ...(usage !== undefined ? { stored_value_usage: usage } : {}),
    ...(valuation !== undefined
      ? { stored_value_value_jpy_per_unit: valuation }
      : {}),
    facts: parseFacts(value.facts),
    caps: parseCaps(value.caps),
  });
}

export function parseCorrectionDraft(value: unknown): CorrectionDraftInput {
  assertNoForbiddenInput(value);
  if (!isPlainRecord(value)) throw new InputContractError("body_invalid");
  assertExactKeys(value, TOP_LEVEL_CORRECTION_KEYS);
  if (
    !(CORRECTION_CATEGORIES as readonly string[]).includes(
      value.category as string,
    )
  )
    throw new InputContractError("correction_category_invalid");
  if (
    !(CORRECTION_NOTE_CODES as readonly string[]).includes(
      value.note_code as string,
    )
  )
    throw new InputContractError("correction_note_code_invalid");
  if (
    !safeText(value.recommendation_id, 80) ||
    !isCanonicalRecommendationId(value.recommendation_id)
  )
    throw new InputContractError("correction_id_invalid");
  return Object.freeze({
    category: value.category as CorrectionCategory,
    note_code: value.note_code as CorrectionNoteCode,
    recommendation_id: value.recommendation_id as `sha256:${string}`,
  });
}

/** Parse the exact host-issued experimental publication correction DTO. */
export function parseExperimentalCorrection(
  value: unknown,
): ExperimentalCorrectionInput {
  assertNoForbiddenInput(value);
  if (!isPlainRecord(value)) throw new InputContractError("body_invalid");
  assertExactKeys(value, TOP_LEVEL_EXPERIMENTAL_CORRECTION_KEYS);
  if (
    !safeText(value.publication_id, 128) ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value.publication_id)
  )
    throw new InputContractError("publication_id_invalid");
  if (
    !(EXPERIMENTAL_CORRECTION_CATEGORIES as readonly string[]).includes(
      value.category as string,
    )
  )
    throw new InputContractError("experimental_correction_category_invalid");
  return Object.freeze({
    publication_id: value.publication_id,
    category: value.category as ExperimentalCorrectionCategory,
  });
}

/** Parse the one bounded real-data recommendation request. */
export function parseExperimentalRecommendation(
  value: unknown,
): ExperimentalRecommendationInput {
  assertNoForbiddenInput(value);
  if (!isPlainRecord(value)) throw new InputContractError("body_invalid");
  assertExactKeys(value, TOP_LEVEL_EXPERIMENTAL_RECOMMENDATION_KEYS);
  if (
    value.selection_id !== EXPERIMENTAL_NANACO_SELECTION_ID &&
    value.selection_id !== "nanaco"
  )
    throw new InputContractError("experimental_selection_invalid");
  if (
    !Number.isSafeInteger(value.amount_jpy) ||
    (value.amount_jpy as number) < 1 ||
    (value.amount_jpy as number) > 1_000_000
  )
    throw new InputContractError("experimental_amount_invalid");
  if (
    !Number.isSafeInteger(value.tax_exclusive_amount_jpy) ||
    (value.tax_exclusive_amount_jpy as number) < 0 ||
    (value.tax_exclusive_amount_jpy as number) > (value.amount_jpy as number)
  )
    throw new InputContractError("experimental_tax_exclusive_amount_invalid");
  if (
    !Number.isSafeInteger(value.nanaco_balance_jpy) ||
    (value.nanaco_balance_jpy as number) < (value.amount_jpy as number) ||
    (value.nanaco_balance_jpy as number) > 10_000_000
  )
    throw new InputContractError("experimental_balance_invalid");
  if (!isCanonicalProvisionalDateTime(value.effective_at))
    throw new InputContractError("experimental_effective_at_invalid");
  return Object.freeze({
    selection_id: value.selection_id as string,
    amount_jpy: value.amount_jpy as number,
    tax_exclusive_amount_jpy: value.tax_exclusive_amount_jpy as number,
    nanaco_balance_jpy: value.nanaco_balance_jpy as number,
    effective_at: value.effective_at,
  });
}

/** Parse the exact host-owned credit-charge request DTO. */
export function parseNanacoCreditChargeRecommendation(
  value: unknown,
): NanacoCreditChargeRecommendationInput {
  assertNoForbiddenInput(value);
  if (!isPlainRecord(value)) throw new InputContractError("body_invalid");
  assertExactKeys(value, TOP_LEVEL_NANACO_CREDIT_CHARGE_RECOMMENDATION_KEYS);
  if (
    value.selection_id !== EXPERIMENTAL_NANACO_CREDIT_CHARGE_SELECTION_ID &&
    value.selection_id !== "nanaco-credit-charge"
  )
    throw new InputContractError("nanaco_credit_charge_selection_invalid");
  if (
    !Number.isSafeInteger(value.charge_amount_jpy) ||
    (value.charge_amount_jpy as number) < 0 ||
    (value.charge_amount_jpy as number) > 30_000
  )
    throw new InputContractError("nanaco_credit_charge_amount_invalid");
  if (
    !Number.isSafeInteger(value.nanaco_balance_jpy) ||
    (value.nanaco_balance_jpy as number) < 0 ||
    (value.nanaco_balance_jpy as number) > 50_000
  )
    throw new InputContractError("nanaco_credit_charge_balance_invalid");
  if (typeof value.seven_card_plus_owned !== "boolean")
    throw new InputContractError("nanaco_credit_charge_ownership_invalid");
  if (typeof value.nanaco_credit_charge_preregistered !== "boolean")
    throw new InputContractError(
      "nanaco_credit_charge_preregistration_invalid",
    );
  if (!isCanonicalProvisionalDateTime(value.effective_at))
    throw new InputContractError("nanaco_credit_charge_effective_at_invalid");
  return Object.freeze({
    selection_id: value.selection_id as string,
    charge_amount_jpy: value.charge_amount_jpy as number,
    nanaco_balance_jpy: value.nanaco_balance_jpy as number,
    seven_card_plus_owned: value.seven_card_plus_owned as boolean,
    nanaco_credit_charge_preregistered:
      value.nanaco_credit_charge_preregistered as boolean,
    effective_at: value.effective_at as string,
  });
}

/**
 * Parse the one unified comparison request. Defaults only fill in route
 * controls omitted by a caller that is interested in the synthetic lane;
 * they never select rules or evidence. Each nested collection is still
 * parsed by the exact synthetic-state parser, so the admitted shape remains
 * as strict as the legacy endpoint.
 */
export function parseUnifiedRecommendation(
  value: unknown,
): UnifiedRecommendationInput {
  assertNoForbiddenInput(value);
  if (!isPlainRecord(value)) throw new InputContractError("body_invalid");
  assertExactKeys(value, TOP_LEVEL_UNIFIED_RECOMMENDATION_KEYS);

  const merchant =
    value.merchant_id === undefined ? SYNTHETIC_MERCHANT_ID : value.merchant_id;
  if (!(UNIFIED_MERCHANT_IDS as readonly unknown[]).includes(merchant))
    throw new InputContractError("merchant_id_invalid");
  const expectedBranch = representativeBranchId(merchant as UnifiedMerchantId);
  const branch =
    value.branch_id === undefined ? expectedBranch : value.branch_id;
  if (branch !== expectedBranch)
    throw new InputContractError("branch_id_invalid");

  if (
    !Number.isSafeInteger(value.amount_jpy) ||
    (value.amount_jpy as number) < 1 ||
    (value.amount_jpy as number) > 1_000_000
  )
    throw new InputContractError("amount_invalid");
  const amount = value.amount_jpy as number;

  const taxExclusive =
    value.tax_exclusive_amount_jpy === undefined
      ? amount
      : value.tax_exclusive_amount_jpy;
  if (
    !Number.isSafeInteger(taxExclusive) ||
    (taxExclusive as number) < 0 ||
    (taxExclusive as number) > 1_000_000
  )
    throw new InputContractError("tax_exclusive_amount_invalid");

  const nanacoBalance =
    value.nanaco_balance_jpy === undefined ? amount : value.nanaco_balance_jpy;
  if (
    !Number.isSafeInteger(nanacoBalance) ||
    (nanacoBalance as number) < 0 ||
    (nanacoBalance as number) > 10_000_000
  )
    throw new InputContractError("nanaco_balance_invalid");

  const nanacoCreditChargeBalance =
    value.nanaco_credit_charge_balance_jpy === undefined
      ? 0
      : value.nanaco_credit_charge_balance_jpy;
  if (
    !Number.isSafeInteger(nanacoCreditChargeBalance) ||
    (nanacoCreditChargeBalance as number) < 0 ||
    (nanacoCreditChargeBalance as number) > 1_000_000
  )
    throw new InputContractError("nanaco_credit_charge_balance_invalid");

  const chargeAmount =
    value.charge_amount_jpy === undefined ? 5_000 : value.charge_amount_jpy;
  if (
    !Number.isSafeInteger(chargeAmount) ||
    (chargeAmount as number) < 0 ||
    (chargeAmount as number) > 1_000_000
  )
    throw new InputContractError("charge_amount_invalid");

  const owned =
    value.owned_instruments === undefined
      ? ["synthetic_card"]
      : value.owned_instruments;
  const storedValueUse =
    value.stored_value_use === undefined ? "unknown" : value.stored_value_use;
  const syntheticState = parseManualAlphaState({
    merchant_id: SYNTHETIC_MERCHANT_ID,
    branch_id: SYNTHETIC_BRANCH_ID,
    amount_jpy: amount,
    owned_instruments: owned,
    stored_value_use: storedValueUse,
    ...(value.stored_value_usage === undefined
      ? {}
      : { stored_value_usage: value.stored_value_usage }),
    ...(value.stored_value_value_jpy_per_unit === undefined
      ? {}
      : {
          stored_value_value_jpy_per_unit:
            value.stored_value_value_jpy_per_unit,
        }),
    facts: value.facts === undefined ? [] : value.facts,
    caps: value.caps === undefined ? [] : value.caps,
  });

  const selectedRaw =
    value.selected_p0_products === undefined ? [] : value.selected_p0_products;
  if (
    !Array.isArray(selectedRaw) ||
    selectedRaw.length > P0_PRODUCT_FAMILY_IDS.length ||
    !selectedRaw.every(
      (item) =>
        typeof item === "string" &&
        (P0_PRODUCT_FAMILY_IDS as readonly string[]).includes(item),
    )
  )
    throw new InputContractError("selected_p0_products_invalid");
  const selectedProducts = [...new Set(selectedRaw)] as P0ProductFamilyId[];
  if (selectedProducts.length !== selectedRaw.length)
    throw new InputContractError("selected_p0_products_invalid");
  if (
    selectedProducts.some((item) => item.startsWith("card.")) &&
    !syntheticState.owned_instruments.includes("synthetic_card")
  )
    throw new InputContractError("selected_p0_products_invalid");
  if (
    selectedProducts.some((item) => item.startsWith("wallet.")) &&
    !syntheticState.owned_instruments.includes("synthetic_qr_wallet")
  )
    throw new InputContractError("selected_p0_products_invalid");
  if (
    value.selected_p0_products !== undefined &&
    syntheticState.owned_instruments.includes("synthetic_card") &&
    !selectedProducts.some((item) => item.startsWith("card."))
  )
    throw new InputContractError("selected_p0_card_required");
  if (
    value.selected_p0_products !== undefined &&
    syntheticState.owned_instruments.includes("synthetic_qr_wallet") &&
    !selectedProducts.some((item) => item.startsWith("wallet."))
  )
    throw new InputContractError("selected_p0_mobile_pay_required");
  selectedProducts.sort();

  const ownedFlag =
    value.seven_card_plus_owned === undefined
      ? false
      : value.seven_card_plus_owned;
  if (typeof ownedFlag !== "boolean")
    throw new InputContractError("seven_card_plus_owned_invalid");
  const preregistered =
    value.nanaco_credit_charge_preregistered === undefined
      ? false
      : value.nanaco_credit_charge_preregistered;
  if (typeof preregistered !== "boolean")
    throw new InputContractError("nanaco_credit_charge_preregistered_invalid");

  const effectiveAt =
    value.effective_at === undefined
      ? "2026-08-17T12:30:00+09:00"
      : value.effective_at;
  if (!isCanonicalProvisionalDateTime(effectiveAt))
    throw new InputContractError("effective_at_invalid");

  return Object.freeze({
    merchant_id: merchant as UnifiedMerchantId,
    branch_id: branch as UnifiedBranchId,
    amount_jpy: amount,
    tax_exclusive_amount_jpy: taxExclusive as number,
    nanaco_balance_jpy: nanacoBalance as number,
    nanaco_credit_charge_balance_jpy: nanacoCreditChargeBalance as number,
    charge_amount_jpy: chargeAmount as number,
    seven_card_plus_owned: ownedFlag,
    nanaco_credit_charge_preregistered: preregistered,
    effective_at: effectiveAt as string,
    owned_instruments: syntheticState.owned_instruments,
    selected_p0_products: Object.freeze(selectedProducts),
    stored_value_use: syntheticState.stored_value_use,
    ...(syntheticState.stored_value_usage === undefined
      ? {}
      : { stored_value_usage: syntheticState.stored_value_usage }),
    ...(syntheticState.stored_value_value_jpy_per_unit === undefined
      ? {}
      : {
          stored_value_value_jpy_per_unit:
            syntheticState.stored_value_value_jpy_per_unit,
        }),
    facts: syntheticState.facts,
    caps: syntheticState.caps,
  });
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/** Parse the exact opaque implementation-fact correction DTO. */
export function parseImplementationFactCorrection(
  value: unknown,
): ImplementationFactCorrectionInput {
  assertNoForbiddenInput(value);
  if (!isPlainRecord(value)) throw new InputContractError("body_invalid");
  assertExactKeys(value, TOP_LEVEL_IMPLEMENTATION_FACT_CORRECTION_KEYS);
  if (
    typeof value.fact_key !== "string" ||
    value.fact_key.length > 80 ||
    !UUID_PATTERN.test(value.fact_key)
  )
    throw new InputContractError("fact_key_invalid");
  if (
    !(IMPLEMENTATION_FACT_CORRECTION_CATEGORIES as readonly string[]).includes(
      value.category as string,
    )
  )
    throw new InputContractError(
      "implementation_fact_correction_category_invalid",
    );
  return Object.freeze({
    fact_key: value.fact_key,
    category: value.category as ImplementationFactCorrectionCategory,
  });
}
