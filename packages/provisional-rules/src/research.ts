import { freezeP0CoverageIndex, hashCanonical } from "./canonical.js";
import { deepFreeze, scanPublicValue } from "./security.js";
import type { P0CoverageIndex, Sha256 } from "./types.js";

/** The checked-in Research-A implementation ledger format (compatibility). */
export const RESEARCH_IMPLEMENTATION_VERSION =
  "p0-point-rules-a.implementation.v0.1" as const;
export const RESEARCH_ARTIFACT_ID = "p0-point-rules-a.research.v0.1" as const;
export const RESEARCH_COVERAGE_VERSION = "p0-coverage-index.v0.3" as const;

/**
 * Descriptor for one P0 research family.  The research envelope is shared by
 * the point, wallet/card, and merchant/transit producers, while their
 * artifact/schema identities and coverage snapshots remain separate.
 */
export interface P0ResearchImplementationDescriptor {
  readonly research_artifact_id: string;
  readonly research_artifact_type: string;
  readonly research_schema_id: string;
  readonly implementation_version: string;
  readonly coverage_index_version: string;
  /** Descriptor-scoped optional keys permitted in the research schema. */
  readonly optional_schema_keys?: readonly string[];
  /** Descriptor-scoped optional keys permitted in bounded_run metadata. */
  readonly optional_bounded_run_keys?: readonly string[];
}

export const P0_RESEARCH_IMPLEMENTATION_DESCRIPTORS = Object.freeze([
  Object.freeze({
    research_artifact_id: "p0-point-rules-a.research.v0.1",
    research_artifact_type: "p0_point_rules_research",
    research_schema_id: "p0-point-rules-research-v0.1",
    implementation_version: "p0-point-rules-a.implementation.v0.1",
    coverage_index_version: "p0-coverage-index.v0.3",
  }),
  Object.freeze({
    research_artifact_id: "p0-point-rules-b.research.v0.1",
    research_artifact_type: "p0_point_rules_research",
    research_schema_id: "p0-point-rules-research-v0.1",
    implementation_version: "p0-point-rules-b.implementation.v0.4",
    coverage_index_version: "p0-coverage-index.v0.4",
  }),
  Object.freeze({
    research_artifact_id: "p0-wallet-card-rules.research.v0.1",
    research_artifact_type: "p0_wallet_card_rules_research",
    research_schema_id: "p0-wallet-card-rules-research-v0.1",
    implementation_version: "p0-wallet-card-rules.implementation.v0.5",
    coverage_index_version: "p0-coverage-index.v0.5",
  }),
  Object.freeze({
    research_artifact_id: "p0-merchant-transit-regulatory-rules.research.v0.1",
    research_artifact_type: "p0_point_rules_research",
    research_schema_id: "p0-point-rules-research-v0.1",
    implementation_version:
      "p0-merchant-transit-regulatory-rules.implementation.v0.6",
    coverage_index_version: "p0-coverage-index.v0.6",
  }),
  Object.freeze({
    research_artifact_id: "p0-complex-route-benchmark.research.v0.1",
    research_artifact_type: "p0_complex_route_benchmark_research",
    research_schema_id: "p0-complex-route-benchmark-research-v0.1",
    implementation_version: "p0-complex-route-benchmark.implementation.v0.7",
    coverage_index_version: "p0-coverage-index.v0.7",
    optional_schema_keys: ["structured_transfer_required_fields"],
    optional_bounded_run_keys: ["retrieval_cutoff"],
  }),
  Object.freeze({
    research_artifact_id: "p0-moppy-jal-standard.research.v0.1",
    research_artifact_type: "p0_complex_route_benchmark_research",
    research_schema_id: "p0-complex-route-benchmark-research-v0.1",
    implementation_version: "p0-moppy-jal-standard.implementation.v0.8",
    coverage_index_version: "p0-coverage-index.v0.8",
    optional_schema_keys: ["structured_transfer_required_fields"],
    optional_bounded_run_keys: ["retrieval_cutoff"],
  }),
  Object.freeze({
    research_artifact_id: "p0-exchange-route-completeness.research.v0.1",
    research_artifact_type: "p0_complex_route_benchmark_research",
    research_schema_id: "p0-complex-route-benchmark-research-v0.1",
    implementation_version:
      "p0-exchange-route-completeness.implementation.v0.9",
    coverage_index_version: "p0-coverage-index.v0.9",
    optional_schema_keys: ["structured_transfer_required_fields"],
    optional_bounded_run_keys: ["retrieval_cutoff"],
  }),
] as const);

export const RESEARCH_FACT_REASONS = Object.freeze([
  "non_calculable_fact",
  "insufficient_operation_mapping",
  "unsupported_calculation_model",
  "ended_or_future_inactive",
  "invalid_applicability_window",
  "explicit_no_rate",
] as const);

export type ResearchFactReason = (typeof RESEARCH_FACT_REASONS)[number];
export type ResearchImplementationDisposition =
  | "engine_rule"
  | "catalogue_fact";

export interface ResearchImplementationIssue {
  readonly code:
    | "input_invalid"
    | "research_shape_invalid"
    | "source_unresolved"
    | "role_unresolved"
    | "claim_unresolved"
    | "catalogue_fact";
  readonly path: string;
  readonly message: string;
  readonly claim_id?: string;
  readonly reason?: ResearchFactReason;
}

export interface ResearchSourceIdentity {
  readonly source_id: string;
  readonly family_id: string;
  readonly roles: readonly string[];
  readonly url: string;
  readonly publisher: string;
  readonly official_domain: string;
}

/** Reserved for the later incremental engine-rule mapping checkpoint. */
export interface ResearchDerivedRule {
  readonly derived_rule_id: string;
  readonly parent_claim_id: string;
  readonly candidate_id: string;
  readonly candidate_hash: Sha256;
  readonly definition_hash: Sha256;
  readonly status: "active_experimental";
  readonly rule: Record<string, unknown>;
  readonly candidate: Record<string, unknown>;
  readonly observation: Record<string, unknown>;
  readonly claim_projection: Record<string, unknown>;
}

export interface ResearchImplementationEntry {
  readonly parent_claim_id: string;
  readonly family_id: string;
  readonly source_role_id: string;
  readonly source_ids: readonly string[];
  readonly source_identity: readonly ResearchSourceIdentity[];
  readonly claim_type: string;
  readonly subject: string;
  readonly predicate: string;
  readonly value: unknown;
  readonly applicability: Record<string, unknown>;
  readonly exclusions: readonly string[];
  readonly evidence_locator: string;
  readonly short_paraphrase: string;
  readonly disposition: ResearchImplementationDisposition;
  readonly derived_rule_ids: readonly string[];
  readonly reason?: ResearchFactReason;
  readonly reason_detail?: string;
}

