import { createHash } from "node:crypto";
import { types as utilTypes } from "node:util";
import {
  isAdmittedSyntheticChallengeSet,
  type RunnableSyntheticCase,
  type SyntheticCase,
  type SyntheticChallengeSet,
} from "./cases.js";
import {
  type AdmittedChallengeCoveragePlan,
  isAdmittedChallengeCoveragePlan,
} from "./coverage.js";

export type JsonPrimitive = null | boolean | number | string;
export type JsonValue =
  | JsonPrimitive
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export interface FileReaderPort {
  readonly read: (path: string) => Promise<Uint8Array>;
}

export interface EvaluatorContext {
  readonly case_id: string;
  readonly expected: JsonValue;
  readonly expected_sha256: string;
  readonly canonical_expected_sha256: string;
  readonly replay: boolean;
  readonly versions: Readonly<{
    engine_version: string;
    rules_version: string;
    valuation_version: string;
  }>;
}

export interface EvaluatorPort {
  readonly evaluate: (
    input: JsonValue,
    context: EvaluatorContext,
  ) => unknown | Promise<unknown>;
}

export interface SubmittedCase {
  readonly case_id: string;
  readonly fixture_ref: string;
  readonly expected_ref: string;
  readonly fixture_sha256: string;
  readonly expected_sha256: string;
  readonly canonical_input_sha256: string;
  readonly canonical_expected_output_sha256: string;
  readonly engine_version: string;
  readonly rules_version: string;
  readonly valuation_version: string;
}

export interface BatchRunRequest {
  readonly plan: AdmittedChallengeCoveragePlan;
  readonly case_set: SyntheticChallengeSet;
  readonly submitted_cases: readonly SubmittedCase[];
  readonly reader: FileReaderPort;
  readonly evaluator: EvaluatorPort;
  readonly replay: boolean;
}

export type BatchBlockerCode =
  | "invalid_request"
  | "batch_preflight_blocked"
  | "blocked_case"
  | "missing_case"
  | "unexpected_case"
  | "duplicate_case_id"
  | "case_definition_mismatch"
  | "file_read_error"
  | "malformed_file"
  | "unsafe_json"
  | "hash_mismatch"
  | "canonical_hash_mismatch"
  | "evaluator_exception"
  | "output_mismatch"
  | "output_unsafe";

export interface BatchBlocker {
  readonly code: BatchBlockerCode;
  readonly path: string;
}

export type BatchRowStatus = "blocked" | "passed" | "failed" | "error";

export interface BatchResultRow {
  readonly case_id: string;
  readonly status: BatchRowStatus;
  readonly outcome:
    | "blocked"
    | "passed"
    | "mismatch"
    | "evaluator_error"
    | "unsafe_output";
  readonly executed: boolean;
  readonly reason_code: BatchBlockerCode | null;
  readonly blockers: readonly BatchBlocker[];
  readonly input_path: string | null;
  readonly expected_path: string | null;
  readonly input_artifact_sha256: string | null;
  readonly expected_artifact_sha256: string | null;
  readonly canonical_input_sha256: string | null;
  readonly canonical_expected_sha256: string | null;
  readonly actual_output_sha256: string | null;
  readonly input_artifact_hash: string | null;
  readonly expected_artifact_hash: string | null;
  readonly canonical_input_hash: string | null;
  readonly canonical_expected_hash: string | null;
  readonly actual_output_hash: string | null;
  readonly versions: Readonly<Record<string, string>>;
  readonly replay: boolean;
  readonly evidence_promoted: false;
  readonly golden_promoted: false;
  readonly evaluator_error: null;
}

export interface BatchRunResult {
  readonly kind: "m7_deterministic_batch";
  readonly replay: boolean;
  readonly coverage_plan_sha256: string;
  readonly case_set_sha256: string;
  readonly case_ids: readonly string[];
  readonly versions: Readonly<Record<string, string>>;
  readonly rows: readonly BatchResultRow[];
  readonly results: readonly BatchResultRow[];
  readonly accounting_rows: readonly BatchResultRow[];
  readonly batch_sha256: string;
  readonly batch_hash: string;
  readonly evaluator_calls: number;
  readonly evidence_promoted: false;
  readonly golden_promoted: false;
}

export type BatchRequest = BatchRunRequest;
export type BatchResult = BatchRunResult;
export type AccountingRow = BatchResultRow;
export type RunnerResultRow = BatchResultRow;

