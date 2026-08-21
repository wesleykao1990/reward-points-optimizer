import { createHash } from "node:crypto";
import {
  canonicalize,
  type EngineContext,
  evaluateCandidates,
  type PurchasePlan,
  type Recommendation,
  serializeReplay,
} from "@jro/rule-engine";
import {
  evaluateM3Scenario,
  M3_SEED_SCENARIO_IDS,
  type M3ReviewMode,
  type M3ScenarioGateResult,
  type M3ScenarioRecord,
  type M3ScenarioSourceReadiness,
} from "./m3-gate.js";

/**
 * The experiment harness deliberately excludes the transfer seed.  Transfer
 * scenarios require a human second review and have a distinct promotion
 * policy; they are not silently treated as ordinary candidate replays.
 */
export const M3_NON_TRANSFER_SEED_SCENARIO_IDS = Object.freeze(
  M3_SEED_SCENARIO_IDS.filter((scenarioId) => scenarioId !== "JP-XFR-002"),
) as unknown as readonly [
  "JP-CVS-002",
  "JP-CVS-006",
  "JP-CVS-014",
  "JP-QR-007",
  "JP-QR-008",
  "JP-CMP-003",
  "JP-CMP-007",
  "JP-CMP-009",
  "JP-ECOM-012",
];

export type M3NonTransferSeedScenarioId =
  (typeof M3_NON_TRANSFER_SEED_SCENARIO_IDS)[number];

export type M3ExperimentStatus = "blocked" | "run_ready" | "passed" | "failed";

export type M3IndependentCalculationMethod =
  | "manual"
  | "spreadsheet"
  | "independent_script"
  | "independent";

/** A file reference is metadata only; bytes are supplied to replay functions. */
export interface M3ExperimentFileReference {
  artifact_id: string;
  path: string;
  /** Accepts `sha256:<64 lowercase hex>` and bare 64-character SHA-256 hex. */
  sha256: string;
}

export interface M3IndependentExpectedArtifact
  extends M3ExperimentFileReference {
  completed_at: string;
  /** The engine is never an independent calculation method. */
  method: M3IndependentCalculationMethod;
}

export type M3ExperimentBlockerCode =
  | "scenario_not_in_non_transfer_seed_set"
  | "transfer_scenario_rejected"
  | "duplicate_scenario_id"
  | "missing_scenario_id"
  | "scenario_set_mismatch"
  | "manifest_status_invalid"
  | "blocked_without_details"
  | "run_ready_has_blockers"
  | "timestamp_invalid"
  | "source_files_missing"
  | "snapshot_files_missing"
  | "evidence_files_missing"
  | "artifact_reference_invalid"
  | "artifact_duplicate"
  | "artifact_missing"
  | "artifact_hash_invalid"
  | "artifact_hash_mismatch"
  | "expected_artifact_missing"
  | "expected_artifact_not_independent"
  | "expected_artifact_json_invalid"
  | "serialized_plans_invalid"
  | "serialized_context_invalid"
  | "required_negative_assertions_missing"
  | "required_negative_assertion_duplicate"
  | "context_transaction_time_mismatch"
  | "context_replay_knowledge_time_mismatch"
  | "independent_timestamp_invalid"
  | "engine_before_independent_calculation"
  | "blocked_manifest"
  | "manifest_not_run_ready"
  | "batch_execution_blocked"
  | "engine_error"
  | "expected_result_mismatch"
  | "review_missing"
  | "review_not_approved"
  | "source_readiness_missing"
  | "source_not_ready"
  | "promotion_record_missing"
  | "promotion_scenario_mismatch"
  | "manifest_not_passed";

export interface M3ExperimentBlocker {
  code: M3ExperimentBlockerCode;
  scenario_id: string;
  detail: string;
  path?: string;
}

/**
 * A review is intentionally small.  Full review policy enforcement remains in
 * m3-gate; this field only proves that a manifest was reviewed before this
 * harness asks that gate to evaluate a promotion record.
 */
export interface M3ExperimentReview {
  reviewer_id: string;
  completed_at: string;
  decision: "approved" | "rejected" | "needs_more_evidence";
  mode?: M3ReviewMode;
}

/** Fields common to every JSON-serializable experiment manifest. */
interface M3ExperimentManifestBase {
  scenario_id: string;
  blockers: readonly M3ExperimentBlocker[];
}

/**
 * A blocked manifest is reportable before collection/research artifacts exist.
 * It deliberately carries no fake hashes, expected result, or frozen replay
 * inputs.  Replay returns before attempting to read any optional artifact.
 */
export interface M3BlockedExperimentManifest extends M3ExperimentManifestBase {
  status: "blocked";
  source_files?: readonly M3ExperimentFileReference[];
  snapshot_files?: readonly M3ExperimentFileReference[];
  evidence_files?: readonly M3ExperimentFileReference[];
  transaction_time?: string;
  replay_knowledge_at?: string;
  engine_run_at?: string;
  serialized_plans?: string;
  serialized_context?: string;
  expected_artifact?: M3IndependentExpectedArtifact;
  required_negative_assertions?: readonly string[];
  review?: M3ExperimentReview;
}

/**
 * A runnable/complete manifest has the full immutable replay contract.  Plans
 * and context are canonical JSON strings so a manifest can be stored without
 * importing engine objects or executable code.
 */
