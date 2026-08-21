import {
  canonicalSha256,
  deepFreeze,
  isValidIsoDateTime,
  verifyCanonicalHash,
} from "./canonical.js";
import {
  isM4SourceId,
  M4_COHORT_SOURCE_IDS,
  type M4SourceId,
} from "./cohort.js";
import {
  type AccessObservation,
  type CaptureMethod,
  type DiffArtifact,
  type DiffClassification,
  type DirectCheckState,
  evaluateDirectCheck,
  type MaterialityArtifact,
  type RehearsalCheck,
  type RehearsalCheckInput,
  type SnapshotArtifact,
  type TechnicalClassification,
  type TermsReviewStatus,
  verifyDiffArtifact,
  verifyMaterialityArtifact,
  verifySnapshotArtifact,
} from "./direct-check.js";

export type EvaluationLane = "direct" | "semantic" | "independent_sentinel";
export type LaneInput = EvaluationLane | "lane_a" | "lane_b" | "sentinel";

export function normalizeLane(lane: LaneInput): EvaluationLane {
  if (lane === "lane_a") return "direct";
  if (lane === "lane_b") return "semantic";
  if (lane === "sentinel") return "independent_sentinel";
  return lane;
}

export type WinnerImpact = "changed" | "unchanged" | "unknown";

export interface GroundTruthEventInput {
  readonly event_id: string;
  readonly source_id: string;
  readonly occurred_at: string;
  readonly confirmed_at: string;
  readonly materiality: "material";
  readonly official_primary_source_hit: boolean | null;
  readonly winner_impact: WinnerImpact;
  readonly review_minutes: number | null;
  readonly synthetic?: boolean;
  readonly canonical_evidence_ids?: readonly string[];
}

export interface GroundTruthEvent extends GroundTruthEventInput {
  readonly record_type: "ground_truth_event";
  readonly canonical_evidence_ids: readonly string[];
  readonly record_hash: string;
}

export type DetectionClassification =
  | "material"
  | "non_material"
  | "security"
  | "unknown";
export type DuplicateKind = "transport" | "semantic";

export interface LaneDetectionInput {
  readonly detection_id: string;
  readonly lane: LaneInput;
  readonly source_id: string;
  readonly detected_at: string | null;
  readonly ground_truth_event_id: string | null;
  readonly classification: DetectionClassification;
  readonly official_primary_source_hit: boolean | null;
  readonly useful_finding: boolean | null;
  readonly review_minutes: number | null;
  readonly model_cost: number | null;
  readonly duplicate_kind?: DuplicateKind;
  readonly duplicate_of_detection_id?: string;
  readonly synthetic?: boolean;
  readonly canonical_evidence_ids?: readonly string[];
}

export interface LaneDetection extends LaneDetectionInput {
  readonly record_type: "lane_detection";
  readonly lane: LaneInput;
  readonly canonical_evidence_ids: readonly string[];
  readonly record_hash: string;
}

export type RunStatus =
  | "completed"
  | "partial"
  | "failed"
  | "cancelled"
  | "absent";

export interface RunLedgerInput {
  readonly run_id: string;
  readonly lane: "semantic" | "independent_sentinel" | "lane_b" | "sentinel";
  readonly started_at: string | null;
  readonly completed_at: string | null;
  readonly status: RunStatus;
  readonly expected_scope: readonly string[];
  readonly actual_scope: readonly string[];
  readonly finding_count: number | null;
  readonly useful_finding_count: number | null;
  readonly model_cost: number | null;
  readonly review_minutes: number | null;
  readonly synthetic?: boolean;
}

export interface RunLedger extends RunLedgerInput {
  readonly record_type: "run_ledger";
  readonly lane: "semantic" | "independent_sentinel" | "lane_b" | "sentinel";
  readonly record_hash: string;
}

export type EvaluationRecord =
  | GroundTruthEvent
  | LaneDetection
  | RunLedger
  | RehearsalCheck;