interface JsonSnapshot {
  readonly value: JsonValue;
  readonly canonical_json: string;
  readonly sha256: string;
}

interface ArtifactSnapshot extends JsonSnapshot {
  readonly artifact_sha256: string;
}

interface PreparedCase {
  readonly definition: RunnableSyntheticCase;
  readonly input: ArtifactSnapshot;
  readonly expected: ArtifactSnapshot;
}

interface ExactRequest {
  readonly plan: AdmittedChallengeCoveragePlan;
  readonly case_set: SyntheticChallengeSet;
  readonly submitted_cases: readonly SubmittedCase[];
  readonly reader: FileReaderPort;
  readonly evaluator: EvaluatorPort;
  readonly replay: boolean;
  readonly structurally_valid: boolean;
}

const REQUEST_FIELDS = [
  "plan",
  "case_set",
  "submitted_cases",
  "reader",
  "evaluator",
  "replay",
] as const;
const SUBMITTED_CASE_FIELDS = [
  "case_id",
  "fixture_ref",
  "expected_ref",
  "fixture_sha256",
  "expected_sha256",
  "canonical_input_sha256",
  "canonical_expected_output_sha256",
  "engine_version",
  "rules_version",
  "valuation_version",
] as const;
const CASE_ID_PATTERN = /^SYN-M7-[A-Z0-9][A-Z0-9._-]{0,63}$/u;
const MAX_ARTIFACT_BYTES = 1_048_576;
const ZERO_SHA256 = `sha256:${"0".repeat(64)}`;
const ADMITTED_BATCH_RESULTS = new WeakSet<object>();

function sha256(bytes: Uint8Array | string): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function blocker(code: BatchBlockerCode, path: string): BatchBlocker {
  return Object.freeze({ code, path });
}

function exactDataRecord(
  value: unknown,
  fields: readonly string[],
): Readonly<Record<string, unknown>> | null {
  if (value === null || typeof value !== "object" || utilTypes.isProxy(value))
    return null;
  let prototype: object | null;
  let keys: readonly PropertyKey[];
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    return null;
  }
  if (prototype !== Object.prototype && prototype !== null) return null;
  if (
    keys.length !== fields.length ||
    keys.some((key) => typeof key !== "string" || !fields.includes(key))
  )
    return null;
  const result: Record<string, unknown> = Object.create(null);
  for (const field of fields) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, field);
    } catch {
      return null;
    }
    if (
      !descriptor ||
      !descriptor.enumerable ||
      !("value" in descriptor) ||
      descriptor.get !== undefined ||
      descriptor.set !== undefined
    )
      return null;
    result[field] = descriptor.value;
  }
  return result;
}

function dataRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  if (value === null || typeof value !== "object" || utilTypes.isProxy(value))
    return null;
  let prototype: object | null;
  let keys: readonly PropertyKey[];
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    return null;
  }
  if (prototype !== Object.prototype && prototype !== null) return null;
  if (keys.some((key) => typeof key !== "string")) return null;
  const result: Record<string, unknown> = Object.create(null);
  for (const key of keys as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor))
      return null;
    result[key] = descriptor.value;
  }
  return result;
}

function exactDenseArray(value: unknown): readonly unknown[] | null {
  if (!Array.isArray(value) || utilTypes.isProxy(value)) return null;
  let keys: readonly PropertyKey[];
  try {
    if (Object.getPrototypeOf(value) !== Array.prototype) return null;
    keys = Reflect.ownKeys(value);
  } catch {
    return null;
  }
  if (keys.some((key) => typeof key !== "string")) return null;
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (!lengthDescriptor || typeof lengthDescriptor.value !== "number")
    return null;
  const length = lengthDescriptor.value;
  if (!Number.isSafeInteger(length) || length < 0) return null;
  if (keys.length !== length + 1) return null;
  const output: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const key = String(index);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor))
      return null;
    output.push(descriptor.value);
  }
  return output;
}

