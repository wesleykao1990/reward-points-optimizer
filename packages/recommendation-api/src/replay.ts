import {
  type CanonicalSnapshot,
  canonicalSnapshot,
  isSha256,
  M5SecurityError,
} from "./security.js";

export type ReplayClass = "synthetic" | "golden_fixture" | "redacted_incident";

export type ReplayDenialCode =
  | "replay_class_invalid"
  | "trusted_context_missing"
  | "actor_scope_missing"
  | "actor_scope_invalid"
  | "payload_missing"
  | "payload_hash_missing"
  | "payload_hash_invalid"
  | "payload_hash_mismatch"
  | "prohibited_payload"
  | "user_data_present"
  | "redacted_payload_invalid"
  | "redacted_approval_missing"
  | "redacted_approval_invalid"
  | "sealed_required"
  | "time_missing"
  | "time_invalid"
  | "engine_version_missing"
  | "rules_version_missing"
  | "valuation_version_missing"
  | "forbidden_replay_surface";

export interface ReplayBlocker {
  readonly code: ReplayDenialCode;
  readonly path: string;
}

export interface TrustedIncidentApproval {
  readonly kind: "m5_trusted_incident_approval";
  readonly approval_id: string;
  readonly replay_class: "redacted_incident";
  readonly request_sha256: `sha256:${string}`;
  readonly result_sha256: `sha256:${string}`;
  readonly verified: true;
}

export interface TrustedReplayActorAuthorization {
  readonly kind: "m5_trusted_replay_actor";
  readonly replay_class: ReplayClass;
  readonly scopes: readonly string[];
  readonly request_sha256: `sha256:${string}`;
  readonly result_sha256: `sha256:${string}`;
  readonly verified: true;
}

export interface TrustedFixtureManifest {
  readonly kind: "m5_trusted_fixture_manifest";
  readonly replay_class: "synthetic" | "golden_fixture";
  readonly manifest_id: string;
  readonly manifest_sha256: `sha256:${string}`;
  readonly request_sha256: `sha256:${string}`;
  readonly result_sha256: `sha256:${string}`;
  readonly immutable: true;
  readonly verified: true;
}

export interface ReplayAuthorizationContext {
  /** Host-authenticated actor capability, never taken from ReplayInput. */
  readonly authorizeActor: (request: {
    readonly replay_class: ReplayClass;
    readonly requested_scopes: readonly string[];
    readonly request_sha256: `sha256:${string}`;
    readonly result_sha256: `sha256:${string}`;
  }) => TrustedReplayActorAuthorization | null;
  /** Verifies an immutable fixture manifest and binds it to both payloads. */
  readonly verifyFixtureManifest?: (request: {
    readonly replay_class: "synthetic" | "golden_fixture";
    readonly manifest_id: string;
    readonly manifest_sha256: string;
    readonly request_sha256: `sha256:${string}`;
    readonly result_sha256: `sha256:${string}`;
  }) => TrustedFixtureManifest | null;
  /** Verifies an incident approval bound to this exact redacted payload. */
  readonly verifyIncidentApproval?: (request: {
    readonly approval_id: string;
    readonly replay_class: "redacted_incident";
    readonly request_sha256: `sha256:${string}`;
    readonly result_sha256: `sha256:${string}`;
  }) => TrustedIncidentApproval | null;
}

/** Alias emphasizing that this is a host capability port, not input data. */
export type ReplayAuthorizationPort = ReplayAuthorizationContext;

export interface ReplayInput {
  readonly replay_class?: string;
  readonly replay_kind?: string;
  readonly artifact_class?: string;
  readonly actor_scopes?: readonly string[];
  readonly actor?: unknown;
  readonly request?: unknown;
  readonly result?: unknown;
  readonly request_payload?: unknown;
  readonly result_payload?: unknown;
  readonly request_snapshot?: unknown;
  readonly result_snapshot?: unknown;
  readonly request_sha256?: string;
  readonly result_sha256?: string;
  readonly request_hash?: string;
  readonly result_hash?: string;
  readonly contains_user_data?: boolean;
  readonly sealed?: boolean;
  readonly transaction_time?: string;
  readonly replay_knowledge_at?: string;
  readonly created_at?: string;
  readonly engine_version?: string;
  readonly rule_engine_version?: string;
  readonly rules_version?: string;
  readonly canonical_rules_version?: string;
  readonly valuation_version?: string;
  readonly valuation_profile_version?: string;
  readonly versions?: unknown;
  readonly approval_id?: string;
  readonly approval?: unknown;
  readonly fixture_manifest_id?: string;
  readonly fixture_manifest_sha256?: string;
  readonly redacted_payload?: unknown;
  readonly [key: string]: unknown;
}