export interface EvaluationLedger {
  readonly records: readonly EvaluationRecord[];
  readonly ledger_hash: string;
}

function hashRecord<T extends Record<string, unknown>>(record: T): string {
  const copy = { ...record };
  delete copy.record_hash;
  return canonicalSha256(copy as Parameters<typeof canonicalSha256>[0]);
}

function canonicalEvidenceFor(input: {
  readonly canonical_evidence_ids?: readonly string[];
  readonly synthetic?: boolean;
}): readonly string[] {
  const values = input.canonical_evidence_ids ?? [];
  if (input.synthetic === true && values.length > 0) {
    throw new Error(
      "Synthetic evaluation records cannot contain canonical evidence.",
    );
  }
  return [...values];
}

function assertSourceId(sourceId: string, label: string): void {
  if (!isM4SourceId(sourceId)) {
    throw new Error(`${label} has unknown source ${sourceId}`);
  }
}

function assertRunScopes(input: RunLedgerInput): void {
  if (
    input.expected_scope.length !== M4_COHORT_SOURCE_IDS.length ||
    input.expected_scope.some(
      (sourceId, index) => sourceId !== M4_COHORT_SOURCE_IDS[index],
    )
  ) {
    throw new Error(
      `run ${input.run_id} expected_scope must match the exact ordered M4 cohort`,
    );
  }
  if (
    new Set(input.actual_scope).size !== input.actual_scope.length ||
    input.actual_scope.some((sourceId) => !isM4SourceId(sourceId))
  ) {
    throw new Error(
      `run ${input.run_id} actual_scope contains an invalid source`,
    );
  }
  if (
    input.status === "completed" &&
    (input.actual_scope.length !== M4_COHORT_SOURCE_IDS.length ||
      input.actual_scope.some(
        (sourceId, index) => sourceId !== M4_COHORT_SOURCE_IDS[index],
      ))
  ) {
    throw new Error(
      `run ${input.run_id} completed actual_scope must match the exact ordered M4 cohort`,
    );
  }
}

export function createGroundTruthEvent(
  input: GroundTruthEventInput,
): GroundTruthEvent {
  assertSourceId(input.source_id, `ground_truth_event ${input.event_id}`);
  const payload = {
    ...input,
    record_type: "ground_truth_event" as const,
    canonical_evidence_ids: canonicalEvidenceFor(input),
  };
  return deepFreeze({ ...payload, record_hash: hashRecord(payload) });
}

export function createLaneDetection(input: LaneDetectionInput): LaneDetection {
  assertSourceId(input.source_id, `lane_detection ${input.detection_id}`);
  const payload = {
    ...input,
    lane: input.lane,
    record_type: "lane_detection" as const,
    canonical_evidence_ids: canonicalEvidenceFor(input),
  };
  return deepFreeze({ ...payload, record_hash: hashRecord(payload) });
}

export function createRunLedger(input: RunLedgerInput): RunLedger {
  assertRunScopes(input);
  const payload = { ...input, record_type: "run_ledger" as const };
  return deepFreeze({ ...payload, record_hash: hashRecord(payload) });
}

