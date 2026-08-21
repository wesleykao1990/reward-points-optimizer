import { createHash } from "node:crypto";
import {
  admitChallengeCoveragePlan,
  isAdmittedChallengeCoveragePlan,
} from "./coverage.js";
import type { AdmittedChallengeCoveragePlan } from "./types.js";

/**
 * The synthetic lane is intentionally a different namespace from the
 * evidence/golden scenario lane.  The values in this module are test
 * contracts only; they never assert that a merchant, source, or reward rate
 * exists in the real world.
 */
export const SYNTHETIC_CASE_SET_VERSION = "1" as const;
export const SYNTHETIC_CHALLENGE_SET_VERSION = SYNTHETIC_CASE_SET_VERSION;
export const SYNTHETIC_CASE_ID_PREFIX = "SYN-M7-" as const;
export type SyntheticCaseSetVersion = "1";
const ACCEPTED_CASE_SET_VERSIONS = new Set<SyntheticCaseSetVersion>([
  SYNTHETIC_CASE_SET_VERSION,
]);

export type SyntheticCaseCapability = "runnable" | "blocked";
export type SyntheticTrustClass = "synthetic_test";
export type Sha256 = `sha256:${string}`;

export interface SyntheticCaseBase {
  readonly case_id: string;
  readonly coverage_target_id: string;
  readonly synthetic_only: true;
  readonly trust_class: SyntheticTrustClass;
  readonly does_not_satisfy_evidence_coverage: true;
  readonly capability: SyntheticCaseCapability;
}

export interface RunnableSyntheticCase extends SyntheticCaseBase {
  readonly capability: "runnable";
  readonly fixture_ref: string;
  readonly expected_ref: string;
  readonly fixture_sha256: Sha256;
  readonly expected_sha256: Sha256;
  readonly canonical_input_sha256: Sha256;
  readonly canonical_expected_output_sha256: Sha256;
  readonly engine_version: string;
  readonly rules_version: string;
  readonly valuation_version: string;
}

export interface BlockedSyntheticCase extends SyntheticCaseBase {
  readonly capability: "blocked";
  readonly blocker_code: string;
}

export type SyntheticCase = RunnableSyntheticCase | BlockedSyntheticCase;
export type SyntheticCaseSet = SyntheticChallengeSet;

export interface SyntheticChallengeSet {
  readonly version: SyntheticCaseSetVersion;
  readonly cases: readonly SyntheticCase[];
}

export interface SyntheticCaseDenial {
  readonly code: SyntheticCaseDenialCode;
  readonly path: string;
}

export type SyntheticCaseDenialCode =
  | "invalid_schema"
  | "unsafe_object"
  | "cyclic_value"
  | "sparse_array"
  | "accessor_property"
  | "hidden_property"
  | "symbol_property"
  | "unsupported_value"
  | "prohibited_data"
  | "unknown_field"
  | "unsupported_version"
  | "cases_missing"
  | "cases_invalid"
  | "missing_admitted_plan"
  | "admitted_plan_invalid"
  | "coverage_target_id_invalid"
  | "unknown_coverage_target"
  | "case_id_invalid"
  | "case_id_namespace_invalid"
  | "duplicate_case_id"
  | "capability_invalid"
  | "synthetic_marker_invalid"
  | "trust_class_invalid"
  | "evidence_coverage_marker_invalid"
  | "blocker_code_invalid"
  | "runnable_field_missing"
  | "blocked_field_invalid"
  | "fixture_ref_invalid"
  | "expected_ref_invalid"
  | "duplicate_path"
  | "hash_invalid"
  | "version_invalid"
  | "order_drift";

export interface SyntheticCaseAdmissionFailure {
  readonly ok: false;
  readonly denial: SyntheticCaseDenial;
}

export interface SyntheticCaseAdmissionSuccess {
  readonly ok: true;
  readonly challenge_set: SyntheticChallengeSet;
}

export type SyntheticCaseAdmissionResult =
  | SyntheticCaseAdmissionSuccess
  | SyntheticCaseAdmissionFailure;

export interface SyntheticCaseAdmissionOptions {
  /** The already admitted coverage plan.  It is a host-owned input. */
  readonly admitted_plan?: AdmittedChallengeCoveragePlan;
}

/** Structural alias used by callers that already ran coverage admission. */
export type SyntheticAdmittedCoveragePlan = AdmittedChallengeCoveragePlan;

