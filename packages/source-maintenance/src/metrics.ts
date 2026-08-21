import {
  canonicalSha256,
  deepFreeze,
  isValidIsoDateTime,
} from "./canonical.js";
import {
  assertM4Cohort,
  isM4SourceId,
  M4_COHORT_MANIFEST,
  M4_COHORT_SOURCE_IDS,
  M4_PLANNED_WINDOW_DAYS,
  type M4CohortManifest,
} from "./cohort.js";
import type { RehearsalCheck } from "./direct-check.js";
import {
  type EvaluationLane,
  type GroundTruthEvent,
  type LaneDetection,
  normalizeLane,
  type RunLedger,
  verifyEvaluationRecord,
} from "./ledger.js";

export interface M4Window {
  readonly planned_window_days: number;
  readonly observed_window_days: number;
  readonly window_start: string;
  readonly window_end: string | null;
  readonly status: "partial" | "complete";
  readonly source_coverage_days: Readonly<Partial<Record<string, number>>>;
  readonly expected_run_counts?: Readonly<
    Partial<Record<"semantic" | "independent_sentinel", number>>
  >;
}

export interface M4RehearsalInput {
  readonly cohort?: M4CohortManifest | readonly string[];
  readonly window: M4Window;
  readonly checks: readonly RehearsalCheck[];
  readonly ground_truth_events: readonly GroundTruthEvent[];
  readonly lane_detections: readonly LaneDetection[];
  readonly run_ledger: readonly RunLedger[];
}

export interface MetricRate {
  readonly numerator: number;
  readonly denominator: number;
  readonly value: number | null;
  readonly unknown_count: number;
}

export interface LaneMetrics {
  readonly confirmed_change_recall: number | null;
  readonly confirmed_change_recall_numerator: number;
  readonly confirmed_change_recall_denominator: number;
  readonly false_positive_count: number;
  readonly detection_count: number;
  readonly transport_duplicate_count: number;
  readonly semantic_duplicate_count: number;
  readonly median_detection_delay_hours: number | null;
  readonly maximum_detection_delay_hours: number | null;
  readonly detection_delay_known_count: number;
  readonly detection_delay_unknown_count: number;
  readonly official_primary_source_hit_rate: number | null;
  readonly official_primary_source_hit_numerator: number;
  readonly official_primary_source_hit_denominator: number;
  readonly official_primary_source_hit_unknown_count: number;
  readonly human_minutes_per_unchanged_check: number | null;
  readonly unchanged_check_minutes_numerator: number;
  readonly unchanged_check_minutes_denominator: number;
  readonly human_minutes_per_confirmed_change: number | null;
  readonly confirmed_change_minutes_numerator: number;
  readonly confirmed_change_minutes_denominator: number;
  readonly direct_acquisition_failure_rate: number | null;
  readonly direct_acquisition_failure_numerator: number;
  readonly direct_acquisition_failure_denominator: number;
  readonly manual_capture_share: number | null;
  readonly manual_capture_numerator: number;
  readonly manual_capture_denominator: number;
  readonly partial_run_rate: number | null;
  readonly failed_run_rate: number | null;
  readonly cancelled_run_rate: number | null;
  readonly absent_run_rate: number | null;
  readonly completed_zero_finding_run_rate: number | null;
  readonly run_count: number;
  readonly run_status_counts: Readonly<Record<RunLedger["status"], number>>;
  readonly model_cost_per_useful_finding: number | null;
  readonly model_cost_known_total: number | null;
  readonly useful_finding_count: number;
  readonly unknown_model_cost_run_count: number;
  readonly changed_winner_rate: number | null;
}

export interface M4Coverage {
  readonly planned_window_days: number;
  readonly observed_window_days: number;
  readonly complete: boolean;
  readonly reasons: readonly string[];
  readonly missing_source_ids: readonly string[];
  readonly run_reconciliation: Readonly<
    Record<
      "semantic" | "independent_sentinel",
      {
        readonly expected: number;
        readonly recorded: number;
        readonly delta: number;
        readonly reconciled: boolean;
      }
    >
  >;
  readonly incomplete_run_count: number;
}

export interface WeeklyMaintenanceBucket {
  readonly bucket_start: string;
  readonly bucket_end: string;
  readonly check_count: number;
  readonly unknown_minutes_count: number;
  readonly human_minutes: number | null;
  readonly hours: number | null;
  readonly complete: boolean;
  readonly excluded: boolean;
  readonly exclusion_reason: string | null;
}

export interface WeeklyMaintenanceSummary {
  readonly buckets: readonly WeeklyMaintenanceBucket[];
  readonly complete_week_count: number;
  readonly median_weekly_hours: number | null;
  readonly trailing_bucket_excluded: boolean;
}