const CAPTURE_METHODS = new Set<CaptureMethod>([
  "manual_capture",
  "rendered_capture",
  "official_api",
  "partner_feed",
  "automated_http",
  "none",
]);
const TECHNICAL_CLASSIFICATIONS = new Set<TechnicalClassification>([
  "unknown",
  "plain_http_observed_reachable",
  "rendered_capture_only",
  "manual_only",
  "official_api_available",
  "partner_feed_available",
  "not_reachable",
]);
const TERMS_REVIEW_STATUSES = new Set<TermsReviewStatus>([
  "not_reviewed",
  "unknown",
  "approved",
  "not_applicable",
  "denied",
]);
const DIRECT_CHECK_STATES = new Set<DirectCheckState>([
  "planned",
  "blocked_permission",
  "blocked_technical",
  "blocked_observation",
  "ready_for_capture",
  "capture_failed",
  "captured",
  "unchanged",
  "material_review",
  "security_review",
]);
const DIFF_CLASSIFICATIONS = new Set<DiffClassification>([
  "unchanged",
  "cosmetic",
  "non_material_copy",
  "potential_material_rule_change",
  "removal_or_relocation",
  "inaccessible",
  "security_anomaly",
]);
const MATERIALITIES = new Set([
  "unchanged",
  "non_material",
  "material",
  "security",
]);
const DETECTION_CLASSIFICATIONS = new Set([
  "material",
  "non_material",
  "security",
  "unknown",
]);
const RUN_STATUSES = new Set([
  "completed",
  "partial",
  "failed",
  "cancelled",
  "absent",
]);
const RUN_LANES = new Set([
  "semantic",
  "independent_sentinel",
  "lane_b",
  "sentinel",
]);
const EVALUATION_LANES = new Set([
  "direct",
  "semantic",
  "independent_sentinel",
  "lane_a",
  "lane_b",
  "sentinel",
]);
const BLOCKER_CODES = new Set([
  "source_not_in_cohort",
  "cohort_drift",
  "terms_not_approved",
  "technical_feasibility_unknown",
  "observation_missing",
  "aggregate_observation_only",
  "observation_source_mismatch",
  "observation_not_reachable",
  "observation_timestamp_invalid",
  "observation_method_mismatch",
  "permission_not_asserted",
  "collection_path_not_permitted",
  "technical_classification_not_ready",
  "check_timestamp_invalid",
  "snapshot_timestamp_invalid",
  "previous_snapshot_timestamp_invalid",
  "snapshot_method_mismatch",
  "snapshot_source_mismatch",
  "snapshot_hash_invalid",
  "previous_snapshot_source_mismatch",
  "previous_snapshot_hash_invalid",
  "diff_source_mismatch",
  "diff_hash_invalid",
  "diff_snapshot_link_mismatch",
  "materiality_source_mismatch",
  "materiality_hash_invalid",
  "materiality_diff_mismatch",
]);

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function validId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function validNullableId(value: unknown): value is string | null {
  return value === null || validId(value);
}

function validOptionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === "boolean";
}

function validBooleanOrNull(value: unknown): value is boolean | null {
  return value === null || typeof value === "boolean";
}

function validNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function validNullableNonNegativeNumber(value: unknown): boolean {
  return value === null || validNonNegativeNumber(value);
}

function validNonNegativeInteger(value: unknown): value is number {
  return validNonNegativeNumber(value) && Number.isInteger(value);
}

function validNullableNonNegativeInteger(value: unknown): boolean {
  return value === null || validNonNegativeInteger(value);
}

function validArrayOfStrings(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => validId(item));
}

function validNullableDate(value: unknown): value is string | null {
  return value === null || isValidIsoDateTime(value);
}

function validDateOrdering(start: string | null, end: string | null): boolean {
  return start !== null && end !== null && Date.parse(end) >= Date.parse(start);
}

function validCanonicalEvidence(record: UnknownRecord): boolean {
  const evidence = record.canonical_evidence_ids;
  if (
    !validArrayOfStrings(evidence) ||
    !validOptionalBoolean(record.synthetic)
  ) {
    return false;
  }
  return record.synthetic !== true || evidence.length === 0;
}

function validSnapshot(value: unknown): value is SnapshotArtifact {
  const snapshot = asRecord(value);
  if (!snapshot) return false;
  return (
    snapshot.artifact_type === "snapshot" &&
    validId(snapshot.snapshot_id) &&
    isM4SourceId(snapshot.source_id as string) &&
    isValidIsoDateTime(snapshot.captured_at) &&
    CAPTURE_METHODS.has(snapshot.capture_method as CaptureMethod) &&
    (snapshot.representation_kind === "test_fixture" ||
      snapshot.representation_kind === "permitted_capture") &&
    validId(snapshot.representation_digest) &&
    (snapshot.completeness === "complete" ||
      snapshot.completeness === "partial" ||
      snapshot.completeness === "failed") &&
    snapshot.canonical_evidence_eligible === false &&
    verifySnapshotArtifact(snapshot as unknown as SnapshotArtifact)
  );
}

