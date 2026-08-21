/**
 * The immutable, structural contract for the M7 challenge-track plan.
 *
 * This module intentionally describes planning metadata only.  It has no
 * evidence, calculation, review, or golden-fixture promotion surface.
 */

export const CHALLENGE_COVERAGE_VERSION = "0.3.0" as const;
export const CHALLENGE_COVERAGE_RESEARCH_CUTOFF = "2026-08-17" as const;

export type ChallengeCoverageVersion = typeof CHALLENGE_COVERAGE_VERSION;
export type ChallengeCoverageResearchCutoff =
  typeof CHALLENGE_COVERAGE_RESEARCH_CUTOFF;

export const CHALLENGE_COVERAGE_LEVELS = Object.freeze([
  "L1_SINGLE_RULE",
  "L2_STACKING",
  "L3_ADVERSARIAL",
] as const);
export type ChallengeCoverageLevel = (typeof CHALLENGE_COVERAGE_LEVELS)[number];

export const CHALLENGE_COVERAGE_CATEGORIES = Object.freeze([
  "CVS",
  "DRG",
  "SUP",
  "FNB",
  "ELE",
  "ECOM",
  "RET",
  "TRV",
  "QR",
  "CMP",
  "XFR",
] as const);
export type ChallengeCoverageCategory =
  (typeof CHALLENGE_COVERAGE_CATEGORIES)[number];

export const CHALLENGE_COVERAGE_RELEASE_TRACKS = Object.freeze([
  "alpha_convenience",
  "alpha_support",
  "continuous_quality_track",
] as const);
export type ChallengeCoverageReleaseTrack =
  (typeof CHALLENGE_COVERAGE_RELEASE_TRACKS)[number];

export const CHALLENGE_COVERAGE_STATUSES = Object.freeze([
  "planned",
  "candidate",
  "golden",
] as const);
export type ChallengeCoverageStatus =
  (typeof CHALLENGE_COVERAGE_STATUSES)[number];

export const CHALLENGE_COVERAGE_REVIEW_MODES = Object.freeze([
  "solo_dual_pass",
  "agent_challenged",
  "human_second_review",
  "expert_review",
] as const);
export type ChallengeCoverageReviewMode =
  (typeof CHALLENGE_COVERAGE_REVIEW_MODES)[number];

export const CHALLENGE_COVERAGE_LEVEL_TOTALS = Object.freeze({
  L1_SINGLE_RULE: 40,
  L2_STACKING: 40,
  L3_ADVERSARIAL: 20,
} as const);

export const CHALLENGE_COVERAGE_CATEGORY_TOTALS = Object.freeze({
  CVS: 15,
  DRG: 10,
  SUP: 10,
  FNB: 10,
  ELE: 8,
  ECOM: 12,
  RET: 5,
  TRV: 5,
  QR: 8,
  CMP: 10,
  XFR: 7,
} as const);

export const CHALLENGE_COVERAGE_TOTAL = 100 as const;

export const CHALLENGE_COVERAGE_GOLDEN_GATE = Object.freeze([
  "Capture immutable evidence from every primary source using an approved or manual method.",
  "Calculate every candidate plan independently before viewing engine output.",
  "Record operation-level ledgers, asset balance deltas, winner or conditional winners, rejected alternatives, and negative assertions.",
  "Complete an allowed review mode; solo work must use dual-pass calculation and a cooling-off reread.",
] as const);

export const CHALLENGE_COVERAGE_STATUS_MEANING = Object.freeze({
  planned: "Research has not yet produced a verified expected result.",
  candidate: "Evidence and a draft calculation exist.",
  golden:
    "Approved under a recorded review mode. Solo dual-pass is not represented as independent human review.",
} as const);

export const CHALLENGE_COVERAGE_PURPOSE =
  "Coverage-balanced research queue for 100 evidence-backed scenarios. The 100-fixture program is a continuous quality track, not a gate for a narrow alpha." as const;

export const CHALLENGE_COVERAGE_ALPHA_SCOPE =
  "Tokyo convenience-store chains plus a limited wallet/card set" as const;
export const CHALLENGE_COVERAGE_ALPHA_GATE =
  "All alpha_convenience and selected alpha_support scenarios touching shipped features must be reviewed; the remaining scenarios continue as a background quality track." as const;

/** The ten optional first-batch seed IDs from the M3 blueprint. */
export const CHALLENGE_COVERAGE_SEED_SCENARIO_IDS = Object.freeze([
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
] as const);

export const CHALLENGE_COVERAGE_TOP_LEVEL_FIELDS = Object.freeze([
  "version",
  "research_cutoff",
  "purpose",
  "distribution",
  "status_meaning",
  "scenarios",
  "release_policy",
] as const);

export const CHALLENGE_COVERAGE_ENTRY_FIELDS = Object.freeze([
  "scenario_id",
  "category",
  "title",
  "target",
  "level",
  "behavior_under_test",
  "primary_source_ids",
  "required_negative_assertion",
  "status",
  "golden_gate",
  "contract_features",
  "release_track",
  "required_domain_features",
] as const);

export const CHALLENGE_COVERAGE_DISTRIBUTION_FIELDS = Object.freeze([
  "total",
  "by_level",
  "by_category",
] as const);

export const CHALLENGE_COVERAGE_RELEASE_POLICY_FIELDS = Object.freeze([
  "alpha_scope",
  "alpha_gate",
  "review_modes",
] as const);