export type M4DecisionStatus = "insufficient_data" | "green" | "amber" | "red";
export const M4_REQUIRED_COMPLETE_WEEKS = 4 as const;

export interface M4Decision {
  readonly status: M4DecisionStatus;
  readonly rationale: readonly string[];
  readonly informational_rationale: readonly string[];
  readonly threshold_rationale: readonly string[];
  readonly threshold_applied: boolean;
  readonly maintenance_hours_per_week: number | null;
  readonly weekly_maintenance_hours: readonly number[];
  readonly median_weekly_maintenance_hours: number | null;
  readonly complete_week_count: number;
  readonly synthetic_only: boolean;
}

export interface M4Metrics {
  readonly input_hash: string;
  readonly cohort_hash: string;
  readonly coverage: M4Coverage;
  readonly confirmed_material_event_count: number;
  readonly by_lane: Readonly<
    Record<"direct" | "semantic" | "independent_sentinel", LaneMetrics>
  >;
  readonly independent_sentinel_misses: readonly string[];
  readonly independent_sentinel_miss_count: number;
  readonly changed_winner_rate: number | null;
  readonly changed_winner_numerator: number;
  readonly changed_winner_denominator: number;
  readonly duplicate_observation_count: number;
  readonly weekly_maintenance: WeeklyMaintenanceSummary;
  readonly decision: M4Decision;
}

const ZERO_RUN_STATUS_COUNTS: Readonly<Record<RunLedger["status"], number>> = {
  completed: 0,
  partial: 0,
  failed: 0,
  cancelled: 0,
  absent: 0,
};

function rate(
  numerator: number,
  denominator: number,
  unknown_count = 0,
): MetricRate {
  return {
    numerator,
    denominator,
    value: denominator === 0 ? null : numerator / denominator,
    unknown_count,
  };
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? null);
}

function hoursBetween(start: string, end: string): number | null {
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs)
    return null;
  return (endMs - startMs) / 3_600_000;
}

function weeklyMaintenanceFor(
  input: M4RehearsalInput,
): WeeklyMaintenanceSummary {
  const startMs = Date.parse(input.window.window_start);
  const endMs = input.window.window_end
    ? Date.parse(input.window.window_end)
    : Number.NaN;
  if (!Number.isFinite(startMs)) {
    return {
      buckets: [],
      complete_week_count: 0,
      median_weekly_hours: null,
      trailing_bucket_excluded: false,
    };
  }
  const plannedEndMs =
    startMs + input.window.planned_window_days * 24 * 3_600_000;
  const observedEndMs = Number.isFinite(endMs)
    ? Math.min(endMs, plannedEndMs)
    : startMs;
  const bucketCount = Math.ceil(input.window.planned_window_days / 7);
  const buckets: WeeklyMaintenanceBucket[] = [];
  for (let index = 0; index < bucketCount; index += 1) {
    const bucketStartMs = startMs + index * 7 * 24 * 3_600_000;
    const bucketEndMs = Math.min(
      startMs + (index + 1) * 7 * 24 * 3_600_000,
      plannedEndMs,
    );
    const fullBucket = bucketEndMs - bucketStartMs === 7 * 24 * 3_600_000;
    const observedFullBucket = observedEndMs >= bucketEndMs;
    const checks = input.checks.filter((check) => {
      const checkedMs = Date.parse(check.checked_at);
      return (
        Number.isFinite(checkedMs) &&
        checkedMs >= bucketStartMs &&
        checkedMs < bucketEndMs &&
        checkedMs < observedEndMs
      );
    });
    const unknownMinutes = checks.filter(
      (check) =>
        check.human_minutes === null || check.human_minutes === undefined,
    ).length;
    const minutes = checks.reduce(
      (sum, check) =>
        check.human_minutes === null || check.human_minutes === undefined
          ? sum
          : sum + check.human_minutes,
      0,
    );
    const trailing = !fullBucket || !observedFullBucket;
    const exclusionReason = trailing
      ? "incomplete trailing bucket"
      : checks.length === 0
        ? "no checks recorded"
        : unknownMinutes > 0
          ? "one or more check minutes are unknown"
          : null;
    const complete = !trailing && checks.length > 0 && unknownMinutes === 0;
    buckets.push({
      bucket_start: new Date(bucketStartMs).toISOString(),
      bucket_end: new Date(bucketEndMs).toISOString(),
      check_count: checks.length,
      unknown_minutes_count: unknownMinutes,
      human_minutes: complete ? minutes : null,
      hours: complete ? minutes / 60 : null,
      complete,
      excluded: !complete,
      exclusion_reason: exclusionReason,
    });
  }
  const completeHours = buckets
    .filter((bucket) => bucket.complete && bucket.hours !== null)
    .map((bucket) => bucket.hours as number);
  return {
    buckets,
    complete_week_count: completeHours.length,
    median_weekly_hours: median(completeHours),
    trailing_bucket_excluded: buckets.some(
      (bucket) => bucket.exclusion_reason === "incomplete trailing bucket",
    ),
  };
}