export interface ResearchImplementationArtifact {
  readonly version: string;
  readonly artifact_type: "p0_point_rules_implementation";
  readonly research_artifact_id: string;
  readonly research_artifact_hash: Sha256;
  readonly coverage_index_version: string;
  readonly as_of: string;
  readonly parent_claim_count: number;
  readonly derived_rule_count: number;
  readonly entries: readonly ResearchImplementationEntry[];
  readonly derived_rules: readonly ResearchDerivedRule[];
  readonly issues: readonly ResearchImplementationIssue[];
  readonly implementation_hash: Sha256;
}

export interface ResearchImplementationResult {
  readonly ok: boolean;
  readonly artifact: ResearchImplementationArtifact | null;
  readonly coverage: P0CoverageIndex | null;
  readonly entries: readonly ResearchImplementationEntry[];
  readonly derived_rules: readonly ResearchDerivedRule[];
  readonly issues: readonly ResearchImplementationIssue[];
}

export interface ResearchImplementationOptions {
  /** A host-owned frozen index may replace the artifact-local index. */
  readonly coverage_index?: unknown;
  /** Explicit descriptor for an artifact not in the built-in P0 catalogue. */
  readonly descriptor?: P0ResearchImplementationDescriptor;
}

type UnknownRecord = Record<string, unknown>;

const METADATA_ROLE_KEYS = Object.freeze([
  "declared_roles",
  "wallet_roles",
  "card_roles",
  "merchant_roles",
  "emoney_transit_roles",
  "regulatory_roles",
] as const);

const OPTIONAL_SCHEMA_KEYS = new Set(["structured_transfer_required_fields"]);
const OPTIONAL_BOUNDED_RUN_KEYS = new Set(["retrieval_cutoff"]);

function descriptorForArtifact(
  artifactId: string,
  requested?: P0ResearchImplementationDescriptor,
): P0ResearchImplementationDescriptor {
  if (requested) return requested;
  const known = P0_RESEARCH_IMPLEMENTATION_DESCRIPTORS.find(
    (descriptor) => descriptor.research_artifact_id === artifactId,
  );
  if (known) return known;

  // A host can ingest a new descriptor-shaped P0 envelope before this
  // package ships a named convenience constant.  Keep that fallback bounded
  // to the checked-in artifact identity grammar; callers can supply explicit
  // versions when they need a durable DB seed identity.
  const match =
    /^(p0-[a-z0-9][a-z0-9._-]{0,95})\.research\.(v[0-9]+(?:\.[0-9]+)*)$/u.exec(
      artifactId,
    );
  if (!match)
    return {
      research_artifact_id: artifactId,
      research_artifact_type: "p0_point_rules_research",
      research_schema_id: "p0-point-rules-research-v0.1",
      implementation_version: "",
      coverage_index_version: "",
    };
  return {
    research_artifact_id: artifactId,
    research_artifact_type: "p0_point_rules_research",
    research_schema_id: "p0-point-rules-research-v0.1",
    implementation_version: `${match[1]}.implementation.${match[2]}`,
    coverage_index_version: RESEARCH_COVERAGE_VERSION,
  };
}

function descriptorValid(
  descriptor: P0ResearchImplementationDescriptor,
): boolean {
  return (
    typeof descriptor.research_artifact_id === "string" &&
    /^p0-[a-z0-9][a-z0-9._-]{0,95}\.research\.v[0-9]+(?:\.[0-9]+)*$/u.test(
      descriptor.research_artifact_id,
    ) &&
    typeof descriptor.research_artifact_type === "string" &&
    descriptor.research_artifact_type.length > 0 &&
    typeof descriptor.research_schema_id === "string" &&
    descriptor.research_schema_id.length > 0 &&
    typeof descriptor.implementation_version === "string" &&
    /^p0-[a-z0-9][a-z0-9._-]{0,95}\.implementation\.v[0-9]+(?:\.[0-9]+)*$/u.test(
      descriptor.implementation_version,
    ) &&
    typeof descriptor.coverage_index_version === "string" &&
    /^p0-coverage-index\.v[0-9]+(?:\.[0-9]+)*$/u.test(
      descriptor.coverage_index_version,
    ) &&
    descriptorKeyListValid(
      descriptor.optional_schema_keys,
      OPTIONAL_SCHEMA_KEYS,
    ) &&
    descriptorKeyListValid(
      descriptor.optional_bounded_run_keys,
      OPTIONAL_BOUNDED_RUN_KEYS,
    )
  );
}

function descriptorKeyListValid(
  value: readonly string[] | undefined,
  allowed: ReadonlySet<string>,
): boolean {
  return (
    value === undefined ||
    (Array.isArray(value) &&
      value.length > 0 &&
      new Set(value).size === value.length &&
      value.every((item) => typeof item === "string" && allowed.has(item)))
  );
}

const ROOT_KEYS = new Set([
  "artifact_type",
  "schema_version",
  "schema",
  "metadata",
  "sources",
  "role_results",
  "claims",
  "summary",
]);
const SCHEMA_KEYS = new Set([
  "id",
  "required_root_keys",
  "source_required_fields",
  "claim_required_fields",
  "role_result_outcomes",
  "sort_order",
  "source_policy",
  "quote_policy",
]);
const METADATA_KEYS = new Set([
  "artifact_id",
  "protocol_version",
  "task_id",
  "producer",
  "families",
  "declared_roles",
  "wallet_roles",
  "card_roles",
  "merchant_roles",
  "emoney_transit_roles",
  "regulatory_roles",
  "excluded_precovered_rows",
  "bounded_run",
  "publisher_policy",
  "fetch_policy",
  "pii_or_secret_check",
]);
const BOUNDED_RUN_KEYS = new Set([
  "started_at",
  "ended_at",
  "timezone",
  "scope",
  "truncation",
  "fetch_policy",
]);
const SOURCE_KEYS = new Set([
  "source_id",
  "family_id",
  "roles",
  "url",
  "title",
  "publisher",
  "official_domain",
  "retrieval",
  "notes",
]);
const RETRIEVAL_KEYS = new Set([
  "status",
  "accessed_at",
  "http_status",
  "content_type",
  "failure_reason",
]);
const ROLE_KEYS = new Set([
  "family_id",
  "source_role_id",
  "outcome",
  "source_ids",
  "claim_ids",
  "checked_at",
  "notes",
]);
const CLAIM_KEYS = new Set([
  "claim_id",
  "family_id",
  "source_role_id",
  "source_ids",
  "claim_type",
  "subject",
  "predicate",
  "value",
  "applicability",
  "exclusions",
  "evidence_locator",
  "short_paraphrase",
]);
const APPLICABILITY_KEYS = new Set([
  "scope",
  "status",
  "as_of",
  "effective_from",
  "effective_to",
  "count_period",
  "end_date_known",
  "date_precision",
  "start_date_precision",
  "dates_not_stated",
  "period_dates_not_rendered",
  "timezone",
]);
const SUMMARY_KEYS = new Set([
  "claim_count",
  "source_count",
  "role_result_count",
  "claim_count_by_family",
  "claim_count_by_role",
  "claim_count_by_type",
  "role_outcome_count",
  "failures",
  "validation_intent",
]);
const FAILURE_KEYS = new Set([
  "family_id",
  "source_role_id",
  "source_id",
  "url",
  "status",
  "http_status",
  "reason",
  "affected_roles",
]);
const ROLE_OUTCOMES = new Set([
  "claims_found",
  "no_economic_claim_found",
  "partially_checked",
  "fetch_failed",
]);
const SAFE_RESEARCH_METADATA_SECRET_PATH = "/metadata/pii_or_secret_check";

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function issue(
  code: ResearchImplementationIssue["code"],
  path: string,
  message: string,
  claim_id?: string,
  reason?: ResearchFactReason,
): ResearchImplementationIssue {
  return Object.freeze({
    code,
    path,
    message,
    ...(claim_id === undefined ? {} : { claim_id }),
    ...(reason === undefined ? {} : { reason }),
  });
}

