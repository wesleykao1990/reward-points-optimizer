import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  type AgentFeedDeliveryEvent,
  createFallbackSchemaValidator,
  signRawBody,
} from "@jro/agent-feed-consumer";
import {
  ATOMIC_FUNCTION_QUERY,
  P0_TERMINAL_RECONCILIATION_QUERY,
  type P0RewardClaimBatchResult,
  type QueryResult,
  type QueryTarget,
} from "@jro/agent-feed-postgres";
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
  AGENT_FEED_INTERNAL_EVENT_PATH,
  createP0AgentFeedIngress,
  loadP0AgentFeedIngressFromEnvironment,
  P0_RECONCILIATION_MAP_VERSION,
  type P0RewardClaimBindingResolver,
  type P0RewardClaimProcessor,
} from "../src/agent-feed-ingress.js";
import { handleRequest } from "../src/server.js";

const planPath = resolve(
  process.cwd(),
  "../../registry/planning/p0-source-role-plan.v0.1.json",
);
const coveragePath = resolve(
  process.cwd(),
  "../../fixtures/m3/provisional/p0-coverage-index.v0.6.json",
);
const RECEIPT_ID = "00000000-0000-4000-8000-000000000021";
const SIGNING_SECRET = "consumer-alpha-agent-feed-test-secret";
const RECEIVED_AT = "2026-08-22T00:00:00.000Z";
const SIGNING_TIMESTAMP = Math.floor(Date.parse(RECEIVED_AT) / 1000);

function admittedPlan(): P0SourceRolePlan {
  const admission = admitP0SourceRolePlan(
    JSON.parse(readFileSync(planPath, "utf8")) as unknown,
  );
  if (!admission.ok) throw new Error(JSON.stringify(admission.issues));
  return admission.plan;
}