function duplicateIds(input: M4RehearsalInput): string | null {
  const records: readonly { id: string }[] = [
    ...input.ground_truth_events.map((event) => ({
      id: event.event_id,
    })),
    ...input.lane_detections.map((detection) => ({
      id: detection.detection_id,
    })),
    ...input.run_ledger.map((run) => ({ id: run.run_id })),
    ...input.checks.map((check) => ({ id: check.check_id })),
  ];
  const seen = new Set<string>();
  for (const record of records) {
    if (seen.has(record.id)) return record.id;
    seen.add(record.id);
  }
  return null;
}

function scopeIssues(
  scope: readonly string[],
  label: string,
  requireExact: boolean,
): string[] {
  if (!Array.isArray(scope)) return [`${label} is not an array`];
  const issues: string[] = [];
  if (new Set(scope).size !== scope.length) {
    issues.push(`${label} contains duplicate source IDs`);
  }
  for (const sourceId of scope) {
    if (!isM4SourceId(sourceId))
      issues.push(`${label} contains unknown source ${sourceId}`);
  }
  if (
    requireExact &&
    (scope.length !== M4_COHORT_SOURCE_IDS.length ||
      scope.some((sourceId, index) => sourceId !== M4_COHORT_SOURCE_IDS[index]))
  ) {
    issues.push(`${label} must match the exact ordered M4 cohort`);
  }
  return issues;
}

function validateWindowInput(input: M4RehearsalInput): void {
  const window = input.window as unknown as Record<string, unknown>;
  if (
    window === null ||
    typeof window !== "object" ||
    Array.isArray(window) ||
    !Number.isInteger(window.planned_window_days) ||
    !Number.isFinite(window.planned_window_days) ||
    (window.planned_window_days as number) < 0 ||
    !Number.isInteger(window.observed_window_days) ||
    !Number.isFinite(window.observed_window_days) ||
    (window.observed_window_days as number) < 0 ||
    !isValidIsoDateTime(window.window_start) ||
    (window.window_end !== null && !isValidIsoDateTime(window.window_end)) ||
    (window.window_end !== null &&
      Date.parse(window.window_end as string) <
        Date.parse(window.window_start as string)) ||
    (window.status !== "partial" && window.status !== "complete")
  ) {
    throw new Error(
      "Invalid M4 observation window shape or timestamp ordering",
    );
  }
  const coverage = window.source_coverage_days;
  if (
    coverage !== undefined &&
    coverage !== null &&
    (typeof coverage !== "object" || Array.isArray(coverage))
  ) {
    return;
  }
  if (coverage && typeof coverage === "object" && !Array.isArray(coverage)) {
    const unknownKeys = Object.keys(coverage).filter(
      (sourceId) => !isM4SourceId(sourceId),
    );
    if (unknownKeys.length > 0) {
      throw new Error(
        `Invalid M4 source coverage: unknown source key(s) ${unknownKeys.join(", ")}`,
      );
    }
  }
}

