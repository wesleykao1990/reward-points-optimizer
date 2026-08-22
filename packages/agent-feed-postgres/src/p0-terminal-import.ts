import { types as nodeTypes } from "node:util";

import type {
  AtomicPersistenceInput,
  AtomicPersistencePort,
  PersistenceOutcome,
  PersistenceOutcomeStatus,
  SourceObservation,
} from "@jro/agent-feed-consumer";
import { isVerifiedAtomicPersistenceInput } from "@jro/agent-feed-consumer";
import {
  admitP0ReceiptReconciliation,
  type P0OperationsManifest,
  type P0ReceiptReconciliation,
} from "@jro/p0-source-operations";

import {
  ATOMIC_FUNCTION_QUERY,
  type PoolClient,
  type QueryClient,
  type QueryPool,
  type QueryResult,
  type QueryTarget,
} from "./adapter.js";

/** The SQL function used after the receipt has acquired its database UUID. */
export const P0_TERMINAL_RECONCILIATION_QUERY =
  "select * from app_private.reconcile_p0_agent_feed_work_unit($1::jsonb)" as const;

/** Alias matching the underlying SQL operation name. */
export const P0_TERMINAL_RECONCILE_QUERY = P0_TERMINAL_RECONCILIATION_QUERY;

const TERMINAL_EVENT_STATUS = Object.freeze({
  "run.completed": "completed",
  "run.partial": "partial",
  "run.failed": "failed",
} as const);

const ATOMIC_INPUT_KEYS = Object.freeze([
  "observation",
  "receipt",
  "run_lifecycle",
  "submitted_evidence",
] as const);

const RECEIPT_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

type JsonRecord = Record<string, unknown>;

/**
 * A host-owned resolver supplies an already computed, exact P0 work-unit
 * reconciliation. It must not discover targets, infer outcomes, or derive
 * locators from the terminal event.
 */
export type P0TerminalReconciliationResolver = (
  input: AtomicPersistenceInput,
) => unknown | null | Promise<unknown | null>;

/** Object form for integrations that keep resolver methods in a host service. */
export interface P0TerminalReconciliationResolverObject {
  readonly resolve: P0TerminalReconciliationResolver;
}

/** A template is a normal P0 reconciliation with a host-owned placeholder ID. */
export type P0TerminalReconciliationTemplate = P0ReceiptReconciliation;

export interface P0TerminalAtomicPersistenceOptions {
  readonly manifest: P0OperationsManifest;
  readonly resolve_reconciliation:
    | P0TerminalReconciliationResolver
    | P0TerminalReconciliationResolverObject;
}

interface TerminalIdentity {
  readonly event_id: string;
  readonly run_id: string;
  readonly stream_id: string;
  readonly terminal_status: "completed" | "partial" | "failed";
}

interface AtomicResultRow {
  readonly receipt_id?: unknown;
  readonly status?: unknown;
  readonly observation?: unknown;
  readonly duplicate_kind?: unknown;
  readonly duplicate_of_receipt_id?: unknown;
  readonly reason_code?: unknown;
}

interface ReconciliationResult {
  readonly inserted_count: number;
  readonly duplicate_count: number;
}

function isPlainRecord(value: unknown): value is JsonRecord {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    nodeTypes.isProxy(value)
  )
    return false;
  let prototype: object | null;
  try {
    prototype = Object.getPrototypeOf(value);
  } catch {
    return false;
  }
  return prototype === Object.prototype || prototype === null;
}

/**
 * Clone only data properties before invoking the resolver or serializing the
 * persistence input. This keeps getters, proxies, cycles, and class instances
 * out of the transaction boundary without adding a second protocol schema.
 */