export interface M3RunnableExperimentManifest extends M3ExperimentManifestBase {
  status: Exclude<M3ExperimentStatus, "blocked">;
  source_files: readonly M3ExperimentFileReference[];
  snapshot_files: readonly M3ExperimentFileReference[];
  evidence_files: readonly M3ExperimentFileReference[];
  transaction_time: string;
  replay_knowledge_at: string;
  /** The recorded wall-clock time at which the engine replay was run. */
  engine_run_at: string;
  serialized_plans: string;
  serialized_context: string;
  expected_artifact: M3IndependentExpectedArtifact;
  required_negative_assertions: readonly string[];
  review?: M3ExperimentReview;
}

export type M3ExperimentManifest =
  | M3BlockedExperimentManifest
  | M3RunnableExperimentManifest;

export interface M3ExperimentValidationResult {
  valid: boolean;
  scenario_id: string;
  blockers: readonly M3ExperimentBlocker[];
}

export type M3ExperimentFileReader = (
  path: string,
) => string | Uint8Array | undefined;

export interface M3VerifiedExperimentArtifact {
  artifact_id: string;
  path: string;
  sha256: string;
  byte_length: number;
}

export interface M3ExperimentArtifactVerificationResult {
  valid: boolean;
  scenario_id: string;
  artifacts: readonly M3VerifiedExperimentArtifact[];
  blockers: readonly M3ExperimentBlocker[];
}

export type M3CandidateEvaluator = (
  plans: readonly PurchasePlan[],
  context: EngineContext,
) => Recommendation;

export interface M3ExperimentReplayOptions {
  readFile: M3ExperimentFileReader;
  /** Injectable for deterministic tests and future engine adapters. */
  evaluate?: M3CandidateEvaluator;
}

export interface M3ExperimentReplayResult {
  scenario_id: string;
  status: M3ExperimentStatus;
  executed: boolean;
  expected_match: boolean | null;
  expected_sha256: string | null;
  actual_sha256: string | null;
  actual_result?: Recommendation;
  actual_serialized_result?: string;
  mismatch_paths: readonly string[];
  blockers: readonly M3ExperimentBlocker[];
}

interface M3ExperimentPreflight {
  blockers: M3ExperimentBlocker[];
  plans?: PurchasePlan[];
  context?: EngineContext;
  expected?: { value: unknown; sha256: string };
}

export interface M3ExperimentSetReplayResult {
  expected_scenario_ids: readonly M3NonTransferSeedScenarioId[];
  supplied_scenario_ids: readonly string[];
  seed_set_valid: boolean;
  scenarios: readonly M3ExperimentReplayResult[];
  blockers: readonly M3ExperimentBlocker[];
}

export interface M3ExperimentPromotionGateResult {
  scenario_id: string;
  can_promote_to_golden: boolean;
  eligible_for_golden: boolean;
  /** Undefined when the preconditions intentionally prevented gate evaluation. */
  gate_result?: M3ScenarioGateResult;
  blockers: readonly M3ExperimentBlocker[];
}

const HEX_SHA256 = /^[0-9a-f]{64}$/u;
const PREFixed_SHA256 = /^sha256:([0-9a-f]{64})$/u;
const VALID_STATUSES: readonly M3ExperimentStatus[] = [
  "blocked",
  "run_ready",
  "passed",
  "failed",
];
const INDEPENDENT_METHODS: readonly M3IndependentCalculationMethod[] = [
  "manual",
  "spreadsheet",
  "independent_script",
  "independent",
];

function blocker(
  scenarioId: string,
  code: M3ExperimentBlockerCode,
  detail: string,
  path?: string,
): M3ExperimentBlocker {
  return path === undefined
    ? { code, scenario_id: scenarioId, detail }
    : { code, scenario_id: scenarioId, detail, path };
}

function isNonTransferSeedScenarioId(
  value: string,
): value is M3NonTransferSeedScenarioId {
  return (M3_NON_TRANSFER_SEED_SCENARIO_IDS as readonly string[]).includes(
    value,
  );
}

function isTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    Number.isFinite(Date.parse(value))
  );
}

function duplicateValues(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].sort();
}

function normalizedSha256(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const prefixed = PREFixed_SHA256.exec(value);
  if (prefixed?.[1]) return `sha256:${prefixed[1]}`;
  if (HEX_SHA256.test(value)) return `sha256:${value}`;
  return null;
}