function validateEvaluationSourcesAndScopes(input: M4RehearsalInput): void {
  const issues: string[] = [];
  const eventById = new Map(
    input.ground_truth_events.map((event) => [event.event_id, event]),
  );
  for (const check of input.checks) {
    if (!isM4SourceId(check.source_id)) {
      issues.push(
        `rehearsal_check ${check.check_id} has unknown source ${check.source_id}`,
      );
    }
    if (!verifyEvaluationRecord(check)) {
      issues.push(
        `rehearsal_check ${check.check_id} failed immutable shape/hash validation`,
      );
    }
  }
  for (const event of input.ground_truth_events) {
    if (!isM4SourceId(event.source_id)) {
      issues.push(
        `ground_truth_event ${event.event_id} has unknown source ${event.source_id}`,
      );
    }
    if (!verifyEvaluationRecord(event)) {
      issues.push(
        `ground_truth_event ${event.event_id} failed immutable shape/hash validation`,
      );
    }
  }
  for (const detection of input.lane_detections) {
    if (!isM4SourceId(detection.source_id)) {
      issues.push(
        `lane_detection ${detection.detection_id} has unknown source ${detection.source_id}`,
      );
    }
    if (!verifyEvaluationRecord(detection)) {
      issues.push(
        `lane_detection ${detection.detection_id} failed immutable shape/hash validation`,
      );
    }
    if (detection.ground_truth_event_id && detection.detected_at) {
      const event = eventById.get(detection.ground_truth_event_id);
      if (
        event &&
        isValidIsoDateTime(event.occurred_at) &&
        isValidIsoDateTime(detection.detected_at) &&
        Date.parse(detection.detected_at) < Date.parse(event.occurred_at)
      ) {
        issues.push(
          `lane_detection ${detection.detection_id} is dated before its ground-truth event`,
        );
      }
    }
  }
  for (const run of input.run_ledger) {
    issues.push(
      ...scopeIssues(
        run.expected_scope,
        `run ${run.run_id} expected_scope`,
        true,
      ),
      ...scopeIssues(run.actual_scope, `run ${run.run_id} actual_scope`, false),
    );
    if (!verifyEvaluationRecord(run)) {
      issues.push(`run ${run.run_id} failed immutable shape/hash validation`);
    }
  }
  for (const [lane, expected] of Object.entries(
    input.window.expected_run_counts ?? {},
  )) {
    if (
      (lane !== "semantic" && lane !== "independent_sentinel") ||
      !Number.isInteger(expected) ||
      expected < 0
    ) {
      issues.push(
        `expected_run_counts.${lane} must be a non-negative integer lane count`,
      );
    }
  }
  if (issues.length > 0) {
    throw new Error(
      `Invalid M4 evaluation sources/scopes: ${issues.join("; ")}`,
    );
  }
}

function emptyLane(): LaneMetrics {
  return {
    confirmed_change_recall: null,
    confirmed_change_recall_numerator: 0,
    confirmed_change_recall_denominator: 0,
    false_positive_count: 0,
    detection_count: 0,
    transport_duplicate_count: 0,
    semantic_duplicate_count: 0,
    median_detection_delay_hours: null,
    maximum_detection_delay_hours: null,
    detection_delay_known_count: 0,
    detection_delay_unknown_count: 0,
    official_primary_source_hit_rate: null,
    official_primary_source_hit_numerator: 0,
    official_primary_source_hit_denominator: 0,
    official_primary_source_hit_unknown_count: 0,
    human_minutes_per_unchanged_check: null,
    unchanged_check_minutes_numerator: 0,
    unchanged_check_minutes_denominator: 0,
    human_minutes_per_confirmed_change: null,
    confirmed_change_minutes_numerator: 0,
    confirmed_change_minutes_denominator: 0,
    direct_acquisition_failure_rate: null,
    direct_acquisition_failure_numerator: 0,
    direct_acquisition_failure_denominator: 0,
    manual_capture_share: null,
    manual_capture_numerator: 0,
    manual_capture_denominator: 0,
    partial_run_rate: null,
    failed_run_rate: null,
    cancelled_run_rate: null,
    absent_run_rate: null,
    completed_zero_finding_run_rate: null,
    run_count: 0,
    run_status_counts: { ...ZERO_RUN_STATUS_COUNTS },
    model_cost_per_useful_finding: null,
    model_cost_known_total: null,
    useful_finding_count: 0,
    unknown_model_cost_run_count: 0,
    changed_winner_rate: null,
  };
}