function sortedIssues(
  issues: readonly ResearchImplementationIssue[],
): readonly ResearchImplementationIssue[] {
  return Object.freeze(
    [...issues].sort(
      (left, right) =>
        (left.claim_id ?? "").localeCompare(right.claim_id ?? "") ||
        left.path.localeCompare(right.path) ||
        left.code.localeCompare(right.code),
    ),
  );
}

function exactKeys(
  value: UnknownRecord,
  expected: ReadonlySet<string>,
  path: string,
  issues: ResearchImplementationIssue[],
  optional: ReadonlySet<string> = new Set(),
): void {
  const allowed =
    optional.size === 0 ? expected : new Set([...expected, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key))
      issues.push(
        issue("research_shape_invalid", `${path}/${key}`, "unknown field"),
      );
  }
}

function strings(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === "string") &&
    new Set(value).size === value.length
  );
}

function nonEmptyStrings(value: unknown): value is readonly string[] {
  return (
    strings(value) && value.length > 0 && value.every((item) => item.length > 0)
  );
}

function isCanonicalDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value))
    return false;
  const [yearText, monthText, dayText] = value.split("-");
  if (!yearText || !monthText || !dayText) return false;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function acceptedClaimValue(value: unknown): boolean {
  return (
    value !== null &&
    value !== undefined &&
    (typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      Array.isArray(value) ||
      isRecord(value))
  );
}

function sourceAdvertisesRole(
  source: UnknownRecord,
  sourceRoleId: unknown,
): boolean {
  return (
    typeof sourceRoleId === "string" &&
    Array.isArray(source.roles) &&
    source.roles.includes(sourceRoleId)
  );
}

function addShapeIssue(
  issues: ResearchImplementationIssue[],
  path: string,
  message: string,
): void {
  issues.push(issue("research_shape_invalid", path, message));
}

function pointer(path: string, key: string | number): string {
  return `${path}/${String(key).replaceAll("~", "~0").replaceAll("/", "~1")}`;
}

function safeResearchSecretPath(value: unknown, path: string): boolean {
  if (path === SAFE_RESEARCH_METADATA_SECRET_PATH) return true;
  const match = /^\/claims\/(\d+)\/value\/credential$/u.exec(path);
  if (!match || !isRecord(value)) return false;
  const rootDescriptor = Object.getOwnPropertyDescriptor(value, "claims");
  if (!rootDescriptor || !("value" in rootDescriptor)) return false;
  const claims = rootDescriptor.value;
  if (!Array.isArray(claims)) return false;
  const claimDescriptor = Object.getOwnPropertyDescriptor(
    claims,
    String(Number(match[1])),
  );
  if (!claimDescriptor || !("value" in claimDescriptor)) return false;
  const claim = claimDescriptor.value;
  return (
    isRecord(claim) &&
    Object.getOwnPropertyDescriptor(claim, "claim_id")?.value ===
      "claim.point.nanaco.transfer.auth.003" &&
    (() => {
      const valueDescriptor = Object.getOwnPropertyDescriptor(claim, "value");
      if (!valueDescriptor || !("value" in valueDescriptor)) return false;
      const claimValue = valueDescriptor.value;
      return (
        isRecord(claimValue) &&
        Object.getOwnPropertyDescriptor(claimValue, "credential")?.value ===
          "two-factor-authentication phone number"
      );
    })()
  );
}

/**
 * Research-A contains two contextual words that the generic security scanner
 * intentionally treats as secret-bearing keys.  They are accepted only at
 * their exact canonical paths after the scanner has rejected every other
 * hostile representation.
 */
function scanResearchArtifact(
  value: unknown,
): ReturnType<typeof scanPublicValue> {
  const first = scanPublicValue(value);
  if (first.valid) return first;
  if (
    first.issues.some(
      (item) =>
        item.code !== "secret_bearing_value" ||
        !safeResearchSecretPath(value, item.path),
    )
  )
    return first;

  const rename = (current: unknown, path: string): unknown => {
    if (Array.isArray(current))
      return current.map((item, index) => rename(item, pointer(path, index)));
    if (!isRecord(current)) return current;
    const output: UnknownRecord = {};
    for (const key of Object.keys(current)) {
      const childPath = pointer(path, key);
      const safeKey = safeResearchSecretPath(value, childPath)
        ? "__research_context_a"
        : key;
      output[safeKey] = rename(current[key], childPath);
    }
    return output;
  };
  const renamed = scanPublicValue(rename(value, ""));
  if (!renamed.valid) return renamed;
  const restore = (current: unknown, path = ""): unknown => {
    if (Array.isArray(current))
      return current.map((item, index) => restore(item, pointer(path, index)));
    if (!isRecord(current)) return current;
    const output: UnknownRecord = {};
    for (const [key, child] of Object.entries(current)) {
      const childPath = pointer(path, key);
      const restoredKey =
        childPath === "/metadata/__research_context_a"
          ? "pii_or_secret_check"
          : /^\/claims\/\d+\/value\/__research_context_a$/u.test(childPath)
            ? "credential"
            : key;
      output[restoredKey] = restore(child, childPath);
    }
    return output;
  };
  return { valid: true, value: restore(renamed.value), issues: [] };
}