export interface ReplayArtifact {
  readonly artifact_id: string;
  readonly replay_class: ReplayClass;
  readonly sealed: true;
  readonly contains_user_data: false;
  readonly request_sha256: `sha256:${string}`;
  readonly result_sha256: `sha256:${string}`;
  readonly request_snapshot: CanonicalSnapshot<unknown>;
  readonly result_snapshot: CanonicalSnapshot<unknown>;
  readonly transaction_time: string;
  readonly replay_knowledge_at: string;
  readonly created_at: string;
  readonly engine_version: string;
  readonly rules_version: string;
  readonly valuation_version: string;
  readonly approval_id: string | null;
  readonly fixture_manifest_id: string | null;
  readonly fixture_manifest_sha256: `sha256:${string}` | null;
  readonly redacted_payload: Readonly<Record<string, unknown>> | null;
}

export interface ReplayDecision {
  readonly allowed: boolean;
  readonly artifact: ReplayArtifact | null;
  readonly blockers: readonly ReplayBlocker[];
}

export class ReplayDeniedError extends Error {
  readonly code = "m5_replay_denied" as const;
  readonly blockers: readonly ReplayBlocker[];

  constructor(blockers: readonly ReplayBlocker[]) {
    const stable = uniqueBlockers(blockers);
    super(
      `M5_REPLAY_DENIED:${stable.map((item) => `${item.code}@${item.path}`).join(",")}`,
    );
    this.name = "ReplayDeniedError";
    this.blockers = Object.freeze(stable);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

const REPLAY_SCOPES = new Set([
  "replay:build",
  "replay:write",
  "replay:authorize",
  "replay:canonical",
  "canonical_replay",
  "internal:replay",
  "replay_admin",
]);

const INCIDENT_SCOPES = new Set([
  "replay:incident",
  "replay:redacted_incident",
]);

// Approval is a host capability, not replay input.  In particular, accepting
// `{ approval: { authorized: true } }` or an equivalent legacy flag would let
// the caller self-mint the approval that the host port is supposed to bind to
// the exact request/result hashes.  Keep this list normalized so spelling and
// punctuation variants cannot bypass the boundary.
const CALLER_APPROVAL_KEYS = new Set([
  "approval",
  "approvalreference",
  "approvalproof",
  "approvaltoken",
  "approvalauthorized",
  "approvalgranted",
  "approvalstatus",
  "approvaldecision",
  "approvalauthorization",
  "authorized",
  "approved",
  "incidentapproval",
  "trustedapproval",
  "trustedincidentapproval",
  "authorizationproof",
  "authorizationtoken",
]);

const RESTRICTED_KEYS = new Set([
  "userid",
  "userref",
  "email",
  "phone",
  "address",
  "location",
  "wallet",
  "walletcomposition",
  "facts",
  "userfacts",
  "lots",
  "valuation",
  "valuationprofile",
  "lineitem",
  "lineitems",
  "transaction",
  "transactions",
  "receipt",
  "receipts",
  "profile",
  "personal",
  "capprogress",
  "account",
  "accountid",
  "accountnumber",
  "aggregationtoken",
  "barcode",
  "campaign",
  "campaigntargeting",
  "cap",
  "correction",
  "customer",
  "customeremail",
  "customerid",
  "customerphone",
  "loyalty",
  "loyaltybarcode",
  "paymenthistory",
  "personaldata",
  "pii",
  "pointlots",
  "storedvalue",
  "tier",
  "userprofile",
  "userstate",
]);

const REDACTED_PAYLOAD_ALLOWLIST = new Set([
  "fixture_id",
  "incident_id",
  "scenario_id",
  "merchant_id",
  "branch_id",
  "rule_ids",
  "request_sha256",
  "result_sha256",
  "reason_codes",
  "evidence_refs",
  "redaction_version",
  "summary",
  "approved_at",
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizedKey(key: string): string {
  return key
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function pathSegment(key: string): string {
  const normalized = normalizedKey(key);
  if (
    normalized.includes("token") ||
    normalized.includes("secret") ||
    normalized.includes("password") ||
    normalized.includes("card") ||
    normalized.includes("pin") ||
    normalized.includes("credential") ||
    normalized.includes("securitycode") ||
    normalized.includes("apikey") ||
    normalized.includes("accesskey")
  )
    return "~redacted";
  return key.replaceAll("~", "~0").replaceAll("/", "~1");
}

function childPath(path: string, key: string): string {
  const segment = pathSegment(key);
  return path === "/" ? `/${segment}` : `${path}/${segment}`;
}

function parseReplayClass(input: ReplayInput): ReplayClass | null {
  const value = input.replay_class ?? input.replay_kind ?? input.artifact_class;
  if (typeof value !== "string") return null;
  const normalized = value.toLowerCase().replace(/[ -]/g, "_");
  if (normalized === "synthetic" || normalized === "synthetic_fixture")
    return "synthetic";
  if (
    normalized === "golden" ||
    normalized === "golden_fixture" ||
    normalized === "golden_benchmark"
  )
    return "golden_fixture";
  if (
    normalized === "redacted_incident" ||
    normalized === "approved_redacted_incident"
  )
    return "redacted_incident";
  return null;
}

function readScopes(input: ReplayInput): readonly string[] {
  const actor = asRecord(input.actor);
  const scopes = input.actor_scopes ?? actor?.scopes;
  if (
    !Array.isArray(scopes) ||
    scopes.length === 0 ||
    !scopes.every((item) => typeof item === "string" && item.length > 0)
  )
    return [];
  return [...new Set(scopes as string[])];
}

function parseAbsoluteTime(value: unknown): string | null {
  if (typeof value !== "string" || !/(?:Z|[+-]\d{2}:?\d{2})$/u.test(value))
    return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString();
}

function readVersion(
  input: ReplayInput,
  directKeys: readonly string[],
  nestedKeys: readonly string[],
): string | null {
  for (const key of directKeys) {
    const value = input[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  const versions = asRecord(input.versions);
  if (versions) {
    for (const key of nestedKeys) {
      const value = versions[key];
      if (typeof value === "string" && value.length > 0) return value;
    }
  }
  return null;
}

function hasForbiddenSurface(input: ReplayInput): string | null {
  for (const key of Object.keys(input)) {
    const normalized = normalizedKey(key);
    if (
      normalized === "clientlookup" ||
      normalized === "clientfacinglookup" ||
      normalized === "lookup" ||
      normalized === "token" ||
      normalized === "replaytoken" ||
      normalized === "agentfeedreplay" ||
      normalized === "persist" ||
      normalized === "persistence"
    ) {
      return childPath("/", key);
    }
  }
  return null;
}

function hasCallerSuppliedApproval(input: ReplayInput): string | null {
  // Reflect only keys: values are intentionally not read, copied, or sent to
  // the authorization port before the host has authenticated the request.
  for (const key of Object.keys(input)) {
    const normalized = normalizedKey(key);
    // `approval_id` is an opaque lookup/authorization request identifier.  It
    // is acceptable as input; the host must still return a proof bound to it.
    if (normalized === "approvalid") continue;
    if (CALLER_APPROVAL_KEYS.has(normalized)) return childPath("/", key);
  }
  return null;
}

interface UserScanContext {
  readonly blockers: ReplayBlocker[];
  readonly active: Set<object>;
}

function scanUserData(
  value: unknown,
  path: string,
  context: UserScanContext,
): void {
  if (typeof value === "string") {
    // Restricted data is denied by value as well as by field name.  This
    // catches PII hidden under an innocent key such as `contact` or `extra`.
    if (
      /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu.test(value) ||
      /\+?\d[\d\s().-]{7,}\d/u.test(value)
    ) {
      context.blockers.push(Object.freeze({ code: "user_data_present", path }));
    }
    return;
  }
  if (value === null || typeof value === "boolean" || typeof value === "number")
    return;
  if (typeof value !== "object") return;
  if (context.active.has(value)) {
    context.blockers.push(Object.freeze({ code: "user_data_present", path }));
    return;
  }
  const record = asRecord(value);
  if (Array.isArray(value)) {
    context.active.add(value);
    for (let index = 0; index < value.length; index += 1)
      scanUserData(value[index], `${path}/${index}`, context);
    context.active.delete(value);
    return;
  }
  if (!record) return;
  context.active.add(value);
  for (const [key, child] of Object.entries(record)) {
    const normalized = normalizedKey(key);
    if (RESTRICTED_KEYS.has(normalized)) {
      context.blockers.push(
        Object.freeze({
          code: "user_data_present",
          path: childPath(path, key),
        }),
      );
    }
    scanUserData(child, childPath(path, key), context);
  }
  context.active.delete(value);
}

function assertNoUserData(value: unknown): void {
  const context: UserScanContext = {
    blockers: [],
    active: new Set<object>(),
  };
  scanUserData(value, "/", context);
  const blockers = uniqueBlockers(context.blockers);
  if (blockers.length > 0) throw new ReplayDeniedError(blockers);
}

function snapshotPayload(
  input: ReplayInput,
  kind: "request" | "result",
): { snapshot: CanonicalSnapshot<unknown>; hash: `sha256:${string}` } {
  const payload = input[`${kind}_payload`] ?? input[kind];
  const suppliedSnapshot = input[`${kind}_snapshot`];
  const declared =
    input[`${kind}_sha256`] ??
    input[`${kind}_hash`] ??
    hashFromSnapshot(suppliedSnapshot);
  const value =
    payload !== undefined ? payload : valueFromSnapshot(suppliedSnapshot);
  if (value === undefined)
    throw new ReplayDeniedError([
      { code: "payload_missing", path: `/${kind}` },
    ]);
  if (declared === undefined)
    throw new ReplayDeniedError([
      { code: "payload_hash_missing", path: `/${kind}_sha256` },
    ]);
  let snapshot: CanonicalSnapshot<unknown>;
  try {
    snapshot = canonicalSnapshot(value);
  } catch (error) {
    if (error instanceof M5SecurityError)
      throw new ReplayDeniedError([
        { code: "prohibited_payload", path: `/${kind}` },
      ]);
    throw new ReplayDeniedError([
      { code: "payload_hash_invalid", path: `/${kind}` },
    ]);
  }
  assertNoUserData(snapshot.value);
  if (declared !== undefined && !isSha256(declared))
    throw new ReplayDeniedError([
      { code: "payload_hash_invalid", path: `/${kind}_sha256` },
    ]);
  if (declared !== undefined && declared !== snapshot.sha256)
    throw new ReplayDeniedError([
      { code: "payload_hash_mismatch", path: `/${kind}_sha256` },
    ]);
  return { snapshot, hash: snapshot.sha256 };
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

function normalizedTrustedValue(
  value: unknown,
): Record<string, unknown> | null {
  try {
    return asRecord(canonicalSnapshot(value).value);
  } catch {
    return null;
  }
}

function validTrustedActor(
  value: unknown,
  replay_class: ReplayClass,
  request_sha256: `sha256:${string}`,
  result_sha256: `sha256:${string}`,
): TrustedReplayActorAuthorization | null {
  const record = normalizedTrustedValue(value);
  if (
    !record ||
    record.kind !== "m5_trusted_replay_actor" ||
    record.replay_class !== replay_class ||
    record.verified !== true ||
    record.request_sha256 !== request_sha256 ||
    record.result_sha256 !== result_sha256 ||
    !Array.isArray(record.scopes) ||
    !record.scopes.every(
      (scope): scope is string => typeof scope === "string" && scope.length > 0,
    )
  ) {
    return null;
  }
  const acceptedScopes =
    replay_class === "redacted_incident" ? INCIDENT_SCOPES : REPLAY_SCOPES;
  if (!record.scopes.some((scope) => acceptedScopes.has(scope))) return null;
  return Object.freeze({
    kind: "m5_trusted_replay_actor",
    replay_class,
    scopes: Object.freeze([...new Set(record.scopes)]),
    request_sha256,
    result_sha256,
    verified: true,
  });
}

function validFixtureManifest(
  value: unknown,
  replay_class: "synthetic" | "golden_fixture",
  request_sha256: `sha256:${string}`,
  result_sha256: `sha256:${string}`,
  expected_id: string,
  expected_hash: string,
): TrustedFixtureManifest | null {
  const record = normalizedTrustedValue(value);
  if (
    !record ||
    record.kind !== "m5_trusted_fixture_manifest" ||
    record.replay_class !== replay_class ||
    record.verified !== true ||
    record.immutable !== true ||
    typeof record.manifest_id !== "string" ||
    record.manifest_id.length === 0 ||
    record.manifest_id !== expected_id ||
    !isSha256(record.manifest_sha256) ||
    record.manifest_sha256 !== expected_hash ||
    record.request_sha256 !== request_sha256 ||
    record.result_sha256 !== result_sha256
  ) {
    return null;
  }
  return Object.freeze({
    kind: "m5_trusted_fixture_manifest",
    replay_class,
    manifest_id: record.manifest_id,
    manifest_sha256: record.manifest_sha256,
    request_sha256,
    result_sha256,
    immutable: true,
    verified: true,
  });
}

function validIncidentApproval(
  value: unknown,
  approval_id: string,
  request_sha256: `sha256:${string}`,
  result_sha256: `sha256:${string}`,
): TrustedIncidentApproval | null {
  const record = normalizedTrustedValue(value);
  if (
    !record ||
    record.kind !== "m5_trusted_incident_approval" ||
    record.replay_class !== "redacted_incident" ||
    record.verified !== true ||
    typeof record.approval_id !== "string" ||
    record.approval_id.length === 0 ||
    record.approval_id !== approval_id ||
    record.request_sha256 !== request_sha256 ||
    record.result_sha256 !== result_sha256
  ) {
    return null;
  }
  return Object.freeze({
    kind: "m5_trusted_incident_approval",
    approval_id,
    replay_class: "redacted_incident",
    request_sha256,
    result_sha256,
    verified: true,
  });
}

function copyRedactedPayload(
  value: unknown,
): Readonly<Record<string, unknown>> {
  if (value === undefined)
    throw new ReplayDeniedError([
      { code: "redacted_payload_invalid", path: "/redacted_payload" },
    ]);
  let admitted: unknown;
  try {
    admitted = canonicalSnapshot(value).value;
  } catch {
    throw new ReplayDeniedError([
      { code: "prohibited_payload", path: "/redacted_payload" },
    ]);
  }
  const record = asRecord(admitted);
  if (!record)
    throw new ReplayDeniedError([
      { code: "redacted_payload_invalid", path: "/redacted_payload" },
    ]);
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(record)) {
    if (!REDACTED_PAYLOAD_ALLOWLIST.has(key))
      throw new ReplayDeniedError([
        {
          code: "redacted_payload_invalid",
          path: childPath("/redacted_payload", key),
        },
      ]);
    if (typeof child === "object" && child !== null) {
      try {
        canonicalSnapshot(child);
      } catch {
        throw new ReplayDeniedError([
          {
            code: "prohibited_payload",
            path: childPath("/redacted_payload", key),
          },
        ]);
      }
    }
    output[key] = cloneFrozen(child);
  }
  assertNoUserData(output);
  return Object.freeze(output);
}

function cloneFrozen<T>(value: T, active = new Set<object>()): T {
  if (!value || typeof value !== "object") return value;
  if (active.has(value))
    throw new ReplayDeniedError([
      { code: "redacted_payload_invalid", path: "/redacted_payload" },
    ]);
  active.add(value);
  let cloned: unknown;
  if (Array.isArray(value))
    cloned = value.map((child) => cloneFrozen(child, active));
  else {
    const record = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort())
      output[key] = cloneFrozen(record[key], active);
    cloned = output;
  }
  active.delete(value);
  return Object.freeze(cloned) as T;
}

function uniqueBlockers(blockers: readonly ReplayBlocker[]): ReplayBlocker[] {
  const seen = new Set<string>();
  const result: ReplayBlocker[] = [];
  for (const blocker of blockers) {
    const key = `${blocker.code}\u0000${blocker.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(Object.freeze({ code: blocker.code, path: blocker.path }));
  }
  return result;
}

function denied(blockers: readonly ReplayBlocker[]): ReplayDecision {
  return Object.freeze({
    allowed: false,
    artifact: null,
    blockers: Object.freeze(uniqueBlockers(blockers)),
  });
}

/**
 * Authorize a canonical replay artifact.  This is an in-process pure gate;
 * it has no client lookup, token issuance, Agent Feed replay, or persistence.
 */
export function authorizeReplay(
  input: ReplayInput,
  authorizationContext?: ReplayAuthorizationContext,
): ReplayDecision {
  try {
    const replay_class = parseReplayClass(input);
    if (!replay_class)
      return denied([{ code: "replay_class_invalid", path: "/replay_class" }]);
    const scopes = readScopes(input);
    if (scopes.length === 0)
      return denied([{ code: "actor_scope_missing", path: "/actor_scopes" }]);
    if (!scopes.every((scope) => typeof scope === "string" && scope.length > 0))
      return denied([{ code: "actor_scope_invalid", path: "/actor_scopes" }]);
    if (
      !authorizationContext ||
      typeof authorizationContext.authorizeActor !== "function"
    )
      return denied([
        { code: "trusted_context_missing", path: "/authorization" },
      ]);
    const callerApproval = hasCallerSuppliedApproval(input);
    if (callerApproval)
      return denied([
        { code: "redacted_approval_invalid", path: callerApproval },
      ]);
    const forbidden = hasForbiddenSurface(input);
    if (forbidden)
      return denied([{ code: "forbidden_replay_surface", path: forbidden }]);
    if (input.sealed !== true)
      return denied([{ code: "sealed_required", path: "/sealed" }]);

    const transaction_time = parseAbsoluteTime(input.transaction_time);
    const replay_knowledge_at = parseAbsoluteTime(input.replay_knowledge_at);
    const created_at = parseAbsoluteTime(input.created_at);
    if (!transaction_time)
      return denied([{ code: "time_missing", path: "/transaction_time" }]);
    if (!replay_knowledge_at)
      return denied([{ code: "time_invalid", path: "/replay_knowledge_at" }]);
    if (!created_at)
      return denied([{ code: "time_invalid", path: "/created_at" }]);

    const engine_version = readVersion(
      input,
      ["engine_version", "rule_engine_version"],
      ["engine", "rule_engine"],
    );
    const rules_version = readVersion(
      input,
      ["rules_version", "canonical_rules_version"],
      ["rules", "canonical_rules"],
    );
    const valuation_version = readVersion(
      input,
      ["valuation_version", "valuation_profile_version"],
      ["valuation", "valuation_profile"],
    );
    if (!engine_version)
      return denied([
        { code: "engine_version_missing", path: "/engine_version" },
      ]);
    if (!rules_version)
      return denied([
        { code: "rules_version_missing", path: "/rules_version" },
      ]);
    if (!valuation_version)
      return denied([
        { code: "valuation_version_missing", path: "/valuation_version" },
      ]);

    const request = snapshotPayload(input, "request");
    const result = snapshotPayload(input, "result");
    let actorAuthorization: TrustedReplayActorAuthorization | null = null;
    try {
      const candidate = authorizationContext.authorizeActor({
        replay_class,
        requested_scopes: Object.freeze([...scopes]),
        request_sha256: request.hash,
        result_sha256: result.hash,
      });
      actorAuthorization = validTrustedActor(
        candidate,
        replay_class,
        request.hash,
        result.hash,
      );
    } catch {
      actorAuthorization = null;
    }
    if (!actorAuthorization)
      return denied([
        { code: "actor_scope_invalid", path: "/authorization/actor" },
      ]);

    let approval_id: string | null = null;
    let fixture_manifest_id: string | null = null;
    let fixture_manifest_sha256: `sha256:${string}` | null = null;
    let redacted_payload: Readonly<Record<string, unknown>> | null = null;
    if (replay_class === "synthetic" || replay_class === "golden_fixture") {
      if (
        typeof input.fixture_manifest_id !== "string" ||
        input.fixture_manifest_id.length === 0 ||
        typeof input.fixture_manifest_sha256 !== "string" ||
        !isSha256(input.fixture_manifest_sha256) ||
        typeof authorizationContext.verifyFixtureManifest !== "function"
      )
        return denied([
          {
            code: "trusted_context_missing",
            path: "/authorization/fixture_manifest",
          },
        ]);
      let fixture: TrustedFixtureManifest | null = null;
      try {
        fixture = validFixtureManifest(
          authorizationContext.verifyFixtureManifest({
            replay_class,
            manifest_id: input.fixture_manifest_id,
            manifest_sha256: input.fixture_manifest_sha256,
            request_sha256: request.hash,
            result_sha256: result.hash,
          }),
          replay_class,
          request.hash,
          result.hash,
          input.fixture_manifest_id,
          input.fixture_manifest_sha256,
        );
      } catch {
        fixture = null;
      }
      if (!fixture)
        return denied([
          {
            code: "actor_scope_invalid",
            path: "/authorization/fixture_manifest",
          },
        ]);
      fixture_manifest_id = fixture.manifest_id;
      fixture_manifest_sha256 = fixture.manifest_sha256;
      if (input.redacted_payload !== undefined) {
        return denied([
          {
            code: "redacted_payload_invalid",
            path: "/redacted_payload",
          },
        ]);
      }
    } else {
      if (
        typeof input.approval_id !== "string" ||
        input.approval_id.length === 0 ||
        typeof authorizationContext.verifyIncidentApproval !== "function"
      )
        return denied([
          { code: "redacted_approval_missing", path: "/approval" },
        ]);
      let approval: TrustedIncidentApproval | null = null;
      try {
        approval = validIncidentApproval(
          authorizationContext.verifyIncidentApproval({
            approval_id: input.approval_id,
            replay_class: "redacted_incident",
            request_sha256: request.hash,
            result_sha256: result.hash,
          }),
          input.approval_id,
          request.hash,
          result.hash,
        );
      } catch {
        approval = null;
      }
      if (!approval)
        return denied([
          { code: "redacted_approval_invalid", path: "/approval" },
        ]);
      approval_id = approval.approval_id;
      redacted_payload = copyRedactedPayload(input.redacted_payload);
    }

    const metadata = {
      replay_class,
      sealed: true as const,
      contains_user_data: false as const,
      request_sha256: request.hash,
      result_sha256: result.hash,
      transaction_time,
      replay_knowledge_at,
      created_at,
      engine_version,
      rules_version,
      valuation_version,
      approval_id,
      fixture_manifest_id,
      fixture_manifest_sha256,
      redacted_payload,
    };
    const artifact_id = `replay_${canonicalSnapshot(metadata).sha256.slice("sha256:".length, "sha256:".length + 32)}`;
    const artifact = cloneFrozen({
      artifact_id,
      ...metadata,
      request_snapshot: request.snapshot,
      result_snapshot: result.snapshot,
    }) as ReplayArtifact;
    return Object.freeze({
      allowed: true,
      artifact,
      blockers: Object.freeze([]),
    });
  } catch (error) {
    if (error instanceof ReplayDeniedError) return denied(error.blockers);
    return denied([{ code: "payload_hash_invalid", path: "/payload" }]);
  }
}

export function buildReplayArtifact(
  input: ReplayInput,
  authorizationContext?: ReplayAuthorizationContext,
): ReplayArtifact {
  const decision = authorizeReplay(input, authorizationContext);
  if (!decision.allowed || !decision.artifact)
    throw new ReplayDeniedError(decision.blockers);
  return decision.artifact;
}

export const buildCanonicalReplayArtifact = buildReplayArtifact;
export const authorizeCanonicalReplay = authorizeReplay;
