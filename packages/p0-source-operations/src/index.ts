import { canonicalize, canonicalSha256 } from "@jro/contracts";

import { deepFreeze, type ShapeIssue, scanPlainData } from "./security.js";

export const P0_SOURCE_ROLE_PLAN_VERSION = "p0-source-role-plan.v0.1" as const;
export const P0_SOURCE_READINESS_VERSION = "p0-source-readiness.v0.1" as const;
export const P0_EXPECTED_FAMILY_COUNT = 44;
export const P0_EXPECTED_STREAM_COUNT = 19;
export const P0_EXPECTED_ROLE_COUNT = 301;
export const P0_EXPECTED_PLAN_SHA256 =
  "sha256:a59447525cb207838439a3cdb8b9cc22d19d875a650a64f50354137a78892003" as const;

const PLAN_KEYS = ["families", "provenance", "version"] as const;
const PROVENANCE_KEYS = [
  "source_branch",
  "source_commit",
  "source_path",
  "source_sha256",
] as const;
const FAMILY_KEYS = [
  "baseline_planning_status",
  "category",
  "family_id",
  "priority",
  "provider_or_scope",
  "recommended_cadence_seconds",
  "required_source_roles",
  "stream_id",
] as const;
const ROLE_STATE_KEYS = [
  "evidence_status",
  "experimental_eligible",
  "family_id",
  "impact_status",
  "liveness_status",
  "permission_status",
  "producer_status",
  "source_role_id",
  "technical_status",
] as const;
const READINESS_KEYS = ["plan_sha256", "roles", "version"] as const;

const CATEGORIES = new Set([
  "credit_card_issuer",
  "e_money_transit",
  "merchant",
  "payment_wallet",
  "point_program",
  "regulatory",
]);
const PLANNING_STATUSES = new Set(["covered", "partial", "missing"]);
const CADENCES = new Set([21_600, 86_400, 604_800, 2_592_000]);
const PERMISSIONS = new Set([
  "not_reviewed",
  "approved_manual",
  "approved_automated",
  "restricted",
  "prohibited",
]);
const TECHNICAL = new Set([
  "unknown",
  "plain_http",
  "manual_capture",
  "partner_feed",
  "unavailable",
]);
const LIVENESS = new Set([
  "unregistered",
  "never_seen",
  "healthy",
  "degraded",
  "overdue",
  "disabled",
]);
const EVIDENCE = new Set([
  "absent",
  "lead_only",
  "discovery_only",
  "canonical_current",
  "canonical_stale",
  "conservative_exclusion",
]);
const IMPACT = new Set(["unmapped", "mapped"]);
const PRODUCERS = new Set(["missing", "local_unverified", "authorized"]);
const ID = /^[a-z0-9][a-z0-9._-]+$/u;
const ROLE = /^[a-z][a-z0-9_]+$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;

export type P0PlanningStatus = "covered" | "partial" | "missing";
export type P0PermissionStatus =
  | "not_reviewed"
  | "approved_manual"
  | "approved_automated"
  | "restricted"
  | "prohibited";
export type P0TechnicalStatus =
  | "unknown"
  | "plain_http"
  | "manual_capture"
  | "partner_feed"
  | "unavailable";
export type P0LivenessStatus =
  | "unregistered"
  | "never_seen"
  | "healthy"
  | "degraded"
  | "overdue"
  | "disabled";
export type P0EvidenceStatus =
  | "absent"
  | "lead_only"
  | "discovery_only"
  | "canonical_current"
  | "canonical_stale"
  | "conservative_exclusion";
export type P0ImpactStatus = "unmapped" | "mapped";
export type P0ProducerStatus = "missing" | "local_unverified" | "authorized";

export interface P0SourceFamilyPlan {
  readonly family_id: string;
  readonly category: string;
  readonly provider_or_scope: string;
  readonly priority: "P0";
  readonly baseline_planning_status: P0PlanningStatus;
  readonly stream_id: string;
  readonly recommended_cadence_seconds: number;
  readonly required_source_roles: readonly string[];
}

export interface P0SourceRolePlan {
  readonly version: typeof P0_SOURCE_ROLE_PLAN_VERSION;
  readonly provenance: {
    readonly source_branch: string;
    readonly source_commit: string;
    readonly source_path: string;
    readonly source_sha256: string;
  };
  readonly families: readonly P0SourceFamilyPlan[];
}

export interface P0RoleOperationalState {
  readonly family_id: string;
  readonly source_role_id: string;
  readonly producer_status: P0ProducerStatus;
  readonly permission_status: P0PermissionStatus;
  readonly technical_status: P0TechnicalStatus;
  readonly liveness_status: P0LivenessStatus;
  readonly evidence_status: P0EvidenceStatus;
  readonly impact_status: P0ImpactStatus;
  readonly experimental_eligible: boolean;
}