function validateArtifact(
  value: unknown,
  requestedDescriptor?: P0ResearchImplementationDescriptor,
): {
  readonly normalized: UnknownRecord | null;
  readonly issues: readonly ResearchImplementationIssue[];
  readonly descriptor: P0ResearchImplementationDescriptor | null;
} {
  const scanned = scanResearchArtifact(value);
  if (!scanned.valid)
    return {
      normalized: null,
      descriptor: null,
      issues: sortedIssues(
        scanned.issues.map((item) =>
          issue("input_invalid", item.path, item.message),
        ),
      ),
    };
  if (!isRecord(scanned.value))
    return {
      normalized: null,
      descriptor: null,
      issues: Object.freeze([
        issue(
          "research_shape_invalid",
          "",
          "research artifact must be an object",
        ),
      ]),
    };

  const root = scanned.value;
  const issues: ResearchImplementationIssue[] = [];
  exactKeys(root, ROOT_KEYS, "", issues);
  const artifactId =
    isRecord(root.metadata) && typeof root.metadata.artifact_id === "string"
      ? root.metadata.artifact_id
      : "";
  const descriptor = descriptorForArtifact(artifactId, requestedDescriptor);
  if (!descriptorValid(descriptor))
    addShapeIssue(
      issues,
      "/descriptor",
      "research implementation descriptor is invalid",
    );
  if (root.artifact_type !== descriptor.research_artifact_type)
    addShapeIssue(
      issues,
      "/artifact_type",
      "unsupported P0 research artifact type",
    );
  if (root.schema_version !== "0.1")
    addShapeIssue(
      issues,
      "/schema_version",
      "unsupported Research-A schema version",
    );
  if (!isRecord(root.schema))
    addShapeIssue(issues, "/schema", "schema must be an object");
  if (!isRecord(root.metadata))
    addShapeIssue(issues, "/metadata", "metadata must be an object");
  if (!Array.isArray(root.sources))
    addShapeIssue(issues, "/sources", "sources must be an array");
  if (!Array.isArray(root.role_results))
    addShapeIssue(issues, "/role_results", "role_results must be an array");
  if (!Array.isArray(root.claims))
    addShapeIssue(issues, "/claims", "claims must be an array");
  if (!isRecord(root.summary))
    addShapeIssue(issues, "/summary", "summary must be an object");
  if (issues.length > 0)
    return { normalized: null, descriptor, issues: sortedIssues(issues) };

  const schema = root.schema as UnknownRecord;
  exactKeys(
    schema,
    SCHEMA_KEYS,
    "/schema",
    issues,
    new Set(descriptor.optional_schema_keys ?? []),
  );
  if (
    descriptor.optional_schema_keys?.includes(
      "structured_transfer_required_fields",
    ) &&
    Object.hasOwn(schema, "structured_transfer_required_fields") &&
    !nonEmptyStrings(schema.structured_transfer_required_fields)
  )
    addShapeIssue(
      issues,
      "/schema/structured_transfer_required_fields",
      "structured_transfer_required_fields must be a unique non-empty string array",
    );
  if (schema.id !== descriptor.research_schema_id)
    addShapeIssue(issues, "/schema/id", "unsupported P0 research schema id");
  const metadata = root.metadata as UnknownRecord;
  exactKeys(metadata, METADATA_KEYS, "/metadata", issues);
  if (metadata.artifact_id !== descriptor.research_artifact_id)
    addShapeIssue(
      issues,
      "/metadata/artifact_id",
      "unexpected P0 research artifact id",
    );
  if (metadata.protocol_version !== "0.1")
    addShapeIssue(
      issues,
      "/metadata/protocol_version",
      "unsupported protocol version",
    );
  if (!nonEmptyStrings(metadata.families))
    addShapeIssue(
      issues,
      "/metadata/families",
      "families must be a non-empty unique string array",
    );
  const declaredRoleKeys = METADATA_ROLE_KEYS.filter((key) =>
    Object.hasOwn(metadata, key),
  );
  if (declaredRoleKeys.length === 0)
    addShapeIssue(
      issues,
      "/metadata",
      "at least one metadata role declaration is required",
    );
  for (const key of declaredRoleKeys)
    if (!nonEmptyStrings(metadata[key]))
      addShapeIssue(
        issues,
        `/metadata/${key}`,
        `${key} must be a non-empty unique string array`,
      );
  if (
    Object.hasOwn(metadata, "excluded_precovered_rows") &&
    !strings(metadata.excluded_precovered_rows)
  )
    addShapeIssue(
      issues,
      "/metadata/excluded_precovered_rows",
      "excluded_precovered_rows must be a unique string array",
    );
  if (!isRecord(metadata.bounded_run))
    addShapeIssue(
      issues,
      "/metadata/bounded_run",
      "bounded_run must be an object",
    );
  else {
    exactKeys(
      metadata.bounded_run,
      BOUNDED_RUN_KEYS,
      "/metadata/bounded_run",
      issues,
      new Set(descriptor.optional_bounded_run_keys ?? []),
    );
    if (
      descriptor.optional_bounded_run_keys?.includes("retrieval_cutoff") &&
      Object.hasOwn(metadata.bounded_run, "retrieval_cutoff") &&
      !isCanonicalDate(metadata.bounded_run.retrieval_cutoff)
    )
      addShapeIssue(
        issues,
        "/metadata/bounded_run/retrieval_cutoff",
        "retrieval_cutoff must be a canonical YYYY-MM-DD date",
      );
  }
  if (isRecord(metadata.bounded_run)) {
    for (const key of [
      "started_at",
      "ended_at",
      "timezone",
      "scope",
      "truncation",
    ])
      if (
        typeof metadata.bounded_run[key] !== "string" ||
        metadata.bounded_run[key].length === 0
      )
        addShapeIssue(
          issues,
          `/metadata/bounded_run/${key}`,
          `${key} is required for a bounded research run`,
        );
    const started = Date.parse(String(metadata.bounded_run.started_at));
    const ended = Date.parse(String(metadata.bounded_run.ended_at));
    if (!Number.isFinite(started) || !Number.isFinite(ended))
      addShapeIssue(
        issues,
        "/metadata/bounded_run/ended_at",
        "bounded run timestamps must be valid dates",
      );
    else if (ended < started)
      addShapeIssue(
        issues,
        "/metadata/bounded_run/ended_at",
        "bounded run ended_at must not precede started_at",
      );
  }

  const sources = root.sources as readonly unknown[];
  const sourceMap = new Map<string, UnknownRecord>();
  for (const [index, raw] of sources.entries()) {
    const path = `/sources/${index}`;
    if (!isRecord(raw)) {
      addShapeIssue(issues, path, "source must be an object");
      continue;
    }
    exactKeys(raw, SOURCE_KEYS, path, issues);
    if (typeof raw.source_id !== "string" || raw.source_id.length === 0)
      addShapeIssue(issues, `${path}/source_id`, "source_id is required");
    else if (sourceMap.has(raw.source_id))
      addShapeIssue(issues, `${path}/source_id`, "source_id must be unique");
    else sourceMap.set(raw.source_id, raw);
    for (const key of [
      "family_id",
      "url",
      "title",
      "publisher",
      "official_domain",
    ])
      if (typeof raw[key] !== "string" || String(raw[key]).length === 0)
        addShapeIssue(issues, `${path}/${key}`, `${key} is required`);
    if (!nonEmptyStrings(raw.roles))
      addShapeIssue(
        issues,
        `${path}/roles`,
        "roles must be a non-empty unique string array",
      );
    if (!isRecord(raw.retrieval))
      addShapeIssue(issues, `${path}/retrieval`, "retrieval must be an object");
    else exactKeys(raw.retrieval, RETRIEVAL_KEYS, `${path}/retrieval`, issues);
  }

  const roleResults = root.role_results as readonly unknown[];
  const roleMap = new Map<string, UnknownRecord>();
  for (const [index, raw] of roleResults.entries()) {
    const path = `/role_results/${index}`;
    if (!isRecord(raw)) {
      addShapeIssue(issues, path, "role result must be an object");
      continue;
    }
    exactKeys(raw, ROLE_KEYS, path, issues);
    if (
      typeof raw.family_id !== "string" ||
      typeof raw.source_role_id !== "string"
    ) {
      addShapeIssue(issues, path, "family_id and source_role_id are required");
      continue;
    }
    const tuple = `${raw.family_id}\u0000${raw.source_role_id}`;
    if (roleMap.has(tuple))
      addShapeIssue(issues, path, "family/source-role tuple must be unique");
    else roleMap.set(tuple, raw);
    if (!ROLE_OUTCOMES.has(String(raw.outcome)))
      addShapeIssue(
        issues,
        `${path}/outcome`,
        "unsupported role result outcome",
      );
    if (!nonEmptyStrings(raw.source_ids))
      addShapeIssue(
        issues,
        `${path}/source_ids`,
        "role source_ids must be non-empty and unique",
      );
    if (!strings(raw.claim_ids))
      addShapeIssue(
        issues,
        `${path}/claim_ids`,
        "role claim_ids must be a unique string array",
      );
    if (typeof raw.checked_at !== "string")
      addShapeIssue(issues, `${path}/checked_at`, "checked_at is required");
  }

  const claims = root.claims as readonly unknown[];
  const claimMap = new Map<string, UnknownRecord>();
  for (const [index, raw] of claims.entries()) {
    const path = `/claims/${index}`;
    if (!isRecord(raw)) {
      addShapeIssue(issues, path, "claim must be an object");
      continue;
    }
    exactKeys(raw, CLAIM_KEYS, path, issues);
    if (
      typeof raw.claim_id !== "string" ||
      !/^[a-z0-9][a-z0-9_.:-]{2,127}$/u.test(raw.claim_id)
    )
      addShapeIssue(
        issues,
        `${path}/claim_id`,
        "claim_id must be lowercase and 3-128 characters",
      );
    else if (claimMap.has(raw.claim_id))
      addShapeIssue(issues, `${path}/claim_id`, "claim_id must be unique");
    else claimMap.set(raw.claim_id, raw);
    for (const key of [
      "family_id",
      "source_role_id",
      "claim_type",
      "subject",
      "predicate",
      "evidence_locator",
      "short_paraphrase",
    ])
      if (typeof raw[key] !== "string" || String(raw[key]).length === 0)
        addShapeIssue(issues, `${path}/${key}`, `${key} is required`);
    if (!nonEmptyStrings(raw.source_ids))
      addShapeIssue(
        issues,
        `${path}/source_ids`,
        "claim source_ids must be non-empty and unique",
      );
    if (!Object.hasOwn(raw, "value") || !acceptedClaimValue(raw.value))
      addShapeIssue(
        issues,
        `${path}/value`,
        "claim value must be a non-null plain-data scalar, array, or object",
      );
    if (!isRecord(raw.applicability))
      addShapeIssue(
        issues,
        `${path}/applicability`,
        "applicability must be an object",
      );
    else {
      exactKeys(
        raw.applicability,
        APPLICABILITY_KEYS,
        `${path}/applicability`,
        issues,
      );
      for (const key of [
        "scope",
        "status",
        "as_of",
        "count_period",
        "date_precision",
        "start_date_precision",
        "timezone",
      ])
        if (
          Object.hasOwn(raw.applicability, key) &&
          typeof raw.applicability[key] !== "string"
        )
          addShapeIssue(
            issues,
            `${path}/applicability/${key}`,
            `${key} must be a string when present`,
          );
      for (const key of ["effective_from", "effective_to"])
        if (
          Object.hasOwn(raw.applicability, key) &&
          raw.applicability[key] !== null &&
          typeof raw.applicability[key] !== "string"
        )
          addShapeIssue(
            issues,
            `${path}/applicability/${key}`,
            `${key} must be string or null`,
          );
      for (const key of [
        "end_date_known",
        "dates_not_stated",
        "period_dates_not_rendered",
      ])
        if (
          Object.hasOwn(raw.applicability, key) &&
          typeof raw.applicability[key] !== "boolean"
        )
          addShapeIssue(
            issues,
            `${path}/applicability/${key}`,
            `${key} must be boolean when present`,
          );
    }
    if (
      !Array.isArray(raw.exclusions) ||
      !raw.exclusions.every((item) => typeof item === "string")
    )
      addShapeIssue(
        issues,
        `${path}/exclusions`,
        "exclusions must be a string array",
      );
  }

  const summary = root.summary as UnknownRecord;
  exactKeys(summary, SUMMARY_KEYS, "/summary", issues);
  if (summary.claim_count !== claims.length)
    addShapeIssue(
      issues,
      "/summary/claim_count",
      "summary claim count does not match claims",
    );
  if (summary.source_count !== sources.length)
    addShapeIssue(
      issues,
      "/summary/source_count",
      "summary source count does not match sources",
    );
  if (summary.role_result_count !== roleResults.length)
    addShapeIssue(
      issues,
      "/summary/role_result_count",
      "summary role result count does not match role_results",
    );
  if (!Array.isArray(summary.failures))
    addShapeIssue(
      issues,
      "/summary/failures",
      "summary failures must be an array",
    );
  else
    for (const [index, failure] of summary.failures.entries()) {
      if (!isRecord(failure))
        addShapeIssue(
          issues,
          `/summary/failures/${index}`,
          "failure must be an object",
        );
      else
        exactKeys(failure, FAILURE_KEYS, `/summary/failures/${index}`, issues);
    }

  for (const [index, raw] of claims.entries()) {
    if (!isRecord(raw)) continue;
    const claimId = typeof raw.claim_id === "string" ? raw.claim_id : undefined;
    const tuple = `${String(raw.family_id)}\u0000${String(raw.source_role_id)}`;
    const roleResult = roleMap.get(tuple);
    if (!roleResult)
      issues.push(
        issue(
          "role_unresolved",
          `/claims/${index}/source_role_id`,
          "claim role is absent from role_results",
          claimId,
        ),
      );
    for (const sourceId of nonEmptyStrings(raw.source_ids)
      ? raw.source_ids
      : []) {
      const source = sourceMap.get(sourceId);
      if (!source)
        issues.push(
          issue(
            "source_unresolved",
            `/claims/${index}/source_ids`,
            `source ${sourceId} is absent from sources`,
            claimId,
          ),
        );
      else if (source.family_id !== raw.family_id)
        issues.push(
          issue(
            "source_unresolved",
            `/claims/${index}/source_ids`,
            `source ${sourceId} does not bind to the claim family`,
            claimId,
          ),
        );
      else if (!sourceAdvertisesRole(source, raw.source_role_id))
        issues.push(
          issue(
            "source_unresolved",
            `/claims/${index}/source_ids`,
            `source ${sourceId} does not advertise claim role ${String(raw.source_role_id)}`,
            claimId,
          ),
        );
    }
  }
  const listedClaimTuples = new Map<string, string>();
  for (const [tuple, roleResult] of roleMap) {
    const claimIds = strings(roleResult.claim_ids) ? roleResult.claim_ids : [];
    const path = `/role_results/${roleResult.family_id}/${roleResult.source_role_id}/claim_ids`;
    for (const claimId of claimIds) {
      const previousTuple = listedClaimTuples.get(claimId);
      if (previousTuple !== undefined)
        issues.push(
          issue(
            "claim_unresolved",
            path,
            `claim ${claimId} is listed more than once`,
            claimId,
          ),
        );
      else listedClaimTuples.set(claimId, tuple);

      const claim = claimMap.get(claimId);
      if (!claim) {
        issues.push(
          issue(
            "claim_unresolved",
            path,
            `role result lists unknown claim ${claimId}`,
            claimId,
          ),
        );
        continue;
      }
      const claimTuple = `${String(claim.family_id)}\u0000${String(claim.source_role_id)}`;
      if (claimTuple !== tuple)
        issues.push(
          issue(
            "claim_unresolved",
            path,
            `claim ${claimId} is listed under the wrong family/source-role tuple`,
            claimId,
          ),
        );
    }
  }
  for (const [claimId, claim] of claimMap) {
    const claimTuple = `${String(claim.family_id)}\u0000${String(claim.source_role_id)}`;
    if (listedClaimTuples.get(claimId) !== claimTuple)
      issues.push(
        issue(
          "claim_unresolved",
          `/claims/${claimId}`,
          `claim ${claimId} is not listed exactly once in its family/source-role tuple`,
          claimId,
        ),
      );
  }
  for (const [tuple, roleResult] of roleMap) {
    for (const sourceId of nonEmptyStrings(roleResult.source_ids)
      ? roleResult.source_ids
      : []) {
      const source = sourceMap.get(sourceId);
      if (!source)
        issues.push(
          issue(
            "source_unresolved",
            `/role_results/${roleResult.family_id}/${roleResult.source_role_id}/source_ids`,
            `role source ${sourceId} is absent from sources`,
          ),
        );
      else if (source.family_id !== roleResult.family_id)
        issues.push(
          issue(
            "source_unresolved",
            `/role_results/${roleResult.family_id}/${roleResult.source_role_id}/source_ids`,
            `role source ${sourceId} does not bind to ${tuple}`,
          ),
        );
      else if (!sourceAdvertisesRole(source, roleResult.source_role_id))
        issues.push(
          issue(
            "source_unresolved",
            `/role_results/${roleResult.family_id}/${roleResult.source_role_id}/source_ids`,
            `role source ${sourceId} does not advertise role ${roleResult.source_role_id}`,
          ),
        );
    }
  }
  if (issues.length > 0)
    return { normalized: null, descriptor, issues: sortedIssues(issues) };

  const normalized: UnknownRecord = {
    ...root,
    metadata: Object.fromEntries(
      Object.entries(metadata).map(([key, value]) => [
        key,
        METADATA_ROLE_KEYS.includes(
          key as (typeof METADATA_ROLE_KEYS)[number],
        ) ||
        key === "families" ||
        key === "excluded_precovered_rows"
          ? [...(value as readonly string[])].sort((a, b) => a.localeCompare(b))
          : value,
      ]),
    ),
    sources: sources
      .map((source) => ({
        ...(source as UnknownRecord),
        roles: [...((source as UnknownRecord).roles as readonly string[])].sort(
          (a, b) => a.localeCompare(b),
        ),
      }))
      .sort((left, right) =>
        String((left as UnknownRecord).source_id).localeCompare(
          String((right as UnknownRecord).source_id),
        ),
      ),
    role_results: roleResults
      .map((role) => ({
        ...(role as UnknownRecord),
        source_ids: [
          ...((role as UnknownRecord).source_ids as readonly string[]),
        ].sort((a, b) => a.localeCompare(b)),
        claim_ids: [
          ...((role as UnknownRecord).claim_ids as readonly string[]),
        ].sort((a, b) => a.localeCompare(b)),
      }))
      .sort(
        (left, right) =>
          String((left as UnknownRecord).family_id).localeCompare(
            String((right as UnknownRecord).family_id),
          ) ||
          String((left as UnknownRecord).source_role_id).localeCompare(
            String((right as UnknownRecord).source_role_id),
          ),
      ),
    claims: claims
      .map((claim) => ({
        ...(claim as UnknownRecord),
        source_ids: [
          ...((claim as UnknownRecord).source_ids as readonly string[]),
        ].sort((a, b) => a.localeCompare(b)),
        exclusions: [
          ...((claim as UnknownRecord).exclusions as readonly string[]),
        ].sort((a, b) => a.localeCompare(b)),
      }))
      .sort((left, right) =>
        String((left as UnknownRecord).claim_id).localeCompare(
          String((right as UnknownRecord).claim_id),
        ),
      ),
  };
  return {
    normalized: deepFreeze(normalized),
    descriptor,
    issues: Object.freeze([]),
  };
}

