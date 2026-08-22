import { canonicalSha256 } from "@jro/contracts";

import {
  hashP0SourceRolePlan,
  isAdmittedP0SourceRolePlan,
  type P0SourceRolePlan,
} from "./index.js";
import { deepFreeze, scanPlainData } from "./security.js";

export const P0_OPERATIONS_MANIFEST_VERSION =
  "p0-operations-manifest.v1" as const;
export const P0_TARGET_CHECKPOINT_VERSION = "p0-target-checkpoint.v1" as const;
export const P0_RECEIPT_RECONCILIATION_VERSION =
  "p0-receipt-reconciliation.v1" as const;

export const P0_TARGET_OUTCOMES = Object.freeze([
  "resolved",
  "not_found_this_attempt",
  "access_blocked",
  "authentication_required",
  "timeout",
  "unsupported_content",
  "validation_rejected",
  "interrupted",
] as const);

export type P0TargetOutcome = (typeof P0_TARGET_OUTCOMES)[number];

export interface P0OperationTarget {
  readonly target_id: string;
  readonly stream_id: string;
  readonly family_id: string;
  readonly source_role_id: string;
  readonly cadence_seconds: number;
}

export interface P0StreamRegistration {
  readonly stream_id: string;
  readonly cadence_seconds: number;
  readonly family_ids: readonly string[];
  readonly target_count: number;
  readonly targets: readonly P0OperationTarget[];
}

export interface P0OperationsManifest {
  readonly version: typeof P0_OPERATIONS_MANIFEST_VERSION;
  readonly plan_sha256: string;
  readonly family_count: number;
  readonly stream_count: number;
  readonly target_count: number;
  readonly streams: readonly P0StreamRegistration[];
  readonly manifest_sha256: string;
}

export interface P0FamilyWorkUnit {
  readonly version: "p0-family-work-unit.v1";
  readonly plan_sha256: string;
  readonly manifest_sha256: string;
  readonly stream_id: string;
  readonly family_id: string;
  readonly targets: readonly P0OperationTarget[];
  readonly work_unit_sha256: string;
}

export interface P0TargetCheckpoint {
  readonly version: typeof P0_TARGET_CHECKPOINT_VERSION;
  readonly manifest_sha256: string;
  readonly target_id: string;
  readonly stream_id: string;
  readonly family_id: string;
  readonly source_role_id: string;
  readonly attempt_number: number;
  readonly observed_at: string;
  readonly outcome: P0TargetOutcome;
  readonly run_id: string;
  readonly event_id: string;
  readonly receipt_id: string;
  readonly idempotency_key: string;
  readonly input_sha256: string;
  readonly locator: string | null;
  readonly locator_fingerprint: string | null;
  readonly economic_findings_accepted: number;
}

export interface P0ReceiptReconciliation {
  readonly version: typeof P0_RECEIPT_RECONCILIATION_VERSION;
  readonly plan_sha256: string;
  readonly manifest_sha256: string;
  readonly work_unit_sha256: string;
  readonly stream_id: string;
  readonly family_id: string;
  readonly run_id: string;
  readonly terminal_status: "completed" | "partial" | "failed";
  readonly receipt_id: string;
  readonly checkpoints: readonly P0TargetCheckpoint[];
}

export interface P0TargetProgress {
  readonly target: P0OperationTarget;
  readonly latest: P0TargetCheckpoint | null;
  readonly last_resolved: P0TargetCheckpoint | null;
  readonly locator_covered: boolean;
  readonly economic_findings_accepted: number;
}

export interface P0RetryWorklist {
  readonly effective_at: string;
  readonly input_sha256: string;
  readonly targets: readonly P0OperationTarget[];
  readonly worklist_sha256: string;
}

const CHECKPOINT_KEYS = Object.freeze([
  "version",
  "manifest_sha256",
  "target_id",
  "stream_id",
  "family_id",
  "source_role_id",
  "attempt_number",
  "observed_at",
  "outcome",
  "run_id",
  "event_id",
  "receipt_id",
  "idempotency_key",
  "input_sha256",
  "locator",
  "locator_fingerprint",
  "economic_findings_accepted",
] as const);
const RECONCILIATION_KEYS = Object.freeze([
  "version",
  "plan_sha256",
  "manifest_sha256",
  "work_unit_sha256",
  "stream_id",
  "family_id",
  "run_id",
  "terminal_status",
  "receipt_id",
  "checkpoints",
] as const);
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const DATE_TIME =
  /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:0\d|1\d|2[0-3]):[0-5]\d)$/u;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return (
    actual.length === wanted.length &&
    actual.every((key, index) => key === wanted[index])
  );
}

