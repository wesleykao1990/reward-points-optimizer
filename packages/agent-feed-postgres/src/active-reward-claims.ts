import { types as nodeTypes } from "node:util";
import type { SourceObservation } from "@jro/agent-feed-consumer";
import { tryValidateDocument } from "@jro/contracts";
import {
  hashCandidate,
  hashDefinition,
  isCanonicalProvisionalDateTime,
  type ProvisionalRuleCandidate,
  type Sha256,
  scanPublicValue,
} from "@jro/provisional-rules";
import type { QueryTarget } from "./adapter.js";

/**
 * The private function is intentionally the only database object read by
 * this adapter. It projects the generic active view plus the exact canonical
 * SourceObservation and one bounded source lead for server-side revalidation.
 */
export const ACTIVE_REWARD_CLAIM_CALCULATIONS_FUNCTION =
  "app_private.active_reward_claim_calculations_at" as const;

export const MAX_ACTIVE_REWARD_CLAIM_ROWS = 128 as const;
const ACTIVE_REWARD_CLAIM_ROW_LIMIT = MAX_ACTIVE_REWARD_CLAIM_ROWS + 1;

export const ACTIVE_REWARD_CLAIM_CALCULATIONS_QUERY = `
select candidate_hash, definition_hash, candidate_id, candidate_payload,
       p0_family_id, source_role_id, source_ids, observation,
       source_url, checked_at
  from ${ACTIVE_REWARD_CLAIM_CALCULATIONS_FUNCTION}($1::timestamptz)
 order by candidate_hash asc
 limit ${ACTIVE_REWARD_CLAIM_ROW_LIMIT}
`;

/** Descriptive aliases keep the read boundary easy to discover. */
export const ACTIVE_REWARD_CLAIMS_QUERY =
  ACTIVE_REWARD_CLAIM_CALCULATIONS_QUERY;
export const ACTIVE_REWARD_CLAIMS_FUNCTION =
  ACTIVE_REWARD_CLAIM_CALCULATIONS_FUNCTION;

export interface ActiveRewardClaimRecord {
  readonly candidate_hash: Sha256;
  readonly definition_hash: Sha256;
  readonly candidate_id: string;
  readonly candidate_payload: ProvisionalRuleCandidate;
  readonly p0_family_id: string;
  readonly source_role_id: string;
  readonly source_ids: readonly string[];
  /** Complete canonical SourceObservation document, including raw_attributes. */
  readonly observation: SourceObservation;
  /** One deterministic official HTTPS submitted-evidence URI, when available. */
  readonly source_url: string | null;
  /** Submitted-evidence captured_at, or the candidate machine-check time. */
  readonly checked_at: string;
}

export interface ActiveRewardClaimStore {
  readonly list: (
    effectiveAt: string,
  ) => Promise<readonly ActiveRewardClaimRecord[]>;
}

type JsonRecord = Record<string, unknown>;

const ACTIVE_REWARD_CLAIM_ROW_KEYS = Object.freeze([
  "candidate_hash",
  "definition_hash",
  "candidate_id",
  "candidate_payload",
  "p0_family_id",
  "source_role_id",
  "source_ids",
  "observation",
  "source_url",
  "checked_at",
] as const);

const CANDIDATE_KEYS = Object.freeze([
  "version",
  "candidate_id",
  "observation_id",
  "observation_fingerprint",
  "p0_family_id",
  "source_role_id",
  "source_authority_role",
  "source_ids",
  "rule",
  "extractor",
  "machine_check",
] as const);

const EXTRACTOR_KEYS = Object.freeze(["name", "version"] as const);
const MACHINE_CHECK_KEYS = Object.freeze([
  "checker",
  "checker_version",
  "checked_at",
  "checks",
] as const);
const MACHINE_CHECK_CHECKS_KEYS = Object.freeze([
  "representation_safe",
  "rule_structure",
  "rule_semantics",
  "observation_binding",
  "p0_coverage",
] as const);
const OBSERVATION_KEYS = Object.freeze([
  "observation_id",
  "agent_feed",
  "source_ids",
  "subjects",
  "change_type",
  "summary",
  "effective_time",
  "discovery_assessment",
  "submitted_evidence_refs",
  "canonical_evidence_ids",
  "semantic_fingerprint_version",
  "semantic_fingerprint",
  "status",
  "security_flags",
  "raw_attributes",
  "created_at",
  "updated_at",
] as const);