function coverageForArtifact(
  artifact: UnknownRecord,
  version: string,
): P0CoverageIndex {
  const tuples = new Map<
    string,
    { family_id: string; source_role_id: string; source_ids: Set<string> }
  >();
  const add = (family: unknown, role: unknown, ids: unknown): void => {
    if (
      typeof family !== "string" ||
      typeof role !== "string" ||
      !Array.isArray(ids)
    )
      return;
    const tuple = `${family}\u0000${role}`;
    const entry = tuples.get(tuple) ?? {
      family_id: family,
      source_role_id: role,
      source_ids: new Set<string>(),
    };
    for (const id of ids) if (typeof id === "string") entry.source_ids.add(id);
    tuples.set(tuple, entry);
  };
  for (const role of artifact.role_results as readonly UnknownRecord[])
    add(role.family_id, role.source_role_id, role.source_ids);
  for (const claim of artifact.claims as readonly UnknownRecord[])
    add(claim.family_id, claim.source_role_id, claim.source_ids);
  return freezeP0CoverageIndex({
    version,
    entries: [...tuples.values()]
      .map((entry) => ({
        family_id: entry.family_id,
        source_role_id: entry.source_role_id,
        known_source_ids: [...entry.source_ids].sort((a, b) =>
          a.localeCompare(b),
        ),
      }))
      .sort(
        (left, right) =>
          left.family_id.localeCompare(right.family_id) ||
          left.source_role_id.localeCompare(right.source_role_id),
      ),
  });
}

