import { canonicalSha256 } from "@jro/contracts";

import {
  hashP0SourceRolePlan,
  isAdmittedP0SourceRolePlan,
  P0_EXPECTED_FAMILY_COUNT,
  P0_EXPECTED_ROLE_COUNT,
  P0_EXPECTED_STREAM_COUNT,
  type P0SourceRolePlan,
} from "./index.js";
import {
  admitP0ReceiptReconciliation,
  admitP0TargetCheckpoint,
  buildP0FamilyWorkUnit,
  buildP0OperationsManifest,
  type P0OperationsManifest,
  type P0OperationTarget,
  type P0ReceiptReconciliation,
  type P0TargetCheckpoint,
  reduceP0TargetCheckpoints,
  selectP0RetryTargets,
} from "./operations.js";
import { deepFreeze, scanPlainData } from "./security.js";

/** The local envelope version for requests handed to an Agent Feed producer. */
export const P0_AGENT_FEED_WORK_UNIT_REQUEST_VERSION =
  "p0-agent-feed-work-unit-request.v1" as const;
/** The durable, file-friendly progress snapshot version. */
export const P0_PROGRESS_SNAPSHOT_VERSION = "p0-progress-snapshot.v1" as const;
/** The version for a deterministic prepare result. */
export const P0_PREPARED_OPERATIONS_VERSION =
  "p0-prepared-operations.v1" as const;

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const SOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const DATE_TIME =
  /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:0\d|1\d|2[0-3]):[0-5]\d)$/u;

const TASK_PACK_KEYS = Object.freeze([
  "version",
  "source_plan_sha256",
  "generated_at",
  "protocol_version",
  "producer_id",
  "lifecycle_tools",
  "execution_policy",
  "totals",
  "all_stream_ids",
  "tasks",
  "pack_sha256",
] as const);
const TASK_KEYS = Object.freeze([
  "task_id",
  "display_name",
  "schedule_mode",
  "targets",
  "allowed_stream_ids",
] as const);
const TASK_TARGET_KEYS = Object.freeze([
  "family_id",
  "provider_or_scope",
  "stream_id",
  "recommended_cadence_seconds",
  "required_source_roles",
  "registered_source_hints",
  "recovered_role_locator_hints",
] as const);
const REGISTERED_HINT_KEYS = Object.freeze([
  "source_id",
  "source_url",
  "authority_scope",
  "registration_status",
  "hint_status",
] as const);
const RECOVERED_HINT_KEYS = Object.freeze([
  "source_role_id",
  "source_url",
  "publisher",
  "role_marker",
  "exact_registered_source_id",
  "related_registered_source_ids",
  "hint_status",
] as const);
const PACK_TOTAL_KEYS = Object.freeze([
  "scheduled_tasks",
  "source_families",
  "agent_feed_streams",
  "required_source_roles",
] as const);
const EXECUTION_POLICY_KEYS = Object.freeze([
  "work_unit",
  "resume",
  "source_selection",
  "evidence_status",
  "publication_policy",
  "completion_policy",
  "credentials_policy",
  "submission_contract",
  "connector_capability_gate",
  "economic_claim_work_unit",
  "coverage_contract",
] as const);
const PROGRESS_KEYS = Object.freeze([
  "version",
  "plan_sha256",
  "manifest_sha256",
  "checkpoints",
] as const);

type JsonRecord = Record<string, unknown>;

function record(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: JsonRecord, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return (
    actual.length === wanted.length &&
    actual.every((key, index) => key === wanted[index])
  );
}

function validId(value: unknown): value is string {
  return typeof value === "string" && ID.test(value);
}

function validSourceId(value: unknown): value is string {
  return typeof value === "string" && SOURCE_ID.test(value);
}

function validDateTime(value: unknown): value is string {
  return (
    typeof value === "string" &&
    DATE_TIME.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function validHttps(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 2048 &&
    /^https:\/\//u.test(value)
  );
}

function uniqueStrings(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === "string") &&
    new Set(value).size === value.length
  );
}

function sortedStrings(value: readonly string[]): readonly string[] {
  return [...value].sort((left, right) => left.localeCompare(right));
}

function sortedBy<T>(
  values: readonly T[],
  compare: (left: T, right: T) => number,
): readonly T[] {
  return [...values].sort(compare);
}

function compareCheckpoint(
  left: P0TargetCheckpoint,
  right: P0TargetCheckpoint,
): number {
  return (
    left.target_id.localeCompare(right.target_id) ||
    left.attempt_number - right.attempt_number ||
    left.observed_at.localeCompare(right.observed_at) ||
    left.idempotency_key.localeCompare(right.idempotency_key)
  );
}

function cloneStringArray(value: readonly string[]): readonly string[] {
  return deepFreeze([...value]);
}

export interface P0RegisteredSourceHint {
  readonly source_id: string;
  readonly source_url: string;
  readonly authority_scope: readonly string[];
  readonly registration_status: string;
  readonly hint_status: string;
}

export interface P0RecoveredRoleLocatorHint {
  readonly source_role_id: string;
  readonly source_url: string;
  readonly publisher: string;
  readonly role_marker: string;
  readonly exact_registered_source_id: string | null;
  readonly related_registered_source_ids: readonly string[];
  readonly hint_status: string;
}

