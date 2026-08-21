import {
  type AdmissionIssue,
  admitNanacoEconomicPilot,
  createProvisionalRuleStore,
  type ProvisionalRuleCandidate,
  type Sha256,
  scanPublicValue,
} from "@jro/provisional-rules";
import type { QueryClient, QueryPool, QueryTarget } from "./adapter.js";

export const MAX_P0_ECONOMIC_BATCH_MEMBERS = 32 as const;

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

export interface P0EconomicCandidatePersistenceResult {
  readonly candidate_id: string;
  readonly outcome: P0EconomicCandidatePersistenceOutcome;
  readonly status: "machine_checked" | "active_experimental";
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
    (value.status !== "machine_checked" &&
      value.status !== "active_experimental")
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
