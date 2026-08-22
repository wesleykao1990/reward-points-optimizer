import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  admitP0SourceRolePlan,
  bindP0TaskPack,
  buildP0AgentFeedWorkUnitRequests,
  buildP0OperationsManifest,
  buildP0ProgressSnapshot,
  collectP0CheckpointInputs,
  createP0OperationsDriver,
  P0_RECEIPT_RECONCILIATION_VERSION,
  P0_TARGET_CHECKPOINT_VERSION,
  type P0OperationsManifest,
  type P0OperationTarget,
  type P0SourceRolePlan,
  prepareP0Operations,
  reconcileP0ReceiptThroughStore,
} from "../src/index.js";

const planPath = resolve(
  process.cwd(),
  "../../registry/planning/p0-source-role-plan.v0.1.json",
);
const packPath = resolve(
  process.cwd(),
  "../../registry/planning/p0-chatgpt-task-pack.v0.1.json",
);
const liveRecoveryPath = resolve(
  process.cwd(),
  "../../registry/planning/p0-live-recovery-alternatives.2026-08-22.v0.1.json",
);
const INPUT_A = `sha256:${"a".repeat(64)}`;
const INPUT_B = `sha256:${"b".repeat(64)}`;
const LOCATOR_HASH = `sha256:${"c".repeat(64)}`;

function admittedPlan(): P0SourceRolePlan {
  const result = admitP0SourceRolePlan(
    JSON.parse(readFileSync(planPath, "utf8")) as unknown,
  );
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.plan;
}

function admittedPack(plan: P0SourceRolePlan) {
  return bindP0TaskPack(
    plan,
    JSON.parse(readFileSync(packPath, "utf8")) as unknown,
  );
}

function target(manifest: P0OperationsManifest): P0OperationTarget {
  const value = manifest.streams[0]?.targets[0];
  if (!value) throw new Error("target missing");
  return value;
}

function checkpoint(
  manifest: P0OperationsManifest,
  item: P0OperationTarget,
  outcome: "resolved" | "validation_rejected" = "resolved",
  input = INPUT_A,
) {
  return {
    version: P0_TARGET_CHECKPOINT_VERSION,
    manifest_sha256: manifest.manifest_sha256,
    target_id: item.target_id,
    stream_id: item.stream_id,
    family_id: item.family_id,
    source_role_id: item.source_role_id,
    attempt_number: 1,
    observed_at: "2026-08-21T00:00:00+09:00",
    outcome,
    run_id: "run-p0-driver",
    event_id: "event-p0-driver",
    receipt_id: "receipt-p0-driver",
    idempotency_key: `checkpoint-${item.target_id}-${input}`,
    input_sha256: input,
    locator: outcome === "resolved" ? "https://example.test/official" : null,
    locator_fingerprint: outcome === "resolved" ? LOCATOR_HASH : null,
    economic_findings_accepted: 0,
  } as const;
}

