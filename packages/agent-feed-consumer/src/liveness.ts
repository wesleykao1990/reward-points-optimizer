import type {
  LivenessEvaluation,
  MonitorLivenessPort,
  MonitorStreamExpectation,
  RunTerminalStatus,
} from "./types.js";
import { isoDate } from "./util.js";

export const MIN_EXPECTED_CADENCE_SECONDS = 3_600;

export function assertMonitorStreamExpectation(
  input: Pick<
    MonitorStreamExpectation,
    "stream_id" | "expected_cadence_seconds" | "grace_seconds" | "owner"
  >,
): void {
  if (!/^[a-z0-9][a-z0-9._-]+$/u.test(input.stream_id))
    throw new TypeError("invalid_stream_id");
  if (
    !Number.isSafeInteger(input.expected_cadence_seconds) ||
    input.expected_cadence_seconds < MIN_EXPECTED_CADENCE_SECONDS
  )
    throw new TypeError("expected_cadence_too_short");
  if (!Number.isSafeInteger(input.grace_seconds) || input.grace_seconds < 0)
    throw new TypeError("invalid_grace_seconds");
  if (input.owner.trim().length === 0)
    throw new TypeError("expectation_owner_required");
}

export function computeNextDueAt(
  completedAt: Date | string | number,
  expectedCadenceSeconds: number,
  graceSeconds: number,
): string {
  assertMonitorStreamExpectation({
    stream_id: "stream",
    expected_cadence_seconds: expectedCadenceSeconds,
    grace_seconds: graceSeconds,
    owner: "consumer",
  });
  const date = new Date(completedAt);
  if (!Number.isFinite(date.getTime()))
    throw new TypeError("invalid_completed_at");
  return new Date(
    date.getTime() + (expectedCadenceSeconds + graceSeconds) * 1000,
  ).toISOString();
}

export function evaluateMonitorLiveness(
  expectation: MonitorStreamExpectation,
  now: Date | string | number,
): LivenessEvaluation {
  const nowIso = isoDate(now);
  const nowMs = Date.parse(nowIso);
  assertMonitorStreamExpectation(expectation);
  if (!expectation.enabled)
    return {
      stream_id: expectation.stream_id,
      ...(expectation.source_ids === undefined
        ? {}
        : { source_ids: expectation.source_ids }),
      status: "disabled",
      due_at: expectation.next_due_at,
      absent_run: false,
      reason_code: "disabled",
    };
  if (expectation.next_due_at === null)
    return {
      stream_id: expectation.stream_id,
      ...(expectation.source_ids === undefined
        ? {}
        : { source_ids: expectation.source_ids }),
      status: "never_seen",
      due_at: null,
      absent_run: true,
      reason_code: "never_seen",
    };
  const dueMs = Date.parse(expectation.next_due_at);
  if (!Number.isFinite(dueMs)) throw new TypeError("invalid_next_due_at");
  if (nowMs > dueMs)
    return {
      stream_id: expectation.stream_id,
      ...(expectation.source_ids === undefined
        ? {}
        : { source_ids: expectation.source_ids }),
      status: "overdue",
      due_at: expectation.next_due_at,
      absent_run: true,
      reason_code: "overdue",
    };
  if (nowMs === dueMs)
    return {
      stream_id: expectation.stream_id,
      ...(expectation.source_ids === undefined
        ? {}
        : { source_ids: expectation.source_ids }),
      status: "due",
      due_at: expectation.next_due_at,
      absent_run: true,
      reason_code: "due",
    };
  return {
    stream_id: expectation.stream_id,
    ...(expectation.source_ids === undefined
      ? {}
      : { source_ids: expectation.source_ids }),
    status: "healthy",
    due_at: expectation.next_due_at,
    absent_run: false,
    reason_code: "healthy",
  };
}

export function completedZeroFindings(
  status: RunTerminalStatus,
  findingsSubmitted: number,
): boolean {
  return (
    status === "completed" &&
    Number.isSafeInteger(findingsSubmitted) &&
    findingsSubmitted === 0
  );
}

export interface InMemoryLivenessPort extends MonitorLivenessPort {
  get(streamId: string): MonitorStreamExpectation | undefined;
}

export function createInMemoryLivenessPort(
  initial: readonly MonitorStreamExpectation[] = [],
): InMemoryLivenessPort {
  const state = new Map(
    initial.map((item) => [item.stream_id, { ...item }] as const),
  );
  return {
    async registerExpectation(input) {
      assertMonitorStreamExpectation(input);
      state.set(input.stream_id, { ...input });
    },
    async recordTerminalRun(input) {
      const current = state.get(input.stream_id);
      if (!current) throw new Error("stream_expectation_not_found");
      const nextDue = computeNextDueAt(
        input.completed_at,
        current.expected_cadence_seconds,
        current.grace_seconds,
      );
      state.set(input.stream_id, {
        ...current,
        last_terminal_run_at: input.completed_at,
        next_due_at: nextDue,
        liveness_status: input.status === "completed" ? "healthy" : "degraded",
      });
    },
    async sweepOverdue(now) {
      const output: LivenessEvaluation[] = [];
      for (const [streamId, current] of state) {
        const evaluation = evaluateMonitorLiveness(current, now);
        output.push(evaluation);
        if (
          evaluation.status === "overdue" ||
          evaluation.status === "due" ||
          evaluation.status === "never_seen"
        ) {
          state.set(streamId, {
            ...current,
            liveness_status: evaluation.status,
          });
        }
      }
      return output;
    },
    get(streamId) {
      const value = state.get(streamId);
      return value === undefined ? undefined : { ...value };
    },
  };
}
