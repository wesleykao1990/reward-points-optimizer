import type {
  ConsumerErrorDiagnostic,
  DeadLetterDiagnostic,
  DeadLetterDiagnosticsPort,
  ReplayDiagnosticsPort,
  ReplayRequest,
} from "./types.js";
import { redactedRecord } from "./util.js";

export function createInMemoryDeadLetterDiagnostics(): DeadLetterDiagnosticsPort & {
  values(): readonly DeadLetterDiagnostic[];
} {
  const records: DeadLetterDiagnostic[] = [];
  return {
    async record(input) {
      records.push({
        ...input,
        ...(input.redacted_payload === undefined
          ? {}
          : { redacted_payload: redactedRecord(input.redacted_payload) }),
      });
    },
    async list(filter) {
      const limit = filter?.limit ?? 100;
      return records
        .filter(
          (item) =>
            (filter?.stream_id === undefined ||
              item.stream_id === filter.stream_id) &&
            (filter?.run_id === undefined || item.run_id === filter.run_id),
        )
        .slice(-Math.max(0, limit));
    },
    values() {
      return records.map((item) => ({
        ...item,
        ...(item.redacted_payload === undefined
          ? {}
          : { redacted_payload: redactedRecord(item.redacted_payload) }),
      }));
    },
  };
}

export function createInMemoryReplayDiagnostics(): ReplayDiagnosticsPort & {
  requests(): readonly ReplayRequest[];
  attempts(): readonly {
    event_id: string;
    attempt: number;
    outcome: string;
    diagnostic: ConsumerErrorDiagnostic;
  }[];
} {
  const replayRequests: ReplayRequest[] = [];
  const replayAttempts: {
    event_id: string;
    attempt: number;
    outcome: string;
    diagnostic: ConsumerErrorDiagnostic;
  }[] = [];
  return {
    async requestReplay(input) {
      if (input.event_id === undefined && input.cursor === undefined)
        return { accepted: false, reason_code: "event_id_or_cursor_required" };
      replayRequests.push({ ...input });
      return { accepted: true, replay_id: `replay_${replayRequests.length}` };
    },
    async recordAttempt(input) {
      replayAttempts.push({
        event_id: input.event_id,
        attempt: input.attempt,
        outcome: input.outcome,
        diagnostic: { ...input.diagnostic },
      });
    },
    requests() {
      return replayRequests.map((item) => ({ ...item }));
    },
    attempts() {
      return replayAttempts.map((item) => ({
        ...item,
        diagnostic: { ...item.diagnostic },
      }));
    },
  };
}
