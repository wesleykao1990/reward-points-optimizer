import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  admitP0SourceRolePlan,
  buildP0FamilyWorkUnit,
  buildP0OperationsManifest,
  P0_RECEIPT_RECONCILIATION_VERSION,
  P0_TARGET_CHECKPOINT_VERSION,
  type P0OperationsManifest,
  type P0OperationTarget,
  type P0SourceRolePlan,
  type P0TargetCheckpoint,
  type P0TargetOutcome,
  reconcileP0AgentFeedReceipt,
  reduceP0TargetCheckpoints,
  selectP0RetryTargets,
} from "../src/index.js";

const artifactPath = resolve(
  process.cwd(),
  "../../registry/planning/p0-source-role-plan.v0.1.json",
);
const INPUT_A = `sha256:${"a".repeat(64)}`;
const INPUT_B = `sha256:${"b".repeat(64)}`;
const LOCATOR_HASH = `sha256:${"c".repeat(64)}`;

function rawPlan(): Record<string, unknown> {
  return JSON.parse(readFileSync(artifactPath, "utf8")) as Record<
    string,
    unknown
  >;
}

function plan(raw: unknown = rawPlan()): P0SourceRolePlan {
  const result = admitP0SourceRolePlan(raw);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.plan;
}

function target(
  manifest: P0OperationsManifest,
  familyId = "merchant.7eleven",
): P0OperationTarget {
  const value = manifest.streams
    .flatMap((stream) => stream.targets)
    .find((item) => item.family_id === familyId);
  if (!value) throw new Error("target missing");
  return value;
}

function checkpoint(
  manifest: P0OperationsManifest,
  item: P0OperationTarget,
  options: {
    attempt?: number;
    observed?: string;
    outcome?: P0TargetOutcome;
    input?: string;
    key?: string;
    run?: string;
    receipt?: string;
  } = {},
): P0TargetCheckpoint {
  const outcome = options.outcome ?? "resolved";
  return {
    version: P0_TARGET_CHECKPOINT_VERSION,
    manifest_sha256: manifest.manifest_sha256,
    target_id: item.target_id,
    stream_id: item.stream_id,
    family_id: item.family_id,
    source_role_id: item.source_role_id,
    attempt_number: options.attempt ?? 1,
    observed_at: options.observed ?? "2026-08-21T00:00:00+09:00",
    outcome,
    run_id: options.run ?? "run-p0-test",
    event_id: `event-${item.target_id.slice(-10)}-${options.attempt ?? 1}`,
    receipt_id: options.receipt ?? "receipt-p0-test",
    idempotency_key:
      options.key ?? `checkpoint-${item.target_id}-${options.attempt ?? 1}`,
    input_sha256: options.input ?? INPUT_A,
    locator: outcome === "resolved" ? "https://example.test/official" : null,
    locator_fingerprint: outcome === "resolved" ? LOCATOR_HASH : null,
    economic_findings_accepted: 0,
  };
}

describe("P0 operations manifest", () => {
  it("projects the exact 44-family, 19-stream, 301-target universe", () => {
    const manifest = buildP0OperationsManifest(plan());
    expect(manifest.family_count).toBe(44);
    expect(manifest.stream_count).toBe(19);
    expect(manifest.target_count).toBe(301);
    expect(new Set(manifest.streams.map((item) => item.stream_id)).size).toBe(
      19,
    );
    expect(Object.isFrozen(manifest)).toBe(true);
  });

  it("keeps manifest and work-unit hashes stable under semantic reordering", () => {
    const reordered = rawPlan();
    reordered.families = [
      ...((reordered.families as Record<string, unknown>[]).map((family) => ({
        ...family,
        required_source_roles: [
          ...(family.required_source_roles as string[]),
        ].reverse(),
      })) as Record<string, unknown>[]),
    ].reverse();
    const first = buildP0OperationsManifest(plan());
    const second = buildP0OperationsManifest(plan(reordered));
    expect(second.manifest_sha256).toBe(first.manifest_sha256);
    const family = plan().families[0];
    if (!family) throw new Error("family missing");
    expect(
      buildP0FamilyWorkUnit(plan(), family.stream_id, family.family_id).targets
        .length,
    ).toBeLessThanOrEqual(8);
    expect(() =>
      buildP0FamilyWorkUnit(plan(), family.stream_id, "family.unknown"),
    ).toThrow("p0_family_stream_mismatch");
  });
});

