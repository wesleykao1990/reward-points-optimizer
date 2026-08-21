import { readFile } from "node:fs/promises";
import {
  type AgentFeedFinding,
  importRunBundle,
  mapFindingToObservation,
  type SubmittedEvidence,
} from "@jro/agent-feed-consumer";
import { describe, expect, it } from "vitest";
import {
  createProvisionalRuleStore,
  freezeP0CoverageIndex,
  P0_SOURCE_ROLE_PLAN_SHA256,
  PROVISIONAL_PUBLICATION_BATCH_VERSION,
} from "../src/index.js";

const IMPORTED_AT = "2026-08-21T04:51:00Z";
const PUBLISHED_AT = "2026-08-21T04:53:00Z";

async function fixture(path: string): Promise<unknown> {
  return JSON.parse(
    await readFile(
      new URL(`../../../fixtures/m3/${path}`, import.meta.url),
      "utf8",
    ),
  );
}

describe("P0 Seven-Eleven payment-family batch", () => {
  it("imports one current-source finding and atomically publishes eleven supported families", async () => {
    const [bundle, candidateSet, coverageValue] = await Promise.all([
      fixture(
        "agent-feed/p0-seveneleven-payment-families.run-bundle.v0.1.json",
      ),
      fixture("provisional/p0-seveneleven-payment-family-candidates.v0.1.json"),
      fixture("provisional/p0-coverage-index.v0.1.json"),
    ]);
    const imported = await importRunBundle(bundle, {
      imported_at: IMPORTED_AT,
      batch_sink: () => undefined,
    });
    expect(imported.accepted).toBe(true);
    expect(imported.status).toBe("completed");
    expect(imported.bundle_hash).toBe(
      "sha256:afdcb4dc495882f38a1c88c111c5a8dc9ecaaaccb164c3d07d09a8c0c5b0b3b0",
    );
    const delivery = imported.deliveries.find(
      (item) => item.event.event_type === "finding.submitted",
    );
    if (!delivery) throw new Error("finding delivery missing");
    const mapped = mapFindingToObservation({
      event: delivery.event,
      finding: delivery.event.payload.finding as AgentFeedFinding,
      submitted_evidence: delivery.event.payload
        .submitted_evidence as SubmittedEvidence[],
      received_at: IMPORTED_AT,
    });
    if (!mapped) throw new Error("finding mapping rejected");

    const set = candidateSet as {
      candidates: Array<{
        payment_family: string;
        display_name_ja: string;
        candidate: Record<string, unknown>;
      }>;
    };
    expect(set.candidates).toHaveLength(11);
    const coverage = freezeP0CoverageIndex(coverageValue);
    const store = createProvisionalRuleStore();
    const result = store.publishBatch({
      version: PROVISIONAL_PUBLICATION_BATCH_VERSION,
      batch_id: "batch_p0_seveneleven_payment_families_20260821",
      plan_sha256: P0_SOURCE_ROLE_PLAN_SHA256,
      published_at: PUBLISHED_AT,
      members: set.candidates.map((item) => ({
        member_id: `member_${item.payment_family}`,
        admission_request: {
          candidate: item.candidate,
          observation: mapped.observation,
          p0_coverage_index: coverage,
        },
      })),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.batch.published).toHaveLength(11);
    expect(store.select()).toHaveLength(11);
    expect(
      store
        .select()
        .map((item) => item.rule.effect?.reason_code)
        .sort(),
    ).toEqual(
      set.candidates
        .map((item) => `accepted_payment_family_${item.payment_family}`)
        .sort(),
    );
  });

  it("rejects an unsupported payment family before any store mutation", async () => {
    const [bundle, candidateSet, coverageValue] = await Promise.all([
      fixture(
        "agent-feed/p0-seveneleven-payment-families.run-bundle.v0.1.json",
      ),
      fixture("provisional/p0-seveneleven-payment-family-candidates.v0.1.json"),
      fixture("provisional/p0-coverage-index.v0.1.json"),
    ]);
    const imported = await importRunBundle(bundle, {
      imported_at: IMPORTED_AT,
      batch_sink: () => undefined,
    });
    const delivery = imported.deliveries.find(
      (item) => item.event.event_type === "finding.submitted",
    );
    if (!delivery) throw new Error("finding delivery missing");
    const mapped = mapFindingToObservation({
      event: delivery.event,
      finding: delivery.event.payload.finding as AgentFeedFinding,
      submitted_evidence: delivery.event.payload
        .submitted_evidence as SubmittedEvidence[],
      received_at: IMPORTED_AT,
    });
    if (!mapped) throw new Error("finding mapping rejected");
    const set = candidateSet as {
      candidates: Array<{ candidate: Record<string, unknown> }>;
    };
    const forged = structuredClone(set.candidates[0]?.candidate);
    if (!forged) throw new Error("candidate missing");
    const rule = forged.rule as Record<string, unknown>;
    const effect = rule.effect as Record<string, unknown>;
    effect.reason_code = "accepted_payment_family_invented_wallet";
    const store = createProvisionalRuleStore();
    const result = store.publishBatch({
      version: PROVISIONAL_PUBLICATION_BATCH_VERSION,
      batch_id: "batch_p0_seveneleven_unsupported_20260821",
      plan_sha256: P0_SOURCE_ROLE_PLAN_SHA256,
      published_at: PUBLISHED_AT,
      members: [
        {
          member_id: "member_invented_wallet",
          admission_request: {
            candidate: forged,
            observation: mapped.observation,
            p0_coverage_index: freezeP0CoverageIndex(coverageValue),
          },
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(
        result.issues.some((item) =>
          item.admission_issues?.some(
            (admission) => admission.code === "semantic_support_mismatch",
          ),
        ),
      ).toBe(true);
    expect(store.select()).toEqual([]);
  });
});
