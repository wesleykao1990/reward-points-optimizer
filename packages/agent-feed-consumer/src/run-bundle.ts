import { computeSemanticFingerprint } from "./mapping.js";
import {
  createPublishedSchemaValidator,
  summarizeSchemaIssues,
  validateTerminalDeliveryPayload,
} from "./schema.js";
import type {
  AgentFeedDeliveryEvent,
  AgentFeedFinding,
  AgentFeedSchemaValidator,
  SchemaIssue,
  SubmittedEvidence,
} from "./types.js";
import {
  canonicalJson,
  cloneJson,
  isoDate,
  isPlainRecord,
  prefixedSha256,
  sha256Hex,
} from "./util.js";

/** The only provenance mode accepted by this local importer. */
export const RUN_BUNDLE_IMPORT_MODE = "local_run_bundle_import" as const;

type RunTerminalStatus = "completed" | "partial" | "failed" | "cancelled";
type BundleEventPhase = "begin" | "finding" | "terminal";

export interface RunBundleImportProvenance {
  mode: typeof RUN_BUNDLE_IMPORT_MODE;
  bundle_hash: string;
  imported_at: string;
}

export interface RunBundleValidationResult {
  valid: boolean;
  bundle_hash: string | null;
  issues: readonly SchemaIssue[];
  run_id: string | null;
}

export interface RunBundleNormalizeOptions {
  /** Caller-owned import timestamp. It never contributes to event IDs or fingerprints. */
  imported_at?: Date | string | number;
  /** Transport retry attempt. Event IDs stay stable; delivery IDs change. */
  attempt?: number;
  delivery_attempt?: number;
}

export interface RunBundleDeliveryContext {
  bundle_hash: string;
  provenance: RunBundleImportProvenance;
  event_id: string;
  delivery_id: string;
  attempt: number;
  phase: BundleEventPhase;
  ordinal: number;
  batch_index: number | null;
  finding_id: string | null;
  semantic_fingerprint: string | null;
}

/** A normalized event plus transport/provenance metadata for persistence ports. */
export interface RunBundleDelivery {
  event: AgentFeedDeliveryEvent;
  context: RunBundleDeliveryContext;
  bundle_hash: string;
  provenance: RunBundleImportProvenance;
  event_id: string;
  delivery_id: string;
  attempt: number;
  phase: BundleEventPhase;
  ordinal: number;
  batch_index: number | null;
  finding_id: string | null;
  semantic_fingerprint: string | null;
}

/**
 * The only supported persistence boundary. A sink receives one immutable
 * batch and owns the all-or-nothing transaction for the complete replay.
 */
export type RunBundleBatchSink = (
  deliveries: readonly RunBundleDelivery[],
) => void | Promise<void>;

export interface RunBundleNormalizeResult {
  run_id: string;
  stream_id: string;
  bundle_hash: string;
  provenance: RunBundleImportProvenance;
  terminal_status: RunTerminalStatus | null;
  status: RunTerminalStatus | "rejected";
  /** Delivery events in replay order: begin, findings, terminal. */
  events: readonly AgentFeedDeliveryEvent[];
  /** Full event views including deterministic local transport identity. */
  deliveries: readonly RunBundleDelivery[];
  /** Explicit aliases make the normalized event set unambiguous to callers. */
  delivery_events: readonly RunBundleDelivery[];
  event_ids: readonly string[];
  delivery_ids: readonly string[];
  finding_fingerprints: Readonly<Record<string, string>>;
  counts: {
    events: number;
    started: number;
    findings: number;
    terminal: number;
    evidence: number;
    batches: number;
  };
}

export interface RunBundleImportOptions extends RunBundleNormalizeOptions {
  /** Explicit all-or-nothing sink; it is invoked at most once. */
  batch_sink?: RunBundleBatchSink;
  /** Alias for integrations that call their atomic batch boundary a sink. */
  sink?: RunBundleBatchSink;
}

export interface RunBundleImportResult extends RunBundleNormalizeResult {
  valid: boolean;
  normalized: boolean;
  imported: boolean;
  accepted: boolean;
  quarantined: boolean;
  callbacks: number;
  callback_count: number;
  sink_invocations: number;
  sink_error?: string;
  status: RunTerminalStatus | "rejected";
  issues: readonly SchemaIssue[];
}

interface WireBundle {
  protocol_version: "0.1";
  run_id: string;
  begin: Record<string, unknown>;
  batches: Record<string, unknown>[];
  complete: Record<string, unknown>;
}

