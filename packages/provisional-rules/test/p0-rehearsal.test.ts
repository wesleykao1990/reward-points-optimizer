import { readFile } from "node:fs/promises";
import {
  type AgentFeedDeliveryEvent,
  type AgentFeedFinding,
  canonicalJson,
  importRunBundle,
  mapFindingToObservation,
  normalizeRunBundle,
  prefixedSha256,
  type RunBundleDelivery,
  type SubmittedEvidence,
} from "@jro/agent-feed-consumer";
import { tryValidateDocument } from "@jro/contracts";
import { describe, expect, it } from "vitest";
import {
  createProvisionalRuleStore,
  freezeP0CoverageIndex,
  hashDefinition,
  type ProvisionalRuleCandidate,
} from "../src/index.js";

type JsonValue = Record<string, unknown>;

const IMPORTED_AT = "2026-08-21T00:02:00.000Z";
const ACTIVATED_AT = "2026-08-21T00:04:00Z";
const SOURCE_ID = "merchant.seveneleven.payment-methods";
const EVIDENCE_ID = "ev_m3_seveneleven_payment_methods_20260820";
const SNAPSHOT_ID = "snap_m3_seveneleven_payment_methods_20260820";
const DEFINITION_HASH =
  "sha256:ebea92cf5859e2450aef073d14d19b008cfb2e1cf3cfa7030e5e46a194cb8038";
const CANDIDATE_HASH =
  "sha256:f931acf332c5432cca86af671798fe321353d11e49490d61e45b4df458e250bb";

async function fixture(name: string): Promise<JsonValue> {
  return JSON.parse(
    await readFile(
      new URL(`../../../fixtures/m3/${name}`, import.meta.url),
      "utf8",
    ),
  ) as JsonValue;
}

async function rehearsalInputs(): Promise<{
  bundle: JsonValue;
  coverage: ReturnType<typeof freezeP0CoverageIndex>;
  candidate: ProvisionalRuleCandidate;
}> {
  const bundle = await fixture(
    "agent-feed/jp-cvs-002-payment-acceptance.run-bundle.v0.1.json",
  );
  const coverage = freezeP0CoverageIndex(
    await fixture("provisional/p0-coverage-index.v0.1.json"),
  );
  const candidate = (await fixture(
    "provisional/jp-cvs-002-credit-card-candidate.v0.1.json",
  )) as unknown as ProvisionalRuleCandidate;
  return { bundle, coverage, candidate };
}

function findingDelivery(
  deliveries: readonly RunBundleDelivery[],
): RunBundleDelivery & { event: AgentFeedDeliveryEvent } {
  const delivery = deliveries.find(
    (item) => item.event.event_type === "finding.submitted",
  );
  if (!delivery) throw new Error("finding delivery missing");
  return delivery;
}