function readRequest(input: unknown): ExactRequest | null {
  const record = dataRecord(input);
  if (!record) return null;
  if (REQUEST_FIELDS.some((field) => !Object.hasOwn(record, field)))
    return null;
  const plan = record.plan;
  const caseSet = record.case_set;
  if (!isAdmittedChallengeCoveragePlan(plan)) return null;
  if (!isAdmittedSyntheticChallengeSet(caseSet, plan)) return null;

  const submittedInput = exactDenseArray(record.submitted_cases);
  let structurallyValid =
    submittedInput !== null &&
    Object.keys(record).length === REQUEST_FIELDS.length;
  const submittedCases: SubmittedCase[] = [];
  for (const item of submittedInput ?? []) {
    const submitted = exactDataRecord(item, SUBMITTED_CASE_FIELDS);
    if (
      !submitted ||
      SUBMITTED_CASE_FIELDS.some(
        (field) => typeof submitted[field] !== "string",
      )
    ) {
      structurallyValid = false;
      continue;
    }
    submittedCases.push(
      Object.freeze({
        case_id: submitted.case_id as string,
        fixture_ref: submitted.fixture_ref as string,
        expected_ref: submitted.expected_ref as string,
        fixture_sha256: submitted.fixture_sha256 as string,
        expected_sha256: submitted.expected_sha256 as string,
        canonical_input_sha256: submitted.canonical_input_sha256 as string,
        canonical_expected_output_sha256:
          submitted.canonical_expected_output_sha256 as string,
        engine_version: submitted.engine_version as string,
        rules_version: submitted.rules_version as string,
        valuation_version: submitted.valuation_version as string,
      }),
    );
  }

  const readerRecord = exactDataRecord(record.reader, ["read"]);
  const evaluatorRecord = exactDataRecord(record.evaluator, ["evaluate"]);
  if (
    !readerRecord ||
    typeof readerRecord.read !== "function" ||
    utilTypes.isProxy(readerRecord.read) ||
    !evaluatorRecord ||
    typeof evaluatorRecord.evaluate !== "function" ||
    utilTypes.isProxy(evaluatorRecord.evaluate) ||
    typeof record.replay !== "boolean"
  )
    structurallyValid = false;

  return {
    plan,
    case_set: caseSet,
    submitted_cases: Object.freeze(submittedCases),
    reader: Object.freeze({
      read: (readerRecord?.read ??
        (async () => new Uint8Array())) as FileReaderPort["read"],
    }),
    evaluator: Object.freeze({
      evaluate: (evaluatorRecord?.evaluate ??
        (() => null)) as EvaluatorPort["evaluate"],
    }),
    replay: record.replay === true,
    structurally_valid: structurallyValid,
  };
}

function normalizeJson(
  value: unknown,
  active = new WeakSet<object>(),
): JsonValue {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("unsafe_json");
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== "object" || utilTypes.isProxy(value))
    throw new TypeError("unsafe_json");
  if (active.has(value)) throw new TypeError("unsafe_json");
  active.add(value);
  try {
    if (Array.isArray(value)) {
      const values = exactDenseArray(value);
      if (!values) throw new TypeError("unsafe_json");
      return Object.freeze(values.map((item) => normalizeJson(item, active)));
    }
    let keys: readonly PropertyKey[];
    let prototype: object | null;
    try {
      keys = Reflect.ownKeys(value);
      prototype = Object.getPrototypeOf(value);
    } catch {
      throw new TypeError("unsafe_json");
    }
    if (prototype !== Object.prototype && prototype !== null)
      throw new TypeError("unsafe_json");
    if (keys.some((key) => typeof key !== "string"))
      throw new TypeError("unsafe_json");
    const output: Record<string, JsonValue> = Object.create(null);
    for (const key of (keys as string[]).sort(compare)) {
      if (["__proto__", "prototype", "constructor"].includes(key))
        throw new TypeError("unsafe_json");
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor))
        throw new TypeError("unsafe_json");
      output[key] = normalizeJson(descriptor.value, active);
    }
    return Object.freeze(output);
  } finally {
    active.delete(value);
  }
}

function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  return `{${Object.keys(value)
    .sort(compare)
    .map(
      (key) =>
        `${JSON.stringify(key)}:${canonicalJson(
          (value as Readonly<Record<string, JsonValue>>)[key] as JsonValue,
        )}`,
    )
    .join(",")}}`;
}

function jsonSnapshot(value: unknown): JsonSnapshot {
  const normalized = normalizeJson(value);
  const canonical = canonicalJson(normalized);
  return Object.freeze({
    value: normalized,
    canonical_json: canonical,
    sha256: sha256(canonical),
  });
}

