/**
 * Pure Milestone 3 promotion gate.
 *
 * This module deliberately models the evidence/review state at the fixture
 * boundary instead of importing the contracts package's M3 work.  A record
 * may therefore be planned or researched while its later artifacts are still
 * absent.  The absence is reported as a blocker, never silently filled in.
 */

export const M3_SEED_SCENARIO_IDS = [
  "JP-CVS-002",
  "JP-CVS-006",
  "JP-CVS-014",
  "JP-QR-007",
  "JP-QR-008",
  "JP-CMP-003",
  "JP-CMP-007",
  "JP-CMP-009",
  "JP-XFR-002",
  "JP-ECOM-012",
] as const;

export type M3SeedScenarioId = (typeof M3_SEED_SCENARIO_IDS)[number];

/**
 * Authoritative source declarations copied from the ten-seed blueprint.  The
 * gate never accepts a caller-supplied source list as a replacement for this
 * mapping; source-readiness and evidence must cover these exact IDs.
 */
export const M3_AUTHORITATIVE_PRIMARY_SOURCE_IDS: Readonly<
  Record<M3SeedScenarioId, readonly string[]>
> = {
  "JP-CVS-002": ["merchant.seveneleven.payment-methods"],
  "JP-CVS-006": [
    "merchant.seveneleven.nanaco",
    "jp.nanaco.redemption-value",
    "jp.nanaco.sevencard-earning",
    "jp.nanaco.shopping-earning",
    "jp.sevencard.nanaco-charge",
  ],
  "JP-CVS-014": [
    "jp.smbc.eligible-merchant-rewards",
    "jp.smbc.vpoint-up-program",
  ],
  "JP-QR-007": [
    "jp.dpoint.campaign-example-funding-exclusion",
    "jp.dcard.exclusions",
  ],
  "JP-QR-008": [
    "jp.paypay.third-party-card-voucher",
    "jp.paypay.eligibility-faq",
    "jp.paypay.calculation-faq",
  ],
  "JP-CMP-003": ["jp.paypay.campaigns", "jp.dbarai.campaigns"],
  "JP-CMP-007": ["jp.paypay.campaigns", "jp.aupay.campaigns"],
  "JP-CMP-009": ["jp.rakutenpay.change-notice-2026"],
  "JP-XFR-002": ["jp.ana.rakuten-transfer"],
  "JP-ECOM-012": [
    "merchant.amazonjp.points-terms",
    "jp.rebates.guide",
    "merchant.yahoo-shopping.paypay-points",
  ],
};

export interface M3ScenarioSourceReadiness {
  scenario_id: string;
  source_ids: readonly string[];
  promotion_ready: boolean;
  promotion_blockers: readonly unknown[];
}

/** Structural subset of the contracts source-gate result. */
export interface M3SourceGateResultInput {
  promotion_ready: boolean;
  scenario_readiness: readonly M3ScenarioSourceReadiness[];
  promotion_blockers: readonly unknown[];
}

export type M3ScenarioStatus =
  | "planned"
  | "researched"
  | "calculated"
  | "reviewed"
  | "golden"
  // These aliases let a gate result describe a schema-shaped record without
  // treating a candidate/under-review record as golden.
  | "candidate"
  | "under_review"
  | "to_be_researched"
  | "superseded"
  | "retired";

export type M3ReviewMode =
  | "solo_dual_pass"
  | "agent_challenged"
  | "human_second_review"
  | "expert_review";

export type M3EvidenceStatus =
  | "captured"
  | "extracted"
  | "verified"
  | "rejected"
  | "superseded";

export interface M3EvidenceReference {
  evidence_id: string;
  /** This must be asserted by the canonical capture/review workflow. */
  first_party: boolean;
  status: M3EvidenceStatus;
  /** A captured item can be accepted only when its review decision is approved. */
  review_decision?: "pending" | "approved" | "rejected" | "needs_more_evidence";
  source_id?: string;
}

export type M3IndependentCalculationStatus = "pending" | "completed" | "failed";

export interface M3IndependentCalculationArtifact {
  artifact_id: string;
  status: M3IndependentCalculationStatus;
  completed_at: string;
  /** "engine" is intentionally not an independent calculation method. */
  method:
    | "manual"
    | "spreadsheet"
    | "independent_script"
    | "independent"
    | "engine";
  /** Every candidate must be covered by the independent artifact. */
  plan_ids: readonly string[];
}

export type M3EngineReplayStatus = "not_run" | "passed" | "failed";

export interface M3EngineReplay {
  replay_id: string;
  status: M3EngineReplayStatus;
  completed_at: string;
  result_plan_ids: readonly string[];
}

export interface M3CandidatePlan {
  plan_id: string;
  /** The actual candidate plan is intentionally opaque to this pure gate. */
  candidate?: unknown;
}

export interface M3PlanResult {
  plan_id: string;
  result_artifact_id: string;
  replay_id: string;
  /**
   * Engine results are produced after candidate admission.  A preflight
   * result is the deterministic, accountable outcome for a candidate rejected
   * at the prerequisite boundary; it must still be paired with that candidate
   * and included in the replay coverage set.
   */
  produced_by: "engine" | "preflight";
  /** Required exactly when produced_by is "preflight". */
  preflight_rejection?: {
    eligible: false;
    rejection_code: string;
    reward_calculation_performed: false;
  };
}

