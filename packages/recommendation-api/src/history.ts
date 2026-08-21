import {
  assertAdmitted,
  type CanonicalSnapshot,
  canonicalSnapshot,
  isSha256,
} from "./security.js";

export type RetentionClass =
  | "session_only"
  | "30_days"
  | "90_days"
  | "user_selected";

export interface LegalHoldAuthorization {
  readonly kind: "m5_trusted_legal_hold";
  /** The retention class for which the host issued this capability. */
  readonly retention_class: Exclude<RetentionClass, "session_only">;
  readonly authorization_id: string;
  readonly issuer: string;
  readonly issued_at: string;
}

/**
 * A host-owned capability.  The input DTO is deliberately not accepted as an
 * authorization object: the only legal-hold authority is this separately
 * supplied port.  Implementations should bind the returned authorization to
 * their authenticated operator and policy store before returning it.
 */
export interface HistoryAuthorizationPort {
  readonly authorizeLegalHold: (request: {
    readonly retention_class: Exclude<RetentionClass, "session_only">;
    readonly requested_authorization_id: string | null;
  }) => LegalHoldAuthorization | null;
}

export interface RetentionDecision {
  readonly retention_class: RetentionClass;
  readonly persist: boolean;
  readonly created_at: string | null;
  readonly purge_after: string | null;
  readonly legal_hold: boolean;
  readonly legal_hold_authorization_id: string | null;
}

export interface RedactedResultSummary {
  readonly [key: string]:
    | string
    | number
    | boolean
    | readonly string[]
    | readonly number[]
    | readonly boolean[]
    | RedactedResultSummary
    | readonly RedactedResultSummary[];
}

export interface RedactedHistoryRecord {
  readonly history_id: string;
  readonly retention_class: Exclude<RetentionClass, "session_only">;
  readonly created_at: string;
  readonly purge_after: string | null;
  readonly legal_hold: boolean;
  readonly legal_hold_authorization_id: string | null;
  readonly request_sha256: `sha256:${string}`;
  readonly response_sha256: `sha256:${string}`;
  readonly result_summary: Readonly<RedactedResultSummary>;
}

export interface HistoryCreationResult {
  readonly persist: boolean;
  readonly retention_class: RetentionClass;
  readonly decision: RetentionDecision;
  readonly record: RedactedHistoryRecord | null;
}

export interface RedactedHistoryInput {
  readonly user_ref?: string;
  readonly user_id?: string;
  readonly retention_class?: string;
  readonly retention?: string;
  readonly retention_days?: number;
  readonly days?: number;
  readonly created_at?: string;
  readonly legal_hold?: unknown;
  readonly legal_hold_authorized?: boolean;
  readonly legal_hold_authorization_id?: string;
  readonly legal_hold_id?: string;
  readonly legal_hold_authorization?: unknown;
  readonly trusted_legal_hold_authorization?: unknown;
  readonly request?: unknown;
  readonly response?: unknown;
  readonly request_hash?: string;
  readonly response_hash?: string;
  readonly request_sha256?: string;
  readonly response_sha256?: string;
  readonly request_snapshot?: unknown;
  readonly response_snapshot?: unknown;
  readonly result_summary?: unknown;
  readonly result?: unknown;
  readonly history_id?: string;
  readonly [key: string]: unknown;
}

export class HistoryBoundaryError extends Error {
  readonly code = "m5_history_boundary_denied" as const;
  readonly reason: HistoryBlockerCode;