describe("P0 target checkpoints", () => {
  it("keeps cumulative locator success after a later timeout", () => {
    const manifest = buildP0OperationsManifest(plan());
    const item = target(manifest);
    const resolved = checkpoint(manifest, item);
    const timeout = checkpoint(manifest, item, {
      attempt: 2,
      observed: "2026-08-22T00:00:00+09:00",
      outcome: "timeout",
    });
    const progress = reduceP0TargetCheckpoints(manifest, [
      resolved,
      timeout,
    ]).find((entry) => entry.target.target_id === item.target_id);
    expect(progress?.latest?.outcome).toBe("timeout");
    expect(progress?.last_resolved?.outcome).toBe("resolved");
    expect(progress?.locator_covered).toBe(true);
  });

  it("retries stale or unresolved targets and holds a rejected input identity", () => {
    const manifest = buildP0OperationsManifest(plan());
    const item = target(manifest);
    const rejected = checkpoint(manifest, item, {
      outcome: "validation_rejected",
    });
    expect(
      selectP0RetryTargets(manifest, [rejected], {
        effective_at: "2026-08-22T00:00:00+09:00",
        input_sha256: INPUT_A,
      }).targets.some((entry) => entry.target_id === item.target_id),
    ).toBe(false);
    expect(
      selectP0RetryTargets(manifest, [rejected], {
        effective_at: "2026-08-22T00:00:00+09:00",
        input_sha256: INPUT_B,
      }).targets.some((entry) => entry.target_id === item.target_id),
    ).toBe(true);

    const resolved = checkpoint(manifest, item);
    expect(
      selectP0RetryTargets(manifest, [resolved], {
        effective_at: "2026-08-21T00:00:01+09:00",
        input_sha256: INPUT_A,
        stale_after_seconds: 60,
      }).targets.some((entry) => entry.target_id === item.target_id),
    ).toBe(false);
    expect(
      selectP0RetryTargets(manifest, [resolved], {
        effective_at: "2026-08-21T00:01:00+09:00",
        input_sha256: INPUT_A,
        stale_after_seconds: 60,
      }).targets.some((entry) => entry.target_id === item.target_id),
    ).toBe(true);
  });

  it("makes exact checkpoint replay idempotent and rejects hostile drift", () => {
    const manifest = buildP0OperationsManifest(plan());
    const item = target(manifest);
    const value = checkpoint(manifest, item);
    const progress = reduceP0TargetCheckpoints(manifest, [value, value]).find(
      (entry) => entry.target.target_id === item.target_id,
    );
    expect(progress?.economic_findings_accepted).toBe(0);
    expect(() =>
      reduceP0TargetCheckpoints(manifest, [
        value,
        {
          ...value,
          outcome: "timeout",
          locator: null,
          locator_fingerprint: null,
        },
      ]),
    ).toThrow("p0_checkpoint_idempotency_conflict");
    expect(() =>
      reduceP0TargetCheckpoints(manifest, [new Proxy(value, {})]),
    ).toThrow("p0_checkpoint_invalid");
    expect(() =>
      reduceP0TargetCheckpoints(manifest, [{ ...value, forged: true }]),
    ).toThrow("p0_checkpoint_invalid");
  });
});

describe("P0 receipt reconciliation", () => {
  it("preflights a complete receipt and rejects partial completion without mutation", () => {
    const currentPlan = plan();
    const manifest = buildP0OperationsManifest(currentPlan);
    const family = currentPlan.families.find(
      (item) => item.family_id === "merchant.7eleven",
    );
    if (!family) throw new Error("family missing");
    const unit = buildP0FamilyWorkUnit(
      currentPlan,
      family.stream_id,
      family.family_id,
    );
    const checkpoints = unit.targets.map((item) => checkpoint(manifest, item));
    const receipt = {
      version: P0_RECEIPT_RECONCILIATION_VERSION,
      plan_sha256: manifest.plan_sha256,
      manifest_sha256: manifest.manifest_sha256,
      work_unit_sha256: unit.work_unit_sha256,
      stream_id: unit.stream_id,
      family_id: unit.family_id,
      run_id: "run-p0-test",
      terminal_status: "completed",
      receipt_id: "receipt-p0-test",
      checkpoints,
    };
    const accepted = reconcileP0AgentFeedReceipt(manifest, [], receipt);
    expect(accepted).toHaveLength(unit.targets.length);
    expect(reconcileP0AgentFeedReceipt(manifest, accepted, receipt)).toEqual(
      accepted,
    );
    expect(() =>
      reconcileP0AgentFeedReceipt(manifest, accepted, {
        ...receipt,
        checkpoints: checkpoints.slice(1),
      }),
    ).toThrow("p0_reconciliation_incomplete");
    expect(accepted).toHaveLength(unit.targets.length);
  });
});