export class SyntheticCaseAdmissionError extends Error {
  readonly code: SyntheticCaseDenialCode;
  readonly path: string;

  constructor(denial: SyntheticCaseDenial) {
    super(`SYNTHETIC_CASE_ADMISSION_DENIED:${denial.code}@${denial.path}`);
    this.name = "SyntheticCaseAdmissionError";
    this.code = denial.code;
    this.path = denial.path;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

const SHA256_PATTERN = /^(?:sha256:)?[0-9a-f]{64}$/u;
const CASE_ID_PATTERN = /^SYN-M7-[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const IDENTIFIER_PATTERN = /^[A-Za-z][A-Za-z0-9._:-]{0,95}$/u;
const STABLE_CODE_PATTERN = /^[a-z][a-z0-9._:-]{1,63}$/u;
const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:+-]{0,63}$/u;
const PATH_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/u;

const SET_FIELDS = new Set(["version", "cases"]);
const BASE_CASE_FIELDS = new Set([
  "case_id",
  "coverage_target_id",
  "synthetic_only",
  "trust_class",
  "does_not_satisfy_evidence_coverage",
  "capability",
]);
const RUNNABLE_CASE_FIELDS = new Set([
  ...BASE_CASE_FIELDS,
  "fixture_ref",
  "expected_ref",
  "fixture_sha256",
  "expected_sha256",
  "canonical_input_sha256",
  "canonical_expected_output_sha256",
  "engine_version",
  "rules_version",
  "valuation_version",
]);
const BLOCKED_CASE_FIELDS = new Set([...BASE_CASE_FIELDS, "blocker_code"]);
const ADMITTED_PLAN_FIELD_ORDER = [
  "value",
  "canonical_json",
  "sha256",
] as const;

// A case set is a capability-bearing value.  Recomputing its bytes is useful
// for deterministic reporting, but it must not turn an arbitrary structural
// lookalike into an admitted set.  The brand is private and cannot be copied
// through spread, JSON, or structuredClone.
const ADMITTED_SYNTHETIC_CHALLENGE_SETS = new WeakSet<object>();
const ADMITTED_SYNTHETIC_PLAN_BINDINGS = new WeakMap<
  object,
  AdmittedChallengeCoveragePlan
>();

const PROHIBITED_KEY_WORDS = [
  "source",
  "evidence",
  "review",
  "golden",
  "rate",
  "url",
  "uri",
  "href",
  "credential",
  "secret",
  "password",
  "token",
  "bearer",
  "pan",
  "cvv",
  "cvc",
  "pin",
  "bank",
] as const;

/*
 * A case is an untrusted JSON-shaped value.  This scanner deliberately runs
 * before reading any application field.  Descriptors are read instead of
 * `value[key]`, so accessors cannot execute, and every own key (including
 * non-enumerable and symbol keys) is accounted for.
 */
interface ScanIssue {
  readonly code: SyntheticCaseDenialCode;
  readonly path: string;
}

function scanIssue(code: SyntheticCaseDenialCode, path: string): ScanIssue {
  return { code, path };
}

function normalizeKey(key: string): string {
  return key
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]/gu, "");
}

function isProhibitedKey(key: string): boolean {
  // The one required marker includes the word "evidence" but is itself a
  // non-evidentiary assertion and is therefore explicitly allowlisted.
  if (key === "does_not_satisfy_evidence_coverage") return false;
  const normalized = normalizeKey(key);
  return PROHIBITED_KEY_WORDS.some((word) => normalized.includes(word));
}

function looksLikeUrl(value: string): boolean {
  return /^(?:[a-z][a-z0-9+.-]*:\/\/|javascript:|data:|file:|mailto:)/iu.test(
    value.trim(),
  );
}

function looksLikeCredential(value: string): boolean {
  const trimmed = value.trim();
  if (/^(?:bearer|basic)\s+\S+/iu.test(trimmed)) return true;
  if (/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(trimmed))
    return true;
  if (/^(?:sk|pk|rk|api|live|test)_[A-Za-z0-9_-]{12,}$/u.test(trimmed))
    return true;
  if (/^AKIA[0-9A-Z]{16}$/u.test(trimmed)) return true;
  // Payment card numbers are never useful to a synthetic challenge case.
  const digits = trimmed.replace(/[\s-]/gu, "");
  return /^\d{13,19}$/u.test(digits);
}