  constructor(reason: HistoryBlockerCode) {
    super(`M5_HISTORY_DENIED:${reason}`);
    this.name = "HistoryBoundaryError";
    this.reason = reason;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export type HistoryBlockerCode =
  | "retention_class_invalid"
  | "created_at_required"
  | "created_at_invalid"
  | "retention_days_invalid"
  | "legal_hold_unauthorized"
  | "legal_hold_id_invalid"
  | "legal_hold_proof_invalid"
  | "hash_missing"
  | "hash_invalid"
  | "hash_mismatch"
  | "snapshot_invalid"
  | "summary_invalid"
  | "record_not_admitted";

const SUMMARY_ALLOWLIST = new Set([
  "status",
  "outcome",
  "decision",
  "classification",
  "recommendation_status",
  "definite_or_conditional",
  "conditional",
  "winner_plan_id",
  "runner_up_plan_id",
  "plan_id",
  "recommendation_id",
  "merchant_id",
  "branch_id",
  "objective",
  "reason_codes",
  "assumptions",
  "questions",
  "freshness",
  "evidence_refs",
  "evidence_reference_ids",
  "sensitivity_ids",
  "sensitivity",
  "summary",
  "version",
]);

const SUMMARY_NESTED_ALLOWLIST = new Set([
  "code",
  "id",
  "status",
  "source_id",
  "evidence_id",
  "kind",
  "label",
  "value",
  "reason",
  "question",
  "message",
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeRetentionClass(value: unknown): RetentionClass | null {
  if (typeof value !== "string") return null;
  const normalized = value.toLowerCase().replace(/[ -]/g, "_");
  if (
    normalized === "session" ||
    normalized === "session_only" ||
    normalized === "ephemeral"
  )
    return "session_only";
  if (
    normalized === "30d" ||
    normalized === "30_days" ||
    normalized === "thirty_days"
  )
    return "30_days";
  if (
    normalized === "90d" ||
    normalized === "90_days" ||
    normalized === "ninety_days"
  )
    return "90_days";
  if (
    normalized === "user_selected" ||
    normalized === "user_defined" ||
    normalized === "custom"
  )
    return "user_selected";
  return null;
}

function parseCreatedAt(value: unknown): string {
  if (typeof value !== "string" || value.length === 0)
    throw new HistoryBoundaryError("created_at_invalid");
  // Require an absolute timestamp.  Offsets are accepted but normalized to a
  // deterministic UTC representation; a floating/local timestamp is denied.
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/u.test(value))
    throw new HistoryBoundaryError("created_at_invalid");
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()))
    throw new HistoryBoundaryError("created_at_invalid");
  return parsed.toISOString();
}

function validAuthorization(
  value: unknown,
  expectedRetentionClass: Exclude<RetentionClass, "session_only">,
): LegalHoldAuthorization | null {
  // The value below is returned by the separately supplied host port.  Still
  // canonicalize it before reading fields so a hostile port cannot smuggle a
  // getter/proxy or a second-read inconsistency into the record.
  let normalized: unknown;
  try {
    normalized = canonicalSnapshot(value).value;
  } catch {
    return null;
  }
  const record = asRecord(normalized);
  if (
    !record ||
    record.kind !== "m5_trusted_legal_hold" ||
    record.retention_class !== expectedRetentionClass ||
    typeof record.authorization_id !== "string" ||
    record.authorization_id.length === 0 ||
    typeof record.issuer !== "string" ||
    record.issuer.length === 0 ||
    typeof record.issued_at !== "string"
  ) {
    return null;
  }
  try {
    const issued_at = parseCreatedAt(record.issued_at);
    return Object.freeze({
      kind: "m5_trusted_legal_hold",
      retention_class: expectedRetentionClass,
      authorization_id: record.authorization_id,
      issuer: record.issuer,
      issued_at,
    });
  } catch {
    return null;
  }
}

function addDays(timestamp: string, days: number): string {
  const time = new Date(timestamp).getTime();
  const next = new Date(time + days * 24 * 60 * 60 * 1000);
  return next.toISOString();
}

function readRetentionInput(
  input: Pick<RedactedHistoryInput, "retention_class" | "retention">,
): RetentionClass {
  const retentionClass = normalizeRetentionClass(
    input.retention_class ?? input.retention,
  );
  if (!retentionClass)
    throw new HistoryBoundaryError("retention_class_invalid");
  return retentionClass;
}

function readLegalHold(
  input: RedactedHistoryInput,
  retention_class: Exclude<RetentionClass, "session_only">,
  authorizationPort?: HistoryAuthorizationPort,
): LegalHoldAuthorization | null {
  let requested = false;
  let requestedAuthorizationId: string | null = null;
  let explicitlyDenied = false;
  try {
    requested =
      input.legal_hold === true ||
      (input.legal_hold !== undefined && input.legal_hold !== false) ||
      input.legal_hold_authorized === true ||
      input.legal_hold_authorization_id !== undefined ||
      input.legal_hold_id !== undefined ||
      input.legal_hold_authorization !== undefined ||
      input.trusted_legal_hold_authorization !== undefined;
    explicitlyDenied = input.legal_hold_authorized === false;
    const suppliedId = input.legal_hold_authorization_id ?? input.legal_hold_id;
    if (
      suppliedId !== undefined &&
      suppliedId !== null &&
      typeof suppliedId !== "string"
    ) {
      throw new HistoryBoundaryError("legal_hold_id_invalid");
    }
    requestedAuthorizationId =
      suppliedId === undefined ? null : suppliedId === null ? null : suppliedId;
  } catch {
    throw new HistoryBoundaryError("legal_hold_unauthorized");
  }
  if (explicitlyDenied && requested)
    throw new HistoryBoundaryError("legal_hold_unauthorized");
  if (!requested) return null;
  if (!authorizationPort)
    throw new HistoryBoundaryError("legal_hold_unauthorized");
  if (typeof authorizationPort.authorizeLegalHold !== "function")
    throw new HistoryBoundaryError("legal_hold_unauthorized");
  let candidate: unknown;
  try {
    candidate = authorizationPort.authorizeLegalHold({
      retention_class,
      requested_authorization_id:
        typeof requestedAuthorizationId === "string"
          ? requestedAuthorizationId
          : null,
    });
  } catch {
    throw new HistoryBoundaryError("legal_hold_unauthorized");
  }
  if (candidate === null || candidate === undefined)
    throw new HistoryBoundaryError("legal_hold_unauthorized");
  const hold = validAuthorization(candidate, retention_class);
  if (!hold) throw new HistoryBoundaryError("legal_hold_proof_invalid");
  if (
    typeof requestedAuthorizationId === "string" &&
    hold.authorization_id !== requestedAuthorizationId
  ) {
    throw new HistoryBoundaryError("legal_hold_id_invalid");
  }
  return hold;
}

function retentionDays(
  retentionClass: RetentionClass,
  input: RedactedHistoryInput,
): number | null {
  if (retentionClass === "session_only") return null;
  if (retentionClass === "30_days") return 30;
  if (retentionClass === "90_days") return 90;
  const value = input.retention_days ?? input.days;
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > 3650
  ) {
    throw new HistoryBoundaryError("retention_days_invalid");
  }
  return value;
}