describe("P0 resumable operations driver", () => {
  it("covers all 301 targets in stable units of at most eight", () => {
    const plan = admittedPlan();
    const pack = admittedPack(plan);
    const requests = buildP0AgentFeedWorkUnitRequests(plan, pack);
    expect(requests).toHaveLength(44);
    expect(
      requests.reduce((count, request) => count + request.targets.length, 0),
    ).toBe(301);
    expect(
      Math.max(...requests.map((request) => request.targets.length)),
    ).toBeLessThanOrEqual(8);
    expect(requests.every((request) => request.full_target_count <= 8)).toBe(
      true,
    );
  });

  it("keeps request hashes stable under task-pack permutation", () => {
    const plan = admittedPlan();
    const rawPack = JSON.parse(readFileSync(packPath, "utf8")) as {
      tasks: Array<{ targets: Array<{ required_source_roles: string[] }> }>;
      all_stream_ids: string[];
    };
    rawPack.tasks.reverse();
    rawPack.all_stream_ids.reverse();
    rawPack.tasks[0]?.targets.reverse();
    rawPack.tasks[0]?.targets[0]?.required_source_roles.reverse();
    const first = buildP0AgentFeedWorkUnitRequests(plan, admittedPack(plan));
    const second = buildP0AgentFeedWorkUnitRequests(
      plan,
      bindP0TaskPack(plan, rawPack),
    );
    expect(second.map((request) => request.request_sha256)).toEqual(
      first.map((request) => request.request_sha256),
    );
  }, 10_000);

  it("selects the reachable Amazon main page and excludes the invalid CDN host", () => {
    const liveRecovery = JSON.parse(readFileSync(liveRecoveryPath, "utf8")) as {
      targets: Array<{
        family_id: string;
        source_role_id: string;
        alternatives: Array<{ source_url: string }>;
      }>;
    };
    const amazonRecovery = liveRecovery.targets.find(
      (target) =>
        target.family_id === "merchant.amazon-jp" &&
        target.source_role_id === "loyalty_program_rules",
    );
    expect(amazonRecovery?.alternatives.map((item) => item.source_url)).toEqual(
      ["https://www.amazon.co.jp/b?node=8123221051"],
    );
    expect(
      amazonRecovery?.alternatives.some(
        (item) => new URL(item.source_url).hostname === "www.cdn.amazon.co.jp",
      ),
    ).toBe(false);

    const rawPack = JSON.parse(readFileSync(packPath, "utf8")) as {
      tasks: Array<{
        targets: Array<{
          family_id: string;
          recovered_role_locator_hints: Array<{ source_url: string }>;
        }>;
      }>;
    };
    const amazonTarget = rawPack.tasks
      .flatMap((task) => task.targets)
      .find((target) => target.family_id === "merchant.amazon-jp");
    expect(
      amazonTarget?.recovered_role_locator_hints.map((item) => item.source_url),
    ).toEqual(["https://www.amazon.co.jp/b?node=8123221051"]);
  });

  it("selects unresolved and stale targets while holding a rejected input", () => {
    const plan = admittedPlan();
    const manifest = buildP0OperationsManifest(plan);
    const item = target(manifest);
    const held = checkpoint(manifest, item, "validation_rejected");
    const heldRequests = buildP0AgentFeedWorkUnitRequests(plan, null, {
      selection: "retry",
      progress: [held],
      effective_at: "2026-08-22T00:00:00+09:00",
      input_sha256: INPUT_A,
    });
    expect(
      heldRequests.reduce(
        (count, request) => count + request.targets.length,
        0,
      ),
    ).toBe(300);
    const changedInputRequests = buildP0AgentFeedWorkUnitRequests(plan, null, {
      selection: "retry",
      progress: [held],
      effective_at: "2026-08-22T00:00:00+09:00",
      input_sha256: INPUT_B,
    });
    expect(
      changedInputRequests.reduce(
        (count, request) => count + request.targets.length,
        0,
      ),
    ).toBe(301);
  });

  it("rejects hostile progress and never interprets task-pack hints as checkpoints", () => {
    const plan = admittedPlan();
    const manifest = buildP0OperationsManifest(plan);
    expect(() =>
      collectP0CheckpointInputs(manifest, new Proxy([], {})),
    ).toThrow("p0_progress_input_invalid");
    const sparse = [] as unknown[];
    sparse.length = 1;
    expect(() => collectP0CheckpointInputs(manifest, sparse)).toThrow(
      "p0_progress_input_invalid",
    );
    expect(() =>
      collectP0CheckpointInputs(manifest, {
        version: "p0-chatgpt-agent-feed-task-pack.v0.1",
      }),
    ).toThrow("p0_progress_input_invalid");
  });

  it("admits receipt/checkpoint files and calls the existing store only after validation", async () => {
    const plan = admittedPlan();
    const manifest = buildP0OperationsManifest(plan);
    const item = target(manifest);
    const unit = buildP0AgentFeedWorkUnitRequests(plan)[0];
    if (!unit) throw new Error("work unit missing");
    const receipt = {
      version: P0_RECEIPT_RECONCILIATION_VERSION,
      plan_sha256: manifest.plan_sha256,
      manifest_sha256: manifest.manifest_sha256,
      work_unit_sha256: unit.work_unit_sha256,
      stream_id: unit.stream_id,
      family_id: unit.family_id,
      run_id: "run-p0-driver",
      terminal_status: "partial" as const,
      receipt_id: "receipt-p0-driver",
      checkpoints: [checkpoint(manifest, item)],
    };
    let received: unknown;
    const result = await reconcileP0ReceiptThroughStore(
      manifest,
      {
        reconcile: async (input) => {
          received = input;
          return { inserted_count: 1, duplicate_count: 0 };
        },
      },
      receipt,
    );
    expect(result.inserted_count).toBe(1);
    expect(received).toEqual(result.receipt);
    await expect(
      reconcileP0ReceiptThroughStore(
        manifest,
        {
          reconcile: async () => ({ inserted_count: 0, duplicate_count: 0 }),
        },
        { ...receipt, hostile: true },
      ),
    ).rejects.toThrow("p0_reconciliation_invalid");
  });

  it("serializes a deterministic progress snapshot", () => {
    const plan = admittedPlan();
    const manifest = buildP0OperationsManifest(plan);
    const item = target(manifest);
    const first = buildP0ProgressSnapshot(manifest, [
      checkpoint(manifest, item),
    ]);
    const second = buildP0ProgressSnapshot(manifest, [
      checkpoint(manifest, item),
    ]);
    expect(first).toEqual(second);
    expect(Object.isFrozen(first)).toBe(true);
    expect(
      prepareP0Operations(plan, null, {
        selection: "retry",
        progress: first,
        effective_at: "2026-08-21T00:00:01+09:00",
        input_sha256: INPUT_A,
      }).target_count,
    ).toBe(300);
  });

  it("keeps reconciliation behind an explicitly supplied store", async () => {
    const plan = admittedPlan();
    const driver = createP0OperationsDriver(plan);
    expect(driver.prepare().target_count).toBe(301);
    await expect(driver.reconcile({})).rejects.toThrow(
      "p0_operations_store_unconfigured",
    );
  });
});
