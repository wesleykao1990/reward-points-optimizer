import { types as utilTypes } from "node:util";
import {
  getNanacoCreditChargeRule,
  hashCandidate,
  hashCanonical,
  hashDefinition,
  isCanonicalProvisionalDateTime,
  NANACO_CREDIT_CHARGE_CANDIDATE,
  NANACO_CREDIT_CHARGE_CANDIDATE_ARTIFACT_HASH,
  NANACO_CREDIT_CHARGE_CLAIM_IDS,
  NANACO_CREDIT_CHARGE_DEFINITION_HASH,
  NANACO_CREDIT_CHARGE_EVIDENCE_IDS,
  NANACO_CREDIT_CHARGE_FINDING_ID,
  NANACO_CREDIT_CHARGE_RULE_ID,
  NANACO_CREDIT_CHARGE_SOURCE_IDS,
  type ProvisionalRuleCandidate,
  type Sha256,
  scanPublicValue,
} from "@jro/provisional-rules";
import type { QueryTarget } from "./adapter.js";

type NanacoCreditChargeRule = typeof NANACO_CREDIT_CHARGE_CANDIDATE.rule;

export const NANACO_CREDIT_CHARGE_ROUTE_VIEW =
  "app_api.p0_nanaco_credit_charge_experimental_route" as const;
export const NANACO_CREDIT_CHARGE_ROUTE_AT_FUNCTION =
  "app_api.p0_nanaco_credit_charge_experimental_route_at" as const;

export const NANACO_CREDIT_CHARGE_ROUTE_QUERY = `
select candidate_hash, definition_hash, candidate_id, candidate_payload,
       source_observation_key, observation_fingerprint, source_ids,
       p0_family_id, source_role_id, source_authority_role, status,
       to_char(machine_checked_at at time zone 'UTC',
               'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as machine_checked_at,
       to_char(admitted_at at time zone 'UTC',
               'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as admitted_at,
       route_id, claim_ids, evidence_ids,
       bound_source_ids, finding_id
  from app_api.p0_nanaco_credit_charge_experimental_route_at($1::timestamptz)
 order by candidate_hash asc
 limit 2
`;

export interface NanacoCreditChargeRouteRecord {
  readonly route_id: string;
  readonly candidate_id: string;
  readonly candidate_hash: Sha256;
  readonly definition_hash: Sha256;
  readonly finding_id: typeof NANACO_CREDIT_CHARGE_FINDING_ID;
  readonly claim_ids: readonly string[];
  readonly evidence_ids: readonly string[];
  readonly source_ids: readonly string[];
  readonly status: "active_experimental";
  readonly checked_at: string;
  readonly admitted_at: string;
  readonly valid_from: string;
  readonly valid_to: string | null;
  readonly reward_rule: NanacoCreditChargeRule;
}

export interface NanacoCreditChargeRouteStore {
  current(effectiveAt: string): Promise<NanacoCreditChargeRouteRecord>;
}

type JsonRecord = Record<string, unknown>;

const ROUTE_ROW_KEYS = Object.freeze([
  "candidate_hash",
  "definition_hash",
  "candidate_id",
  "candidate_payload",
  "source_observation_key",
  "observation_fingerprint",
  "source_ids",
  "p0_family_id",
  "source_role_id",
  "source_authority_role",
  "status",
  "machine_checked_at",
  "admitted_at",
  "route_id",
  "claim_ids",
  "evidence_ids",
  "bound_source_ids",
  "finding_id",
] as const);

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPlainRecord(value: unknown): value is JsonRecord {
  return (
    isRecord(value) &&
    !utilTypes.isProxy(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}

function hasExactKeys(value: JsonRecord, expected: readonly string[]): boolean {
  const actual = Reflect.ownKeys(value);
  return (
    actual.length === expected.length &&
    actual.every(
      (key) =>
        typeof key === "string" &&
        expected.includes(key) &&
        Object.getOwnPropertyDescriptor(value, key)?.enumerable === true,
    )
  );
}

function strictHash(value: unknown, field: string): Sha256 {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(value))
    throw new TypeError(`nanaco_credit_charge_${field}_invalid`);
  return value as Sha256;
}

function strictString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 160)
    throw new TypeError(`nanaco_credit_charge_${field}_invalid`);
  return value;
}

function strictDate(value: unknown, field: string): string {
  const text = strictString(value, field);
  if (!isCanonicalProvisionalDateTime(text))
    throw new TypeError(`nanaco_credit_charge_${field}_invalid`);
  return text;
}

function strictDateOrNull(value: unknown, field: string): string | null {
  return value === null ? null : strictDate(value, field);
}

function parseJson(value: unknown, field: string): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new TypeError(`nanaco_credit_charge_${field}_invalid`);
  }
}

function exactArray(
  value: unknown,
  expected: readonly string[],
  field: string,
): readonly string[] {
  const parsed = parseJson(value, field);
  if (
    !Array.isArray(parsed) ||
    parsed.length !== expected.length ||
    parsed.some(
      (item, index) => typeof item !== "string" || item !== expected[index],
    )
  )
    throw new TypeError(`nanaco_credit_charge_${field}_invalid`);
  return Object.freeze([...parsed]);
}