function propertyPath(path: string, key: string): string {
  const escaped = key.replaceAll("~", "~0").replaceAll("/", "~1");
  return path === "/" ? `/${escaped}` : `${path}/${escaped}`;
}

function arrayPath(path: string, index: number): string {
  return path === "/" ? `/${index}` : `${path}/${index}`;
}

function readOwnKeys(value: object): PropertyKey[] | ScanIssue {
  try {
    return Reflect.ownKeys(value);
  } catch {
    return scanIssue("unsafe_object", "/");
  }
}

function scanInput(
  value: unknown,
  enforceProhibitedData = true,
): ScanIssue | null {
  const active = new Set<object>();

  function visit(current: unknown, path: string): ScanIssue | null {
    if (current === null) return null;
    switch (typeof current) {
      case "string":
        if (
          enforceProhibitedData &&
          (looksLikeUrl(current) || looksLikeCredential(current))
        )
          return scanIssue("prohibited_data", path);
        return null;
      case "boolean":
        return null;
      case "number":
        return Number.isFinite(current)
          ? null
          : scanIssue("unsupported_value", path);
      case "undefined":
      case "bigint":
      case "function":
      case "symbol":
        return scanIssue("unsupported_value", path);
      default:
        break;
    }

    if (typeof current !== "object")
      return scanIssue("unsupported_value", path);
    if (active.has(current)) return scanIssue("cyclic_value", path);
    active.add(current);

    let prototype: object | null;
    try {
      prototype = Object.getPrototypeOf(current);
    } catch {
      active.delete(current);
      return scanIssue("unsafe_object", path);
    }

    const array = Array.isArray(current);
    if (
      (array && prototype !== Array.prototype) ||
      (!array && prototype !== Object.prototype && prototype !== null)
    ) {
      active.delete(current);
      return scanIssue("unsafe_object", path);
    }

    const ownKeys = readOwnKeys(current);
    if (!Array.isArray(ownKeys)) {
      active.delete(current);
      return ownKeys;
    }
    if (ownKeys.some((key) => typeof key !== "string")) {
      active.delete(current);
      return scanIssue("symbol_property", path);
    }

    if (array) {
      let lengthDescriptor: PropertyDescriptor | undefined;
      try {
        lengthDescriptor = Object.getOwnPropertyDescriptor(current, "length");
      } catch {
        active.delete(current);
        return scanIssue("unsafe_object", path);
      }
      if (
        !lengthDescriptor ||
        !("value" in lengthDescriptor) ||
        !Number.isSafeInteger(lengthDescriptor.value) ||
        lengthDescriptor.value < 0 ||
        !ownKeys.includes("length")
      ) {
        active.delete(current);
        return scanIssue("unsafe_object", path);
      }
      const length = lengthDescriptor.value as number;
      const expectedKeys = new Set<string>([
        "length",
        ...Array.from({ length }, (_, index) => String(index)),
      ]);
      if (
        ownKeys.length !== expectedKeys.size ||
        ownKeys.some((key) => !expectedKeys.has(String(key)))
      ) {
        active.delete(current);
        return scanIssue("sparse_array", path);
      }
    }

    for (const key of ownKeys) {
      if (typeof key !== "string") {
        active.delete(current);
        return scanIssue("symbol_property", path);
      }
      if (key === "length" && array) continue;
      const childPath = array
        ? arrayPath(path, Number(key))
        : propertyPath(path, key);
      if (!array && enforceProhibitedData && isProhibitedKey(key)) {
        active.delete(current);
        return scanIssue("prohibited_data", childPath);
      }
      let descriptor: PropertyDescriptor | undefined;
      try {
        descriptor = Object.getOwnPropertyDescriptor(current, key);
      } catch {
        active.delete(current);
        return scanIssue("unsafe_object", childPath);
      }
      if (!descriptor) {
        active.delete(current);
        return scanIssue("unsafe_object", childPath);
      }
      if ("get" in descriptor || "set" in descriptor) {
        active.delete(current);
        return scanIssue("accessor_property", childPath);
      }
      if (!descriptor.enumerable) {
        active.delete(current);
        return scanIssue("hidden_property", childPath);
      }
      const issue = visit(descriptor.value, childPath);
      if (issue) {
        active.delete(current);
        return issue;
      }
    }
    active.delete(current);
    return null;
  }

  return visit(value, "/");
}

