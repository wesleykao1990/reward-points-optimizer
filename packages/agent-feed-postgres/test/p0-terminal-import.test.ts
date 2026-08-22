import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  type AgentFeedDeliveryEvent,
  type AtomicPersistenceInput,
  createAgentFeedConsumerHandler,
  createFallbackSchemaValidator,
  signRawBody,
} from "@jro/agent-feed-consumer";
import {
  admitP0SourceRolePlan,
  buildP0FamilyWorkUnit,
  buildP0OperationsManifest,
  P0_RECEIPT_RECONCILIATION_VERSION,
  P0_TARGET_CHECKPOINT_VERSION,
  type P0OperationsManifest,
  type P0ReceiptReconciliation,
  type P0SourceRolePlan,
} from "@jro/p0-source-operations";
import { describe, expect, it } from "vitest";
import {
  ATOMIC_FUNCTION_QUERY,
  createPostgresP0TerminalAtomicPersistence,
  P0_TERMINAL_RECONCILIATION_QUERY,
  type QueryClient,
  type QueryPool,
  type QueryResult,
} from "../src/index.js";

const planPath = resolve(
  process.cwd(),
  "../../registry/planning/p0-source-role-plan.v0.1.json",
);
const INPUT_HASH = `sha256:${"a".repeat(64)}`;
const LOCATOR_HASH = `sha256:${"b".repeat(64)}`;
const RECEIPT_ID = "00000000-0000-4000-8000-000000000001";
const RECEIVED_AT = "2026-08-22T00:00:00+09:00";
const SIGNING_SECRET = "terminal-bridge-test-secret";
const SIGNING_TIMESTAMP = Math.floor(Date.parse(RECEIVED_AT) / 1000);

function admittedPlan(): P0SourceRolePlan {
  const result = admitP0SourceRolePlan(
    JSON.parse(readFileSync(planPath, "utf8")) as unknown,
  );
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.plan;
}

function fixture(): {
  manifest: P0OperationsManifest;
  reconciliation: P0ReceiptReconciliation;
  input: AtomicPersistenceInput;
} {
  const plan = admittedPlan();
  const manifest = buildP0OperationsManifest(plan);
  const unit = buildP0FamilyWorkUnit(
    plan,
    "merchant.jp-convenience",
    "merchant.7eleven",
  );
  const eventId = "event-p0-terminal";
  const runId = "run-p0-terminal";
  const streamId = "merchant.jp-convenience";
  const checkpoints = unit.targets.map((target, index) => ({
    version: P0_TARGET_CHECKPOINT_VERSION,
    manifest_sha256: manifest.manifest_sha256,
    target_id: target.target_id,
    stream_id: streamId,
    family_id: target.family_id,
    source_role_id: target.source_role_id,
    attempt_number: index + 1,
    observed_at: `2026-08-22T00:00:0${index + 1}+09:00`,
    outcome: "resolved" as const,
    run_id: runId,
    event_id: eventId,
    receipt_id: "p0-placeholder",
    idempotency_key: `checkpoint-p0-terminal-${index + 1}`,
    input_sha256: INPUT_HASH,
    locator: "https://example.test/official",
    locator_fingerprint: LOCATOR_HASH,
    economic_findings_accepted: 0,
  }));
  const reconciliation: P0ReceiptReconciliation = {
    version: P0_RECEIPT_RECONCILIATION_VERSION,
    plan_sha256: manifest.plan_sha256,
    manifest_sha256: manifest.manifest_sha256,
    work_unit_sha256: unit.work_unit_sha256,
    stream_id: streamId,
    family_id: "merchant.7eleven",
    run_id: runId,
    terminal_status: "completed",
    receipt_id: "p0-placeholder",
    checkpoints,
  };
  const input: AtomicPersistenceInput = {
    receipt: {
      event_id: eventId,
      protocol_version: "0.1",
      stream_id: streamId,
      run_id: runId,
      finding_id: null,
      event_type: "run.completed",
      received_at: "2026-08-22T00:00:00+09:00",
      occurred_at: "2026-08-22T00:00:00+09:00",
      attempt: 1,
      payload_hash: INPUT_HASH,
      transport_payload_hash: INPUT_HASH,
      delivery_id: "delivery-p0-terminal",
      signature_timestamp: "2026-08-22T00:00:00+09:00",
      signature_key_id: "key-p0-terminal",
      delivery_attempt: 1,
      raw_payload: {},
      processing_status: "received",
      redaction_status: "complete",
    },
    observation: null,
    submitted_evidence: [],
    run_lifecycle: {
      kind: "terminal",
      stream_id: streamId,
      run_id: runId,
      event_id: eventId,
      status: "completed",
      completed_at: "2026-08-22T00:00:00+09:00",
      findings_submitted: 0,
      completed_zero_findings: true,
      absent_run: false,
      actual_scope: {},
      expected_scope: {},
      error_summary: null,
    },
  };
  return { manifest, reconciliation, input };
}

