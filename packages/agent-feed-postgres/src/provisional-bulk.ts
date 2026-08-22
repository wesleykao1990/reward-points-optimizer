import {
  type AdmissionIssue,
  admitNanacoEconomicPilot,
  compileRewardClaims,
  createProvisionalRuleStore,
  type ProvisionalRuleCandidate,
  type ProvisionalRuleEnvelope,
  type RewardClaimCompilerIssue,
  type Sha256,
  scanPublicValue,
} from "@jro/provisional-rules";
import type { QueryClient, QueryPool, QueryTarget } from "./adapter.js";

export const MAX_P0_ECONOMIC_BATCH_MEMBERS = 32 as const;
export const P0_REWARD_CLAIM_BATCH_VERSION =
  "p0-reward-claim-batch.v1" as const;
export const MAX_P0_REWARD_CLAIM_BATCH_MEMBERS = 32 as const;

export interface P0RewardClaimBatchBindingInput {
  readonly family_id: string;
  readonly source_role_id: string;
  readonly source_ids?: readonly string[];
  readonly p0_coverage_index: unknown;
}

export interface P0RewardClaimBatchObservationInput {
  readonly observation: unknown;
  readonly binding: P0RewardClaimBatchBindingInput;
}

/** Exact, host-owned envelope for generic structured reward-claim ingestion. */
export interface P0RewardClaimBatchInput {
  readonly version: typeof P0_REWARD_CLAIM_BATCH_VERSION;
  readonly observations: readonly P0RewardClaimBatchObservationInput[];
}

export interface P0RewardClaimBatchIssue {
  readonly code: string;
  readonly path: string;
  readonly message: string;
  readonly claim_id?: string;
  readonly admission_issues?: readonly AdmissionIssue[];
}

export interface P0RewardClaimBatchMemberResult {
  readonly observation_id?: string;
  readonly claim_id?: string;
  readonly claim_type?: string;
  readonly candidate_hash?: Sha256;
  readonly definition_hash?: Sha256;
  readonly status: "inserted" | "duplicate" | "rejected";
  readonly issues?: readonly P0RewardClaimBatchIssue[];
}

export interface P0RewardClaimBatchResult {
  readonly ok: boolean;
  readonly status: "inserted" | "duplicate" | "mixed" | "rejected";
  readonly members: readonly P0RewardClaimBatchMemberResult[];
  readonly issues: readonly P0RewardClaimBatchIssue[];
}

export const P0_PROVISIONAL_CANDIDATE_QUERY = `
select candidate_id, outcome, status
  from app_private.persist_p0_reward_claim_candidate($1::text, $2::text, $3::jsonb)
`;

/** One database call made only after the complete in-process batch preflight. */
export const P0_ECONOMIC_CANDIDATE_QUERY = `
select candidate_id, outcome, status
  from app_private.persist_p0_economic_candidate($1::text, $2::text, $3::jsonb)
`;

export interface P0EconomicCandidatePersistenceInput {
  readonly candidate_hash: Sha256;
  readonly definition_hash: Sha256;
  readonly candidate: ProvisionalRuleCandidate;
}

export type P0EconomicCandidatePersistenceOutcome = "inserted" | "duplicate";
export type P0EconomicCandidatePersistenceStatus =
  | "needs_evidence"
  | "machine_checked"
  | "active_experimental"
  | "disputed"
  | "quarantined";

export interface P0EconomicCandidatePersistenceResult {
  readonly candidate_id: string;
  readonly outcome: P0EconomicCandidatePersistenceOutcome;
  readonly status: P0EconomicCandidatePersistenceStatus;
}

/**
 * Host-owned persistence port.  Keeping this small makes the admission kernel
 * testable without a PostgreSQL driver and keeps Agent Feed's database out of
 * the Rewards process.
 */
export interface P0EconomicCandidatePersistencePort {
  readonly begin?: () => Promise<void>;
  readonly persist: (
    input: P0EconomicCandidatePersistenceInput,
  ) => Promise<P0EconomicCandidatePersistenceResult>;
  readonly commit?: () => Promise<void>;
  readonly rollback?: () => Promise<void>;
}