/**
 * ECMAScript intentionally has no `isProxy` predicate.  Node's structured
 * clone rejects Proxy objects without invoking their property traps, so use
 * it only after the descriptor scan as a second representation check.  Plain
 * accessors/functions/cycles have already been rejected above.
 */
function proxyIssue(value: unknown): ScanIssue | null {
  try {
    structuredClone(value);
    return null;
  } catch {
    return scanIssue("unsafe_object", "/");
  }
}

function deny(
  code: SyntheticCaseDenialCode,
  path: string,
): SyntheticCaseAdmissionFailure {
  return Object.freeze({
    ok: false as const,
    denial: Object.freeze({ code, path }),
  });
}

function record(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return null;
  return value as Record<string, unknown>;
}

function ownFields(value: Record<string, unknown>): readonly string[] {
  return Object.keys(value);
}

function hasOnlyFields(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
): string | null {
  return ownFields(value).find((key) => !allowed.has(key)) ?? null;
}

function requiredString(
  value: Record<string, unknown>,
  field: string,
  code: SyntheticCaseDenialCode,
  path: string,
): string | SyntheticCaseAdmissionFailure {
  const child = value[field];
  if (typeof child !== "string" || child.length === 0)
    return deny(code, `${path}/${field}`);
  return child;
}

function normalizeSha256(
  value: unknown,
  path: string,
): Sha256 | SyntheticCaseAdmissionFailure {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value))
    return deny("hash_invalid", path);
  const hex = value.startsWith("sha256:")
    ? value.slice("sha256:".length)
    : value;
  return `sha256:${hex}` as Sha256;
}

function validateIdentifier(
  value: string,
  path: string,
): string | SyntheticCaseAdmissionFailure {
  if (!IDENTIFIER_PATTERN.test(value) || looksLikeUrl(value))
    return deny("coverage_target_id_invalid", path);
  return value;
}

function validateRef(
  value: unknown,
  path: string,
): string | SyntheticCaseAdmissionFailure {
  if (typeof value !== "string" || value.length === 0 || value.length > 255)
    return deny(
      path.endsWith("fixture_ref")
        ? "fixture_ref_invalid"
        : "expected_ref_invalid",
      path,
    );
  if (
    value.startsWith("/") ||
    value.startsWith("\\") ||
    value.includes("\\") ||
    value.includes("\u0000") ||
    value.includes("?") ||
    value.includes("#") ||
    value.includes("%") ||
    looksLikeUrl(value)
  )
    return deny(
      path.endsWith("fixture_ref")
        ? "fixture_ref_invalid"
        : "expected_ref_invalid",
      path,
    );
  const segments = value.split("/");
  if (
    segments.some(
      (segment) =>
        segment === "." ||
        segment === ".." ||
        !PATH_SEGMENT_PATTERN.test(segment),
    )
  )
    return deny(
      path.endsWith("fixture_ref")
        ? "fixture_ref_invalid"
        : "expected_ref_invalid",
      path,
    );
  return value;
}

function validateVersion(
  value: unknown,
  path: string,
): string | SyntheticCaseAdmissionFailure {
  if (
    typeof value !== "string" ||
    !VERSION_PATTERN.test(value) ||
    looksLikeUrl(value)
  )
    return deny("version_invalid", path);
  return value;
}

function validateBlockerCode(
  value: unknown,
  path: string,
): string | SyntheticCaseAdmissionFailure {
  if (
    typeof value !== "string" ||
    !STABLE_CODE_PATTERN.test(value) ||
    looksLikeUrl(value)
  )
    return deny("blocker_code_invalid", path);
  return value;
}

function isDeepFrozenPlainData(
  value: unknown,
  active = new Set<object>(),
): boolean {
  if (value === null || typeof value !== "object") return true;
  if (active.has(value) || !Object.isFrozen(value)) return false;
  let prototype: object | null;
  let keys: readonly PropertyKey[];
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    return false;
  }
  const isArray = Array.isArray(value);
  if (
    (isArray && prototype !== Array.prototype) ||
    (!isArray && prototype !== Object.prototype)
  )
    return false;
  active.add(value);
  try {
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor)) return false;
      if (!isDeepFrozenPlainData(descriptor.value, active)) return false;
    }
    return true;
  } finally {
    active.delete(value);
  }
}

