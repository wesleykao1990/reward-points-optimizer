import type {
  AtomicPersistenceInput,
  AtomicPersistencePort,
  PersistenceOutcome,
  PersistenceOutcomeStatus,
  SourceObservation,
} from "@jro/agent-feed-consumer";

export const DEFAULT_ATOMIC_FUNCTION =
  "app_private.persist_agent_feed_atomic" as const;

export const ATOMIC_FUNCTION_QUERY = `
select receipt_id, status, observation, duplicate_kind,
       duplicate_of_receipt_id, reason_code
  from app_private.persist_agent_feed_atomic($1::jsonb)
`;

export interface QueryResult<Row = unknown> {
  rows: readonly Row[];
}

/** Minimal query surface implemented by node-postgres, postgres.js adapters, and test doubles. */
export interface QueryClient {
  query<Row = unknown>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<Row>>;
}

/** A checked-out pool client. Release is optional for simple wrappers. */
export interface PoolClient extends QueryClient {
  release?: (error?: Error) => void;
}

/** A pool may provide connect; a plain QueryClient is also accepted. */
export interface QueryPool extends QueryClient {
  connect: () => Promise<PoolClient>;
}

export type QueryTarget = QueryClient | QueryPool;

type AtomicResultRow = {
  receipt_id?: unknown;
  status?: unknown;
  observation?: unknown;
  duplicate_kind?: unknown;
  duplicate_of_receipt_id?: unknown;
  reason_code?: unknown;
};

function isQueryPool(target: QueryTarget): target is QueryPool {
  return "connect" in target && typeof target.connect === "function";
}

function asNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`atomic_persistence_invalid_${field}`);
  }
  return value;
}

function asStatus(value: unknown): PersistenceOutcomeStatus {
  if (
    value !== "inserted" &&
    value !== "mapped" &&
    value !== "duplicate" &&
    value !== "quarantined"
  ) {
    throw new TypeError("atomic_persistence_invalid_status");
  }
  return value;
}

function asObservation(value: unknown): SourceObservation | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value === "object") {
    return value as SourceObservation | null;
  }
  throw new TypeError("atomic_persistence_invalid_observation");
}

function mapResult(row: AtomicResultRow): PersistenceOutcome {
  const outcome: PersistenceOutcome = {
    status: asStatus(row.status),
    receipt_id: asNonEmptyString(row.receipt_id, "receipt_id"),
  };
  const observation = asObservation(row.observation);
  if (observation !== undefined) outcome.observation = observation;

  if (row.duplicate_kind !== undefined && row.duplicate_kind !== null) {
    if (
      row.duplicate_kind !== "transport" &&
      row.duplicate_kind !== "semantic"
    ) {
      throw new TypeError("atomic_persistence_invalid_duplicate_kind");
    }
    outcome.duplicate_kind = row.duplicate_kind;
  }
  if (
    row.duplicate_of_receipt_id !== undefined &&
    row.duplicate_of_receipt_id !== null
  ) {
    outcome.duplicate_of_receipt_id = asNonEmptyString(
      row.duplicate_of_receipt_id,
      "duplicate_of_receipt_id",
    );
  } else if (row.duplicate_of_receipt_id === null) {
    outcome.duplicate_of_receipt_id = null;
  }
  if (row.reason_code !== undefined && row.reason_code !== null) {
    outcome.reason_code = asNonEmptyString(row.reason_code, "reason_code");
  }
  return outcome;
}

/**
 * Construct an AtomicPersistencePort backed by one caller-owned transaction.
 * No driver is imported: the application supplies a connected client or a
 * pool with connect/release semantics.
 */
export function createPostgresAtomicPersistence(
  target: QueryTarget,
): AtomicPersistencePort {
  return {
    async persist(input: AtomicPersistenceInput): Promise<PersistenceOutcome> {
      let client: PoolClient | QueryClient = target;
      let release: ((error?: Error) => void) | undefined;
      if (isQueryPool(target)) {
        const checkedOut = await target.connect();
        client = checkedOut;
        release = checkedOut.release;
      }

      let transactionAttempted = false;
      let committed = false;
      let failed = false;
      let originalError: unknown;
      try {
        transactionAttempted = true;
        await client.query("BEGIN");
        const result = await client.query<AtomicResultRow>(
          ATOMIC_FUNCTION_QUERY,
          [JSON.stringify(input)],
        );
        if (result.rows.length !== 1 || result.rows[0] === undefined) {
          throw new Error("atomic_persistence_empty_result");
        }
        const outcome = mapResult(result.rows[0]);
        await client.query("COMMIT");
        committed = true;
        return outcome;
      } catch (error) {
        failed = true;
        originalError = error;
        if (transactionAttempted && !committed) {
          try {
            await client.query("ROLLBACK");
          } catch {
            // Preserve the database error that caused the rollback. No error
            // payload is logged or copied into diagnostics here.
          }
        }
        throw error;
      } finally {
        if (release !== undefined) {
          if (!failed) {
            release();
          } else {
            const releaseError =
              originalError instanceof Error
                ? originalError
                : new Error("atomic_persistence_failed");
            try {
              release(releaseError);
            } catch {
              // Preserve the original transaction/query/commit error.
            }
          }
        }
      }
    },
  };
}