export interface ChallengeCoverageDistribution {
  readonly total: number;
  readonly by_level: Readonly<Record<ChallengeCoverageLevel, number>>;
  readonly by_category: Readonly<Record<ChallengeCoverageCategory, number>>;
}

export interface ChallengeCoverageStatusMeaning {
  readonly planned: string;
  readonly candidate: string;
  readonly golden: string;
}

export interface ChallengeCoverageScenario {
  readonly scenario_id: string;
  readonly category: ChallengeCoverageCategory;
  readonly title: string;
  readonly target: string;
  readonly level: ChallengeCoverageLevel;
  readonly behavior_under_test: string;
  readonly primary_source_ids: readonly string[];
  readonly required_negative_assertion: string;
  readonly status: ChallengeCoverageStatus;
  readonly golden_gate: readonly string[];
  readonly contract_features: readonly string[];
  readonly release_track: ChallengeCoverageReleaseTrack;
  readonly required_domain_features: readonly string[];
}

export interface ChallengeCoverageReleasePolicy {
  readonly alpha_scope: string;
  readonly alpha_gate: string;
  readonly review_modes: readonly ChallengeCoverageReviewMode[];
}

export interface ChallengeCoveragePlan {
  readonly version: ChallengeCoverageVersion;
  readonly research_cutoff: ChallengeCoverageResearchCutoff;
  readonly purpose: string;
  readonly distribution: ChallengeCoverageDistribution;
  readonly status_meaning: ChallengeCoverageStatusMeaning;
  readonly scenarios: readonly ChallengeCoverageScenario[];
  readonly release_policy: ChallengeCoverageReleasePolicy;
}

export type ChallengeCoverageSha256 = `sha256:${string}`;

/** A canonical, deeply frozen admission snapshot. */
export interface AdmittedChallengeCoveragePlan {
  readonly value: Readonly<ChallengeCoveragePlan>;
  readonly canonical_json: string;
  readonly sha256: ChallengeCoverageSha256;
}

export interface ChallengeCoverageAdmissionOptions {
  /** If provided, every declared source ID must resolve in this collection. */
  readonly knownSourceIds?: Iterable<string>;
  /** Require these scenario IDs to occur in the plan. */
  readonly requiredSeedIds?: Iterable<string>;
  /** Alias accepted for callers that call the list simply `seedIds`. */
  readonly seedIds?: Iterable<string>;
  /** Alias accepted for callers that use the domain name. */
  readonly seedScenarioIds?: Iterable<string>;
  /** `true` requires the canonical ten M3 seed IDs. */
  readonly requireSeedIds?: boolean | Iterable<string>;
}

export type ChallengeCoverageIssueCode =
  | "invalid_input"
  | "invalid_yaml"
  | "unsafe_object"
  | "proxy_not_allowed"
  | "accessor_not_allowed"
  | "non_enumerable_property"
  | "symbol_property"
  | "non_plain_object"
  | "cyclic_value"
  | "unsupported_value"
  | "unknown_field"
  | "missing_field"
  | "invalid_type"
  | "invalid_value"
  | "invalid_version"
  | "invalid_research_cutoff"
  | "invalid_distribution"
  | "distribution_mismatch"
  | "invalid_scenario_id"
  | "scenario_category_mismatch"
  | "duplicate_scenario_id"
  | "invalid_category"
  | "invalid_level"
  | "invalid_release_track"
  | "invalid_status"
  | "golden_status_not_allowed"
  | "invalid_source_ids"
  | "duplicate_source_id"
  | "unknown_source_id"
  | "invalid_feature_ids"
  | "duplicate_feature_id"
  | "invalid_negative_assertion"
  | "invalid_golden_gate"
  | "invalid_status_meaning"
  | "invalid_release_policy"
  | "invalid_seed_ids"
  | "missing_seed_id";

export interface ChallengeCoverageIssue {
  readonly code: ChallengeCoverageIssueCode;
  readonly path: string;
}

export class ChallengeCoverageValidationError extends Error {
  readonly code = "challenge_coverage_admission_denied" as const;
  readonly issues: readonly ChallengeCoverageIssue[];
  readonly first_issue: ChallengeCoverageIssue;

  constructor(issues: readonly ChallengeCoverageIssue[]) {
    const fallback: ChallengeCoverageIssue = {
      code: "invalid_input",
      path: "/",
    };
    const stable: readonly ChallengeCoverageIssue[] =
      issues.length > 0 ? issues : [fallback];
    super(
      `CHALLENGE_COVERAGE_ADMISSION_DENIED:${stable
        .map((issue) => `${issue.code}@${issue.path}`)
        .join(",")}`,
    );
    this.name = "ChallengeCoverageValidationError";
    this.issues = Object.freeze(
      stable.map((issue) => Object.freeze({ ...issue })),
    );
    this.first_issue = this.issues[0] as ChallengeCoverageIssue;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface ChallengeCoverageAdmissionDenied {
  readonly ok: false;
  readonly denial: Readonly<{
    readonly code: "challenge_coverage_admission_denied";
    readonly issues: readonly ChallengeCoverageIssue[];
  }>;
}

export interface ChallengeCoverageAdmissionAccepted {
  readonly ok: true;
  readonly snapshot: AdmittedChallengeCoveragePlan;
}

export type ChallengeCoverageAdmissionResult =
  | ChallengeCoverageAdmissionAccepted
  | ChallengeCoverageAdmissionDenied;