export type M3CheckStatus = "not_run" | "passed" | "failed";

export interface M3ArtifactCheck {
  artifact_id: string;
  status: M3CheckStatus;
  checked_at: string;
}

export interface M3NegativeAssertion {
  assertion_id: string;
  status: M3CheckStatus;
  checked_at: string;
  artifact_id: string;
}

export interface M3ReviewEvent {
  mode: M3ReviewMode;
  reviewer_id: string;
  completed_at: string;
  decision: "approved" | "rejected" | "needs_more_evidence";
  notes: string;
}

export interface M3Review {
  /** Required policy is checked against the seed id, not trusted from this field. */
  required_review_modes?: readonly M3ReviewMode[];
  /** The final label must describe the last required accountable pass. */
  review_mode?: M3ReviewMode;
  calculated_by?: string;
  decision?: "pending" | "approved" | "rejected" | "needs_more_evidence";
  review_events?: readonly M3ReviewEvent[];
}

/**
 * A deliberately partial record: early M3 states are valid without later
 * artifacts.  The gate still returns all missing-artifact blockers for them.
 */
export interface M3ScenarioRecord {
  scenario_id: string;
  status: M3ScenarioStatus;
  /** First-party source declarations that the evidence set must cover. */
  primary_source_ids: readonly string[];
  evidence_ids?: readonly string[];
  evidence?: readonly M3EvidenceReference[];
  candidate_plans?: readonly M3CandidatePlan[];
  plan_results?: readonly M3PlanResult[];
  independent_calculation?: M3IndependentCalculationArtifact;
  engine_replay?: M3EngineReplay;
  required_negative_assertions?: readonly string[];
  negative_assertions?: readonly M3NegativeAssertion[];
  conservation?: M3ArtifactCheck;
  /** CI replay after calculation/reconciliation. */
  replay?: M3ArtifactCheck;
  builder_id?: string;
  primary_reviewer_id?: string;
  review?: M3Review;
}

export type M3GateBlockerCode =
  | "scenario_id_not_in_seed_set"
  | "seed_set_mismatch"
  | "scenario_status_invalid"
  | "missing_evidence"
  | "missing_primary_source_ids"
  | "primary_source_ids_invalid"
  | "primary_source_set_mismatch"
  | "evidence_source_id_missing"
  | "evidence_source_id_unexpected"
  | "primary_source_uncovered"
  | "evidence_reference_missing"
  | "evidence_reference_mismatch"
  | "evidence_not_first_party"
  | "evidence_not_approved_or_verified"
  | "evidence_id_invalid"
  | "missing_independent_calculation"
  | "independent_calculation_incomplete"
  | "independent_calculation_not_independent"
  | "independent_calculation_plan_coverage_missing"
  | "missing_engine_replay"
  | "engine_replay_failed"
  | "engine_replay_before_independent_calculation"
  | "candidate_plans_missing"
  | "candidate_plan_ids_invalid"
  | "plan_result_pairing_missing"
  | "plan_result_invalid"
  | "required_negative_assertions_missing"
  | "negative_assertion_unsatisfied"
  | "negative_assertion_artifact_missing"
  | "conservation_check_missing"
  | "conservation_check_failed"
  | "replay_check_missing"
  | "replay_check_failed"
  | "review_policy_missing"
  | "review_policy_mismatch"
  | "review_decision_not_approved"
  | "required_review_mode_missing"
  | "review_event_invalid"
  | "review_order_invalid"
  | "review_label_not_honest"
  | "review_accountability_missing"
  | "transfer_reviewer_not_independent"
  | "agent_challenge_not_independent"
  | "source_readiness_missing"
  | "source_readiness_scenario_mismatch"
  | "source_readiness_source_set_mismatch"
  | "source_readiness_not_ready"
  | "source_readiness_blocked"
  | "source_gate_missing"
  | "source_gate_not_ready"
  | "source_gate_blocked"
  | "source_gate_scenario_set_mismatch"
  | "source_gate_scenario_readiness_missing"
  | "status_not_promotable";

export interface M3GateBlocker {
  code: M3GateBlockerCode;
  scenario_id: string;
  message: string;
}

export interface M3ScenarioGateResult {
  scenario_id: string;
  observed_status: M3ScenarioStatus | string;
  /** The input record remains representable even when promotion is blocked. */
  state_valid: boolean;
  can_promote_to_golden: boolean;
  /** Camel-case aliases make the result convenient for TypeScript callers. */
  canPromoteToGolden: boolean;
  eligible_for_golden: boolean;
  safe_status: M3ScenarioStatus | string;
  required_review_modes: readonly M3ReviewMode[];
  blockers: readonly M3GateBlocker[];
}

export interface M3SeedPromotionGateResult {
  expected_scenario_ids: readonly M3SeedScenarioId[];
  supplied_scenario_ids: readonly string[];
  seed_set_valid: boolean;
  can_promote_all: boolean;
  scenarios: readonly M3ScenarioGateResult[];
  blockers: readonly M3GateBlocker[];
}

const TRANSFER_SCENARIO_ID = "JP-XFR-002" as const;

const REQUIRED_REVIEW_MODES: Readonly<
  Record<M3SeedScenarioId, readonly M3ReviewMode[]>
