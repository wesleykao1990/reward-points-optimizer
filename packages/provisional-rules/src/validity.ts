/**
 * Canonical economic-validity helpers for provisional candidates.
 *
 * A validity value is deliberately stricter than `Date.parse`: date-only
 * claims and browser-friendly date strings are not rule validity.  The rule
 * contract uses an ISO date-time with an explicit UTC offset and half-open
 * `[valid_from, valid_to)` semantics.
 */

export const PROVISIONAL_VALIDITY_STATUSES = Object.freeze([
  "active",
  "scheduled",
  "expired",
  "unknown",
] as const);

export type ProvisionalValidityStatus =
  (typeof PROVISIONAL_VALIDITY_STATUSES)[number];

export type ProvisionalValidityUnknownReason =
  | "effective_at_missing"
  | "effective_at_invalid"
  | "validity_missing"
  | "valid_from_missing"
  | "valid_from_invalid"
  | "valid_to_invalid"
  | "interval_invalid";

export interface ProvisionalValidityClassification {
  readonly status: ProvisionalValidityStatus;
  readonly effective_at: string | null;
  readonly valid_from: string | null;
  readonly valid_to: string | null;
  readonly reason?: ProvisionalValidityUnknownReason;
}

/** ISO date-time accepted by RewardRule validity, excluding date-only claims. */
const ISO_DATE_TIME_PATTERN =
  /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:0\d|1\d|2[0-3]):[0-5]\d)$/u;

function daysInMonth(year: number, month: number): number {
  if (month === 2)
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function parseIsoDateTime(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    value.length > 64 ||
    !ISO_DATE_TIME_PATTERN.test(value)
  )
    return null;
  const parts = ISO_DATE_TIME_PATTERN.exec(value);
  if (!parts) return null;
  const year = Number(parts[1]);
  const month = Number(parts[2]);
  const day = Number(parts[3]);
  if (day > daysInMonth(year, month)) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? value : null;
}

function record(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return null;
  return value as Record<string, unknown>;
}

function unknown(
  effectiveAt: string | null,
  reason: ProvisionalValidityUnknownReason,
  validFrom: string | null = null,
  validTo: string | null = null,
): ProvisionalValidityClassification {
  return Object.freeze({
    status: "unknown" as const,
    effective_at: effectiveAt,
    valid_from: validFrom,
    valid_to: validTo,
    reason,
  });
}

/**
 * Classify one canonical rule validity rectangle at an explicit effective
 * instant.  No implicit wall-clock default is used; callers that need a
 * current view must supply the instant they are evaluating.
 */
export function classifyProvisionalValidity(
  validity: unknown,
  effectiveAt: unknown,
): ProvisionalValidityClassification {
  const effective = parseIsoDateTime(effectiveAt);
  if (effectiveAt === undefined || effectiveAt === null || effectiveAt === "")
    return unknown(null, "effective_at_missing");
  if (!effective) return unknown(null, "effective_at_invalid");

  const value = record(validity);
  if (!value) return unknown(effective, "validity_missing");
  if (!Object.hasOwn(value, "valid_from"))
    return unknown(effective, "valid_from_missing");
  const validFrom = parseIsoDateTime(value.valid_from);
  if (!validFrom) return unknown(effective, "valid_from_invalid");

  if (!Object.hasOwn(value, "valid_to"))
    return unknown(effective, "valid_to_invalid", validFrom);
  const validToValue = value.valid_to;
  const validTo = validToValue === null ? null : parseIsoDateTime(validToValue);
  if (validToValue !== null && !validTo)
    return unknown(effective, "valid_to_invalid", validFrom);

  const from = Date.parse(validFrom);
  const to = validTo === null ? Number.POSITIVE_INFINITY : Date.parse(validTo);
  if (!(from < to))
    return unknown(effective, "interval_invalid", validFrom, validTo);

  const at = Date.parse(effective);
  const status: ProvisionalValidityStatus =
    at < from ? "scheduled" : at >= to ? "expired" : "active";
  return Object.freeze({
    status,
    effective_at: effective,
    valid_from: validFrom,
    valid_to: validTo,
  });
}

/** Classify a rule-like value without accepting raw claim effective dates. */
export function classifyProvisionalRuleValidity(
  rule: unknown,
  effectiveAt: unknown,
): ProvisionalValidityClassification {
  const value = record(rule);
  return classifyProvisionalValidity(value?.validity, effectiveAt);
}

export function isActiveProvisionalValidity(
  validity: unknown,
  effectiveAt: unknown,
): boolean {
  return classifyProvisionalValidity(validity, effectiveAt).status === "active";
}

export function isActiveProvisionalRule(
  rule: unknown,
  effectiveAt: unknown,
): boolean {
  return classifyProvisionalRuleValidity(rule, effectiveAt).status === "active";
}

/** Exposed for adapters that need to validate an explicit current-view time. */
export function isCanonicalProvisionalDateTime(
  value: unknown,
): value is string {
  return parseIsoDateTime(value) !== null;
}

// Short aliases keep the boundary discoverable for callers which already use
// the terms `effective_at` and `active` in their own contracts.
export const classifyValidity = classifyProvisionalValidity;
export const classifyRuleValidity = classifyProvisionalRuleValidity;
export const isActiveValidity = isActiveProvisionalValidity;