const BEGIN_KEYS = [
  "protocol_version",
  "idempotency_key",
  "stream_id",
  "producer",
  "task",
  "expected_scope",
  "started_at",
  "parent_run_id",
  "metadata",
] as const;
const BATCH_KEYS = [
  "protocol_version",
  "run_id",
  "batch_id",
  "idempotency_key",
  "sequence_number",
  "submitted_at",
  "findings",
  "evidence",
  "metadata",
] as const;
const COMPLETE_KEYS = [
  "protocol_version",
  "run_id",
  "idempotency_key",
  "status",
  "completed_at",
  "actual_scope",
  "stats",
  "errors",
  "metadata",
] as const;
const SCOPE_KEYS = ["source_ids", "subjects", "queries", "metadata"] as const;
const STATS_KEYS = [
  "sources_attempted",
  "sources_succeeded",
  "findings_submitted",
  "evidence_submitted",
  "batches_submitted",
] as const;
const TERMINAL_STATUSES = new Set<RunTerminalStatus>([
  "completed",
  "partial",
  "failed",
  "cancelled",
]);

function issue(message: string, instancePath = ""): SchemaIssue {
  return { instancePath, message };
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    keys.every((key) => required.includes(key))
  );
}

function stringArray(value: unknown, unique: boolean): boolean {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === "string") &&
    (!unique || new Set(value).size === value.length)
  );
}

function dateTime(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(
      value,
    ) &&
    Number.isFinite(Date.parse(value))
  );
}

function nonEmptyString(value: unknown, minimum = 1): value is string {
  return typeof value === "string" && value.length >= minimum;
}

function validateScope(value: unknown, path: string): SchemaIssue[] {
  if (!isPlainRecord(value) || !exactKeys(value, SCOPE_KEYS))
    return [issue("invalid run scope", path)];
  const errors: SchemaIssue[] = [];
  if (!stringArray(value.source_ids, true))
    errors.push(issue("invalid source_ids", `${path}/source_ids`));
  if (!stringArray(value.subjects, true))
    errors.push(issue("invalid subjects", `${path}/subjects`));
  if (!stringArray(value.queries, false))
    errors.push(issue("invalid queries", `${path}/queries`));
  if (!isPlainRecord(value.metadata))
    errors.push(issue("invalid metadata", `${path}/metadata`));
  return errors;
}

function validateProducer(value: unknown, path: string): SchemaIssue[] {
  if (
    !isPlainRecord(value) ||
    !exactKeys(value, ["producer_id", "type", "name", "version"])
  )
    return [issue("invalid producer", path)];
  const errors: SchemaIssue[] = [];
  if (!nonEmptyString(value.producer_id))
    errors.push(issue("invalid producer_id", `${path}/producer_id`));
  if (
    typeof value.type !== "string" ||
    !new Set([
      "chatgpt",
      "claude",
      "codex",
      "custom_agent",
      "human",
      "automation",
    ]).has(value.type)
  )
    errors.push(issue("invalid producer type", `${path}/type`));
  if (!nonEmptyString(value.name))
    errors.push(issue("invalid producer name", `${path}/name`));
  if (value.version !== null && typeof value.version !== "string")
    errors.push(issue("invalid producer version", `${path}/version`));
  return errors;
}

function validateTask(value: unknown, path: string): SchemaIssue[] {
  if (
    !isPlainRecord(value) ||
    !exactKeys(value, ["task_type", "definition_id", "definition_version"])
  )
    return [issue("invalid task", path)];
  const errors: SchemaIssue[] = [];
  if (!nonEmptyString(value.task_type))
    errors.push(issue("invalid task_type", `${path}/task_type`));
  for (const key of ["definition_id", "definition_version"] as const) {
    if (value[key] !== null && typeof value[key] !== "string")
      errors.push(issue(`invalid ${key}`, `${path}/${key}`));
  }
  return errors;
}