function validDiff(value: unknown): value is DiffArtifact {
  const diff = asRecord(value);
  if (!diff) return false;
  return (
    diff.artifact_type === "diff" &&
    validId(diff.diff_id) &&
    isM4SourceId(diff.source_id as string) &&
    validNullableId(diff.before_snapshot_id) &&
    validNullableId(diff.after_snapshot_id) &&
    typeof diff.changed === "boolean" &&
    DIFF_CLASSIFICATIONS.has(diff.classification as DiffClassification) &&
    verifyDiffArtifact(diff as unknown as DiffArtifact)
  );
}

function validMateriality(value: unknown): value is MaterialityArtifact {
  const materiality = asRecord(value);
  if (!materiality) return false;
  return (
    materiality.artifact_type === "materiality" &&
    validId(materiality.materiality_id) &&
    isM4SourceId(materiality.source_id as string) &&
    validId(materiality.diff_id) &&
    MATERIALITIES.has(materiality.materiality as string) &&
    typeof materiality.review_required === "boolean" &&
    validArrayOfStrings(materiality.impact_tags) &&
    verifyMaterialityArtifact(materiality as unknown as MaterialityArtifact)
  );
}

function validObservation(
  value: unknown,
  sourceId: string,
  checkedAt: string,
): value is AccessObservation {
  const observation = asRecord(value);
  if (!observation) return false;
  if (
    !validId(observation.observation_id) ||
    !isM4SourceId(observation.source_id as string) ||
    observation.source_id !== sourceId ||
    !isValidIsoDateTime(observation.observed_at) ||
    Date.parse(observation.observed_at as string) > Date.parse(checkedAt) ||
    !CAPTURE_METHODS.has(observation.method as CaptureMethod) ||
    (observation.scope !== "per_source" && observation.scope !== "aggregate") ||
    (observation.result !== "reachable" &&
      observation.result !== "blocked" &&
      observation.result !== "unknown") ||
    typeof observation.permission_asserted !== "boolean" ||
    (observation.representation_kind !== "test_fixture" &&
      observation.representation_kind !== "permitted_capture")
  ) {
    return false;
  }
  return (
    observation.observation_hash === undefined ||
    typeof observation.observation_hash === "string"
  );
}

function validPermission(
  value: unknown,
  sourceId: string,
  checkedAt: string,
): boolean {
  const permission = asRecord(value);
  if (!permission) return false;
  if (
    !TERMS_REVIEW_STATUSES.has(
      permission.terms_review_status as TermsReviewStatus,
    ) ||
    !TECHNICAL_CLASSIFICATIONS.has(
      permission.technical_classification as TechnicalClassification,
    ) ||
    !validOptionalBoolean(permission.rendered_capture_allowed)
  ) {
    return false;
  }
  return (
    permission.observation === undefined ||
    validObservation(permission.observation, sourceId, checkedAt)
  );
}