export interface P0EconomicBatchMemberResult {
  readonly input_index: number;
  readonly observation_id?: string;
  readonly candidate_hash?: Sha256;
  readonly definition_hash?: Sha256;
  readonly status: "inserted" | "duplicate" | "rejected";
  readonly issues?: readonly AdmissionIssue[];
}

export interface P0EconomicBatchResult {
  /**
   * True when every accepted member completed persistence.  A semantically
   * rejected member is still reported in `members`; it does not make an
   * otherwise successful processing operation fail.
   */
  readonly ok: boolean;
  readonly status: "inserted" | "duplicate" | "mixed" | "rejected";
  readonly members: readonly P0EconomicBatchMemberResult[];
}

function isQueryPool(target: QueryTarget): target is QueryPool {
  return "connect" in target && typeof target.connect === "function";
}

function candidateRow(row: unknown): P0EconomicCandidatePersistenceResult {
  if (!row || typeof row !== "object" || Array.isArray(row))
    throw new TypeError("p0_economic_candidate_malformed_result");
  const value = row as Record<string, unknown>;
  if (
    typeof value.candidate_id !== "string" ||
    value.candidate_id.length === 0 ||
    (value.outcome !== "inserted" && value.outcome !== "duplicate") ||
    (value.status !== "needs_evidence" &&
      value.status !== "machine_checked" &&
      value.status !== "active_experimental" &&
      value.status !== "disputed" &&
      value.status !== "quarantined")
  )
    throw new TypeError("p0_economic_candidate_malformed_result");
  return {
    candidate_id: value.candidate_id,
    outcome: value.outcome,
    status: value.status,
  };
}

/** Create a driver-free persistence port backed by the new private SQL wrapper. */
export function createPostgresP0EconomicCandidatePersistence(
  target: QueryTarget,
): P0EconomicCandidatePersistencePort {
  return {
    async persist(input) {
      const result = await target.query(P0_ECONOMIC_CANDIDATE_QUERY, [
        input.candidate_hash,
        input.definition_hash,
        JSON.stringify(input.candidate),
      ]);
      if (result.rows.length !== 1 || result.rows[0] === undefined)
        throw new TypeError("p0_economic_candidate_empty_result");
      return candidateRow(result.rows[0]);
    },
  };
}

function memberFromAdmission(
  inputIndex: number,
  result: ReturnType<typeof admitNanacoEconomicPilot>,
): P0EconomicBatchMemberResult {
  if (result.ok)
    throw new Error("p0_economic_accepted_member_has_no_rejection_result");
  return {
    input_index: inputIndex,
    status: "rejected",
    issues: result.issues,
  };
}

function rejectedBatch(
  members: readonly P0EconomicBatchMemberResult[],
): P0EconomicBatchResult {
  return Object.freeze({
    ok: false,
    status: "rejected" as const,
    members: Object.freeze([...members]),
  });
}

/**
 * Preflight and persist one bounded batch.  The representation scan and
 * bounds check are global, so malformed containers cannot reach the database.
 * Admission is per member: an ordinary semantic rejection is reported beside
 * successfully persisted neighbors instead of suppressing them.
 */