function clonePlainData(
  value: unknown,
  active: WeakSet<object> = new WeakSet(),
): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new TypeError("p0_terminal_input_invalid");
    return value;
  }
  if (typeof value !== "object" || nodeTypes.isProxy(value))
    throw new TypeError("p0_terminal_input_invalid");
  if (active.has(value)) throw new TypeError("p0_terminal_input_invalid");
  active.add(value);

  let descriptors: Record<string, PropertyDescriptor>;
  let symbols: symbol[];
  let prototype: object | null;
  try {
    descriptors = Object.getOwnPropertyDescriptors(value);
    symbols = Object.getOwnPropertySymbols(value);
    prototype = Object.getPrototypeOf(value);
  } catch {
    active.delete(value);
    throw new TypeError("p0_terminal_input_invalid");
  }
  if (symbols.length > 0) {
    active.delete(value);
    throw new TypeError("p0_terminal_input_invalid");
  }

  if (Array.isArray(value)) {
    const lengthDescriptor = descriptors.length;
    if (
      lengthDescriptor === undefined ||
      !("value" in lengthDescriptor) ||
      !Number.isSafeInteger(lengthDescriptor.value) ||
      (lengthDescriptor.value as number) < 0
    ) {
      active.delete(value);
      throw new TypeError("p0_terminal_input_invalid");
    }
    const output: unknown[] = [];
    const length = lengthDescriptor.value as number;
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !("value" in descriptor)
      ) {
        active.delete(value);
        throw new TypeError("p0_terminal_input_invalid");
      }
      output[index] = clonePlainData(descriptor.value, active);
    }
    for (const key of Object.keys(descriptors)) {
      if (key !== "length" && !/^\d+$/u.test(key)) {
        active.delete(value);
        throw new TypeError("p0_terminal_input_invalid");
      }
    }
    active.delete(value);
    return output;
  }

  if (prototype !== Object.prototype && prototype !== null) {
    active.delete(value);
    throw new TypeError("p0_terminal_input_invalid");
  }
  const output: JsonRecord = Object.create(null) as JsonRecord;
  for (const key of Object.keys(descriptors)) {
    if (key === "__proto__" || key === "prototype" || key === "constructor") {
      active.delete(value);
      throw new TypeError("p0_terminal_input_invalid");
    }
    const descriptor = descriptors[key];
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !("value" in descriptor)
    ) {
      active.delete(value);
      throw new TypeError("p0_terminal_input_invalid");
    }
    Object.defineProperty(output, key, {
      value: clonePlainData(descriptor.value, active),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  active.delete(value);
  return output;
}

function exactKeys(value: JsonRecord, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return (
    actual.length === wanted.length &&
    actual.every((key, index) => key === wanted[index])
  );
}

function own(value: JsonRecord, key: string): unknown {
  return value[key];
}

function asString(value: unknown, error = "p0_terminal_input_invalid"): string {
  if (typeof value !== "string" || value.length === 0)
    throw new TypeError(error);
  return value;
}

function terminalIdentity(input: AtomicPersistenceInput): TerminalIdentity {
  const root = input as unknown as JsonRecord;
  if (!isPlainRecord(root) || !exactKeys(root, ATOMIC_INPUT_KEYS))
    throw new TypeError("p0_terminal_input_invalid");
  const receipt = own(root, "receipt");
  const lifecycle = own(root, "run_lifecycle");
  const evidence = own(root, "submitted_evidence");
  if (
    !isPlainRecord(receipt) ||
    !isPlainRecord(lifecycle) ||
    own(root, "observation") !== null ||
    !Array.isArray(evidence) ||
    evidence.length !== 0
  )
    throw new TypeError("p0_terminal_input_invalid");

  const eventType = own(receipt, "event_type");
  const expectedStatus =
    typeof eventType === "string"
      ? TERMINAL_EVENT_STATUS[eventType as keyof typeof TERMINAL_EVENT_STATUS]
      : undefined;
  if (expectedStatus === undefined)
    throw new TypeError("p0_terminal_input_not_terminal");
  if (
    own(receipt, "processing_status") !== "received" ||
    own(receipt, "redaction_status") !== "complete" ||
    own(receipt, "finding_id") !== null ||
    own(lifecycle, "kind") !== "terminal" ||
    own(lifecycle, "status") !== expectedStatus ||
    own(lifecycle, "absent_run") !== false
  )
    throw new TypeError("p0_terminal_input_identity_mismatch");

  const eventId = asString(own(receipt, "event_id"));
  const runId = asString(own(receipt, "run_id"));
  const streamId = asString(own(receipt, "stream_id"));
  if (
    own(lifecycle, "event_id") !== eventId ||
    own(lifecycle, "run_id") !== runId ||
    own(lifecycle, "stream_id") !== streamId
  )
    throw new TypeError("p0_terminal_input_identity_mismatch");
  return {
    event_id: eventId,
    run_id: runId,
    stream_id: streamId,
    terminal_status: expectedStatus,
  };
}

function asStatus(value: unknown): PersistenceOutcomeStatus {
  if (
    value !== "inserted" &&
    value !== "mapped" &&
    value !== "duplicate" &&
    value !== "quarantined"
  )
    throw new TypeError("p0_terminal_atomic_result_invalid_status");
  return value;
}

function asObservation(value: unknown): SourceObservation | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value === "object")
    return value as SourceObservation | null;
  throw new TypeError("p0_terminal_atomic_result_invalid_observation");
}

