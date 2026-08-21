import {
  assertAdmitted,
  canonicalSnapshot,
  M5SecurityError,
} from "@jro/recommendation-api";

/**
 * The alpha correction contract is deliberately a small, session-only
 * envelope.  It reports a bounded category against a recommendation hash; it
 * is not a replacement for an evidence or rule-correction workflow.
 */
export const CORRECTION_REPORT_VERSION = "1" as const;

export const CORRECTION_CATEGORIES = Object.freeze([
  "wrong_merchant",
  "wrong_branch",
  "wrong_plan",
  "missing_reward",
  "unexpected_reward",
  "wrong_reward_amount",
] as const);

export type CorrectionCategory = (typeof CORRECTION_CATEGORIES)[number];

export const CORRECTION_NOTE_CODES = Object.freeze([
  "merchant_not_recognized",
  "branch_not_recognized",
  "plan_not_available",
  "reward_not_posted",
  "reward_reversed",
  "amount_disagrees",
] as const);

export type CorrectionNoteCode = (typeof CORRECTION_NOTE_CODES)[number];

export interface CorrectionReportInput {
  readonly version: typeof CORRECTION_REPORT_VERSION;
  readonly category: CorrectionCategory;
  readonly recommendation_hash: `sha256:${string}`;
  readonly merchant_id: string;
  readonly branch_id: string;
  readonly eligible_plan_id?: string;
  readonly source_ids?: readonly string[];
  readonly note_code?: CorrectionNoteCode;
}

export interface CorrectionReport {
  readonly version: typeof CORRECTION_REPORT_VERSION;
  readonly correction_id: string;
  readonly correction_hash: `sha256:${string}`;
  readonly category: CorrectionCategory;
  readonly recommendation_hash: `sha256:${string}`;
  readonly merchant_id: string;
  readonly branch_id: string;
  readonly eligible_plan_id?: string;
  readonly source_ids: readonly string[];
  readonly note_code?: CorrectionNoteCode;
  readonly state: "session_only";
  readonly submission_status: "not_submitted";
}

export type CorrectionDenialCode =
  | "invalid_schema"
  | "unsupported_version"
  | "unknown_field"
  | "prohibited_data"
  | "invalid_category"
  | "invalid_recommendation_hash"
  | "invalid_identifier"
  | "invalid_source_ids"
  | "duplicate_source_id"
  | "invalid_note_code";

export interface CorrectionDenial {
  readonly ok: false;
  readonly denial: Readonly<{
    readonly code: CorrectionDenialCode;
  }>;
}

export interface CorrectionAccepted {
  readonly ok: true;
  readonly report: CorrectionReport;
}

export type CorrectionAdmissionResult = CorrectionAccepted | CorrectionDenial;

export class CorrectionAdmissionError extends Error {
  readonly code: CorrectionDenialCode;

  constructor(code: CorrectionDenialCode) {
    super(`CORRECTION_ADMISSION_DENIED:${code}`);
    this.name = "CorrectionAdmissionError";
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

const ALLOWED_FIELDS = new Set([
  "version",
  "category",
  "recommendation_hash",
  "merchant_id",
  "branch_id",
  "eligible_plan_id",
  "source_ids",
  "note_code",
]);

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/u;
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const categorySet = new Set<string>(CORRECTION_CATEGORIES);
const noteCodeSet = new Set<string>(CORRECTION_NOTE_CODES);

function denial(code: CorrectionDenialCode): CorrectionDenial {
  return Object.freeze({
    ok: false as const,
    denial: Object.freeze({ code }),
  });
}

function readPlainRecord(
  value: unknown,
): Readonly<Record<string, unknown>> | null {
  if (value === null || typeof value !== "object") return null;
  let prototype: object | null;
  let keys: readonly PropertyKey[];
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    return null;
  }
  if (prototype !== Object.prototype && prototype !== null) return null;
  if (keys.some((key) => typeof key !== "string")) return null;
  const result: Record<string, unknown> = Object.create(null) as Record<
    string,
    unknown
  >;
  for (const propertyKey of keys) {
    if (typeof propertyKey !== "string") return null;
    const key = propertyKey;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
      return null;
    }
    result[key] = descriptor.value;
  }
  return result;
}

function isIdentifier(value: unknown): value is string {
  if (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value)) {
    return false;
  }
  // IDs are never URLs, email addresses, paths, or query-bearing values.
  return (
    !value.includes("@") &&
    !value.includes("/") &&
    !value.includes("\\") &&
    !value.includes("?") &&
    !value.includes("#") &&
    !value.includes("%")
  );
}

function isHash(value: unknown): value is `sha256:${string}` {
  return typeof value === "string" && HASH_PATTERN.test(value);
}

function ownKeysAllowed(record: Readonly<Record<string, unknown>>): boolean {
  return Object.keys(record).every((key) => ALLOWED_FIELDS.has(key));
}