function hasExactOwnFields(
  value: Record<string, unknown>,
  expected: readonly string[],
  path: string,
): SyntheticCaseAdmissionFailure | null {
  const keys = ownFields(value);
  if (
    keys.length !== expected.length ||
    keys.some((key) => !expected.includes(key))
  ) {
    const unknown = keys.find((key) => !expected.includes(key));
    return deny("admitted_plan_invalid", `${path}/${unknown ?? expected[0]}`);
  }
  for (const key of expected) {
    if (!Object.hasOwn(value, key))
      return deny("admitted_plan_invalid", `${path}/${key}`);
  }
  return null;
}

function coveragePlanGuard(value: unknown): boolean | null {
  try {
    return isAdmittedChallengeCoveragePlan(value);
  } catch {
    return false;
  }
}

function admitCoverageSnapshot(value: unknown): {
  readonly canonical_json: string;
  readonly sha256: string;
  readonly value: unknown;
} | null {
  try {
    const snapshot = admitChallengeCoveragePlan(value) as unknown as Record<
      string,
      unknown
    >;
    if (
      snapshot === null ||
      typeof snapshot !== "object" ||
      typeof snapshot.canonical_json !== "string" ||
      typeof snapshot.sha256 !== "string"
    )
      return null;
    return {
      value: snapshot.value,
      canonical_json: snapshot.canonical_json,
      sha256: snapshot.sha256,
    };
  } catch {
    return null;
  }
}

/**
 * Accept only the exact, immutable snapshot emitted by coverage admission.
 * Target IDs are read solely from the semantically admitted `value.scenarios`
 * array.  In particular, a scenario-shaped object or an ID array is never a
 * substitute for the snapshot envelope.
 */
function validateAdmittedPlan(
  input: unknown,
): Set<string> | SyntheticCaseAdmissionFailure {
  const snapshot = record(input);
  if (!snapshot) return deny("admitted_plan_invalid", "/admitted_plan");
  if (Object.getPrototypeOf(snapshot) !== Object.prototype)
    return deny("admitted_plan_invalid", "/admitted_plan");
  const fields = hasExactOwnFields(
    snapshot,
    ADMITTED_PLAN_FIELD_ORDER,
    "/admitted_plan",
  );
  if (fields) return fields;
  if (!isDeepFrozenPlainData(snapshot))
    return deny("admitted_plan_invalid", "/admitted_plan");

  const guarded = coveragePlanGuard(snapshot);
  if (guarded === false) return deny("admitted_plan_invalid", "/admitted_plan");

  const canonicalJson = snapshot.canonical_json;
  const sha256 = snapshot.sha256;
  if (typeof canonicalJson !== "string" || typeof sha256 !== "string")
    return deny("admitted_plan_invalid", "/admitted_plan");
  const recomputed = admitCoverageSnapshot(snapshot.value);
  if (
    !recomputed ||
    recomputed.canonical_json !== canonicalJson ||
    recomputed.sha256 !== sha256
  )
    return deny("admitted_plan_invalid", "/admitted_plan");

  const value = record(snapshot.value);
  if (!value || !Array.isArray(value.scenarios))
    return deny("admitted_plan_invalid", "/admitted_plan/value/scenarios");
  const ids = new Set<string>();
  for (const [index, scenario] of value.scenarios.entries()) {
    const entry = record(scenario);
    if (!entry || typeof entry.scenario_id !== "string")
      return deny(
        "admitted_plan_invalid",
        `/admitted_plan/value/scenarios/${index}`,
      );
    if (ids.has(entry.scenario_id))
      return deny(
        "admitted_plan_invalid",
        `/admitted_plan/value/scenarios/${index}/scenario_id`,
      );
    ids.add(entry.scenario_id);
  }
  if (ids.size === 0)
    return deny("admitted_plan_invalid", "/admitted_plan/value/scenarios");
  return ids;
}