function localWireShapeIssues(value: unknown): SchemaIssue[] {
  if (!isPlainRecord(value)) return [issue("run bundle must be an object")];
  if (
    !exactKeys(value, [
      "protocol_version",
      "run_id",
      "begin",
      "batches",
      "complete",
    ])
  )
    return [issue("run bundle has unexpected or missing fields")];
  const errors: SchemaIssue[] = [];
  if (value.protocol_version !== "0.1")
    errors.push(issue("protocol_version must be 0.1", "/protocol_version"));
  if (!nonEmptyString(value.run_id, 8))
    errors.push(issue("invalid run_id", "/run_id"));
  const begin = value.begin;
  if (!isPlainRecord(begin) || !exactKeys(begin, BEGIN_KEYS)) {
    errors.push(issue("invalid begin run", "/begin"));
  } else {
    if (begin.protocol_version !== "0.1")
      errors.push(issue("invalid protocol_version", "/begin/protocol_version"));
    if (!nonEmptyString(begin.idempotency_key, 8))
      errors.push(issue("invalid idempotency_key", "/begin/idempotency_key"));
    if (
      typeof begin.stream_id !== "string" ||
      !/^[a-z0-9][a-z0-9._-]+$/u.test(begin.stream_id)
    )
      errors.push(issue("invalid stream_id", "/begin/stream_id"));
    errors.push(...validateProducer(begin.producer, "/begin/producer"));
    errors.push(...validateTask(begin.task, "/begin/task"));
    errors.push(
      ...validateScope(begin.expected_scope, "/begin/expected_scope"),
    );
    if (!dateTime(begin.started_at))
      errors.push(issue("invalid started_at", "/begin/started_at"));
    if (begin.parent_run_id !== null && typeof begin.parent_run_id !== "string")
      errors.push(issue("invalid parent_run_id", "/begin/parent_run_id"));
    if (!isPlainRecord(begin.metadata))
      errors.push(issue("invalid metadata", "/begin/metadata"));
  }
  if (!Array.isArray(value.batches)) {
    errors.push(issue("batches must be an array", "/batches"));
  } else {
    for (const [index, batch] of value.batches.entries()) {
      const path = `/batches/${index}`;
      if (!isPlainRecord(batch) || !exactKeys(batch, BATCH_KEYS)) {
        errors.push(issue("invalid submit batch", path));
        continue;
      }
      if (batch.protocol_version !== "0.1")
        errors.push(
          issue("invalid protocol_version", `${path}/protocol_version`),
        );
      if (!nonEmptyString(batch.run_id, 8))
        errors.push(issue("invalid run_id", `${path}/run_id`));
      if (!nonEmptyString(batch.batch_id, 3))
        errors.push(issue("invalid batch_id", `${path}/batch_id`));
      if (!nonEmptyString(batch.idempotency_key, 8))
        errors.push(
          issue("invalid idempotency_key", `${path}/idempotency_key`),
        );
      if (
        !Number.isSafeInteger(batch.sequence_number) ||
        (batch.sequence_number as number) < 1
      )
        errors.push(
          issue("invalid sequence_number", `${path}/sequence_number`),
        );
      if (!dateTime(batch.submitted_at))
        errors.push(issue("invalid submitted_at", `${path}/submitted_at`));
      if (!Array.isArray(batch.findings) || batch.findings.length > 100)
        errors.push(issue("invalid findings", `${path}/findings`));
      if (!Array.isArray(batch.evidence) || batch.evidence.length > 500)
        errors.push(issue("invalid evidence", `${path}/evidence`));
      if (
        Array.isArray(batch.findings) &&
        Array.isArray(batch.evidence) &&
        batch.findings.length === 0 &&
        batch.evidence.length === 0
      )
        errors.push(issue("batch must contain findings or evidence", path));
      if (!isPlainRecord(batch.metadata))
        errors.push(issue("invalid metadata", `${path}/metadata`));
    }
  }
  const complete = value.complete;
  if (!isPlainRecord(complete) || !exactKeys(complete, COMPLETE_KEYS)) {
    errors.push(issue("invalid complete run", "/complete"));
  } else {
    if (complete.protocol_version !== "0.1")
      errors.push(
        issue("invalid protocol_version", "/complete/protocol_version"),
      );
    if (!nonEmptyString(complete.run_id, 8))
      errors.push(issue("invalid run_id", "/complete/run_id"));
    if (!nonEmptyString(complete.idempotency_key, 8))
      errors.push(
        issue("invalid idempotency_key", "/complete/idempotency_key"),
      );
    if (!TERMINAL_STATUSES.has(complete.status as RunTerminalStatus))
      errors.push(issue("invalid terminal status", "/complete/status"));
    if (!dateTime(complete.completed_at))
      errors.push(issue("invalid completed_at", "/complete/completed_at"));
    errors.push(
      ...validateScope(complete.actual_scope, "/complete/actual_scope"),
    );
    if (
      !isPlainRecord(complete.stats) ||
      !exactKeys(complete.stats, STATS_KEYS)
    ) {
      errors.push(issue("invalid stats", "/complete/stats"));
    } else {
      for (const key of STATS_KEYS) {
        if (
          !Number.isSafeInteger(complete.stats[key]) ||
          (complete.stats[key] as number) < 0
        )
          errors.push(issue(`invalid ${key}`, `/complete/stats/${key}`));
      }
    }
    if (!Array.isArray(complete.errors))
      errors.push(issue("invalid errors", "/complete/errors"));
    else {
      for (const [index, error] of complete.errors.entries()) {
        const path = `/complete/errors/${index}`;
        if (
          !isPlainRecord(error) ||
          !exactKeys(error, ["code", "message", "source_id", "retryable"])
        ) {
          errors.push(issue("invalid complete error", path));
          continue;
        }
        if (typeof error.code !== "string" || typeof error.message !== "string")
          errors.push(issue("invalid complete error text", path));
        if (error.source_id !== null && typeof error.source_id !== "string")
          errors.push(
            issue("invalid complete error source_id", `${path}/source_id`),
          );
        if (typeof error.retryable !== "boolean")
          errors.push(
            issue("invalid complete error retryable", `${path}/retryable`),
          );
      }
    }
    if (!isPlainRecord(complete.metadata))
      errors.push(issue("invalid metadata", "/complete/metadata"));
  }
  return errors;
}