export async function processP0NanacoEconomicBatch(
  observations: readonly unknown[],
  persistence: P0EconomicCandidatePersistencePort,
): Promise<P0EconomicBatchResult> {
  const scanned = scanPublicValue(observations);
  if (!scanned.valid)
    return rejectedBatch([
      {
        input_index: -1,
        status: "rejected",
        issues: scanned.issues,
      },
    ]);
  if (
    !Array.isArray(scanned.value) ||
    scanned.value.length < 1 ||
    scanned.value.length > MAX_P0_ECONOMIC_BATCH_MEMBERS
  )
    return rejectedBatch([
      {
        input_index: -1,
        status: "rejected",
        issues: [
          {
            code: "input_shape_invalid",
            path: "/observations",
            message: "P0 economic batches must contain 1 to 32 observations",
          },
        ],
      },
    ]);

  const store = createProvisionalRuleStore();
  const admitted = scanned.value.map((observation, input_index) => {
    const result = admitNanacoEconomicPilot(store, observation);
    return { input_index, result };
  });

  const accepted = admitted.flatMap((item) =>
    item.result.ok
      ? [
          {
            input_index: item.input_index,
            result: item.result,
            candidate: item.result.envelope.candidate,
          },
        ]
      : [],
  );
  // No member was admitted, so there is nothing to persist and the batch is
  // rejected without opening a transaction or making any database call.
  if (accepted.length === 0)
    return rejectedBatch(
      admitted.map((item) =>
        memberFromAdmission(item.input_index, item.result),
      ),
    );
  const uniqueByHash = new Map<Sha256, (typeof accepted)[number]>();
  const duplicateInputIndexes = new Map<number, Sha256>();
  for (const item of accepted) {
    if (uniqueByHash.has(item.result.candidate_hash)) {
      duplicateInputIndexes.set(item.input_index, item.result.candidate_hash);
      continue;
    }
    uniqueByHash.set(item.result.candidate_hash, item);
  }
  const ordered = [...uniqueByHash.values()].sort((left, right) =>
    left.result.candidate_hash.localeCompare(right.result.candidate_hash),
  );

  let begun = false;
  let committed = false;
  try {
    if (persistence.begin !== undefined) {
      begun = true;
      await persistence.begin();
    }
    const persisted = new Map<Sha256, P0EconomicCandidatePersistenceResult>();
    for (const item of ordered) {
      const persistedResult = await persistence.persist({
        candidate_hash: item.result.candidate_hash,
        definition_hash: item.result.definition_hash,
        candidate: item.candidate,
      });
      persisted.set(item.result.candidate_hash, persistedResult);
    }
    if (persistence.commit !== undefined) {
      await persistence.commit();
      committed = true;
    }

    const members: P0EconomicBatchMemberResult[] = admitted.map((item) => {
      if (!item.result.ok)
        return memberFromAdmission(item.input_index, item.result);
      const persistedResult = persisted.get(item.result.candidate_hash);
      if (!persistedResult)
        throw new Error("p0_economic_candidate_missing_persistence_result");
      return {
        input_index: item.input_index,
        observation_id: item.result.envelope.observation.observation_id,
        candidate_hash: item.result.candidate_hash,
        definition_hash: item.result.definition_hash,
        status:
          duplicateInputIndexes.has(item.input_index) ||
          persistedResult.outcome === "duplicate"
            ? "duplicate"
            : "inserted",
      };
    });
    const statuses = new Set(members.map((member) => member.status));
    return Object.freeze({
      ok: true,
      status:
        statuses.size === 1
          ? (statuses.values().next().value as "inserted" | "duplicate")
          : "mixed",
      members: Object.freeze(members),
    });
  } catch (error) {
    if (begun && !committed && persistence.rollback !== undefined) {
      try {
        await persistence.rollback();
      } catch {
        // Preserve the original persistence error.
      }
    }
    throw error;
  }
}

/** Driver-free constructor useful to hosts that own a transaction port. */
export function createP0NanacoEconomicBatchProcessor(
  persistence: P0EconomicCandidatePersistencePort,
): (observations: readonly unknown[]) => Promise<P0EconomicBatchResult> {
  return (observations) =>
    processP0NanacoEconomicBatch(observations, persistence);
}

/**
 * Construct the Postgres-backed processor.  The checked-out client is kept
 * for the whole batch so SQL persistence is all-or-nothing and has the same
 * deterministic order as the in-process preflight.
 */