> = {
  "JP-XFR-002": ["human_second_review"],
  "JP-CVS-002": ["solo_dual_pass", "agent_challenged"],
  "JP-CVS-006": ["solo_dual_pass", "agent_challenged"],
  "JP-CVS-014": ["solo_dual_pass", "agent_challenged"],
  "JP-QR-007": ["solo_dual_pass", "agent_challenged"],
  "JP-QR-008": ["solo_dual_pass", "agent_challenged"],
  "JP-CMP-003": ["solo_dual_pass", "agent_challenged"],
  "JP-CMP-007": ["solo_dual_pass", "agent_challenged"],
  "JP-CMP-009": ["solo_dual_pass", "agent_challenged"],
  "JP-ECOM-012": ["solo_dual_pass", "agent_challenged"],
};

const KNOWN_STATUSES: readonly M3ScenarioStatus[] = [
  "planned",
  "researched",
  "calculated",
  "reviewed",
  "golden",
  "candidate",
  "under_review",
  "to_be_researched",
  "superseded",
  "retired",
];

const isSeedScenarioId = (value: string): value is M3SeedScenarioId =>
  (M3_SEED_SCENARIO_IDS as readonly string[]).includes(value);

const isKnownStatus = (value: string): value is M3ScenarioStatus =>
  (KNOWN_STATUSES as readonly string[]).includes(value);

const isValidIdentifier = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

function addBlocker(
  blockers: M3GateBlocker[],
  code: M3GateBlockerCode,
  scenarioId: string,
  message: string,
): void {
  blockers.push({ code, scenario_id: scenarioId, message });
}

function duplicateValues(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].sort();
}

function sameStringSet(
  left: readonly string[],
  right: readonly string[],
): boolean {
  if (duplicateValues(left).length > 0 || duplicateValues(right).length > 0) {
    return false;
  }
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((value) => rightSet.has(value));
}