function asWireBundle(value: unknown): WireBundle | null {
  if (
    !isPlainRecord(value) ||
    !isPlainRecord(value.begin) ||
    !Array.isArray(value.batches) ||
    !isPlainRecord(value.complete)
  )
    return null;
  if (!value.batches.every(isPlainRecord)) return null;
  return value as unknown as WireBundle;
}

interface CanonicalSnapshot {
  value: unknown;
  bundle_hash: string;
}

function freezeDeep<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>))
    freezeDeep(child);
  return Object.freeze(value);
}

/**
 * Canonicalize and clone before the first await. The validator and normalizer
 * only ever receive this frozen snapshot, so caller mutation cannot race an
 * async schema validator or a sink.
 */
function canonicalSnapshot(value: unknown): CanonicalSnapshot | null {
  try {
    const canonical = canonicalJson(value);
    const snapshot = JSON.parse(canonical) as unknown;
    return {
      value: freezeDeep(snapshot),
      bundle_hash: prefixedSha256(canonical),
    };
  } catch {
    return null;
  }
}

function immutableClone<T>(value: T): T {
  return freezeDeep(JSON.parse(canonicalJson(value)) as T);
}

async function semanticIssues(
  bundle: WireBundle,
  validator: AgentFeedSchemaValidator,
): Promise<SchemaIssue[]> {
  const errors: SchemaIssue[] = [];
  if (bundle.complete.run_id !== bundle.run_id)
    errors.push(
      issue("complete run_id does not match bundle run_id", "/complete/run_id"),
    );
  const batchIds = new Set<string>();
  const batchKeys = new Set<string>();
  const findingIds = new Set<string>();
  const evidenceIds = new Set<string>();
  let previousSequence = 0;
  let findingCount = 0;
  let evidenceCount = 0;
  const allEvidenceRefs = new Set<string>();
  for (const [index, batch] of bundle.batches.entries()) {
    if (batch.run_id !== bundle.run_id)
      errors.push(
        issue(
          "batch run_id does not match bundle run_id",
          `/batches/${index}/run_id`,
        ),
      );
    if (
      !Number.isSafeInteger(batch.sequence_number) ||
      (batch.sequence_number as number) <= previousSequence
    )
      errors.push(
        issue(
          "batch sequence_number must increase",
          `/batches/${index}/sequence_number`,
        ),
      );
    previousSequence = Number.isSafeInteger(batch.sequence_number)
      ? (batch.sequence_number as number)
      : previousSequence;
    if (typeof batch.batch_id === "string" && batchIds.has(batch.batch_id))
      errors.push(issue("duplicate batch_id", `/batches/${index}/batch_id`));
    if (typeof batch.batch_id === "string") batchIds.add(batch.batch_id);
    if (
      typeof batch.idempotency_key === "string" &&
      batchKeys.has(batch.idempotency_key)
    )
      errors.push(
        issue(
          "duplicate batch idempotency_key",
          `/batches/${index}/idempotency_key`,
        ),
      );
    if (typeof batch.idempotency_key === "string")
      batchKeys.add(batch.idempotency_key);
    if (Array.isArray(batch.evidence)) {
      evidenceCount += batch.evidence.length;
      for (const [evidenceIndex, value] of batch.evidence.entries()) {
        const result = await validator.validate("evidence", value);
        if (!result.valid)
          errors.push(
            issue(
              `evidence schema invalid: ${summarizeSchemaIssues(result)}`,
              `/batches/${index}/evidence/${evidenceIndex}`,
            ),
          );
        if (isPlainRecord(value) && typeof value.evidence_id === "string") {
          if (evidenceIds.has(value.evidence_id))
            errors.push(
              issue(
                "duplicate evidence_id",
                `/batches/${index}/evidence/${evidenceIndex}/evidence_id`,
              ),
            );
          evidenceIds.add(value.evidence_id);
          allEvidenceRefs.add(value.evidence_id);
        }
      }
    }
  }
  for (const [index, batch] of bundle.batches.entries()) {
    if (!Array.isArray(batch.findings)) continue;
    findingCount += batch.findings.length;
    for (const [findingIndex, value] of batch.findings.entries()) {
      const result = await validator.validate("finding", value);
      if (!result.valid)
        errors.push(
          issue(
            `finding schema invalid: ${summarizeSchemaIssues(result)}`,
            `/batches/${index}/findings/${findingIndex}`,
          ),
        );
      if (!isPlainRecord(value)) continue;
      if (typeof value.finding_id === "string") {
        if (findingIds.has(value.finding_id))
          errors.push(
            issue(
              "duplicate finding_id",
              `/batches/${index}/findings/${findingIndex}/finding_id`,
            ),
          );
        findingIds.add(value.finding_id);
      }
      if (Array.isArray(value.evidence_refs)) {
        for (const [refIndex, reference] of value.evidence_refs.entries()) {
          if (typeof reference !== "string" || !allEvidenceRefs.has(reference))
            errors.push(
              issue(
                "unresolved evidence reference",
                `/batches/${index}/findings/${findingIndex}/evidence_refs/${refIndex}`,
              ),
            );
        }
      }
    }
  }
  const stats = bundle.complete.stats;
  if (isPlainRecord(stats)) {
    if (
      stats.batches_submitted !== bundle.batches.length ||
      stats.findings_submitted !== findingCount ||
      stats.evidence_submitted !== evidenceCount
    )
      errors.push(
        issue("completion counts do not reconcile", "/complete/stats"),
      );
    if (
      typeof stats.sources_attempted === "number" &&
      typeof stats.sources_succeeded === "number" &&
      stats.sources_succeeded > stats.sources_attempted
    )
      errors.push(
        issue(
          "sources_succeeded exceeds sources_attempted",
          "/complete/stats/sources_succeeded",
        ),
      );
  }
  const startedAt = bundle.begin.started_at;
  const completedAt = bundle.complete.completed_at;
  if (
    dateTime(startedAt) &&
    dateTime(completedAt) &&
    Date.parse(completedAt) < Date.parse(startedAt)
  )
    errors.push(issue("completion precedes start", "/complete/completed_at"));
  return errors;
}