export function createPostgresP0NanacoEconomicBatchProcessor(
  target: QueryTarget,
): (observations: readonly unknown[]) => Promise<P0EconomicBatchResult> {
  return async (observations) => {
    let client: QueryClient | undefined;
    let release: ((error?: Error) => void) | undefined;
    const acquireClient = async (): Promise<QueryClient> => {
      if (client !== undefined) return client;
      if (isQueryPool(target)) {
        const checkedOut = await target.connect();
        client = checkedOut;
        release = checkedOut.release;
      } else {
        client = target;
      }
      return client;
    };
    let failed = false;
    let transactionAttempted = false;
    let transactionRolledBack = false;
    let committed = false;
    let originalError: unknown;
    try {
      const transactional: P0EconomicCandidatePersistencePort = {
        begin: async () => {
          transactionAttempted = true;
          const activeClient = await acquireClient();
          await activeClient.query("BEGIN");
        },
        persist: async (input) => {
          const activeClient = await acquireClient();
          return createPostgresP0EconomicCandidatePersistence(
            activeClient,
          ).persist(input);
        },
        commit: async () => {
          const activeClient = await acquireClient();
          await activeClient.query("COMMIT");
          committed = true;
        },
        rollback: async () => {
          if (client === undefined) return;
          await client.query("ROLLBACK");
          transactionRolledBack = true;
        },
      };
      return await processP0NanacoEconomicBatch(observations, transactional);
    } catch (error) {
      failed = true;
      originalError = error;
      if (
        client !== undefined &&
        transactionAttempted &&
        !committed &&
        !transactionRolledBack
      ) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // Preserve the original error.
        }
      }
      throw error;
    } finally {
      if (release !== undefined) {
        try {
          if (failed)
            release(
              originalError instanceof Error
                ? originalError
                : errorForRelease(),
            );
          else release();
        } catch {
          // Preserve the query/transaction error.
        }
      }
    }
  };
}

function errorForRelease(): Error {
  return new Error("p0_economic_batch_failed");
}

// Naming aliases keep the public boundary descriptive for callers that think
// in terms of a catalogue rather than a candidate persistence routine.
export const createPostgresProvisionalBulkProcessor =
  createPostgresP0NanacoEconomicBatchProcessor;
export const createPostgresP0EconomicIngestion =
  createPostgresP0NanacoEconomicBatchProcessor;

const REWARD_CLAIM_BATCH_KEYS = new Set(["observations", "version"]);
const REWARD_CLAIM_OBSERVATION_KEYS = new Set(["binding", "observation"]);
const REWARD_CLAIM_BINDING_KEYS = new Set([
  "family_id",
  "p0_coverage_index",
  "source_ids",
  "source_role_id",
]);

interface PreparedRewardClaimObservation {
  readonly observation: unknown;
  readonly binding: Record<string, unknown>;
}

interface PreparedRewardClaimCandidate {
  readonly memberIndex: number;
  readonly claimIdentity: string;
  readonly candidateId: string | undefined;
  readonly candidateHash: Sha256;
  readonly definitionHash: Sha256;
  readonly candidate: ProvisionalRuleCandidate;
}

function batchRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function exactBatchKeys(
  value: Record<string, unknown>,
  expected: ReadonlySet<string>,
  path: string,
): P0RewardClaimBatchIssue[] {
  return Object.keys(value)
    .filter((key) => !expected.has(key))
    .map((key) => ({
      code: "batch_shape_invalid",
      path: `${path}/${key}`,
      message: "unknown field",
    }));
}

function batchIssue(
  code: string,
  path: string,
  message: string,
  details: Partial<P0RewardClaimBatchIssue> = {},
): P0RewardClaimBatchIssue {
  return Object.freeze({ code, path, message, ...details });
}

function sortedBatchIssues(
  issues: readonly P0RewardClaimBatchIssue[],
): readonly P0RewardClaimBatchIssue[] {
  return Object.freeze(
    [...issues].sort(
      (left, right) =>
        (left.claim_id ?? "").localeCompare(right.claim_id ?? "") ||
        left.path.localeCompare(right.path) ||
        left.code.localeCompare(right.code) ||
        left.message.localeCompare(right.message),
    ),
  );
}