const AGENT_FEED_KEYS = Object.freeze([
  "protocol_version",
  "event_id",
  "stream_id",
  "run_id",
  "finding_id",
] as const);

const EFFECTIVE_TIME_KEYS = Object.freeze([
  "occurred_at",
  "effective_from",
  "effective_to",
] as const);

const DISCOVERY_ASSESSMENT_KEYS = Object.freeze([
  "source_authority_claim",
  "evidence_completeness",
  "agent_confidence",
] as const);

const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/u;
const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})$/u;

function isPlainRecord(value: unknown): value is JsonRecord {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    nodeTypes.isProxy(value)
  )
    return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value: JsonRecord, expected: readonly string[]): boolean {
  if (Object.getOwnPropertySymbols(value).length > 0) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actual = Object.keys(descriptors).sort();
  const wanted = [...expected].sort();
  return (
    actual.length === wanted.length &&
    actual.every(
      (key, index) =>
        key === wanted[index] &&
        descriptors[key]?.enumerable === true &&
        "value" in (descriptors[key] ?? {}),
    )
  );
}

function parseJson(value: unknown, field: string): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new TypeError(`active_reward_claim_${field}_invalid`);
  }
}

function scanned(value: unknown, field: string): unknown {
  const result = scanPublicValue(value);
  if (!result.valid)
    throw new TypeError(`active_reward_claim_${field}_invalid`);
  return result.value;
}

function strictString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 4096)
    throw new TypeError(`active_reward_claim_${field}_invalid`);
  return value;
}

function strictIdentifier(value: unknown, field: string): string {
  const text = strictString(value, field);
  if (!IDENTIFIER_PATTERN.test(text))
    throw new TypeError(`active_reward_claim_${field}_invalid`);
  return text;
}

function strictHash(value: unknown, field: string): Sha256 {
  if (typeof value !== "string" || !HASH_PATTERN.test(value))
    throw new TypeError(`active_reward_claim_${field}_invalid`);
  return value as Sha256;
}

function strictDate(value: unknown, field: string): string {
  const text = strictString(value, field);
  if (
    !ISO_TIMESTAMP_PATTERN.test(text) ||
    !isCanonicalProvisionalDateTime(text)
  )
    throw new TypeError(`active_reward_claim_${field}_invalid`);
  return text;
}

function strictStringArray(
  value: unknown,
  field: string,
  requireNonEmpty = true,
): readonly string[] {
  const parsed = parseJson(value, field);
  if (
    !Array.isArray(parsed) ||
    (requireNonEmpty && parsed.length === 0) ||
    parsed.some(
      (item) =>
        typeof item !== "string" ||
        item.length === 0 ||
        item.length > 4096 ||
        !IDENTIFIER_PATTERN.test(item),
    ) ||
    new Set(parsed).size !== parsed.length
  )
    throw new TypeError(`active_reward_claim_${field}_invalid`);
  return Object.freeze([...parsed]);
}

function parsedRecord(value: unknown, field: string): JsonRecord {
  const parsed = scanned(parseJson(value, field), field);
  if (!isPlainRecord(parsed))
    throw new TypeError(`active_reward_claim_${field}_invalid`);
  return parsed;
}

function booleanTrue(value: unknown, field: string): void {
  if (value !== true)
    throw new TypeError(`active_reward_claim_${field}_invalid`);
}

function sameArray(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((item, index) => item === right[index])
  );
}