async function readArtifact(
  reader: FileReaderPort,
  path: string,
): Promise<ArtifactSnapshot> {
  const supplied = await reader.read(path);
  if (
    !(supplied instanceof Uint8Array) ||
    utilTypes.isProxy(supplied) ||
    Object.getPrototypeOf(supplied) !== Uint8Array.prototype
  )
    throw new TypeError("file_read_error");
  let byteKeys: readonly PropertyKey[];
  try {
    byteKeys = Reflect.ownKeys(supplied);
  } catch {
    throw new TypeError("file_read_error");
  }
  const expectedByteKeys = Array.from({ length: supplied.length }, (_, index) =>
    String(index),
  );
  if (
    byteKeys.length !== expectedByteKeys.length ||
    byteKeys.some(
      (key) => typeof key !== "string" || !expectedByteKeys.includes(key),
    )
  )
    throw new TypeError("file_read_error");
  for (const key of expectedByteKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(supplied, key);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor))
      throw new TypeError("file_read_error");
  }
  const bytes = Uint8Array.from(supplied);
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_ARTIFACT_BYTES)
    throw new TypeError("malformed_file");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new TypeError("malformed_file");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new TypeError("malformed_file");
  }
  const snapshot = jsonSnapshot(parsed);
  return Object.freeze({
    ...snapshot,
    artifact_sha256: sha256(bytes),
  });
}

function versionsFor(item: SyntheticCase): Readonly<Record<string, string>> {
  return item.capability === "runnable"
    ? Object.freeze({
        engine_version: item.engine_version,
        rules_version: item.rules_version,
        valuation_version: item.valuation_version,
      })
    : Object.freeze({});
}

function blockedRow(
  item: SyntheticCase | null,
  caseId: string,
  replay: boolean,
  code: BatchBlockerCode,
  path: string,
): BatchResultRow {
  const definition = item?.capability === "runnable" ? item : null;
  const issue = blocker(code, path);
  return Object.freeze({
    case_id: caseId,
    status: "blocked" as const,
    outcome: "blocked" as const,
    executed: false,
    reason_code: code,
    blockers: Object.freeze([issue]),
    input_path: definition?.fixture_ref ?? null,
    expected_path: definition?.expected_ref ?? null,
    input_artifact_sha256: null,
    expected_artifact_sha256: null,
    canonical_input_sha256: null,
    canonical_expected_sha256: null,
    actual_output_sha256: null,
    input_artifact_hash: null,
    expected_artifact_hash: null,
    canonical_input_hash: null,
    canonical_expected_hash: null,
    actual_output_hash: null,
    versions: versionsFor(item ?? ({ capability: "blocked" } as SyntheticCase)),
    replay,
    evidence_promoted: false,
    golden_promoted: false,
    evaluator_error: null,
  });
}

function evaluatedRow(
  prepared: PreparedCase,
  replay: boolean,
  status: "passed" | "failed" | "error",
  outcome: "passed" | "mismatch" | "evaluator_error" | "unsafe_output",
  reason: BatchBlockerCode | null,
  actualHash: string | null,
): BatchResultRow {
  const item = prepared.definition;
  const blockers =
    reason === null
      ? Object.freeze([])
      : Object.freeze([blocker(reason, "/output")]);
  return Object.freeze({
    case_id: item.case_id,
    status,
    outcome,
    executed: true,
    reason_code: reason,
    blockers,
    input_path: item.fixture_ref,
    expected_path: item.expected_ref,
    input_artifact_sha256: prepared.input.artifact_sha256,
    expected_artifact_sha256: prepared.expected.artifact_sha256,
    canonical_input_sha256: prepared.input.sha256,
    canonical_expected_sha256: prepared.expected.sha256,
    actual_output_sha256: actualHash,
    input_artifact_hash: prepared.input.artifact_sha256,
    expected_artifact_hash: prepared.expected.artifact_sha256,
    canonical_input_hash: prepared.input.sha256,
    canonical_expected_hash: prepared.expected.sha256,
    actual_output_hash: actualHash,
    versions: versionsFor(item),
    replay,
    evidence_promoted: false,
    golden_promoted: false,
    evaluator_error: null,
  });
}

