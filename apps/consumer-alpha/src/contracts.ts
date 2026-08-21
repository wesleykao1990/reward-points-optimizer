import { assertAdmitted } from "@jro/recommendation-api";

/**
 * The only state that may cross from the browser into the M6 host.
 *
 * This is deliberately not a recommendation request.  Rules, evidence,
 * plans, source URLs, and authorization material are server-owned inputs.
 */

export const MAX_EVALUATE_BODY_BYTES = 32 * 1024;
export const MAX_CORRECTION_BODY_BYTES = 12 * 1024;
export const MAX_TEXT_LENGTH = 160;

/** Canonical ids are host-owned; aliases never cross the browser boundary. */
export const SYNTHETIC_MERCHANT_ID = "merchant.synthetic" as const;
export const SYNTHETIC_BRANCH_ID = "location.synthetic" as const;

export const MANUAL_INSTRUMENTS = [
  "synthetic_card",
  "synthetic_qr_wallet",
  "synthetic_stored_value",
] as const;
export type ManualInstrument = (typeof MANUAL_INSTRUMENTS)[number];

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