function validRehearsalCheck(value: unknown): value is RehearsalCheck {
  const check = asRecord(value);
  if (!check) return false;
  if (
    check.record_type !== "rehearsal_check" ||
    !validId(check.check_id) ||
    !isM4SourceId(check.source_id as string) ||
    !isValidIsoDateTime(check.checked_at) ||
    (check.planned_method !== undefined &&
      !CAPTURE_METHODS.has(check.planned_method as CaptureMethod)) ||
    !validPermission(
      check.permission,
      check.source_id as string,
      check.checked_at as string,
    ) ||
    !validOptionalBoolean(check.capture_failed) ||
    (check.failure_reason !== undefined &&
      typeof check.failure_reason !== "string") ||
    !validNullableNonNegativeNumber(check.human_minutes) ||
    !validOptionalBoolean(check.synthetic) ||
    !validCanonicalEvidence(check) ||
    !Array.isArray(check.blockers) ||
    !check.blockers.every((item) => {
      const blocker = asRecord(item);
      return (
        blocker !== null &&
        BLOCKER_CODES.has(blocker.code as string) &&
        typeof blocker.detail === "string"
      );
    }) ||
    !Array.isArray(check.transitions) ||
    !check.transitions.every((state) =>
      DIRECT_CHECK_STATES.has(state as DirectCheckState),
    ) ||
    check.transitions.length === 0 ||
    check.transitions[0] !== "planned" ||
    check.transitions[check.transitions.length - 1] !== check.state ||
    !DIRECT_CHECK_STATES.has(check.state as DirectCheckState)
  ) {
    return false;
  }

  const previousSnapshot = check.previous_snapshot;
  const snapshot = check.snapshot;
  const diff = check.diff;
  const materiality = check.materiality;
  if (
    (previousSnapshot !== undefined &&
      (!validSnapshot(previousSnapshot) ||
        (previousSnapshot as SnapshotArtifact).source_id !==
          check.source_id)) ||
    (snapshot !== undefined &&
      (!validSnapshot(snapshot) ||
        (snapshot as SnapshotArtifact).source_id !== check.source_id)) ||
    (diff !== undefined &&
      (!validDiff(diff) ||
        (diff as DiffArtifact).source_id !== check.source_id)) ||
    (materiality !== undefined &&
      (!validMateriality(materiality) ||
        (materiality as MaterialityArtifact).source_id !== check.source_id))
  ) {
    return false;
  }
  if (snapshot !== undefined) {
    const snapshotValue = snapshot as SnapshotArtifact;
    if (
      Date.parse(snapshotValue.captured_at) >
      Date.parse(check.checked_at as string)
    ) {
      return false;
    }
    if (
      previousSnapshot !== undefined &&
      Date.parse((previousSnapshot as SnapshotArtifact).captured_at) >
        Date.parse(snapshotValue.captured_at)
    ) {
      return false;
    }
  }
  if (diff !== undefined) {
    const diffValue = diff as DiffArtifact;
    if (
      snapshot === undefined ||
      diffValue.after_snapshot_id !==
        (snapshot as SnapshotArtifact).snapshot_id ||
      (previousSnapshot === undefined
        ? diffValue.before_snapshot_id !== null
        : diffValue.before_snapshot_id !==
          (previousSnapshot as SnapshotArtifact).snapshot_id)
    ) {
      return false;
    }
  }
  if (
    materiality !== undefined &&
    (diff === undefined ||
      (materiality as MaterialityArtifact).diff_id !==
        (diff as DiffArtifact).diff_id)
  ) {
    return false;
  }

  const input: RehearsalCheckInput = {
    check_id: check.check_id as string,
    source_id: check.source_id as string,
    checked_at: check.checked_at as string,
    permission: check.permission as RehearsalCheckInput["permission"],
    ...(check.planned_method === undefined
      ? {}
      : { planned_method: check.planned_method as CaptureMethod }),
    ...(snapshot === undefined
      ? {}
      : { snapshot: snapshot as SnapshotArtifact }),
    ...(previousSnapshot === undefined
      ? {}
      : { previous_snapshot: previousSnapshot as SnapshotArtifact }),
    ...(diff === undefined ? {} : { diff: diff as DiffArtifact }),
    ...(materiality === undefined
      ? {}
      : { materiality: materiality as MaterialityArtifact }),
    ...(check.capture_failed === undefined
      ? {}
      : { capture_failed: check.capture_failed as boolean }),
    ...(check.failure_reason === undefined
      ? {}
      : { failure_reason: check.failure_reason as string }),
    ...(check.human_minutes === undefined
      ? {}
      : { human_minutes: check.human_minutes as number | null }),
    ...(check.synthetic === undefined
      ? {}
      : { synthetic: check.synthetic as boolean }),
  };
  const expected = evaluateDirectCheck(input);
  const expectedBlockers = canonicalSha256(
    expected.blockers as unknown as Parameters<typeof canonicalSha256>[0],
  );
  const actualBlockers = canonicalSha256(
    check.blockers as unknown as Parameters<typeof canonicalSha256>[0],
  );
  const expectedTransitions = canonicalSha256(
    expected.transitions as unknown as Parameters<typeof canonicalSha256>[0],
  );
  const actualTransitions = canonicalSha256(
    check.transitions as unknown as Parameters<typeof canonicalSha256>[0],
  );
  return (
    check.state === expected.state &&
    expectedBlockers === actualBlockers &&
    expectedTransitions === actualTransitions &&
    verifyCanonicalHash(check, "record_hash")
  );
}