function candidatePayload(
  value: unknown,
  rowCandidateHash: Sha256,
  rowDefinitionHash: Sha256,
  rowCandidateId: string,
  rowFamilyId: string,
  rowSourceRoleId: string,
  rowSourceIds: readonly string[],
): ProvisionalRuleCandidate {
  const candidate = parsedRecord(value, "candidate_payload");
  if (!exactKeys(candidate, CANDIDATE_KEYS))
    throw new TypeError("active_reward_claim_candidate_shape_invalid");
  if (candidate.version !== "provisional-rule-candidate.v1")
    throw new TypeError("active_reward_claim_candidate_version_invalid");
  const candidateId = strictIdentifier(candidate.candidate_id, "candidate_id");
  if (candidateId !== rowCandidateId)
    throw new TypeError("active_reward_claim_candidate_binding_invalid");
  const observationId = strictIdentifier(
    candidate.observation_id,
    "observation_id",
  );
  const observationFingerprint = strictHash(
    candidate.observation_fingerprint,
    "observation_fingerprint",
  );
  if (
    candidate.p0_family_id !== rowFamilyId ||
    candidate.source_role_id !== rowSourceRoleId ||
    candidate.source_authority_role !== "primary"
  )
    throw new TypeError("active_reward_claim_identity_binding_invalid");
  const candidateSourceIds = strictStringArray(
    candidate.source_ids,
    "candidate_source_ids",
  );
  if (!sameArray(candidateSourceIds, rowSourceIds))
    throw new TypeError("active_reward_claim_source_ids_invalid");

  const extractor = parsedRecord(candidate.extractor, "extractor");
  if (
    !exactKeys(extractor, EXTRACTOR_KEYS) ||
    extractor.name !== "reward-claim-compiler" ||
    extractor.version !== "1"
  )
    throw new TypeError("active_reward_claim_extractor_invalid");

  const machineCheck = parsedRecord(candidate.machine_check, "machine_check");
  if (!exactKeys(machineCheck, MACHINE_CHECK_KEYS))
    throw new TypeError("active_reward_claim_machine_check_shape_invalid");
  if (
    machineCheck.checker !== "reward-claim-compiler" ||
    machineCheck.checker_version !== "1"
  )
    throw new TypeError("active_reward_claim_machine_check_invalid");
  strictDate(machineCheck.checked_at, "machine_checked_at");
  const checks = parsedRecord(machineCheck.checks, "machine_check_checks");
  if (!exactKeys(checks, MACHINE_CHECK_CHECKS_KEYS))
    throw new TypeError("active_reward_claim_machine_check_shape_invalid");
  for (const key of MACHINE_CHECK_CHECKS_KEYS) booleanTrue(checks[key], key);

  const rule = parsedRecord(candidate.rule, "rule");
  const ruleValidation = tryValidateDocument(rule, "reward-rule");
  if (!ruleValidation.valid)
    throw new TypeError("active_reward_claim_rule_invalid");
  let definitionHash: Sha256;
  let candidateHash: Sha256;
  try {
    definitionHash = hashDefinition(rule);
    candidateHash = hashCandidate(
      candidate as unknown as ProvisionalRuleCandidate,
      definitionHash,
    );
  } catch {
    throw new TypeError("active_reward_claim_hash_invalid");
  }
  if (
    definitionHash !== rowDefinitionHash ||
    candidateHash !== rowCandidateHash
  )
    throw new TypeError("active_reward_claim_hash_binding_invalid");
  if (observationId.length === 0 || observationFingerprint.length === 0)
    throw new TypeError("active_reward_claim_observation_binding_invalid");

  return candidate as unknown as ProvisionalRuleCandidate;
}

function observationDocument(
  value: unknown,
  candidate: ProvisionalRuleCandidate,
): SourceObservation {
  const observation = parsedRecord(value, "observation");
  if (!exactKeys(observation, OBSERVATION_KEYS))
    throw new TypeError("active_reward_claim_observation_shape_invalid");
  if (
    observation.observation_id !== candidate.observation_id ||
    observation.semantic_fingerprint !== candidate.observation_fingerprint ||
    (observation.status !== "new" &&
      observation.status !== "duplicate" &&
      observation.status !== "needs_evidence" &&
      observation.status !== "needs_review" &&
      observation.status !== "closed") ||
    observation.security_flags === undefined
  )
    throw new TypeError("active_reward_claim_observation_binding_invalid");
  const observationSourceIds = strictStringArray(
    observation.source_ids,
    "observation_source_ids",
  );
  if (
    candidate.source_ids.some(
      (sourceId) => !observationSourceIds.includes(sourceId),
    )
  )
    throw new TypeError("active_reward_claim_observation_source_ids_invalid");
  if (
    !exactKeys(
      parsedRecord(observation.agent_feed, "observation_agent_feed"),
      AGENT_FEED_KEYS,
    ) ||
    !exactKeys(
      parsedRecord(observation.effective_time, "observation_effective_time"),
      EFFECTIVE_TIME_KEYS,
    ) ||
    !exactKeys(
      parsedRecord(
        observation.discovery_assessment,
        "observation_discovery_assessment",
      ),
      DISCOVERY_ASSESSMENT_KEYS,
    ) ||
    !isPlainRecord(observation.raw_attributes) ||
    !Array.isArray(observation.submitted_evidence_refs) ||
    !Array.isArray(observation.canonical_evidence_ids) ||
    !Array.isArray(observation.subjects) ||
    !Array.isArray(observation.security_flags) ||
    observation.security_flags.length !== 0
  )
    throw new TypeError("active_reward_claim_observation_shape_invalid");
  strictDate(observation.created_at, "observation_created_at");
  strictDate(observation.updated_at, "observation_updated_at");
  return observation as unknown as SourceObservation;
}