export interface P0TaskTarget {
  readonly family_id: string;
  readonly provider_or_scope: string;
  readonly stream_id: string;
  readonly recommended_cadence_seconds: number;
  readonly required_source_roles: readonly string[];
  readonly registered_source_hints: readonly P0RegisteredSourceHint[];
  readonly recovered_role_locator_hints: readonly P0RecoveredRoleLocatorHint[];
}

export interface P0TaskDefinition {
  readonly task_id: string;
  readonly display_name: string;
  readonly schedule_mode: string;
  readonly targets: readonly P0TaskTarget[];
  readonly allowed_stream_ids: readonly string[];
}

export interface P0ChatGPTTaskPack {
  readonly version: "p0-chatgpt-agent-feed-task-pack.v0.1";
  readonly source_plan_sha256: string;
  readonly generated_at: string;
  readonly protocol_version: string;
  readonly producer_id: string;
  readonly lifecycle_tools: readonly [
    "begin_run",
    "submit_batch",
    "complete_run",
  ];
  readonly execution_policy: Readonly<Record<string, string>>;
  readonly totals: {
    readonly scheduled_tasks: 6;
    readonly source_families: 44;
    readonly agent_feed_streams: 19;
    readonly required_source_roles: 301;
  };
  readonly all_stream_ids: readonly string[];
  readonly tasks: readonly P0TaskDefinition[];
  readonly pack_sha256: string;
}

export type P0TaskPackAdmission =
  | {
      readonly ok: true;
      readonly pack: P0ChatGPTTaskPack;
      readonly pack_sha256: string;
    }
  | { readonly ok: false; readonly issues: readonly string[] };

export interface P0ExpectedScopeTarget {
  readonly target_id: string;
  readonly family_id: string;
  readonly source_role_id: string;
  readonly provider_or_scope: string | null;
  readonly cadence_seconds: number;
  readonly registered_source_hints: readonly P0RegisteredSourceHint[];
  readonly recovered_role_locator_hints: readonly P0RecoveredRoleLocatorHint[];
}

export type P0WorkUnitSelection = "all" | "retry";

export interface P0AgentFeedWorkUnitRequest {
  readonly version: typeof P0_AGENT_FEED_WORK_UNIT_REQUEST_VERSION;
  readonly plan_sha256: string;
  readonly manifest_sha256: string;
  readonly task_pack_sha256: string | null;
  readonly task_id: string | null;
  readonly producer_id: string;
  readonly protocol_version: string;
  readonly stream_id: string;
  readonly family_id: string;
  /** Full family-unit identity used by receipt reconciliation. */
  readonly work_unit_sha256: string;
  readonly selection: P0WorkUnitSelection;
  /** Full family size, even when a retry request contains a subset. */
  readonly full_target_count: number;
  /** Targets to check in this occurrence. */
  readonly targets: readonly P0OperationTarget[];
  /** Agent Feed expected scope plus untrusted locator leads. */
  readonly expected_scope: readonly P0ExpectedScopeTarget[];
  readonly request_sha256: string;
}

export interface P0ProgressSnapshot {
  readonly version: typeof P0_PROGRESS_SNAPSHOT_VERSION;
  readonly plan_sha256: string;
  readonly manifest_sha256: string;
  readonly checkpoints: readonly P0TargetCheckpoint[];
}

export interface P0PreparedOperations {
  readonly version: typeof P0_PREPARED_OPERATIONS_VERSION;
  readonly plan_sha256: string;
  readonly manifest_sha256: string;
  readonly task_pack_sha256: string | null;
  readonly selection: P0WorkUnitSelection;
  readonly effective_at: string | null;
  readonly input_sha256: string | null;
  readonly target_count: number;
  readonly work_unit_count: number;
  readonly work_units: readonly P0AgentFeedWorkUnitRequest[];
  readonly prepared_sha256: string;
}

export interface P0PrepareOptions {
  readonly selection?: P0WorkUnitSelection;
  readonly effective_at?: string;
  readonly input_sha256?: string;
  readonly stale_after_seconds?: number;
  readonly task_id?: string;
  readonly stream_id?: string;
  readonly family_id?: string;
  /** A progress snapshot, receipt, checkpoint, or an array of those files. */
  readonly progress?: unknown;
}

export interface P0SingleWorkUnitRequestOptions {
  readonly selection?: P0WorkUnitSelection;
  readonly target_ids?: readonly string[];
  readonly task_id?: string;
}

export interface P0OperationsStoreLike {
  readonly reconcile: (input: unknown) => Promise<{
    readonly inserted_count: number;
    readonly duplicate_count: number;
  }>;
}

export interface P0OperationsDriver {
  readonly plan: P0SourceRolePlan;
  readonly manifest: P0OperationsManifest;
  readonly task_pack: P0ChatGPTTaskPack | null;
  readonly prepare: (options?: P0PrepareOptions) => P0PreparedOperations;
  readonly reconcile: (input: unknown) => Promise<{
    readonly receipt: P0ReceiptReconciliation;
    readonly inserted_count: number;
    readonly duplicate_count: number;
  }>;
}

function issue(message: string): P0TaskPackAdmission {
  return { ok: false, issues: [message] };
}

function parseRegisteredHint(value: unknown): P0RegisteredSourceHint | null {
  if (!record(value) || !exactKeys(value, REGISTERED_HINT_KEYS)) return null;
  if (
    !validSourceId(value.source_id) ||
    !validHttps(value.source_url) ||
    !uniqueStrings(value.authority_scope) ||
    value.authority_scope.length === 0 ||
    typeof value.registration_status !== "string" ||
    value.registration_status.length === 0 ||
    typeof value.hint_status !== "string" ||
    value.hint_status.length === 0
  )
    return null;
  return {
    source_id: value.source_id,
    source_url: value.source_url,
    authority_scope: cloneStringArray(sortedStrings(value.authority_scope)),
    registration_status: value.registration_status,
    hint_status: value.hint_status,
  };
}

