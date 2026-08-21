import { createHash } from "node:crypto";
import { types as nodeTypes } from "node:util";

/** A redacted, stable issue emitted by the recommendation security boundary. */
export interface SecurityIssue {
  readonly code: SecurityIssueCode;
  /** A JSON-pointer-like location. Sensitive property names are replaced. */
  readonly path: string;
}

export type SecurityIssueCode =
  | "prohibited_pan"
  | "prohibited_cvv"
  | "prohibited_pin"
  | "prohibited_bank_credential"
  | "prohibited_api_or_bearer_token"
  | "prohibited_issuer_token"
  | "prohibited_dynamic_qr_credential"
  | "prohibited_dynamic_screenshot"
  | "unsupported_value"
  | "bigint_value"
  | "non_finite_number"
  | "cyclic_value"
  | "unsafe_object";

/**
 * Error used at the admission boundary.  Its message contains only stable
 * codes and redacted paths; never interpolate input values into this error.
 */
export class M5SecurityError extends Error {
  readonly code = "m5_security_admission_denied" as const;
  readonly issues: readonly SecurityIssue[];

  constructor(issues: readonly SecurityIssue[]) {
    const stableIssues = uniqueIssues(issues);
    super(
      `M5_SECURITY_ADMISSION_DENIED:${stableIssues
        .map((issue) => `${issue.code}@${issue.path}`)
        .join(",")}`,
    );
    this.name = "M5SecurityError";
    this.issues = Object.freeze(stableIssues);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface CanonicalSnapshot<T> {
  readonly value: Readonly<T>;
  readonly canonical_json: string;
  readonly sha256: `sha256:${string}`;
}

const SENSITIVE_PATH_KEYS = new Set([
  "apikey",
  "accesskey",
  "accesstoken",
  "bearertoken",
  "bankcredential",
  "bankpassword",
  "banksession",
  "cardnumber",
  "clientsecret",
  "creditcardnumber",
  "cvv",
  "cvc",
  "dynamiccredential",
  "dynamicpaymentqr",
  "issuercredential",
  "issuerkey",
  "issuersecret",
  "issuertoken",
  "loyaltycredential",
  "loyaltytoken",
  "pan",
  "password",
  "paymentcredential",
  "paymentqr",
  "pin",
  "primaryaccountnumber",
  "refreshtoken",
  "secretkey",
  "securitycode",
  "sessioncookie",
]);

const PAN_KEY_NAMES = new Set([
  "pan",
  "primaryaccountnumber",
  "fullcardnumber",
  "creditcardnumber",
  "paymentcardnumber",
]);

const CVV_KEY_NAMES = new Set([
  "cvv",
  "cvc",
  "cvv2",
  "cvc2",
  "securitycode",
  "cardsecuritycode",
]);

const PIN_KEY_NAMES = new Set([
  "pin",
  "cardpin",
  "bankpin",
  "paymentpin",
  "passcode",
]);

const BANK_CREDENTIAL_KEY_NAMES = new Set([
  "bankpassword",
  "bankloginpassword",
  "onlinebankingpassword",
  "bankcredential",
  "banksession",
  "bankcookies",
  "sessioncookie",
  "sessioncookies",
  "copiedsession",
]);

const API_TOKEN_KEY_NAMES = new Set([
  "apikey",
  "apiaccesskey",
  "apisecret",
  "bearertoken",
  "accesstoken",
  "refreshtoken",
  "clientsecret",
  "secretkey",
  "privatekey",
]);

const ISSUER_TOKEN_KEY_NAMES = new Set([
  "issuertoken",
  "issuercredential",
  "issuersecret",
  "issuerkey",
  "loyaltytoken",
  "loyaltycredential",
]);

const DYNAMIC_QR_KEY_NAMES = new Set([
  "dynamicpaymentqr",
  "paymentqr",
  "paymentqrcode",
  "qrcredential",
  "dynamiccredential",
  "dynamicpaymentcredential",
]);

function normalizeKey(key: string): string {
  return key
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function escapePathSegment(segment: string): string {
  return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}

function childPath(path: string, key: string): string {
  const normalized = normalizeKey(key);
  // A path is useful for remediation, but raw credential-looking names are
  // not useful to logs and can themselves disclose implementation details.
  const segment = isSensitiveKey(normalized)
    ? "~redacted"
    : escapePathSegment(key);
  return path === "/" ? `/${segment}` : `${path}/${segment}`;
}

function isSensitiveKey(normalized: string): boolean {
  return (
    SENSITIVE_PATH_KEYS.has(normalized) ||
    normalized.includes("token") ||
    normalized.includes("secret") ||
    normalized.includes("password") ||
    normalized.includes("credential") ||
    normalized.includes("apikey") ||
    normalized.includes("accesskey") ||
    normalized.includes("cardnumber") ||
    normalized.includes("securitycode") ||
    normalized === "pan" ||
    normalized.endsWith("pin")
  );
}

function arrayPath(path: string, index: number): string {
  return path === "/" ? `/${index}` : `${path}/${index}`;
}

function issue(code: SecurityIssueCode, path: string): SecurityIssue {
  return Object.freeze({ code, path });
}

function uniqueIssues(issues: readonly SecurityIssue[]): SecurityIssue[] {
  const seen = new Set<string>();
  const unique: SecurityIssue[] = [];
  for (const candidate of issues) {
    const key = `${candidate.code}\u0000${candidate.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(issue(candidate.code, candidate.path));
  }
  return unique;
}

function isLuhnNumber(value: string): boolean {
  let sum = 0;
  let double = false;
  for (let index = value.length - 1; index >= 0; index -= 1) {
    const digit = value.charCodeAt(index) - 48;
    if (digit < 0 || digit > 9) return false;
    let add = digit;
    if (double) {
      add *= 2;
      if (add > 9) add -= 9;
    }
    sum += add;
    double = !double;
  }
  return sum % 10 === 0;
}

function compactDigits(value: string): string {
  // Card issuers commonly render digits with NBSPs and Unicode dash
  // punctuation.  Treat those formatting characters exactly like ASCII
  // spaces/hyphens, while retaining every other character for fail-closed
  // matching.
  return value.replace(/[\p{Dash_Punctuation}\p{White_Space}]/gu, "");
}

function looksLikePan(value: string): boolean {
  const compact = compactDigits(value);
  return /^\d{13,19}$/.test(compact) && isLuhnNumber(compact);
}

function looksLikeToken(value: string): boolean {
  const trimmed = value.trim();
  if (/^bearer\s+\S+/iu.test(trimmed)) return true;
  if (/^basic\s+\S+/iu.test(trimmed)) return true;
  if (
    /^(?:ghp|ghs|github_pat|sk|pk|rk|api|live|test)_[A-Za-z0-9_-]{12,}$/u.test(
      trimmed,
    )
  ) {
    return true;
  }
  // JWT-like values are credentials even when their field name is innocuous.
  if (/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(trimmed)) {
    return true;
  }
  // AWS access keys are a useful concrete API-key family to reject without
  // retaining the key itself.
  return /^AKIA[0-9A-Z]{16}$/u.test(trimmed);
}

function looksLikeDynamicCredential(value: string): boolean {
  return /(?:dynamic|payment).*(?:qr|credential|token)|qr.*(?:credential|token)/iu.test(
    value,
  );
}

function isPlainRecord(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

interface ScanContext {
  readonly active: Set<object>;
  readonly issues: SecurityIssue[];
}

interface DataProperty {
  readonly key: string;
  readonly value: unknown;
}

const POLLUTION_KEYS = new Set([
  "__proto__",
  "proto",
  "constructor",
  "prototype",
]);

/**
 * Inspect descriptors without reading properties.  In particular, this never
 * invokes a getter and never consults toJSON.  Arrays have one intrinsic
 * non-enumerable `length` property; every other hidden/symbol/accessor
 * property is an unsafe input even if its enumerable projection is benign.
 */
function readOwnDataProperties(
  value: object,
  path: string,
  context: ScanContext,
): {
  readonly properties: readonly DataProperty[];
  readonly arrayLength?: number;
} {
  const properties: DataProperty[] = [];
  let keys: readonly PropertyKey[];
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    context.issues.push(issue("unsafe_object", path));
    return { properties };
  }
  let arrayLength: number | undefined;
  for (const propertyKey of keys) {
    if (typeof propertyKey === "symbol") {
      context.issues.push(
        issue("unsafe_object", `${path === "/" ? "" : path}/~symbol`),
      );
      continue;
    }
    const key = propertyKey as string;
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      context.issues.push(issue("unsafe_object", childPath(path, key)));
      continue;
    }
    if (!descriptor) {
      context.issues.push(issue("unsafe_object", childPath(path, key)));
      continue;
    }
    if ("get" in descriptor || "set" in descriptor) {
      context.issues.push(issue("unsafe_object", childPath(path, key)));
      continue;
    }
    if (Array.isArray(value) && key === "length") {
      if (
        typeof descriptor.value !== "number" ||
        !Number.isSafeInteger(descriptor.value) ||
        descriptor.value < 0
      ) {
        context.issues.push(
          issue("unsafe_object", `${path === "/" ? "" : path}/length`),
        );
      } else {
        arrayLength = descriptor.value;
      }
      continue;
    }
    if (Array.isArray(value)) {
      const index = Number(key);
      if (
        !/^\d+$/u.test(key) ||
        !Number.isSafeInteger(index) ||
        index < 0 ||
        index >= 2 ** 32 - 1 ||
        String(index) !== key
      ) {
        context.issues.push(issue("unsafe_object", childPath(path, key)));
        continue;
      }
    }
    if (!descriptor.enumerable) {
      context.issues.push(issue("unsafe_object", childPath(path, key)));
      continue;
    }
    const normalized = normalizeKey(key);
    if (POLLUTION_KEYS.has(key) || POLLUTION_KEYS.has(normalized)) {
      context.issues.push(issue("unsafe_object", childPath(path, key)));
      continue;
    }
    properties.push({ key, value: descriptor.value });
  }
  return { properties, ...(arrayLength === undefined ? {} : { arrayLength }) };
}

function scanString(value: string, path: string, context: ScanContext): void {
  // A four-digit last-four value is intentionally not a PAN and is allowed by
  // the policy.  General four-digit values are not rejected either.
  if (looksLikePan(value)) {
    context.issues.push(issue("prohibited_pan", path));
  }
  if (looksLikeToken(value)) {
    context.issues.push(issue("prohibited_api_or_bearer_token", path));
  }
  if (looksLikeDynamicCredential(value)) {
    context.issues.push(issue("prohibited_dynamic_qr_credential", path));
  }
}

function screenshotMarkers(
  value: unknown,
  path: string,
  context: ScanContext,
  active = new Set<object>(),
): { dynamic: boolean; unencrypted: boolean } {
  if (!value || typeof value !== "object") {
    return {
      dynamic:
        typeof value === "string" &&
        /dynamic.*(?:qr|payment|credential)|(?:qr|payment).*dynamic/iu.test(
          value,
        ),
      unencrypted: false,
    };
  }
  if (active.has(value)) return { dynamic: false, unencrypted: false };
  active.add(value);
  const properties = readOwnDataProperties(value, path, context).properties;
  let dynamic = false;
  let unencrypted = false;
  if (Array.isArray(value)) {
    for (const { key, value: child } of properties) {
      const nested = screenshotMarkers(
        child,
        childPath(path, key),
        context,
        active,
      );
      dynamic ||= nested.dynamic;
      unencrypted ||= nested.unencrypted;
    }
    active.delete(value);
    return { dynamic, unencrypted };
  }
  for (const { key, value: child } of properties) {
    const normalized = normalizeKey(key);
    if (
      normalized === "dynamic" ||
      normalized === "isdynamic" ||
      normalized === "dynamiccredential" ||
      normalized === "hasdynamiccredential" ||
      (normalized.includes("dynamic") && normalized.includes("qr"))
    ) {
      dynamic =
        child === true ||
        (typeof child === "string" &&
          /true|dynamic|credential|payment|qr/iu.test(child));
    }
    if (
      normalized === "encrypted" ||
      normalized === "isencrypted" ||
      normalized === "encryption"
    ) {
      unencrypted =
        child === false ||
        (typeof child === "string" &&
          /^(?:none|false|unencrypted|plaintext)$/iu.test(child));
    }
    if (
      typeof child === "string" &&
      /dynamic.*(?:qr|payment|credential)|(?:qr|payment).*dynamic/iu.test(child)
    ) {
      dynamic = true;
    }
    if (normalized.includes("screenshot")) {
      const nested = screenshotMarkers(
        child,
        childPath(path, key),
        context,
        active,
      );
      dynamic ||= nested.dynamic;
      unencrypted ||= nested.unencrypted;
    }
  }
  active.delete(value);
  return { dynamic, unencrypted };
}

function scanObjectKeys(
  entries: readonly DataProperty[],
  path: string,
  context: ScanContext,
): void {
  for (const { key, value: child } of entries) {
    const normalized = normalizeKey(key);
    const childLocation = childPath(path, key);

    if (PAN_KEY_NAMES.has(normalized)) {
      // A PAN field is prohibited even when an attacker inserts punctuation,
      // but a masked/last-four-only card value is left to the value scan.
      if (typeof child !== "string" || looksLikePan(child)) {
        context.issues.push(issue("prohibited_pan", childLocation));
      }
    } else if (CVV_KEY_NAMES.has(normalized)) {
      context.issues.push(issue("prohibited_cvv", childLocation));
    } else if (PIN_KEY_NAMES.has(normalized)) {
      context.issues.push(issue("prohibited_pin", childLocation));
    } else if (BANK_CREDENTIAL_KEY_NAMES.has(normalized)) {
      context.issues.push(issue("prohibited_bank_credential", childLocation));
    } else if (API_TOKEN_KEY_NAMES.has(normalized)) {
      context.issues.push(
        issue("prohibited_api_or_bearer_token", childLocation),
      );
    } else if (ISSUER_TOKEN_KEY_NAMES.has(normalized)) {
      context.issues.push(issue("prohibited_issuer_token", childLocation));
    } else if (DYNAMIC_QR_KEY_NAMES.has(normalized)) {
      context.issues.push(
        issue("prohibited_dynamic_qr_credential", childLocation),
      );
    }

    if (normalized.includes("screenshot")) {
      const markers = screenshotMarkers(child, childLocation, context);
      if (markers.dynamic && markers.unencrypted) {
        context.issues.push(
          issue("prohibited_dynamic_screenshot", childLocation),
        );
      }
    }
  }
}

function scanValue(value: unknown, path: string, context: ScanContext): void {
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "string") {
    scanString(value, path, context);
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      context.issues.push(issue("non_finite_number", path));
    return;
  }
  if (typeof value === "bigint") {
    context.issues.push(issue("bigint_value", path));
    return;
  }
  if (typeof value !== "object") {
    context.issues.push(issue("unsupported_value", path));
    return;
  }
  // Proxy traps can return a benign descriptor on the admission pass and a
  // credential on the later canonicalization pass.  There is no safe way for
  // this boundary to establish a stable snapshot of a Proxy, so reject it
  // before any reflective operation (including instanceof).
  if (nodeTypes.isProxy(value)) {
    context.issues.push(issue("unsafe_object", path));
    return;
  }
  if (context.active.has(value)) {
    context.issues.push(issue("cyclic_value", path));
    return;
  }
  try {
    if (
      value instanceof Date ||
      value instanceof RegExp ||
      value instanceof Map ||
      value instanceof Set
    ) {
      context.issues.push(issue("unsafe_object", path));
      return;
    }
  } catch {
    context.issues.push(issue("unsafe_object", path));
    return;
  }
  try {
    if (!Array.isArray(value) && !isPlainRecord(value)) {
      context.issues.push(issue("unsafe_object", path));
      return;
    }
    context.active.add(value);
    const own = readOwnDataProperties(value, path, context);
    if (Array.isArray(value)) {
      const length = own.arrayLength;
      if (length === undefined) {
        context.issues.push(issue("unsafe_object", path));
      } else {
        const byKey = new Map(
          own.properties.map((property) => [property.key, property.value]),
        );
        for (let index = 0; index < length; index += 1) {
          const key = String(index);
          if (!byKey.has(key)) {
            context.issues.push(
              issue("unsupported_value", arrayPath(path, index)),
            );
          } else {
            scanValue(byKey.get(key), arrayPath(path, index), context);
          }
        }
        for (const property of own.properties) {
          if (!/^\d+$/u.test(property.key) || Number(property.key) >= length) {
            scanValue(property.value, childPath(path, property.key), context);
          }
        }
      }
    } else {
      scanObjectKeys(own.properties, path, context);
      for (const property of own.properties) {
        scanValue(property.value, childPath(path, property.key), context);
      }
    }
    context.active.delete(value);
  } catch {
    context.active.delete(value);
    context.issues.push(issue("unsafe_object", path));
  }
}

/** Return only stable security codes and redacted paths; no input values. */
export function findProhibitedData(value: unknown): readonly SecurityIssue[] {
  const context: ScanContext = { active: new Set<object>(), issues: [] };
  scanValue(value, "/", context);
  return Object.freeze(uniqueIssues(context.issues));
}

/** Admit a value before it can be hashed, logged, or passed to persistence. */
export function assertAdmitted<T>(value: T): T {
  const issues = findProhibitedData(value);
  if (issues.length > 0) throw new M5SecurityError(issues);
  return value;
}

export const assertSecurityAdmitted = assertAdmitted;
export const inspectSecurity = findProhibitedData;

function cloneAndCanonicalize(value: unknown, path: string): unknown {
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return value;
  if (typeof value === "number") return Object.is(value, -0) ? 0 : value;
  if (typeof value !== "object" || value === null) {
    // assertAdmitted/findProhibitedData has already rejected this path.  Keep
    // this guard so future callers cannot accidentally bypass the invariant.
    throw new M5SecurityError([issue("unsafe_object", path)]);
  }
  if (nodeTypes.isProxy(value)) {
    throw new M5SecurityError([issue("unsafe_object", path)]);
  }
  if (!Array.isArray(value) && !isPlainRecord(value)) {
    throw new M5SecurityError([issue("unsafe_object", path)]);
  }
  const context: ScanContext = { active: new Set<object>(), issues: [] };
  const own = readOwnDataProperties(value, path, context);
  if (context.issues.length > 0) throw new M5SecurityError(context.issues);
  if (Array.isArray(value)) {
    if (own.arrayLength === undefined)
      throw new M5SecurityError([issue("unsafe_object", path)]);
    const byKey = new Map(
      own.properties.map((property) => [property.key, property.value]),
    );
    const result: unknown[] = new Array(own.arrayLength);
    for (let index = 0; index < own.arrayLength; index += 1) {
      const key = String(index);
      if (!byKey.has(key))
        throw new M5SecurityError([
          issue("unsupported_value", arrayPath(path, index)),
        ]);
      result[index] = cloneAndCanonicalize(
        byKey.get(key),
        arrayPath(path, index),
      );
    }
    for (const property of own.properties) {
      if (
        !/^\d+$/u.test(property.key) ||
        Number(property.key) >= own.arrayLength
      ) {
        (result as unknown as Record<string, unknown>)[property.key] =
          cloneAndCanonicalize(property.value, childPath(path, property.key));
      }
    }
    return result;
  }
  const result: Record<string, unknown> = Object.create(null) as Record<
    string,
    unknown
  >;
  for (const property of [...own.properties].sort((left, right) =>
    left.key.localeCompare(right.key),
  )) {
    result[property.key] = cloneAndCanonicalize(
      property.value,
      childPath(path, property.key),
    );
  }
  return result;
}

function stringifyCanonical(value: unknown): string {
  const json = JSON.stringify(value);
  if (json === undefined)
    throw new M5SecurityError([issue("unsupported_value", "/")]);
  return json;
}

function freezeDeep<T>(value: T, active = new Set<object>()): T {
  if (value === null || typeof value !== "object") return value;
  if (active.has(value))
    throw new M5SecurityError([issue("cyclic_value", "/")]);
  active.add(value);
  if (Array.isArray(value)) {
    for (const item of value) freezeDeep(item, active);
  } else {
    for (const child of Object.values(value as Record<string, unknown>))
      freezeDeep(child, active);
  }
  active.delete(value);
  return Object.freeze(value);
}

/**
 * Produce a deterministic, deeply immutable, admitted JSON snapshot.  The
 * input itself is never frozen or mutated.
 */
export function canonicalSnapshot<T>(input: T): CanonicalSnapshot<T> {
  assertAdmitted(input);
  let cloned: T;
  try {
    cloned = cloneAndCanonicalize(input, "/") as T;
  } catch (error) {
    if (error instanceof M5SecurityError) throw error;
    throw new M5SecurityError([issue("unsafe_object", "/")]);
  }
  const canonical_json = stringifyCanonical(cloned);
  const digest = createHash("sha256")
    .update(canonical_json, "utf8")
    .digest("hex");
  const snapshot = {
    value: freezeDeep(cloned),
    canonical_json,
    sha256: `sha256:${digest}` as `sha256:${string}`,
  } as CanonicalSnapshot<T>;
  return Object.freeze(snapshot);
}

export const createCanonicalSnapshot = canonicalSnapshot;

export function isSha256(value: unknown): value is `sha256:${string}` {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/u.test(value);
}

export interface RuleAssurance {
  readonly rule_id: string;
  readonly status?: string;
  readonly assurance_status?: string;
  readonly terms_reviewed?: boolean;
  readonly terms_status?: string;
  readonly terms?: unknown;
  readonly review_approved?: boolean;
  readonly review_status?: string;
  readonly review?: unknown;
  readonly canonical_evidence_ids?: readonly string[];
  readonly evidence_ids?: readonly string[];
  readonly canonical_evidence?: readonly unknown[];
  readonly evidence?: readonly unknown[];
  readonly evidence_verified?: boolean;
  readonly sources?: readonly unknown[];
  readonly source_ids?: readonly string[];
  readonly sources_verified?: boolean;
  readonly freshness_status?: string;
  readonly freshness?: unknown;
  readonly risk_status?: string;
  readonly unresolved_high_risk?: boolean;
  readonly high_risk?: boolean;
  readonly [key: string]: unknown;
}

export interface RuleTrustBlocker {
  readonly code:
    | "rule_ids_empty"
    | "rule_ids_duplicate"
    | "assurance_missing"
    | "assurance_duplicate"
    | "assurance_substituted"
    | "assurance_status_invalid"
    | "terms_unapproved"
    | "review_unapproved"
    | "evidence_missing"
    | "evidence_identity_invalid"
    | "evidence_duplicate"
    | "evidence_unverified"
    | "sources_missing"
    | "source_identity_invalid"
    | "source_duplicate"
    | "sources_invalid"
    | "evidence_source_unmatched"
    | "freshness_unhealthy"
    | "risk_unknown"
    | "high_risk_unresolved";
  readonly path: string;
}

export interface RuleTrustAssessment {
  readonly trusted: boolean;
  readonly rule_ids: readonly string[];
  readonly covered_rule_ids: readonly string[];
  readonly blockers: readonly RuleTrustBlocker[];
}

/** Compatibility name used by the recommendation core trust gate. */
export type TrustAssessment = RuleTrustAssessment;

export interface RuleTrustInput {
  readonly rule_ids: readonly string[];
  readonly assurances: readonly RuleAssurance[];
}

function lower(value: unknown): string | undefined {
  return typeof value === "string"
    ? value.toLowerCase().replace(/[ -]/g, "_")
    : undefined;
}

function nestedStatus(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const record = value as Record<string, unknown>;
  return lower(record.status ?? record.state ?? record.result);
}

function assuranceEntries(
  assurance: RuleAssurance,
  kind: "evidence" | "source",
): readonly unknown[] | null {
  if (kind === "evidence") {
    if (Array.isArray(assurance.canonical_evidence))
      return assurance.canonical_evidence;
    if (Array.isArray(assurance.evidence)) return assurance.evidence;
    return null;
  }
  return Array.isArray(assurance.sources) ? assurance.sources : null;
}

function entryId(value: unknown, kind: "evidence" | "source"): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const candidates =
    kind === "evidence"
      ? [record.evidence_id, record.id]
      : [record.source_id, record.id];
  const id = candidates.find(
    (candidate): candidate is string =>
      typeof candidate === "string" && candidate.length > 0,
  );
  return id ?? null;
}

function entryVerified(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const status = lower(record.status ?? record.state ?? record.review_status);
  return (
    record.verified === true || status === "verified" || status === "approved"
  );
}

function collectIds(
  entries: readonly unknown[],
  kind: "evidence" | "source",
): {
  readonly ids: ReadonlySet<string>;
  readonly invalid: boolean;
  readonly duplicate: boolean;
} {
  const ids = new Set<string>();
  let invalid = false;
  let duplicate = false;
  for (const entry of entries) {
    const id = entryId(entry, kind);
    if (!id) {
      invalid = true;
      continue;
    }
    if (ids.has(id)) duplicate = true;
    ids.add(id);
  }
  return { ids, invalid, duplicate };
}

function addBlocker(
  blockers: RuleTrustBlocker[],
  code: RuleTrustBlocker["code"],
  path: string,
): void {
  blockers.push(Object.freeze({ code, path }));
}

/**
 * Evaluate the complete rule-assurance matrix.  This function deliberately
 * ignores producer authority claims; only the explicit evidence/review/
 * freshness/terms fields below can satisfy the gate.
 */
export function assessRuleTrust(input: RuleTrustInput): RuleTrustAssessment;
export function assessRuleTrust(
  ruleIds: readonly string[],
  assurances: readonly RuleAssurance[],
): RuleTrustAssessment;
export function assessRuleTrust(
  inputOrRuleIds: RuleTrustInput | readonly string[],
  suppliedAssurances?: readonly RuleAssurance[],
): RuleTrustAssessment {
  const isMatrixInput =
    typeof inputOrRuleIds === "object" &&
    !Array.isArray(inputOrRuleIds) &&
    inputOrRuleIds !== null &&
    "rule_ids" in inputOrRuleIds;
  const rule_ids = isMatrixInput
    ? [...(inputOrRuleIds as RuleTrustInput).rule_ids]
    : [...(inputOrRuleIds as readonly string[])];
  const assurances = isMatrixInput
    ? [...(inputOrRuleIds as RuleTrustInput).assurances]
    : [...(suppliedAssurances ?? [])];
  const blockers: RuleTrustBlocker[] = [];
  if (rule_ids.length === 0)
    addBlocker(blockers, "rule_ids_empty", "/rule_ids");

  const ruleIdSet = new Set<string>();
  for (let index = 0; index < rule_ids.length; index += 1) {
    const ruleId = rule_ids[index];
    if (typeof ruleId !== "string" || ruleId.length === 0) {
      addBlocker(blockers, "rule_ids_duplicate", `/rule_ids/${index}`);
      continue;
    }
    if (ruleIdSet.has(ruleId))
      addBlocker(blockers, "rule_ids_duplicate", `/rule_ids/${index}`);
    ruleIdSet.add(ruleId);
  }

  const assuranceById = new Map<
    string,
    { assurance: RuleAssurance; index: number }
  >();
  for (let index = 0; index < assurances.length; index += 1) {
    const assurance = assurances[index];
    if (
      !assurance ||
      typeof assurance.rule_id !== "string" ||
      assurance.rule_id.length === 0
    ) {
      addBlocker(blockers, "assurance_substituted", `/assurances/${index}`);
      continue;
    }
    if (assuranceById.has(assurance.rule_id)) {
      addBlocker(blockers, "assurance_duplicate", `/assurances/${index}`);
    } else {
      assuranceById.set(assurance.rule_id, { assurance, index });
    }
    if (!ruleIdSet.has(assurance.rule_id)) {
      addBlocker(blockers, "assurance_substituted", `/assurances/${index}`);
    }
  }

  for (let index = 0; index < rule_ids.length; index += 1) {
    const ruleId = rule_ids[index];
    if (typeof ruleId !== "string") continue;
    const entry = assuranceById.get(ruleId);
    const path = `/assurances/${entry?.index ?? index}`;
    if (!entry) {
      addBlocker(blockers, "assurance_missing", path);
      continue;
    }
    const assurance = entry.assurance;
    const status = lower(assurance.status ?? assurance.assurance_status);
    if (status !== "approved" && status !== "not_applicable") {
      addBlocker(blockers, "assurance_status_invalid", path);
    }

    const termsStatus =
      lower(assurance.terms_status) ?? nestedStatus(assurance.terms);
    if (
      !(
        assurance.terms_reviewed === true ||
        termsStatus === "approved" ||
        termsStatus === "not_applicable"
      )
    ) {
      addBlocker(blockers, "terms_unapproved", `${path}/terms`);
    }

    const reviewStatus =
      lower(assurance.review_status) ?? nestedStatus(assurance.review);
    if (!(assurance.review_approved === true || reviewStatus === "approved")) {
      addBlocker(blockers, "review_unapproved", `${path}/review`);
    }

    const evidence = assuranceEntries(assurance, "evidence");
    const sources = assuranceEntries(assurance, "source");
    if (!evidence || evidence.length === 0) {
      addBlocker(blockers, "evidence_missing", `${path}/evidence`);
    }
    if (!sources || sources.length === 0) {
      addBlocker(blockers, "sources_missing", `${path}/sources`);
    }
    const sourceCollection = sources ? collectIds(sources, "source") : null;
    const evidenceCollection = evidence
      ? collectIds(evidence, "evidence")
      : null;
    if (sourceCollection?.invalid)
      addBlocker(blockers, "source_identity_invalid", `${path}/sources`);
    if (sourceCollection?.duplicate)
      addBlocker(blockers, "source_duplicate", `${path}/sources`);
    if (evidenceCollection?.invalid)
      addBlocker(blockers, "evidence_identity_invalid", `${path}/evidence`);
    if (evidenceCollection?.duplicate)
      addBlocker(blockers, "evidence_duplicate", `${path}/evidence`);
    if (sources && !sources.every(entryVerified))
      addBlocker(blockers, "sources_invalid", `${path}/sources`);
    if (evidence && !evidence.every(entryVerified))
      addBlocker(blockers, "evidence_unverified", `${path}/evidence`);
    if (evidence && sourceCollection) {
      for (const entry of evidence) {
        if (!entry || typeof entry !== "object" || Array.isArray(entry))
          continue;
        const sourceId = (entry as Record<string, unknown>).source_id;
        if (
          typeof sourceId !== "string" ||
          !sourceCollection.ids.has(sourceId)
        ) {
          addBlocker(blockers, "evidence_source_unmatched", `${path}/evidence`);
          break;
        }
      }
    }

    const freshnessStatus =
      lower(assurance.freshness_status) ?? nestedStatus(assurance.freshness);
    const freshnessHealthy =
      freshnessStatus === "healthy" ||
      (assurance.freshness !== null &&
        typeof assurance.freshness === "object" &&
        (assurance.freshness as Record<string, unknown>).healthy === true);
    if (!freshnessHealthy)
      addBlocker(blockers, "freshness_unhealthy", `${path}/freshness`);

    const riskStatus = lower(assurance.risk_status);
    const explicitlyUnresolved =
      assurance.unresolved_high_risk === true || assurance.high_risk === true;
    if (
      explicitlyUnresolved ||
      riskStatus === "high" ||
      riskStatus === "unresolved" ||
      riskStatus === "high_risk"
    ) {
      addBlocker(blockers, "high_risk_unresolved", `${path}/risk`);
    } else if (
      riskStatus === undefined &&
      assurance.unresolved_high_risk !== false &&
      assurance.high_risk !== false
    ) {
      addBlocker(blockers, "risk_unknown", `${path}/risk`);
    }
  }

  const covered_rule_ids = [...assuranceById.keys()].filter((ruleId) =>
    ruleIdSet.has(ruleId),
  );
  const uniqueBlockers = uniqueTrustBlockers(blockers);
  return Object.freeze({
    trusted: uniqueBlockers.length === 0,
    rule_ids: Object.freeze(rule_ids),
    covered_rule_ids: Object.freeze(covered_rule_ids),
    blockers: Object.freeze(uniqueBlockers),
  });
}

function uniqueTrustBlockers(
  blockers: readonly RuleTrustBlocker[],
): RuleTrustBlocker[] {
  const seen = new Set<string>();
  const result: RuleTrustBlocker[] = [];
  for (const blocker of blockers) {
    const key = `${blocker.code}\u0000${blocker.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(Object.freeze({ ...blocker }));
  }
  return result;
}
