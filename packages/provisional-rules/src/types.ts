import type { SourceObservation } from "@jro/agent-feed-consumer";
import type { RewardRule } from "@jro/contracts";

/** Hashes are deliberately opaque to callers; the implementation only emits SHA-256. */
export type Sha256 = `sha256:${string}`;

export const PROVISIONAL_RULE_CANDIDATE_VERSION =
  "provisional-rule-candidate.v1" as const;
export const PROVISIONAL_RULE_ENVELOPE_VERSION =
  "provisional-rule-envelope.v1" as const;
export const PROVISIONAL_CORRECTION_VERSION =
  "provisional-correction.v1" as const;

export type ProvisionalSourceAuthorityRole =
  | "primary"
  | "corroborating"
  | "conflict";

/**
 * Statuses owned by this package.  These are intentionally separate from the
 * RewardRule `status` field.  In particular, there is no approved or
 * published provisional status.
 */
export type ProvisionalRuleStatus =
  | "needs_evidence"
  | "machine_checked"
  | "active_experimental"
  | "disputed"
  | "quarantined";

export const PROVISIONAL_RULE_STATUSES = Object.freeze([
  "needs_evidence",
  "machine_checked",
  "active_experimental",
  "disputed",
  "quarantined",
] as const);

export interface ProvisionalExtractor {
  readonly name: string;
  readonly version: string;
}

export interface MachineCheckChecks {
  readonly representation_safe: boolean;
  readonly rule_structure: boolean;
  readonly rule_semantics: boolean;
  readonly observation_binding: boolean;
  readonly p0_coverage: boolean;
}

/** A caller-supplied assertion; admission recomputes every check. */
export interface MachineCheckRecord {
  readonly checker: string;
  readonly checker_version: string;
  readonly checked_at: string;
  readonly checks: MachineCheckChecks;
}

export interface ProvisionalRuleCandidate {
  readonly version: typeof PROVISIONAL_RULE_CANDIDATE_VERSION;
  readonly candidate_id?: string;
  readonly observation_id: string;
  readonly observation_fingerprint: string;
  readonly p0_family_id: string;
  readonly source_role_id: string;
  readonly source_authority_role: ProvisionalSourceAuthorityRole;
  readonly source_ids: readonly string[];
  readonly rule: RewardRule;
  readonly extractor: ProvisionalExtractor;
  readonly machine_check: MachineCheckRecord;
}

export interface P0CoverageEntry {
  readonly family_id: string;
  readonly source_role_id: string;
  readonly known_source_ids: readonly string[];
}

/**
 * The index is a caller-owned, frozen input.  Admission snapshots it before
 * use and never derives P0 coverage from the candidate or observation.
 */
export interface P0CoverageIndex {
  readonly version: string;
  readonly entries: readonly P0CoverageEntry[];
}

export interface ProvisionalRuleAdmissionRequest {
  readonly candidate: unknown;
  readonly observation: unknown;
  readonly p0_coverage_index: unknown;
}

export interface ProvisionalRuleAdmissionOptions {
  readonly observation?: unknown;
  readonly p0_coverage_index?: unknown;
}

export type AdmissionIssueCode =
  | "input_not_object"
  | "input_shape_invalid"
  | "hostile_proxy"
  | "accessor_property"
  | "non_enumerable_property"
  | "symbol_property"
  | "cyclic_value"
  | "sparse_array"
  | "unsupported_value"
  | "secret_bearing_value"
  | "input_too_large"
  | "coverage_index_not_immutable"
  | "coverage_index_invalid"
  | "coverage_family_unknown"
  | "coverage_role_mismatch"
  | "source_role_missing"
  | "source_role_invalid"
  | "source_role_id_invalid"
  | "source_role_coverage_mismatch"
  | "source_authority_mismatch"
  | "source_ids_invalid"
  | "source_unregistered"
  | "source_observation_mismatch"
  | "observation_invalid"
  | "observation_status_forbidden"
  | "observation_binding_mismatch"
  | "observation_rejected"
  | "observation_hostile"
  | "rule_invalid"
  | "rule_publication_status_forbidden"
  | "rule_review_claim_forbidden"
  | "machine_check_invalid"
  | "machine_check_mismatch"
  | "extractor_invalid"
  | "timestamp_invalid";

export interface AdmissionIssue {
  readonly code: AdmissionIssueCode;
  readonly path: string;
  readonly message: string;
}

export interface ProvisionalObservationBinding {
  readonly observation_id: string;
  readonly observation_fingerprint: string;
  readonly source_ids: readonly string[];
  readonly source_authority_claim:
    | "primary"
    | "official_secondary"
    | "third_party"
    | "unknown";
}