function parseRecoveredHint(value: unknown): P0RecoveredRoleLocatorHint | null {
  if (!record(value) || !exactKeys(value, RECOVERED_HINT_KEYS)) return null;
  if (
    !validId(value.source_role_id) ||
    !validHttps(value.source_url) ||
    typeof value.publisher !== "string" ||
    value.publisher.length === 0 ||
    typeof value.role_marker !== "string" ||
    value.role_marker.length === 0 ||
    (value.exact_registered_source_id !== null &&
      !validSourceId(value.exact_registered_source_id)) ||
    !uniqueStrings(value.related_registered_source_ids) ||
    typeof value.hint_status !== "string" ||
    value.hint_status.length === 0
  )
    return null;
  return {
    source_role_id: value.source_role_id,
    source_url: value.source_url,
    publisher: value.publisher,
    role_marker: value.role_marker,
    exact_registered_source_id: value.exact_registered_source_id,
    related_registered_source_ids: cloneStringArray(
      sortedStrings(value.related_registered_source_ids),
    ),
    hint_status: value.hint_status,
  };
}

function parseTaskTarget(value: unknown): P0TaskTarget | null {
  if (!record(value) || !exactKeys(value, TASK_TARGET_KEYS)) return null;
  if (
    !validId(value.family_id) ||
    typeof value.provider_or_scope !== "string" ||
    value.provider_or_scope.length === 0 ||
    !validId(value.stream_id) ||
    !Number.isSafeInteger(value.recommended_cadence_seconds) ||
    (value.recommended_cadence_seconds as number) < 1 ||
    !uniqueStrings(value.required_source_roles) ||
    value.required_source_roles.length === 0 ||
    !Array.isArray(value.registered_source_hints) ||
    !Array.isArray(value.recovered_role_locator_hints)
  )
    return null;
  const cadence = value.recommended_cadence_seconds as number;
  const requiredRoles = value.required_source_roles as string[];
  const registered = value.registered_source_hints.map(parseRegisteredHint);
  const recovered = value.recovered_role_locator_hints.map(parseRecoveredHint);
  if (
    registered.some((hint) => hint === null) ||
    recovered.some((hint) => hint === null)
  )
    return null;
  const registeredHints = registered as P0RegisteredSourceHint[];
  const recoveredHints = recovered as P0RecoveredRoleLocatorHint[];
  if (
    new Set(registeredHints.map((hint) => hint.source_id)).size !==
      registeredHints.length ||
    new Set(recoveredHints.map((hint) => hint.source_role_id)).size !==
      recoveredHints.length
  )
    return null;
  return {
    family_id: value.family_id,
    provider_or_scope: value.provider_or_scope,
    stream_id: value.stream_id,
    recommended_cadence_seconds: cadence,
    required_source_roles: cloneStringArray(sortedStrings(requiredRoles)),
    registered_source_hints: deepFreeze(
      sortedBy(registeredHints, (left, right) =>
        left.source_id.localeCompare(right.source_id),
      ),
    ),
    recovered_role_locator_hints: deepFreeze(
      sortedBy(
        recoveredHints,
        (left, right) =>
          left.source_role_id.localeCompare(right.source_role_id) ||
          left.source_url.localeCompare(right.source_url),
      ),
    ),
  };
}

function parseTask(value: unknown): P0TaskDefinition | null {
  if (!record(value) || !exactKeys(value, TASK_KEYS)) return null;
  if (
    !validId(value.task_id) ||
    typeof value.display_name !== "string" ||
    value.display_name.length === 0 ||
    typeof value.schedule_mode !== "string" ||
    value.schedule_mode.length === 0 ||
    !Array.isArray(value.targets) ||
    !uniqueStrings(value.allowed_stream_ids)
  )
    return null;
  const allowedStreamIds = value.allowed_stream_ids as string[];
  const targets = value.targets.map(parseTaskTarget);
  if (targets.some((target) => target === null)) return null;
  const parsedTargets = targets as P0TaskTarget[];
  if (
    new Set(parsedTargets.map((target) => target.family_id)).size !==
      parsedTargets.length ||
    new Set(parsedTargets.map((target) => target.stream_id)).size !==
      new Set(allowedStreamIds).size ||
    parsedTargets.some((target) => !allowedStreamIds.includes(target.stream_id))
  )
    return null;
  return {
    task_id: value.task_id,
    display_name: value.display_name,
    schedule_mode: value.schedule_mode,
    targets: deepFreeze(
      sortedBy(parsedTargets, (left, right) =>
        left.family_id.localeCompare(right.family_id),
      ),
    ),
    allowed_stream_ids: cloneStringArray(sortedStrings(allowedStreamIds)),
  };
}

/**
 * Validate and normalize the task pack as plain data. This function does not
 * bind family-role targets to a plan; use bindP0TaskPack for that stronger
 * admission. A task-pack URL is retained only as a locator hint.
 */