function result(
  planHash: string,
  setHash: string,
  replay: boolean,
  rowsInput: readonly BatchResultRow[],
  evaluatorCalls: number,
): BatchRunResult {
  const rows = Object.freeze(
    [...rowsInput].sort((left, right) => compare(left.case_id, right.case_id)),
  );
  const versionEntries = new Map<string, string>();
  for (const row of rows)
    for (const [key, value] of Object.entries(row.versions))
      versionEntries.set(`${row.case_id}:${key}`, value);
  const versions = Object.freeze(
    Object.fromEntries(
      [...versionEntries].sort(([left], [right]) => compare(left, right)),
    ),
  );
  const hashPayload = jsonSnapshot({
    kind: "m7_deterministic_batch",
    replay,
    coverage_plan_sha256: planHash,
    case_set_sha256: setHash,
    rows: rows.map((row) => ({
      case_id: row.case_id,
      status: row.status,
      outcome: row.outcome,
      executed: row.executed,
      reason_code: row.reason_code,
      input_artifact_sha256: row.input_artifact_sha256,
      expected_artifact_sha256: row.expected_artifact_sha256,
      canonical_input_sha256: row.canonical_input_sha256,
      canonical_expected_sha256: row.canonical_expected_sha256,
      actual_output_sha256: row.actual_output_sha256,
      versions: row.versions,
    })),
  }).sha256;
  const output = Object.freeze({
    kind: "m7_deterministic_batch" as const,
    replay,
    coverage_plan_sha256: planHash,
    case_set_sha256: setHash,
    case_ids: Object.freeze(rows.map((row) => row.case_id)),
    versions,
    rows,
    results: rows,
    accounting_rows: rows,
    batch_sha256: hashPayload,
    batch_hash: hashPayload,
    evaluator_calls: evaluatorCalls,
    evidence_promoted: false as const,
    golden_promoted: false as const,
  });
  ADMITTED_BATCH_RESULTS.add(output);
  return output;
}

function invalidResult(replay = false): BatchRunResult {
  return result(ZERO_SHA256, ZERO_SHA256, replay, [], 0);
}

function cloneJson(value: JsonValue): JsonValue {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value))
    return Object.freeze(value.map((item) => cloneJson(item)));
  const output: Record<string, JsonValue> = Object.create(null);
  const record = value as Readonly<Record<string, JsonValue>>;
  for (const key of Object.keys(record))
    output[key] = cloneJson(record[key] as JsonValue);
  return Object.freeze(output);
}

function safeUnexpectedId(value: string, index: number): string {
  return CASE_ID_PATTERN.test(value)
    ? value
    : `SYN-M7-INVALID-${String(index + 1).padStart(3, "0")}`;
}

function submissionMatches(
  submitted: SubmittedCase,
  definition: RunnableSyntheticCase,
): boolean {
  return SUBMITTED_CASE_FIELDS.every(
    (field) => submitted[field] === definition[field],
  );
}

/**
 * Preflight and execute one exact, host-admitted synthetic batch. Any defect
 * discovered before evaluation blocks the entire set and produces zero calls.
 */
