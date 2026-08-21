import { createHash } from "node:crypto";
import {
  hashSyntheticChallengeSet,
  isAdmittedSyntheticChallengeSet,
  type SyntheticChallengeSet,
} from "./cases.js";
import {
  type AdmittedChallengeCoveragePlan,
  type ChallengeCoverageScenario,
  isAdmittedChallengeCoveragePlan,
} from "./coverage.js";
import {
  type BatchResultRow,
  type BatchRunResult,
  isAdmittedBatchRunResult,
} from "./runner.js";

/**
 * The M7 report is an accounting boundary, not an evidence boundary.  It
 * accepts only the canonical products of the coverage, case, and runner
 * contracts.  In particular, there is one spelling for each input: a caller
 * cannot make an unadmitted alias look like an executed case.
 */

export const CHALLENGE_TRACK_REPORT_VERSION =
  "m7.challenge-track-report.v1" as const;
export const CHALLENGE_TRACK_TARGET_COUNT = 100 as const;
export const TRUSTED_REAL_ATTEMPT_THRESHOLD = 10 as const;

export type JsonPrimitive = null | boolean | number | string;
export type JsonValue =
  | JsonPrimitive
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export interface ChallengeTrackReportInput {
  /** The canonical `{ value, canonical_json, sha256 }` coverage snapshot. */
  readonly plan: AdmittedChallengeCoveragePlan;
  /** A case-set already admitted against `plan`; omitted means no cases bound. */
  readonly case_set?: SyntheticChallengeSet | null;
  /** A deterministic runner result; omitted means no execution was submitted. */
  readonly runner?: BatchRunResult | null;
  /** Exact count supplied by a trusted M4 attempt port, if one is available. */
  readonly trusted_real_completed_attempt_count?: number;
  readonly attempt_port_available?: boolean;
}

export type ExecutionAccountingStatus = "valid" | "rejected";

export interface AccountingIssue {
  readonly code:
    | "missing_result"
    | "duplicate_result"
    | "unexpected_result"
    | "invalid_result"
    | "blocked_case_result"
    | "synthetic_lifecycle_upgrade_rejected"
    | "duplicate_case"
    | "unexpected_case";
  readonly case_id: string | null;
  readonly detail: string;
}

export interface CoverageTargetRow {
  readonly scenario_id: string;
  readonly declared_target: JsonValue;
  readonly planned: true;
  readonly bound: boolean;
  readonly synthetic_case_count: number;
  readonly runnable_case_count: number;
  readonly blocked_case_count: number;
  readonly executed_pass_count: number;
  readonly executed_fail_count: number;
  readonly executed_count: number;
  readonly passed_count: number;
  readonly unexecuted_count: number;
  readonly evidence_backed_count: 0;
  readonly golden_count: 0;
  /** Synthetic execution never changes the declared real-scenario lifecycle. */
  readonly lifecycle_status: "planned";
}

export interface ChallengeTrackCounts {
  readonly declared_target_count: number;
  readonly planned_target_count: number;
  readonly bound_target_count: number;
  readonly synthetic_case_count: number;
  readonly runnable_case_count: number;
  readonly blocked_case_count: number;
  readonly executed_pass_count: number;
  readonly executed_fail_count: number;
  readonly executed_count: number;
  readonly passed_count: number;
  readonly unexecuted_count: number;
  readonly evidence_backed_count: 0;
  readonly golden_count: 0;
}

export interface ThroughputCalibration {
  readonly status: "insufficient_real_observations" | "calibrated";
  readonly trusted_real_completed_attempt_count: number;
  readonly required_trusted_real_completed_attempts: 10;
  readonly attempt_port_available: boolean;
}

export interface ChallengeTrackReport {
  readonly report_version: typeof CHALLENGE_TRACK_REPORT_VERSION;
  readonly report_hash: string;
  readonly counts: ChallengeTrackCounts;
  /** Kept at the top level for simple CLI consumers and audit tooling. */
  readonly declared_target_count: number;
  readonly planned_target_count: number;
  readonly bound_target_count: number;
  readonly synthetic_case_count: number;
  readonly runnable_case_count: number;
  readonly blocked_case_count: number;
  readonly executed_pass_count: number;
  readonly executed_fail_count: number;
  readonly executed_count: number;
  readonly passed_count: number;
  readonly unexecuted_count: number;
  readonly evidence_backed_count: 0;
  readonly golden_count: 0;
  readonly coverage_targets: readonly CoverageTargetRow[];
  readonly real_scenario_status: "all_planned";
  readonly production_ready: false;
  readonly evidence_track_ready: false;
  readonly blockers: readonly {
    readonly code:
      | "m3_source_gate_blocked"
      | "m4_operational_rehearsal_insufficient_data";
    readonly milestone: "M3" | "M4";
    readonly status: "blocked" | "insufficient_data";
    readonly detail: string;
  }[];
  readonly throughput_calibration: ThroughputCalibration;
  readonly execution_accounting_status: ExecutionAccountingStatus;
  readonly accounting_issues: readonly AccountingIssue[];
}