function validGroundTruthEvent(value: unknown): value is GroundTruthEvent {
  const event = asRecord(value);
  if (!event) return false;
  return (
    event.record_type === "ground_truth_event" &&
    validId(event.event_id) &&
    isM4SourceId(event.source_id as string) &&
    isValidIsoDateTime(event.occurred_at) &&
    isValidIsoDateTime(event.confirmed_at) &&
    Date.parse(event.confirmed_at as string) >=
      Date.parse(event.occurred_at as string) &&
    event.materiality === "material" &&
    validBooleanOrNull(event.official_primary_source_hit) &&
    (event.winner_impact === "changed" ||
      event.winner_impact === "unchanged" ||
      event.winner_impact === "unknown") &&
    validNullableNonNegativeNumber(event.review_minutes) &&
    validCanonicalEvidence(event) &&
    verifyCanonicalHash(event, "record_hash")
  );
}

function validLaneDetection(value: unknown): value is LaneDetection {
  const detection = asRecord(value);
  if (!detection) return false;
  if (
    detection.record_type !== "lane_detection" ||
    !validId(detection.detection_id) ||
    !EVALUATION_LANES.has(detection.lane as string) ||
    !isM4SourceId(detection.source_id as string) ||
    !validNullableDate(detection.detected_at) ||
    !validNullableId(detection.ground_truth_event_id) ||
    !DETECTION_CLASSIFICATIONS.has(detection.classification as string) ||
    !validBooleanOrNull(detection.official_primary_source_hit) ||
    !validBooleanOrNull(detection.useful_finding) ||
    !validNullableNonNegativeNumber(detection.review_minutes) ||
    !validNullableNonNegativeNumber(detection.model_cost) ||
    !validOptionalBoolean(detection.synthetic) ||
    !validCanonicalEvidence(detection) ||
    (detection.duplicate_kind !== undefined &&
      detection.duplicate_kind !== "transport" &&
      detection.duplicate_kind !== "semantic") ||
    (detection.duplicate_of_detection_id !== undefined &&
      !validId(detection.duplicate_of_detection_id)) ||
    (detection.duplicate_kind === undefined &&
      detection.duplicate_of_detection_id !== undefined)
  ) {
    return false;
  }
  return verifyCanonicalHash(detection, "record_hash");
}

function validRunScope(
  value: unknown,
  requireExact: boolean,
): value is readonly string[] {
  if (!validArrayOfStrings(value)) return false;
  if (new Set(value).size !== value.length) return false;
  if (value.some((sourceId) => !isM4SourceId(sourceId))) return false;
  return (
    !requireExact ||
    (value.length === M4_COHORT_SOURCE_IDS.length &&
      value.every(
        (sourceId, index) => sourceId === M4_COHORT_SOURCE_IDS[index],
      ))
  );
}