export interface ProvisionalTransition {
  readonly sequence: number;
  readonly from_status: ProvisionalRuleStatus | null;
  readonly to_status: ProvisionalRuleStatus;
  readonly occurred_at: string;
  readonly reason: string;
  readonly candidate_hash: Sha256;
  readonly correction_hash?: Sha256;
}

export const CORRECTION_CATEGORIES = Object.freeze([
  "not_accepted",
  "reward_missing",
  "rate_wrong",
  "campaign_ended",
  "registration_required",
  "cap_or_minimum_missing",
  "merchant_wrong",
  "product_variant_wrong",
] as const);

export type CorrectionCategory = (typeof CORRECTION_CATEGORIES)[number];

/** Security/source mismatch categories are accepted only as quarantine signals. */
export const SEVERE_CORRECTION_CATEGORIES = Object.freeze([
  "security_mismatch",
  "source_mismatch",
] as const);

export type SevereCorrectionCategory =
  (typeof SEVERE_CORRECTION_CATEGORIES)[number];

export type ProvisionalCorrectionCategory =
  | CorrectionCategory
  | SevereCorrectionCategory;

export interface CorrectionSignalInput {
  readonly version: typeof PROVISIONAL_CORRECTION_VERSION;
  readonly signal_id: string;
  readonly candidate_hash: Sha256;
  readonly category: ProvisionalCorrectionCategory;
  readonly credible: boolean;
  readonly reported_at: string;
  readonly severity?: "normal" | "severe";
}

export interface CorrectionSignalRecord extends CorrectionSignalInput {
  readonly signal_hash: Sha256;
}

export interface ProvisionalRuleEnvelope {
  readonly version: typeof PROVISIONAL_RULE_ENVELOPE_VERSION;
  readonly candidate_hash: Sha256;
  readonly definition_hash: Sha256;
  readonly status: ProvisionalRuleStatus;
  readonly candidate: ProvisionalRuleCandidate;
  readonly rule: RewardRule;
  readonly observation: ProvisionalObservationBinding;
  readonly history: readonly ProvisionalTransition[];
  readonly corrections: readonly CorrectionSignalRecord[];
}

export interface AdmissionAccepted {
  readonly ok: true;
  readonly status: Exclude<
    ProvisionalRuleStatus,
    "active_experimental" | "disputed" | "quarantined"
  >;
  readonly candidate_hash: Sha256;
  readonly definition_hash: Sha256;
  readonly envelope: ProvisionalRuleEnvelope;
  readonly issues: readonly [];
}

export interface AdmissionRejected {
  readonly ok: false;
  readonly status: "quarantined";
  readonly candidate_hash?: Sha256;
  readonly definition_hash?: Sha256;
  readonly issues: readonly AdmissionIssue[];
}

export type ProvisionalAdmissionResult = AdmissionAccepted | AdmissionRejected;

export type TransitionErrorCode =
  | "envelope_invalid"
  | "candidate_not_found"
  | "activation_not_allowed"
  | "timestamp_invalid"
  | "transition_time_regression"
  | "source_authority_required_for_activation"
  | "reason_invalid"
  | "correction_invalid"
  | "duplicate_correction"
  | "tampered_correction"
  | "candidate_hash_mismatch";

export interface TransitionFailure {
  readonly ok: false;
  readonly code: TransitionErrorCode;
  readonly message: string;
}

export interface TransitionSuccess {
  readonly ok: true;
  readonly envelope: ProvisionalRuleEnvelope;
}

export type TransitionResult = TransitionSuccess | TransitionFailure;

export interface CorrectionSuccess extends TransitionSuccess {
  readonly signal: CorrectionSignalRecord;
  readonly disposition: "recorded" | "disputed" | "quarantined";
}

export type CorrectionResult = CorrectionSuccess | TransitionFailure;

export interface SelectionOptions {
  readonly p0_family_id?: string;
  readonly include_machine_checked?: boolean;
}

export interface ProvisionalRuleStore {
  readonly admit: (
    request: ProvisionalRuleAdmissionRequest,
  ) => ProvisionalAdmissionResult;
  readonly activate: (
    candidate_hash: Sha256,
    occurred_at: string,
    reason?: string,
  ) => TransitionResult;
  readonly reportCorrection: (signal: unknown) => CorrectionResult;
  readonly get: (candidate_hash: Sha256) => ProvisionalRuleEnvelope | null;
  readonly select: (
    options?: SelectionOptions,
  ) => readonly ProvisionalRuleEnvelope[];
  readonly snapshot: () => readonly ProvisionalRuleEnvelope[];
}

/** Keeps the observation type visible to consumers without accepting it as a trust assertion. */
export type AgentFeedSourceObservation = SourceObservation;