function atomicOutcome(
  result: QueryResult<AtomicResultRow>,
): PersistenceOutcome {
  if (!Array.isArray(result.rows) || result.rows.length !== 1) {
    throw new Error("p0_terminal_atomic_result_empty");
  }
  const row = result.rows[0];
  if (row === undefined || !isPlainRecord(row))
    throw new Error("p0_terminal_atomic_result_empty");
  if (typeof row.receipt_id !== "string" || !RECEIPT_UUID.test(row.receipt_id))
    throw new TypeError("p0_terminal_atomic_result_invalid_receipt_id");
  const outcome: PersistenceOutcome = {
    status: asStatus(row.status),
    receipt_id: row.receipt_id,
  };
  const observation = asObservation(row.observation);
  if (observation !== undefined) outcome.observation = observation;
  if (row.duplicate_kind !== undefined && row.duplicate_kind !== null) {
    if (row.duplicate_kind !== "transport" && row.duplicate_kind !== "semantic")
      throw new TypeError("p0_terminal_atomic_result_invalid_duplicate_kind");
    outcome.duplicate_kind = row.duplicate_kind;
  }
  if (
    row.duplicate_of_receipt_id !== undefined &&
    row.duplicate_of_receipt_id !== null
  ) {
    outcome.duplicate_of_receipt_id = asString(
      row.duplicate_of_receipt_id,
      "p0_terminal_atomic_result_invalid_duplicate_receipt_id",
    );
  } else if (row.duplicate_of_receipt_id === null) {
    outcome.duplicate_of_receipt_id = null;
  }
  if (row.reason_code !== undefined && row.reason_code !== null) {
    outcome.reason_code = asString(
      row.reason_code,
      "p0_terminal_atomic_result_invalid_reason_code",
    );
  }
  return outcome;
}

function safeCount(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0)
    throw new TypeError(`p0_terminal_reconciliation_${field}_invalid`);
  return value as number;
}

function reconciliationResult(
  result: QueryResult<unknown>,
): ReconciliationResult {
  if (!Array.isArray(result.rows) || result.rows.length !== 1)
    throw new Error("p0_terminal_reconciliation_empty_result");
  const row = result.rows[0];
  if (!isPlainRecord(row))
    throw new TypeError("p0_terminal_reconciliation_result_invalid");
  const descriptors = Object.getOwnPropertyDescriptors(row);
  const keys = Object.keys(descriptors).sort();
  if (
    keys.length !== 2 ||
    keys[0] !== "duplicate_count" ||
    keys[1] !== "inserted_count" ||
    Object.getOwnPropertySymbols(row).length > 0
  )
    throw new TypeError("p0_terminal_reconciliation_result_invalid");
  for (const key of ["inserted_count", "duplicate_count"] as const) {
    const descriptor = descriptors[key];
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !("value" in descriptor)
    )
      throw new TypeError("p0_terminal_reconciliation_result_invalid");
  }
  return {
    inserted_count: safeCount(row.inserted_count, "inserted_count"),
    duplicate_count: safeCount(row.duplicate_count, "duplicate_count"),
  };
}

function isQueryPool(target: QueryTarget): target is QueryPool {
  return "connect" in target && typeof target.connect === "function";
}

function asError(value: unknown): Error {
  return value instanceof Error
    ? value
    : new Error("p0_terminal_import_failed");
}

function resolverOf(
  value:
    | P0TerminalReconciliationResolver
    | P0TerminalReconciliationResolverObject,
): P0TerminalReconciliationResolver {
  if (typeof value === "function") return value;
  if (
    value !== null &&
    typeof value === "object" &&
    typeof value.resolve === "function"
  )
    return value.resolve.bind(value);
  throw new TypeError("p0_terminal_resolver_invalid");
}

