import {
  M3_NON_TRANSFER_SEED_SCENARIO_IDS,
  type M3NonTransferSeedScenarioId,
} from "./m3-experiment.js";
import { M3_AUTHORITATIVE_PRIMARY_SOURCE_IDS } from "./m3-gate.js";

/**
 * M3 remediation is a fixture-governance surface.  It records proposed work
 * while leaving the source mapping and promotion gate authoritative elsewhere.
 */
export const M3_REMEDIATION_ACTIONS = [
  "retain_source",
  "add_official_source",
  "replace_source",
  "narrow_split_scenario",
  "permission_review",
  "technical_access",
  "engine_gap",
] as const;

export type M3RemediationAction = (typeof M3_REMEDIATION_ACTIONS)[number];

export const M3_SOURCE_PROMOTION_BLOCKER_CODES = [
  "missing_registry_source",
  "duplicate_registry_source_id",
  "missing_review_queue_item",
  "duplicate_review_queue_source_id",
  "registry_terms_not_reviewed",
  "registry_terms_not_approved",
  "review_queue_terms_not_reviewed",
  "review_queue_terms_not_approved",
  "registry_automation_not_permitted",
  "review_queue_automation_not_permitted",
  "registry_collection_path_not_permitted",
  "review_queue_collection_path_not_permitted",
  "technical_feasibility_unknown",
  "technical_observation_missing",
  "technical_observation_unknown",
  "technical_observation_source_mismatch",
  "technical_observation_aggregate_only",
  "technical_observation_not_reachable",
  "manual_reachability_only",
  "technical_feasibility_not_automatable",
  "duplicate_observation_id",
  "empty_primary_source_ids",
  "duplicate_scenario_id",
  "duplicate_scenario_source_id",
] as const;

export type M3SourcePromotionBlockerCode =
  (typeof M3_SOURCE_PROMOTION_BLOCKER_CODES)[number];

export type M3AssessmentValue =
  | string
  | boolean
  | readonly string[]
  | M3RemediationAssessment;

/** Every proposal records all five epistemic buckets, even when empty. */
export interface M3RemediationAssessment {
  verified?: string | readonly string[];
  verified_facts?: string | readonly string[];
  inference?: string | readonly string[];
  uncertainty?: string | readonly string[];
  recommendation?: string | readonly string[];
  decisions?: string | readonly string[];
  decisions_required?: string | readonly string[];
  [key: string]: unknown;
}

export interface M3RemediationDraftMapping {
  status: "draft" | "pending";
  source_ids?: readonly string[];
  primary_source_ids?: readonly string[];
  [key: string]: unknown;
}

export type M3RemediationMappingAfter =
  | readonly string[]
  | M3RemediationDraftMapping;

export type M3CoveredSourceBlocker =
  | readonly [source_id: string, code: M3SourcePromotionBlockerCode]
  | {
      source_id: string;
      code: M3SourcePromotionBlockerCode;
    }
  | {
      source_id: string;
      codes: readonly M3SourcePromotionBlockerCode[];
    };

export interface M3CandidateSourceDescriptor {
  source_id: string;
  url?: string;
  title?: string;
  replaces_source_id?: string;
  authority?: M3AssessmentValue;
  first_party?: M3AssessmentValue;
  terms?: M3AssessmentValue;
  provenance?: M3AssessmentValue;
  [key: string]: unknown;
}

export interface M3ReplacementBasis {
  reason: "authority_mismatch" | "retired";
  recorded: boolean;
  evidence?: string | readonly string[];
  [key: string]: unknown;
}

export interface M3RemediationApproval {
  status?: string;
  decision?: string;
  human_approval: boolean;
  [key: string]: unknown;
}

export interface M3RemediationPromotion {
  status: string;
  gate_override: boolean;
  [key: string]: unknown;
}

/**
 * The optional aliases keep this boundary usable with hand-authored JSON;
 * validation still requires one unambiguous value for each governed field.
 */
export interface M3RemediationProposal {
  proposal_id: string;
  scenario_id: string;
  actions?: readonly (M3RemediationAction | string)[];
  action?: M3RemediationAction | string;
  mapping_before: readonly string[];
  mapping_after?: M3RemediationMappingAfter | null;
  covered_source_blockers?: readonly M3CoveredSourceBlocker[];
  covered_blockers?: readonly M3CoveredSourceBlocker[];
  covered_blocker_tuples?: readonly M3CoveredSourceBlocker[];
  reason_codes?: readonly string[];
  candidate_source?: M3CandidateSourceDescriptor;
  candidate_sources?: readonly M3CandidateSourceDescriptor[];
  replacement_basis?: M3ReplacementBasis;
  replace_reason?: "authority_mismatch" | "retired" | string;
  replacement_evidence?: string | readonly string[];
  split_intent?: string;
  split_plan?: string;
  authority?: M3AssessmentValue;
  authority_scope_justification?: M3AssessmentValue;
  first_party?: M3AssessmentValue;
  first_party_preference?: M3AssessmentValue;
  terms?: M3AssessmentValue;
  terms_and_access_decision?: M3AssessmentValue;
  provenance?: M3AssessmentValue;
  provenance_refs?: M3AssessmentValue;
  intent?: string;
  impact_on_scenario_intent?: string;
  rollback?: string | readonly string[] | Record<string, unknown>;
  rollback_or_rejection_plan?:
    | string
    | readonly string[]
    | Record<string, unknown>;
  candidate_source_requirements?: readonly unknown[];
  mapping_after_note?: string;
  assessment?: Partial<M3RemediationAssessment>;
  approval?: M3RemediationApproval;
  approval_status?: string;
  human_approval?: boolean;
  promotion?: M3RemediationPromotion;
  promotion_status?: string;
  gate_override?: boolean;
  evidence?: unknown;
  independent_calculation?: unknown;
  engine_replay?: unknown;
  [key: string]: unknown;
}

export type M3RemediationProposalSetInput =
  | readonly M3RemediationProposal[]
  | { proposals: readonly M3RemediationProposal[] };

export interface M3FailedExperimentSourceReadiness {
  source_id: string;
  promotion_blocker_codes?: readonly string[];
  promotion_blockers?: readonly M3RawSourceBlocker[];
  [key: string]: unknown;
}

export interface M3RawSourceBlocker {
  code: string;
  source_id?: string | null;
  scenario_id?: string | null;
  detail?: string;
  [key: string]: unknown;
}