function normalizeCase(
  input: unknown,
  path: string,
  admittedTargetIds: ReadonlySet<string>,
  seenCaseIds: Set<string>,
  seenPaths: Set<string>,
): SyntheticCase | SyntheticCaseAdmissionFailure {
  const value = record(input);
  if (!value) return deny("invalid_schema", path);
  const caseIdValue = requiredString(value, "case_id", "case_id_invalid", path);
  if (typeof caseIdValue !== "string") return caseIdValue;
  if (!CASE_ID_PATTERN.test(caseIdValue))
    return deny("case_id_namespace_invalid", `${path}/case_id`);
  if (seenCaseIds.has(caseIdValue))
    return deny("duplicate_case_id", `${path}/case_id`);
  seenCaseIds.add(caseIdValue);

  const targetValue = requiredString(
    value,
    "coverage_target_id",
    "coverage_target_id_invalid",
    path,
  );
  if (typeof targetValue !== "string") return targetValue;
  const targetId = validateIdentifier(
    targetValue,
    `${path}/coverage_target_id`,
  );
  if (typeof targetId !== "string") return targetId;
  if (!admittedTargetIds.has(targetId))
    return deny("unknown_coverage_target", `${path}/coverage_target_id`);

  if (value.synthetic_only !== true)
    return deny("synthetic_marker_invalid", `${path}/synthetic_only`);
  if (value.trust_class !== "synthetic_test")
    return deny("trust_class_invalid", `${path}/trust_class`);
  if (value.does_not_satisfy_evidence_coverage !== true)
    return deny(
      "evidence_coverage_marker_invalid",
      `${path}/does_not_satisfy_evidence_coverage`,
    );
  if (value.capability !== "runnable" && value.capability !== "blocked")
    return deny("capability_invalid", `${path}/capability`);

  if (value.capability === "blocked") {
    const unknown = hasOnlyFields(value, BLOCKED_CASE_FIELDS);
    if (unknown) return deny("blocked_field_invalid", `${path}/${unknown}`);
    const blocker = validateBlockerCode(
      value.blocker_code,
      `${path}/blocker_code`,
    );
    if (typeof blocker !== "string") return blocker;
    return Object.freeze({
      case_id: caseIdValue,
      coverage_target_id: targetId,
      synthetic_only: true as const,
      trust_class: "synthetic_test" as const,
      does_not_satisfy_evidence_coverage: true as const,
      capability: "blocked" as const,
      blocker_code: blocker,
    });
  }

  const unknown = hasOnlyFields(value, RUNNABLE_CASE_FIELDS);
  if (unknown) return deny("unknown_field", `${path}/${unknown}`);
  const fixtureRef = validateRef(value.fixture_ref, `${path}/fixture_ref`);
  if (typeof fixtureRef !== "string") return fixtureRef;
  const expectedRef = validateRef(value.expected_ref, `${path}/expected_ref`);
  if (typeof expectedRef !== "string") return expectedRef;
  if (fixtureRef === expectedRef)
    return deny("duplicate_path", `${path}/expected_ref`);
  for (const [ref, refPath] of [
    [fixtureRef, `${path}/fixture_ref`],
    [expectedRef, `${path}/expected_ref`],
  ] as const) {
    if (seenPaths.has(ref)) return deny("duplicate_path", refPath);
    seenPaths.add(ref);
  }

  const fixtureHash = normalizeSha256(
    value.fixture_sha256,
    `${path}/fixture_sha256`,
  );
  if (typeof fixtureHash !== "string") return fixtureHash;
  const expectedHash = normalizeSha256(
    value.expected_sha256,
    `${path}/expected_sha256`,
  );
  if (typeof expectedHash !== "string") return expectedHash;
  const inputHash = normalizeSha256(
    value.canonical_input_sha256,
    `${path}/canonical_input_sha256`,
  );
  if (typeof inputHash !== "string") return inputHash;
  const outputHash = normalizeSha256(
    value.canonical_expected_output_sha256,
    `${path}/canonical_expected_output_sha256`,
  );
  if (typeof outputHash !== "string") return outputHash;

  const engineVersion = validateVersion(
    value.engine_version,
    `${path}/engine_version`,
  );
  if (typeof engineVersion !== "string") return engineVersion;
  const rulesVersion = validateVersion(
    value.rules_version,
    `${path}/rules_version`,
  );
  if (typeof rulesVersion !== "string") return rulesVersion;
  const valuationVersion = validateVersion(
    value.valuation_version,
    `${path}/valuation_version`,
  );
  if (typeof valuationVersion !== "string") return valuationVersion;

  return Object.freeze({
    case_id: caseIdValue,
    coverage_target_id: targetId,
    synthetic_only: true as const,
    trust_class: "synthetic_test" as const,
    does_not_satisfy_evidence_coverage: true as const,
    capability: "runnable" as const,
    fixture_ref: fixtureRef,
    expected_ref: expectedRef,
    fixture_sha256: fixtureHash,
    expected_sha256: expectedHash,
    canonical_input_sha256: inputHash,
    canonical_expected_output_sha256: outputHash,
    engine_version: engineVersion,
    rules_version: rulesVersion,
    valuation_version: valuationVersion,
  });
}