function computeLane(
  lane: EvaluationLane,
  input: M4RehearsalInput,
  events: ReadonlyMap<string, GroundTruthEvent>,
): LaneMetrics {
  const output = emptyLane();
  const detections = input.lane_detections.filter(
    (detection) => normalizeLane(detection.lane) === lane,
  );
  const checks = lane === "direct" ? input.checks : [];
  const runs = input.run_ledger.filter(
    (run) => normalizeLane(run.lane) === lane,
  );
  const matched = new Set<string>();
  const delays: number[] = [];
  let falsePositives = 0;
  let transportDuplicates = 0;
  let semanticDuplicates = 0;
  let officialNumerator = 0;
  let officialDenominator = 0;
  let officialUnknown = 0;
  let confirmedMinutes = 0;
  let confirmedMinutesCount = 0;
  let usefulFindings = 0;
  let unknownCostRuns = 0;
  let knownCost = 0;
  let allCostsKnown = true;
  let winnerNumerator = 0;
  let winnerDenominator = 0;
  const winnerEvents = new Set<string>();
  let detectionUsefulFindings = 0;
  let runUsefulFindings = 0;
  let runUsefulCountsKnown = true;
  let matchedDetectionCount = 0;
  let directFailureNumerator = 0;
  let directFailureDenominator = 0;
  let manualCaptureNumerator = 0;
  let manualCaptureDenominator = 0;
  let unchangedMinutesNumerator = 0;
  let unchangedMinutesDenominator = 0;

  for (const detection of detections) {
    if (detection.duplicate_kind === "transport") transportDuplicates += 1;
    if (detection.duplicate_kind === "semantic") semanticDuplicates += 1;
    const candidateEvent = detection.ground_truth_event_id
      ? events.get(detection.ground_truth_event_id)
      : undefined;
    const event =
      candidateEvent && candidateEvent.source_id === detection.source_id
        ? candidateEvent
        : undefined;
    if (!event) {
      falsePositives += 1;
      continue;
    }
    matched.add(event.event_id);
    matchedDetectionCount += 1;
    if (detection.detected_at) {
      const delay = hoursBetween(event.occurred_at, detection.detected_at);
      if (delay !== null) delays.push(delay);
    }
    const eventOfficial =
      event.official_primary_source_hit === true
        ? true
        : event.official_primary_source_hit === false
          ? false
          : null;
    const detectionOfficial =
      detection.official_primary_source_hit === true
        ? true
        : detection.official_primary_source_hit === false
          ? false
          : null;
    const officialHit =
      eventOfficial === false
        ? false
        : eventOfficial === null
          ? null
          : detectionOfficial;
    if (officialHit === true) officialNumerator += 1;
    if (officialHit !== null) officialDenominator += 1;
    else officialUnknown += 1;
    if (detection.review_minutes !== null) {
      confirmedMinutes += detection.review_minutes;
      confirmedMinutesCount += 1;
    }
    winnerEvents.add(event.event_id);
    if (detection.useful_finding === true) detectionUsefulFindings += 1;
  }

  const statusCounts: Record<RunLedger["status"], number> = {
    ...ZERO_RUN_STATUS_COUNTS,
  };
  for (const run of runs) {
    statusCounts[run.status] += 1;
    if (run.model_cost === null) {
      allCostsKnown = false;
      unknownCostRuns += 1;
    } else knownCost += run.model_cost;
    if (run.useful_finding_count === null) runUsefulCountsKnown = false;
    else runUsefulFindings += run.useful_finding_count;
  }
  usefulFindings =
    runs.length > 0 && runUsefulCountsKnown
      ? runUsefulFindings
      : detectionUsefulFindings;
  const expectedRuns =
    lane === "direct"
      ? 0
      : (input.window.expected_run_counts?.[lane] ?? runs.length);
  if (expectedRuns > runs.length)
    statusCounts.absent += expectedRuns - runs.length;
  const runDenominator = expectedRuns === 0 ? 0 : expectedRuns;
  const completedZero = runs.filter(
    (run) => run.status === "completed" && run.finding_count === 0,
  ).length;
  for (const check of checks) {
    if (check.state === "capture_failed") directFailureNumerator += 1;
    if (check.state !== "planned" && check.state !== "ready_for_capture") {
      directFailureDenominator += 1;
    }
    if (check.planned_method !== undefined) {
      manualCaptureDenominator += 1;
      if (check.planned_method === "manual_capture")
        manualCaptureNumerator += 1;
    }
    if (
      check.state === "unchanged" &&
      check.human_minutes !== null &&
      check.human_minutes !== undefined
    ) {
      unchangedMinutesNumerator += check.human_minutes;
      unchangedMinutesDenominator += 1;
    }
    if (
      (check.state === "material_review" ||
        check.state === "security_review") &&
      check.human_minutes !== null &&
      check.human_minutes !== undefined
    ) {
      confirmedMinutes += check.human_minutes;
      confirmedMinutesCount += 1;
    }
  }

  const recall = rate(matched.size, input.ground_truth_events.length);
  const official = rate(
    officialNumerator,
    officialDenominator,
    officialUnknown,
  );
  const unchanged = rate(
    unchangedMinutesNumerator,
    unchangedMinutesDenominator,
  );
  const confirmed = rate(confirmedMinutes, confirmedMinutesCount);
  const runRate = (count: number): number | null =>
    runDenominator === 0 ? null : count / runDenominator;
  const costPerUseful =
    !allCostsKnown || usefulFindings === 0 ? null : knownCost / usefulFindings;
  for (const eventId of winnerEvents) {
    const event = events.get(eventId);
    if (
      !event ||
      (event.winner_impact !== "changed" && event.winner_impact !== "unchanged")
    )
      continue;
    winnerDenominator += 1;
    if (event.winner_impact === "changed") winnerNumerator += 1;
  }
  const winnerRate = rate(winnerNumerator, winnerDenominator);
  return {
    ...output,
    confirmed_change_recall: recall.value,
    confirmed_change_recall_numerator: recall.numerator,
    confirmed_change_recall_denominator: recall.denominator,
    false_positive_count: falsePositives,
    detection_count: detections.length,
    transport_duplicate_count: transportDuplicates,
    semantic_duplicate_count: semanticDuplicates,
    median_detection_delay_hours: median(delays),
    maximum_detection_delay_hours:
      delays.length === 0 ? null : Math.max(...delays),
    detection_delay_known_count: delays.length,
    detection_delay_unknown_count: matchedDetectionCount - delays.length,
    official_primary_source_hit_rate: official.value,
    official_primary_source_hit_numerator: official.numerator,
    official_primary_source_hit_denominator: official.denominator,
    official_primary_source_hit_unknown_count: official.unknown_count,
    human_minutes_per_unchanged_check: unchanged.value,
    human_minutes_per_confirmed_change: confirmed.value,
    confirmed_change_minutes_numerator: confirmed.numerator,
    confirmed_change_minutes_denominator: confirmed.denominator,
    direct_acquisition_failure_rate: rate(
      directFailureNumerator,
      directFailureDenominator,
    ).value,
    direct_acquisition_failure_numerator: directFailureNumerator,
    direct_acquisition_failure_denominator: directFailureDenominator,
    manual_capture_share: rate(manualCaptureNumerator, manualCaptureDenominator)
      .value,
    manual_capture_numerator: manualCaptureNumerator,
    manual_capture_denominator: manualCaptureDenominator,
    unchanged_check_minutes_numerator: unchangedMinutesNumerator,
    unchanged_check_minutes_denominator: unchangedMinutesDenominator,
    partial_run_rate: runRate(statusCounts.partial),
    failed_run_rate: runRate(statusCounts.failed),
    cancelled_run_rate: runRate(statusCounts.cancelled),
    absent_run_rate: runRate(statusCounts.absent),
    completed_zero_finding_run_rate: runRate(completedZero),
    run_count: runs.length,
    run_status_counts: statusCounts,
    model_cost_per_useful_finding: costPerUseful,
    model_cost_known_total: allCostsKnown ? knownCost : null,
    useful_finding_count: usefulFindings,
    unknown_model_cost_run_count: unknownCostRuns,
    changed_winner_rate: winnerRate.value,
  };
}