function validRunLedger(value: unknown): value is RunLedger {
  const run = asRecord(value);
  if (!run) return false;
  if (
    run.record_type !== "run_ledger" ||
    !validId(run.run_id) ||
    !RUN_LANES.has(run.lane as string) ||
    !validNullableDate(run.started_at) ||
    !validNullableDate(run.completed_at) ||
    !RUN_STATUSES.has(run.status as string) ||
    !validArrayOfStrings(run.expected_scope) ||
    !validArrayOfStrings(run.actual_scope) ||
    !validNullableNonNegativeInteger(run.finding_count) ||
    !validNullableNonNegativeInteger(run.useful_finding_count) ||
    !validNullableNonNegativeNumber(run.model_cost) ||
    !validNullableNonNegativeNumber(run.review_minutes) ||
    !validOptionalBoolean(run.synthetic) ||
    !validRunScope(run.expected_scope, true) ||
    !validRunScope(run.actual_scope, run.status === "completed")
  ) {
    return false;
  }
  const status = run.status as RunStatus;
  const startedAt = run.started_at as string | null;
  const completedAt = run.completed_at as string | null;
  if (status === "absent" && (startedAt !== null || completedAt !== null)) {
    return false;
  }
  if (status !== "absent" && startedAt === null) return false;
  if (completedAt !== null && startedAt === null) return false;
  if (completedAt !== null && !validDateOrdering(startedAt, completedAt)) {
    return false;
  }
  if (status === "completed" && completedAt === null) return false;
  return verifyCanonicalHash(run, "record_hash");
}

function validEvaluationRecord(record: unknown): record is EvaluationRecord {
  const recordType = asRecord(record)?.record_type;
  if (recordType === "rehearsal_check") return validRehearsalCheck(record);
  if (recordType === "ground_truth_event") return validGroundTruthEvent(record);
  if (recordType === "lane_detection") return validLaneDetection(record);
  if (recordType === "run_ledger") return validRunLedger(record);
  return false;
}

export function verifyEvaluationRecord(record: EvaluationRecord): boolean {
  try {
    return validEvaluationRecord(record);
  } catch {
    return false;
  }
}

function recordId(record: unknown): string {
  const value = asRecord(record);
  if (!value) return "unknown";
  if (value.record_type === "ground_truth_event" && validId(value.event_id)) {
    return value.event_id;
  }
  if (value.record_type === "lane_detection" && validId(value.detection_id)) {
    return value.detection_id;
  }
  if (value.record_type === "run_ledger" && validId(value.run_id)) {
    return value.run_id;
  }
  if (value.record_type === "rehearsal_check" && validId(value.check_id)) {
    return value.check_id;
  }
  return "unknown";
}

function ledgerHash(records: readonly EvaluationRecord[]): string {
  return canonicalSha256(
    records as unknown as Parameters<typeof canonicalSha256>[0],
  );
}

export function createEvaluationLedger(
  records: readonly EvaluationRecord[] = [],
): EvaluationLedger {
  const seen = new Set<string>();
  for (const record of records) {
    const id = recordId(record);
    if (seen.has(id)) throw new Error(`Duplicate evaluation record ID: ${id}`);
    if (!verifyEvaluationRecord(record))
      throw new Error(`Invalid immutable evaluation record: ${id}`);
    seen.add(id);
  }
  return deepFreeze({
    records: [...records],
    ledger_hash: ledgerHash(records),
  });
}

/** Return a new ledger; the input ledger and every prior record remain intact. */
export function appendEvaluationRecord(
  ledger: EvaluationLedger,
  record: EvaluationRecord,
): EvaluationLedger {
  if (!verifyEvaluationRecord(record)) {
    throw new Error(`Invalid immutable evaluation record: ${recordId(record)}`);
  }
  if (
    ledger.records.some((existing) => recordId(existing) === recordId(record))
  ) {
    throw new Error(`Duplicate evaluation record ID: ${recordId(record)}`);
  }
  return createEvaluationLedger([...ledger.records, record]);
}

export function assertNoCanonicalEvidence(
  records: readonly EvaluationRecord[],
): void {
  for (const record of records) {
    if (
      record.synthetic === true &&
      (record.record_type === "ground_truth_event" ||
        record.record_type === "lane_detection") &&
      record.canonical_evidence_ids.length > 0
    ) {
      throw new Error(
        `Canonical evidence is not permitted in synthetic rehearsal records: ${recordId(record)}`,
      );
    }
  }
}

export type { M4SourceId };