export interface P0ReadinessInput {
  readonly version: typeof P0_SOURCE_READINESS_VERSION;
  readonly plan_sha256: string;
  readonly roles: readonly P0RoleOperationalState[];
}

export type P0ReadinessBlockerCode =
  | "producer_not_authorized"
  | "permission_not_approved"
  | "technical_path_unknown"
  | "technical_path_unavailable"
  | "liveness_not_healthy"
  | "canonical_evidence_missing"
  | "canonical_evidence_stale"
  | "impact_not_mapped";

export interface P0RoleReadiness {
  readonly family_id: string;
  readonly source_role_id: string;
  readonly ready: boolean;
  readonly experimental_eligible: boolean;
  readonly blockers: readonly P0ReadinessBlockerCode[];
}

export interface P0FamilyReadiness {
  readonly family_id: string;
  readonly baseline_planning_status: P0PlanningStatus;
  readonly ready: boolean;
  readonly required_role_count: number;
  readonly ready_role_count: number;
  readonly experimental_role_count: number;
  readonly blocker_count: number;
}

export interface P0ReadinessReport {
  readonly plan_sha256: string;
  readonly family_count: number;
  readonly stream_count: number;
  readonly required_role_count: number;
  readonly ready_family_count: number;
  readonly ready_role_count: number;
  readonly experimental_role_count: number;
  readonly roles: readonly P0RoleReadiness[];
  readonly families: readonly P0FamilyReadiness[];
}

export interface P0PlanIssue {
  readonly code: "hostile_input" | "invalid_shape" | "plan_invariant_failed";
  readonly path: string;
  readonly message: string;
}

export type P0PlanAdmission =
  | {
      readonly ok: true;
      readonly plan: P0SourceRolePlan;
      readonly plan_sha256: string;
      readonly family_count: 44;
      readonly stream_count: 19;
      readonly required_role_count: 301;
    }
  | { readonly ok: false; readonly issues: readonly P0PlanIssue[] };

const planBrand = new WeakSet<object>();

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  path: string,
  issues: P0PlanIssue[],
): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => key !== wanted[index])
  ) {
    issues.push({
      code: "invalid_shape",
      path,
      message: `expected exact keys ${wanted.join(",")}`,
    });
    return false;
  }
  return true;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fromShapeIssue(issue: ShapeIssue): P0PlanIssue {
  return {
    code: issue.code === "hostile_input" ? "hostile_input" : "invalid_shape",
    path: issue.path,
    message: issue.message,
  };
}

function sortFamily(family: P0SourceFamilyPlan): P0SourceFamilyPlan {
  return {
    ...family,
    required_source_roles: [...family.required_source_roles].sort(
      (left, right) => left.localeCompare(right),
    ),
  };
}

function parseFamily(
  value: unknown,
  path: string,
  issues: P0PlanIssue[],
): P0SourceFamilyPlan | null {
  if (!record(value) || !exactKeys(value, FAMILY_KEYS, path, issues))
    return null;
  const roles = value.required_source_roles;
  const valid =
    typeof value.family_id === "string" &&
    ID.test(value.family_id) &&
    typeof value.category === "string" &&
    CATEGORIES.has(value.category) &&
    typeof value.provider_or_scope === "string" &&
    value.provider_or_scope.length > 0 &&
    value.priority === "P0" &&
    typeof value.baseline_planning_status === "string" &&
    PLANNING_STATUSES.has(value.baseline_planning_status) &&
    typeof value.stream_id === "string" &&
    ID.test(value.stream_id) &&
    typeof value.recommended_cadence_seconds === "number" &&
    CADENCES.has(value.recommended_cadence_seconds) &&
    Array.isArray(roles) &&
    roles.length > 0 &&
    roles.every((role) => typeof role === "string" && ROLE.test(role)) &&
    new Set(roles).size === roles.length;
  if (!valid) {
    issues.push({
      code: "invalid_shape",
      path,
      message: "family record is invalid",
    });
    return null;
  }
  return sortFamily({
    family_id: value.family_id as string,
    category: value.category as string,
    provider_or_scope: value.provider_or_scope as string,
    priority: "P0",
    baseline_planning_status:
      value.baseline_planning_status as P0PlanningStatus,
    stream_id: value.stream_id as string,
    recommended_cadence_seconds: value.recommended_cadence_seconds as number,
    required_source_roles: roles as string[],
  });
}