export function admitP0TaskPack(value: unknown): P0TaskPackAdmission {
  const scan = scanPlainData(value);
  if (!scan.ok || !record(scan.value) || !exactKeys(scan.value, TASK_PACK_KEYS))
    return issue("p0_task_pack_invalid");
  const input = scan.value;
  if (
    input.version !== "p0-chatgpt-agent-feed-task-pack.v0.1" ||
    !SHA256.test(String(input.source_plan_sha256)) ||
    !validDateTime(input.generated_at) ||
    typeof input.protocol_version !== "string" ||
    input.protocol_version.length === 0 ||
    !validId(input.producer_id) ||
    !Array.isArray(input.lifecycle_tools) ||
    input.lifecycle_tools.length !== 3 ||
    input.lifecycle_tools[0] !== "begin_run" ||
    input.lifecycle_tools[1] !== "submit_batch" ||
    input.lifecycle_tools[2] !== "complete_run" ||
    !record(input.execution_policy) ||
    !exactKeys(input.execution_policy, EXECUTION_POLICY_KEYS) ||
    EXECUTION_POLICY_KEYS.some(
      (key) =>
        typeof (input.execution_policy as JsonRecord)[key] !== "string" ||
        ((input.execution_policy as JsonRecord)[key] as string).length === 0,
    ) ||
    !record(input.totals) ||
    !exactKeys(input.totals, PACK_TOTAL_KEYS) ||
    input.totals.scheduled_tasks !== 6 ||
    input.totals.source_families !== 44 ||
    input.totals.agent_feed_streams !== 19 ||
    input.totals.required_source_roles !== 301 ||
    !uniqueStrings(input.all_stream_ids) ||
    !Array.isArray(input.tasks) ||
    input.tasks.length !== 6 ||
    !SHA256.test(String(input.pack_sha256))
  )
    return issue("p0_task_pack_invalid");

  const executionPolicy = input.execution_policy as JsonRecord;
  const totals = input.totals as JsonRecord;
  const allStreamIds = input.all_stream_ids as string[];
  const tasksInput = input.tasks as unknown[];
  const tasks = tasksInput.map(parseTask);
  if (tasks.some((task) => task === null)) return issue("p0_task_pack_invalid");
  const parsedTasks = tasks as P0TaskDefinition[];
  if (
    new Set(parsedTasks.map((task) => task.task_id)).size !==
      parsedTasks.length ||
    parsedTasks.some(
      (task) =>
        task.allowed_stream_ids.length === 0 ||
        task.allowed_stream_ids.some(
          (streamId) => !allStreamIds.includes(streamId),
        ),
    )
  )
    return issue("p0_task_pack_invalid");

  const projection = {
    version: input.version,
    source_plan_sha256: input.source_plan_sha256,
    generated_at: input.generated_at,
    protocol_version: input.protocol_version,
    producer_id: input.producer_id,
    lifecycle_tools: ["begin_run", "submit_batch", "complete_run"] as const,
    execution_policy: { ...executionPolicy },
    totals: { ...totals },
    all_stream_ids: sortedStrings(allStreamIds),
    tasks: sortedBy(parsedTasks, (left, right) =>
      left.task_id.localeCompare(right.task_id),
    ),
  };
  if (canonicalSha256(projection) !== input.pack_sha256)
    return issue("p0_task_pack_hash_mismatch");
  const pack = deepFreeze({
    ...projection,
    pack_sha256: input.pack_sha256,
  }) as unknown as P0ChatGPTTaskPack;
  return { ok: true, pack, pack_sha256: pack.pack_sha256 };
}

function packForPlan(
  plan: P0SourceRolePlan,
  value: unknown,
): P0ChatGPTTaskPack {
  if (!isAdmittedP0SourceRolePlan(plan))
    throw new TypeError("p0_plan_not_admitted");
  const result = admitP0TaskPack(value);
  if (!result.ok)
    throw new TypeError(result.issues[0] ?? "p0_task_pack_invalid");
  const pack = result.pack;
  const planHash = hashP0SourceRolePlan(plan);
  if (pack.source_plan_sha256 !== planHash)
    throw new TypeError("p0_task_pack_plan_mismatch");

  const families = new Map(
    plan.families.map((family) => [family.family_id, family]),
  );
  const seenFamilies = new Set<string>();
  const seenRoles = new Set<string>();
  for (const task of pack.tasks) {
    const allowed = new Set(task.allowed_stream_ids);
    for (const target of task.targets) {
      const family = families.get(target.family_id);
      if (
        !family ||
        seenFamilies.has(target.family_id) ||
        family.provider_or_scope !== target.provider_or_scope ||
        family.stream_id !== target.stream_id ||
        family.recommended_cadence_seconds !==
          target.recommended_cadence_seconds ||
        !allowed.has(target.stream_id) ||
        target.required_source_roles.length !==
          family.required_source_roles.length ||
        target.required_source_roles.some(
          (role, index) => role !== family.required_source_roles[index],
        )
      )
        throw new TypeError("p0_task_pack_target_mismatch");
      seenFamilies.add(target.family_id);
      for (const role of target.required_source_roles) {
        const key = `${target.family_id}\u0000${role}`;
        if (seenRoles.has(key))
          throw new TypeError("p0_task_pack_target_mismatch");
        seenRoles.add(key);
      }
      for (const hint of target.recovered_role_locator_hints) {
        if (!target.required_source_roles.includes(hint.source_role_id))
          throw new TypeError("p0_task_pack_locator_hint_mismatch");
      }
    }
  }
  if (
    seenFamilies.size !== P0_EXPECTED_FAMILY_COUNT ||
    seenRoles.size !== P0_EXPECTED_ROLE_COUNT ||
    new Set(pack.all_stream_ids).size !== P0_EXPECTED_STREAM_COUNT ||
    plan.families.some((family) => !seenFamilies.has(family.family_id)) ||
    [...new Set(plan.families.map((family) => family.stream_id))].some(
      (streamId) => !pack.all_stream_ids.includes(streamId),
    )
  )
    throw new TypeError("p0_task_pack_coverage_mismatch");
  return pack;
}

