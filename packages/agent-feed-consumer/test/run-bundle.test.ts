import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, test } from "vitest";
import type {
  AgentFeedDeliveryEvent,
  RunBundleDeliveryContext,
} from "../src/index.js";
import {
  importRunBundle,
  mapFindingToObservation,
  normalizeRunBundle,
  validateRunBundle,
} from "../src/index.js";

type JsonRecord = Record<string, unknown>;

async function hostileBundle(): Promise<JsonRecord> {
  return JSON.parse(
    await readFile(
      new URL(
        "../../../fixtures/security/agent-feed-hostile-run-bundle.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as JsonRecord;
}

function zeroBundle(source: JsonRecord): JsonRecord {
  const bundle = structuredClone(source) as JsonRecord;
  bundle.batches = [];
  bundle.complete.stats = {
    sources_attempted: 1,
    sources_succeeded: 1,
    findings_submitted: 0,
    evidence_submitted: 0,
    batches_submitted: 0,
  };
  bundle.complete.actual_scope = structuredClone(bundle.begin.expected_scope);
  return bundle;
}

describe("local run-bundle importer", () => {
  test("validates and replays the hostile bundle as untrusted lead data", async () => {
    const bundle = await hostileBundle();
    const calls: Array<{
      event: AgentFeedDeliveryEvent;
      context: RunBundleDeliveryContext;
    }> = [];
    const result = await importRunBundle(bundle, {
      imported_at: "2026-08-19T00:00:00.000Z",
      batch_sink: async (deliveries) => {
        for (const delivery of deliveries)
          calls.push({ event: delivery.event, context: delivery.context });
      },
    });
    assert.equal(result.valid, true);
    assert.equal(result.status, "completed");
    assert.equal(result.callbacks, 1);
    assert.equal(calls.length, 3);
    assert.equal(result.provenance.mode, "local_run_bundle_import");
    const findingCall = calls.find(
      (item) => item.event.event_type === "finding.submitted",
    );
    assert.ok(findingCall);
    const mapped = mapFindingToObservation({
      event: findingCall.event,
      finding: findingCall.event.payload.finding,
      submitted_evidence: findingCall.event.payload.submitted_evidence,
      received_at: "2026-08-19T00:00:00.000Z",
    });
    assert.ok(mapped);
    assert.equal(mapped.observation.status, "rejected");
    assert.deepEqual(mapped.observation.canonical_evidence_ids, []);
    assert.deepEqual(mapped.observation.security_flags, [
      "attempted_authority_escalation",
      "embedded_instruction",
    ]);
    assert.equal(
      findingCall.context.provenance.imported_at,
      "2026-08-19T00:00:00.000Z",
    );
  });

  test("keeps completed zero explicit and preserves terminal distinctions", async () => {
    const source = await hostileBundle();
    const zero = zeroBundle(source);
    const zeroResult = await importRunBundle(zero, {
      imported_at: "2026-08-19T00:00:00.000Z",
    });
    assert.equal(zeroResult.status, "completed");
    assert.equal(zeroResult.terminal_status, "completed");
    assert.equal(zeroResult.counts.findings, 0);
    assert.equal(zeroResult.events.at(-1)?.event_type, "run.completed");
    for (const status of ["partial", "failed", "cancelled"] as const) {
      const changed = structuredClone(zero) as JsonRecord;
      changed.complete.status = status;
      const result = await importRunBundle(changed, {
        imported_at: "2026-08-19T00:00:00.000Z",
      });
      assert.equal(result.status, status);
      assert.equal(
        result.events.at(-1)?.event_type,
        status === "partial" ? "run.partial" : "run.failed",
      );
    }
  });

  test("rejects the whole bundle before any callback for malformed finding/source data", async () => {
    const bundle = await hostileBundle();
    bundle.batches[0].findings[0].title = 4;
    bundle.batches[0].evidence[0].source = {};
    let callbacks = 0;
    const result = await importRunBundle(bundle, {
      imported_at: "2026-08-19T00:00:00.000Z",
      batch_sink: () => {
        callbacks += 1;
      },
    });
    assert.equal(result.valid, false);
    assert.equal(result.quarantined, true);
    assert.equal(result.callbacks, 0);
    assert.equal(callbacks, 0);
    assert.deepEqual(result.events, []);
  });

  test("keeps IDs stable across import time and separates retry delivery identity", async () => {
    const bundle = await hostileBundle();
    const first = await normalizeRunBundle(bundle, {
      imported_at: "2026-08-19T00:00:00.000Z",
      attempt: 1,
    });
    const retry = await normalizeRunBundle(bundle, {
      imported_at: "2026-08-19T00:01:00.000Z",
      attempt: 2,
    });
    assert.equal(first.bundle_hash, retry.bundle_hash);
    assert.deepEqual(first.event_ids, retry.event_ids);
    assert.notDeepEqual(first.delivery_ids, retry.delivery_ids);
    assert.deepEqual(first.finding_fingerprints, retry.finding_fingerprints);
    assert.notEqual(first.provenance.imported_at, retry.provenance.imported_at);
  });

  test("retains the deterministic bundle hash in validation", async () => {
    const bundle = await hostileBundle();
    const first = await validateRunBundle(bundle);
    const second = await validateRunBundle(bundle);
    assert.equal(first.valid, true);
    assert.equal(first.bundle_hash, second.bundle_hash);
    assert.equal(first.run_id, bundle.run_id);
  });

  test("snapshots before async schema work so caller mutation cannot race validation", async () => {
    const bundle = await hostileBundle();
    const originalFindingId = bundle.batches[0].findings[0].finding_id;
    const sinkBatches: unknown[] = [];
    const pending = importRunBundle(bundle, {
      imported_at: "2026-08-19T00:00:00.000Z",
      batch_sink: async (deliveries) => {
        sinkBatches.push(deliveries);
      },
    });
    bundle.batches[0].findings[0].finding_id = "mutated-after-entry";
    const result = await pending;
    assert.equal(result.imported, true);
    assert.equal(sinkBatches.length, 1);
    const deliveries = sinkBatches[0] as Array<{
      event: AgentFeedDeliveryEvent;
    }>;
    assert.equal(deliveries[1]?.event.finding_id, originalFindingId);
  });

  test("does not expose a permissive caller validator seam", async () => {
    const bundle = await hostileBundle();
    const malformed = structuredClone(bundle) as JsonRecord;
    malformed.batches[0].findings[0].title = 4;
    const permissive = { validate: () => ({ valid: true }) };
    const result = await Reflect.apply(validateRunBundle, null, [
      malformed,
      permissive,
    ]);
    assert.equal(result.valid, false);
  });

  test("public normalization validates before producing events", async () => {
    const bundle = await hostileBundle();
    const malformed = structuredClone(bundle) as JsonRecord;
    malformed.complete.run_id = "other-run-id";
    await assert.rejects(normalizeRunBundle(malformed));
  });

  test("calls one atomic batch sink exactly once and reports no-sink as not imported", async () => {
    const bundle = await hostileBundle();
    let invocations = 0;
    let deliveryCount = 0;
    const imported = await importRunBundle(bundle, {
      imported_at: "2026-08-19T00:00:00.000Z",
      batch_sink: (deliveries) => {
        invocations += 1;
        deliveryCount = deliveries.length;
      },
    });
    assert.equal(invocations, 1);
    assert.equal(deliveryCount, 3);
    assert.equal(imported.sink_invocations, 1);
    assert.equal(imported.imported, true);
    const noSink = await importRunBundle(bundle, {
      imported_at: "2026-08-19T00:00:00.000Z",
    });
    assert.equal(noSink.valid, true);
    assert.equal(noSink.normalized, true);
    assert.equal(noSink.imported, false);
    assert.equal(noSink.accepted, false);
  });

  test("never reports a failed atomic sink as imported and rejects ambiguous sinks", async () => {
    const bundle = await hostileBundle();
    let invocations = 0;
    const failed = await importRunBundle(bundle, {
      imported_at: "2026-08-19T00:00:00.000Z",
      batch_sink: () => {
        invocations += 1;
        throw new Error("sink failed");
      },
    });
    assert.equal(invocations, 1);
    assert.equal(failed.sink_invocations, 1);
    assert.equal(failed.imported, false);
    assert.equal(failed.accepted, false);
    assert.equal(failed.sink_error, "atomic_batch_sink_failed");
    await assert.rejects(
      importRunBundle(bundle, {
        batch_sink: () => undefined,
        sink: () => undefined,
      }),
      /ambiguous_atomic_batch_sink/,
    );
  });

  test("returns deeply frozen, non-aliased output snapshots", async () => {
    const bundle = await hostileBundle();
    const normalized = await normalizeRunBundle(bundle, {
      imported_at: "2026-08-19T00:00:00.000Z",
    });
    assert.equal(Object.isFrozen(normalized), true);
    assert.equal(Object.isFrozen(normalized.events), true);
    assert.equal(Object.isFrozen(normalized.deliveries), true);
    assert.notEqual(normalized.events, normalized.delivery_events);
    assert.notEqual(normalized.events[0], normalized.deliveries[0]?.event);
    assert.notEqual(
      normalized.events[1]?.payload.finding,
      bundle.batches[0].findings[0],
    );
    assert.throws(() => {
      (normalized.events[0] as { event_type: string }).event_type =
        "finding.submitted";
    });
  });
});
