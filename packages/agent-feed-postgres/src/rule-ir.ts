import { types as nodeTypes } from "node:util";
import type { Asset, RewardRule } from "@jro/contracts";
import {
  classifyProvisionalValidity,
  compileRuleIR,
  hashCandidate,
  hashDefinition,
  isCanonicalProvisionalDateTime,
  type PrincipalEdgeV1,
  type ProvisionalRuleCandidate,
  RULE_IR_VERSION,
  type RuleIRV1,
  type Sha256,
  scanPublicValue,
} from "@jro/provisional-rules";
import type { QueryTarget } from "./adapter.js";
import {
  MAX_P0_EXPERIMENTAL_CATALOGUE_ROWS,
  P0_EXPERIMENTAL_CATALOGUE_QUERY,
} from "./catalogue.js";

/**
 * The active candidate view is intentionally narrower than Rule IR.  It
 * carries a complete candidate/rule document, but not the host's canonical
 * asset definitions or principal graph.  A caller must therefore provide
 * those bindings separately; this module never infers them from asset refs.
 */
export const P0_RULE_IR_ROW_KEYS = Object.freeze([
  "admitted_at",
  "candidate_hash",
  "candidate_id",
  "candidate_payload",
  "definition_hash",
  "machine_checked_at",
  "observation_fingerprint",
  "p0_family_id",
  "source_authority_role",
  "source_ids",
  "source_observation_id",
  "source_observation_key",
  "source_role_id",
  "status",
] as const);

const REQUIRED_CANDIDATE_ROW_KEYS = Object.freeze([
  "admitted_at",
  "candidate_hash",
  "candidate_id",
  "candidate_payload",
  "definition_hash",
  "machine_checked_at",
  "observation_fingerprint",
  "p0_family_id",
  "source_authority_role",
  "source_ids",
  "source_observation_id",
  "source_observation_key",
  "source_role_id",
  "status",
] as const);

const CANDIDATE_KEYS = Object.freeze([
  "candidate_id",
  "extractor",
  "machine_check",
  "observation_fingerprint",
  "observation_id",
  "p0_family_id",
  "rule",
  "source_authority_role",
  "source_ids",
  "source_role_id",
  "version",
] as const);

const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{2,255}$/u;
const HASH = /^sha256:[0-9a-f]{64}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const SUPPORTED_OPERATION_TYPES = new Set([
  "merchant_purchase",
  "stored_value_top_up",
]);
const SUPPORTED_RULE_TYPES = new Set(["base_reward", "card_benefit"]);
const SUPPORTED_CALCULATION_MODELS = new Set(["points_per_unit"]);

export type P0RuleIRIssueCode =
  | "representation_invalid"
  | "shape_invalid"
  | "unsupported"
  | "incomplete"
  | "binding_mismatch"
  | "candidate_hash_mismatch"
  | "definition_hash_mismatch"
  | "evidence_mismatch"
  | "inactive"
  | "rule_ir_invalid"
  | "query_invalid"
  | "too_many_rows";

export interface P0RuleIRIssue {
  readonly code: P0RuleIRIssueCode;
  readonly path: string;
  readonly message: string;
  readonly candidate_id?: string;
}

export type P0RuleIRCompilationResult =
  | {
      readonly ok: true;
      readonly value: RuleIRV1;
      readonly issues: readonly [];
    }
  | {
      readonly ok: false;
      readonly value: null;
      readonly issues: readonly P0RuleIRIssue[];
    };

export type P0EconomicCandidateRowParseResult =
  | {
      readonly ok: true;
      readonly value: Readonly<Record<string, unknown>>;
      readonly issues: readonly [];
    }
  | {
      readonly ok: false;
      readonly value: null;
      readonly issues: readonly P0RuleIRIssue[];
    };

export interface P0TrustedRuleIRBindings {
  /** The claim identity is not present in the generic candidate view. */
  readonly claim_id: string;
  readonly evidence_ids: readonly string[];
  /** Host-owned, immutable definitions; never synthesized from Rule refs. */
  readonly assets: readonly Asset[];
  /** Host-owned graph edges; never synthesized from Rule eligibility. */
  readonly principal_edges: readonly PrincipalEdgeV1[];
}

export interface P0RuleIRLoadOptions {
  readonly rule_ids?: readonly string[];
  readonly effective_at?: string;
  readonly bindings?: Readonly<Record<string, P0TrustedRuleIRBindings>>;
}