/** Bind an admitted task pack to the exact sealed plan. */
export function bindP0TaskPack(
  plan: P0SourceRolePlan,
  value: unknown,
): P0ChatGPTTaskPack {
  return packForPlan(plan, value);
}

function ensurePack(
  plan: P0SourceRolePlan,
  taskPack: P0ChatGPTTaskPack | unknown | null | undefined,
): P0ChatGPTTaskPack | null {
  if (taskPack === null || taskPack === undefined) return null;
  return packForPlan(plan, taskPack);
}

function looksLikePrepareOptions(value: unknown): value is P0PrepareOptions {
  if (!record(value) || "version" in value) return false;
  return [
    "selection",
    "effective_at",
    "input_sha256",
    "stale_after_seconds",
    "progress",
    "task_id",
    "stream_id",
    "family_id",
  ].some((key) => Object.hasOwn(value, key));
}

function taskForFamily(
  pack: P0ChatGPTTaskPack | null,
  familyId: string,
): { readonly task: P0TaskDefinition; readonly target: P0TaskTarget } | null {
  if (!pack) return null;
  for (const task of pack.tasks) {
    const target = task.targets.find((item) => item.family_id === familyId);
    if (target) return { task, target };
  }
  return null;
}

function targetHintScope(
  operationTarget: P0OperationTarget,
  taskTarget: P0TaskTarget | null,
): P0ExpectedScopeTarget {
  return {
    target_id: operationTarget.target_id,
    family_id: operationTarget.family_id,
    source_role_id: operationTarget.source_role_id,
    provider_or_scope: taskTarget?.provider_or_scope ?? null,
    cadence_seconds: operationTarget.cadence_seconds,
    registered_source_hints: taskTarget?.registered_source_hints ?? [],
    recovered_role_locator_hints:
      taskTarget?.recovered_role_locator_hints.filter(
        (hint) => hint.source_role_id === operationTarget.source_role_id,
      ) ?? [],
  };
}

function requestProjection(
  values: Omit<P0AgentFeedWorkUnitRequest, "request_sha256">,
): Omit<P0AgentFeedWorkUnitRequest, "request_sha256"> {
  return values;
}

/**
 * Build one deterministic request. `targets` is the occurrence selection;
 * `work_unit_sha256` remains the full family-unit identity so PostgreSQL can
 * reconcile a partial retry without changing the sealed manifest contract.
 */
export function buildP0AgentFeedWorkUnitRequest(
  plan: P0SourceRolePlan,
  streamId: string,
  familyId: string,
  options?: P0SingleWorkUnitRequestOptions,
): P0AgentFeedWorkUnitRequest;
export function buildP0AgentFeedWorkUnitRequest(
  plan: P0SourceRolePlan,
  taskPack: P0ChatGPTTaskPack | unknown | null | undefined,
  streamId: string,
  familyId: string,
  options?: P0SingleWorkUnitRequestOptions,
): P0AgentFeedWorkUnitRequest;
export function buildP0AgentFeedWorkUnitRequest(
  plan: P0SourceRolePlan,
  taskPackOrOptions: P0ChatGPTTaskPack | unknown | null | undefined,
  streamId?: string,
  familyId?: string | P0SingleWorkUnitRequestOptions,
  options: P0SingleWorkUnitRequestOptions = {},
): P0AgentFeedWorkUnitRequest {
  if (!isAdmittedP0SourceRolePlan(plan))
    throw new TypeError("p0_plan_not_admitted");
  const noPack = typeof taskPackOrOptions === "string";
  const taskPack = noPack ? null : taskPackOrOptions;
  const actualStreamId = noPack ? taskPackOrOptions : streamId;
  const actualFamilyId = noPack ? streamId : familyId;
  const actualOptions = noPack
    ? ((familyId as unknown as P0SingleWorkUnitRequestOptions | undefined) ??
      {})
    : options;
  if (
    typeof actualStreamId !== "string" ||
    typeof actualFamilyId !== "string" ||
    looksLikePrepareOptions(taskPack)
  )
    throw new TypeError("p0_work_unit_arguments_invalid");
  const pack = ensurePack(plan, taskPack);
  const unit = buildP0FamilyWorkUnit(plan, actualStreamId, actualFamilyId);
  const selection = actualOptions.selection ?? "all";
  const selectedIds = actualOptions.target_ids
    ? [...new Set(actualOptions.target_ids)]
    : unit.targets.map((target) => target.target_id);
  if (
    (selection !== "all" && selection !== "retry") ||
    selectedIds.length === 0 ||
    (selection === "all" && selectedIds.length !== unit.targets.length)
  )
    throw new TypeError("p0_work_unit_selection_invalid");
  const unitTargetIds = new Set(unit.targets.map((target) => target.target_id));
  if (selectedIds.some((targetId) => !unitTargetIds.has(targetId)))
    throw new TypeError("p0_work_unit_selection_invalid");
  const targets = unit.targets.filter((target) =>
    selectedIds.includes(target.target_id),
  );
  const familyTask = taskForFamily(pack, actualFamilyId);
  if (
    actualOptions.task_id !== undefined &&
    familyTask?.task.task_id !== actualOptions.task_id
  )
    throw new TypeError("p0_task_not_found");
  const expectedScope = targets.map((target) =>
    targetHintScope(target, familyTask?.target ?? null),
  );
  const projection = requestProjection({
    version: P0_AGENT_FEED_WORK_UNIT_REQUEST_VERSION,
    plan_sha256: unit.plan_sha256,
    manifest_sha256: unit.manifest_sha256,
    task_pack_sha256: pack?.pack_sha256 ?? null,
    task_id: familyTask?.task.task_id ?? null,
    producer_id: pack?.producer_id ?? "p0-rewards-driver",
    protocol_version: pack?.protocol_version ?? "0.1",
    stream_id: unit.stream_id,
    family_id: unit.family_id,
    work_unit_sha256: unit.work_unit_sha256,
    selection,
    full_target_count: unit.targets.length,
    targets,
    expected_scope: expectedScope,
  });
  return deepFreeze({
    ...projection,
    request_sha256: canonicalSha256(projection),
  });
}