export class ChallengeTrackReportError extends Error {
  readonly code: string;

  constructor(
    code: string,
    message = "Challenge-track report input was rejected",
  ) {
    // Do not include caller-controlled values in an exception.  CLI adapters
    // can expose the stable code without leaking a hostile path or payload.
    super(message);
    this.name = "ChallengeTrackReportError";
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

function reject(code: string): never {
  throw new ChallengeTrackReportError(code);
}

const REPORT_INPUT_FIELDS = new Set([
  "plan",
  "case_set",
  "runner",
  "trusted_real_completed_attempt_count",
  "attempt_port_available",
]);

/** Read the report envelope without invoking a caller-supplied accessor. */
function readReportInput(value: unknown): ChallengeTrackReportInput {
  if (!isRecord(value)) reject("invalid_input");
  let keys: string[];
  try {
    keys = Object.keys(value);
  } catch {
    reject("invalid_input");
  }
  if (
    keys.some((key) => !REPORT_INPUT_FIELDS.has(key)) ||
    !keys.includes("plan")
  )
    reject("invalid_input");
  const output: Record<string, unknown> = {};
  try {
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable)
        reject("invalid_input");
      output[key] = descriptor.value;
    }
  } catch {
    reject("invalid_input");
  }
  return output as unknown as ChallengeTrackReportInput;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Convert already-admitted data to JSON without invoking accessors.  This is
 * intentionally stricter than JSON.stringify so a report cannot retain a
 * mutable or proxy-backed reference from a boundary adapter.
 */
function jsonValue(
  value: unknown,
  path = "$",
  active = new Set<object>(),
): JsonValue {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) reject("non_finite_value");
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== "object") reject("unsupported_value");
  if (active.has(value)) reject("cyclic_value");
  active.add(value);
  try {
    let prototype: object | null;
    let keys: readonly PropertyKey[];
    try {
      prototype = Object.getPrototypeOf(value);
      keys = Reflect.ownKeys(value);
    } catch {
      reject("unsafe_object");
    }
    if (keys.some((key) => typeof key !== "string")) reject("symbol_property");
    if (Array.isArray(value)) {
      if (prototype !== Array.prototype) reject("unsafe_object");
      const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
      if (
        !lengthDescriptor ||
        !("value" in lengthDescriptor) ||
        !Number.isSafeInteger(lengthDescriptor.value)
      )
        reject("unsafe_object");
      const length = lengthDescriptor.value as number;
      const expectedKeys = [
        "length",
        ...Array.from({ length }, (_, index) => String(index)),
      ];
      if (
        keys.length !== expectedKeys.length ||
        expectedKeys.some((key) => !keys.includes(key))
      )
        reject("unsafe_object");
      const output: JsonValue[] = [];
      for (let index = 0; index < length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(
          value,
          String(index),
        );
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable)
          reject("unsafe_object");
        output.push(jsonValue(descriptor.value, `${path}/${index}`, active));
      }
      return output;
    }
    if (prototype !== Object.prototype && prototype !== null)
      reject("unsafe_object");
    const output: Record<string, JsonValue> = {};
    for (const key of keys as readonly string[]) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable)
        reject("unsafe_object");
      if (key === "__proto__" || key === "prototype" || key === "constructor")
        reject("unsafe_object");
      output[key] = jsonValue(descriptor.value, `${path}/${key}`, active);
    }
    return output;
  } finally {
    active.delete(value);
  }
}

/** Stable JSON used for both the report hash and CLI output. */
export function stableJson(value: unknown): string {
  return canonicalJson(jsonValue(value));
}

function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  const record = value as { readonly [key: string]: JsonValue };
  return `{${Object.keys(record)
    .sort(compareStrings)
    .map(
      (key) =>
        `${JSON.stringify(key)}:${canonicalJson(record[key] as JsonValue)}`,
    )
    .join(",")}}`;
}