function sortedRewardClaimMembers(
  members: readonly P0RewardClaimBatchMemberResult[],
): readonly P0RewardClaimBatchMemberResult[] {
  return Object.freeze(
    [...members].sort(
      (left, right) =>
        (left.candidate_hash ?? "~").localeCompare(
          right.candidate_hash ?? "~",
        ) ||
        (left.observation_id ?? "").localeCompare(right.observation_id ?? "") ||
        (left.claim_id ?? "").localeCompare(right.claim_id ?? "") ||
        (left.claim_type ?? "").localeCompare(right.claim_type ?? ""),
    ),
  );
}

function rejectedRewardClaimBatch(
  issues: readonly P0RewardClaimBatchIssue[],
  members: readonly P0RewardClaimBatchMemberResult[] = [],
): P0RewardClaimBatchResult {
  return Object.freeze({
    ok: false,
    status: "rejected" as const,
    members: sortedRewardClaimMembers(members),
    issues: sortedBatchIssues(issues),
  });
}

function parseRewardClaimBatch(value: unknown): {
  readonly observations: readonly PreparedRewardClaimObservation[];
  readonly issues: readonly P0RewardClaimBatchIssue[];
} {
  const scanned = scanPublicValue(value);
  if (!scanned.valid)
    return {
      observations: [],
      issues: scanned.issues,
    };
  const root = batchRecord(scanned.value);
  if (!root)
    return {
      observations: [],
      issues: [
        batchIssue(
          "batch_shape_invalid",
          "",
          "reward-claim batch must be an object",
        ),
      ],
    };

  const issues = exactBatchKeys(root, REWARD_CLAIM_BATCH_KEYS, "");
  if (root.version !== P0_REWARD_CLAIM_BATCH_VERSION)
    issues.push(
      batchIssue(
        "batch_shape_invalid",
        "/version",
        "unsupported reward-claim batch version",
      ),
    );
  const rawObservations = root.observations;
  if (!Array.isArray(rawObservations)) {
    issues.push(
      batchIssue(
        "batch_shape_invalid",
        "/observations",
        "observations must be an array",
      ),
    );
    return { observations: [], issues };
  }
  if (
    rawObservations.length === 0 ||
    rawObservations.length > MAX_P0_REWARD_CLAIM_BATCH_MEMBERS
  )
    issues.push(
      batchIssue(
        "batch_too_large",
        "/observations",
        `observations must contain 1-${MAX_P0_REWARD_CLAIM_BATCH_MEMBERS} entries`,
      ),
    );

  const observations: PreparedRewardClaimObservation[] = [];
  for (const [index, rawMember] of rawObservations.entries()) {
    const path = `/observations/${index}`;
    const member = batchRecord(rawMember);
    if (!member) {
      issues.push(
        batchIssue(
          "member_shape_invalid",
          path,
          "observation member must be an object",
        ),
      );
      continue;
    }
    issues.push(...exactBatchKeys(member, REWARD_CLAIM_OBSERVATION_KEYS, path));
    const binding = batchRecord(member.binding);
    if (!binding) {
      issues.push(
        batchIssue(
          "binding_shape_invalid",
          `${path}/binding`,
          "binding must be an object",
        ),
      );
      continue;
    }
    issues.push(
      ...exactBatchKeys(binding, REWARD_CLAIM_BINDING_KEYS, `${path}/binding`),
    );
    for (const key of ["family_id", "source_role_id", "p0_coverage_index"])
      if (!Object.hasOwn(binding, key))
        issues.push(
          batchIssue(
            "binding_shape_invalid",
            `${path}/binding/${key}`,
            "required host-owned binding field is missing",
          ),
        );
    observations.push({ observation: member.observation, binding });
  }
  return { observations, issues };
}

function observationId(value: unknown): string | undefined {
  const record = batchRecord(value);
  return typeof record?.observation_id === "string"
    ? record.observation_id
    : undefined;
}

function hasExplicitRewardClaims(value: unknown): boolean {
  const observation = batchRecord(value);
  const attributes = batchRecord(observation?.raw_attributes);
  return attributes !== null && Object.hasOwn(attributes, "reward_claims");
}

function compilerIssue(
  item: RewardClaimCompilerIssue,
): P0RewardClaimBatchIssue {
  return item;
}