function fixture() {
  const plan = admittedPlan();
  const manifest = buildP0OperationsManifest(plan);
  const unit = buildP0FamilyWorkUnit(
    plan,
    "merchant.jp-convenience",
    "merchant.7eleven",
  );
  const runId = "run-consumer-alpha-ingress";
  const eventId = "event-consumer-alpha-ingress";
  const streamId = "merchant.jp-convenience";
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
    checkpoints: unit.targets.map((target, index) => ({
      version: P0_TARGET_CHECKPOINT_VERSION,
      manifest_sha256: manifest.manifest_sha256,
      target_id: target.target_id,
      stream_id: streamId,
      family_id: target.family_id,
      source_role_id: target.source_role_id,
      attempt_number: index + 1,
      observed_at: `2026-08-22T00:00:0${index + 1}+00:00`,
      outcome: "resolved" as const,
      run_id: runId,
      event_id: eventId,
      receipt_id: "p0-placeholder",
      idempotency_key: `consumer-alpha-ingress-${index + 1}`,
      input_sha256: `sha256:${"a".repeat(64)}`,
      locator: "https://example.test/official",
      locator_fingerprint: `sha256:${"b".repeat(64)}`,
      economic_findings_accepted: 0,
    })),
  };
  const event: AgentFeedDeliveryEvent = {
    protocol_version: "0.1",
    event_id: eventId,
    event_type: "run.completed",
    stream_id: streamId,
    run_id: runId,
    finding_id: null,
    occurred_at: RECEIVED_AT,
    attempt: 1,
    payload: {
      status: "completed",
      completed_at: RECEIVED_AT,
      actual_scope: { source_ids: [], subjects: [], queries: [], metadata: {} },
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
  return { manifest, reconciliation, event };
}

type FakeTarget = QueryTarget & { calls: string[] };

function clientFor(
  outcome: "inserted" | "duplicate",
  options: { mapped?: boolean } = {},
): FakeTarget {
  const calls: string[] = [];
  const target = {
    calls,
    query<Row = unknown>(text: string): Promise<QueryResult<Row>> {
      calls.push(text);
      if (text === ATOMIC_FUNCTION_QUERY) {
        const mapped = options.mapped === true;
        return Promise.resolve({
          rows: [
            {
              receipt_id: RECEIPT_ID,
              status: mapped
                ? outcome === "duplicate"
                  ? "duplicate"
                  : "mapped"
                : outcome,
              observation: null,
              duplicate_kind: outcome === "duplicate" ? "transport" : null,
              duplicate_of_receipt_id:
                outcome === "duplicate" ? RECEIPT_ID : null,
              reason_code: null,
            },
          ],
        }) as Promise<QueryResult<Row>>;
      }
      if (text === P0_TERMINAL_RECONCILIATION_QUERY)
        return Promise.resolve({
          rows: [
            outcome === "duplicate"
              ? { inserted_count: 0, duplicate_count: 6 }
              : { inserted_count: 6, duplicate_count: 0 },
          ],
        }) as Promise<QueryResult<Row>>;
      return Promise.resolve({ rows: [] }) as Promise<QueryResult<Row>>;
    },
  };
  return target as FakeTarget;
}

function signedRequest(
  event: AgentFeedDeliveryEvent,
  body = JSON.stringify(event),
) {
  return {
    raw_body: body,
    received_at: RECEIVED_AT,
    headers: {
      "x-agent-feed-event-id": event.event_id,
      "x-agent-feed-delivery-id": "delivery-consumer-alpha-ingress",
      "x-agent-feed-attempt": String(event.attempt),
      "x-agent-feed-protocol-version": "0.1",
      "x-agent-feed-timestamp": String(SIGNING_TIMESTAMP),
      "x-agent-feed-key-id": "consumer-alpha-test-key",
      "x-agent-feed-signature": signRawBody(
        body,
        SIGNING_TIMESTAMP,
        SIGNING_SECRET,
      ),
    },
  };
}

function rewardClaimEvent(includeClaims = true): AgentFeedDeliveryEvent {
  const { event } = fixture();
  const findingId = "finding_reward_claim_ingress";
  const attributes: Record<string, unknown> = {
    change_type: "reward_rate",
    source_id: "source.reward-claim.test",
    ...(includeClaims
      ? {
          reward_claims: {
            version: "reward-claim.v1",
            claims: [{ claim_id: "claim_ingress_test", claim_type: "fixed" }],
          },
        }
      : {}),
  };
  return {
    ...event,
    event_id: "event_reward_claim_ingress",
    event_type: "finding.submitted",
    finding_id: findingId,
    payload: {
      finding: {
        finding_id: findingId,
        finding_type: "rewards.program_change",
        title: "Structured reward claim",
        summary: "A structured reward claim test observation.",
        subjects: [
          { type: "payment_program", id: "program.test", name: "Test" },
        ],
        effective_time: {
          occurred_at: RECEIVED_AT,
          effective_from: null,
          effective_to: null,
        },
        assessment: {
          novelty: "new",
          source_authority_claim: "primary",
          evidence_completeness: "complete",
          agent_confidence: null,
        },
        evidence_refs: [],
        producer_dedupe_key: "reward-claim-ingress-test",
        routing_tags: ["rewards"],
        attributes,
        security_flags: [],
      },
      submitted_evidence: [],
    },
  };
}

const REWARD_CLAIM_BINDING = {
  family_id: "test.family",
  source_role_id: "test_role",
  source_ids: ["source.reward-claim.test"],
  p0_coverage_index: {
    version: "p0-coverage-index.v1",
    entries: [
      {
        family_id: "test.family",
        source_role_id: "test_role",
        known_source_ids: ["source.reward-claim.test"],
      },
    ],
  },
} as const;

function ingress(
  manifest: P0OperationsManifest,
  reconciliation: P0ReceiptReconciliation,
  target: ReturnType<typeof clientFor>,
  rewardClaims: {
    processor?: P0RewardClaimProcessor;
    bindingResolver?: P0RewardClaimBindingResolver;
  } = {},
) {
  return createP0AgentFeedIngress({
    target,
    manifest,
    reconciliation_by_run_id: { [reconciliation.run_id]: reconciliation },
    signing_key: {
      environment: {
        JRO_AGENT_FEED_SIGNING_KEY_ID: "consumer-alpha-test-key",
        JRO_AGENT_FEED_SIGNING_SECRET: SIGNING_SECRET,
      },
    },
    schema_validator: createFallbackSchemaValidator(),
    now: () => new Date(RECEIVED_AT),
    reward_claim_coverage_index: REWARD_CLAIM_BINDING.p0_coverage_index,
    ...(rewardClaims.processor === undefined
      ? {}
      : { reward_claim_processor: rewardClaims.processor }),
    ...(rewardClaims.bindingResolver === undefined
      ? {}
      : { reward_claim_binding_resolver: rewardClaims.bindingResolver }),
  });
}

describe("consumer-alpha internal Agent Feed ingress", () => {
  it("loads only a complete current-plan reconciliation configuration", () => {
    const { manifest, reconciliation } = fixture();
    const subset: P0ReceiptReconciliation = {
      ...reconciliation,
      checkpoints: reconciliation.checkpoints.slice(0, 1),
    };
    const mapFile = JSON.stringify({
      version: P0_RECONCILIATION_MAP_VERSION,
      plan_sha256: manifest.plan_sha256,
      manifest_sha256: manifest.manifest_sha256,
      reconciliations: { [subset.run_id]: subset },
    });
    const planText = readFileSync(planPath, "utf8");
    const coverageText = readFileSync(coveragePath, "utf8");
    const files: Record<string, string> = {
      "/p0-plan.json": planText,
      "/p0-map.json": mapFile,
      "/p0-coverage.json": coverageText,
    };
    const loaded = loadP0AgentFeedIngressFromEnvironment({
      environment: {
        JRO_P0_SOURCE_ROLE_PLAN_FILE: "/p0-plan.json",
        JRO_P0_COVERAGE_INDEX_FILE: "/p0-coverage.json",
        JRO_AGENT_FEED_RECONCILIATION_FILE: "/p0-map.json",
        JRO_AGENT_FEED_SIGNING_KEY_ID: "consumer-alpha-test-key",
        JRO_AGENT_FEED_SIGNING_SECRET: SIGNING_SECRET,
      },
      read_file(path) {
        const value = files[path];
        if (value === undefined) throw new Error("missing_fixture_file");
        return value;
      },
    });
    expect(loaded).toMatchObject({
      manifest: {
        plan_sha256: manifest.plan_sha256,
        manifest_sha256: manifest.manifest_sha256,
      },
      reconciliation_by_run_id: {
        [subset.run_id]: {
          checkpoints: [{ target_id: subset.checkpoints[0]?.target_id }],
        },
      },
      signing_key: {
        key_id: "consumer-alpha-test-key",
        secret: SIGNING_SECRET,
      },
      reward_claim_coverage_index: {
        version: "p0-coverage-index.v0.6",
      },
    });
  });

  it("rejects partial runtime configuration before reading a file", () => {
    expect(() =>
      loadP0AgentFeedIngressFromEnvironment({
        environment: {
          JRO_AGENT_FEED_RECONCILIATION_FILE: "/p0-map.json",
        },
        read_file() {
          throw new Error("must_not_read");
        },
      }),
    ).toThrow("jro_agent_feed_runtime_config_incomplete");
  });

  it("rejects a stale wrapper manifest instead of activating the endpoint", () => {
    const { manifest, reconciliation } = fixture();
    const planText = readFileSync(planPath, "utf8");
    const files: Record<string, string> = {
      "/p0-plan.json": planText,
      "/p0-map.json": JSON.stringify({
        version: P0_RECONCILIATION_MAP_VERSION,
        plan_sha256: manifest.plan_sha256,
        manifest_sha256: `sha256:${"f".repeat(64)}`,
        reconciliations: { [reconciliation.run_id]: reconciliation },
      }),
    };
    expect(() =>
      loadP0AgentFeedIngressFromEnvironment({
        environment: {
          JRO_P0_SOURCE_ROLE_PLAN_FILE: "/p0-plan.json",
          JRO_AGENT_FEED_RECONCILIATION_FILE: "/p0-map.json",
          JRO_AGENT_FEED_SIGNING_KEY_ID: "consumer-alpha-test-key",
          JRO_AGENT_FEED_SIGNING_SECRET: SIGNING_SECRET,
        },
        read_file(path) {
          const value = files[path];
          if (value === undefined) throw new Error("missing_fixture_file");
          return value;
        },
      }),
    ).toThrow("jro_agent_feed_reconciliation_file_invalid");
  });

  it("rejects a changed raw body before any database transaction", async () => {
    const { manifest, reconciliation, event } = fixture();
    const target = clientFor("inserted");
    const body = JSON.stringify({ ...event, attempt: 2 });
    const request = signedRequest(event);
    const response = await ingress(manifest, reconciliation, target).handle({
      ...request,
      raw_body: body,
    });
    expect(response).toMatchObject({
      status_code: 401,
      acknowledged: false,
      error_code: "signature_mismatch",
    });
    expect(JSON.stringify(response)).not.toContain(SIGNING_SECRET);
    expect(target.calls).toEqual([]);
  });

  it("automatically processes explicitly structured claims after durable mapping", async () => {
    const { manifest, reconciliation } = fixture();
    const target = clientFor("inserted", { mapped: true });
    const processed: unknown[] = [];
    const processor: P0RewardClaimProcessor = async (value) => {
      expect(target.calls.at(-1)).toBe("COMMIT");
      processed.push(value);
      return {
        ok: true,
        status: "inserted",
        members: [],
        issues: [],
      };
    };
    const bindingResolver: P0RewardClaimBindingResolver = (observation) => {
      expect(observation.discovery_assessment.source_authority_claim).toBe(
        "primary",
      );
      return REWARD_CLAIM_BINDING;
    };
    const response = await ingress(manifest, reconciliation, target, {
      processor,
      bindingResolver,
    }).handle(signedRequest(rewardClaimEvent()));

    expect(response).toMatchObject({ status_code: 200, acknowledged: true });
    expect(processed).toHaveLength(1);
    expect(processed[0]).toMatchObject({
      version: "p0-reward-claim-batch.v1",
      observations: [
        {
          binding: REWARD_CLAIM_BINDING,
          observation: {
            raw_attributes: {
              reward_claims: { version: "reward-claim.v1" },
            },
          },
        },
      ],
    });
  });

  it("does not invoke structured processing when reward_claims is absent", async () => {
    const { manifest, reconciliation } = fixture();
    const target = clientFor("inserted", { mapped: true });
    let calls = 0;
    const response = await ingress(manifest, reconciliation, target, {
      processor: async () => {
        calls += 1;
        throw new Error("processor must not run");
      },
      bindingResolver: () => REWARD_CLAIM_BINDING,
    }).handle(signedRequest(rewardClaimEvent(false)));

    expect(response).toMatchObject({ status_code: 200, acknowledged: true });
    expect(calls).toBe(0);
  });

  it("ACKs semantic claim rejections without suppressing the mapped receipt", async () => {
    const { manifest, reconciliation } = fixture();
    const target = clientFor("inserted", { mapped: true });
    const rejected: P0RewardClaimBatchResult = {
      ok: false,
      status: "rejected",
      members: [{ claim_id: "bad", status: "rejected" }],
      issues: [
        {
          code: "claim_invalid",
          path: "/claims/bad",
          message: "incomplete claim",
        },
      ],
    };
    const response = await ingress(manifest, reconciliation, target, {
      processor: async () => rejected,
      bindingResolver: () => REWARD_CLAIM_BINDING,
    }).handle(signedRequest(rewardClaimEvent()));

    expect(response).toMatchObject({
      status_code: 200,
      acknowledged: true,
      outcome: { reward_claims: rejected },
    });
  });

  it("leaves a mapped delivery retryable when reward persistence fails transiently", async () => {
    const { manifest, reconciliation } = fixture();
    const target = clientFor("inserted", { mapped: true });
    const response = await ingress(manifest, reconciliation, target, {
      processor: async () => {
        throw new Error("transient reward persistence failure");
      },
      bindingResolver: () => REWARD_CLAIM_BINDING,
    }).handle(signedRequest(rewardClaimEvent()));

    expect(response).toMatchObject({
      status_code: 500,
      acknowledged: false,
      error_code: "durable_persistence_failed",
    });
    expect(target.calls).toEqual(["BEGIN", ATOMIC_FUNCTION_QUERY, "COMMIT"]);
  });

  it("persists and reconciles an exact terminal event, then remains idempotent", async () => {
    const { manifest, reconciliation, event } = fixture();
    const firstTarget = clientFor("inserted");
    const first = await ingress(manifest, reconciliation, firstTarget).handle(
      signedRequest(event),
    );
    expect(first).toMatchObject({
      status_code: 200,
      acknowledged: true,
      outcome: { status: "inserted", receipt_id: RECEIPT_ID },
    });
    expect(JSON.stringify(first)).not.toContain(SIGNING_SECRET);
    expect(firstTarget.calls).toEqual([
      "BEGIN",
      ATOMIC_FUNCTION_QUERY,
      P0_TERMINAL_RECONCILIATION_QUERY,
      "COMMIT",
    ]);

    const duplicateTarget = clientFor("duplicate");
    const duplicate = await ingress(
      manifest,
      reconciliation,
      duplicateTarget,
    ).handle(signedRequest(event));
    expect(duplicate).toMatchObject({
      status_code: 200,
      acknowledged: true,
      outcome: { status: "duplicate", duplicate_kind: "transport" },
    });
    expect(duplicateTarget.calls).toEqual([
      "BEGIN",
      ATOMIC_FUNCTION_QUERY,
      P0_TERMINAL_RECONCILIATION_QUERY,
      "COMMIT",
    ]);
  });

  it("fails closed when the host mapping does not match the manifest run", () => {
    const { manifest, reconciliation } = fixture();
    expect(() =>
      createP0AgentFeedIngress({
        target: clientFor("inserted"),
        manifest,
        reconciliation_by_run_id: {
          wrongRun: reconciliation,
        },
        signing_key: {
          secret: SIGNING_SECRET,
          key_id: "consumer-alpha-test-key",
        },
      }),
    ).toThrow("agent_feed_reconciliation_map_identity_mismatch");
  });

  it("keeps the ingress on one exact POST path and leaves it disabled without a host port", async () => {
    const get = await handleRequest({
      method: "GET",
      pathname: AGENT_FEED_INTERNAL_EVENT_PATH,
    });
    expect(get.status).toBe(405);
    expect(get.headers.Allow).toBe("POST");

    const missing = await handleRequest({
      method: "POST",
      pathname: AGENT_FEED_INTERNAL_EVENT_PATH,
      body: "{}",
    });
    expect(missing.status).toBe(404);
  });

  it("passes the signed bytes unchanged through the configured server-only port", async () => {
    const { manifest, reconciliation, event } = fixture();
    const target = clientFor("inserted");
    const port = ingress(manifest, reconciliation, target);
    const request = signedRequest(event);
    const response = await handleRequest(
      {
        method: "POST",
        pathname: AGENT_FEED_INTERNAL_EVENT_PATH,
        headers: request.headers,
        body: request.raw_body,
      },
      { agentFeedIngress: port },
    );
    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      acknowledged: true,
      outcome: { status: "inserted", receipt_id: RECEIPT_ID },
    });
  });
});