function candidatePayload(value: unknown): ProvisionalRuleCandidate {
  const parsed = parseJson(value, "candidate_payload");
  if (!isPlainRecord(parsed))
    throw new TypeError("nanaco_credit_charge_candidate_payload_invalid");
  const candidate = parsed as unknown as ProvisionalRuleCandidate;
  if (hashDefinition(candidate.rule) !== NANACO_CREDIT_CHARGE_DEFINITION_HASH)
    throw new TypeError("nanaco_credit_charge_definition_hash_invalid");
  if (
    hashCanonical(candidate.rule) !==
    hashCanonical(NANACO_CREDIT_CHARGE_CANDIDATE.rule)
  )
    throw new TypeError("nanaco_credit_charge_rule_payload_invalid");
  if (
    hashCandidate(candidate, NANACO_CREDIT_CHARGE_DEFINITION_HASH) !==
    NANACO_CREDIT_CHARGE_CANDIDATE_ARTIFACT_HASH
  )
    throw new TypeError("nanaco_credit_charge_candidate_hash_invalid");
  return candidate;
}

function rowToRecord(row: JsonRecord): NanacoCreditChargeRouteRecord {
  if (!hasExactKeys(row, ROUTE_ROW_KEYS))
    throw new TypeError("nanaco_credit_charge_route_row_invalid");
  const candidateHash = strictHash(row.candidate_hash, "candidate_hash");
  const definitionHash = strictHash(row.definition_hash, "definition_hash");
  if (candidateHash !== NANACO_CREDIT_CHARGE_CANDIDATE_ARTIFACT_HASH)
    throw new TypeError("nanaco_credit_charge_candidate_hash_invalid");
  if (definitionHash !== NANACO_CREDIT_CHARGE_DEFINITION_HASH)
    throw new TypeError("nanaco_credit_charge_definition_hash_invalid");
  const candidate = candidatePayload(row.candidate_payload);
  if (
    row.candidate_id !== candidate.candidate_id ||
    row.source_observation_key !== candidate.observation_id ||
    row.observation_fingerprint !== candidate.observation_fingerprint ||
    row.p0_family_id !== "point.nanaco" ||
    row.source_role_id !== "earn_rules" ||
    row.source_authority_role !== "primary" ||
    row.status !== "active_experimental"
  )
    throw new TypeError("nanaco_credit_charge_identity_binding_invalid");
  exactArray(row.source_ids, NANACO_CREDIT_CHARGE_SOURCE_IDS, "source_ids");
  exactArray(
    row.bound_source_ids,
    NANACO_CREDIT_CHARGE_SOURCE_IDS,
    "bound_source_ids",
  );
  const claimIds = exactArray(
    row.claim_ids,
    NANACO_CREDIT_CHARGE_CLAIM_IDS,
    "claim_ids",
  );
  const evidenceIds = exactArray(
    row.evidence_ids,
    NANACO_CREDIT_CHARGE_EVIDENCE_IDS,
    "evidence_ids",
  );
  const findingId = strictString(row.finding_id, "finding_id");
  if (findingId !== NANACO_CREDIT_CHARGE_FINDING_ID)
    throw new TypeError("nanaco_credit_charge_finding_id_invalid");
  const checkedAt = strictDate(row.machine_checked_at, "checked_at");
  const admittedAt = strictDate(row.admitted_at, "admitted_at");
  const validity = candidate.rule.validity;
  const validFrom = strictDate(validity.valid_from, "valid_from");
  const validTo = strictDateOrNull(validity.valid_to, "valid_to");
  if (candidate.rule.rule_id !== NANACO_CREDIT_CHARGE_RULE_ID)
    throw new TypeError("nanaco_credit_charge_rule_id_invalid");
  return Object.freeze({
    route_id: strictString(row.route_id, "route_id"),
    candidate_id: strictString(row.candidate_id, "candidate_id"),
    candidate_hash: candidateHash,
    definition_hash: definitionHash,
    finding_id: findingId,
    claim_ids: claimIds,
    evidence_ids: evidenceIds,
    source_ids: Object.freeze([...NANACO_CREDIT_CHARGE_SOURCE_IDS]),
    status: "active_experimental",
    checked_at: checkedAt,
    admitted_at: admittedAt,
    valid_from: validFrom,
    valid_to: validTo,
    reward_rule: structuredClone(candidate.rule),
  });
}

function admittedRow(value: unknown): NanacoCreditChargeRouteRecord {
  const scanned = scanPublicValue(value);
  if (!scanned.valid || !isPlainRecord(scanned.value))
    throw new TypeError("nanaco_credit_charge_route_row_invalid");
  return rowToRecord(scanned.value);
}

export function createPostgresNanacoCreditChargeRouteStore(
  target: QueryTarget,
): NanacoCreditChargeRouteStore {
  return Object.freeze({
    async current(effectiveAt: string): Promise<NanacoCreditChargeRouteRecord> {
      const result = await target.query<JsonRecord>(
        NANACO_CREDIT_CHARGE_ROUTE_QUERY,
        [effectiveAt],
      );
      if (result.rows.length !== 1 || result.rows[0] === undefined)
        throw new Error("nanaco_credit_charge_route_not_current");
      return admittedRow(result.rows[0]);
    },
  });
}

/** Test-facing strict reducer for a row returned by the route view. */
export function reduceNanacoCreditChargeRouteRow(
  row: unknown,
): NanacoCreditChargeRouteRecord {
  return admittedRow(row);
}

export function sealedNanacoCreditChargeRule(): NanacoCreditChargeRule {
  return getNanacoCreditChargeRule();
}