/** Validate one already snapshotted bundle with the pinned published schema. */
async function validateSnapshot(
  snapshot: CanonicalSnapshot,
): Promise<RunBundleValidationResult> {
  const value = snapshot.value;
  const bundleHash = snapshot.bundle_hash;
  const runId =
    isPlainRecord(value) && typeof value.run_id === "string"
      ? value.run_id
      : null;
  const localIssues = localWireShapeIssues(value);
  if (localIssues.length > 0)
    return {
      valid: false,
      bundle_hash: bundleHash,
      issues: localIssues,
      run_id: runId,
    };
  const bundle = asWireBundle(value);
  if (bundle === null || bundleHash === null)
    return {
      valid: false,
      bundle_hash: bundleHash,
      issues: [issue("run bundle is not canonical JSON")],
      run_id: runId,
    };
  let validator: AgentFeedSchemaValidator;
  try {
    // Never accept a caller-provided validator here. The production importer
    // is bound to the protocol package pinned by this consumer.
    validator = createPublishedSchemaValidator();
    const root = await validator.validate("runBundle", value);
    if (!root.valid)
      return {
        valid: false,
        bundle_hash: bundleHash,
        issues: root.issues ?? [issue("run bundle schema invalid")],
        run_id: runId,
      };
    const nested = await semanticIssues(bundle, validator);
    return {
      valid: nested.length === 0,
      bundle_hash: bundleHash,
      issues: nested,
      run_id: runId,
    };
  } catch {
    return {
      valid: false,
      bundle_hash: bundleHash,
      issues: [issue("schema dependency unavailable")],
      run_id: runId,
    };
  }
}

/** Validate the complete bundle, including every nested finding/evidence item and cross-object invariants. */
export async function validateRunBundle(
  value: unknown,
): Promise<RunBundleValidationResult> {
  const snapshot = canonicalSnapshot(value);
  if (snapshot === null) {
    return {
      valid: false,
      bundle_hash: null,
      issues: [issue("run bundle is not canonical JSON")],
      run_id:
        isPlainRecord(value) && typeof value.run_id === "string"
          ? value.run_id
          : null,
    };
  }
  return validateSnapshot(snapshot);
}