/**
 * Create the narrow Rewards P0 terminal import port.
 *
 * The resolver is intentionally host-owned: this adapter never queries Agent
 * Feed state, derives target outcomes, or accepts a non-terminal event. A
 * terminal input and its exact reconciliation template are admitted before a
 * client is checked out. Receipt persistence and checkpoint reconciliation then
 * share one checked-out client and one transaction.
 */
export function createPostgresP0TerminalAtomicPersistence(
  target: QueryTarget,
  manifest: P0OperationsManifest,
  resolver:
    | P0TerminalReconciliationResolver
    | P0TerminalReconciliationResolverObject,
): AtomicPersistencePort;
export function createPostgresP0TerminalAtomicPersistence(
  target: QueryTarget,
  options: P0TerminalAtomicPersistenceOptions,
): AtomicPersistencePort;
export function createPostgresP0TerminalAtomicPersistence(
  target: QueryTarget,
  manifestOrOptions: P0OperationsManifest | P0TerminalAtomicPersistenceOptions,
  maybeResolver?:
    | P0TerminalReconciliationResolver
    | P0TerminalReconciliationResolverObject,
): AtomicPersistencePort {
  const options =
    "manifest" in manifestOrOptions &&
    "resolve_reconciliation" in manifestOrOptions
      ? manifestOrOptions
      : {
          manifest: manifestOrOptions,
          resolve_reconciliation: maybeResolver,
        };
  if (options.resolve_reconciliation === undefined)
    throw new TypeError("p0_terminal_resolver_invalid");
  const resolve = resolverOf(options.resolve_reconciliation);

  return {
    async persist(input: AtomicPersistenceInput): Promise<PersistenceOutcome> {
      if (!isVerifiedAtomicPersistenceInput(input))
        throw new TypeError("p0_terminal_input_unverified");
      // The clone is also what gets passed to the host resolver. A resolver
      // cannot mutate the caller's input after preflight and alter the SQL
      // payload that is eventually committed.
      const safeInput = clonePlainData(input) as AtomicPersistenceInput;
      const identity = terminalIdentity(safeInput);
      const resolved = await resolve(safeInput);
      if (resolved === null || resolved === undefined)
        throw new TypeError("p0_terminal_reconciliation_unavailable");

      const admittedTemplate = admitP0ReceiptReconciliation(
        options.manifest,
        resolved,
      );
      if (
        admittedTemplate.run_id !== identity.run_id ||
        admittedTemplate.stream_id !== identity.stream_id ||
        admittedTemplate.terminal_status !== identity.terminal_status
      )
        throw new TypeError("p0_terminal_reconciliation_identity_mismatch");
      if (
        admittedTemplate.checkpoints.some(
          (checkpoint) =>
            checkpoint.run_id !== identity.run_id ||
            checkpoint.stream_id !== identity.stream_id ||
            checkpoint.event_id !== identity.event_id,
        )
      )
        throw new TypeError("p0_terminal_reconciliation_identity_mismatch");

      const payload = JSON.stringify(safeInput);
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
        const persisted = await client.query<AtomicResultRow>(
          ATOMIC_FUNCTION_QUERY,
          [payload],
        );
        const outcome = atomicOutcome(persisted);
        const bound = admitP0ReceiptReconciliation(options.manifest, {
          ...admittedTemplate,
          receipt_id: outcome.receipt_id,
          checkpoints: admittedTemplate.checkpoints.map((checkpoint) => ({
            ...checkpoint,
            receipt_id: outcome.receipt_id,
          })),
        });
        const reconciliationPayload = JSON.stringify(bound);
        const reconciled = await client.query<unknown>(
          P0_TERMINAL_RECONCILIATION_QUERY,
          [reconciliationPayload],
        );
        // Validate the function result even though AtomicPersistencePort only
        // returns the receipt outcome. A malformed result must not commit.
        reconciliationResult(reconciled);
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
            // Preserve the original SQL/admission/commit error.
          }
        }
        throw error;
      } finally {
        if (release !== undefined) {
          try {
            if (failed) release(asError(originalError));
            else release();
          } catch {
            // Preserve the original transaction/query/commit error.
          }
        }
      }
    },
  };
}

/** Explicit name for callers that describe this boundary as an import. */
export const createPostgresP0TerminalImport =
  createPostgresP0TerminalAtomicPersistence;
