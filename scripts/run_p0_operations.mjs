#!/usr/bin/env node

/*
 * Offline P0 operations driver.
 *
 * This CLI only admits checked-in planning/progress/receipt JSON and emits
 * deterministic work-unit material. It never calls Agent Feed, crawls a URL,
 * publishes evidence/rules, or opens a database connection. Applications that
 * own a PostgreSQL connection should use reconcileP0ReceiptThroughStore from
 * @jro/p0-source-operations with @jro/agent-feed-postgres' existing adapter.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
process.stdout.on("error", (error) => {
  if (error?.code === "EPIPE") process.exit(0);
});
const sourceModulePath = resolve(
  dirname(scriptPath),
  "../packages/p0-source-operations/src/index.ts",
);
const builtModulePath = resolve(
  dirname(scriptPath),
  "../packages/p0-source-operations/dist/index.js",
);

// Keep `node scripts/run_p0_operations.mjs ...` useful in a clean checkout
// where package dist/ has not been built yet. The child uses the source module
// through the repository's existing tsx dev dependency.
if (process.env.P0_OPERATIONS_TSX_CHILD !== "1" && !existsSync(builtModulePath)) {
  const child = spawnSync(
    process.execPath,
    ["--import", "tsx/esm", scriptPath, ...process.argv.slice(2)],
    {
      env: { ...process.env, P0_OPERATIONS_TSX_CHILD: "1" },
      stdio: "inherit",
    },
  );
  if (child.error) {
    process.stderr.write(`${child.error.message}\n`);
    process.exitCode = 1;
  } else {
    process.exitCode = child.status ?? 1;
  }
} else {
  const operations = await import(
    pathToFileURL(
      process.env.P0_OPERATIONS_TSX_CHILD === "1"
        ? sourceModulePath
        : builtModulePath,
    ).href,
  );

  const root = resolve(dirname(scriptPath), "..");
  const defaults = {
    plan: resolve(root, "registry/planning/p0-source-role-plan.v0.1.json"),
    taskPack: resolve(root, "registry/planning/p0-chatgpt-task-pack.v0.1.json"),
  };

  function usage() {
    process.stderr.write(`Usage:
  node scripts/run_p0_operations.mjs check [--plan FILE] [--task-pack FILE]
  node scripts/run_p0_operations.mjs prepare [--mode all|retry] [--plan FILE] [--task-pack FILE]
      [--progress FILE ...] [--effective-at ISO] [--input-sha256 sha256:...] [--stale-after-seconds N]
      [--task TASK_ID] [--stream STREAM_ID] [--family FAMILY_ID] [--output FILE] [--dry-run]
  node scripts/run_p0_operations.mjs reconcile --receipt FILE [--plan FILE] [--task-pack FILE]
      [--progress-output FILE] [--store-module FILE] [--dry-run]

All commands are offline. Reconciliation through PostgreSQL is exposed by the
package API and the existing @jro/agent-feed-postgres adapter.
`);
    process.exit(2);
  }

  function fail(message) {
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }

  function parseArgs(argv) {
    const [command, ...rest] = argv;
    if (!command || command.startsWith("-")) usage();
    const values = new Map();
    const repeated = new Map();
    for (let index = 0; index < rest.length; index += 1) {
      const token = rest[index];
      if (!token?.startsWith("--")) throw new Error(`unexpected argument: ${token}`);
      const key = token.slice(2);
      if (key === "dry-run") {
        values.set(key, true);
        continue;
      }
      const value = rest[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`missing value for --${key}`);
      index += 1;
      if (key === "progress") {
        const paths = repeated.get(key) ?? [];
        paths.push(value);
        repeated.set(key, paths);
      } else {
        values.set(key, value);
      }
    }
    return { command, values, repeated };
  }

  function readJson(path) {
    try {
      return JSON.parse(readFileSync(path, "utf8"));
    } catch (error) {
      throw new Error(`cannot read JSON ${path}: ${error instanceof Error ? error.message : "invalid file"}`);
    }
  }

  function requiredPath(values, key, fallback) {
    return values.get(key) ?? fallback;
  }

  function admitInputs(values) {
    const planPath = requiredPath(values, "plan", defaults.plan);
    const taskPackPath = requiredPath(values, "task-pack", defaults.taskPack);
    const planAdmission = operations.admitP0SourceRolePlan(readJson(planPath));
    if (!planAdmission.ok) throw new Error(`p0 plan rejected: ${planAdmission.issues.map((issue) => issue.message).join("; ")}`);
    const taskPack = operations.bindP0TaskPack(planAdmission.plan, readJson(taskPackPath));
    const manifest = operations.buildP0OperationsManifest(planAdmission.plan);
    return { plan: planAdmission.plan, taskPack, manifest };
  }

  function readProgress(manifest, paths) {
    const values = paths.map((path) => readJson(path));
    if (values.length === 0) return [];
    return operations.collectP0CheckpointInputs(manifest, values);
  }

  function output(value, path, dryRun) {
    const rendered = `${JSON.stringify(value, null, 2)}\n`;
    if (path && !dryRun) writeFileSync(path, rendered, "utf8");
    process.stdout.write(rendered);
  }

  try {
    const { command, values, repeated } = parseArgs(process.argv.slice(2));
    if (command === "check") {
      const { plan, taskPack } = admitInputs(values);
      const report = operations.checkP0OperationsInvariants(plan, taskPack);
      output({ ok: true, ...report }, undefined, false);
    } else if (command === "prepare") {
      const { plan, taskPack, manifest } = admitInputs(values);
      const mode = values.get("mode") ?? "all";
      if (mode !== "all" && mode !== "retry") throw new Error("--mode must be all or retry");
      const progress = readProgress(manifest, repeated.get("progress") ?? []);
      const options = {
        selection: mode,
        progress,
        ...(values.has("effective-at") ? { effective_at: values.get("effective-at") } : {}),
        ...(values.has("input-sha256") ? { input_sha256: values.get("input-sha256") } : {}),
        ...(values.has("stale-after-seconds") ? { stale_after_seconds: Number(values.get("stale-after-seconds")) } : {}),
        ...(values.has("task") ? { task_id: values.get("task") } : {}),
        ...(values.has("stream") ? { stream_id: values.get("stream") } : {}),
        ...(values.has("family") ? { family_id: values.get("family") } : {}),
      };
      const prepared = operations.prepareP0Operations(plan, taskPack, options);
      output(prepared, values.get("output"), values.has("dry-run"));
    } else if (command === "reconcile") {
      const receiptPath = values.get("receipt");
      if (!receiptPath) throw new Error("reconcile requires --receipt FILE");
      const { manifest } = admitInputs(values);
      const rawReceipt = readJson(receiptPath);
      const receipt = operations.admitP0ReceiptFile(manifest, rawReceipt);
      const storeModulePath = values.get("store-module");
      if (storeModulePath && !values.has("dry-run")) {
        const loaded = await import(
          pathToFileURL(resolve(storeModulePath)).href,
        );
        const store = loaded.default ?? loaded.store;
        if (!store || typeof store.reconcile !== "function")
          throw new Error("--store-module must export a P0 operations store or default store");
        const result = await operations.reconcileP0ReceiptThroughStore(
          manifest,
          store,
          rawReceipt,
        );
        output(
          {
            ok: true,
            plan_sha256: result.receipt.plan_sha256,
            manifest_sha256: result.receipt.manifest_sha256,
            work_unit_sha256: result.receipt.work_unit_sha256,
            stream_id: result.receipt.stream_id,
            family_id: result.receipt.family_id,
            terminal_status: result.receipt.terminal_status,
            checkpoint_count: result.receipt.checkpoints.length,
            receipt_id: result.receipt.receipt_id,
            inserted_count: result.inserted_count,
            duplicate_count: result.duplicate_count,
            database_reconciliation: "attempted",
          },
          undefined,
          false,
        );
      } else {
        const progressPath = values.get("progress-output");
        if (progressPath && !values.has("dry-run")) {
          const existing = readProgress(manifest, [progressPath]);
          const merged = operations.buildP0ProgressSnapshot(manifest, [
            ...existing,
            ...receipt.checkpoints,
          ]);
          output(merged, progressPath, false);
        } else {
          output(
            {
              ok: true,
              plan_sha256: receipt.plan_sha256,
              manifest_sha256: receipt.manifest_sha256,
              work_unit_sha256: receipt.work_unit_sha256,
              stream_id: receipt.stream_id,
              family_id: receipt.family_id,
              terminal_status: receipt.terminal_status,
              checkpoint_count: receipt.checkpoints.length,
              receipt_id: receipt.receipt_id,
              database_reconciliation: "not attempted",
            },
            undefined,
            false,
          );
        }
      }
    } else {
      usage();
    }
  } catch (error) {
    fail(error instanceof Error ? error.message : "p0 operations command failed");
  }
}