export function deterministicSha256(value: unknown): string {
  return createHash("sha256").update(stableJson(value), "utf8").digest("hex");
}

function freezeDeep<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== "object" || seen.has(value))
    return value;
  seen.add(value);
  for (const child of Object.values(value as Record<string, unknown>))
    freezeDeep(child, seen);
  return Object.freeze(value);
}

function exactSnapshot(value: unknown): AdmittedChallengeCoveragePlan {
  try {
    if (isAdmittedChallengeCoveragePlan(value)) return value;
  } catch {
    reject("invalid_plan");
  }
  // A structurally identical value (including a correctly recomputed hash) is
  // not admission authority.  Only coverage admission can mint this identity.
  reject("invalid_plan");
}

interface InternalCase {
  readonly case_id: string;
  readonly scenario_id: string;
  readonly blocked: boolean;
}

function normalizeCases(
  value: SyntheticChallengeSet | null | undefined,
  plan: AdmittedChallengeCoveragePlan,
  issues: AccountingIssue[],
): InternalCase[] {
  if (value === undefined || value === null) return [];
  try {
    if (!isAdmittedSyntheticChallengeSet(value, plan)) {
      issues.push({
        code: "invalid_result",
        case_id: null,
        detail: "The synthetic case set was not admitted.",
      });
      return [];
    }
  } catch {
    issues.push({
      code: "invalid_result",
      case_id: null,
      detail: "The synthetic case set was not admitted.",
    });
    return [];
  }
  const targetIds = new Set(
    plan.value.scenarios.map((scenario) => scenario.scenario_id),
  );
  const seen = new Set<string>();
  const cases: InternalCase[] = [];
  for (const item of value.cases) {
    if (seen.has(item.case_id)) {
      issues.push({
        code: "duplicate_case",
        case_id: item.case_id,
        detail: "The admitted case set repeats a case ID.",
      });
      continue;
    }
    seen.add(item.case_id);
    if (!targetIds.has(item.coverage_target_id)) {
      issues.push({
        code: "unexpected_case",
        case_id: item.case_id,
        detail: "The admitted case references no declared target.",
      });
      continue;
    }
    cases.push({
      case_id: item.case_id,
      scenario_id: item.coverage_target_id,
      blocked: item.capability === "blocked",
    });
  }
  return cases.sort((left, right) =>
    compareStrings(left.case_id, right.case_id),
  );
}

const BATCH_FIELDS = new Set([
  "kind",
  "replay",
  "coverage_plan_sha256",
  "case_set_sha256",
  "case_ids",
  "versions",
  "rows",
  "results",
  "accounting_rows",
  "batch_sha256",
  "batch_hash",
  "evaluator_calls",
  "evidence_promoted",
  "golden_promoted",
]);
const ROW_FIELDS = new Set([
  "case_id",
  "status",
  "outcome",
  "executed",
  "reason_code",
  "blockers",
  "input_path",
  "expected_path",
  "input_artifact_sha256",
  "expected_artifact_sha256",
  "canonical_input_sha256",
  "canonical_expected_sha256",
  "actual_output_sha256",
  "input_artifact_hash",
  "expected_artifact_hash",
  "canonical_input_hash",
  "canonical_expected_hash",
  "actual_output_hash",
  "versions",
  "replay",
  "evidence_promoted",
  "golden_promoted",
  "evaluator_error",
  "output",
]);

function hasExactFields(
  value: object,
  allowed: ReadonlySet<string>,
  required: ReadonlySet<string>,
): boolean {
  const keys = Object.keys(value);
  return (
    keys.every((key) => allowed.has(key)) &&
    [...required].every((key) => Object.hasOwn(value, key))
  );
}

const REQUIRED_BATCH_FIELDS = new Set([...BATCH_FIELDS]);
const REQUIRED_ROW_FIELDS = new Set(
  [...ROW_FIELDS].filter((key) => key !== "output"),
);

function rowOutcome(
  row: BatchResultRow,
): "pass" | "fail" | "unexecuted" | "invalid" {
  if (
    row.executed === false &&
    row.status === "blocked" &&
    row.outcome === "blocked"
  )
    return "unexecuted";
  if (row.executed !== true) return "invalid";
  if (row.status === "passed" && row.outcome === "passed") return "pass";
  if (
    (row.status === "failed" &&
      ["mismatch", "unsafe_output"].includes(row.outcome)) ||
    (row.status === "error" && row.outcome === "evaluator_error")
  )
    return "fail";
  return "invalid";
}