function importTimestamp(value: Date | string | number | undefined): string {
  return isoDate(value ?? new Date());
}

function positiveAttempt(value: number | undefined): number {
  const attempt = value ?? 1;
  if (!Number.isSafeInteger(attempt) || attempt < 1)
    throw new TypeError("invalid_delivery_attempt");
  return attempt;
}

function eventId(bundleHash: string, phase: string, ordinal: number): string {
  return `event_${sha256Hex(canonicalJson({ bundle_hash: bundleHash, phase, ordinal }))}`;
}

function deliveryId(
  bundleHash: string,
  phase: string,
  ordinal: number,
  attempt: number,
): string {
  return `delivery_${sha256Hex(canonicalJson({ bundle_hash: bundleHash, phase, ordinal, attempt }))}`;
}

function provenance(
  bundleHash: string,
  importedAt: string,
): RunBundleImportProvenance {
  return {
    mode: RUN_BUNDLE_IMPORT_MODE,
    bundle_hash: bundleHash,
    imported_at: importedAt,
  };
}

function importMetadata(
  source: Record<string, unknown>,
  importProvenance: RunBundleImportProvenance,
): Record<string, unknown> {
  return {
    ...cloneJson(source),
    local_run_bundle_import: cloneJson(importProvenance),
  };
}

function startedEnvelope(
  bundle: WireBundle,
  importProvenance: RunBundleImportProvenance,
): Record<string, unknown> {
  const begin = bundle.begin;
  return {
    protocol_version: "0.1",
    run_id: bundle.run_id,
    stream_id: begin.stream_id,
    producer: cloneJson(begin.producer),
    task: cloneJson(begin.task),
    started_at: begin.started_at,
    completed_at: null,
    status: "running",
    expected_scope: cloneJson(begin.expected_scope),
    actual_scope: null,
    stats: {
      sources_attempted: 0,
      sources_succeeded: 0,
      findings_submitted: 0,
      evidence_submitted: 0,
      batches_submitted: 0,
    },
    parent_run_id: begin.parent_run_id,
    error_summary: null,
    metadata: importMetadata(
      begin.metadata as Record<string, unknown>,
      importProvenance,
    ),
  };
}

function terminalPayload(bundle: WireBundle): Record<string, unknown> {
  const complete = bundle.complete;
  const errors = Array.isArray(complete.errors) ? complete.errors : [];
  const errorSummary =
    errors.length === 0
      ? null
      : errors
          .map((error) => {
            if (!isPlainRecord(error)) return "invalid terminal error";
            return `${String(error.code)}: ${String(error.message)}`;
          })
          .join("; ");
  return {
    status: complete.status,
    completed_at: complete.completed_at,
    actual_scope: cloneJson(complete.actual_scope),
    expected_scope: cloneJson(bundle.begin.expected_scope),
    stats: cloneJson(complete.stats),
    error_summary: errorSummary,
  };
}

function createDelivery(
  event: AgentFeedDeliveryEvent,
  bundleHash: string,
  importedProvenance: RunBundleImportProvenance,
  phase: BundleEventPhase,
  ordinal: number,
  batchIndex: number | null,
  semanticFingerprint: string | null,
): RunBundleDelivery {
  const context: RunBundleDeliveryContext = {
    bundle_hash: bundleHash,
    provenance: importedProvenance,
    event_id: event.event_id,
    delivery_id: deliveryId(bundleHash, phase, ordinal, event.attempt),
    attempt: event.attempt,
    phase,
    ordinal,
    batch_index: batchIndex,
    finding_id: event.finding_id,
    semantic_fingerprint: semanticFingerprint,
  };
  return {
    event,
    context,
    bundle_hash: bundleHash,
    provenance: importedProvenance,
    event_id: event.event_id,
    delivery_id: context.delivery_id,
    attempt: event.attempt,
    phase,
    ordinal,
    batch_index: batchIndex,
    finding_id: event.finding_id,
    semantic_fingerprint: semanticFingerprint,
  };
}