function familyIdsForFilter(
  manifest: P0OperationsManifest,
  pack: P0ChatGPTTaskPack | null,
  options: P0PrepareOptions,
): readonly { readonly stream_id: string; readonly family_id: string }[] {
  const units: { stream_id: string; family_id: string }[] = [];
  const allowedFamilyIds = new Set(
    pack?.tasks
      .filter(
        (task) =>
          options.task_id === undefined || task.task_id === options.task_id,
      )
      .flatMap((task) => task.targets.map((target) => target.family_id)) ??
      manifest.streams.flatMap((stream) =>
        stream.targets.map((target) => target.family_id),
      ),
  );
  for (const stream of manifest.streams) {
    if (
      options.stream_id !== undefined &&
      stream.stream_id !== options.stream_id
    )
      continue;
    for (const familyId of stream.family_ids) {
      if (
        allowedFamilyIds.has(familyId) &&
        (options.family_id === undefined || options.family_id === familyId)
      )
        units.push({ stream_id: stream.stream_id, family_id: familyId });
    }
  }
  return units.sort(
    (left, right) =>
      left.stream_id.localeCompare(right.stream_id) ||
      left.family_id.localeCompare(right.family_id),
  );
}

/**
 * Build every selected family/stream request. No request is sent to Agent
 * Feed; this is a pure deterministic enumeration step.
 */
export function buildP0AgentFeedWorkUnitRequests(
  plan: P0SourceRolePlan,
  options?: P0PrepareOptions,
): readonly P0AgentFeedWorkUnitRequest[];
export function buildP0AgentFeedWorkUnitRequests(
  plan: P0SourceRolePlan,
  taskPack: P0ChatGPTTaskPack | unknown | null | undefined,
  options?: P0PrepareOptions,
): readonly P0AgentFeedWorkUnitRequest[];
export function buildP0AgentFeedWorkUnitRequests(
  plan: P0SourceRolePlan,
  taskPack: P0ChatGPTTaskPack | unknown | null | undefined = null,
  options: P0PrepareOptions = {},
): readonly P0AgentFeedWorkUnitRequest[] {
  if (!isAdmittedP0SourceRolePlan(plan))
    throw new TypeError("p0_plan_not_admitted");
  if (looksLikePrepareOptions(taskPack) && Object.keys(options).length === 0) {
    options = taskPack;
    taskPack = null;
  }
  const pack = ensurePack(plan, taskPack);
  const manifest = buildP0OperationsManifest(plan);
  const selection = options.selection ?? "all";
  if (
    options.task_id !== undefined &&
    (!pack || !pack.tasks.some((task) => task.task_id === options.task_id))
  )
    throw new TypeError("p0_task_not_found");
  if (
    options.stream_id !== undefined &&
    !manifest.streams.some((stream) => stream.stream_id === options.stream_id)
  )
    throw new TypeError("p0_stream_not_found");
  if (
    options.family_id !== undefined &&
    !manifest.streams.some((stream) =>
      stream.targets.some((target) => target.family_id === options.family_id),
    )
  )
    throw new TypeError("p0_family_not_found");
  if (selection !== "all" && selection !== "retry")
    throw new TypeError("p0_work_unit_selection_invalid");
  if (
    selection === "retry" &&
    (!validDateTime(options.effective_at) ||
      !SHA256.test(String(options.input_sha256)))
  )
    throw new TypeError("p0_retry_options_invalid");

  const selectedIdsByFamily = new Map<string, string[]>();
  if (selection === "retry") {
    const checkpoints = collectP0CheckpointInputs(
      manifest,
      options.progress ?? [],
    );
    const retryOptions: {
      readonly effective_at: string;
      readonly input_sha256: string;
      readonly stale_after_seconds?: number;
    } = {
      effective_at: options.effective_at as string,
      input_sha256: options.input_sha256 as string,
      ...(options.stale_after_seconds === undefined
        ? {}
        : { stale_after_seconds: options.stale_after_seconds }),
    };
    const worklist = selectP0RetryTargets(manifest, checkpoints, retryOptions);
    for (const target of worklist.targets) {
      const ids = selectedIdsByFamily.get(target.family_id) ?? [];
      ids.push(target.target_id);
      selectedIdsByFamily.set(target.family_id, ids);
    }
  }

  const requests: P0AgentFeedWorkUnitRequest[] = [];
  for (const unit of familyIdsForFilter(manifest, pack, options)) {
    const targetIds =
      selection === "all" ? undefined : selectedIdsByFamily.get(unit.family_id);
    if (selection === "retry" && (!targetIds || targetIds.length === 0))
      continue;
    const requestOptions: {
      readonly selection: P0WorkUnitSelection;
      readonly target_ids?: readonly string[];
      readonly task_id?: string;
    } = {
      selection,
      ...(targetIds === undefined ? {} : { target_ids: targetIds }),
      ...(options.task_id === undefined ? {} : { task_id: options.task_id }),
    };
    requests.push(
      buildP0AgentFeedWorkUnitRequest(
        plan,
        pack,
        unit.stream_id,
        unit.family_id,
        requestOptions,
      ),
    );
  }
  return deepFreeze(requests);
}