/** Compute the retention decision without performing any persistence. */
export function decideRetention(
  input: Pick<
    RedactedHistoryInput,
    | "retention_class"
    | "retention"
    | "retention_days"
    | "days"
    | "created_at"
    | "legal_hold"
    | "legal_hold_authorized"
    | "legal_hold_authorization_id"
    | "legal_hold_id"
    | "legal_hold_authorization"
    | "trusted_legal_hold_authorization"
  >,
  authorizationPort?: HistoryAuthorizationPort,
): RetentionDecision {
  const retention_class = readRetentionInput(input);
  if (retention_class === "session_only") {
    return Object.freeze({
      retention_class,
      persist: false,
      created_at: null,
      purge_after: null,
      legal_hold: false,
      legal_hold_authorization_id: null,
    });
  }
  const created_at =
    input.created_at === undefined
      ? (() => {
          throw new HistoryBoundaryError("created_at_required");
        })()
      : parseCreatedAt(input.created_at);
  const hold = readLegalHold(input, retention_class, authorizationPort);
  const days = retentionDays(retention_class, input);
  const purge_after = hold ? null : addDays(created_at, days ?? 0);
  return Object.freeze({
    retention_class,
    persist: true,
    created_at,
    purge_after,
    legal_hold: hold !== null,
    legal_hold_authorization_id: hold?.authorization_id ?? null,
  });
}