describe("JP-CVS-002 local provisional-rule rehearsal", () => {
  it("normalizes, atomically imports, maps, admits, activates, and selects one candidate", async () => {
    const { bundle, coverage, candidate } = await rehearsalInputs();

    const normalized = await normalizeRunBundle(bundle, {
      imported_at: IMPORTED_AT,
    });
    expect(normalized.status).toBe("completed");
    expect(normalized.events).toHaveLength(3);
    expect(normalized.events.map((event) => event.event_type)).toEqual([
      "run.started",
      "finding.submitted",
      "run.completed",
    ]);
    expect(normalized.counts).toMatchObject({
      events: 3,
      started: 1,
      findings: 1,
      terminal: 1,
      evidence: 1,
      batches: 1,
    });

    let sinkInvocations = 0;
    let importedDeliveries: readonly RunBundleDelivery[] = [];
    const imported = await importRunBundle(bundle, {
      imported_at: IMPORTED_AT,
      batch_sink: (deliveries) => {
        sinkInvocations += 1;
        importedDeliveries = deliveries;
      },
    });
    expect(imported.valid).toBe(true);
    expect(imported.imported).toBe(true);
    expect(imported.accepted).toBe(true);
    expect(imported.callbacks).toBe(1);
    expect(imported.sink_invocations).toBe(1);
    expect(sinkInvocations).toBe(1);
    expect(importedDeliveries).toHaveLength(3);
    expect(imported.bundle_hash).toBe(
      "sha256:0d6819ca6d3e0a35d5a31d0a31696a4fc02a0314871279d5c89d399aedc8141d",
    );
    expect(imported.provenance.mode).toBe("local_run_bundle_import");
    expect(imported.provenance.imported_at).toBe(IMPORTED_AT);
    expect(JSON.stringify(bundle).toLowerCase()).not.toContain("hmac");

    const finding = findingDelivery(importedDeliveries);
    const { attempt: _attempt, ...stableFindingEvent } = finding.event;
    expect(prefixedSha256(canonicalJson(stableFindingEvent))).toBe(
      "sha256:42612edd3cf92ac392c913ec7201ca0d489e4d8636f697630a46524bc1e0f377",
    );
    const mapped = mapFindingToObservation({
      event: finding.event,
      finding: finding.event.payload.finding as AgentFeedFinding,
      submitted_evidence: finding.event.payload
        .submitted_evidence as SubmittedEvidence[],
      received_at: IMPORTED_AT,
    });
    expect(mapped).not.toBeNull();
    if (!mapped) return;

    const { observation, submitted_evidence: submittedEvidence } = mapped;
    expect(tryValidateDocument(observation, "source-observation").valid).toBe(
      true,
    );
    expect(observation.observation_id).toBe(candidate.observation_id);
    expect(observation.semantic_fingerprint).toBe(
      candidate.observation_fingerprint,
    );
    expect(observation.source_ids).toEqual([SOURCE_ID]);
    expect(observation.change_type).toBe("merchant_acceptance");
    expect(observation.discovery_assessment.source_authority_claim).toBe(
      "primary",
    );
    expect(observation.status).toBe("needs_review");
    expect(observation.submitted_evidence_refs).toEqual([EVIDENCE_ID]);
    expect(observation.canonical_evidence_ids).toEqual([]);
    expect(observation.security_flags).toEqual([]);
    expect(candidate.p0_family_id).toBe("merchant.7eleven");
    expect(candidate.source_role_id).toBe("accepted_payment_methods");
    expect(candidate.source_authority_role).toBe("primary");
    expect(candidate.source_ids).toEqual([SOURCE_ID]);
    expect(coverage.entries).toEqual([
      {
        family_id: "merchant.7eleven",
        source_role_id: "accepted_payment_methods",
        known_source_ids: [SOURCE_ID],
      },
    ]);
    expect(submittedEvidence).toHaveLength(1);
    expect(submittedEvidence[0]).toMatchObject({
      observation_id: observation.observation_id,
      agent_feed_evidence_id: EVIDENCE_ID,
      promotion_status: "lead_only",
      submitted_payload: {
        content_hash:
          "sha256:637988f93599ec46f8249b954e0e01130311e0491dd1f25a5b126a7264d6985c",
        metadata: { source_snapshot_id: SNAPSHOT_ID },
      },
    });
    expect(JSON.stringify(finding.event.payload).toLowerCase()).not.toContain(
      "hmac",
    );

    expect(hashDefinition(candidate.rule)).toBe(DEFINITION_HASH);
    expect(candidate.rule.status).toBe("under_review");
    expect(candidate.rule.provenance.human_verified).toBe(false);
    expect(candidate.rule.audit.review_mode).toBeNull();
    expect(candidate.rule.audit.reviewed_at).toBeNull();
    expect(candidate.rule.audit.reviewed_by).toBeNull();
    expect(candidate.rule.audit.review_events).toEqual([]);
    expect(Date.parse(candidate.machine_check.checked_at)).toBeGreaterThan(
      Date.parse(observation.updated_at),
    );
    expect(Date.parse(ACTIVATED_AT)).toBeGreaterThan(
      Date.parse(candidate.machine_check.checked_at),
    );

    const store = createProvisionalRuleStore();
    const admitted = store.admit({
      candidate,
      observation,
      p0_coverage_index: coverage,
    });
    expect(admitted.ok).toBe(true);
    if (!admitted.ok) return;
    expect(admitted.status).toBe("machine_checked");
    expect(admitted.candidate_hash).toBe(CANDIDATE_HASH);
    expect(admitted.definition_hash).toBe(DEFINITION_HASH);

    const activated = store.activate(admitted.candidate_hash, ACTIVATED_AT);
    expect(activated.ok).toBe(true);
    if (!activated.ok) return;
    expect(activated.envelope.status).toBe("active_experimental");

    const selected = store.select({ p0_family_id: "merchant.7eleven" });
    expect(selected).toHaveLength(1);
    expect(selected[0]?.candidate.rule.rule_id).toBe(
      "rr_jp_cvs_002_b_accept_credit_card",
    );
    expect(selected[0]?.candidate.rule.status).toBe("under_review");
    expect(selected[0]?.status).toBe("active_experimental");
  });

  it("rejects malformed bundles before any sink callback and rejects role/source drift", async () => {
    const { bundle, coverage, candidate } = await rehearsalInputs();
    const normalized = await normalizeRunBundle(bundle, {
      imported_at: IMPORTED_AT,
    });
    const finding = findingDelivery(normalized.deliveries);
    const mapped = mapFindingToObservation({
      event: finding.event,
      finding: finding.event.payload.finding as AgentFeedFinding,
      submitted_evidence: finding.event.payload
        .submitted_evidence as SubmittedEvidence[],
      received_at: IMPORTED_AT,
    });
    if (!mapped) throw new Error("fixture finding did not map");
    const observation = mapped.observation;

    const malformed = structuredClone(bundle);
    const batch = malformed.batches as JsonValue[];
    const malformedFindings = batch[0]?.findings as JsonValue[];
    if (!malformedFindings[0]) throw new Error("fixture finding missing");
    malformedFindings[0].title = 7;

    let sinkInvocations = 0;
    const rejected = await importRunBundle(malformed, {
      imported_at: IMPORTED_AT,
      batch_sink: () => {
        sinkInvocations += 1;
      },
    });
    expect(rejected.valid).toBe(false);
    expect(rejected.quarantined).toBe(true);
    expect(rejected.callbacks).toBe(0);
    expect(rejected.sink_invocations).toBe(0);
    expect(sinkInvocations).toBe(0);
    expect(rejected.events).toEqual([]);

    const wrongRole = {
      ...candidate,
      source_role_id: "merchant_profile",
    };
    const roleRejected = createProvisionalRuleStore().admit({
      candidate: wrongRole,
      observation,
      p0_coverage_index: coverage,
    });
    expect(roleRejected.ok).toBe(false);
    if (!roleRejected.ok)
      expect(
        roleRejected.issues.some(
          (issue) => issue.code === "source_role_coverage_mismatch",
        ),
      ).toBe(true);

    const changedSource = {
      ...candidate,
      source_ids: ["merchant.seveneleven.payment-methods.changed"],
    };
    const sourceRejected = createProvisionalRuleStore().admit({
      candidate: changedSource,
      observation,
      p0_coverage_index: coverage,
    });
    expect(sourceRejected.ok).toBe(false);
    if (!sourceRejected.ok)
      expect(
        sourceRejected.issues.some(
          (issue) => issue.code === "source_unregistered",
        ),
      ).toBe(true);
  });
});