/** Alias emphasizing that a complete plan selection is the default. */
export const buildP0AllWorkUnitRequests = buildP0AgentFeedWorkUnitRequests;

/** Alias for callers that already have persisted checkpoints. */
export function selectP0RetryWorkUnitRequests(
  plan: P0SourceRolePlan,
  checkpoints: readonly unknown[],
  options: Omit<P0PrepareOptions, "selection" | "progress"> & {
    readonly effective_at: string;
    readonly input_sha256: string;
  },
  taskPack: P0ChatGPTTaskPack | unknown | null | undefined = null,
): readonly P0AgentFeedWorkUnitRequest[] {
  return buildP0AgentFeedWorkUnitRequests(plan, taskPack, {
    ...options,
    selection: "retry",
    progress: checkpoints,
  });
}

function canonicalCheckpointList(
  manifest: P0OperationsManifest,
  values: readonly unknown[],
): readonly P0TargetCheckpoint[] {
  const scan = scanPlainData(values);
  if (!scan.ok || !Array.isArray(scan.value))
    throw new TypeError("p0_checkpoint_invalid");
  const admitted = scan.value.map((value) =>
    admitP0TargetCheckpoint(manifest, value),
  );
  reduceP0TargetCheckpoints(manifest, admitted);
  const deduped = new Map<string, P0TargetCheckpoint>();
  for (const checkpoint of admitted) {
    const key = `${checkpoint.target_id}\u0000${checkpoint.idempotency_key}`;
    const prior = deduped.get(key);
    if (prior && canonicalSha256(prior) !== canonicalSha256(checkpoint))
      throw new TypeError("p0_checkpoint_idempotency_conflict");
    deduped.set(key, checkpoint);
  }
  return deepFreeze([...deduped.values()].sort(compareCheckpoint));
}

/** Build a canonical durable progress snapshot from admitted checkpoints. */
export function buildP0ProgressSnapshot(
  manifest: P0OperationsManifest,
  checkpoints: readonly unknown[],
): P0ProgressSnapshot {
  const values = canonicalCheckpointList(manifest, checkpoints);
  return deepFreeze({
    version: P0_PROGRESS_SNAPSHOT_VERSION,
    plan_sha256: manifest.plan_sha256,
    manifest_sha256: manifest.manifest_sha256,
    checkpoints: values,
  });
}

/** Admit a progress snapshot before it is used to select a retry. */
export function admitP0ProgressSnapshot(
  manifest: P0OperationsManifest,
  value: unknown,
): P0ProgressSnapshot {
  const scan = scanPlainData(value);
  if (
    !scan.ok ||
    !record(scan.value) ||
    !exactKeys(scan.value, PROGRESS_KEYS) ||
    scan.value.version !== P0_PROGRESS_SNAPSHOT_VERSION ||
    scan.value.plan_sha256 !== manifest.plan_sha256 ||
    scan.value.manifest_sha256 !== manifest.manifest_sha256 ||
    !Array.isArray(scan.value.checkpoints)
  )
    throw new TypeError("p0_progress_snapshot_invalid");
  try {
    return buildP0ProgressSnapshot(manifest, scan.value.checkpoints);
  } catch {
    throw new TypeError("p0_progress_snapshot_invalid");
  }
}

/**
 * Read persisted checkpoint material without treating task-pack locator hints
 * as outcomes. Accepted inputs are progress snapshots, reconciliation receipts,
 * individual checkpoints, or an array of those records.
 */
export function collectP0CheckpointInputs(
  manifest: P0OperationsManifest,
  value: unknown,
): readonly P0TargetCheckpoint[] {
  const scan = scanPlainData(value);
  if (!scan.ok) throw new TypeError("p0_progress_input_invalid");
  const values: unknown[] = Array.isArray(scan.value)
    ? scan.value
    : [scan.value];
  const checkpoints: P0TargetCheckpoint[] = [];
  for (const item of values) {
    if (!record(item) || typeof item.version !== "string")
      throw new TypeError("p0_progress_input_invalid");
    if (item.version === P0_PROGRESS_SNAPSHOT_VERSION) {
      checkpoints.push(...admitP0ProgressSnapshot(manifest, item).checkpoints);
    } else if (item.version === "p0-receipt-reconciliation.v1") {
      checkpoints.push(
        ...admitP0ReceiptReconciliation(manifest, item).checkpoints,
      );
    } else if (item.version === "p0-target-checkpoint.v1") {
      checkpoints.push(admitP0TargetCheckpoint(manifest, item));
    } else {
      throw new TypeError("p0_progress_input_invalid");
    }
  }
  return canonicalCheckpointList(manifest, checkpoints);
}