function validHash(value: unknown): value is `sha256:${string}` {
  return isSha256(value);
}

function hashFromSnapshot(value: unknown): string | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(record, "sha256");
  if (!descriptor || !Object.hasOwn(descriptor, "value")) return undefined;
  return typeof descriptor.value === "string" ? descriptor.value : undefined;
}

function valueFromSnapshot(value: unknown): unknown {
  const record = asRecord(value);
  if (!record) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(record, "value");
  if (!descriptor || !Object.hasOwn(descriptor, "value")) return undefined;
  return descriptor.value;
}

function resolvePayloadHash(
  input: RedactedHistoryInput,
  kind: "request" | "response",
): `sha256:${string}` {
  const payload = input[kind];
  const snapshotValue = input[`${kind}_snapshot`];
  const declared =
    input[`${kind}_sha256`] ??
    input[`${kind}_hash`] ??
    hashFromSnapshot(snapshotValue);
  const suppliedPayload =
    payload !== undefined
      ? payload
      : snapshotValue !== undefined
        ? valueFromSnapshot(snapshotValue)
        : undefined;
  if (suppliedPayload === undefined)
    throw new HistoryBoundaryError("hash_missing");
  if (declared === undefined) throw new HistoryBoundaryError("hash_missing");
  if (declared !== undefined && !validHash(declared))
    throw new HistoryBoundaryError("hash_invalid");
  let computed: `sha256:${string}`;
  try {
    computed = canonicalSnapshot(suppliedPayload).sha256;
  } catch {
    throw new HistoryBoundaryError("snapshot_invalid");
  }
  if (computed !== declared) throw new HistoryBoundaryError("hash_mismatch");
  return computed;
}

function primitiveSummary(value: unknown): string | number | boolean | null {
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

const EMAIL_VALUE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu;
const PHONE_VALUE = /\+?\d[\d\s().-]{7,}\d/u;
const PII_KEYS = new Set([
  "email",
  "phone",
  "mobile",
  "address",
  "location",
  "latitude",
  "longitude",
  "customer",
  "userid",
  "userref",
  "account",
]);

function assertNoHistoryPii(value: unknown, path = "/"): void {
  if (typeof value === "string") {
    if (EMAIL_VALUE.test(value) || PHONE_VALUE.test(value))
      throw new HistoryBoundaryError("summary_invalid");
    return;
  }
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1)
      assertNoHistoryPii(value[index], `${path}/${index}`);
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (PII_KEYS.has(key.toLowerCase().replace(/[^a-z0-9]/g, "")))
      throw new HistoryBoundaryError("summary_invalid");
    assertNoHistoryPii(child, `${path}/${key}`);
  }
}

function copySummary(value: unknown, nested: boolean): unknown {
  const primitive = primitiveSummary(value);
  if (primitive !== null) return primitive;
  if (Array.isArray(value)) {
    const result: unknown[] = [];
    for (const item of value) {
      const copied = copySummary(item, true);
      if (copied !== undefined) result.push(copied);
    }
    return result;
  }
  const record = asRecord(value);
  if (!record) return undefined;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(record)) {
    const allowed = nested
      ? SUMMARY_NESTED_ALLOWLIST.has(key)
      : SUMMARY_ALLOWLIST.has(key);
    if (!allowed) continue;
    const copied = copySummary(child, true);
    if (copied !== undefined) result[key] = copied;
  }
  return result;
}