function sourceIds(value: unknown):
  | { readonly kind: "ok"; readonly values: readonly string[] }
  | {
      readonly kind: "invalid";
    }
  | { readonly kind: "duplicate" } {
  if (value === undefined) return { kind: "ok", values: [] };
  if (!Array.isArray(value) || value.length > 8) return { kind: "invalid" };
  let ownKeys: readonly PropertyKey[];
  try {
    ownKeys = Reflect.ownKeys(value);
  } catch {
    return { kind: "invalid" };
  }
  if (
    ownKeys.some(
      (key) =>
        typeof key !== "string" ||
        (key !== "length" &&
          (!/^\d+$/u.test(key) ||
            Number(key) < 0 ||
            Number(key) >= value.length)),
    )
  ) {
    return { kind: "invalid" };
  }
  const values: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!isIdentifier(item) || item.length > 64) return { kind: "invalid" };
    if (seen.has(item)) return { kind: "duplicate" };
    seen.add(item);
    values.push(item);
  }
  values.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  return { kind: "ok", values: Object.freeze(values) };
}

function freezeDeep<T>(value: T, active = new Set<object>()): T {
  if (value === null || typeof value !== "object") return value;
  if (active.has(value)) throw new CorrectionAdmissionError("invalid_schema");
  active.add(value);
  if (Array.isArray(value)) {
    for (const item of value) freezeDeep(item, active);
  } else {
    for (const item of Object.values(value as Record<string, unknown>)) {
      freezeDeep(item, active);
    }
  }
  active.delete(value);
  return Object.freeze(value);
}

function validateInput(
  input: unknown,
):
  | { readonly ok: true; readonly value: CorrectionReportInput }
  | { readonly ok: false; readonly code: CorrectionDenialCode } {
  // This is deliberately the first operation.  Unknown fields are still
  // scanned for prohibited credentials before strict-schema rejection.
  try {
    assertAdmitted(input);
  } catch (error) {
    if (error instanceof M5SecurityError) {
      return { ok: false, code: "prohibited_data" };
    }
    return { ok: false, code: "invalid_schema" };
  }

  const record = readPlainRecord(input);
  if (!record || !ownKeysAllowed(record)) {
    return { ok: false, code: record ? "unknown_field" : "invalid_schema" };
  }
  if (record.version !== CORRECTION_REPORT_VERSION) {
    return {
      ok: false,
      code:
        record.version === undefined ? "invalid_schema" : "unsupported_version",
    };
  }
  if (
    typeof record.category !== "string" ||
    !categorySet.has(record.category)
  ) {
    return { ok: false, code: "invalid_category" };
  }
  if (!isHash(record.recommendation_hash)) {
    return { ok: false, code: "invalid_recommendation_hash" };
  }
  if (!isIdentifier(record.merchant_id) || !isIdentifier(record.branch_id)) {
    return { ok: false, code: "invalid_identifier" };
  }
  if (
    record.eligible_plan_id !== undefined &&
    !isIdentifier(record.eligible_plan_id)
  ) {
    return { ok: false, code: "invalid_identifier" };
  }
  const ids = sourceIds(record.source_ids);
  if (ids.kind === "invalid") return { ok: false, code: "invalid_source_ids" };
  if (ids.kind === "duplicate")
    return { ok: false, code: "duplicate_source_id" };
  if (
    record.note_code !== undefined &&
    (typeof record.note_code !== "string" || !noteCodeSet.has(record.note_code))
  ) {
    return { ok: false, code: "invalid_note_code" };
  }
  const value: CorrectionReportInput = {
    version: CORRECTION_REPORT_VERSION,
    category: record.category as CorrectionCategory,
    recommendation_hash: record.recommendation_hash,
    merchant_id: record.merchant_id,
    branch_id: record.branch_id,
    ...(record.eligible_plan_id === undefined
      ? {}
      : { eligible_plan_id: record.eligible_plan_id }),
    source_ids: ids.values,
    ...(record.note_code === undefined
      ? {}
      : { note_code: record.note_code as CorrectionNoteCode }),
  };
  return { ok: true, value };
}

/**
 * Validate and build a deterministic, redacted correction envelope.  The
 * return value contains no recommendation payload and has no persistence or
 * submission capability.
 */
export function createCorrectionReport(
  input: unknown,
): CorrectionAdmissionResult {
  const validation = validateInput(input);
  if (!validation.ok) return denial(validation.code);
  try {
    const body = canonicalSnapshot(validation.value);
    const digest = body.sha256.slice("sha256:".length);
    const report = {
      version: CORRECTION_REPORT_VERSION,
      correction_id: `correction_${digest}`,
      correction_hash: body.sha256,
      category: body.value.category,
      recommendation_hash: body.value.recommendation_hash,
      merchant_id: body.value.merchant_id,
      branch_id: body.value.branch_id,
      ...(body.value.eligible_plan_id === undefined
        ? {}
        : { eligible_plan_id: body.value.eligible_plan_id }),
      source_ids: body.value.source_ids ?? [],
      ...(body.value.note_code === undefined
        ? {}
        : { note_code: body.value.note_code }),
      state: "session_only" as const,
      submission_status: "not_submitted" as const,
    } satisfies CorrectionReport;
    return Object.freeze({ ok: true as const, report: freezeDeep(report) });
  } catch (error) {
    if (error instanceof M5SecurityError) return denial("prohibited_data");
    return denial("invalid_schema");
  }
}

export const admitCorrection = createCorrectionReport;
export const buildCorrectionReport = createCorrectionReport;

/** Throwing adapter for trusted host code that prefers exception handling. */
export function assertCorrectionReport(input: unknown): CorrectionReport {
  const result = createCorrectionReport(input);
  if (!result.ok) throw new CorrectionAdmissionError(result.denial.code);
  return result.report;
}