function sourceUrl(value: unknown): string | null {
  if (value === null) return null;
  const text = strictString(value, "source_url");
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    throw new TypeError("active_reward_claim_source_url_invalid");
  }
  if (parsed.protocol !== "https:" || parsed.hostname.length === 0) {
    throw new TypeError("active_reward_claim_source_url_invalid");
  }
  if (parsed.username.length > 0 || parsed.password.length > 0)
    throw new TypeError("active_reward_claim_source_url_invalid");
  return text;
}

function reduceRow(value: unknown): ActiveRewardClaimRecord {
  const row = parsedRecord(value, "row");
  if (!exactKeys(row, ACTIVE_REWARD_CLAIM_ROW_KEYS))
    throw new TypeError("active_reward_claim_row_shape_invalid");
  const candidateHash = strictHash(row.candidate_hash, "candidate_hash");
  const definitionHash = strictHash(row.definition_hash, "definition_hash");
  const candidateId = strictIdentifier(row.candidate_id, "candidate_id");
  const familyId = strictIdentifier(row.p0_family_id, "p0_family_id");
  const sourceRoleId = strictIdentifier(row.source_role_id, "source_role_id");
  const sourceIds = strictStringArray(row.source_ids, "source_ids");
  const candidate = candidatePayload(
    row.candidate_payload,
    candidateHash,
    definitionHash,
    candidateId,
    familyId,
    sourceRoleId,
    sourceIds,
  );
  const observation = observationDocument(row.observation, candidate);
  const checkedAt = strictDate(row.checked_at, "checked_at");
  return Object.freeze({
    candidate_hash: candidateHash,
    definition_hash: definitionHash,
    candidate_id: candidateId,
    candidate_payload: structuredClone(candidate),
    p0_family_id: familyId,
    source_role_id: sourceRoleId,
    source_ids: Object.freeze([...sourceIds]),
    observation: structuredClone(observation),
    source_url: sourceUrl(row.source_url),
    checked_at: checkedAt,
  });
}

function validEffectiveAt(value: string): string {
  if (!isCanonicalProvisionalDateTime(value))
    throw new TypeError("active_reward_claim_effective_at_invalid");
  return value;
}

export function createPostgresActiveRewardClaimStore(
  target: QueryTarget,
): ActiveRewardClaimStore {
  return Object.freeze({
    async list(
      effectiveAt: string,
    ): Promise<readonly ActiveRewardClaimRecord[]> {
      const instant = validEffectiveAt(effectiveAt);
      const result = await target.query<JsonRecord>(
        ACTIVE_REWARD_CLAIM_CALCULATIONS_QUERY,
        [instant],
      );
      if (result.rows.length > MAX_ACTIVE_REWARD_CLAIM_ROWS)
        throw new Error("active_reward_claim_too_many_rows");
      const records = result.rows.map((row) => reduceRow(row));
      records.sort((left, right) =>
        left.candidate_hash.localeCompare(right.candidate_hash),
      );
      return Object.freeze(records);
    },
  });
}

/** Test-facing strict reducer for one function row. */
export function reduceActiveRewardClaimRow(
  row: unknown,
): ActiveRewardClaimRecord {
  return reduceRow(row);
}