function coverageFor(input: M4RehearsalInput): M4Coverage {
  const reasons: string[] = [];
  const missingSourceIds: string[] = [];
  const coverageValue = input.window.source_coverage_days;
  const coverageMap =
    coverageValue !== null &&
    typeof coverageValue === "object" &&
    !Array.isArray(coverageValue)
      ? coverageValue
      : null;
  if (coverageMap === null) {
    reasons.push("source coverage map is absent or invalid");
  }
  if (input.window.planned_window_days !== M4_PLANNED_WINDOW_DAYS) {
    reasons.push("planned window is not the fixed thirty-day window");
  }
  if (input.window.observed_window_days < M4_PLANNED_WINDOW_DAYS) {
    reasons.push("observed window is shorter than the planned window");
  }
  if (input.window.status !== "complete")
    reasons.push("window is marked partial");
  if (!input.window.window_end) reasons.push("window end is absent");
  else {
    const elapsed = hoursBetween(
      input.window.window_start,
      input.window.window_end,
    );
    if (elapsed === null || elapsed < M4_PLANNED_WINDOW_DAYS * 24) {
      reasons.push("window timestamps do not cover thirty days");
    }
  }
  for (const sourceId of M4_COHORT_SOURCE_IDS) {
    const days = coverageMap?.[sourceId];
    if (
      typeof days !== "number" ||
      !Number.isFinite(days) ||
      !Number.isInteger(days) ||
      days < 0
    ) {
      if (days !== undefined) {
        reasons.push(`${sourceId} source coverage is invalid`);
      }
      missingSourceIds.push(sourceId);
    } else if (days < M4_PLANNED_WINDOW_DAYS) {
      missingSourceIds.push(sourceId);
    }
  }
  if (missingSourceIds.length > 0)
    reasons.push("one or more fixed sources lack full coverage");
  const runReconciliation = {
    semantic: {
      expected:
        input.window.expected_run_counts?.semantic ??
        input.run_ledger.filter((run) => normalizeLane(run.lane) === "semantic")
          .length,
      recorded: input.run_ledger.filter(
        (run) => normalizeLane(run.lane) === "semantic",
      ).length,
      delta: 0,
      reconciled: true,
    },
    independent_sentinel: {
      expected:
        input.window.expected_run_counts?.independent_sentinel ??
        input.run_ledger.filter(
          (run) => normalizeLane(run.lane) === "independent_sentinel",
        ).length,
      recorded: input.run_ledger.filter(
        (run) => normalizeLane(run.lane) === "independent_sentinel",
      ).length,
      delta: 0,
      reconciled: true,
    },
  };
  for (const lane of ["semantic", "independent_sentinel"] as const) {
    runReconciliation[lane].delta =
      runReconciliation[lane].recorded - runReconciliation[lane].expected;
    runReconciliation[lane].reconciled = runReconciliation[lane].delta === 0;
  }
  const incompleteRunCount = input.run_ledger.filter((run) =>
    ["partial", "failed", "cancelled", "absent"].includes(run.status),
  ).length;
  return {
    planned_window_days: input.window.planned_window_days,
    observed_window_days: input.window.observed_window_days,
    complete: reasons.length === 0,
    reasons,
    missing_source_ids: missingSourceIds,
    run_reconciliation: runReconciliation,
    incomplete_run_count: incompleteRunCount,
  };
}