interface ValidatedRows {
  readonly byCase: ReadonlyMap<string, "pass" | "fail" | "unexecuted">;
  readonly rejected: boolean;
}

function validateBatch(
  runner: BatchRunResult | null | undefined,
  cases: readonly InternalCase[],
  plan: AdmittedChallengeCoveragePlan,
  caseSet: SyntheticChallengeSet | null | undefined,
  issues: AccountingIssue[],
): ValidatedRows {
  const byCase = new Map<string, "pass" | "fail" | "unexecuted">();
  if (runner === undefined || runner === null) {
    for (const item of cases)
      issues.push({
        code: "missing_result",
        case_id: item.case_id,
        detail: "No runner row was supplied for this admitted case.",
      });
    return { byCase, rejected: issues.length > 0 };
  }

  try {
    if (!isAdmittedBatchRunResult(runner)) {
      issues.push({
        code: "invalid_result",
        case_id: null,
        detail: "The runner batch was not admitted.",
      });
      return { byCase, rejected: true };
    }
  } catch {
    issues.push({
      code: "invalid_result",
      case_id: null,
      detail: "The runner batch was not admitted.",
    });
    return { byCase, rejected: true };
  }

  let caseSetHash: string | null = null;
  if (
    caseSet !== undefined &&
    caseSet !== null &&
    isAdmittedSyntheticChallengeSet(caseSet, plan)
  ) {
    try {
      caseSetHash = hashSyntheticChallengeSet(caseSet, plan);
    } catch {
      caseSetHash = null;
    }
  }
  if (
    runner.coverage_plan_sha256 !== plan.sha256 ||
    caseSetHash === null ||
    runner.case_set_sha256 !== caseSetHash
  ) {
    issues.push({
      code: "invalid_result",
      case_id: null,
      detail: "The runner batch does not match the admitted plan and case set.",
    });
    return { byCase, rejected: true };
  }

  let batchSafe = false;
  try {
    batchSafe =
      isRecord(runner) &&
      hasExactFields(runner, BATCH_FIELDS, REQUIRED_BATCH_FIELDS);
    if (batchSafe) {
      // A descriptor walk prevents a forged runner row from invoking a getter
      // while this report reads its accounting fields.
      jsonValue(runner);
    }
  } catch {
    batchSafe = false;
  }
  if (
    !batchSafe ||
    runner.kind !== "m7_deterministic_batch" ||
    runner.evidence_promoted !== false ||
    runner.golden_promoted !== false ||
    !Array.isArray(runner.rows)
  ) {
    issues.push({
      code: "invalid_result",
      case_id: null,
      detail: "The runner batch did not satisfy the exact result contract.",
    });
    return { byCase, rejected: true };
  }

  const known = new Map(cases.map((item) => [item.case_id, item]));
  const seen = new Set<string>();
  let rejected = false;
  for (const raw of runner.rows) {
    if (
      !isRecord(raw) ||
      !hasExactFields(raw, ROW_FIELDS, REQUIRED_ROW_FIELDS)
    ) {
      issues.push({
        code: "invalid_result",
        case_id: null,
        detail: "A runner row did not satisfy the exact result contract.",
      });
      rejected = true;
      continue;
    }
    let row: BatchResultRow;
    try {
      jsonValue(raw);
      row = raw as unknown as BatchResultRow;
    } catch {
      issues.push({
        code: "invalid_result",
        case_id: null,
        detail: "A runner row contained unsafe JSON data.",
      });
      rejected = true;
      continue;
    }
    const caseId =
      typeof row.case_id === "string" && row.case_id.length > 0
        ? row.case_id
        : null;
    if (caseId === null || !known.has(caseId)) {
      issues.push({
        code: "unexpected_result",
        case_id: caseId,
        detail: "A runner row did not identify an admitted case.",
      });
      rejected = true;
      continue;
    }
    if (seen.has(caseId)) {
      issues.push({
        code: "duplicate_result",
        case_id: caseId,
        detail: "The runner batch repeats a case ID.",
      });
      rejected = true;
      continue;
    }
    seen.add(caseId);
    const item = known.get(caseId) as InternalCase;
    const outcome = rowOutcome(row);
    if (item.blocked && outcome !== "unexecuted") {
      issues.push({
        code: "blocked_case_result",
        case_id: caseId,
        detail: "A blocked synthetic case cannot report execution.",
      });
      rejected = true;
      continue;
    }
    if (outcome === "invalid") {
      issues.push({
        code: "invalid_result",
        case_id: caseId,
        detail: "A runner row has an inconsistent execution outcome.",
      });
      rejected = true;
      continue;
    }
    if (row.evidence_promoted !== false || row.golden_promoted !== false) {
      issues.push({
        code: "synthetic_lifecycle_upgrade_rejected",
        case_id: caseId,
        detail: "Synthetic execution cannot promote evidence or golden status.",
      });
      rejected = true;
      continue;
    }
    byCase.set(caseId, outcome);
  }
  for (const item of cases) {
    if (!seen.has(item.case_id)) {
      issues.push({
        code: "missing_result",
        case_id: item.case_id,
        detail: "The runner batch omitted an admitted case.",
      });
      rejected = true;
    }
  }
  return { byCase, rejected };
}