function statusForRewardClaimMembers(
  members: readonly P0RewardClaimBatchMemberResult[],
  successfulCount: number,
): P0RewardClaimBatchResult["status"] {
  if (successfulCount === 0) return "rejected";
  const statuses = new Set(members.map((member) => member.status));
  if (statuses.size !== 1) return "mixed";
  const status = statuses.values().next().value;
  return status === "inserted" || status === "duplicate" ? status : "mixed";
}

/**
 * Compile explicit `raw_attributes.reward_claims` from host-admitted
 * SourceObservations and persist complete candidates in deterministic hash
 * order.  The outer envelope is fully representation-checked before the
 * first compiler or database operation; semantic claim failures stay local
 * to their claim so valid siblings can proceed.
 */
export async function processP0RewardClaimBatch(
  value: unknown,
  persistence: P0EconomicCandidatePersistencePort,
): Promise<P0RewardClaimBatchResult> {
  const parsed = parseRewardClaimBatch(value);
  if (parsed.issues.length > 0) return rejectedRewardClaimBatch(parsed.issues);

  const memberResults: P0RewardClaimBatchMemberResult[] = [];
  const batchIssues: P0RewardClaimBatchIssue[] = [];
  const prepared: PreparedRewardClaimCandidate[] = [];
  for (const [observationIndex, input] of parsed.observations.entries()) {
    const currentObservationId = observationId(input.observation);
    const observationPath = currentObservationId
      ? `/observations/${currentObservationId}`
      : `/observations/${observationIndex}`;
    if (!hasExplicitRewardClaims(input.observation)) {
      const missing = batchIssue(
        "claim_document_missing",
        `${observationPath}/observation/raw_attributes/reward_claims`,
        "explicit reward_claims are required; legacy observation attributes are not converted by this generic processor",
      );
      memberResults.push({
        ...(currentObservationId
          ? { observation_id: currentObservationId }
          : {}),
        status: "rejected",
        issues: [missing],
      });
      batchIssues.push(missing);
      continue;
    }

    const binding = input.binding;
    const compiled = compileRewardClaims(input.observation, {
      binding: {
        family_id: binding.family_id as string,
        source_role_id: binding.source_role_id as string,
        ...(Object.hasOwn(binding, "source_ids")
          ? { source_ids: binding.source_ids as readonly string[] }
          : {}),
        p0_coverage_index: binding.p0_coverage_index,
      },
    });
    batchIssues.push(...compiled.issues.map(compilerIssue));
    if (compiled.members.length === 0) {
      const issues = compiled.issues.map(compilerIssue);
      const fallback =
        issues.length > 0
          ? issues
          : [
              batchIssue(
                "claim_compilation_invalid",
                observationPath,
                "reward-claim observation produced no claim results",
              ),
            ];
      memberResults.push({
        ...(compiled.observation_id
          ? { observation_id: compiled.observation_id }
          : currentObservationId
            ? { observation_id: currentObservationId }
            : {}),
        status: "rejected",
        issues: fallback,
      });
      continue;
    }

    for (const member of compiled.members) {
      const memberObservationId =
        compiled.observation_id ?? currentObservationId;
      if (
        !member.ok ||
        member.envelope === undefined ||
        member.candidate_hash === undefined ||
        member.definition_hash === undefined
      ) {
        const issues = member.issues.map(compilerIssue);
        memberResults.push({
          ...(memberObservationId
            ? { observation_id: memberObservationId }
            : {}),
          ...(member.claim_id ? { claim_id: member.claim_id } : {}),
          ...(member.claim_type ? { claim_type: member.claim_type } : {}),
          ...(member.candidate_hash
            ? { candidate_hash: member.candidate_hash }
            : {}),
          ...(member.definition_hash
            ? { definition_hash: member.definition_hash }
            : {}),
          status: "rejected",
          issues,
        });
        continue;
      }
      const envelope: ProvisionalRuleEnvelope = member.envelope;
      const candidate = envelope.candidate;
      const candidateMemberIndex = memberResults.length;
      memberResults.push({
        ...(memberObservationId ? { observation_id: memberObservationId } : {}),
        ...(member.claim_id ? { claim_id: member.claim_id } : {}),
        ...(member.claim_type ? { claim_type: member.claim_type } : {}),
        candidate_hash: member.candidate_hash,
        definition_hash: member.definition_hash,
        status: "inserted",
      });
      prepared.push({
        memberIndex: candidateMemberIndex,
        claimIdentity: `${memberObservationId ?? ""}\u0000${member.claim_id}`,
        candidateId: candidate.candidate_id,
        candidateHash: member.candidate_hash as Sha256,
        definitionHash: member.definition_hash as Sha256,
        candidate,
      });
    }
  }

  const seenClaims = new Map<string, number>();
  const seenCandidateIds = new Map<string, number>();
  const seenCandidateHashes = new Map<Sha256, number>();
  const duplicateIndexes = new Set<number>();
  for (const item of prepared) {
    const priorClaim = seenClaims.get(item.claimIdentity);
    const priorId =
      item.candidateId === undefined
        ? undefined
        : seenCandidateIds.get(item.candidateId);
    const priorHash = seenCandidateHashes.get(item.candidateHash);
    if (priorClaim !== undefined) {
      duplicateIndexes.add(priorClaim);
      duplicateIndexes.add(item.memberIndex);
      batchIssues.push(
        batchIssue(
          "duplicate_claim_identity",
          "/observations",
          "claim identity must be unique within a reward-claim batch",
          { claim_id: item.claimIdentity.split("\u0000")[1] ?? "" },
        ),
      );
    }
    if (priorId !== undefined) {
      duplicateIndexes.add(priorId);
      duplicateIndexes.add(item.memberIndex);
      batchIssues.push(
        batchIssue(
          "duplicate_candidate_id",
          "/observations",
          "candidate identity must be unique within a reward-claim batch",
          item.candidateId === undefined ? {} : { claim_id: item.candidateId },
        ),
      );
    }
    if (priorHash !== undefined) {
      duplicateIndexes.add(priorHash);
      duplicateIndexes.add(item.memberIndex);
      batchIssues.push(
        batchIssue(
          "duplicate_candidate_hash",
          "/observations",
          "candidate hash must be unique within a reward-claim batch",
          { claim_id: item.candidateHash },
        ),
      );
    }
    if (priorClaim === undefined)
      seenClaims.set(item.claimIdentity, item.memberIndex);
    if (item.candidateId !== undefined && priorId === undefined)
      seenCandidateIds.set(item.candidateId, item.memberIndex);
    if (priorHash === undefined)
      seenCandidateHashes.set(item.candidateHash, item.memberIndex);
  }
  if (duplicateIndexes.size > 0) {
    const duplicateIssue = batchIssues.filter((item) =>
      item.code.startsWith("duplicate_"),
    );
    for (const index of duplicateIndexes) {
      const member = memberResults[index];
      if (member)
        memberResults[index] = {
          ...member,
          status: "rejected",
          issues: [...(member.issues ?? []), ...duplicateIssue],
        };
    }
    return rejectedRewardClaimBatch(batchIssues, memberResults);
  }

  const ordered = [...prepared].sort((left, right) =>
    left.candidateHash.localeCompare(right.candidateHash),
  );
  if (ordered.length === 0)
    return rejectedRewardClaimBatch(batchIssues, memberResults);

  let begun = false;
  let committed = false;
  try {
    if (persistence.begin !== undefined) {
      begun = true;
      await persistence.begin();
    }
    const persisted = new Map<Sha256, P0EconomicCandidatePersistenceResult>();
    for (const item of ordered) {
      persisted.set(
        item.candidateHash,
        await persistence.persist({
          candidate_hash: item.candidateHash,
          definition_hash: item.definitionHash,
          candidate: item.candidate,
        }),
      );
    }
    if (persistence.commit !== undefined) {
      await persistence.commit();
      committed = true;
    }
    for (const item of prepared) {
      const member = memberResults[item.memberIndex];
      const result = persisted.get(item.candidateHash);
      if (!member || !result)
        throw new Error("p0_reward_claim_missing_persistence_result");
      memberResults[item.memberIndex] = {
        ...member,
        status: result.outcome,
      };
    }
    return Object.freeze({
      ok: true,
      status: statusForRewardClaimMembers(memberResults, prepared.length),
      members: sortedRewardClaimMembers(memberResults),
      issues: sortedBatchIssues(batchIssues),
    });
  } catch (error) {
    if (begun && !committed && persistence.rollback !== undefined) {
      try {
        await persistence.rollback();
      } catch {
        // Preserve the original persistence error.
      }
    }
    throw error;
  }
}