function decisionFor(
  input: M4RehearsalInput,
  coverage: M4Coverage,
  byLane: Readonly<
    Record<"direct" | "semantic" | "independent_sentinel", LaneMetrics>
  >,
): M4Decision {
  const weekly = weeklyMaintenanceFor(input);
  const weeklyHours = weekly.buckets
    .filter((bucket) => bucket.complete && bucket.hours !== null)
    .map((bucket) => bucket.hours as number);
  const allRecords = [
    ...input.checks,
    ...input.ground_truth_events,
    ...input.lane_detections,
    ...input.run_ledger,
  ];
  const syntheticOnly =
    allRecords.length > 0 &&
    allRecords.every((record) => record.synthetic === true);
  const base = {
    weekly_maintenance_hours: weeklyHours,
    median_weekly_maintenance_hours: weekly.median_weekly_hours,
    complete_week_count: weekly.complete_week_count,
    synthetic_only: syntheticOnly,
  };
  const makeDecision = (
    status: M4DecisionStatus,
    rationale: readonly string[],
    thresholdApplied: boolean,
    maintenanceHours: number | null,
    rationaleParts: {
      readonly informational: readonly string[];
      readonly threshold: readonly string[];
    } = { informational: [], threshold: rationale },
  ): M4Decision => ({
    ...base,
    status,
    rationale,
    informational_rationale: rationaleParts.informational,
    threshold_rationale: rationaleParts.threshold,
    threshold_applied: thresholdApplied,
    maintenance_hours_per_week: maintenanceHours,
  });
  if (!coverage.complete) {
    return makeDecision(
      "insufficient_data",
      [
        "No green/amber/red decision is permitted before full planned-window coverage.",
        ...coverage.reasons,
      ],
      false,
      null,
    );
  }
  if (
    weekly.complete_week_count < M4_REQUIRED_COMPLETE_WEEKS ||
    weekly.median_weekly_hours === null
  ) {
    return makeDecision(
      "insufficient_data",
      [
        `At least ${M4_REQUIRED_COMPLETE_WEEKS} complete seven-day maintenance buckets are required before applying thresholds.`,
        weekly.trailing_bucket_excluded
          ? "The incomplete trailing bucket is excluded from the median."
          : "One or more full weekly buckets have missing or unknown check minutes.",
      ],
      false,
      null,
    );
  }
  const hoursPerWeek = weekly.median_weekly_hours;
  const manualShare = byLane.direct.manual_capture_share;
  const blockedChecks = input.checks.filter((check) =>
    check.state.startsWith("blocked_"),
  ).length;
  const unresolvedHighImpact = input.checks.filter(
    (check) =>
      check.state === "material_review" || check.state === "security_review",
  ).length;
  const informationalRationale: string[] = [];
  if (coverage.incomplete_run_count > 0) {
    informationalRationale.push(
      `${coverage.incomplete_run_count} partial/failed/cancelled/absent run(s) remain recorded; observation coverage is still complete.`,
    );
  }
  for (const [lane, reconciliation] of Object.entries(
    coverage.run_reconciliation,
  )) {
    if (!reconciliation.reconciled) {
      informationalRationale.push(
        `${lane} expected/recorded run count delta is ${reconciliation.delta}.`,
      );
    }
  }
  const thresholdRationale: string[] = [];
  if (hoursPerWeek > 6) {
    thresholdRationale.push(
      `maintenance is ${hoursPerWeek.toFixed(2)} hours/week (>6)`,
    );
    return makeDecision(
      "red",
      [...informationalRationale, ...thresholdRationale],
      true,
      hoursPerWeek,
      {
        informational: informationalRationale,
        threshold: thresholdRationale,
      },
    );
  }
  if (blockedChecks >= 2 || unresolvedHighImpact > 0) {
    if (blockedChecks >= 2)
      thresholdRationale.push("repeated blocked direct checks remain");
    if (unresolvedHighImpact > 0)
      thresholdRationale.push("unresolved material or security changes remain");
    return makeDecision(
      "red",
      [...informationalRationale, ...thresholdRationale],
      true,
      hoursPerWeek,
      {
        informational: informationalRationale,
        threshold: thresholdRationale,
      },
    );
  }
  if (hoursPerWeek > 3)
    thresholdRationale.push(
      `maintenance is ${hoursPerWeek.toFixed(2)} hours/week (>3 and <=6)`,
    );
  if (manualShare !== null && manualShare > 0.25)
    thresholdRationale.push(
      `manual capture share is ${(manualShare * 100).toFixed(1)}% (>25%)`,
    );
  if (thresholdRationale.length > 0) {
    return makeDecision(
      "amber",
      [...informationalRationale, ...thresholdRationale],
      true,
      hoursPerWeek,
      {
        informational: informationalRationale,
        threshold: thresholdRationale,
      },
    );
  }
  return makeDecision(
    "green",
    [
      ...informationalRationale,
      `maintenance is ${hoursPerWeek.toFixed(2)} hours/week (<=3)`,
    ],
    true,
    hoursPerWeek,
    {
      informational: informationalRationale,
      threshold: [],
    },
  );
}