function sha256Bytes(value: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function bytesOf(value: string | Uint8Array): Uint8Array {
  return typeof value === "string" ? new TextEncoder().encode(value) : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collectArtifactReferences(manifest: M3ExperimentManifest): readonly {
  kind: "source" | "snapshot" | "evidence" | "expected";
  reference: M3ExperimentFileReference;
}[] {
  const sourceFiles = Array.isArray(manifest?.source_files)
    ? manifest.source_files
    : [];
  const snapshotFiles = Array.isArray(manifest?.snapshot_files)
    ? manifest.snapshot_files
    : [];
  const evidenceFiles = Array.isArray(manifest?.evidence_files)
    ? manifest.evidence_files
    : [];
  return [
    ...sourceFiles.map((reference) => ({
      kind: "source" as const,
      reference,
    })),
    ...snapshotFiles.map((reference) => ({
      kind: "snapshot" as const,
      reference,
    })),
    ...evidenceFiles.map((reference) => ({
      kind: "evidence" as const,
      reference,
    })),
    ...(manifest?.expected_artifact
      ? [{ kind: "expected" as const, reference: manifest.expected_artifact }]
      : []),
  ];
}

function validateFileReferences(
  manifest: M3ExperimentManifest,
  kind: "source" | "snapshot" | "evidence",
  references: readonly M3ExperimentFileReference[],
  blockers: M3ExperimentBlocker[],
): void {
  const scenarioId = manifest.scenario_id;
  const missingCode: Record<
    "source" | "snapshot" | "evidence",
    M3ExperimentBlockerCode
  > = {
    source: "source_files_missing",
    snapshot: "snapshot_files_missing",
    evidence: "evidence_files_missing",
  };
  if (references.length === 0) {
    blockers.push(
      blocker(
        scenarioId,
        missingCode[kind],
        `At least one ${kind} file reference is required.`,
        `${kind}_files`,
      ),
    );
  }
  for (const [index, reference] of references.entries()) {
    if (
      typeof reference?.artifact_id !== "string" ||
      reference.artifact_id.trim().length === 0 ||
      typeof reference.path !== "string" ||
      reference.path.trim().length === 0
    ) {
      blockers.push(
        blocker(
          scenarioId,
          "artifact_reference_invalid",
          `${kind} file references need non-empty artifact_id and path.`,
          `${kind}_files/${index}`,
        ),
      );
    }
    if (!normalizedSha256(reference?.sha256)) {
      blockers.push(
        blocker(
          scenarioId,
          "artifact_hash_invalid",
          `${kind} file ${reference?.artifact_id ?? "<unknown>"} has an invalid SHA-256.`,
          `${kind}_files/${index}/sha256`,
        ),
      );
    }
  }
}

/** Validate exact nine-set membership; order is intentionally irrelevant. */
export function validateM3ExperimentSeedScenarioIds(
  scenarioIds: readonly string[],
): readonly M3ExperimentBlocker[] {
  const blockers: M3ExperimentBlocker[] = [];
  const expected = new Set<string>(M3_NON_TRANSFER_SEED_SCENARIO_IDS);
  const supplied = [...scenarioIds];
  const duplicates = duplicateValues(supplied);
  for (const duplicate of duplicates) {
    blockers.push(
      blocker(
        duplicate,
        duplicate === "JP-XFR-002"
          ? "transfer_scenario_rejected"
          : "duplicate_scenario_id",
        duplicate === "JP-XFR-002"
          ? "JP-XFR-002 is intentionally excluded from this experiment harness."
          : `Scenario id ${duplicate} appears more than once.`,
      ),
    );
  }
  if (supplied.includes("JP-XFR-002")) {
    blockers.push(
      blocker(
        "JP-XFR-002",
        "transfer_scenario_rejected",
        "JP-XFR-002 is intentionally excluded from the nine non-transfer seed scenarios.",
      ),
    );
  }
  for (const scenarioId of supplied) {
    if (!expected.has(scenarioId) && scenarioId !== "JP-XFR-002") {
      blockers.push(
        blocker(
          scenarioId,
          "scenario_not_in_non_transfer_seed_set",
          `${scenarioId || "<empty>"} is not one of the nine non-transfer seed scenarios.`,
        ),
      );
    }
  }
  const missing = M3_NON_TRANSFER_SEED_SCENARIO_IDS.filter(
    (scenarioId) => !supplied.includes(scenarioId),
  );
  const extra = supplied.filter((scenarioId) => !expected.has(scenarioId));
  if (
    missing.length > 0 ||
    extra.length > 0 ||
    supplied.length !== expected.size
  ) {
    const details = [
      missing.length > 0 ? `missing ${missing.join(", ")}` : "",
      extra.length > 0 ? `unexpected ${extra.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join("; ");
    blockers.push(
      blocker(
        "__m3_non_transfer_seed_set__",
        "scenario_set_mismatch",
        `Expected exactly the nine non-transfer M3 seed scenario IDs (${details || "size mismatch"}).`,
      ),
    );
  }
  return blockers;
}

export const validateM3NonTransferSeedScenarioIds =
  validateM3ExperimentSeedScenarioIds;

/** Validate the JSON manifest without reading any external artifact bytes. */
export function validateM3ExperimentManifest(
  manifest: M3ExperimentManifest,
): M3ExperimentValidationResult {
  const scenarioId =
    typeof manifest?.scenario_id === "string" ? manifest.scenario_id : "";
  const blockers: M3ExperimentBlocker[] = [];
  if (!isNonTransferSeedScenarioId(scenarioId)) {
    blockers.push(
      blocker(
        scenarioId,
        scenarioId === "JP-XFR-002"
          ? "transfer_scenario_rejected"
          : "scenario_not_in_non_transfer_seed_set",
        scenarioId === "JP-XFR-002"
          ? "JP-XFR-002 is excluded from this replay harness."
          : `Scenario id ${scenarioId || "<empty>"} is not in the exact nine-scenario set.`,
      ),
    );
  }
  if (!VALID_STATUSES.includes(manifest?.status)) {
    blockers.push(
      blocker(
        scenarioId,
        "manifest_status_invalid",
        `Unknown experiment status ${String(manifest?.status ?? "<empty>")}.`,
        "status",
      ),
    );
  }
  if (
    manifest?.status === "blocked" &&
    (!Array.isArray(manifest.blockers) || manifest.blockers.length === 0)
  ) {
    blockers.push(
      blocker(
        scenarioId,
        "blocked_without_details",
        "A blocked manifest must preserve at least one blocker detail.",
        "blockers",
      ),
    );
  }
  if (
    manifest?.status === "run_ready" &&
    Array.isArray(manifest.blockers) &&
    manifest.blockers.length > 0
  ) {
    blockers.push(
      blocker(
        scenarioId,
        "run_ready_has_blockers",
        "A run-ready manifest cannot carry unresolved blocker details.",
        "blockers",
      ),
    );
  }
  if (manifest?.status !== "blocked") {
    for (const [field, value] of [
      ["transaction_time", manifest?.transaction_time],
      ["replay_knowledge_at", manifest?.replay_knowledge_at],
      ["engine_run_at", manifest?.engine_run_at],
    ] as const) {
      if (!isTimestamp(value)) {
        blockers.push(
          blocker(
            scenarioId,
            "timestamp_invalid",
            `${field} must be a valid ISO timestamp.`,
            field,
          ),
        );
      }
    }

    validateFileReferences(
      manifest,
      "source",
      Array.isArray(manifest?.source_files) ? manifest.source_files : [],
      blockers,
    );
    validateFileReferences(
      manifest,
      "snapshot",
      Array.isArray(manifest?.snapshot_files) ? manifest.snapshot_files : [],
      blockers,
    );
    validateFileReferences(
      manifest,
      "evidence",
      Array.isArray(manifest?.evidence_files) ? manifest.evidence_files : [],
      blockers,
    );

    const expected = manifest?.expected_artifact;
    if (!expected) {
      blockers.push(
        blocker(
          scenarioId,
          "expected_artifact_missing",
          "An independent expected-result artifact is required.",
          "expected_artifact",
        ),
      );
    } else {
      if (
        typeof expected.artifact_id !== "string" ||
        expected.artifact_id.trim().length === 0 ||
        typeof expected.path !== "string" ||
        expected.path.trim().length === 0
      ) {
        blockers.push(
          blocker(
            scenarioId,
            "artifact_reference_invalid",
            "The independent expected artifact needs a non-empty artifact_id and path.",
            "expected_artifact",
          ),
        );
      }
      if (!normalizedSha256(expected.sha256)) {
        blockers.push(
          blocker(
            scenarioId,
            "artifact_hash_invalid",
            "The independent expected artifact needs a valid SHA-256.",
            "expected_artifact/sha256",
          ),
        );
      }
      if (!isTimestamp(expected.completed_at)) {
        blockers.push(
          blocker(
            scenarioId,
            "independent_timestamp_invalid",
            "Independent expected calculation completed_at must be a valid ISO timestamp.",
            "expected_artifact/completed_at",
          ),
        );
      }
      if (!INDEPENDENT_METHODS.includes(expected.method)) {
        blockers.push(
          blocker(
            scenarioId,
            "expected_artifact_not_independent",
            "The expected artifact method must be independent of the engine.",
            "expected_artifact/method",
          ),
        );
      }
    }

    const allReferences = collectArtifactReferences(manifest);
    const seenIds = new Set<string>();
    const seenPaths = new Set<string>();
    for (const { reference } of allReferences) {
      if (typeof reference?.artifact_id === "string" && reference.artifact_id) {
        if (seenIds.has(reference.artifact_id)) {
          blockers.push(
            blocker(
              scenarioId,
              "artifact_duplicate",
              `Artifact id ${reference.artifact_id} is declared more than once.`,
            ),
          );
        }
        seenIds.add(reference.artifact_id);
      }
      if (typeof reference?.path === "string" && reference.path) {
        if (seenPaths.has(reference.path)) {
          blockers.push(
            blocker(
              scenarioId,
              "artifact_duplicate",
              `Artifact path ${reference.path} is declared more than once.`,
            ),
          );
        }
        seenPaths.add(reference.path);
      }
    }

    if (typeof manifest?.serialized_plans !== "string") {
      blockers.push(
        blocker(
          scenarioId,
          "serialized_plans_invalid",
          "serialized_plans must be a JSON string.",
          "serialized_plans",
        ),
      );
    }
    if (typeof manifest?.serialized_context !== "string") {
      blockers.push(
        blocker(
          scenarioId,
          "serialized_context_invalid",
          "serialized_context must be a JSON string.",
          "serialized_context",
        ),
      );
    }
    if (typeof manifest?.serialized_plans === "string") {
      try {
        const plans = JSON.parse(manifest.serialized_plans) as unknown;
        if (!Array.isArray(plans)) {
          blockers.push(
            blocker(
              scenarioId,
              "serialized_plans_invalid",
              "serialized_plans must decode to an array of purchase plans.",
              "serialized_plans",
            ),
          );
        }
      } catch {
        blockers.push(
          blocker(
            scenarioId,
            "serialized_plans_invalid",
            "serialized_plans is not valid JSON.",
            "serialized_plans",
          ),
        );
      }
    }
    if (typeof manifest?.serialized_context === "string") {
      try {
        const context = JSON.parse(manifest.serialized_context) as unknown;
        if (!isRecord(context)) {
          blockers.push(
            blocker(
              scenarioId,
              "serialized_context_invalid",
              "serialized_context must decode to an object engine context.",
              "serialized_context",
            ),
          );
        }
      } catch {
        blockers.push(
          blocker(
            scenarioId,
            "serialized_context_invalid",
            "serialized_context is not valid JSON.",
            "serialized_context",
          ),
        );
      }
    }

    const assertions = Array.isArray(manifest?.required_negative_assertions)
      ? manifest.required_negative_assertions
      : [];
    if (
      assertions.length === 0 ||
      assertions.some(
        (assertion) =>
          typeof assertion !== "string" || assertion.trim().length === 0,
      )
    ) {
      blockers.push(
        blocker(
          scenarioId,
          "required_negative_assertions_missing",
          "At least one non-empty required negative assertion is required.",
          "required_negative_assertions",
        ),
      );
    }
    for (const duplicate of duplicateValues(
      assertions.filter(
        (assertion): assertion is string => typeof assertion === "string",
      ),
    )) {
      blockers.push(
        blocker(
          scenarioId,
          "required_negative_assertion_duplicate",
          `Required negative assertion ${duplicate} is duplicated.`,
          "required_negative_assertions",
        ),
      );
    }
  }

  return {
    valid: blockers.length === 0,
    scenario_id: scenarioId,
    blockers,
  };
}

/** Verify every declared source/snapshot/evidence/expected artifact hash. */
export function verifyM3ExperimentArtifactHashes(
  manifest: M3ExperimentManifest,
  readFile: M3ExperimentFileReader,
): M3ExperimentArtifactVerificationResult {
  const validation = validateM3ExperimentManifest(manifest);
  const blockers = [...validation.blockers];
  const artifacts: M3VerifiedExperimentArtifact[] = [];
  for (const { reference } of collectArtifactReferences(manifest)) {
    if (
      typeof reference?.path !== "string" ||
      reference.path.trim().length === 0
    )
      continue;
    let bytes: string | Uint8Array | undefined;
    try {
      bytes = readFile(reference.path);
    } catch {
      bytes = undefined;
    }
    if (bytes === undefined) {
      blockers.push(
        blocker(
          manifest.scenario_id,
          reference === manifest.expected_artifact
            ? "expected_artifact_missing"
            : "artifact_missing",
          `Artifact bytes are unavailable at ${reference.path}.`,
          reference.path,
        ),
      );
      continue;
    }
    const actualHash = sha256Bytes(bytes);
    const declaredHash = normalizedSha256(reference.sha256);
    if (declaredHash === null || actualHash !== declaredHash) {
      blockers.push(
        blocker(
          manifest.scenario_id,
          reference === manifest.expected_artifact
            ? "artifact_hash_mismatch"
            : "artifact_hash_mismatch",
          `Artifact ${reference.artifact_id} hash does not match its declared SHA-256.`,
          reference.path,
        ),
      );
    }
    artifacts.push({
      artifact_id: reference.artifact_id,
      path: reference.path,
      sha256: actualHash,
      byte_length: bytesOf(bytes).byteLength,
    });
  }
  return {
    valid: blockers.length === 0,
    scenario_id: manifest.scenario_id,
    artifacts,
    blockers,
  };
}

export const verifyM3ExperimentHashes = verifyM3ExperimentArtifactHashes;
export const verifyM3ExperimentArtifacts = verifyM3ExperimentArtifactHashes;

function parseJson(value: string): unknown {
  return JSON.parse(value) as unknown;
}

function publicResultProjection(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const projection = { ...value };
  // Replay metadata is generated by the engine itself.  The independent
  // artifact covers every public recommendation/plan field, while the harness
  // separately records the engine run and compares this projection exactly.
  delete projection.replay;
  return projection;
}

function serializedResult(value: unknown): string {
  return serializeReplay(value as Recommendation);
}

function expectedValueFromArtifact(value: unknown): unknown {
  if (typeof value === "string") return parseJson(value);
  if (!isRecord(value)) return value;
  for (const key of [
    "expected_result",
    "serialized_result",
    "result",
    "output",
  ]) {
    if (key in value) {
      const candidate = value[key];
      return typeof candidate === "string" ? parseJson(candidate) : candidate;
    }
  }
  return value;
}

function mismatchPaths(
  expected: unknown,
  actual: unknown,
  path = "$",
  output: string[] = [],
): readonly string[] {
  if (output.length >= 100) return output;
  if (canonicalize(expected) === canonicalize(actual)) return output;
  if (Array.isArray(expected) && Array.isArray(actual)) {
    const length = Math.max(expected.length, actual.length);
    for (let index = 0; index < length && output.length < 100; index += 1) {
      if (index >= expected.length || index >= actual.length) {
        output.push(`${path}[${index}]`);
      } else {
        mismatchPaths(
          expected[index],
          actual[index],
          `${path}[${index}]`,
          output,
        );
      }
    }
    return output;
  }
  if (isRecord(expected) && isRecord(actual)) {
    const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
    for (const key of [...keys].sort()) {
      if (output.length >= 100) break;
      if (!(key in expected) || !(key in actual)) output.push(`${path}.${key}`);
      else mismatchPaths(expected[key], actual[key], `${path}.${key}`, output);
    }
    return output;
  }
  output.push(path);
  return output;
}

function extractExpectedArtifact(
  manifest: M3ExperimentManifest,
  readFile: M3ExperimentFileReader,
  blockers: M3ExperimentBlocker[],
): { value: unknown; sha256: string | null } {
  const reference = manifest.expected_artifact;
  if (!reference) {
    blockers.push(
      blocker(
        manifest.scenario_id,
        "expected_artifact_missing",
        "Independent expected artifact metadata is unavailable.",
        "expected_artifact",
      ),
    );
    return { value: null, sha256: null };
  }
  const bytes = readFile(reference.path);
  if (bytes === undefined) {
    blockers.push(
      blocker(
        manifest.scenario_id,
        "expected_artifact_missing",
        `Independent expected artifact bytes are unavailable at ${reference.path}.`,
        reference.path,
      ),
    );
    return { value: null, sha256: null };
  }
  const actualHash = sha256Bytes(bytes);
  const declaredHash = normalizedSha256(reference.sha256);
  if (declaredHash === null || actualHash !== declaredHash) {
    blockers.push(
      blocker(
        manifest.scenario_id,
        "artifact_hash_mismatch",
        `Independent expected artifact ${reference.artifact_id} hash does not match its declaration.`,
        reference.path,
      ),
    );
    return { value: null, sha256: actualHash };
  }
  try {
    const parsed = JSON.parse(
      new TextDecoder().decode(bytesOf(bytes)),
    ) as unknown;
    return { value: expectedValueFromArtifact(parsed), sha256: actualHash };
  } catch {
    blockers.push(
      blocker(
        manifest.scenario_id,
        "expected_artifact_json_invalid",
        "Independent expected artifact must contain valid JSON or a serialized JSON result.",
        reference.path,
      ),
    );
    return { value: null, sha256: actualHash };
  }
}

function contextWithFrozenTimes(
  manifest: M3ExperimentManifest,
  value: unknown,
  blockers: M3ExperimentBlocker[],
): EngineContext | null {
  if (!isRecord(value)) {
    blockers.push(
      blocker(
        manifest.scenario_id,
        "serialized_context_invalid",
        "Serialized engine context must decode to an object.",
        "serialized_context",
      ),
    );
    return null;
  }
  if (
    value.transaction_time !== undefined &&
    value.transaction_time !== manifest.transaction_time
  ) {
    blockers.push(
      blocker(
        manifest.scenario_id,
        "context_transaction_time_mismatch",
        "Serialized context transaction_time must equal the manifest frozen transaction_time.",
        "serialized_context/transaction_time",
      ),
    );
  }
  if (
    value.replay_knowledge_at !== undefined &&
    value.replay_knowledge_at !== manifest.replay_knowledge_at
  ) {
    blockers.push(
      blocker(
        manifest.scenario_id,
        "context_replay_knowledge_time_mismatch",
        "Serialized context replay_knowledge_at must equal the manifest frozen replay_knowledge_at.",
        "serialized_context/replay_knowledge_at",
      ),
    );
  }
  return {
    ...value,
    transaction_time: manifest.transaction_time,
    replay_knowledge_at: manifest.replay_knowledge_at,
  } as EngineContext;
}

/**
 * Keep one immutable byte snapshot per declared path during a preflight.
 * Hash verification and expected-result parsing must consume the same bytes;
 * a later reread could otherwise turn a clean preflight into a TOCTOU replay.
 */
function memoizedM3ExperimentReader(
  readFile: M3ExperimentFileReader,
): M3ExperimentFileReader {
  const cache = new Map<string, string | Uint8Array | undefined>();
  return (path) => {
    if (cache.has(path)) return cache.get(path);
    let bytes: string | Uint8Array | undefined;
    try {
      bytes = readFile(path);
    } catch {
      bytes = undefined;
    }
    cache.set(path, bytes);
    return bytes;
  };
}

/**
 * Resolve every failure that can be observed before invoking the evaluator.
 * Batch replay uses this phase for all members before allowing any engine
 * execution, so one malformed candidate cannot partially execute its peers.
 */
function preflightM3Experiment(
  manifest: M3ExperimentManifest,
  options: M3ExperimentReplayOptions,
): M3ExperimentPreflight {
  const validation = validateM3ExperimentManifest(manifest);
  const blockers = [...validation.blockers];
  if (manifest.status === "blocked") {
    blockers.push(
      blocker(
        manifest.scenario_id,
        "blocked_manifest",
        "Blocked experiment manifests are reportable but must never execute the engine.",
      ),
    );
    return { blockers };
  }
  if (manifest.status !== "run_ready") {
    blockers.push(
      blocker(
        manifest.scenario_id,
        "manifest_not_run_ready",
        `Experiment status ${manifest.status} is not eligible for a new replay.`,
      ),
    );
    return { blockers };
  }

  const readFile = memoizedM3ExperimentReader(options.readFile);
  const artifactVerification = verifyM3ExperimentArtifactHashes(
    manifest,
    readFile,
  );
  blockers.push(...artifactVerification.blockers);
  if (blockers.length > 0) return { blockers };
  const independentAt = Date.parse(manifest.expected_artifact.completed_at);
  const engineAt = Date.parse(manifest.engine_run_at);
  if (
    Number.isFinite(independentAt) &&
    Number.isFinite(engineAt) &&
    independentAt >= engineAt
  ) {
    blockers.push(
      blocker(
        manifest.scenario_id,
        "engine_before_independent_calculation",
        "The independent expected calculation must be completed strictly before engine replay.",
        "engine_run_at",
      ),
    );
  }
  if (blockers.length > 0) return { blockers };

  let plansValue: unknown;
  let contextValue: unknown;
  try {
    plansValue = parseJson(manifest.serialized_plans);
    contextValue = parseJson(manifest.serialized_context);
  } catch {
    // Validation normally catches this, but preserve the no-execution invariant
    // if a caller mutates a manifest between validation and replay.
    blockers.push(
      blocker(
        manifest.scenario_id,
        "serialized_plans_invalid",
        "Serialized plans/context could not be decoded before replay.",
      ),
    );
    return { blockers };
  }
  if (!Array.isArray(plansValue)) {
    blockers.push(
      blocker(
        manifest.scenario_id,
        "serialized_plans_invalid",
        "Serialized plans must decode to an array.",
      ),
    );
    return { blockers };
  }
  const context = contextWithFrozenTimes(manifest, contextValue, blockers);
  if (!context || blockers.length > 0) return { blockers };

  const expected = extractExpectedArtifact(manifest, readFile, blockers);
  if (blockers.length > 0 || expected.sha256 === null) return { blockers };
  return {
    blockers,
    plans: plansValue as PurchasePlan[],
    context,
    expected: { value: expected.value, sha256: expected.sha256 },
  };
}

function executeM3ExperimentFromPreflight(
  manifest: M3ExperimentManifest,
  preflight: M3ExperimentPreflight,
  options: M3ExperimentReplayOptions,
): M3ExperimentReplayResult {
  const blockers = preflight.blockers;
  const base = {
    scenario_id: manifest.scenario_id,
    expected_match: null,
    expected_sha256: null,
    actual_sha256: null,
    mismatch_paths: [] as readonly string[],
  };
  if (manifest.status === "blocked") {
    return { ...base, status: "blocked", executed: false, blockers };
  }
  if (manifest.status !== "run_ready") {
    return {
      ...base,
      status: manifest.status,
      executed: false,
      blockers,
    };
  }
  if (blockers.length > 0) {
    return { ...base, status: "failed", executed: false, blockers };
  }

  if (!preflight.plans || !preflight.context || !preflight.expected) {
    blockers.push(
      blocker(
        manifest.scenario_id,
        "serialized_plans_invalid",
        "Replay preflight did not produce complete engine inputs.",
      ),
    );
    return { ...base, status: "failed", executed: false, blockers };
  }
  const { plans: plansValue, context, expected } = preflight;

  const evaluator = options.evaluate ?? evaluateCandidates;
  let actual: Recommendation;
  try {
    actual = evaluator(plansValue, context);
  } catch (error) {
    blockers.push(
      blocker(
        manifest.scenario_id,
        "engine_error",
        error instanceof Error ? error.message : String(error),
      ),
    );
    return {
      ...base,
      status: "failed",
      executed: true,
      expected_sha256: expected.sha256,
      blockers,
    };
  }
  const actualSerialized = serializedResult(actual);
  const actualValue = JSON.parse(actualSerialized) as unknown;
  const expectedValue = publicResultProjection(expected.value);
  const actualPublic = publicResultProjection(actualValue);
  const match = canonicalize(expectedValue) === canonicalize(actualPublic);
  const actualHash = sha256Bytes(actualSerialized);
  if (!match) {
    blockers.push(
      blocker(
        manifest.scenario_id,
        "expected_result_mismatch",
        "Engine public result differs from the independent expected artifact.",
      ),
    );
  }
  return {
    ...base,
    status: match ? "passed" : "failed",
    executed: true,
    expected_match: match,
    expected_sha256: expected.sha256,
    actual_sha256: actualHash,
    actual_result: actual,
    actual_serialized_result: actualSerialized,
    mismatch_paths: match ? [] : mismatchPaths(expectedValue, actualPublic),
    blockers,
  };
}

/**
 * Replay one manifest.  Only a `run_ready` manifest may invoke the evaluator;
 * blocked, passed, failed, malformed, and hash-invalid manifests remain
 * reportable without executing candidate code.
 */
export function replayM3Experiment(
  manifest: M3ExperimentManifest,
  options: M3ExperimentReplayOptions,
): M3ExperimentReplayResult {
  return executeM3ExperimentFromPreflight(
    manifest,
    preflightM3Experiment(manifest, options),
    options,
  );
}

export const runM3ExperimentReplay = replayM3Experiment;
export const runM3Experiment = replayM3Experiment;

/**
 * Replay a batch while enforcing the exact nine non-transfer scenario set.
 * Canonical batches are either all blocked readiness records or all runnable
 * records.  A mixed or malformed batch fails closed before any evaluator call.
 */
export function replayM3ExperimentSet(
  manifests: readonly M3ExperimentManifest[],
  options: M3ExperimentReplayOptions,
): M3ExperimentSetReplayResult {
  const suppliedIds = manifests.map((manifest) => manifest.scenario_id);
  const seedSetBlockers = validateM3ExperimentSeedScenarioIds(suppliedIds);
  // Do not even validate/replay individual records when the batch identity is
  // malformed.  A duplicate or missing id must never provide a path to
  // candidate execution outside the exact nine-scenario experiment set.
  if (seedSetBlockers.length > 0) {
    return {
      expected_scenario_ids: [...M3_NON_TRANSFER_SEED_SCENARIO_IDS],
      supplied_scenario_ids: suppliedIds,
      seed_set_valid: false,
      scenarios: [],
      blockers: seedSetBlockers,
    };
  }
  const preflights = manifests.map((manifest) =>
    preflightM3Experiment(manifest, options),
  );
  const intentionallyBlocked = (index: number): boolean => {
    const manifest = manifests[index];
    const preflight = preflights[index];
    return (
      manifest?.status === "blocked" &&
      preflight?.blockers.length === 1 &&
      preflight.blockers[0]?.code === "blocked_manifest"
    );
  };
  const allBlocked = preflights.every((_preflight, index) =>
    intentionallyBlocked(index),
  );
  const allRunnable = preflights.every(
    (preflight, index) =>
      manifests[index]?.status === "run_ready" &&
      preflight.blockers.length === 0 &&
      preflight.plans !== undefined &&
      preflight.context !== undefined &&
      preflight.expected !== undefined,
  );

  if (!allBlocked && !allRunnable) {
    const scenarios = manifests.map((manifest, index) => {
      const preflight = preflights[index];
      const blockers = [...(preflight?.blockers ?? [])];
      blockers.push(
        blocker(
          manifest.scenario_id,
          "batch_execution_blocked",
          "The canonical exact-nine batch contains a malformed, non-runnable, or mixed-status member; no evaluator was invoked.",
        ),
      );
      return {
        scenario_id: manifest.scenario_id,
        status: manifest.status === "blocked" ? "blocked" : "failed",
        executed: false,
        expected_match: null,
        expected_sha256: null,
        actual_sha256: null,
        mismatch_paths: [],
        blockers,
      } satisfies M3ExperimentReplayResult;
    });
    return {
      expected_scenario_ids: [...M3_NON_TRANSFER_SEED_SCENARIO_IDS],
      supplied_scenario_ids: suppliedIds,
      seed_set_valid: true,
      scenarios,
      blockers: scenarios.flatMap((item) => item.blockers),
    };
  }

  // All-blocked batches use their retained preflight records so their
  // reportable blocked status remains visible without a second validation or
  // any file read/evaluator invocation.
  if (allBlocked) {
    const scenarios = preflights.map((preflight, index) => {
      const manifest = manifests[index];
      if (!manifest) throw new Error("Batch preflight/member length diverged.");
      return executeM3ExperimentFromPreflight(manifest, preflight, options);
    });
    return {
      expected_scenario_ids: [...M3_NON_TRANSFER_SEED_SCENARIO_IDS],
      supplied_scenario_ids: suppliedIds,
      seed_set_valid: true,
      scenarios,
      blockers: scenarios.flatMap((item) => item.blockers),
    };
  }

  // All runnable members passed preflight, so candidate execution is now
  // allowed from those retained immutable plans/context/expected values.
  const scenarios = preflights.map((preflight, index) => {
    const manifest = manifests[index];
    if (!manifest) throw new Error("Batch preflight/member length diverged.");
    return executeM3ExperimentFromPreflight(manifest, preflight, options);
  });
  return {
    expected_scenario_ids: [...M3_NON_TRANSFER_SEED_SCENARIO_IDS],
    supplied_scenario_ids: suppliedIds,
    seed_set_valid: seedSetBlockers.length === 0,
    scenarios,
    blockers: [
      ...seedSetBlockers,
      ...scenarios.flatMap((item) => item.blockers),
    ],
  };
}

export const replayM3Experiments = replayM3ExperimentSet;

/** Parse an immutable manifest value without attaching any runtime behavior. */
export function loadM3ExperimentManifest(
  value: string | M3ExperimentManifest,
): M3ExperimentManifest {
  if (typeof value !== "string") return structuredClone(value);
  return JSON.parse(value) as M3ExperimentManifest;
}

export const loadM3Experiment = loadM3ExperimentManifest;

/**
 * Ask the existing M3 gate to evaluate a promotion only after all local
 * experiment preconditions are satisfied.  In particular, no source-readiness
 * or review record is synthesized from a replay result.
 */
export function composeM3ExperimentPromotionGate(
  manifest: M3ExperimentManifest,
  sourceReadiness: M3ScenarioSourceReadiness | undefined,
  scenarioRecord: M3ScenarioRecord | undefined,
): M3ExperimentPromotionGateResult {
  const blockers: M3ExperimentBlocker[] = [];
  if (manifest.status !== "passed") {
    blockers.push(
      blocker(
        manifest.scenario_id,
        "manifest_not_passed",
        "Only an exact-match passed manifest may be considered for promotion.",
      ),
    );
  }
  if (!manifest.review) {
    blockers.push(
      blocker(
        manifest.scenario_id,
        "review_missing",
        "A reviewed manifest is required before promotion-gate composition.",
        "review",
      ),
    );
  } else {
    if (manifest.review.decision !== "approved") {
      blockers.push(
        blocker(
          manifest.scenario_id,
          "review_not_approved",
          "Manifest review must be approved before promotion-gate composition.",
          "review/decision",
        ),
      );
    }
    if (
      !manifest.review.reviewer_id ||
      !isTimestamp(manifest.review.completed_at)
    ) {
      blockers.push(
        blocker(
          manifest.scenario_id,
          "review_not_approved",
          "Manifest review needs an identified reviewer and valid completion time.",
          "review",
        ),
      );
    }
  }
  if (!sourceReadiness) {
    blockers.push(
      blocker(
        manifest.scenario_id,
        "source_readiness_missing",
        "Source readiness is required before promotion-gate composition.",
      ),
    );
  } else if (
    sourceReadiness.scenario_id !== manifest.scenario_id ||
    sourceReadiness.promotion_ready !== true ||
    !Array.isArray(sourceReadiness.promotion_blockers) ||
    sourceReadiness.promotion_blockers.length > 0
  ) {
    blockers.push(
      blocker(
        manifest.scenario_id,
        "source_not_ready",
        "Source readiness is missing, mismatched, or contains promotion blockers.",
      ),
    );
  }
  if (!scenarioRecord) {
    blockers.push(
      blocker(
        manifest.scenario_id,
        "promotion_record_missing",
        "A reviewed M3 scenario record is required for the existing promotion gate.",
      ),
    );
  } else if (scenarioRecord.scenario_id !== manifest.scenario_id) {
    blockers.push(
      blocker(
        manifest.scenario_id,
        "promotion_scenario_mismatch",
        "Promotion scenario record id must equal the experiment manifest id.",
      ),
    );
  }

  if (blockers.length > 0 || !sourceReadiness || !scenarioRecord) {
    return {
      scenario_id: manifest.scenario_id,
      can_promote_to_golden: false,
      eligible_for_golden: false,
      blockers,
    };
  }
  const gateResult = evaluateM3Scenario(scenarioRecord, sourceReadiness);
  return {
    scenario_id: manifest.scenario_id,
    can_promote_to_golden: gateResult.can_promote_to_golden,
    eligible_for_golden: gateResult.eligible_for_golden,
    gate_result: gateResult,
    blockers:
      gateResult.blockers.length > 0
        ? [
            blocker(
              manifest.scenario_id,
              "source_not_ready",
              "The existing M3 promotion gate reported blockers; inspect gate_result.blockers.",
            ),
          ]
        : [],
  };
}

export const evaluateM3ExperimentPromotionGate =
  composeM3ExperimentPromotionGate;