function readSetInput(
  input: unknown,
):
  | { readonly version: SyntheticCaseSetVersion; readonly cases: unknown }
  | SyntheticCaseAdmissionFailure {
  const value = record(input);
  if (!value) return deny("invalid_schema", "/");
  const unknown = hasOnlyFields(value, SET_FIELDS);
  if (unknown) return deny("unknown_field", `/${unknown}`);
  if (
    typeof value.version !== "string" ||
    !ACCEPTED_CASE_SET_VERSIONS.has(value.version as SyntheticCaseSetVersion)
  )
    return deny("unsupported_version", "/version");
  if (!Array.isArray(value.cases)) return deny("cases_invalid", "/cases");
  return {
    version: value.version as SyntheticCaseSetVersion,
    cases: value.cases,
  };
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Object.isFrozen(value)) return value;
  if (Array.isArray(value)) {
    for (const child of value) deepFreeze(child);
  } else {
    for (const child of Object.values(value as Record<string, unknown>))
      deepFreeze(child);
  }
  return Object.freeze(value);
}

function normalizeChallengeSet(
  input: unknown,
  admittedPlan: unknown,
): SyntheticChallengeSet | SyntheticCaseAdmissionFailure {
  const scan = scanInput(input);
  if (scan) return deny(scan.code, scan.path);
  const proxy = proxyIssue(input);
  if (proxy) return deny(proxy.code, proxy.path);
  if (admittedPlan === undefined)
    return deny("missing_admitted_plan", "/admitted_plan");
  // The coverage plan is already admitted by its own lane.  Still perform
  // the same representation scan (proxy/accessor/symbol/cycle/sparse), but
  // do not apply the case lane's source/evidence/url field deny-list to the
  // plan metadata itself.  The exact snapshot envelope and coverage brand
  // are checked below before any target is read.
  const planScan = scanInput(admittedPlan, false);
  if (planScan) return deny(planScan.code, `/admitted_plan${planScan.path}`);
  const planProxy = proxyIssue(admittedPlan);
  if (planProxy) return deny(planProxy.code, `/admitted_plan${planProxy.path}`);

  const parsed = readSetInput(input);
  if ("ok" in parsed) return parsed;
  const targetIds = validateAdmittedPlan(admittedPlan);
  if (!(targetIds instanceof Set)) return targetIds;
  for (const targetId of targetIds) {
    if (!IDENTIFIER_PATTERN.test(targetId))
      return deny("admitted_plan_invalid", "/admitted_plan");
  }

  const seenCaseIds = new Set<string>();
  const seenPaths = new Set<string>();
  const cases: SyntheticCase[] = [];
  const rawCases = parsed.cases as readonly unknown[];
  for (const [index, item] of rawCases.entries()) {
    const normalized = normalizeCase(
      item,
      `/cases/${index}`,
      targetIds,
      seenCaseIds,
      seenPaths,
    );
    if (!("capability" in normalized)) return normalized;
    cases.push(normalized);
  }
  cases.sort((left, right) =>
    left.case_id < right.case_id ? -1 : left.case_id > right.case_id ? 1 : 0,
  );
  return Object.freeze({
    version: parsed.version,
    cases: Object.freeze(cases),
  });
}

/**
 * Admit a v1 synthetic challenge set against a host-admitted coverage plan.
 * The result is a frozen, sorted projection; no caller object is returned.
 */
export function admitSyntheticChallengeSet(
  input: unknown,
  admittedPlan?: unknown,
): SyntheticCaseAdmissionResult {
  try {
    const normalized = normalizeChallengeSet(input, admittedPlan);
    if ("ok" in normalized) return normalized;
    const challengeSet = deepFreeze(normalized);
    ADMITTED_SYNTHETIC_CHALLENGE_SETS.add(challengeSet);
    ADMITTED_SYNTHETIC_PLAN_BINDINGS.set(
      challengeSet,
      admittedPlan as AdmittedChallengeCoveragePlan,
    );
    return Object.freeze({
      ok: true as const,
      challenge_set: challengeSet,
    });
  } catch (error) {
    if (error instanceof SyntheticCaseAdmissionError)
      return deny(error.code, error.path);
    return deny("invalid_schema", "/");
  }
}