function parseTimestamp(value: string | undefined): number | null {
  if (!isValidIdentifier(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function requiredModesFor(scenarioId: string): readonly M3ReviewMode[] {
  return isSeedScenarioId(scenarioId) ? REQUIRED_REVIEW_MODES[scenarioId] : [];
}

function authoritativeSourceIdsFor(scenarioId: string): readonly string[] {
  return isSeedScenarioId(scenarioId)
    ? M3_AUTHORITATIVE_PRIMARY_SOURCE_IDS[scenarioId]
    : [];
}

/** Return the immutable review policy selected for one seed scenario. */
export function requiredM3ReviewModes(
  scenarioId: string,
): readonly M3ReviewMode[] {
  return [...requiredModesFor(scenarioId)];
}

function checkScenarioSourceReadiness(
  record: M3ScenarioRecord,
  sourceReadiness: M3ScenarioSourceReadiness | undefined,
  blockers: M3GateBlocker[],
): void {
  const scenarioId = record.scenario_id;
  const authoritativeSourceIds = authoritativeSourceIdsFor(scenarioId);
  if (!sameStringSet(record.primary_source_ids ?? [], authoritativeSourceIds)) {
    addBlocker(
      blockers,
      "primary_source_set_mismatch",
      scenarioId,
      "Scenario primary_source_ids must exactly match the seed blueprint mapping.",
    );
  }
  if (!sourceReadiness) {
    addBlocker(
      blockers,
      "source_readiness_missing",
      scenarioId,
      "A source-readiness result is required before scenario promotion.",
    );
    return;
  }
  if (sourceReadiness.scenario_id !== scenarioId) {
    addBlocker(
      blockers,
      "source_readiness_scenario_mismatch",
      scenarioId,
      `Source-readiness result is for ${sourceReadiness.scenario_id}, not ${scenarioId}.`,
    );
  }
  if (!sameStringSet(sourceReadiness.source_ids, authoritativeSourceIds)) {
    addBlocker(
      blockers,
      "source_readiness_source_set_mismatch",
      scenarioId,
      "Source-readiness source_ids must exactly match the seed blueprint mapping.",
    );
  }
  if (sourceReadiness.promotion_ready !== true) {
    addBlocker(
      blockers,
      "source_readiness_not_ready",
      scenarioId,
      "Source readiness is not promotion-ready.",
    );
  }
  if (!Array.isArray(sourceReadiness.promotion_blockers)) {
    addBlocker(
      blockers,
      "source_readiness_blocked",
      scenarioId,
      "Source-readiness promotion blockers must be present and empty.",
    );
  } else if (sourceReadiness.promotion_blockers.length > 0) {
    addBlocker(
      blockers,
      "source_readiness_blocked",
      scenarioId,
      "Source readiness contains promotion blockers.",
    );
  }
}

/**
 * Validate the exact M3 seed set.  Order is intentionally irrelevant; duplicate
 * and extra IDs are still rejected.
 */
export function validateM3SeedScenarioIds(
  scenarioIds: readonly string[],
): readonly M3GateBlocker[] {
  const blockers: M3GateBlocker[] = [];
  const expected = new Set<string>(M3_SEED_SCENARIO_IDS);
  const supplied = [...scenarioIds];
  const duplicates = duplicateValues(supplied);

  if (duplicates.length > 0) {
    addBlocker(
      blockers,
      "seed_set_mismatch",
      "__m3_seed_set__",
      `Duplicate seed scenario id(s): ${duplicates.join(", ")}.`,
    );
  }

  const missing = M3_SEED_SCENARIO_IDS.filter((id) => !supplied.includes(id));
  const extra = supplied.filter((id) => !expected.has(id));
  if (
    missing.length > 0 ||
    extra.length > 0 ||
    supplied.length !== expected.size
  ) {
    const details = [
      missing.length > 0 ? `missing ${missing.join(", ")}` : "",
      extra.length > 0 ? `unexpected ${extra.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join("; ");
    addBlocker(
      blockers,
      "seed_set_mismatch",
      "__m3_seed_set__",
      `Expected exactly the ten M3 seed scenario IDs (${details || "size mismatch"}).`,
    );
  }

  return blockers;
}

function checkEvidence(
  record: M3ScenarioRecord,
  scenarioId: string,
  blockers: M3GateBlocker[],
): void {
  const primarySourceIds = record.primary_source_ids ?? [];
  if (primarySourceIds.length === 0) {
    addBlocker(
      blockers,
      "missing_primary_source_ids",
      scenarioId,
      "At least one declared first-party primary source id is required.",
    );
  }
  if (
    primarySourceIds.some((sourceId) => !isValidIdentifier(sourceId)) ||
    duplicateValues(primarySourceIds).length > 0
  ) {
    addBlocker(
      blockers,
      "primary_source_ids_invalid",
      scenarioId,
      "Primary source ids must be non-empty and unique.",
    );
  }
  const primarySourceSet = new Set(
    primarySourceIds.filter((sourceId) => isValidIdentifier(sourceId)),
  );
  const evidenceIds = record.evidence_ids ?? [];
  const evidence = record.evidence ?? [];
  if (evidenceIds.length === 0 || evidence.length === 0) {
    addBlocker(
      blockers,
      "missing_evidence",
      scenarioId,
      "At least one explicitly referenced evidence record is required.",
    );
    return;
  }

  if (duplicateValues(evidenceIds).length > 0) {
    addBlocker(
      blockers,
      "evidence_reference_mismatch",
      scenarioId,
      "Evidence references must be unique.",
    );
  }

  const evidenceById = new Map<string, M3EvidenceReference>();
  for (const item of evidence) {
    if (!isValidIdentifier(item.evidence_id)) {
      addBlocker(
        blockers,
        "evidence_id_invalid",
        scenarioId,
        "Every evidence item needs a non-empty evidence_id.",
      );
      continue;
    }
    if (evidenceById.has(item.evidence_id)) {
      addBlocker(
        blockers,
        "evidence_reference_mismatch",
        scenarioId,
        `Evidence id ${item.evidence_id} appears more than once.`,
      );
    }
    evidenceById.set(item.evidence_id, item);
  }

  const missing = evidenceIds.filter((id) => !evidenceById.has(id));
  const extra = [...evidenceById.keys()].filter(
    (id) => !evidenceIds.includes(id),
  );
  if (missing.length > 0) {
    addBlocker(
      blockers,
      "evidence_reference_missing",
      scenarioId,
      `Referenced evidence is absent: ${missing.join(", ")}.`,
    );
  }
  if (extra.length > 0) {
    addBlocker(
      blockers,
      "evidence_reference_mismatch",
      scenarioId,
      `Evidence exists without an explicit reference: ${extra.join(", ")}.`,
    );
  }

  const acceptableEvidenceSources = new Set<string>();
  for (const item of evidenceById.values()) {
    if (!isValidIdentifier(item.source_id)) {
      addBlocker(
        blockers,
        "evidence_source_id_missing",
        scenarioId,
        `Evidence ${item.evidence_id} must name a primary source id.`,
      );
    } else if (!primarySourceSet.has(item.source_id)) {
      addBlocker(
        blockers,
        "evidence_source_id_unexpected",
        scenarioId,
        `Evidence ${item.evidence_id} names undeclared source ${item.source_id}.`,
      );
    }
    if (item.first_party !== true) {
      addBlocker(
        blockers,
        "evidence_not_first_party",
        scenarioId,
        `Evidence ${item.evidence_id} is not asserted as first-party.`,
      );
    }
    // Evidence status and review decision are separate schema fields. Both
    // must reach their approved states; `approved` is not an evidence status.
    const acceptedStatus =
      item.status === "verified" && item.review_decision === "approved";
    const explicitlyRejected =
      item.review_decision === "rejected" || item.status === "rejected";
    if (!acceptedStatus || explicitlyRejected) {
      addBlocker(
        blockers,
        "evidence_not_approved_or_verified",
        scenarioId,
        `Evidence ${item.evidence_id} must be verified with an approved review decision.`,
      );
    }
    if (
      evidenceIds.includes(item.evidence_id) &&
      isValidIdentifier(item.source_id) &&
      primarySourceSet.has(item.source_id) &&
      item.first_party === true &&
      acceptedStatus &&
      !explicitlyRejected
    ) {
      acceptableEvidenceSources.add(item.source_id);
    }
  }

  for (const sourceId of primarySourceSet) {
    if (!acceptableEvidenceSources.has(sourceId)) {
      addBlocker(
        blockers,
        "primary_source_uncovered",
        scenarioId,
        `Declared primary source ${sourceId} has no referenced acceptable evidence.`,
      );
    }
  }
}

function checkIndependentCalculation(
  record: M3ScenarioRecord,
  scenarioId: string,
  candidatePlanIds: readonly string[],
  blockers: M3GateBlocker[],
): number | null {
  const artifact = record.independent_calculation;
  if (!artifact) {
    addBlocker(
      blockers,
      "missing_independent_calculation",
      scenarioId,
      "An independent calculation artifact is required before engine replay.",
    );
    return null;
  }
  if (
    !isValidIdentifier(artifact.artifact_id) ||
    artifact.status !== "completed" ||
    parseTimestamp(artifact.completed_at) === null
  ) {
    addBlocker(
      blockers,
      "independent_calculation_incomplete",
      scenarioId,
      "The independent calculation must have an artifact id, completed status, and valid completion time.",
    );
  }
  if (
    artifact.method === "engine" ||
    !["manual", "spreadsheet", "independent_script", "independent"].includes(
      artifact.method,
    )
  ) {
    addBlocker(
      blockers,
      "independent_calculation_not_independent",
      scenarioId,
      "Engine output cannot be used as the independent calculation artifact.",
    );
  }
  const artifactPlanIds = artifact.plan_ids ?? [];
  if (!sameStringSet(artifactPlanIds, candidatePlanIds)) {
    addBlocker(
      blockers,
      "independent_calculation_plan_coverage_missing",
      scenarioId,
      "The independent calculation must cover exactly every candidate plan.",
    );
  }
  return parseTimestamp(artifact.completed_at);
}

function isValidPreflightRejection(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const payload = value as Record<string, unknown>;
  const keys = Object.keys(payload).sort();
  return (
    keys.length === 3 &&
    keys[0] === "eligible" &&
    keys[1] === "rejection_code" &&
    keys[2] === "reward_calculation_performed" &&
    payload.eligible === false &&
    isValidIdentifier(payload.rejection_code) &&
    payload.reward_calculation_performed === false
  );
}

function checkCandidatesAndResults(
  record: M3ScenarioRecord,
  scenarioId: string,
  blockers: M3GateBlocker[],
): { candidatePlanIds: readonly string[]; resultPlanIds: readonly string[] } {
  const candidates = record.candidate_plans ?? [];
  const results = record.plan_results ?? [];
  const candidatePlanIds = candidates.map((plan) => plan.plan_id);
  const resultPlanIds = results.map((result) => result.plan_id);

  if (candidates.length < 2) {
    addBlocker(
      blockers,
      "candidate_plans_missing",
      scenarioId,
      "At least two candidate plans are required for a promotion fixture.",
    );
  }
  if (
    candidatePlanIds.some((id) => !isValidIdentifier(id)) ||
    duplicateValues(candidatePlanIds).length > 0
  ) {
    addBlocker(
      blockers,
      "candidate_plan_ids_invalid",
      scenarioId,
      "Candidate plan ids must be non-empty and unique.",
    );
  }
  if (!sameStringSet(candidatePlanIds, resultPlanIds)) {
    addBlocker(
      blockers,
      "plan_result_pairing_missing",
      scenarioId,
      "Every candidate plan must have exactly one accountable result, with no extras.",
    );
  }

  const replayId = record.engine_replay?.replay_id;
  for (const result of results) {
    const hasPreflightRejection = Object.hasOwn(result, "preflight_rejection");
    const validProvenance =
      result.produced_by === "preflight"
        ? isValidPreflightRejection(result.preflight_rejection)
        : result.produced_by === "engine" && !hasPreflightRejection;
    if (
      !isValidIdentifier(result.plan_id) ||
      !isValidIdentifier(result.result_artifact_id) ||
      !isValidIdentifier(result.replay_id) ||
      !validProvenance ||
      (replayId !== undefined && result.replay_id !== replayId)
    ) {
      addBlocker(
        blockers,
        "plan_result_invalid",
        scenarioId,
        `Plan result ${result.plan_id || "<unknown>"} is not a paired engine or preflight result for the recorded replay.`,
      );
    }
  }
  return { candidatePlanIds, resultPlanIds };
}

function checkEngineReplay(
  record: M3ScenarioRecord,
  scenarioId: string,
  resultPlanIds: readonly string[],
  independentCompletedAt: number | null,
  blockers: M3GateBlocker[],
): number | null {
  const replay = record.engine_replay;
  if (!replay) {
    addBlocker(
      blockers,
      "missing_engine_replay",
      scenarioId,
      "An engine replay with paired results is required.",
    );
    return null;
  }
  const replayCompletedAt = parseTimestamp(replay.completed_at);
  if (replay.status !== "passed") {
    addBlocker(
      blockers,
      "engine_replay_failed",
      scenarioId,
      "The engine replay must have passed.",
    );
  }
  if (
    !isValidIdentifier(replay.replay_id) ||
    replayCompletedAt === null ||
    !sameStringSet(replay.result_plan_ids ?? [], resultPlanIds)
  ) {
    addBlocker(
      blockers,
      "plan_result_invalid",
      scenarioId,
      "Engine replay metadata must name every paired result and have a valid timestamp.",
    );
  }
  if (
    independentCompletedAt !== null &&
    replayCompletedAt !== null &&
    replayCompletedAt <= independentCompletedAt
  ) {
    addBlocker(
      blockers,
      "engine_replay_before_independent_calculation",
      scenarioId,
      "The independent calculation must be completed strictly before engine replay.",
    );
  }
  return replayCompletedAt;
}

function checkNegativeAssertions(
  record: M3ScenarioRecord,
  scenarioId: string,
  blockers: M3GateBlocker[],
): void {
  const required = record.required_negative_assertions ?? [];
  const completed = record.negative_assertions ?? [];
  if (required.length === 0) {
    addBlocker(
      blockers,
      "required_negative_assertions_missing",
      scenarioId,
      "The scenario must declare at least one required negative assertion.",
    );
    return;
  }
  const completedById = new Map<string, M3NegativeAssertion>();
  for (const assertion of completed) {
    if (isValidIdentifier(assertion.assertion_id)) {
      completedById.set(assertion.assertion_id, assertion);
    }
  }
  for (const requiredId of required) {
    const assertion = completedById.get(requiredId);
    if (!assertion) {
      addBlocker(
        blockers,
        "required_negative_assertions_missing",
        scenarioId,
        `Required negative assertion ${requiredId} has not been recorded.`,
      );
      continue;
    }
    if (!isValidIdentifier(assertion.artifact_id)) {
      addBlocker(
        blockers,
        "negative_assertion_artifact_missing",
        scenarioId,
        `Negative assertion ${requiredId} has no checking artifact.`,
      );
    }
    if (
      assertion.status !== "passed" ||
      parseTimestamp(assertion.checked_at) === null
    ) {
      addBlocker(
        blockers,
        "negative_assertion_unsatisfied",
        scenarioId,
        `Negative assertion ${requiredId} must have a passed result and valid check time.`,
      );
    }
  }
}

function checkArtifactCheck(
  check: M3ArtifactCheck | undefined,
  scenarioId: string,
  missingCode: "conservation_check_missing" | "replay_check_missing",
  failedCode: "conservation_check_failed" | "replay_check_failed",
  label: string,
  blockers: M3GateBlocker[],
): number | null {
  if (!check) {
    addBlocker(blockers, missingCode, scenarioId, `${label} is required.`);
    return null;
  }
  const checkedAt = parseTimestamp(check.checked_at);
  if (!isValidIdentifier(check.artifact_id) || check.status !== "passed") {
    addBlocker(
      blockers,
      failedCode,
      scenarioId,
      `${label} must have a passed artifact check.`,
    );
  }
  if (checkedAt === null) {
    addBlocker(
      blockers,
      failedCode,
      scenarioId,
      `${label} must have a valid check time.`,
    );
  }
  return checkedAt;
}

function checkReview(
  record: M3ScenarioRecord,
  scenarioId: string,
  engineReplayCompletedAt: number | null,
  blockers: M3GateBlocker[],
): void {
  const review = record.review;
  const requiredModes = requiredModesFor(scenarioId);
  if (!review) {
    addBlocker(
      blockers,
      "review_policy_missing",
      scenarioId,
      "A review record is required before promotion.",
    );
    return;
  }

  if (
    !review.required_review_modes ||
    review.required_review_modes.length === 0
  ) {
    addBlocker(
      blockers,
      "review_policy_missing",
      scenarioId,
      "The required review-mode policy must be recorded explicitly.",
    );
  } else if (!sameStringSet(review.required_review_modes, requiredModes)) {
    addBlocker(
      blockers,
      "review_policy_mismatch",
      scenarioId,
      `Recorded review policy does not match the seed policy: ${requiredModes.join(", ")}.`,
    );
  }

  if (review.decision !== "approved") {
    addBlocker(
      blockers,
      "review_decision_not_approved",
      scenarioId,
      "The scenario review decision must be approved.",
    );
  }

  const events = review.review_events ?? [];
  const approvedEvents = new Map<M3ReviewMode, M3ReviewEvent>();
  for (const event of events) {
    const eventTime = parseTimestamp(event.completed_at);
    if (
      !isValidIdentifier(event.reviewer_id) ||
      event.decision !== "approved" ||
      eventTime === null
    ) {
      addBlocker(
        blockers,
        "review_event_invalid",
        scenarioId,
        `Review event ${event.mode} must be approved, identified, and timestamped.`,
      );
      continue;
    }
    if (
      engineReplayCompletedAt !== null &&
      eventTime <= engineReplayCompletedAt
    ) {
      addBlocker(
        blockers,
        "review_event_invalid",
        scenarioId,
        `Review event ${event.mode} must occur after engine replay.`,
      );
    }
    if (!approvedEvents.has(event.mode)) approvedEvents.set(event.mode, event);
  }
  for (const mode of requiredModes) {
    if (!approvedEvents.has(mode)) {
      addBlocker(
        blockers,
        "required_review_mode_missing",
        scenarioId,
        `Approved ${mode} review is required.`,
      );
    }
  }

  const expectedFinalLabel =
    scenarioId === TRANSFER_SCENARIO_ID
      ? "human_second_review"
      : "agent_challenged";
  if (review.review_mode !== expectedFinalLabel) {
    addBlocker(
      blockers,
      "review_label_not_honest",
      scenarioId,
      `The final review label must be ${expectedFinalLabel}.`,
    );
  }

  const builderId = record.builder_id ?? review.calculated_by;
  const primaryReviewerId = record.primary_reviewer_id;
  if (!isValidIdentifier(builderId)) {
    addBlocker(
      blockers,
      "review_accountability_missing",
      scenarioId,
      "A builder identity is required for accountable promotion.",
    );
  }

  if (scenarioId === TRANSFER_SCENARIO_ID) {
    const secondReview = approvedEvents.get("human_second_review");
    if (
      !secondReview ||
      !isValidIdentifier(builderId) ||
      !isValidIdentifier(primaryReviewerId)
    ) {
      addBlocker(
        blockers,
        "transfer_reviewer_not_independent",
        scenarioId,
        "Transfer promotion requires an identified human second reviewer and accountable identities.",
      );
    } else if (
      secondReview.reviewer_id === builderId ||
      secondReview.reviewer_id === primaryReviewerId
    ) {
      addBlocker(
        blockers,
        "transfer_reviewer_not_independent",
        scenarioId,
        "The transfer human second reviewer must differ from both builder and primary reviewer.",
      );
    }
  } else {
    const challenge = approvedEvents.get("agent_challenged");
    if (
      challenge &&
      isValidIdentifier(builderId) &&
      challenge.reviewer_id === builderId
    ) {
      addBlocker(
        blockers,
        "agent_challenge_not_independent",
        scenarioId,
        "The agent challenge must be attributable to a distinct challenger identity.",
      );
    }
    const soloPass = approvedEvents.get("solo_dual_pass");
    const soloAt = soloPass ? parseTimestamp(soloPass.completed_at) : null;
    const challengeAt = challenge
      ? parseTimestamp(challenge.completed_at)
      : null;
    if (soloAt !== null && challengeAt !== null && challengeAt <= soloAt) {
      addBlocker(
        blockers,
        "review_order_invalid",
        scenarioId,
        "The agent challenge must follow the solo dual pass.",
      );
    }
  }
}

function checkSourceGateResult(
  records: readonly M3ScenarioRecord[],
  sourceGate: M3SourceGateResultInput | undefined,
  blockers: M3GateBlocker[],
): ReadonlyMap<string, M3ScenarioSourceReadiness> {
  if (!sourceGate) {
    addBlocker(
      blockers,
      "source_gate_missing",
      "__m3_seed_set__",
      "A whole source-gate result is required before seed promotion.",
    );
    return new Map();
  }
  if (sourceGate.promotion_ready !== true) {
    addBlocker(
      blockers,
      "source_gate_not_ready",
      "__m3_seed_set__",
      "The whole source-gate result is not promotion-ready.",
    );
  }
  if (!Array.isArray(sourceGate.promotion_blockers)) {
    addBlocker(
      blockers,
      "source_gate_blocked",
      "__m3_seed_set__",
      "The whole source-gate result must provide an empty promotion_blockers list.",
    );
  } else if (sourceGate.promotion_blockers.length > 0) {
    addBlocker(
      blockers,
      "source_gate_blocked",
      "__m3_seed_set__",
      "The whole source-gate result contains promotion blockers.",
    );
  }

  const readiness = sourceGate.scenario_readiness ?? [];
  const readinessIds = readiness.map((item) => item.scenario_id);
  if (!sameStringSet(readinessIds, M3_SEED_SCENARIO_IDS)) {
    addBlocker(
      blockers,
      "source_gate_scenario_set_mismatch",
      "__m3_seed_set__",
      "Source-gate scenario_readiness must contain exactly the ten seed scenario IDs.",
    );
  }

  const firstByScenario = new Map<string, M3ScenarioSourceReadiness>();
  for (const item of readiness) {
    if (!firstByScenario.has(item.scenario_id)) {
      firstByScenario.set(item.scenario_id, item);
    }
  }
  for (const record of records) {
    if (!firstByScenario.has(record.scenario_id)) {
      addBlocker(
        blockers,
        "source_gate_scenario_readiness_missing",
        record.scenario_id,
        "The whole source-gate result has no matching scenario readiness record.",
      );
    }
  }
  return firstByScenario;
}

/** Evaluate one scenario without mutating it or throwing on incomplete M3 state. */
export function evaluateM3Scenario(
  record: M3ScenarioRecord,
  sourceReadiness: M3ScenarioSourceReadiness | undefined,
): M3ScenarioGateResult {
  const scenarioId = record.scenario_id;
  const blockers: M3GateBlocker[] = [];
  const requiredModes = requiredModesFor(scenarioId);

  if (!isSeedScenarioId(scenarioId)) {
    addBlocker(
      blockers,
      "scenario_id_not_in_seed_set",
      scenarioId,
      `Scenario id ${scenarioId || "<empty>"} is not one of the ten M3 seed ids.`,
    );
  }
  if (!isKnownStatus(record.status)) {
    addBlocker(
      blockers,
      "scenario_status_invalid",
      scenarioId,
      `Unknown scenario status ${record.status || "<empty>"}.`,
    );
  }
  if (record.status !== "reviewed" && record.status !== "golden") {
    addBlocker(
      blockers,
      "status_not_promotable",
      scenarioId,
      "Only a reviewed or already-golden scenario may be promoted.",
    );
  }

  checkScenarioSourceReadiness(record, sourceReadiness, blockers);
  checkEvidence(record, scenarioId, blockers);
  const { candidatePlanIds, resultPlanIds } = checkCandidatesAndResults(
    record,
    scenarioId,
    blockers,
  );
  const independentCompletedAt = checkIndependentCalculation(
    record,
    scenarioId,
    candidatePlanIds,
    blockers,
  );
  const engineReplayCompletedAt = checkEngineReplay(
    record,
    scenarioId,
    resultPlanIds,
    independentCompletedAt,
    blockers,
  );
  checkNegativeAssertions(record, scenarioId, blockers);
  const conservationCheckedAt = checkArtifactCheck(
    record.conservation,
    scenarioId,
    "conservation_check_missing",
    "conservation_check_failed",
    "Conservation check",
    blockers,
  );
  const replayCheckedAt = checkArtifactCheck(
    record.replay,
    scenarioId,
    "replay_check_missing",
    "replay_check_failed",
    "CI replay check",
    blockers,
  );
  checkReview(record, scenarioId, engineReplayCompletedAt, blockers);

  // Keep checks pure and deterministic while ensuring the required sequence is
  // explicit.  Review checks already enforce replay ordering; these checks make
  // malformed check timestamps visible instead of allowing a boolean to bypass
  // the artifact trail.
  if (
    engineReplayCompletedAt !== null &&
    conservationCheckedAt !== null &&
    conservationCheckedAt < engineReplayCompletedAt
  ) {
    addBlocker(
      blockers,
      "conservation_check_failed",
      scenarioId,
      "Conservation must be checked at or after engine replay.",
    );
  }
  if (
    engineReplayCompletedAt !== null &&
    replayCheckedAt !== null &&
    replayCheckedAt < engineReplayCompletedAt
  ) {
    addBlocker(
      blockers,
      "replay_check_failed",
      scenarioId,
      "CI replay must be checked at or after engine replay.",
    );
  }

  const canPromote = blockers.length === 0;
  const stateValid =
    isSeedScenarioId(scenarioId) && isKnownStatus(record.status);
  const safeStatus = canPromote
    ? "golden"
    : record.status === "golden"
      ? "under_review"
      : record.status;
  return {
    scenario_id: scenarioId,
    observed_status: record.status,
    state_valid: stateValid,
    can_promote_to_golden: canPromote,
    canPromoteToGolden: canPromote,
    eligible_for_golden: canPromote,
    safe_status: safeStatus,
    required_review_modes: [...requiredModes],
    blockers,
  };
}

/** Evaluate the whole seed batch, including the exact ten-id invariant. */
export function evaluateM3SeedSet(
  records: readonly M3ScenarioRecord[],
  sourceGate: M3SourceGateResultInput | undefined,
): M3SeedPromotionGateResult {
  const suppliedIds = records.map((record) => record.scenario_id);
  const seedSetBlockers = validateM3SeedScenarioIds(suppliedIds);
  const sourceGateBlockers: M3GateBlocker[] = [];
  const sourceReadinessByScenario = checkSourceGateResult(
    records,
    sourceGate,
    sourceGateBlockers,
  );
  const scenarios = records.map((record) =>
    evaluateM3Scenario(
      record,
      sourceReadinessByScenario.get(record.scenario_id),
    ),
  );
  const blockers = [
    ...seedSetBlockers,
    ...sourceGateBlockers,
    ...scenarios.flatMap((scenario) => scenario.blockers),
  ];
  const seedSetValid = seedSetBlockers.length === 0;
  const canPromoteAll =
    seedSetValid &&
    sourceGateBlockers.length === 0 &&
    scenarios.length === M3_SEED_SCENARIO_IDS.length &&
    scenarios.every((scenario) => scenario.can_promote_to_golden);
  return {
    expected_scenario_ids: [...M3_SEED_SCENARIO_IDS],
    supplied_scenario_ids: suppliedIds,
    seed_set_valid: seedSetValid,
    can_promote_all: canPromoteAll,
    scenarios,
    blockers,
  };
}

/**
 * Convenience overload for callers that have either one scenario or the full
 * batch.  The return shape makes the distinction explicit at runtime.
 */
export function evaluateM3PromotionGate(
  record: M3ScenarioRecord,
  sourceReadiness: M3ScenarioSourceReadiness | undefined,
): M3ScenarioGateResult;
export function evaluateM3PromotionGate(
  records: readonly M3ScenarioRecord[],
  sourceGate: M3SourceGateResultInput | undefined,
): M3SeedPromotionGateResult;
export function evaluateM3PromotionGate(
  value: M3ScenarioRecord | readonly M3ScenarioRecord[],
  sourceReadinessOrGate:
    | M3ScenarioSourceReadiness
    | M3SourceGateResultInput
    | undefined,
): M3ScenarioGateResult | M3SeedPromotionGateResult {
  return Array.isArray(value)
    ? evaluateM3SeedSet(
        value as readonly M3ScenarioRecord[],
        sourceReadinessOrGate as M3SourceGateResultInput,
      )
    : evaluateM3Scenario(
        value as M3ScenarioRecord,
        sourceReadinessOrGate as M3ScenarioSourceReadiness,
      );
}

export const evaluateM3ScenarioPromotion = evaluateM3Scenario;
export const evaluateM3SeedPromotionGate = evaluateM3SeedSet;