function clientFor(
  handler: (
    text: string,
    values: readonly unknown[] | undefined,
  ) => QueryResult<unknown> | Promise<QueryResult<unknown>>,
): QueryClient {
  return {
    query(text, values) {
      return Promise.resolve(handler(text, values));
    },
  };
}

function atomicRow(status: string) {
  return {
    receipt_id: RECEIPT_ID,
    status,
    observation: null,
    duplicate_kind: null,
    duplicate_of_receipt_id: null,
    reason_code: null,
  };
}

function terminalEvent(): AgentFeedDeliveryEvent {
  return {
    protocol_version: "0.1",
    event_id: "event-p0-terminal",
    event_type: "run.completed",
    stream_id: "merchant.jp-convenience",
    run_id: "run-p0-terminal",
    finding_id: null,
    occurred_at: RECEIVED_AT,
    attempt: 1,
    payload: {
      status: "completed",
      completed_at: RECEIVED_AT,
      actual_scope: {
        source_ids: [],
        subjects: [],
        queries: [],
        metadata: {},
      },
      expected_scope: {
        source_ids: [],
        subjects: [],
        queries: [],
        metadata: {},
      },
      stats: {
        sources_attempted: 0,
        sources_succeeded: 0,
        findings_submitted: 0,
        evidence_submitted: 0,
        batches_submitted: 0,
      },
      error_summary: null,
    },
  };
}

function signedRequest(event: AgentFeedDeliveryEvent) {
  const rawBody = JSON.stringify(event);
  return {
    raw_body: rawBody,
    received_at: RECEIVED_AT,
    headers: {
      "x-agent-feed-event-id": event.event_id,
      "x-agent-feed-delivery-id": "delivery-p0-terminal",
      "x-agent-feed-attempt": String(event.attempt),
      "x-agent-feed-protocol-version": "0.1",
      "x-agent-feed-timestamp": String(SIGNING_TIMESTAMP),
      "x-agent-feed-key-id": "key-p0-terminal",
      "x-agent-feed-signature": signRawBody(
        rawBody,
        SIGNING_TIMESTAMP,
        SIGNING_SECRET,
      ),
    },
  };
}

async function persistThroughConsumer(
  persistence: ReturnType<typeof createPostgresP0TerminalAtomicPersistence>,
  event: AgentFeedDeliveryEvent = terminalEvent(),
) {
  const consumer = createAgentFeedConsumerHandler({
    key_resolver: {
      resolve: (keyId) =>
        keyId === "key-p0-terminal"
          ? {
              key_id: keyId,
              secret: SIGNING_SECRET,
              active_from: 0,
            }
          : null,
    },
    persistence,
    schema_validator: createFallbackSchemaValidator(),
    now: () => new Date(RECEIVED_AT),
  });
  return consumer.handle(signedRequest(event));
}