function sourceIdentity(source: UnknownRecord): ResearchSourceIdentity {
  return {
    source_id: String(source.source_id),
    family_id: String(source.family_id),
    roles: [...(source.roles as readonly string[])].sort((a, b) =>
      a.localeCompare(b),
    ),
    url: String(source.url),
    publisher: String(source.publisher),
    official_domain: String(source.official_domain),
  };
}

function explicitNoRate(claim: UnknownRecord): boolean {
  const value = claim.value as UnknownRecord;
  return (
    (typeof value.rate === "string" &&
      /not stated|no rate/iu.test(value.rate)) ||
    (typeof value.points === "string" &&
      /rate varies|not stated/iu.test(value.points)) ||
    (typeof value.rate_status === "string" &&
      /not stated/iu.test(value.rate_status))
  );
}

type ParsedBoundaryDate = number | null | undefined;

/**
 * Parse the bounded-run date representation without turning malformed input
 * into an active fact. Date-only values intentionally retain Date.parse's
 * existing UTC-midnight semantics after strict calendar validation.
 */
function parseBoundaryDate(value: unknown): ParsedBoundaryDate {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.length === 0) return undefined;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]);
    const day = Number(dateOnly[3]);
    const timestamp = Date.UTC(year, month - 1, day);
    const parsed = new Date(timestamp);
    if (
      parsed.getUTCFullYear() !== year ||
      parsed.getUTCMonth() !== month - 1 ||
      parsed.getUTCDate() !== day
    )
      return undefined;
    return timestamp;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function hasInvalidApplicabilityWindow(
  claim: UnknownRecord,
  asOf: number,
): boolean {
  if (!Number.isFinite(asOf)) return true;
  const applicability = claim.applicability as UnknownRecord;
  const effectiveFrom = parseBoundaryDate(applicability.effective_from);
  const effectiveTo = parseBoundaryDate(applicability.effective_to);
  if (effectiveFrom === undefined || effectiveTo === undefined) return true;
  return (
    effectiveFrom !== null &&
    effectiveTo !== null &&
    effectiveFrom > effectiveTo
  );
}