/** Normalize a schema-valid, immutable snapshot into deterministic events. */
function normalizeSnapshot(
  snapshot: CanonicalSnapshot,
  options: RunBundleNormalizeOptions = {},
): RunBundleNormalizeResult {
  const value = snapshot.value;
  const bundle = asWireBundle(value);
  if (bundle === null) throw new TypeError("run_bundle_schema_invalid");
  const bundleHash = snapshot.bundle_hash;
  const importedAt = importTimestamp(options.imported_at);
  const attempt = positiveAttempt(options.attempt ?? options.delivery_attempt);
  const importProvenance = provenance(bundleHash, importedAt);
  const events: AgentFeedDeliveryEvent[] = [];
  const deliveries: RunBundleDelivery[] = [];
  const fingerprints: Record<string, string> = {};
  const allEvidence = new Map<string, SubmittedEvidence>();
  for (const batch of bundle.batches) {
    for (const value of Array.isArray(batch.evidence) ? batch.evidence : []) {
      if (isPlainRecord(value) && typeof value.evidence_id === "string")
        allEvidence.set(
          value.evidence_id,
          value as unknown as SubmittedEvidence,
        );
    }
  }
  const beginEvent: AgentFeedDeliveryEvent = {
    protocol_version: "0.1",
    event_id: eventId(bundleHash, "begin", 0),
    event_type: "run.started",
    stream_id: bundle.begin.stream_id as string,
    run_id: bundle.run_id,
    finding_id: null,
    occurred_at: bundle.begin.started_at as string,
    attempt,
    payload: { run_envelope: startedEnvelope(bundle, importProvenance) },
  };
  events.push(beginEvent);
  deliveries.push(
    createDelivery(
      beginEvent,
      bundleHash,
      importProvenance,
      "begin",
      0,
      null,
      null,
    ),
  );
  let findingOrdinal = 0;
  for (const [batchIndex, batch] of bundle.batches.entries()) {
    for (const value of Array.isArray(batch.findings) ? batch.findings : []) {
      const finding = value as unknown as AgentFeedFinding;
      const submittedEvidence = (
        Array.isArray(finding.evidence_refs) ? finding.evidence_refs : []
      )
        .map((reference) => allEvidence.get(reference))
        .filter((item): item is SubmittedEvidence => item !== undefined);
      const sourceIds = submittedEvidence
        .map((item) => item.source.source_id)
        .filter((sourceId): sourceId is string => typeof sourceId === "string");
      const fingerprint = computeSemanticFingerprint(finding, sourceIds);
      fingerprints[finding.finding_id] = fingerprint;
      const findingEvent: AgentFeedDeliveryEvent = {
        protocol_version: "0.1",
        event_id: eventId(bundleHash, "finding", findingOrdinal),
        event_type: "finding.submitted",
        stream_id: bundle.begin.stream_id as string,
        run_id: bundle.run_id,
        finding_id: finding.finding_id,
        occurred_at: batch.submitted_at as string,
        attempt,
        payload: {
          finding: cloneJson(finding),
          submitted_evidence: cloneJson(submittedEvidence),
          import_provenance: cloneJson(importProvenance),
        },
      };
      events.push(findingEvent);
      deliveries.push(
        createDelivery(
          findingEvent,
          bundleHash,
          importProvenance,
          "finding",
          findingOrdinal,
          batchIndex,
          fingerprint,
        ),
      );
      findingOrdinal += 1;
    }
  }
  const complete = bundle.complete;
  const completeStatus = complete.status as RunTerminalStatus;
  const terminalEvent: AgentFeedDeliveryEvent = {
    protocol_version: "0.1",
    event_id: eventId(bundleHash, "terminal", 0),
    event_type:
      completeStatus === "completed"
        ? "run.completed"
        : completeStatus === "partial"
          ? "run.partial"
          : "run.failed",
    stream_id: bundle.begin.stream_id as string,
    run_id: bundle.run_id,
    finding_id: null,
    occurred_at: complete.completed_at as string,
    attempt,
    payload: terminalPayload(bundle),
  };
  // Keep the existing terminal validator in the normalization path so a
  // future schema change cannot silently produce a lifecycle event the
  // existing consumer would quarantine.
  if (
    !validateTerminalDeliveryPayload(
      terminalEvent.payload,
      terminalEvent.event_type,
    ).valid
  )
    throw new TypeError("terminal_payload_schema_invalid");
  events.push(terminalEvent);
  deliveries.push(
    createDelivery(
      terminalEvent,
      bundleHash,
      importProvenance,
      "terminal",
      0,
      null,
      null,
    ),
  );
  return immutableClone({
    run_id: bundle.run_id,
    stream_id: bundle.begin.stream_id as string,
    bundle_hash: bundleHash,
    provenance: importProvenance,
    terminal_status: completeStatus,
    status: completeStatus,
    events,
    deliveries,
    delivery_events: deliveries,
    event_ids: deliveries.map((delivery) => delivery.event_id),
    delivery_ids: deliveries.map((delivery) => delivery.delivery_id),
    finding_fingerprints: fingerprints,
    counts: {
      events: deliveries.length,
      started: 1,
      findings: findingOrdinal,
      terminal: 1,
      evidence: bundle.batches.reduce(
        (count, batch) =>
          count + (Array.isArray(batch.evidence) ? batch.evidence.length : 0),
        0,
      ),
      batches: bundle.batches.length,
    },
  });
}

