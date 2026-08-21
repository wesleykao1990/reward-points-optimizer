import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  admitP0SourceRolePlan,
  buildP0FamilyWorkUnit,
  buildP0OperationsManifest,
  P0_RECEIPT_RECONCILIATION_VERSION,
  P0_TARGET_CHECKPOINT_VERSION,
  type P0OperationsManifest,
  type P0OperationTarget,
  type P0ReceiptReconciliation,
  type P0SourceRolePlan,
} from "@jro/p0-source-operations";
import { describe, expect, it } from "vitest";
import {
  createPostgresP0OperationsStore,
  P0_OPERATIONS_RECONCILIATION_QUERY,
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
} {
  const plan = admittedPlan();
  const manifest = buildP0OperationsManifest(plan);
  const unit = buildP0FamilyWorkUnit(
    plan,
    "merchant.jp-convenience",
    "merchant.7eleven",
  );
  const checkpoints = unit.targets.map((target, index) =>
    checkpoint(manifest, target, index + 1),
  );
  return {
    manifest,
    reconciliation: {
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
    },
  };
}

function checkpoint(
  manifest: P0OperationsManifest,
  target: P0OperationTarget,
  attempt: number,
) {
  return {
    version: P0_TARGET_CHECKPOINT_VERSION,
    manifest_sha256: manifest.manifest_sha256,
    target_id: target.target_id,
    stream_id: target.stream_id,
    family_id: target.family_id,
    source_role_id: target.source_role_id,
    attempt_number: attempt,
    observed_at: `2026-08-22T00:00:0${attempt}+09:00`,
    outcome: "resolved" as const,
    run_id: "run-p0-test",
    event_id: `event-p0-${attempt}`,
    receipt_id: "receipt-p0-test",
    idempotency_key: `checkpoint-p0-${attempt}`,
    input_sha256: INPUT_HASH,
    locator: "https://example.test/official",
    locator_fingerprint: LOCATOR_HASH,
    economic_findings_accepted: 0,
  };
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

describe("PostgreSQL P0 operations host", () => {
  it("admits a clean clone and reconciles in one transaction", async () => {
    const { manifest, reconciliation } = fixture();
    const calls: Array<{ text: string; values?: readonly unknown[] }> = [];
    const target = clientFor((text, values) => {
      calls.push({ text, values });
      if (text === P0_OPERATIONS_RECONCILIATION_QUERY)
        return { rows: [{ inserted_count: 6, duplicate_count: 0 }] };
      return { rows: [] };
    });

    const result = await createPostgresP0OperationsStore(
      target,
      manifest,
    ).reconcile(reconciliation);

    expect(result).toEqual({ inserted_count: 6, duplicate_count: 0 });
    expect(calls.map((call) => call.text)).toEqual([
      "BEGIN",
      P0_OPERATIONS_RECONCILIATION_QUERY,
      "COMMIT",
    ]);
    const payload = calls[1]?.values?.[0];
    expect(typeof payload).toBe("string");
    expect(JSON.parse(payload as string)).toEqual(reconciliation);
  });

  it.each([
    ["proxy", (value: P0ReceiptReconciliation) => new Proxy(value, {})],
    [
      "accessor",
      (value: P0ReceiptReconciliation) => {
        const copy = { ...value };
        Object.defineProperty(copy, "family_id", {
          enumerable: true,
          get: () => value.family_id,
        });
        return copy;
      },
    ],
    [
      "extra field",
      (value: P0ReceiptReconciliation) => ({ ...value, hostile: true }),
    ],
  ])("rejects %s before any query", async (_label, makeInput) => {
    const { manifest, reconciliation } = fixture();
    let queryCount = 0;
    const target = clientFor(() => {
      queryCount += 1;
      return { rows: [] };
    });
    await expect(
      createPostgresP0OperationsStore(target, manifest).reconcile(
        makeInput(reconciliation),
      ),
    ).rejects.toThrow("p0_reconciliation_invalid");
    expect(queryCount).toBe(0);
  });

  it.each([
    ["extra result field", { inserted_count: 1, duplicate_count: 0, extra: 1 }],
    [
      "duplicate result rows",
      [
        { inserted_count: 1, duplicate_count: 0 },
        { inserted_count: 1, duplicate_count: 0 },
      ],
    ],
    ["negative count", { inserted_count: -1, duplicate_count: 0 }],
    [
      "unsafe count",
      { inserted_count: Number.MAX_SAFE_INTEGER + 1, duplicate_count: 0 },
    ],
  ])("rolls back for %s", async (_label, rows) => {
    const { manifest, reconciliation } = fixture();
    const calls: string[] = [];
    const target = clientFor((text) => {
      calls.push(text);
      if (text === P0_OPERATIONS_RECONCILIATION_QUERY)
        return { rows: Array.isArray(rows) ? rows : [rows] };
      return { rows: [] };
    });

    await expect(
      createPostgresP0OperationsStore(target, manifest).reconcile(
        reconciliation,
      ),
    ).rejects.toThrow();
    expect(calls).toEqual([
      "BEGIN",
      P0_OPERATIONS_RECONCILIATION_QUERY,
      "ROLLBACK",
    ]);
  });

  it("preserves a query error and passes it to pool release after rollback", async () => {
    const { manifest, reconciliation } = fixture();
    const failure = new Error("database failure");
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
            if (text === P0_OPERATIONS_RECONCILIATION_QUERY) throw failure;
            return { rows: [] };
          },
          release(error?: Error) {
            releaseError = error;
          },
        };
      },
    };

    await expect(
      createPostgresP0OperationsStore(pool, manifest).reconcile(reconciliation),
    ).rejects.toBe(failure);
    expect(calls).toEqual([
      "BEGIN",
      P0_OPERATIONS_RECONCILIATION_QUERY,
      "ROLLBACK",
    ]);
    expect(releaseError).toBe(failure);
  });
});