function hasExplicitInactiveStatus(claim: UnknownRecord): boolean {
  const applicability = claim.applicability as UnknownRecord;
  const value = isRecord(claim.value) ? claim.value : null;
  const statuses = [applicability.status, value?.status];
  return statuses.some(
    (status) =>
      typeof status === "string" &&
      ["ended", "future", "inactive", "future at access date"].includes(
        status.trim().toLowerCase(),
      ),
  );
}

/**
 * These names are established whole-claim lifecycle fields in the Nanaco
 * Research-A envelope. Generic nested `end`/`end_date` fields are deliberately
 * ignored: a tier or sub-period ending must not retire its parent claim.
 */
const AUTHORITATIVE_NESTED_END_KEYS = new Set(["nanaco_end", "seven_mile_end"]);

function hasAuthoritativeWholeClaimEnd(value: unknown, asOf: number): boolean {
  if (!isRecord(value)) return false;
  for (const key of ["end_date", "end_datetime"]) {
    const child = value[key];
    if (typeof child !== "string" || !/^\d{4}-\d{2}-\d{2}/u.test(child))
      continue;
    const parsed = parseBoundaryDate(child);
    if (parsed !== undefined && parsed !== null && parsed < asOf) return true;
  }
  const visitNamedEnds = (current: unknown): boolean => {
    if (Array.isArray(current)) return current.some(visitNamedEnds);
    if (!isRecord(current)) return false;
    for (const [key, child] of Object.entries(current)) {
      if (
        AUTHORITATIVE_NESTED_END_KEYS.has(key) &&
        typeof child === "string" &&
        /^\d{4}-\d{2}-\d{2}/u.test(child)
      ) {
        const parsed = parseBoundaryDate(child);
        if (parsed !== undefined && parsed !== null && parsed < asOf)
          return true;
      }
      if (visitNamedEnds(child)) return true;
    }
    return false;
  };
  return visitNamedEnds(value);
}

function hasPastOrFutureBoundary(claim: UnknownRecord, asOf: number): boolean {
  const applicability = claim.applicability as UnknownRecord;
  const effectiveFrom = parseBoundaryDate(applicability.effective_from);
  const effectiveTo = parseBoundaryDate(applicability.effective_to);
  if (effectiveTo !== null && effectiveTo !== undefined && effectiveTo < asOf)
    return true;
  if (
    effectiveFrom !== null &&
    effectiveFrom !== undefined &&
    effectiveFrom > asOf
  )
    return true;
  if (hasExplicitInactiveStatus(claim)) return true;
  return hasAuthoritativeWholeClaimEnd(claim.value, asOf);
}

function hasEconomicShape(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasEconomicShape);
  if (!isRecord(value)) return false;
  if (
    [
      "points",
      "amount",
      "rate",
      "rate_percent",
      "from_points",
      "to_units",
      "charge_amount",
      "award_points",
      "tiers",
    ].some((key) => key in value)
  )
    return true;
  return Object.values(value).some(hasEconomicShape);
}

function factReason(claim: UnknownRecord, asOf: number): ResearchFactReason {
  if (hasInvalidApplicabilityWindow(claim, asOf))
    return "invalid_applicability_window";
  if (hasPastOrFutureBoundary(claim, asOf)) return "ended_or_future_inactive";
  if (explicitNoRate(claim)) return "explicit_no_rate";
  if (
    /discount|lottery|probability|maximum|example/iu.test(
      String(claim.predicate),
    )
  )
    return "unsupported_calculation_model";
  if (
    hasEconomicShape(claim.value) ||
    [
      "earn_rule",
      "campaign_rule",
      "transfer_rule",
      "redemption_value",
      "redemption_rule",
      "exclusion",
    ].includes(String(claim.claim_type))
  )
    return "insufficient_operation_mapping";
  return "non_calculable_fact";
}

function reasonDetail(reason: ResearchFactReason): string {
  switch (reason) {
    case "ended_or_future_inactive":
      return "The source states an ended or future-bounded applicability window.";
    case "invalid_applicability_window":
      return "Applicability contains an invalid or reversed date window; the fact is non-rankable.";
    case "explicit_no_rate":
      return "The source explicitly says that no numeric rate is stated.";
    case "unsupported_calculation_model":
      return "The claim describes a model not representable by the current calculation engine.";
    case "insufficient_operation_mapping":
      return "The claim has economic values but lacks explicit machine operation, asset, tax, or rounding fields.";
    default:
      return "The claim is a searchable fact rather than a calculation rule.";
  }
}