/**
 * Public normalization is async by design: it validates with the pinned
 * published schema before producing any normalized event.
 */
export async function normalizeRunBundle(
  value: unknown,
  options: RunBundleNormalizeOptions = {},
): Promise<RunBundleNormalizeResult> {
  const snapshot = canonicalSnapshot(value);
  if (snapshot === null) throw new TypeError("run_bundle_not_canonical_json");
  const normalizeOptions = {
    imported_at: importTimestamp(options.imported_at),
    attempt: positiveAttempt(options.attempt ?? options.delivery_attempt),
  } satisfies RunBundleNormalizeOptions;
  const validation = await validateSnapshot(snapshot);
  if (!validation.valid) throw new TypeError("run_bundle_schema_invalid");
  return normalizeSnapshot(snapshot, normalizeOptions);
}

function rejectedResult(
  validation: RunBundleValidationResult,
  importedAt: string,
): RunBundleImportResult {
  const hash = validation.bundle_hash ?? "";
  const importProvenance: RunBundleImportProvenance = {
    mode: RUN_BUNDLE_IMPORT_MODE,
    bundle_hash: hash,
    imported_at: importedAt,
  };
  return immutableClone({
    valid: false,
    normalized: false,
    imported: false,
    accepted: false,
    quarantined: true,
    callbacks: 0,
    callback_count: 0,
    sink_invocations: 0,
    issues: validation.issues,
    run_id: validation.run_id ?? "",
    stream_id: "",
    bundle_hash: hash,
    provenance: importProvenance,
    terminal_status: null,
    status: "rejected",
    events: [],
    deliveries: [],
    delivery_events: [],
    event_ids: [],
    delivery_ids: [],
    finding_fingerprints: {},
    counts: {
      events: 0,
      started: 0,
      findings: 0,
      terminal: 0,
      evidence: 0,
      batches: 0,
    },
  });
}

function batchSink(
  options: RunBundleImportOptions,
): RunBundleBatchSink | undefined {
  const candidates = [options.batch_sink, options.sink].filter(
    (candidate): candidate is RunBundleBatchSink => candidate !== undefined,
  );
  if (candidates.length > 1) throw new TypeError("ambiguous_atomic_batch_sink");
  const candidate = candidates[0];
  if (candidate !== undefined && typeof candidate !== "function")
    throw new TypeError("atomic_batch_sink_required");
  return candidate;
}

/** Validate once, then replay one immutable event batch through one atomic local boundary. */
export async function importRunBundle(
  value: unknown,
  options: RunBundleImportOptions = {},
): Promise<RunBundleImportResult> {
  const snapshot = canonicalSnapshot(value);
  const importedAt = importTimestamp(options.imported_at);
  const normalizeOptions = {
    imported_at: importedAt,
    attempt: positiveAttempt(options.attempt ?? options.delivery_attempt),
  } satisfies RunBundleNormalizeOptions;
  const sink = batchSink(options);
  if (snapshot === null) {
    return rejectedResult(
      {
        valid: false,
        bundle_hash: null,
        issues: [issue("run bundle is not canonical JSON")],
        run_id:
          isPlainRecord(value) && typeof value.run_id === "string"
            ? value.run_id
            : null,
      },
      importedAt,
    );
  }
  const validation = await validateSnapshot(snapshot);
  if (!validation.valid) return rejectedResult(validation, importedAt);
  const normalized = normalizeSnapshot(snapshot, normalizeOptions);
  const base = {
    ...normalized,
    valid: true,
    normalized: true,
    imported: false,
    accepted: false,
    quarantined: false,
    callbacks: 0,
    callback_count: 0,
    sink_invocations: 0,
    issues: [],
  };
  if (sink === undefined) return immutableClone(base);
  try {
    await sink(normalized.deliveries);
  } catch {
    return immutableClone({
      ...base,
      sink_invocations: 1,
      sink_error: "atomic_batch_sink_failed",
    });
  }
  return immutableClone({
    ...base,
    imported: true,
    accepted: true,
    callbacks: 1,
    callback_count: 1,
    sink_invocations: 1,
  });
}