export interface M3FailedExperimentSourceGate {
  promotion_ready?: boolean;
  status?: string;
  promotion_blockers?: readonly M3RawSourceBlocker[];
  source_readiness?: readonly M3FailedExperimentSourceReadiness[];
  promotion_blocker_counts?: Readonly<Record<string, number>>;
  counts?: {
    promotion_blocker_counts?: Readonly<Record<string, number>>;
    promotion_blocker_count?: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface M3FailedExperimentScenario {
  scenario_id: string;
  status?: string;
  primary_source_ids?: readonly string[];
  blockers?: readonly {
    code?: string;
    detail?: string;
    [key: string]: unknown;
  }[];
  [key: string]: unknown;
}

export interface M3FailedExperimentInput {
  source_gate?: M3FailedExperimentSourceGate;
  scenarios?: readonly M3FailedExperimentScenario[];
  coverage?: {
    evaluated_scenario_ids?: readonly string[];
    excluded_scenario_ids?: readonly string[];
    [key: string]: unknown;
  };
  summary?: {
    readiness_decision?: string;
    [key: string]: unknown;
  };
  run_policy?: Record<string, unknown>;
  [key: string]: unknown;
}

export type M3RemediationValidationCode =
  | "failed_experiment_invalid"
  | "failed_experiment_not_blocked"
  | "source_gate_blockers_missing"
  | "source_blocker_unmapped"
  | "scenario_set_mismatch"
  | "scenario_not_in_non_transfer_seed_set"
  | "duplicate_scenario_id"
  | "duplicate_proposal_id"
  | "actions_missing"
  | "action_invalid"
  | "action_duplicate"
  | "action_alias_mismatch"
  | "proposal_id_invalid"
  | "mapping_before_mismatch"
  | "mapping_after_missing"
  | "mapping_after_invalid"
  | "mapping_after_note_missing"
  | "candidate_source_requirements_missing"
  | "unknown_existing_source_id"
  | "candidate_source_forbidden"
  | "candidate_source_missing"
  | "candidate_source_invalid"
  | "covered_blocker_missing"
  | "covered_blocker_unknown"
  | "covered_blocker_duplicate"
  | "assessment_missing"
  | "assessment_bucket_missing"
  | "field_missing"
  | "approval_not_pending"
  | "human_approval_not_false"
  | "promotion_not_blocked"
  | "gate_override_not_false"
  | "add_mapping_invalid"
  | "replace_basis_missing"
  | "replace_basis_not_recorded"
  | "replace_mapping_invalid"
  | "split_intent_missing"
  | "engine_gap_not_allowed"
  | "engine_gap_evidence_incomplete"
  | "terms_claimed_legal_resolution";

export interface M3RemediationValidationIssue {
  code: M3RemediationValidationCode;
  detail: string;
  scenario_id?: string;
  proposal_id?: string;
  source_id?: string;
  blocker_code?: string;
  path?: string;
}

export interface M3ScenarioScopedSourceBlocker {
  scenario_id: string;
  source_id: string;
  code: M3SourcePromotionBlockerCode;
}

export interface M3RemediationClassification {
  proposal_id: string;
  scenario_id: string;
  actions: readonly string[];
  action: string;
  covered_blocker_count: number;
  covered_blockers: readonly M3CoveredSourceBlocker[];
  source_change:
    | "none"
    | "draft_add"
    | "draft_replace"
    | "draft_split"
    | "invalid";
  remains_promotion_blocked: true;
  promotion_ready: false;
  human_approval: false;
  gate_override: false;
}

export interface M3RemediationSummary {
  valid: boolean;
  expected_scenario_ids: readonly M3NonTransferSeedScenarioId[];
  supplied_scenario_ids: readonly string[];
  proposal_count: number;
  action_membership_count: number;
  blocker_count: number;
  scenario_scoped_blocker_count: number;
  covered_blocker_count: number;
  covered_scenario_scoped_blocker_count: number;
  uncovered_blockers: readonly M3CoveredSourceBlocker[];
  uncovered_scenario_scoped_blockers: readonly M3ScenarioScopedSourceBlocker[];
  unknown_covered_blockers: readonly M3CoveredSourceBlocker[];
  proposals_by_action: Readonly<Record<M3RemediationAction, number>>;
  classifications: readonly M3RemediationClassification[];
  promotion_blocked: true;
  promotion_ready: false;
  human_approval: false;
  gate_override: false;
}

export interface M3RemediationValidationResult {
  valid: boolean;
  expected_scenario_ids: readonly M3NonTransferSeedScenarioId[];
  supplied_scenario_ids: readonly string[];
  expected_blockers: readonly M3CoveredSourceBlocker[];
  expected_scenario_scoped_blockers: readonly M3ScenarioScopedSourceBlocker[];
  covered_blockers: readonly M3CoveredSourceBlocker[];
  covered_scenario_scoped_blockers: readonly M3ScenarioScopedSourceBlocker[];
  uncovered_blockers: readonly M3CoveredSourceBlocker[];
  uncovered_scenario_scoped_blockers: readonly M3ScenarioScopedSourceBlocker[];
  issues: readonly M3RemediationValidationIssue[];
  /** Alias retained for callers that use gate terminology. */
  blockers: readonly M3RemediationValidationIssue[];
  summary: M3RemediationSummary;
  promotion_blocked: true;
  promotion_ready: false;
  human_approval: false;
  gate_override: false;
}

const ACTION_SET = new Set<string>(M3_REMEDIATION_ACTIONS);
const BLOCKER_SET = new Set<string>(M3_SOURCE_PROMOTION_BLOCKER_CODES);
const TRANSFER_SCENARIO_ID = "JP-XFR-002";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function arrayOfStrings(value: unknown): readonly string[] | null {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string"))
    return null;
  return [...value];
}

function sameStrings(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function proposalList(
  input: M3RemediationProposalSetInput,
): readonly M3RemediationProposal[] {
  return Array.isArray(input)
    ? input
    : "proposals" in input
      ? input.proposals
      : [];
}

function isTuple(
  value: M3CoveredSourceBlocker,
): value is readonly [string, M3SourcePromotionBlockerCode] {
  return Array.isArray(value);
}

function isCodeObject(
  value: M3CoveredSourceBlocker,
): value is { source_id: string; code: M3SourcePromotionBlockerCode } {
  return !Array.isArray(value) && "code" in value;
}

function isGroupedBlocker(value: M3CoveredSourceBlocker): value is {
  source_id: string;
  codes: readonly M3SourcePromotionBlockerCode[];
} {
  return !Array.isArray(value) && "codes" in value;
}

function tupleKey(tuple: M3CoveredSourceBlocker): string {
  return isTuple(tuple)
    ? `${tuple[0]}\u0000${tuple[1]}`
    : isCodeObject(tuple)
      ? `${tuple.source_id}\u0000${tuple.code}`
      : `${tuple.source_id}\u0000${tuple.codes.join("\u0001")}`;
}

function normalizeTuple(value: unknown): M3CoveredSourceBlocker | null {
  if (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "string" &&
    typeof value[1] === "string" &&
    BLOCKER_SET.has(value[1])
  ) {
    return [value[0], value[1] as M3SourcePromotionBlockerCode];
  }
  if (
    isRecord(value) &&
    typeof value.source_id === "string" &&
    typeof value.code === "string" &&
    BLOCKER_SET.has(value.code)
  ) {
    return {
      source_id: value.source_id,
      code: value.code as M3SourcePromotionBlockerCode,
    };
  }
  return null;
}

function tupleParts(tuple: M3CoveredSourceBlocker): {
  source_id: string;
  code: M3SourcePromotionBlockerCode;
} {
  return isTuple(tuple)
    ? { source_id: tuple[0], code: tuple[1] }
    : isCodeObject(tuple)
      ? { source_id: tuple.source_id, code: tuple.code }
      : {
          source_id: tuple.source_id,
          code: tuple.codes[0] as M3SourcePromotionBlockerCode,
        };
}

function sortedTuples(
  values: readonly M3CoveredSourceBlocker[],
): readonly M3CoveredSourceBlocker[] {
  return [...values].sort((left, right) =>
    tupleKey(left).localeCompare(tupleKey(right)),
  );
}

function expectedMappings(
  experiment: M3FailedExperimentInput,
  issues: M3RemediationValidationIssue[],
): Readonly<Record<M3NonTransferSeedScenarioId, readonly string[]>> {
  const scenarios = Array.isArray(experiment.scenarios)
    ? experiment.scenarios
    : [];
  return M3_NON_TRANSFER_SEED_SCENARIO_IDS.reduce(
    (result, scenarioId) => {
      const scenario = scenarios.find(
        (item) => item.scenario_id === scenarioId,
      );
      const sourceIds = scenario?.primary_source_ids;
      if (
        !Array.isArray(sourceIds) ||
        sourceIds.length === 0 ||
        sourceIds.some(
          (sourceId) =>
            typeof sourceId !== "string" || sourceId.trim().length === 0,
        )
      ) {
        issues.push({
          code: "failed_experiment_invalid",
          detail: `Failed experiment is missing its frozen source mapping for ${scenarioId}.`,
          scenario_id: scenarioId,
        });
        result[scenarioId] = [];
      } else {
        result[scenarioId] = [...sourceIds];
      }
      return result;
    },
    {} as Record<M3NonTransferSeedScenarioId, readonly string[]>,
  );
}

function currentSources(
  mappings: Readonly<Record<M3NonTransferSeedScenarioId, readonly string[]>>,
): ReadonlySet<string> {
  const sourceIds = new Set<string>();
  for (const scenarioId of M3_NON_TRANSFER_SEED_SCENARIO_IDS)
    for (const sourceId of mappings[scenarioId]) sourceIds.add(sourceId);
  return sourceIds;
}

function allAuthoritativeSources(
  mappings: Readonly<Record<M3NonTransferSeedScenarioId, readonly string[]>>,
): ReadonlySet<string> {
  const sourceIds = new Set<string>();
  for (const sourceIdsForScenario of Object.values(mappings))
    for (const sourceId of sourceIdsForScenario) sourceIds.add(sourceId);
  for (const sourceIdsForScenario of Object.values(
    M3_AUTHORITATIVE_PRIMARY_SOURCE_IDS,
  ))
    for (const sourceId of sourceIdsForScenario) sourceIds.add(sourceId);
  return sourceIds;
}

function extractExpectedBlockers(
  experiment: M3FailedExperimentInput,
  mappings: Readonly<Record<M3NonTransferSeedScenarioId, readonly string[]>>,
  issues: M3RemediationValidationIssue[],
): readonly M3CoveredSourceBlocker[] {
  const sourceGate = experiment.source_gate;
  if (!isRecord(sourceGate)) {
    issues.push({
      code: "failed_experiment_invalid",
      detail: "The failed experiment has no source_gate result.",
    });
    return [];
  }

  const raw: M3CoveredSourceBlocker[] = [];
  const aggregate = Array.isArray(sourceGate.promotion_blockers)
    ? sourceGate.promotion_blockers
    : [];
  for (const blocker of aggregate) {
    if (typeof blocker.source_id !== "string") continue;
    if (!BLOCKER_SET.has(blocker.code)) {
      issues.push({
        code: "source_blocker_unmapped",
        detail: `Unknown source-gate promotion blocker code ${blocker.code}.`,
        source_id: blocker.source_id,
        blocker_code: blocker.code,
      });
      continue;
    }
    raw.push({
      source_id: blocker.source_id,
      code: blocker.code as M3SourcePromotionBlockerCode,
    });
  }
  if (raw.length === 0 && Array.isArray(sourceGate.source_readiness)) {
    for (const readiness of sourceGate.source_readiness) {
      if (typeof readiness.source_id !== "string") continue;
      const blockers = Array.isArray(readiness.promotion_blockers)
        ? (readiness.promotion_blockers as readonly M3RawSourceBlocker[]).map(
            (item) => item.code,
          )
        : (readiness.promotion_blocker_codes ?? []);
      for (const code of blockers) {
        if (!BLOCKER_SET.has(code)) {
          issues.push({
            code: "source_blocker_unmapped",
            detail: `Unknown source-gate promotion blocker code ${code}.`,
            source_id: readiness.source_id,
            blocker_code: code,
          });
          continue;
        }
        raw.push({
          source_id: readiness.source_id,
          code: code as M3SourcePromotionBlockerCode,
        });
      }
    }
  }
  const scopedSources = currentSources(mappings);
  const knownSources = allAuthoritativeSources(mappings);
  const scoped = new Map<string, M3CoveredSourceBlocker>();
  for (const tuple of raw) {
    const { source_id, code } = tupleParts(tuple);
    if (!scopedSources.has(source_id)) {
      if (!knownSources.has(source_id)) {
        issues.push({
          code: "source_blocker_unmapped",
          detail: `Source ${source_id} is not authoritative for an M3 non-transfer scenario.`,
          source_id,
          blocker_code: code,
        });
      }
      // JP-XFR-002 is intentionally excluded from this nine-proposal slice.
      continue;
    }
    scoped.set(tupleKey(tuple), { source_id, code });
  }
  if (scoped.size === 0)
    issues.push({
      code: "source_gate_blockers_missing",
      detail: "No scoped source promotion blocker tuples were found.",
    });
  return sortedTuples([...scoped.values()]);
}

function scenarioScopedBlockers(
  expectedBlockers: readonly M3CoveredSourceBlocker[],
  mappings: Readonly<Record<M3NonTransferSeedScenarioId, readonly string[]>>,
): readonly M3ScenarioScopedSourceBlocker[] {
  const bySource = new Map<string, readonly M3SourcePromotionBlockerCode[]>();
  for (const tuple of expectedBlockers) {
    const { source_id, code } = tupleParts(tuple);
    bySource.set(source_id, [...(bySource.get(source_id) ?? []), code]);
  }
  const scoped: M3ScenarioScopedSourceBlocker[] = [];
  for (const scenarioId of M3_NON_TRANSFER_SEED_SCENARIO_IDS) {
    for (const sourceId of mappings[scenarioId]) {
      for (const code of bySource.get(sourceId) ?? []) {
        scoped.push({ scenario_id: scenarioId, source_id: sourceId, code });
      }
    }
  }
  return scoped.sort(
    (left, right) =>
      left.scenario_id.localeCompare(right.scenario_id) ||
      left.source_id.localeCompare(right.source_id) ||
      left.code.localeCompare(right.code),
  );
}

function scenarioTupleKey(tuple: M3ScenarioScopedSourceBlocker): string {
  return `${tuple.scenario_id}\u0000${tuple.source_id}\u0000${tuple.code}`;
}

function assessmentHasLegalApproval(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    value.legal_permission_determined === true ||
    value.approved === true ||
    (typeof value.status === "string" &&
      value.status.toLowerCase() === "approved")
  );
}

function validateAssessmentFields(
  proposal: M3RemediationProposal,
  issues: M3RemediationValidationIssue[],
): void {
  const fields = [
    ["authority", "authority_scope_justification"],
    ["first_party", "first_party_preference"],
    ["terms", "terms_and_access_decision"],
    ["provenance", "provenance_refs"],
  ] as const;
  for (const [field, alias] of fields) {
    const value = proposal[field] ?? proposal[alias];
    if (value === undefined) {
      issues.push({
        code: "field_missing",
        detail: `${field} assessment is required.`,
        scenario_id: proposal.scenario_id,
        proposal_id: proposal.proposal_id,
        path: field,
      });
    }
    if (field === "terms" && assessmentHasLegalApproval(value)) {
      issues.push({
        code: "terms_claimed_legal_resolution",
        detail: "Terms observations are not a legal permission decision.",
        scenario_id: proposal.scenario_id,
        proposal_id: proposal.proposal_id,
        path: field,
      });
    }
  }
  const intent = proposal.intent ?? proposal.impact_on_scenario_intent;
  if (typeof intent !== "string" || intent.trim().length === 0)
    issues.push({
      code: "field_missing",
      detail: "intent is required.",
      scenario_id: proposal.scenario_id,
      proposal_id: proposal.proposal_id,
      path: "intent/impact_on_scenario_intent",
    });
  if (
    proposal.rollback === undefined &&
    proposal.rollback_or_rejection_plan === undefined
  )
    issues.push({
      code: "field_missing",
      detail: "rollback is required.",
      scenario_id: proposal.scenario_id,
      proposal_id: proposal.proposal_id,
      path: "rollback/rollback_or_rejection_plan",
    });
  const assessment = proposal.assessment;
  if (!isRecord(assessment)) {
    issues.push({
      code: "assessment_missing",
      detail:
        "assessment must distinguish verified, inference, uncertainty, recommendation, and decisions.",
      scenario_id: proposal.scenario_id,
      proposal_id: proposal.proposal_id,
      path: "assessment",
    });
  } else {
    const buckets = [
      ["verified", "verified_facts"],
      ["inference", "inference"],
      ["uncertainty", "uncertainty"],
      ["recommendation", "recommendation"],
      ["decisions", "decisions_required"],
    ] as const;
    for (const [bucket, alias] of buckets) {
      if (!(bucket in assessment) && !(alias in assessment))
        issues.push({
          code: "assessment_bucket_missing",
          detail: `assessment.${bucket} (or ${alias}) is required.`,
          scenario_id: proposal.scenario_id,
          proposal_id: proposal.proposal_id,
          path: `assessment.${bucket}`,
        });
    }
  }
}

function mappingAfterSources(value: unknown): readonly string[] | null {
  const array = arrayOfStrings(value);
  if (array) return array;
  if (
    !isRecord(value) ||
    (value.status !== "draft" && value.status !== "pending")
  )
    return null;
  return arrayOfStrings(value.source_ids ?? value.primary_source_ids);
}

function mappingAfterIsDraft(value: unknown): boolean {
  return (
    isRecord(value) && (value.status === "draft" || value.status === "pending")
  );
}

function candidateSources(
  proposal: M3RemediationProposal,
): readonly M3CandidateSourceDescriptor[] {
  if (Array.isArray(proposal.candidate_sources))
    return [...proposal.candidate_sources];
  return proposal.candidate_source ? [proposal.candidate_source] : [];
}

function proposalActions(proposal: M3RemediationProposal): readonly string[] {
  if (Array.isArray(proposal.actions)) return [...proposal.actions];
  return typeof proposal.action === "string" ? [proposal.action] : [];
}

function nonEmptyRequirements(proposal: M3RemediationProposal): boolean {
  const requirements = proposal.candidate_source_requirements;
  return (
    Array.isArray(requirements) &&
    requirements.length > 0 &&
    requirements.every((item) => {
      if (typeof item === "string") return item.trim().length > 0;
      return isRecord(item) && Object.keys(item).length > 0;
    })
  );
}

function coveredTuples(
  proposal: M3RemediationProposal,
): readonly M3CoveredSourceBlocker[] {
  const input =
    proposal.covered_source_blockers ??
    proposal.covered_blockers ??
    proposal.covered_blocker_tuples ??
    [];
  const normalized: M3CoveredSourceBlocker[] = [];
  for (const value of input) {
    if (isGroupedBlocker(value)) {
      for (const code of value.codes) {
        const tuple = normalizeTuple({ source_id: value.source_id, code });
        if (tuple) normalized.push(tuple);
      }
      continue;
    }
    const tuple = normalizeTuple(value);
    if (tuple) normalized.push(tuple);
  }
  return normalized;
}

function validateApproval(
  proposal: M3RemediationProposal,
  issues: M3RemediationValidationIssue[],
): void {
  const approvalStatus =
    proposal.approval?.status ??
    proposal.approval?.decision ??
    proposal.approval_status;
  const humanApproval =
    proposal.approval?.human_approval ?? proposal.human_approval;
  const promotionStatus = (
    proposal.promotion?.status ?? proposal.promotion_status
  )?.toLowerCase();
  const gateOverride =
    proposal.promotion?.gate_override ?? proposal.gate_override;
  if (approvalStatus !== "pending")
    issues.push({
      code: "approval_not_pending",
      detail: "Approval must remain pending.",
      scenario_id: proposal.scenario_id,
      proposal_id: proposal.proposal_id,
      path: "approval",
    });
  if (humanApproval !== false)
    issues.push({
      code: "human_approval_not_false",
      detail: "Remediation cannot record human approval.",
      scenario_id: proposal.scenario_id,
      proposal_id: proposal.proposal_id,
      path: "approval.human_approval",
    });
  if (promotionStatus !== "blocked")
    issues.push({
      code: "promotion_not_blocked",
      detail: "Promotion must remain blocked.",
      scenario_id: proposal.scenario_id,
      proposal_id: proposal.proposal_id,
      path: "promotion",
    });
  if (gateOverride !== false)
    issues.push({
      code: "gate_override_not_false",
      detail: "The authoritative gate cannot be overridden.",
      scenario_id: proposal.scenario_id,
      proposal_id: proposal.proposal_id,
      path: "promotion.gate_override",
    });
}

function validateProposal(
  proposal: M3RemediationProposal,
  expected: Readonly<Record<M3NonTransferSeedScenarioId, readonly string[]>>,
  expectedBlockers: readonly M3CoveredSourceBlocker[],
  expectedScenarioBlockers: readonly M3ScenarioScopedSourceBlocker[],
  issues: M3RemediationValidationIssue[],
  blockedRun: boolean,
): readonly M3CoveredSourceBlocker[] {
  const mapping = expected[proposal.scenario_id as M3NonTransferSeedScenarioId];
  const actions = proposalActions(proposal);
  if (actions.length === 0)
    issues.push({
      code: "actions_missing",
      detail: "At least one remediation action is required.",
      scenario_id: proposal.scenario_id,
      proposal_id: proposal.proposal_id,
      path: "actions",
    });
  const actionSet = new Set<string>();
  for (const action of actions) {
    if (actionSet.has(action))
      issues.push({
        code: "action_duplicate",
        detail: `Action ${action} is duplicated within the proposal.`,
        scenario_id: proposal.scenario_id,
        proposal_id: proposal.proposal_id,
        path: "actions",
      });
    actionSet.add(action);
    if (!ACTION_SET.has(action))
      issues.push({
        code: "action_invalid",
        detail: `Unknown remediation action ${action}.`,
        scenario_id: proposal.scenario_id,
        proposal_id: proposal.proposal_id,
        path: "actions",
      });
  }
  if (
    typeof proposal.action === "string" &&
    Array.isArray(proposal.actions) &&
    !actions.includes(proposal.action)
  )
    issues.push({
      code: "action_alias_mismatch",
      detail: "Singular action alias must be one of the primary actions.",
      scenario_id: proposal.scenario_id,
      proposal_id: proposal.proposal_id,
      path: "action",
    });
  if (!mapping) {
    issues.push({
      code:
        proposal.scenario_id === TRANSFER_SCENARIO_ID
          ? "scenario_not_in_non_transfer_seed_set"
          : "scenario_set_mismatch",
      detail:
        "Only the exact nine non-transfer M3 scenarios may be remediated.",
      scenario_id: proposal.scenario_id,
      proposal_id: proposal.proposal_id,
    });
  }
  if (
    typeof proposal.proposal_id !== "string" ||
    proposal.proposal_id.trim().length === 0
  ) {
    issues.push({
      code: "proposal_id_invalid",
      detail: "Proposal ID is required.",
      scenario_id: proposal.scenario_id,
    });
  } else if (mapping && !proposal.proposal_id.includes(proposal.scenario_id)) {
    issues.push({
      code: "proposal_id_invalid",
      detail: "Proposal ID must deterministically include scenario ID.",
      scenario_id: proposal.scenario_id,
      proposal_id: proposal.proposal_id,
    });
  }
  if (
    !mapping ||
    !Array.isArray(proposal.mapping_before) ||
    !sameStrings(proposal.mapping_before, mapping)
  ) {
    issues.push({
      code: "mapping_before_mismatch",
      detail:
        "mapping_before must exactly equal the authoritative primary-source mapping.",
      scenario_id: proposal.scenario_id,
      proposal_id: proposal.proposal_id,
      path: "mapping_before",
    });
  }
  const after = proposal.mapping_after;
  if (after === undefined)
    issues.push({
      code: "mapping_after_missing",
      detail: "mapping_after is required and is never applied by this API.",
      scenario_id: proposal.scenario_id,
      proposal_id: proposal.proposal_id,
      path: "mapping_after",
    });
  const afterSources = mappingAfterSources(after);
  const hasScopeChange =
    actions.includes("add_official_source") ||
    actions.includes("replace_source") ||
    actions.includes("narrow_split_scenario");
  if (after !== undefined && after !== null && !afterSources)
    issues.push({
      code: "mapping_after_invalid",
      detail:
        "mapping_after must be the exact mapping or an explicit draft/pending mapping.",
      scenario_id: proposal.scenario_id,
      proposal_id: proposal.proposal_id,
      path: "mapping_after",
    });
  if (after === null) {
    if (
      !actions.includes("add_official_source") &&
      !actions.includes("narrow_split_scenario")
    )
      issues.push({
        code: "mapping_after_invalid",
        detail:
          "Null mapping_after is only valid for pending add or split work.",
        scenario_id: proposal.scenario_id,
        proposal_id: proposal.proposal_id,
        path: "mapping_after",
      });
    if (!proposal.mapping_after_note?.trim())
      issues.push({
        code: "mapping_after_note_missing",
        detail: "Null mapping_after requires a non-empty pending note.",
        scenario_id: proposal.scenario_id,
        proposal_id: proposal.proposal_id,
        path: "mapping_after_note",
      });
    if (!nonEmptyRequirements(proposal))
      issues.push({
        code: "candidate_source_requirements_missing",
        detail:
          "Null mapping_after requires non-empty candidate source requirements.",
        scenario_id: proposal.scenario_id,
        proposal_id: proposal.proposal_id,
        path: "candidate_source_requirements",
      });
  }
  if (mapping && afterSources) {
    if (!hasScopeChange && !sameStrings(afterSources, mapping))
      issues.push({
        code: "mapping_after_invalid",
        detail:
          "Retain-only, permission, and technical actions require the unchanged authoritative mapping.",
        scenario_id: proposal.scenario_id,
        proposal_id: proposal.proposal_id,
        path: "mapping_after",
      });
    if (!sameStrings(afterSources, mapping) && !mappingAfterIsDraft(after))
      issues.push({
        code: "mapping_after_invalid",
        detail:
          "A changed mapping_after must be explicitly marked draft or pending; only the exact mapping may be represented as applied-looking data.",
        scenario_id: proposal.scenario_id,
        proposal_id: proposal.proposal_id,
        path: "mapping_after",
      });
    for (const sourceId of afterSources) {
      if (
        !allAuthoritativeSources(expected).has(sourceId) &&
        !candidateSources(proposal).some(
          (candidate) => candidate.source_id === sourceId,
        )
      ) {
        issues.push({
          code: "unknown_existing_source_id",
          detail: `Mapping references unknown source ${sourceId}.`,
          scenario_id: proposal.scenario_id,
          proposal_id: proposal.proposal_id,
          source_id: sourceId,
        });
      }
    }
  }
  validateAssessmentFields(proposal, issues);
  validateApproval(proposal, issues);

  const candidates = candidateSources(proposal);
  const isCandidateAction =
    actions.includes("add_official_source") ||
    actions.includes("replace_source");
  const addNeedsDescriptor =
    actions.includes("add_official_source") &&
    !!mapping &&
    !!afterSources &&
    !sameStrings(afterSources, mapping);
  if (!isCandidateAction && candidates.length > 0)
    issues.push({
      code: "candidate_source_forbidden",
      detail:
        "Candidate source descriptors are allowed only for add_official_source or replace_source.",
      scenario_id: proposal.scenario_id,
      proposal_id: proposal.proposal_id,
    });
  if (
    (actions.includes("replace_source") || addNeedsDescriptor) &&
    candidates.length !== 1
  )
    issues.push({
      code: "candidate_source_missing",
      detail:
        "Exactly one candidate source descriptor is required for add/replace.",
      scenario_id: proposal.scenario_id,
      proposal_id: proposal.proposal_id,
    });
  for (const candidate of candidates) {
    if (
      !candidate ||
      typeof candidate.source_id !== "string" ||
      candidate.source_id.trim().length === 0
    )
      issues.push({
        code: "candidate_source_invalid",
        detail: "Candidate source descriptor needs a source_id.",
        scenario_id: proposal.scenario_id,
        proposal_id: proposal.proposal_id,
      });
    if (
      candidate.source_id === TRANSFER_SCENARIO_ID ||
      candidate.source_id === "JP-XFR-002"
    )
      issues.push({
        code: "candidate_source_invalid",
        detail:
          "The transfer seed cannot be admitted to this non-transfer remediation set.",
        scenario_id: proposal.scenario_id,
        proposal_id: proposal.proposal_id,
      });
  }
  if (actions.includes("add_official_source") && mapping && afterSources) {
    const candidate = candidates[0];
    if (
      candidates.length > 0 &&
      (!mappingAfterIsDraft(after) ||
        !candidate ||
        afterSources.length !== mapping.length + 1 ||
        !sameStrings(
          afterSources.filter((id) => id !== candidate.source_id),
          mapping,
        ) ||
        mapping.includes(candidate.source_id))
    )
      issues.push({
        code: "add_mapping_invalid",
        detail:
          "An applied-looking add must use a draft/pending mapping and append exactly one new source.",
        scenario_id: proposal.scenario_id,
        proposal_id: proposal.proposal_id,
      });
  }
  if (actions.includes("replace_source")) {
    const basis = proposal.replacement_basis;
    const reason = basis?.reason ?? proposal.replace_reason;
    const recorded = basis?.recorded ?? false;
    const evidence = basis?.evidence ?? proposal.replacement_evidence;
    if (reason !== "authority_mismatch" && reason !== "retired")
      issues.push({
        code: "replace_basis_missing",
        detail:
          "Replacement requires a recorded authority mismatch or retirement, not source availability.",
        scenario_id: proposal.scenario_id,
        proposal_id: proposal.proposal_id,
      });
    if (
      !recorded ||
      (typeof evidence !== "string" && !Array.isArray(evidence)) ||
      (Array.isArray(evidence) && evidence.length === 0) ||
      (typeof evidence === "string" && evidence.trim().length === 0)
    )
      issues.push({
        code: "replace_basis_not_recorded",
        detail:
          "Replacement basis must include recorded evidence of authority mismatch or retirement.",
        scenario_id: proposal.scenario_id,
        proposal_id: proposal.proposal_id,
      });
    const candidate = candidates[0];
    const replaced = candidate?.replaces_source_id;
    if (
      mapping &&
      afterSources &&
      (!mappingAfterIsDraft(after) ||
        !candidate ||
        !replaced ||
        !mapping.includes(replaced) ||
        mapping.includes(candidate.source_id) ||
        afterSources.length !== mapping.length ||
        !sameStrings(
          afterSources.filter((id) => id !== candidate.source_id),
          mapping.filter((id) => id !== replaced),
        ) ||
        !afterSources.includes(candidate.source_id))
    )
      issues.push({
        code: "replace_mapping_invalid",
        detail:
          "A replacement is draft/pending only and must replace one existing authoritative source.",
        scenario_id: proposal.scenario_id,
        proposal_id: proposal.proposal_id,
      });
  }
  if (
    actions.includes("narrow_split_scenario") &&
    after !== null &&
    !proposal.split_intent &&
    !proposal.split_plan &&
    !proposal.mapping_after_note
  )
    issues.push({
      code: "split_intent_missing",
      detail:
        "A narrow/split proposal needs an explicit pending intent or plan.",
      scenario_id: proposal.scenario_id,
      proposal_id: proposal.proposal_id,
    });
  if (actions.includes("engine_gap")) {
    if (blockedRun)
      issues.push({
        code: "engine_gap_not_allowed",
        detail:
          "The current run is source-blocked and did not produce approved evidence, independent calculation, or replay.",
        scenario_id: proposal.scenario_id,
        proposal_id: proposal.proposal_id,
      });
    const evidence =
      isRecord(proposal.evidence) &&
      (proposal.evidence.status === "approved" ||
        proposal.evidence.review_decision === "approved");
    const independent =
      isRecord(proposal.independent_calculation) &&
      proposal.independent_calculation.status === "completed" &&
      proposal.independent_calculation.method !== "engine";
    const replay =
      isRecord(proposal.engine_replay) &&
      proposal.engine_replay.status === "passed";
    if (!evidence || !independent || !replay)
      issues.push({
        code: "engine_gap_evidence_incomplete",
        detail:
          "engine_gap requires approved evidence, an independent calculation, and a passed replay.",
        scenario_id: proposal.scenario_id,
        proposal_id: proposal.proposal_id,
      });
  }
  const covered = coveredTuples(proposal);
  const expectedKeys = new Set(expectedBlockers.map(tupleKey));
  const localKeys = new Set<string>();
  for (const tuple of covered) {
    const key = tupleKey(tuple);
    const { source_id, code } = tupleParts(tuple);
    if (!expectedKeys.has(key))
      issues.push({
        code: "covered_blocker_unknown",
        detail: `Covered blocker ${source_id}/${code} is not a current scoped source-promotion blocker.`,
        scenario_id: proposal.scenario_id,
        proposal_id: proposal.proposal_id,
        source_id,
        blocker_code: code,
      });
    if (localKeys.has(key))
      issues.push({
        code: "covered_blocker_duplicate",
        detail: `Covered blocker ${source_id}/${code} is duplicated.`,
        scenario_id: proposal.scenario_id,
        proposal_id: proposal.proposal_id,
        source_id,
        blocker_code: code,
      });
    localKeys.add(key);
    if (mapping && !mapping.includes(source_id))
      issues.push({
        code: "covered_blocker_unknown",
        detail: `Covered source ${source_id} is not in this scenario's mapping.`,
        scenario_id: proposal.scenario_id,
        proposal_id: proposal.proposal_id,
        source_id,
        blocker_code: code,
      });
  }
  const expectedForScenario = expectedScenarioBlockers.filter(
    (tuple) => tuple.scenario_id === proposal.scenario_id,
  );
  const coveredForScenario = new Set(
    covered.map((tuple) => {
      const { source_id, code } = tupleParts(tuple);
      return scenarioTupleKey({
        scenario_id: proposal.scenario_id,
        source_id,
        code,
      });
    }),
  );
  for (const tuple of expectedForScenario) {
    if (coveredForScenario.has(scenarioTupleKey(tuple))) continue;
    issues.push({
      code: "covered_blocker_missing",
      detail: `Proposal does not cover scenario-scoped blocker ${tuple.source_id}/${tuple.code}.`,
      scenario_id: proposal.scenario_id,
      proposal_id: proposal.proposal_id,
      source_id: tuple.source_id,
      blocker_code: tuple.code,
    });
  }
  return covered;
}

function emptyActionCounts(): Record<M3RemediationAction, number> {
  return Object.fromEntries(
    M3_REMEDIATION_ACTIONS.map((action) => [action, 0]),
  ) as Record<M3RemediationAction, number>;
}

export function createM3RemediationProposalId(
  scenarioId: string,
  action: M3RemediationAction,
): string {
  return `m3-remediation:${scenarioId}:${action}`;
}

export function classifyM3RemediationProposal(
  proposal: M3RemediationProposal,
): M3RemediationClassification {
  const actions = proposalActions(proposal);
  const action = actions[0] ?? "invalid";
  const sourceChange = actions.includes("add_official_source")
    ? "draft_add"
    : actions.includes("replace_source")
      ? "draft_replace"
      : actions.includes("narrow_split_scenario")
        ? "draft_split"
        : actions.every((item) => ACTION_SET.has(item))
          ? "none"
          : "invalid";
  return {
    proposal_id: proposal.proposal_id,
    scenario_id: proposal.scenario_id,
    actions,
    action,
    covered_blocker_count: coveredTuples(proposal).length,
    covered_blockers: sortedTuples(coveredTuples(proposal)),
    source_change: sourceChange,
    remains_promotion_blocked: true,
    promotion_ready: false,
    human_approval: false,
    gate_override: false,
  };
}

function buildSummary(
  valid: boolean,
  suppliedScenarioIds: readonly string[],
  expectedBlockers: readonly M3CoveredSourceBlocker[],
  expectedScenarioBlockers: readonly M3ScenarioScopedSourceBlocker[],
  coveredBlockers: readonly M3CoveredSourceBlocker[],
  coveredScenarioBlockers: readonly M3ScenarioScopedSourceBlocker[],
  classifications: readonly M3RemediationClassification[],
): M3RemediationSummary {
  const expectedKeys = new Set(expectedBlockers.map(tupleKey));
  const coveredKeys = new Set(coveredBlockers.map(tupleKey));
  const uncovered = expectedBlockers.filter(
    (tuple) => !coveredKeys.has(tupleKey(tuple)),
  );
  const unknown = coveredBlockers.filter(
    (tuple) => !expectedKeys.has(tupleKey(tuple)),
  );
  const coveredScenarioKeys = new Set(
    coveredScenarioBlockers.map(scenarioTupleKey),
  );
  const uncoveredScenarioBlockers = expectedScenarioBlockers.filter(
    (tuple) => !coveredScenarioKeys.has(scenarioTupleKey(tuple)),
  );
  const proposalsByAction = emptyActionCounts();
  for (const classification of classifications)
    for (const action of classification.actions)
      if (ACTION_SET.has(action))
        proposalsByAction[action as M3RemediationAction] += 1;
  return {
    valid,
    expected_scenario_ids: [...M3_NON_TRANSFER_SEED_SCENARIO_IDS],
    supplied_scenario_ids: [...suppliedScenarioIds],
    proposal_count: classifications.length,
    action_membership_count: classifications.reduce(
      (count, classification) => count + classification.actions.length,
      0,
    ),
    scenario_scoped_blocker_count: expectedScenarioBlockers.length,
    blocker_count: expectedBlockers.length,
    covered_scenario_scoped_blocker_count: coveredScenarioKeys.size,
    covered_blocker_count: coveredKeys.size,
    uncovered_blockers: sortedTuples(uncovered),
    uncovered_scenario_scoped_blockers: uncoveredScenarioBlockers,
    unknown_covered_blockers: sortedTuples(unknown),
    proposals_by_action: proposalsByAction,
    classifications,
    promotion_blocked: true,
    promotion_ready: false,
    human_approval: false,
    gate_override: false,
  };
}

/** Pure validator. It accepts the arguments in either natural order. */
export function validateM3RemediationProposalSet(
  experiment: M3FailedExperimentInput,
  proposals: M3RemediationProposalSetInput,
): M3RemediationValidationResult;
export function validateM3RemediationProposalSet(
  proposals: M3RemediationProposalSetInput,
  experiment: M3FailedExperimentInput,
): M3RemediationValidationResult;
export function validateM3RemediationProposalSet(
  first: M3FailedExperimentInput | M3RemediationProposalSetInput,
  second: M3FailedExperimentInput | M3RemediationProposalSetInput,
): M3RemediationValidationResult {
  const experiment =
    isRecord(first) && "source_gate" in first
      ? (first as M3FailedExperimentInput)
      : (second as M3FailedExperimentInput);
  const proposalsInput =
    isRecord(first) && "source_gate" in first
      ? (second as M3RemediationProposalSetInput)
      : (first as M3RemediationProposalSetInput);
  const issues: M3RemediationValidationIssue[] = [];
  const expected = expectedMappings(experiment, issues);
  const expectedBlockers = extractExpectedBlockers(
    experiment,
    expected,
    issues,
  );
  const expectedScenarioBlockers = scenarioScopedBlockers(
    expectedBlockers,
    expected,
  );
  const blockedRun =
    experiment.summary?.readiness_decision === "BLOCKED" ||
    experiment.source_gate?.promotion_ready === false ||
    experiment.source_gate?.status === "BLOCKED";
  if (!blockedRun)
    issues.push({
      code: "failed_experiment_not_blocked",
      detail:
        "The remediation validator requires the current fail-closed blocked experiment.",
    });
  const proposals = proposalList(proposalsInput);
  const suppliedScenarioIds = proposals.map((proposal) => proposal.scenario_id);
  const expectedSet = new Set<string>(M3_NON_TRANSFER_SEED_SCENARIO_IDS);
  if (
    proposals.length !== M3_NON_TRANSFER_SEED_SCENARIO_IDS.length ||
    new Set(suppliedScenarioIds).size !==
      M3_NON_TRANSFER_SEED_SCENARIO_IDS.length ||
    !M3_NON_TRANSFER_SEED_SCENARIO_IDS.every((id) =>
      suppliedScenarioIds.includes(id),
    )
  )
    issues.push({
      code: "scenario_set_mismatch",
      detail:
        "Exactly one proposal is required for each of the nine non-transfer M3 scenarios.",
    });
  const seenProposalIds = new Set<string>();
  const seenScenarioIds = new Set<string>();
  const covered: M3CoveredSourceBlocker[] = [];
  const classifications: M3RemediationClassification[] = [];
  for (const proposal of proposals) {
    if (seenScenarioIds.has(proposal.scenario_id))
      issues.push({
        code: "duplicate_scenario_id",
        detail: `Scenario ${proposal.scenario_id} has more than one proposal.`,
        scenario_id: proposal.scenario_id,
        proposal_id: proposal.proposal_id,
      });
    seenScenarioIds.add(proposal.scenario_id);
    if (seenProposalIds.has(proposal.proposal_id))
      issues.push({
        code: "duplicate_proposal_id",
        detail: `Proposal ID ${proposal.proposal_id} is duplicated.`,
        scenario_id: proposal.scenario_id,
        proposal_id: proposal.proposal_id,
      });
    seenProposalIds.add(proposal.proposal_id);
    if (
      !expectedSet.has(proposal.scenario_id) &&
      proposal.scenario_id === TRANSFER_SCENARIO_ID
    )
      issues.push({
        code: "scenario_not_in_non_transfer_seed_set",
        detail:
          "JP-XFR-002 requires its separate human second review and is excluded.",
        scenario_id: proposal.scenario_id,
        proposal_id: proposal.proposal_id,
      });
    const proposalCovered = validateProposal(
      proposal,
      expected,
      expectedBlockers,
      expectedScenarioBlockers,
      issues,
      blockedRun,
    );
    covered.push(...proposalCovered);
    classifications.push(classifyM3RemediationProposal(proposal));
  }
  const coveredKeys = new Set(covered.map(tupleKey));
  for (const tuple of expectedBlockers)
    if (!coveredKeys.has(tupleKey(tuple))) {
      const { source_id, code } = tupleParts(tuple);
      issues.push({
        code: "covered_blocker_missing",
        detail: `No proposal covers current blocker ${source_id}/${code}.`,
        source_id,
        blocker_code: code,
      });
    }
  const coveredScenarioBlockers = covered.flatMap((tuple) => {
    const { source_id, code } = tupleParts(tuple);
    return proposals
      .filter((proposal) =>
        coveredTuples(proposal).some(
          (coveredTuple) => tupleKey(coveredTuple) === tupleKey(tuple),
        ),
      )
      .map((proposal) => ({
        scenario_id: proposal.scenario_id,
        source_id,
        code,
      }));
  });
  const uniqueCoveredScenarioBlockers = [
    ...new Map(
      coveredScenarioBlockers.map((tuple) => [scenarioTupleKey(tuple), tuple]),
    ).values(),
  ].sort(
    (left, right) =>
      left.scenario_id.localeCompare(right.scenario_id) ||
      left.source_id.localeCompare(right.source_id) ||
      left.code.localeCompare(right.code),
  );
  const coveredScenarioKeys = new Set(
    uniqueCoveredScenarioBlockers.map(scenarioTupleKey),
  );
  for (const tuple of expectedScenarioBlockers) {
    if (coveredScenarioKeys.has(scenarioTupleKey(tuple))) continue;
    issues.push({
      code: "covered_blocker_missing",
      detail: `No proposal covers scenario-scoped blocker ${tuple.scenario_id}/${tuple.source_id}/${tuple.code}.`,
      scenario_id: tuple.scenario_id,
      source_id: tuple.source_id,
      blocker_code: tuple.code,
    });
  }
  const uniqueCovered = sortedTuples([
    ...new Map(covered.map((tuple) => [tupleKey(tuple), tuple])).values(),
  ]);
  const summary = buildSummary(
    issues.length === 0,
    suppliedScenarioIds,
    expectedBlockers,
    expectedScenarioBlockers,
    uniqueCovered,
    uniqueCoveredScenarioBlockers,
    classifications,
  );
  return {
    valid: issues.length === 0,
    expected_scenario_ids: [...M3_NON_TRANSFER_SEED_SCENARIO_IDS],
    supplied_scenario_ids: [...suppliedScenarioIds],
    expected_blockers: expectedBlockers,
    expected_scenario_scoped_blockers: expectedScenarioBlockers,
    covered_blockers: uniqueCovered,
    covered_scenario_scoped_blockers: uniqueCoveredScenarioBlockers,
    uncovered_blockers: summary.uncovered_blockers,
    uncovered_scenario_scoped_blockers:
      summary.uncovered_scenario_scoped_blockers,
    issues,
    blockers: issues,
    summary,
    promotion_blocked: true,
    promotion_ready: false,
    human_approval: false,
    gate_override: false,
  };
}

export function summarizeM3RemediationProposalSet(
  experiment: M3FailedExperimentInput,
  proposals: M3RemediationProposalSetInput,
): M3RemediationSummary {
  return validateM3RemediationProposalSet(experiment, proposals).summary;
}

export const summarizeM3Remediation = summarizeM3RemediationProposalSet;
export const classifyM3Remediation = classifyM3RemediationProposal;