/** Prepare an immutable, hash-bound worklist for a producer invocation. */
export function prepareP0Operations(
  plan: P0SourceRolePlan,
  options?: P0PrepareOptions,
): P0PreparedOperations;
export function prepareP0Operations(
  plan: P0SourceRolePlan,
  taskPack: P0ChatGPTTaskPack | unknown | null | undefined,
  options?: P0PrepareOptions,
): P0PreparedOperations;
export function prepareP0Operations(
  plan: P0SourceRolePlan,
  taskPack: P0ChatGPTTaskPack | unknown | null | undefined = null,
  options: P0PrepareOptions = {},
): P0PreparedOperations {
  if (looksLikePrepareOptions(taskPack) && Object.keys(options).length === 0) {
    options = taskPack;
    taskPack = null;
  }
  const pack = ensurePack(plan, taskPack);
  const selection = options.selection ?? "all";
  const workUnits = buildP0AgentFeedWorkUnitRequests(plan, pack, options);
  const effectiveAt = options.effective_at ?? null;
  const inputSha256 = options.input_sha256 ?? null;
  if (selection === "all" && (effectiveAt !== null || inputSha256 !== null)) {
    if (effectiveAt !== null && !validDateTime(effectiveAt))
      throw new TypeError("p0_prepare_options_invalid");
    if (inputSha256 !== null && !SHA256.test(inputSha256))
      throw new TypeError("p0_prepare_options_invalid");
  }
  const projection = {
    version: P0_PREPARED_OPERATIONS_VERSION,
    plan_sha256: hashP0SourceRolePlan(plan),
    manifest_sha256:
      workUnits[0]?.manifest_sha256 ??
      buildP0OperationsManifest(plan).manifest_sha256,
    task_pack_sha256: pack?.pack_sha256 ?? null,
    selection,
    effective_at: effectiveAt,
    input_sha256: inputSha256,
    target_count: workUnits.reduce(
      (count, unit) => count + unit.targets.length,
      0,
    ),
    work_unit_count: workUnits.length,
    work_units: workUnits,
  };
  return deepFreeze({
    ...projection,
    prepared_sha256: canonicalSha256(projection),
  });
}

/** Admit a receipt and pass only its cloned projection to the PostgreSQL host. */
export async function reconcileP0ReceiptThroughStore(
  manifest: P0OperationsManifest,
  store: P0OperationsStoreLike,
  input: unknown,
): Promise<{
  readonly receipt: P0ReceiptReconciliation;
  readonly inserted_count: number;
  readonly duplicate_count: number;
}> {
  const receipt = admitP0ReceiptReconciliation(manifest, input);
  const result = await store.reconcile(receipt);
  return Object.freeze({ receipt, ...result });
}

/**
 * Construct a small pure driver around one admitted plan. The store is
 * optional so offline prepare/check remains dependency-free; when supplied it
 * must be the existing PostgreSQL adapter's `P0OperationsStore` surface.
 */
export function createP0OperationsDriver(
  plan: P0SourceRolePlan,
  taskPack: P0ChatGPTTaskPack | unknown | null | undefined = null,
  store?: P0OperationsStoreLike,
): P0OperationsDriver {
  if (!isAdmittedP0SourceRolePlan(plan))
    throw new TypeError("p0_plan_not_admitted");
  const boundPack = ensurePack(plan, taskPack);
  const manifest = buildP0OperationsManifest(plan);
  return Object.freeze({
    plan,
    manifest,
    task_pack: boundPack,
    prepare: (options: P0PrepareOptions = {}) =>
      prepareP0Operations(plan, boundPack, options),
    reconcile: async (input: unknown) => {
      if (!store) throw new TypeError("p0_operations_store_unconfigured");
      return reconcileP0ReceiptThroughStore(manifest, store, input);
    },
  });
}

/** Validate one receipt file and return its checkpoints for progress merge. */
export function admitP0ReceiptFile(
  manifest: P0OperationsManifest,
  input: unknown,
): P0ReceiptReconciliation {
  return admitP0ReceiptReconciliation(manifest, input);
}

/** The driver refuses to widen a family unit beyond the existing eight-target contract. */
export function checkP0OperationsInvariants(
  plan: P0SourceRolePlan,
  taskPack: P0ChatGPTTaskPack | unknown | null | undefined = null,
): {
  readonly plan_sha256: string;
  readonly manifest_sha256: string;
  readonly family_count: number;
  readonly stream_count: number;
  readonly target_count: number;
  readonly work_unit_count: number;
  readonly max_work_unit_targets: number;
} {
  const pack = ensurePack(plan, taskPack);
  const manifest = buildP0OperationsManifest(plan);
  const units = buildP0AgentFeedWorkUnitRequests(plan, pack);
  return Object.freeze({
    plan_sha256: manifest.plan_sha256,
    manifest_sha256: manifest.manifest_sha256,
    family_count: manifest.family_count,
    stream_count: manifest.stream_count,
    target_count: manifest.target_count,
    work_unit_count: units.length,
    max_work_unit_targets: Math.max(
      ...units.map((unit) => unit.targets.length),
    ),
  });
}

// Keep these aliases discoverable for callers that use the shorter operation
// terminology. They intentionally share the same pure implementation.
export const buildP0WorkUnitRequests = buildP0AgentFeedWorkUnitRequests;
export const selectP0RetryRequests = selectP0RetryWorkUnitRequests;
export const reconcileP0Receipt = reconcileP0ReceiptThroughStore;