export function admitP0SourceRolePlan(value: unknown): P0PlanAdmission {
  const scan = scanPlainData(value);
  if (!scan.ok) return { ok: false, issues: scan.issues.map(fromShapeIssue) };
  const issues: P0PlanIssue[] = [];
  if (!record(scan.value) || !exactKeys(scan.value, PLAN_KEYS, "", issues))
    return { ok: false, issues };
  if (scan.value.version !== P0_SOURCE_ROLE_PLAN_VERSION)
    issues.push({
      code: "invalid_shape",
      path: "/version",
      message: "unsupported plan version",
    });
  const provenance = scan.value.provenance;
  if (
    !record(provenance) ||
    !exactKeys(provenance, PROVENANCE_KEYS, "/provenance", issues)
  ) {
    issues.push({
      code: "invalid_shape",
      path: "/provenance",
      message: "provenance is invalid",
    });
  } else if (
    typeof provenance.source_branch !== "string" ||
    typeof provenance.source_commit !== "string" ||
    !/^[0-9a-f]{40}$/u.test(provenance.source_commit) ||
    typeof provenance.source_path !== "string" ||
    typeof provenance.source_sha256 !== "string" ||
    !SHA256.test(provenance.source_sha256)
  ) {
    issues.push({
      code: "invalid_shape",
      path: "/provenance",
      message: "provenance values are invalid",
    });
  }
  const families: P0SourceFamilyPlan[] = [];
  if (!Array.isArray(scan.value.families)) {
    issues.push({
      code: "invalid_shape",
      path: "/families",
      message: "families must be an array",
    });
  } else {
    scan.value.families.forEach((family, index) => {
      const parsed = parseFamily(family, `/families/${index}`, issues);
      if (parsed) families.push(parsed);
    });
  }
  families.sort((left, right) => left.family_id.localeCompare(right.family_id));
  const familyIds = families.map((family) => family.family_id);
  const streams = new Set(families.map((family) => family.stream_id));
  const roleKeys = families.flatMap((family) =>
    family.required_source_roles.map(
      (role) => `${family.family_id}\u0000${role}`,
    ),
  );
  if (
    families.length !== P0_EXPECTED_FAMILY_COUNT ||
    new Set(familyIds).size !== P0_EXPECTED_FAMILY_COUNT ||
    streams.size !== P0_EXPECTED_STREAM_COUNT ||
    roleKeys.length !== P0_EXPECTED_ROLE_COUNT ||
    new Set(roleKeys).size !== P0_EXPECTED_ROLE_COUNT
  ) {
    issues.push({
      code: "plan_invariant_failed",
      path: "/families",
      message:
        "plan must contain exactly 44 families, 19 streams, and 301 unique family-role requirements",
    });
  }
  if (issues.length > 0) return { ok: false, issues };
  const plan = deepFreeze({
    version: P0_SOURCE_ROLE_PLAN_VERSION,
    provenance: { ...(provenance as P0SourceRolePlan["provenance"]) },
    families,
  }) as P0SourceRolePlan;
  const planHash = canonicalSha256(plan);
  if (planHash !== P0_EXPECTED_PLAN_SHA256) {
    return {
      ok: false,
      issues: [
        {
          code: "plan_invariant_failed",
          path: "",
          message:
            "plan content does not match the admitted P0 planning snapshot",
        },
      ],
    };
  }
  planBrand.add(plan);
  return {
    ok: true,
    plan,
    plan_sha256: planHash,
    family_count: 44,
    stream_count: 19,
    required_role_count: 301,
  };
}

export function isAdmittedP0SourceRolePlan(
  value: unknown,
): value is P0SourceRolePlan {
  return !!value && typeof value === "object" && planBrand.has(value);
}

export function serializeP0SourceRolePlan(plan: P0SourceRolePlan): string {
  if (!isAdmittedP0SourceRolePlan(plan))
    throw new TypeError("p0_plan_not_admitted");
  return canonicalize(plan);
}

export function hashP0SourceRolePlan(plan: P0SourceRolePlan): string {
  if (!isAdmittedP0SourceRolePlan(plan))
    throw new TypeError("p0_plan_not_admitted");
  return canonicalSha256(plan);
}

function parseRoleState(value: unknown): P0RoleOperationalState | null {
  if (!record(value)) return null;
  const issues: P0PlanIssue[] = [];
  if (!exactKeys(value, ROLE_STATE_KEYS, "", issues)) return null;
  if (
    typeof value.family_id !== "string" ||
    typeof value.source_role_id !== "string" ||
    typeof value.producer_status !== "string" ||
    !PRODUCERS.has(value.producer_status) ||
    typeof value.permission_status !== "string" ||
    !PERMISSIONS.has(value.permission_status) ||
    typeof value.technical_status !== "string" ||
    !TECHNICAL.has(value.technical_status) ||
    typeof value.liveness_status !== "string" ||
    !LIVENESS.has(value.liveness_status) ||
    typeof value.evidence_status !== "string" ||
    !EVIDENCE.has(value.evidence_status) ||
    typeof value.impact_status !== "string" ||
    !IMPACT.has(value.impact_status) ||
    typeof value.experimental_eligible !== "boolean"
  )
    return null;
  return value as unknown as P0RoleOperationalState;
}