function entryFor(
  claim: UnknownRecord,
  sourceMap: ReadonlyMap<string, UnknownRecord>,
  reason: ResearchFactReason,
): ResearchImplementationEntry {
  const sourceIds = [...(claim.source_ids as readonly string[])].sort((a, b) =>
    a.localeCompare(b),
  );
  return Object.freeze({
    parent_claim_id: String(claim.claim_id),
    family_id: String(claim.family_id),
    source_role_id: String(claim.source_role_id),
    source_ids: Object.freeze(sourceIds),
    source_identity: Object.freeze(
      sourceIds
        .map((sourceId) =>
          sourceIdentity(sourceMap.get(sourceId) as UnknownRecord),
        )
        .sort((a, b) => a.source_id.localeCompare(b.source_id)),
    ),
    claim_type: String(claim.claim_type),
    subject: String(claim.subject),
    predicate: String(claim.predicate),
    value: structuredClone(claim.value),
    applicability: structuredClone(claim.applicability) as UnknownRecord,
    exclusions: Object.freeze([...(claim.exclusions as readonly string[])]),
    evidence_locator: String(claim.evidence_locator),
    short_paraphrase: String(claim.short_paraphrase),
    disposition: "catalogue_fact",
    derived_rule_ids: Object.freeze([]),
    reason,
    reason_detail: reasonDetail(reason),
  });
}

/**
 * Produce the structural Research-A implementation ledger.  This checkpoint
 * deliberately emits no engine rules: the canonical claims do not contain a
 * complete structured subject/scope/eligibility/calculation/output projection
 * without adding economics.  The ledger therefore keeps every claim active
 * for display/search with a deterministic machine reason.
 */
export function compileP0ResearchImplementation(
  value: unknown,
  options:
    | ResearchImplementationOptions
    | P0ResearchImplementationDescriptor = {},
): ResearchImplementationResult {
  const normalizedOptions: ResearchImplementationOptions =
    "research_artifact_id" in options ? { descriptor: options } : options;
  const parsed = validateArtifact(value, normalizedOptions.descriptor);
  if (!parsed.normalized)
    return Object.freeze({
      ok: false,
      artifact: null,
      coverage: null,
      entries: Object.freeze([]),
      derived_rules: Object.freeze([]),
      issues: parsed.issues,
    });
  const artifact = parsed.normalized;
  const descriptor = parsed.descriptor as P0ResearchImplementationDescriptor;
  let coverage: P0CoverageIndex | null;
  try {
    coverage =
      normalizedOptions.coverage_index === undefined
        ? coverageForArtifact(artifact, descriptor.coverage_index_version)
        : freezeP0CoverageIndex(normalizedOptions.coverage_index);
    if (coverage && coverage.version !== descriptor.coverage_index_version)
      coverage = null;
  } catch {
    coverage = null;
  }
  if (!coverage)
    return Object.freeze({
      ok: false,
      artifact: null,
      coverage: null,
      entries: Object.freeze([]),
      derived_rules: Object.freeze([]),
      issues: Object.freeze([
        issue(
          "research_shape_invalid",
          "/coverage_index",
          "host-owned coverage index is invalid",
        ),
      ] as const),
    });

  const coverageIssues: ResearchImplementationIssue[] = [];
  const coverageByTuple = new Map(
    coverage.entries.map((entry) => [
      `${entry.family_id}\u0000${entry.source_role_id}`,
      new Set(entry.known_source_ids),
    ]),
  );
  for (const claim of artifact.claims as readonly UnknownRecord[]) {
    const tuple = `${String(claim.family_id)}\u0000${String(claim.source_role_id)}`;
    const known = coverageByTuple.get(tuple);
    for (const sourceId of claim.source_ids as readonly string[])
      if (!known?.has(sourceId))
        coverageIssues.push(
          issue(
            "source_unresolved",
            `/coverage_index/${String(claim.family_id)}/${String(claim.source_role_id)}`,
            `coverage does not bind source ${sourceId}`,
            String(claim.claim_id),
          ),
        );
  }
  if (coverageIssues.length > 0)
    return Object.freeze({
      ok: false,
      artifact: null,
      coverage,
      entries: Object.freeze([]),
      derived_rules: Object.freeze([]),
      issues: sortedIssues(coverageIssues),
    });

  const sourceMap = new Map<string, UnknownRecord>(
    (artifact.sources as readonly UnknownRecord[]).map((source) => [
      String(source.source_id),
      source,
    ]),
  );
  const metadata = artifact.metadata as UnknownRecord;
  const boundedRun = metadata.bounded_run as UnknownRecord;
  const asOf = Date.parse(String(boundedRun.ended_at));
  const recordedAt = String(boundedRun.ended_at);
  const artifactHash = hashCanonical(artifact);
  const entries: ResearchImplementationEntry[] = [];
  const issues: ResearchImplementationIssue[] = [];
  for (const claim of artifact.claims as readonly UnknownRecord[]) {
    const reason = factReason(claim, asOf);
    entries.push(entryFor(claim, sourceMap, reason));
    issues.push(
      issue(
        "catalogue_fact",
        `/claims/${String(claim.claim_id)}`,
        reasonDetail(reason),
        String(claim.claim_id),
        reason,
      ),
    );
  }
  const sortedEntries = Object.freeze(
    [...entries].sort((left, right) =>
      left.parent_claim_id.localeCompare(right.parent_claim_id),
    ),
  );
  const orderedIssues = sortedIssues(issues);
  const body = {
    version: descriptor.implementation_version,
    artifact_type: "p0_point_rules_implementation" as const,
    research_artifact_id: descriptor.research_artifact_id,
    research_artifact_hash: artifactHash,
    coverage_index_version: descriptor.coverage_index_version,
    as_of: recordedAt,
    parent_claim_count: sortedEntries.length,
    derived_rule_count: 0,
    entries: sortedEntries,
    derived_rules: Object.freeze([]) as readonly ResearchDerivedRule[],
    issues: orderedIssues,
  };
  const implementationHash = hashCanonical(body);
  const snapshot = deepFreeze({
    ...body,
    implementation_hash: implementationHash,
  });
  return Object.freeze({
    ok: sortedEntries.length === (artifact.claims as readonly unknown[]).length,
    artifact: snapshot,
    coverage,
    entries: sortedEntries,
    derived_rules: body.derived_rules,
    issues: snapshot.issues,
  });
}

/** Research-A compatibility name retained for existing hosts and fixtures. */
export const compileResearchImplementation = compileP0ResearchImplementation;
export const adaptResearchArtifact = compileP0ResearchImplementation;