function attemptCount(input: ChallengeTrackReportInput): number {
  const available = input.attempt_port_available === true;
  const count = input.trusted_real_completed_attempt_count ?? 0;
  if (!Number.isSafeInteger(count) || count < 0)
    reject("invalid_attempt_count");
  return available ? count : 0;
}

/** Build an honest deterministic progress report; no row can promote a target. */
export function buildChallengeTrackReport(
  input: ChallengeTrackReportInput,
): ChallengeTrackReport {
  const reportInput = readReportInput(input);
  const plan = exactSnapshot(reportInput.plan);
  const issues: AccountingIssue[] = [];
  const cases = normalizeCases(reportInput.case_set, plan, issues);
  const rows = validateBatch(
    reportInput.runner,
    cases,
    plan,
    reportInput.case_set,
    issues,
  );
  const accumulators = new Map<
    string,
    {
      synthetic: number;
      runnable: number;
      blocked: number;
      pass: number;
      fail: number;
      unexecuted: number;
    }
  >();
  for (const target of plan.value.scenarios) {
    accumulators.set(target.scenario_id, {
      synthetic: 0,
      runnable: 0,
      blocked: 0,
      pass: 0,
      fail: 0,
      unexecuted: 0,
    });
  }
  for (const item of cases) {
    const accumulator = accumulators.get(item.scenario_id);
    if (!accumulator) continue;
    accumulator.synthetic += 1;
    if (item.blocked) accumulator.blocked += 1;
    else accumulator.runnable += 1;
    const outcome = rows.rejected
      ? "unexecuted"
      : (rows.byCase.get(item.case_id) ?? "unexecuted");
    if (outcome === "pass") accumulator.pass += 1;
    else if (outcome === "fail") accumulator.fail += 1;
    else accumulator.unexecuted += 1;
  }

  const coverageTargets: CoverageTargetRow[] = [...plan.value.scenarios]
    .sort((left, right) => compareStrings(left.scenario_id, right.scenario_id))
    .map((target: ChallengeCoverageScenario) => {
      const accumulator = accumulators.get(target.scenario_id);
      if (!accumulator) reject("internal_accounting_error");
      return {
        scenario_id: target.scenario_id,
        declared_target: jsonValue(target),
        planned: true as const,
        bound: accumulator.synthetic > 0,
        synthetic_case_count: accumulator.synthetic,
        runnable_case_count: accumulator.runnable,
        blocked_case_count: accumulator.blocked,
        executed_pass_count: accumulator.pass,
        executed_fail_count: accumulator.fail,
        executed_count: accumulator.pass + accumulator.fail,
        passed_count: accumulator.pass,
        unexecuted_count: accumulator.unexecuted,
        evidence_backed_count: 0 as const,
        golden_count: 0 as const,
        lifecycle_status: "planned" as const,
      };
    });

  issues.sort((left, right) => {
    const byId = compareStrings(left.case_id ?? "", right.case_id ?? "");
    return byId !== 0 ? byId : compareStrings(left.code, right.code);
  });
  const counts: ChallengeTrackCounts = {
    declared_target_count: coverageTargets.length,
    planned_target_count: coverageTargets.filter((row) => row.planned).length,
    bound_target_count: coverageTargets.filter((row) => row.bound).length,
    synthetic_case_count: coverageTargets.reduce(
      (sum, row) => sum + row.synthetic_case_count,
      0,
    ),
    runnable_case_count: coverageTargets.reduce(
      (sum, row) => sum + row.runnable_case_count,
      0,
    ),
    blocked_case_count: coverageTargets.reduce(
      (sum, row) => sum + row.blocked_case_count,
      0,
    ),
    executed_pass_count: coverageTargets.reduce(
      (sum, row) => sum + row.executed_pass_count,
      0,
    ),
    executed_fail_count: coverageTargets.reduce(
      (sum, row) => sum + row.executed_fail_count,
      0,
    ),
    executed_count: coverageTargets.reduce(
      (sum, row) => sum + row.executed_count,
      0,
    ),
    passed_count: coverageTargets.reduce(
      (sum, row) => sum + row.passed_count,
      0,
    ),
    unexecuted_count: coverageTargets.reduce(
      (sum, row) => sum + row.unexecuted_count,
      0,
    ),
    evidence_backed_count: 0,
    golden_count: 0,
  };
  const trustedAttempts = attemptCount(reportInput);
  const throughputCalibration: ThroughputCalibration = {
    status:
      trustedAttempts >= TRUSTED_REAL_ATTEMPT_THRESHOLD
        ? "calibrated"
        : "insufficient_real_observations",
    trusted_real_completed_attempt_count: trustedAttempts,
    required_trusted_real_completed_attempts: TRUSTED_REAL_ATTEMPT_THRESHOLD,
    attempt_port_available: reportInput.attempt_port_available === true,
  };
  const payload = {
    report_version: CHALLENGE_TRACK_REPORT_VERSION,
    counts,
    declared_target_count: counts.declared_target_count,
    planned_target_count: counts.planned_target_count,
    bound_target_count: counts.bound_target_count,
    synthetic_case_count: counts.synthetic_case_count,
    runnable_case_count: counts.runnable_case_count,
    blocked_case_count: counts.blocked_case_count,
    executed_pass_count: counts.executed_pass_count,
    executed_fail_count: counts.executed_fail_count,
    executed_count: counts.executed_count,
    passed_count: counts.passed_count,
    unexecuted_count: counts.unexecuted_count,
    evidence_backed_count: 0 as const,
    golden_count: 0 as const,
    coverage_targets: coverageTargets,
    real_scenario_status: "all_planned" as const,
    production_ready: false as const,
    evidence_track_ready: false as const,
    blockers: [
      {
        code: "m3_source_gate_blocked" as const,
        milestone: "M3" as const,
        status: "blocked" as const,
        detail:
          "M3 source-gate/evidence promotion remains blocked; synthetic output is not canonical evidence.",
      },
      {
        code: "m4_operational_rehearsal_insufficient_data" as const,
        milestone: "M4" as const,
        status: "insufficient_data" as const,
        detail:
          "M4 trusted-real operational rehearsal data is insufficient for production readiness.",
      },
    ],
    throughput_calibration: throughputCalibration,
    execution_accounting_status:
      issues.length === 0 ? ("valid" as const) : ("rejected" as const),
    accounting_issues: issues,
  };
  const reportHash = deterministicSha256(payload);
  return freezeDeep({ report_hash: reportHash, ...payload });
}

/** Short aliases make the pure report boundary convenient for package users. */
export const buildProgressReport = buildChallengeTrackReport;
export const createChallengeTrackReport = buildChallengeTrackReport;
export const buildReport = buildChallengeTrackReport;

export function verifyChallengeTrackReportHash(
  report: ChallengeTrackReport,
): boolean {
  const { report_hash: _ignored, ...payload } = report;
  try {
    return deterministicSha256(payload) === report.report_hash;
  } catch {
    return false;
  }
}

export function assertChallengeTrackReport(report: ChallengeTrackReport): void {
  if (report.coverage_targets.length !== CHALLENGE_TRACK_TARGET_COUNT)
    reject("target_count_mismatch");
  if (
    report.coverage_targets.some(
      (row, index) =>
        index > 0 &&
        compareStrings(
          report.coverage_targets[index - 1]?.scenario_id ?? "",
          row.scenario_id,
        ) > 0,
    )
  )
    reject("target_order_mismatch");
  if (
    report.evidence_backed_count !== 0 ||
    report.golden_count !== 0 ||
    report.production_ready !== false ||
    report.evidence_track_ready !== false
  )
    reject("lifecycle_upgrade");
  if (!verifyChallengeTrackReportHash(report)) reject("report_hash_mismatch");
}
