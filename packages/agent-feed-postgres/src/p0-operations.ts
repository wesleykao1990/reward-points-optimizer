import { types as nodeTypes } from "node:util";

import {
  admitP0ReceiptReconciliation,
  type P0OperationsManifest,
} from "@jro/p0-source-operations";
import type {
  PoolClient,
  QueryClient,
  QueryPool,
  QueryResult,
  QueryTarget,
} from "./adapter.js";

/** The only SQL operation exposed by this host adapter. */
export const P0_OPERATIONS_RECONCILIATION_QUERY =
  "select * from app_private.reconcile_p0_agent_feed_work_unit($1::jsonb)" as const;

/** Backwards-compatible short name for callers that use the SQL operation name. */
export const P0_RECONCILIATION_QUERY = P0_OPERATIONS_RECONCILIATION_QUERY;

export interface P0OperationsReconciliationResult {
  readonly inserted_count: number;
  readonly duplicate_count: number;
}

export interface P0OperationsStore {
  /** Admit and transactionally reconcile one receipt/work unit. */
  readonly reconcile: (
    input: unknown,
  ) => Promise<P0OperationsReconciliationResult>;
}

type JsonRecord = Record<string, unknown>;

const RESULT_KEYS = Object.freeze([
  "inserted_count",
  "duplicate_count",
] as const);

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

function exactResultRow(value: unknown): JsonRecord {
  if (!isPlainRecord(value))
    throw new TypeError("p0_operations_reconciliation_result_invalid");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.getOwnPropertySymbols(value).length > 0)
    throw new TypeError("p0_operations_reconciliation_result_invalid");
  const actual = Object.keys(descriptors).sort();
  const expected = [...RESULT_KEYS].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  )
    throw new TypeError("p0_operations_reconciliation_result_invalid");
  for (const key of RESULT_KEYS) {
    const descriptor = descriptors[key];
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !("value" in descriptor)
    )
      throw new TypeError("p0_operations_reconciliation_result_invalid");
  }
  return value;
}

function safeCount(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0)
    throw new TypeError(`p0_operations_reconciliation_${field}_invalid`);
  return value as number;
}

function reconciliationResult(
  result: QueryResult<unknown>,
): P0OperationsReconciliationResult {
  if (!Array.isArray(result.rows) || result.rows.length !== 1) {
    throw new Error("p0_operations_reconciliation_empty_result");
  }
  const row = result.rows[0];
  if (row === undefined)
    throw new Error("p0_operations_reconciliation_empty_result");
  const value = exactResultRow(row);
  return Object.freeze({
    inserted_count: safeCount(value.inserted_count, "inserted_count"),
    duplicate_count: safeCount(value.duplicate_count, "duplicate_count"),
  });
}

function isQueryPool(target: QueryTarget): target is QueryPool {
  return "connect" in target && typeof target.connect === "function";
}

function asError(value: unknown): Error {
  return value instanceof Error
    ? value
    : new Error("p0_operations_reconciliation_failed");
}

/**
 * Construct a driver-neutral host store bound to one admitted operations
 * manifest.  Receipt admission and cloning happen before checkout, BEGIN, or
 * any query; the database function owns work-unit identity, preflight,
 * all-or-nothing insertion, and idempotency.
 */
export function createPostgresP0OperationsStore(
  target: QueryTarget,
  manifest: P0OperationsManifest,
): P0OperationsStore {
  const reconcile = async (
    input: unknown,
  ): Promise<P0OperationsReconciliationResult> => {
    // The admitted value is a scan-produced clone. Never serialize the caller's
    // object, which may be a getter/proxy or may be changed after admission.
    const admitted = admitP0ReceiptReconciliation(manifest, input);
    const payload = JSON.stringify(admitted);

    let client: QueryClient | PoolClient = target;
    let release: ((error?: Error) => void) | undefined;
    let transactionAttempted = false;
    let committed = false;
    let failed = false;
    let originalError: unknown;

    try {
      if (isQueryPool(target)) {
        const checkedOut = await target.connect();
        client = checkedOut;
        release = checkedOut.release;
      }
      transactionAttempted = true;
      await client.query("BEGIN");
      const result = await client.query<unknown>(
        P0_OPERATIONS_RECONCILIATION_QUERY,
        [payload],
      );
      const outcome = reconciliationResult(result);
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
          // Preserve the original transaction/query/result error.
        }
      }
      throw error;
    } finally {
      if (release !== undefined) {
        try {
          if (failed) release(asError(originalError));
          else release();
        } catch {
          // Preserve the original transaction/query/result error.
        }
      }
    }
  };

  return Object.freeze({ reconcile });
}

/** Explicit alias for applications that name the adapter a host. */
export const createPostgresP0OperationsHost = createPostgresP0OperationsStore;