function deterministicInputHash(input: M4RehearsalInput): string {
  const coverage = input.window.source_coverage_days;
  const safeCoverage =
    coverage !== null &&
    typeof coverage === "object" &&
    !Array.isArray(coverage)
      ? Object.fromEntries(
          Object.entries(coverage).map(([sourceId, days]) => [
            sourceId,
            typeof days === "number" && Number.isFinite(days) ? days : null,
          ]),
        )
      : null;
  const hashableInput = {
    ...input,
    window: {
      ...input.window,
      source_coverage_days: safeCoverage,
    },
  };
  return canonicalSha256(
    hashableInput as unknown as Parameters<typeof canonicalSha256>[0],
  );
}

export function calculateM4Metrics(input: M4RehearsalInput): M4Metrics {
  const cohort = input.cohort ?? M4_COHORT_MANIFEST;
  assertM4Cohort(cohort);
  validateWindowInput(input);
  validateEvaluationSourcesAndScopes(input);
  const duplicate = duplicateIds(input);
  if (duplicate) throw new Error(`Duplicate evaluation ID: ${duplicate}`);
  const events = new Map(
    input.ground_truth_events.map((event) => [event.event_id, event]),
  );
  const byLane = {
    direct: computeLane("direct", input, events),
    semantic: computeLane("semantic", input, events),
    independent_sentinel: computeLane("independent_sentinel", input, events),
  } as const;
  const sentinelEvents = new Set(
    input.lane_detections
      .filter(
        (detection) =>
          normalizeLane(detection.lane) === "independent_sentinel" &&
          detection.ground_truth_event_id &&
          events.get(detection.ground_truth_event_id)?.source_id ===
            detection.source_id,
      )
      .map((detection) => detection.ground_truth_event_id as string),
  );
  const semanticEvents = new Set(
    input.lane_detections
      .filter(
        (detection) =>
          normalizeLane(detection.lane) === "semantic" &&
          detection.ground_truth_event_id &&
          events.get(detection.ground_truth_event_id)?.source_id ===
            detection.source_id,
      )
      .map((detection) => detection.ground_truth_event_id as string),
  );
  const sentinelMisses = [...sentinelEvents]
    .filter((eventId) => !semanticEvents.has(eventId))
    .sort();
  const winnerKnown = input.ground_truth_events.filter(
    (event) =>
      event.winner_impact === "changed" || event.winner_impact === "unchanged",
  );
  const winnerChanged = winnerKnown.filter(
    (event) => event.winner_impact === "changed",
  ).length;
  const coverage = coverageFor(input);
  const weeklyMaintenance = weeklyMaintenanceFor(input);
  const decision = decisionFor(input, coverage, byLane);
  const payload = {
    cohort_hash: M4_COHORT_MANIFEST.manifest_hash,
    coverage,
    confirmed_material_event_count: input.ground_truth_events.length,
    by_lane: byLane,
    independent_sentinel_misses: sentinelMisses,
    independent_sentinel_miss_count: sentinelMisses.length,
    changed_winner_rate:
      winnerKnown.length === 0 ? null : winnerChanged / winnerKnown.length,
    changed_winner_numerator: winnerChanged,
    changed_winner_denominator: winnerKnown.length,
    duplicate_observation_count: input.lane_detections.filter(
      (detection) => detection.duplicate_kind !== undefined,
    ).length,
    weekly_maintenance: weeklyMaintenance,
    decision,
  };
  return deepFreeze({
    ...payload,
    input_hash: deterministicInputHash(input),
  });
}