function validDateTime(value: unknown): value is string {
  return (
    typeof value === "string" &&
    DATE_TIME.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function validId(value: unknown): value is string {
  return typeof value === "string" && ID.test(value);
}

function targetId(
  planSha256: string,
  familyId: string,
  roleId: string,
): string {
  return `p0t_${canonicalSha256({
    plan_sha256: planSha256,
    family_id: familyId,
    source_role_id: roleId,
  }).slice("sha256:".length)}`;
}

function manifestProjection(
  plan: P0SourceRolePlan,
): Omit<P0OperationsManifest, "manifest_sha256"> {
  if (!isAdmittedP0SourceRolePlan(plan))
    throw new TypeError("p0_plan_not_admitted");
  const planSha256 = hashP0SourceRolePlan(plan);
  const streams = new Map<string, P0OperationTarget[]>();
  for (const family of plan.families) {
    const targets = streams.get(family.stream_id) ?? [];
    for (const sourceRoleId of family.required_source_roles) {
      targets.push({
        target_id: targetId(planSha256, family.family_id, sourceRoleId),
        stream_id: family.stream_id,
        family_id: family.family_id,
        source_role_id: sourceRoleId,
        cadence_seconds: family.recommended_cadence_seconds,
      });
    }
    streams.set(family.stream_id, targets);
  }
  const registrations = [...streams.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([streamId, rawTargets]): P0StreamRegistration => {
      const targets = rawTargets.sort(
        (left, right) =>
          left.family_id.localeCompare(right.family_id) ||
          left.source_role_id.localeCompare(right.source_role_id),
      );
      return {
        stream_id: streamId,
        cadence_seconds: Math.min(
          ...targets.map((target) => target.cadence_seconds),
        ),
        family_ids: [...new Set(targets.map((target) => target.family_id))],
        target_count: targets.length,
        targets,
      };
    });
  return {
    version: P0_OPERATIONS_MANIFEST_VERSION,
    plan_sha256: planSha256,
    family_count: plan.families.length,
    stream_count: registrations.length,
    target_count: registrations.reduce(
      (count, stream) => count + stream.target_count,
      0,
    ),
    streams: registrations,
  };
}

export function buildP0OperationsManifest(
  plan: P0SourceRolePlan,
): P0OperationsManifest {
  const projection = manifestProjection(plan);
  const manifest = deepFreeze({
    ...projection,
    manifest_sha256: canonicalSha256(projection),
  });
  manifestPlans.set(manifest as object, plan);
  return manifest;
}

export function buildP0FamilyWorkUnit(
  plan: P0SourceRolePlan,
  streamId: string,
  familyId: string,
): P0FamilyWorkUnit {
  const manifest = buildP0OperationsManifest(plan);
  const stream = manifest.streams.find((item) => item.stream_id === streamId);
  if (!stream) throw new TypeError("p0_stream_not_found");
  const targets = stream.targets.filter(
    (target) => target.family_id === familyId,
  );
  if (targets.length === 0) throw new TypeError("p0_family_stream_mismatch");
  if (targets.length > 8) throw new TypeError("p0_work_unit_too_large");
  const projection = {
    version: "p0-family-work-unit.v1" as const,
    plan_sha256: manifest.plan_sha256,
    manifest_sha256: manifest.manifest_sha256,
    stream_id: streamId,
    family_id: familyId,
    targets,
  };
  return deepFreeze({
    ...projection,
    work_unit_sha256: canonicalSha256(projection),
  });
}

function targetMap(
  manifest: P0OperationsManifest,
): Map<string, P0OperationTarget> {
  return new Map(
    manifest.streams.flatMap((stream) =>
      stream.targets.map((target) => [target.target_id, target] as const),
    ),
  );
}

export function admitP0TargetCheckpoint(
  manifest: P0OperationsManifest,
  input: unknown,
): P0TargetCheckpoint {
  const scan = scanPlainData(input);
  if (
    !scan.ok ||
    !record(scan.value) ||
    !exactKeys(scan.value, CHECKPOINT_KEYS)
  )
    throw new TypeError("p0_checkpoint_invalid");
  const value = scan.value;
  const target =
    typeof value.target_id === "string"
      ? targetMap(manifest).get(value.target_id)
      : undefined;
  if (
    value.version !== P0_TARGET_CHECKPOINT_VERSION ||
    value.manifest_sha256 !== manifest.manifest_sha256 ||
    !target ||
    value.stream_id !== target.stream_id ||
    value.family_id !== target.family_id ||
    value.source_role_id !== target.source_role_id ||
    !Number.isSafeInteger(value.attempt_number) ||
    (value.attempt_number as number) < 1 ||
    !validDateTime(value.observed_at) ||
    !P0_TARGET_OUTCOMES.includes(value.outcome as P0TargetOutcome) ||
    !validId(value.run_id) ||
    !validId(value.event_id) ||
    !validId(value.receipt_id) ||
    !validId(value.idempotency_key) ||
    typeof value.input_sha256 !== "string" ||
    !SHA256.test(value.input_sha256) ||
    (value.locator !== null &&
      (typeof value.locator !== "string" ||
        value.locator.length > 2048 ||
        !/^https:\/\//u.test(value.locator))) ||
    (value.locator_fingerprint !== null &&
      (typeof value.locator_fingerprint !== "string" ||
        !SHA256.test(value.locator_fingerprint))) ||
    !Number.isSafeInteger(value.economic_findings_accepted) ||
    (value.economic_findings_accepted as number) < 0
  )
    throw new TypeError("p0_checkpoint_invalid");
  if (
    value.outcome === "resolved" &&
    (value.locator === null || value.locator_fingerprint === null)
  )
    throw new TypeError("p0_checkpoint_invalid");
  if (
    value.outcome !== "resolved" &&
    (value.locator !== null || value.locator_fingerprint !== null)
  )
    throw new TypeError("p0_checkpoint_invalid");
  return deepFreeze(value as unknown as P0TargetCheckpoint);
}

export function reduceP0TargetCheckpoints(
  manifest: P0OperationsManifest,
  inputs: readonly unknown[],
): readonly P0TargetProgress[] {
  const admitted = inputs.map((input) =>
    admitP0TargetCheckpoint(manifest, input),
  );
  const identities = new Map<string, string>();
  const unique = new Map<string, P0TargetCheckpoint>();
  for (const checkpoint of admitted) {
    const identity = `${checkpoint.target_id}\u0000${checkpoint.idempotency_key}`;
    const hash = canonicalSha256(checkpoint);
    const existing = identities.get(identity);
    if (existing && existing !== hash)
      throw new TypeError("p0_checkpoint_idempotency_conflict");
    identities.set(identity, hash);
    unique.set(identity, checkpoint);
  }
  const checkpoints = [...unique.values()];
  const targets = targetMap(manifest);
  return deepFreeze(
    [...targets.values()]
      .sort(
        (left, right) =>
          left.stream_id.localeCompare(right.stream_id) ||
          left.family_id.localeCompare(right.family_id) ||
          left.source_role_id.localeCompare(right.source_role_id),
      )
      .map((target): P0TargetProgress => {
        const attempts = checkpoints
          .filter((item) => item.target_id === target.target_id)
          .sort(
            (left, right) =>
              left.observed_at.localeCompare(right.observed_at) ||
              left.attempt_number - right.attempt_number,
          );
        for (let index = 1; index < attempts.length; index += 1) {
          const previous = attempts[index - 1];
          const current = attempts[index];
          if (
            previous &&
            current &&
            current.attempt_number <= previous.attempt_number
          )
            throw new TypeError("p0_checkpoint_attempt_regressed");
        }
        const uniqueAttempts = new Map<number, string>();
        for (const attempt of attempts) {
          const hash = canonicalSha256(attempt);
          const existing = uniqueAttempts.get(attempt.attempt_number);
          if (existing && existing !== hash)
            throw new TypeError("p0_checkpoint_attempt_conflict");
          uniqueAttempts.set(attempt.attempt_number, hash);
        }
        const latest = attempts.at(-1) ?? null;
        const lastResolved =
          attempts.filter((item) => item.outcome === "resolved").at(-1) ?? null;
        return {
          target,
          latest,
          last_resolved: lastResolved,
          locator_covered: lastResolved !== null,
          economic_findings_accepted: attempts.reduce(
            (count, item) => count + item.economic_findings_accepted,
            0,
          ),
        };
      }),
  );
}

export function selectP0RetryTargets(
  manifest: P0OperationsManifest,
  checkpoints: readonly unknown[],
  options: {
    readonly effective_at: string;
    readonly input_sha256: string;
    readonly stale_after_seconds?: number;
  },
): P0RetryWorklist {
  if (
    !validDateTime(options.effective_at) ||
    !SHA256.test(options.input_sha256) ||
    (options.stale_after_seconds !== undefined &&
      (!Number.isSafeInteger(options.stale_after_seconds) ||
        options.stale_after_seconds < 1))
  )
    throw new TypeError("p0_retry_options_invalid");
  const effective = Date.parse(options.effective_at);
  const targets = reduceP0TargetCheckpoints(manifest, checkpoints)
    .filter((progress) => {
      if (!progress.latest) return true;
      if (
        progress.latest.outcome === "validation_rejected" &&
        progress.latest.input_sha256 === options.input_sha256
      )
        return false;
      if (!progress.last_resolved) return true;
      const staleSeconds =
        options.stale_after_seconds ?? progress.target.cadence_seconds;
      return (
        effective - Date.parse(progress.last_resolved.observed_at) >=
        staleSeconds * 1000
      );
    })
    .map((progress) => progress.target);
  const projection = {
    effective_at: options.effective_at,
    input_sha256: options.input_sha256,
    targets,
  };
  return deepFreeze({
    ...projection,
    worklist_sha256: canonicalSha256(projection),
  });
}

export function admitP0ReceiptReconciliation(
  manifest: P0OperationsManifest,
  input: unknown,
): P0ReceiptReconciliation {
  const scan = scanPlainData(input);
  if (
    !scan.ok ||
    !record(scan.value) ||
    !exactKeys(scan.value, RECONCILIATION_KEYS)
  )
    throw new TypeError("p0_reconciliation_invalid");
  const value = scan.value;
  const workUnit = buildP0FamilyWorkUnit(
    manifestPlan(manifest),
    String(value.stream_id),
    String(value.family_id),
  );
  if (
    value.version !== P0_RECEIPT_RECONCILIATION_VERSION ||
    value.plan_sha256 !== manifest.plan_sha256 ||
    value.manifest_sha256 !== manifest.manifest_sha256 ||
    value.work_unit_sha256 !== workUnit.work_unit_sha256 ||
    value.stream_id !== workUnit.stream_id ||
    value.family_id !== workUnit.family_id ||
    !validId(value.run_id) ||
    !validId(value.receipt_id) ||
    !new Set(["completed", "partial", "failed"]).has(
      String(value.terminal_status),
    ) ||
    !Array.isArray(value.checkpoints)
  )
    throw new TypeError("p0_reconciliation_invalid");
  const admitted = value.checkpoints.map((item) =>
    admitP0TargetCheckpoint(manifest, item),
  );
  if (
    admitted.some(
      (item) =>
        item.run_id !== value.run_id ||
        item.receipt_id !== value.receipt_id ||
        !workUnit.targets.some((target) => target.target_id === item.target_id),
    ) ||
    new Set(admitted.map((item) => item.target_id)).size !== admitted.length
  )
    throw new TypeError("p0_reconciliation_invalid");
  if (value.terminal_status === "completed" && admitted.length === 0)
    throw new TypeError("p0_reconciliation_incomplete");
  return deepFreeze({
    version: P0_RECEIPT_RECONCILIATION_VERSION,
    plan_sha256: manifest.plan_sha256,
    manifest_sha256: manifest.manifest_sha256,
    work_unit_sha256: workUnit.work_unit_sha256,
    stream_id: workUnit.stream_id,
    family_id: workUnit.family_id,
    run_id: value.run_id as string,
    terminal_status: value.terminal_status as
      | "completed"
      | "partial"
      | "failed",
    receipt_id: value.receipt_id as string,
    checkpoints: admitted,
  });
}

export function reconcileP0AgentFeedReceipt(
  manifest: P0OperationsManifest,
  prior: readonly unknown[],
  input: unknown,
): readonly P0TargetCheckpoint[] {
  const admittedReconciliation = admitP0ReceiptReconciliation(manifest, input);
  const admitted = admittedReconciliation.checkpoints;
  const combined = [...prior, ...admitted];
  reduceP0TargetCheckpoints(manifest, combined);
  const deduped = new Map<string, P0TargetCheckpoint>();
  for (const item of combined.map((entry) =>
    admitP0TargetCheckpoint(manifest, entry),
  )) {
    const key = `${item.target_id}\u0000${item.idempotency_key}`;
    const existing = deduped.get(key);
    if (existing && canonicalSha256(existing) !== canonicalSha256(item))
      throw new TypeError("p0_checkpoint_idempotency_conflict");
    deduped.set(key, item);
  }
  return deepFreeze([...deduped.values()]);
}

/*
 * Reconciliation receives only the manifest at runtime. The process-local
 * binding prevents a structurally forged manifest from selecting another
 * plan and avoids persisting the semantic plan in every receipt.
 */
const manifestPlans = new WeakMap<object, P0SourceRolePlan>();

function manifestPlan(manifest: P0OperationsManifest): P0SourceRolePlan {
  const plan = manifestPlans.get(manifest as object);
  if (!plan) throw new TypeError("p0_manifest_not_admitted");
  return plan;
}