async function runBatchInternal(
  input: BatchRunRequest,
  forcedReplay: boolean | undefined,
): Promise<BatchRunResult> {
  const request = readRequest(input);
  if (!request) return invalidResult(forcedReplay ?? false);
  const replay = forcedReplay ?? request.replay;
  const planHash = request.plan.sha256;
  const setHash = jsonSnapshot(request.case_set).sha256;
  const definitions = [...request.case_set.cases].sort((left, right) =>
    compare(left.case_id, right.case_id),
  );
  const known = new Map(definitions.map((item) => [item.case_id, item]));
  const supplied = new Map<string, number>();
  const unexpected: string[] = [];
  const caseFailure = new Map<string, BatchBlockerCode>();
  let preflightBlocked = !request.structurally_valid;

  for (const [index, submitted] of request.submitted_cases.entries()) {
    const caseId = submitted.case_id;
    if (!CASE_ID_PATTERN.test(caseId) || !known.has(caseId)) {
      unexpected.push(safeUnexpectedId(caseId, index));
      preflightBlocked = true;
      continue;
    }
    supplied.set(caseId, (supplied.get(caseId) ?? 0) + 1);
    if ((supplied.get(caseId) ?? 0) > 1) preflightBlocked = true;
    const definition = known.get(caseId);
    if (
      definition?.capability !== "runnable" ||
      !submissionMatches(submitted, definition)
    ) {
      caseFailure.set(caseId, "case_definition_mismatch");
      preflightBlocked = true;
    }
  }
  for (const item of definitions) {
    if (item.capability === "blocked" || supplied.get(item.case_id) !== 1)
      preflightBlocked = true;
  }

  const prepared: PreparedCase[] = [];
  if (!preflightBlocked) {
    for (const item of definitions) {
      if (item.capability !== "runnable") continue;
      const [inputRead, expectedRead] = await Promise.allSettled([
        readArtifact(request.reader, item.fixture_ref),
        readArtifact(request.reader, item.expected_ref),
      ]);
      if (
        inputRead.status === "fulfilled" &&
        expectedRead.status === "fulfilled"
      ) {
        const inputArtifact = inputRead.value;
        const expectedArtifact = expectedRead.value;
        if (
          inputArtifact.artifact_sha256 !== item.fixture_sha256 ||
          expectedArtifact.artifact_sha256 !== item.expected_sha256
        ) {
          caseFailure.set(item.case_id, "hash_mismatch");
          preflightBlocked = true;
        } else if (
          inputArtifact.sha256 !== item.canonical_input_sha256 ||
          expectedArtifact.sha256 !== item.canonical_expected_output_sha256
        ) {
          caseFailure.set(item.case_id, "canonical_hash_mismatch");
          preflightBlocked = true;
        }
        prepared.push({
          definition: item,
          input: inputArtifact,
          expected: expectedArtifact,
        });
      } else {
        const error: unknown =
          inputRead.status === "rejected"
            ? inputRead.reason
            : expectedRead.status === "rejected"
              ? expectedRead.reason
              : new TypeError("file_read_error");
        const code =
          error instanceof TypeError &&
          ["malformed_file", "unsafe_json"].includes(error.message)
            ? (error.message as "malformed_file" | "unsafe_json")
            : "file_read_error";
        caseFailure.set(item.case_id, code);
        preflightBlocked = true;
      }
    }
  }

  if (preflightBlocked) {
    const rows: BatchResultRow[] = definitions.map((item) => {
      let code: BatchBlockerCode = "batch_preflight_blocked";
      if (item.capability === "blocked") code = "blocked_case";
      else if ((supplied.get(item.case_id) ?? 0) === 0) code = "missing_case";
      else if ((supplied.get(item.case_id) ?? 0) > 1)
        code = "duplicate_case_id";
      else code = caseFailure.get(item.case_id) ?? code;
      return blockedRow(item, item.case_id, replay, code, "/preflight");
    });
    for (const caseId of unexpected)
      rows.push(
        blockedRow(null, caseId, replay, "unexpected_case", "/submitted_cases"),
      );
    return result(planHash, setHash, replay, rows, 0);
  }

  const rows: BatchResultRow[] = [];
  let calls = 0;
  for (const item of prepared) {
    calls += 1;
    let actual: unknown;
    try {
      actual = await request.evaluator.evaluate(cloneJson(item.input.value), {
        case_id: item.definition.case_id,
        expected: cloneJson(item.expected.value),
        expected_sha256: item.expected.sha256,
        canonical_expected_sha256: item.expected.sha256,
        replay,
        versions: versionsFor(item.definition) as EvaluatorContext["versions"],
      });
    } catch {
      rows.push(
        evaluatedRow(
          item,
          replay,
          "error",
          "evaluator_error",
          "evaluator_exception",
          null,
        ),
      );
      continue;
    }
    let actualSnapshot: JsonSnapshot;
    try {
      actualSnapshot = jsonSnapshot(actual);
    } catch {
      rows.push(
        evaluatedRow(
          item,
          replay,
          "failed",
          "unsafe_output",
          "output_unsafe",
          null,
        ),
      );
      continue;
    }
    const matches =
      actualSnapshot.canonical_json === item.expected.canonical_json;
    rows.push(
      evaluatedRow(
        item,
        replay,
        matches ? "passed" : "failed",
        matches ? "passed" : "mismatch",
        matches ? null : "output_mismatch",
        actualSnapshot.sha256,
      ),
    );
  }
  return result(planHash, setHash, replay, rows, calls);
}

export async function runBatch(
  input: BatchRunRequest,
): Promise<BatchRunResult> {
  return runBatchInternal(input, undefined);
}

export function isAdmittedBatchRunResult(
  value: unknown,
): value is BatchRunResult {
  return value !== null &&
    (typeof value === "object" || typeof value === "function")
    ? ADMITTED_BATCH_RESULTS.has(value)
    : false;
}

export const runDeterministicBatch = runBatch;
export const executeBatch = runBatch;
export const runChallengeBatch = runBatch;
export const runSyntheticBatch = runBatch;
export const runM7Batch = runBatch;
export const runChallengeTrackBatch = runBatch;

export async function runReplayBatch(
  request: BatchRunRequest,
): Promise<BatchRunResult> {
  return runBatchInternal(request, true);
}

export function canonicalizeRunnerJson(value: unknown): string {
  return jsonSnapshot(value).canonical_json;
}

export function canonicalRunnerSha256(value: unknown): string {
  return jsonSnapshot(value).sha256;
}