function redactSummary(value: unknown): Readonly<RedactedResultSummary> {
  const admitted = value === undefined ? {} : canonicalSnapshot(value).value;
  const copied = copySummary(admitted, false);
  if (!copied || typeof copied !== "object" || Array.isArray(copied))
    throw new HistoryBoundaryError("summary_invalid");
  // Inspect the exact record-shaped projection: disallowed wallet/facts/
  // location fields are intentionally dropped, while an innocent retained
  // key such as `summary` still cannot carry an email/phone.
  assertNoHistoryPii(copied);
  // Admission is an independent second pass over the exact record-shaped
  // summary, not a trust decision based on a producer's contains_user_data bit.
  assertAdmitted(copied);
  return deepFreeze(copied as RedactedResultSummary);
}

function deepFreeze<T>(value: T, active = new Set<object>()): T {
  if (!value || typeof value !== "object") return value;
  if (active.has(value)) throw new HistoryBoundaryError("summary_invalid");
  active.add(value);
  if (Array.isArray(value)) {
    for (const child of value) deepFreeze(child, active);
  } else {
    for (const child of Object.values(value as Record<string, unknown>))
      deepFreeze(child, active);
  }
  active.delete(value);
  return Object.freeze(value);
}

function deterministicHistoryId(
  record: Omit<RedactedHistoryRecord, "history_id">,
): string {
  const snapshot = canonicalSnapshot(record);
  return `history_${snapshot.sha256.slice("sha256:".length, "sha256:".length + 32)}`;
}

/**
 * Construct a minimal, redacted history DTO.  This function intentionally has
 * no database adapter and never stores the admitted request/response payloads.
 */
export function createRedactedHistoryRecord(
  input: RedactedHistoryInput,
  authorizationPort?: HistoryAuthorizationPort,
): HistoryCreationResult {
  // A caller-supplied user reference is never a redaction boundary.  Reject
  // it before even the session-only fast path so a PII lookup key cannot be
  // smuggled through a non-persisted request and later reused by a host.
  if (input.user_ref !== undefined || input.user_id !== undefined) {
    throw new HistoryBoundaryError("summary_invalid");
  }
  const decision = decideRetention(input, authorizationPort);
  if (!decision.persist) {
    return Object.freeze({
      persist: false,
      retention_class: decision.retention_class,
      decision,
      record: null,
    });
  }

  const request_sha256 = resolvePayloadHash(input, "request");
  const response_sha256 = resolvePayloadHash(input, "response");
  const result_summary = redactSummary(input.result_summary ?? input.result);
  const base: Omit<RedactedHistoryRecord, "history_id"> = {
    retention_class: decision.retention_class as Exclude<
      RetentionClass,
      "session_only"
    >,
    created_at: decision.created_at as string,
    purge_after: decision.purge_after,
    legal_hold: decision.legal_hold,
    legal_hold_authorization_id: decision.legal_hold_authorization_id,
    request_sha256,
    response_sha256,
    result_summary,
  };
  const history_id = input.history_id ?? deterministicHistoryId(base);
  if (typeof history_id !== "string" || history_id.length === 0)
    throw new HistoryBoundaryError("summary_invalid");
  const record = { history_id, ...base } as RedactedHistoryRecord;
  try {
    // The structural fields above are typed and either generated locally or
    // bound to a trusted hash/authorization.  Do not run free-text phone and
    // email heuristics over timestamps, SHA-256 values, or opaque IDs: an ISO
    // timestamp itself looks like a phone number to a broad digit heuristic.
    // `redactSummary` has already scanned the only free-text surface retained
    // in this record.
    assertAdmitted(record);
  } catch {
    throw new HistoryBoundaryError("record_not_admitted");
  }
  return Object.freeze({
    persist: true,
    retention_class: decision.retention_class,
    decision,
    record: deepFreeze(record),
  });
}

export const createHistoryRecord = createRedactedHistoryRecord;

// Keep this type exported for callers that need to type a precomputed hash
// without importing the broader snapshot helper.
export type { CanonicalSnapshot };