export const processRewardClaimBatch = processP0RewardClaimBatch;
export const processP0GenericRewardClaimBatch = processP0RewardClaimBatch;

/** Driver-free generic processor constructor for a host-owned transaction port. */
export function createP0RewardClaimBatchProcessor(
  persistence: P0EconomicCandidatePersistencePort,
): (value: unknown) => Promise<P0RewardClaimBatchResult> {
  return (value) => processP0RewardClaimBatch(value, persistence);
}

export const createRewardClaimBatchProcessor =
  createP0RewardClaimBatchProcessor;

/** Generic candidate persistence over the existing base P0 routine. */
export function createPostgresP0RewardClaimCandidatePersistence(
  target: QueryTarget,
): P0EconomicCandidatePersistencePort {
  return {
    async persist(input) {
      const result = await target.query(P0_PROVISIONAL_CANDIDATE_QUERY, [
        input.candidate_hash,
        input.definition_hash,
        JSON.stringify(input.candidate),
      ]);
      if (result.rows.length !== 1 || result.rows[0] === undefined)
        throw new TypeError("p0_reward_claim_candidate_empty_result");
      return candidateRow(result.rows[0]);
    },
  };
}

/**
 * Construct the generic Postgres processor.  Client checkout and BEGIN occur
 * only after the complete representation/claim preflight has produced at
 * least one unique successful candidate.
 */