export interface P0RuleIRLoadResult {
  readonly rule_irs: readonly RuleIRV1[];
  readonly issues: readonly P0RuleIRIssue[];
}

function issue(
  issues: P0RuleIRIssue[],
  code: P0RuleIRIssueCode,
  path: string,
  message: string,
  candidateId?: string,
): void {
  issues.push({
    code,
    path,
    message,
    ...(candidateId === undefined ? {} : { candidate_id: candidateId }),
  });
}

function sortedIssues(
  issues: readonly P0RuleIRIssue[],
): readonly P0RuleIRIssue[] {
  return Object.freeze(
    [...issues].sort(
      (left, right) =>
        (left.candidate_id ?? "").localeCompare(right.candidate_id ?? "") ||
        left.path.localeCompare(right.path) ||
        left.code.localeCompare(right.code) ||
        left.message.localeCompare(right.message),
    ),
  );
}

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

function stringArray(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === "string" && ID.test(item)) &&
    new Set(value).size === value.length
  );
}

function sameStringSet(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    [...left].sort().every((item, index) => item === [...right].sort()[index])
  );
}

function hash(value: unknown): value is Sha256 {
  return typeof value === "string" && HASH.test(value);
}

function candidateId(value: unknown): string | undefined {
  if (!record(value) || nodeTypes.isProxy(value)) return;
  const descriptor = Object.getOwnPropertyDescriptor(value, "candidate_id");
  return descriptor &&
    "value" in descriptor &&
    typeof descriptor.value === "string"
    ? descriptor.value
    : undefined;
}

function ruleId(value: unknown): string | undefined {
  if (!record(value) || nodeTypes.isProxy(value)) return;
  const payloadDescriptor = Object.getOwnPropertyDescriptor(
    value,
    "candidate_payload",
  );
  if (
    !payloadDescriptor ||
    !("value" in payloadDescriptor) ||
    !record(payloadDescriptor.value) ||
    nodeTypes.isProxy(payloadDescriptor.value)
  )
    return;
  const payload = payloadDescriptor.value;
  const ruleDescriptor = Object.getOwnPropertyDescriptor(payload, "rule");
  if (
    !ruleDescriptor ||
    !("value" in ruleDescriptor) ||
    !record(ruleDescriptor.value) ||
    nodeTypes.isProxy(ruleDescriptor.value)
  )
    return;
  const idDescriptor = Object.getOwnPropertyDescriptor(
    ruleDescriptor.value,
    "rule_id",
  );
  return idDescriptor &&
    "value" in idDescriptor &&
    typeof idDescriptor.value === "string"
    ? idDescriptor.value
    : undefined;
}

function rowCandidateId(value: Record<string, unknown>): string | undefined {
  return typeof value.candidate_id === "string"
    ? value.candidate_id
    : undefined;
}

function parseRow(value: unknown): {
  readonly row: Record<string, unknown> | null;
  readonly issues: readonly P0RuleIRIssue[];
} {
  const scanned = scanPublicValue(value);
  if (!scanned.valid)
    return {
      row: null,
      issues: sortedIssues(
        scanned.issues.map((item) => ({
          code: "representation_invalid" as const,
          path: item.path,
          message: item.message,
        })),
      ),
    };
  if (!record(scanned.value))
    return {
      row: null,
      issues: Object.freeze([
        {
          code: "shape_invalid",
          path: "",
          message: "candidate row must be a plain object",
        },
      ]),
    };
  const row = scanned.value;
  const unknown = Object.keys(row).filter(
    (key) =>
      !P0_RULE_IR_ROW_KEYS.includes(
        key as (typeof P0_RULE_IR_ROW_KEYS)[number],
      ),
  );
  const issues: P0RuleIRIssue[] = [];
  if (unknown.length > 0)
    issue(issues, "shape_invalid", "", "candidate row contains unknown fields");
  for (const key of REQUIRED_CANDIDATE_ROW_KEYS)
    if (!Object.hasOwn(row, key))
      issue(
        issues,
        "shape_invalid",
        `/${key}`,
        "candidate row field is required",
      );
  return { row, issues: sortedIssues(issues) };
}