describe("PostgreSQL P0 terminal import bridge", () => {
  it("persists, binds the returned receipt UUID, reconciles, and commits in order", async () => {
    const { manifest, reconciliation } = fixture();
    const calls: Array<{ text: string; values?: readonly unknown[] }> = [];
    const target = clientFor((text, values) => {
      calls.push({ text, values });
      if (text === ATOMIC_FUNCTION_QUERY)
        return { rows: [atomicRow("inserted")] };
      if (text === P0_TERMINAL_RECONCILIATION_QUERY)
        return { rows: [{ inserted_count: 6, duplicate_count: 0 }] };
      return { rows: [] };
    });
    const persistence = createPostgresP0TerminalAtomicPersistence(
      target,
      manifest,
      () => reconciliation,
    );
    const response = await persistThroughConsumer(persistence);
    expect(response.acknowledged).toBe(true);
    const result = response.outcome;
    expect(result).toMatchObject({
      status: "inserted",
      receipt_id: RECEIPT_ID,
    });
    expect(calls.map((call) => call.text)).toEqual([
      "BEGIN",
      ATOMIC_FUNCTION_QUERY,
      P0_TERMINAL_RECONCILIATION_QUERY,
      "COMMIT",
    ]);
    expect(JSON.parse(calls[1]?.values?.[0] as string)).toMatchObject({
      receipt: {
        event_id: "event-p0-terminal",
        run_id: "run-p0-terminal",
        stream_id: "merchant.jp-convenience",
      },
    });
    const bound = JSON.parse(
      calls[2]?.values?.[0] as string,
    ) as P0ReceiptReconciliation;
    expect(bound.receipt_id).toBe(RECEIPT_ID);
    expect(
      bound.checkpoints.every(
        (checkpoint) => checkpoint.receipt_id === RECEIPT_ID,
      ),
    ).toBe(true);
  });

  it("keeps an exact duplicate idempotent while still reconciling the returned receipt", async () => {
    const { manifest, reconciliation } = fixture();
    const calls: string[] = [];
    const target = clientFor((text) => {
      calls.push(text);
      if (text === ATOMIC_FUNCTION_QUERY)
        return { rows: [atomicRow("duplicate")] };
      if (text === P0_TERMINAL_RECONCILIATION_QUERY)
        return { rows: [{ inserted_count: 0, duplicate_count: 6 }] };
      return { rows: [] };
    });
    const response = await persistThroughConsumer(
      createPostgresP0TerminalAtomicPersistence(
        target,
        manifest,
        () => reconciliation,
      ),
    );
    expect(response.outcome).toMatchObject({
      status: "duplicate",
      receipt_id: RECEIPT_ID,
    });
    expect(calls).toEqual([
      "BEGIN",
      ATOMIC_FUNCTION_QUERY,
      P0_TERMINAL_RECONCILIATION_QUERY,
      "COMMIT",
    ]);
  });

  it("rejects identity mismatches before any query", async () => {
    const { manifest, reconciliation, input } = fixture();
    if (input.run_lifecycle === null)
      throw new Error("missing lifecycle fixture");
    const mismatch = {
      ...input,
      run_lifecycle: { ...input.run_lifecycle, run_id: "other-run-id" },
    } as AtomicPersistenceInput;
    let queries = 0;
    const target = clientFor(() => {
      queries += 1;
      return { rows: [] };
    });
    await expect(
      createPostgresP0TerminalAtomicPersistence(
        target,
        manifest,
        () => reconciliation,
      ).persist(mismatch),
    ).rejects.toThrow("p0_terminal_input_unverified");
    expect(queries).toBe(0);
  });

  it("rolls back and releases the original reconciliation error", async () => {
    const { manifest, reconciliation } = fixture();
    const failure = new Error("reconciliation failure");
    const calls: string[] = [];
    let releaseError: Error | undefined;
    const pool: QueryPool = {
      async query() {
        throw new Error("pool.query must not be used");
      },
      async connect() {
        return {
          async query(text) {
            calls.push(text);
            if (text === ATOMIC_FUNCTION_QUERY)
              return { rows: [atomicRow("inserted")] };
            if (text === P0_TERMINAL_RECONCILIATION_QUERY) throw failure;
            return { rows: [] };
          },
          release(error?: Error) {
            releaseError = error;
          },
        };
      },
    };
    const response = await persistThroughConsumer(
      createPostgresP0TerminalAtomicPersistence(
        pool,
        manifest,
        () => reconciliation,
      ),
    );
    expect(response.status_code).toBe(500);
    expect(calls).toEqual([
      "BEGIN",
      ATOMIC_FUNCTION_QUERY,
      P0_TERMINAL_RECONCILIATION_QUERY,
      "ROLLBACK",
    ]);
    expect(releaseError).toBe(failure);
  });

  it.each([
    ["proxy", (value: P0ReceiptReconciliation) => new Proxy(value, {})],
    [
      "extra field",
      (value: P0ReceiptReconciliation) => ({ ...value, extra: true }),
    ],
    [
      "invalid template",
      (value: P0ReceiptReconciliation) => ({
        ...value,
        terminal_status: "partial",
      }),
    ],
  ])("rejects %s before checkout", async (_label, makeTemplate) => {
    const { manifest, reconciliation } = fixture();
    let connects = 0;
    const target: QueryPool = {
      async query() {
        throw new Error("pool.query must not be used");
      },
      async connect() {
        connects += 1;
        throw new Error("must not checkout");
      },
    };
    const response = await persistThroughConsumer(
      createPostgresP0TerminalAtomicPersistence(target, manifest, () =>
        makeTemplate(reconciliation),
      ),
    );
    expect(response.status_code).toBe(500);
    expect(connects).toBe(0);
  });
});