export function createPostgresP0RewardClaimBatchProcessor(
  target: QueryTarget,
): (value: unknown) => Promise<P0RewardClaimBatchResult> {
  return async (value) => {
    let client: QueryClient | undefined;
    let release: ((error?: Error) => void) | undefined;
    const acquireClient = async (): Promise<QueryClient> => {
      if (client !== undefined) return client;
      if (isQueryPool(target)) {
        const checkedOut = await target.connect();
        client = checkedOut;
        release = checkedOut.release;
      } else client = target;
      return client;
    };
    let failed = false;
    let attempted = false;
    let rolledBack = false;
    let committed = false;
    let originalError: unknown;
    try {
      const transactional: P0EconomicCandidatePersistencePort = {
        begin: async () => {
          attempted = true;
          await (await acquireClient()).query("BEGIN");
        },
        persist: async (input) =>
          createPostgresP0RewardClaimCandidatePersistence(
            await acquireClient(),
          ).persist(input),
        commit: async () => {
          await (await acquireClient()).query("COMMIT");
          committed = true;
        },
        rollback: async () => {
          if (client === undefined) return;
          await client.query("ROLLBACK");
          rolledBack = true;
        },
      };
      return await processP0RewardClaimBatch(value, transactional);
    } catch (error) {
      failed = true;
      originalError = error;
      if (client !== undefined && attempted && !committed && !rolledBack) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // Preserve the original database/transaction error.
        }
      }
      throw error;
    } finally {
      if (release !== undefined) {
        try {
          if (failed)
            release(
              originalError instanceof Error
                ? originalError
                : errorForRelease(),
            );
          else release();
        } catch {
          // Preserve the original transaction/query error.
        }
      }
    }
  };
}

export const createPostgresRewardClaimBatchProcessor =
  createPostgresP0RewardClaimBatchProcessor;
export const createPostgresProvisionalRewardClaimBatchProcessor =
  createPostgresP0RewardClaimBatchProcessor;