/** Parse the exact current active-candidate projection without compiling it. */
export function parseP0EconomicCandidateRow(
  value: unknown,
): P0EconomicCandidateRowParseResult {
  const parsed = parseRow(value);
  if (!parsed.row || parsed.issues.length > 0)
    return { ok: false, value: null, issues: parsed.issues };
  return { ok: true, value: parsed.row, issues: [] };
}

/** Parse and compile one current active-candidate row without inventing IR data. */
export function compileP0EconomicCandidateRow(
  value: unknown,
  effectiveAt: string,
  bindings?: P0TrustedRuleIRBindings,
): P0RuleIRCompilationResult {
  const parsed = parseRow(value);
  if (!parsed.row) return { ok: false, value: null, issues: parsed.issues };
  const row = parsed.row;
  const candidateId = rowCandidateId(row);
  const issues = [...parsed.issues];
  if (!isCanonicalProvisionalDateTime(effectiveAt))
    issue(
      issues,
      "shape_invalid",
      "/effective_at",
      "effective_at is invalid",
      candidateId,
    );
  if (row.status !== "active_experimental")
    issue(
      issues,
      "inactive",
      "/status",
      "candidate is not active_experimental",
      candidateId,
    );
  if (typeof row.candidate_hash !== "string" || !hash(row.candidate_hash))
    issue(
      issues,
      "shape_invalid",
      "/candidate_hash",
      "candidate_hash is invalid",
      candidateId,
    );
  if (typeof row.definition_hash !== "string" || !hash(row.definition_hash))
    issue(
      issues,
      "shape_invalid",
      "/definition_hash",
      "definition_hash is invalid",
      candidateId,
    );
  if (typeof row.candidate_id !== "string" || !ID.test(row.candidate_id))
    issue(
      issues,
      "shape_invalid",
      "/candidate_id",
      "candidate_id is invalid",
      candidateId,
    );
  if (
    typeof row.source_observation_id !== "string" ||
    !UUID.test(row.source_observation_id)
  )
    issue(
      issues,
      "shape_invalid",
      "/source_observation_id",
      "source observation row ID is invalid",
      candidateId,
    );
  if (
    typeof row.source_observation_key !== "string" ||
    !ID.test(row.source_observation_key)
  )
    issue(
      issues,
      "shape_invalid",
      "/source_observation_key",
      "observation key is invalid",
      candidateId,
    );
  if (
    typeof row.observation_fingerprint !== "string" ||
    !hash(row.observation_fingerprint)
  )
    issue(
      issues,
      "shape_invalid",
      "/observation_fingerprint",
      "observation fingerprint is invalid",
      candidateId,
    );
  if (typeof row.p0_family_id !== "string" || !ID.test(row.p0_family_id))
    issue(
      issues,
      "shape_invalid",
      "/p0_family_id",
      "family ID is invalid",
      candidateId,
    );
  if (typeof row.source_role_id !== "string" || !ID.test(row.source_role_id))
    issue(
      issues,
      "shape_invalid",
      "/source_role_id",
      "source role ID is invalid",
      candidateId,
    );
  if (row.source_authority_role !== "primary")
    issue(
      issues,
      "binding_mismatch",
      "/source_authority_role",
      "only primary candidates are executable",
      candidateId,
    );
  for (const timestampField of ["machine_checked_at", "admitted_at"] as const)
    if (
      typeof row[timestampField] !== "string" ||
      !isCanonicalProvisionalDateTime(row[timestampField])
    )
      issue(
        issues,
        "shape_invalid",
        `/${timestampField}`,
        `${timestampField} is invalid`,
        candidateId,
      );
  if (!stringArray(row.source_ids))
    issue(
      issues,
      "shape_invalid",
      "/source_ids",
      "source_ids must be a unique ID array",
      candidateId,
    );

  const payload = row.candidate_payload;
  if (!record(payload) || !exactKeys(payload, CANDIDATE_KEYS))
    issue(
      issues,
      "incomplete",
      "/candidate_payload",
      "complete candidate payload is required",
      candidateId,
    );
  const candidate = payload as unknown as ProvisionalRuleCandidate;
  const rule = record(payload) ? payload.rule : undefined;
  if (!record(rule))
    issue(
      issues,
      "incomplete",
      "/candidate_payload/rule",
      "complete RewardRule is required",
      candidateId,
    );

  if (record(payload) && record(rule)) {
    if (candidate.candidate_id !== row.candidate_id)
      issue(
        issues,
        "binding_mismatch",
        "/candidate_id",
        "row and candidate IDs differ",
        candidateId,
      );
    if (candidate.observation_id !== row.source_observation_key)
      issue(
        issues,
        "binding_mismatch",
        "/observation_id",
        "row and candidate observations differ",
        candidateId,
      );
    if (candidate.observation_fingerprint !== row.observation_fingerprint)
      issue(
        issues,
        "binding_mismatch",
        "/observation_fingerprint",
        "row and candidate fingerprints differ",
        candidateId,
      );
    if (
      candidate.p0_family_id !== row.p0_family_id ||
      candidate.source_role_id !== row.source_role_id
    )
      issue(
        issues,
        "binding_mismatch",
        "/source_binding",
        "row and candidate family/role differ",
        candidateId,
      );
    if (candidate.source_authority_role !== row.source_authority_role)
      issue(
        issues,
        "binding_mismatch",
        "/source_authority_role",
        "row and candidate authority roles differ",
        candidateId,
      );
    if (
      !record(candidate.machine_check) ||
      candidate.machine_check.checked_at !== row.machine_checked_at
    )
      issue(
        issues,
        "binding_mismatch",
        "/machine_checked_at",
        "row and candidate machine-check timestamps differ",
        candidateId,
      );
    if (
      !stringArray(candidate.source_ids) ||
      !stringArray(row.source_ids) ||
      !sameStringSet(candidate.source_ids, row.source_ids)
    )
      issue(
        issues,
        "binding_mismatch",
        "/source_ids",
        "row and candidate sources differ",
        candidateId,
      );
    try {
      const computedDefinition = hashDefinition(rule);
      if (computedDefinition !== row.definition_hash)
        issue(
          issues,
          "definition_hash_mismatch",
          "/definition_hash",
          "definition hash does not match the embedded rule",
          candidateId,
        );
      const computedCandidate = hashCandidate(candidate, computedDefinition);
      if (computedCandidate !== row.candidate_hash)
        issue(
          issues,
          "candidate_hash_mismatch",
          "/candidate_hash",
          "candidate hash does not match the immutable candidate identity",
          candidateId,
        );
    } catch {
      issue(
        issues,
        "shape_invalid",
        "/candidate_payload",
        "candidate identity cannot be hashed",
        candidateId,
      );
    }
    const operations = record(rule.scope)
      ? rule.scope.operation_types
      : undefined;
    const calculation = rule.calculation;
    if (
      !Array.isArray(operations) ||
      operations.length !== 1 ||
      !SUPPORTED_OPERATION_TYPES.has(String(operations[0]))
    )
      issue(
        issues,
        "unsupported",
        "/candidate_payload/rule/scope/operation_types",
        "P0 operation shape is unsupported",
        candidateId,
      );
    if (
      !SUPPORTED_RULE_TYPES.has(String(rule.rule_type)) ||
      !record(calculation) ||
      !SUPPORTED_CALCULATION_MODELS.has(String(calculation.model))
    )
      issue(
        issues,
        "unsupported",
        "/candidate_payload/rule",
        "P0 rule/calculation shape is unsupported",
        candidateId,
      );
    const validity = classifyProvisionalValidity(rule.validity, effectiveAt);
    if (validity.status !== "active")
      issue(
        issues,
        validity.status === "unknown" ? "shape_invalid" : "inactive",
        "/candidate_payload/rule/validity",
        `candidate validity is ${validity.status}`,
        candidateId,
      );
  }

  const material = bindings;
  if (!material) {
    issue(
      issues,
      "incomplete",
      "/bindings",
      "trusted claim, evidence, asset, and principal-edge bindings are required",
      candidateId,
    );
  } else {
    if (!ID.test(material.claim_id))
      issue(
        issues,
        "incomplete",
        "/bindings/claim_id",
        "claim_id is invalid",
        candidateId,
      );
    if (!stringArray(material.evidence_ids))
      issue(
        issues,
        "incomplete",
        "/bindings/evidence_ids",
        "evidence_ids are required",
        candidateId,
      );
    if (!Array.isArray(material.assets) || material.assets.length === 0)
      issue(
        issues,
        "incomplete",
        "/bindings/assets",
        "complete asset definitions are required",
        candidateId,
      );
    if (
      !Array.isArray(material.principal_edges) ||
      material.principal_edges.length === 0
    )
      issue(
        issues,
        "incomplete",
        "/bindings/principal_edges",
        "principal edges are required",
        candidateId,
      );
    const ruleEvidence =
      record(rule) && record(rule.provenance)
        ? rule.provenance.evidence_ids
        : undefined;
    if (
      stringArray(material.evidence_ids) &&
      stringArray(ruleEvidence) &&
      !sameStringSet(material.evidence_ids, ruleEvidence)
    )
      issue(
        issues,
        "evidence_mismatch",
        "/bindings/evidence_ids",
        "trusted evidence does not equal rule provenance",
        candidateId,
      );
  }
  if (issues.length > 0)
    return { ok: false, value: null, issues: sortedIssues(issues) };

  const compiled = compileRuleIR({
    version: RULE_IR_VERSION,
    rule: rule as RewardRule,
    source_binding: {
      claim_id: (material as P0TrustedRuleIRBindings).claim_id,
      family_id: row.p0_family_id as string,
      source_role_id: row.source_role_id as string,
      source_ids: [...(row.source_ids as readonly string[])],
      observation_id: row.source_observation_key as string,
      observation_fingerprint: row.observation_fingerprint as string,
      evidence_ids: [...(material as P0TrustedRuleIRBindings).evidence_ids],
      candidate_id: row.candidate_id as string,
      candidate_hash: row.candidate_hash as Sha256,
      definition_hash: row.definition_hash as Sha256,
    },
    assets: (material as P0TrustedRuleIRBindings).assets,
    principal_edges: (material as P0TrustedRuleIRBindings).principal_edges,
  });
  if (!compiled.ok)
    return {
      ok: false,
      value: null,
      issues: sortedIssues(
        compiled.issues.map((item) => ({
          code: "rule_ir_invalid" as const,
          path: item.path,
          message: `${item.code}: ${item.message}`,
          ...(candidateId === undefined ? {} : { candidate_id: candidateId }),
        })),
      ),
    };
  return { ok: true, value: compiled.value, issues: [] };
}