function blockersFor(state: P0RoleOperationalState): P0ReadinessBlockerCode[] {
  const blockers: P0ReadinessBlockerCode[] = [];
  if (state.producer_status !== "authorized")
    blockers.push("producer_not_authorized");
  if (
    !new Set(["approved_manual", "approved_automated"]).has(
      state.permission_status,
    )
  )
    blockers.push("permission_not_approved");
  if (state.technical_status === "unknown")
    blockers.push("technical_path_unknown");
  if (
    state.technical_status === "unavailable" &&
    state.evidence_status !== "conservative_exclusion"
  )
    blockers.push("technical_path_unavailable");
  if (state.liveness_status !== "healthy")
    blockers.push("liveness_not_healthy");
  if (
    new Set(["absent", "lead_only", "discovery_only"]).has(
      state.evidence_status,
    )
  )
    blockers.push("canonical_evidence_missing");
  if (state.evidence_status === "canonical_stale")
    blockers.push("canonical_evidence_stale");
  if (state.impact_status !== "mapped") blockers.push("impact_not_mapped");
  return blockers;
}

export function evaluateP0Readiness(
  plan: P0SourceRolePlan,
  input: unknown,
): P0ReadinessReport {
  if (!isAdmittedP0SourceRolePlan(plan))
    throw new TypeError("p0_plan_not_admitted");
  const scan = scanPlainData(input);
  if (
    !scan.ok ||
    !record(scan.value) ||
    !exactKeys(scan.value, READINESS_KEYS, "", [])
  )
    throw new TypeError("p0_readiness_invalid");
  if (
    scan.value.version !== P0_SOURCE_READINESS_VERSION ||
    scan.value.plan_sha256 !== hashP0SourceRolePlan(plan) ||
    !Array.isArray(scan.value.roles)
  )
    throw new TypeError("p0_readiness_invalid");
  const required = new Set(
    plan.families.flatMap((family) =>
      family.required_source_roles.map(
        (role) => `${family.family_id}\u0000${role}`,
      ),
    ),
  );
  const states = new Map<string, P0RoleOperationalState>();
  for (const raw of scan.value.roles) {
    const state = parseRoleState(raw);
    if (!state) throw new TypeError("p0_readiness_invalid");
    const key = `${state.family_id}\u0000${state.source_role_id}`;
    if (!required.has(key) || states.has(key))
      throw new TypeError("p0_readiness_invalid");
    states.set(key, state);
  }
  const roles: P0RoleReadiness[] = [];
  for (const family of plan.families) {
    for (const sourceRoleId of family.required_source_roles) {
      const key = `${family.family_id}\u0000${sourceRoleId}`;
      const state =
        states.get(key) ??
        ({
          family_id: family.family_id,
          source_role_id: sourceRoleId,
          producer_status: "missing",
          permission_status: "not_reviewed",
          technical_status: "unknown",
          liveness_status: "unregistered",
          evidence_status: "absent",
          impact_status: "unmapped",
          experimental_eligible: false,
        } satisfies P0RoleOperationalState);
      const blockers = blockersFor(state);
      roles.push({
        family_id: family.family_id,
        source_role_id: sourceRoleId,
        ready: blockers.length === 0,
        experimental_eligible: state.experimental_eligible,
        blockers,
      });
    }
  }
  const families = plan.families.map((family): P0FamilyReadiness => {
    const familyRoles = roles.filter(
      (role) => role.family_id === family.family_id,
    );
    const readyRoleCount = familyRoles.filter((role) => role.ready).length;
    return {
      family_id: family.family_id,
      baseline_planning_status: family.baseline_planning_status,
      ready: readyRoleCount === family.required_source_roles.length,
      required_role_count: family.required_source_roles.length,
      ready_role_count: readyRoleCount,
      experimental_role_count: familyRoles.filter(
        (role) => role.experimental_eligible,
      ).length,
      blocker_count: familyRoles.reduce(
        (count, role) => count + role.blockers.length,
        0,
      ),
    };
  });
  return deepFreeze({
    plan_sha256: hashP0SourceRolePlan(plan),
    family_count: plan.families.length,
    stream_count: new Set(plan.families.map((family) => family.stream_id)).size,
    required_role_count: roles.length,
    ready_family_count: families.filter((family) => family.ready).length,
    ready_role_count: roles.filter((role) => role.ready).length,
    experimental_role_count: roles.filter((role) => role.experimental_eligible)
      .length,
    roles,
    families,
  });
}