/** Compatibility spelling used by callers that focus on the case lane. */
export const admitSyntheticCases = admitSyntheticChallengeSet;
export const admitSyntheticCaseSet = admitSyntheticChallengeSet;
export const createSyntheticChallengeSet = admitSyntheticChallengeSet;
export const createSyntheticCaseSet = admitSyntheticChallengeSet;

/** Admit one case, returning the same result envelope as the set API. */
export function admitSyntheticCase(
  input: unknown,
  admittedPlan?: unknown,
):
  | { readonly ok: true; readonly case: SyntheticCase }
  | SyntheticCaseAdmissionFailure {
  const result = admitSyntheticChallengeSet(
    { version: SYNTHETIC_CASE_SET_VERSION, cases: [input] },
    admittedPlan,
  );
  if (!result.ok) return result;
  const admittedCase = result.challenge_set.cases[0];
  if (!admittedCase) return deny("invalid_schema", "/cases/0");
  return Object.freeze({ ok: true as const, case: admittedCase });
}

/** Throwing assertion for trusted callers that need a typed frozen set. */
export function assertSyntheticChallengeSet(
  input: unknown,
  admittedPlan?: unknown,
): SyntheticChallengeSet {
  const result = admitSyntheticChallengeSet(input, admittedPlan);
  if (!result.ok) throw new SyntheticCaseAdmissionError(result.denial);
  return result.challenge_set;
}

export const assertSyntheticCases = assertSyntheticChallengeSet;
export const assertSyntheticCaseSet = assertSyntheticChallengeSet;

/** Throwing assertion for the singular-case helper. */
export function assertSyntheticCase(
  input: unknown,
  admittedPlan?: unknown,
): SyntheticCase {
  const result = admitSyntheticCase(input, admittedPlan);
  if (!result.ok) throw new SyntheticCaseAdmissionError(result.denial);
  return result.case;
}

export const tryAdmitSyntheticChallengeSet = admitSyntheticChallengeSet;
export const validateSyntheticChallengeSet = assertSyntheticChallengeSet;

/**
 * Return whether `value` is the exact challenge-set object emitted by this
 * lane in this process.  The check performs no property dereference, so a
 * hostile proxy or revoked proxy is simply not an admitted capability.
 */
export function isAdmittedSyntheticChallengeSet(
  value: unknown,
  admittedPlan?: unknown,
): value is SyntheticChallengeSet {
  const admitted =
    (typeof value === "object" && value !== null) || typeof value === "function"
      ? ADMITTED_SYNTHETIC_CHALLENGE_SETS.has(value)
      : false;
  if (!admitted || admittedPlan === undefined) return admitted;
  return ADMITTED_SYNTHETIC_PLAN_BINDINGS.get(value as object) === admittedPlan;
}

function canonicalize(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("non_finite_number");
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(object[key])}`)
      .join(",")}}`;
  }
  throw new TypeError("unsupported_canonical_type");
}

/** Canonical sorted JSON for an admitted challenge set. */
export function canonicalSyntheticChallengeSet(
  input: unknown,
  admittedPlan?: unknown,
): string {
  return canonicalize(assertSyntheticChallengeSet(input, admittedPlan));
}

export const canonicalizeSyntheticChallengeSet = canonicalSyntheticChallengeSet;
export const canonicalSyntheticCaseSet = canonicalSyntheticChallengeSet;
export const canonicalizeSyntheticCaseSet = canonicalSyntheticChallengeSet;

/** Stable SHA-256 over the canonical challenge-set projection. */
export function hashSyntheticChallengeSet(
  input: unknown,
  admittedPlan?: unknown,
): Sha256 {
  return `sha256:${createHash("sha256")
    .update(canonicalSyntheticChallengeSet(input, admittedPlan), "utf8")
    .digest("hex")}` as Sha256;
}

export const syntheticChallengeSetHash = hashSyntheticChallengeSet;
export const hashSyntheticCaseSet = hashSyntheticChallengeSet;

/** Synthetic cases are deliberately excluded from both evidence and golden coverage. */
export function contributesToEvidenceCoverage(
  value: unknown,
  admittedPlan?: unknown,
): false {
  assertSyntheticChallengeSet(value, admittedPlan);
  return false;
}

export const doesNotSatisfyEvidenceCoverage = contributesToEvidenceCoverage;