/** Load current active rows; invalid/incomplete rows are reported and skipped. */
export async function loadCurrentP0EconomicRuleIRs(
  target: QueryTarget,
  options: P0RuleIRLoadOptions = {},
): Promise<P0RuleIRLoadResult> {
  const effectiveAt = options.effective_at;
  if (!effectiveAt || !isCanonicalProvisionalDateTime(effectiveAt))
    return {
      rule_irs: [],
      issues: Object.freeze([
        {
          code: "shape_invalid",
          path: "/effective_at",
          message: "effective_at is required and invalid",
        },
      ]),
    };
  const result = await target.query(P0_EXPERIMENTAL_CATALOGUE_QUERY);
  if (!result || !Array.isArray(result.rows))
    return {
      rule_irs: [],
      issues: Object.freeze([
        {
          code: "query_invalid",
          path: "",
          message: "candidate query result is invalid",
        },
      ]),
    };
  if (result.rows.length > MAX_P0_EXPERIMENTAL_CATALOGUE_ROWS)
    return {
      rule_irs: [],
      issues: Object.freeze([
        {
          code: "too_many_rows",
          path: "/rows",
          message: "candidate query exceeded its bounded row limit",
        },
      ]),
    };
  const ruleIrs: RuleIRV1[] = [];
  const issues: P0RuleIRIssue[] = [];
  for (const row of result.rows) {
    const id = ruleId(row);
    if (options.rule_ids && id && !options.rule_ids.includes(id)) continue;
    const candidate = candidateId(row);
    const binding =
      candidate &&
      options.bindings &&
      Object.hasOwn(options.bindings, candidate)
        ? options.bindings[candidate]
        : undefined;
    const compiled = compileP0EconomicCandidateRow(row, effectiveAt, binding);
    if (compiled.ok) ruleIrs.push(compiled.value);
    else issues.push(...compiled.issues);
  }
  ruleIrs.sort(
    (left, right) =>
      left.rule.rule_id.localeCompare(right.rule.rule_id) ||
      left.bundle_hash.localeCompare(right.bundle_hash),
  );
  return { rule_irs: Object.freeze(ruleIrs), issues: sortedIssues(issues) };
}

export const compileEconomicCandidateToRuleIR = compileP0EconomicCandidateRow;
export const loadCurrentEconomicRuleIRs = loadCurrentP0EconomicRuleIRs;
