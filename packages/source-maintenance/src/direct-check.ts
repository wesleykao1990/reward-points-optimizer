import {
  canonicalSha256,
  deepFreeze,
  isValidIsoDateTime,
  verifyCanonicalHash,
} from "./canonical.js";
import {
  assertM4Cohort,
  isM4SourceId,
  M4_COHORT_MANIFEST,
  type M4CohortManifest,
  type M4SourceId,
} from "./cohort.js";

export type CaptureMethod =
  | "manual_capture"
  | "rendered_capture"
  | "official_api"
  | "partner_feed"
  | "automated_http"
  | "none";

export type RepresentationKind = "test_fixture" | "permitted_capture";

export type AccessObservationScope = "per_source" | "aggregate";
export type AccessObservationResult = "reachable" | "blocked" | "unknown";
export type TechnicalClassification =
  | "unknown"
  | "plain_http_observed_reachable"
  | "rendered_capture_only"
  | "manual_only"
  | "official_api_available"
  | "partner_feed_available"
  | "not_reachable";
export type TermsReviewStatus =
  | "not_reviewed"
  | "unknown"
  | "approved"
  | "not_applicable"
  | "denied";

export interface AccessObservation {
  readonly observation_id: string;
  readonly source_id: string;
  readonly observed_at: string;
  readonly method: CaptureMethod;
  readonly scope: AccessObservationScope;
  readonly result: AccessObservationResult;
  /** A successful response never implies permission; this must be explicit. */
  readonly permission_asserted: boolean;
  readonly representation_kind: RepresentationKind;
  readonly observation_hash?: string;
}

export type SnapshotCompleteness = "complete" | "partial" | "failed";

export interface SnapshotArtifact {
  readonly artifact_type: "snapshot";
  readonly snapshot_id: string;
  readonly source_id: string;
  readonly captured_at: string;
  readonly capture_method: CaptureMethod;
  readonly representation_kind: RepresentationKind;
  /** Digest only; this package never stores or fetches source content. */
  readonly representation_digest: string;
  readonly completeness: SnapshotCompleteness;
  /** Test fixtures can never become canonical evidence. */
  readonly canonical_evidence_eligible: false;
  readonly snapshot_hash: string;
}

export type DiffClassification =
  | "unchanged"
  | "cosmetic"
  | "non_material_copy"
  | "potential_material_rule_change"
  | "removal_or_relocation"
  | "inaccessible"
  | "security_anomaly";

export interface DiffArtifact {
  readonly artifact_type: "diff";
  readonly diff_id: string;
  readonly source_id: string;
  readonly before_snapshot_id: string | null;
  readonly after_snapshot_id: string | null;
  readonly changed: boolean;
  readonly classification: DiffClassification;
  readonly diff_hash: string;
}

export type Materiality =
  | "unchanged"
  | "non_material"
  | "material"
  | "security";

export interface MaterialityArtifact {
  readonly artifact_type: "materiality";
  readonly materiality_id: string;
  readonly source_id: string;
  readonly diff_id: string;
  readonly materiality: Materiality;
  readonly review_required: boolean;
  readonly impact_tags: readonly string[];
  readonly materiality_hash: string;
}

export type DirectCheckState =
  | "planned"
  | "blocked_permission"
  | "blocked_technical"
  | "blocked_observation"
  | "ready_for_capture"
  | "capture_failed"
  | "captured"
  | "unchanged"
  | "material_review"
  | "security_review";

export type DirectCheckBlockerCode =
  | "source_not_in_cohort"
  | "cohort_drift"
  | "terms_not_approved"
  | "technical_feasibility_unknown"
  | "observation_missing"
  | "aggregate_observation_only"
  | "observation_source_mismatch"
  | "observation_not_reachable"
  | "observation_timestamp_invalid"
  | "observation_method_mismatch"
  | "permission_not_asserted"
  | "collection_path_not_permitted"
  | "technical_classification_not_ready"
  | "check_timestamp_invalid"
  | "snapshot_timestamp_invalid"
  | "previous_snapshot_timestamp_invalid"
  | "snapshot_method_mismatch"
  | "snapshot_source_mismatch"
  | "snapshot_hash_invalid"
  | "previous_snapshot_source_mismatch"
  | "previous_snapshot_hash_invalid"
  | "diff_source_mismatch"
  | "diff_hash_invalid"
  | "diff_snapshot_link_mismatch"
  | "materiality_source_mismatch"
  | "materiality_hash_invalid"
  | "materiality_diff_mismatch";

export interface DirectCheckBlocker {
  readonly code: DirectCheckBlockerCode;
  readonly detail: string;
}

export interface DirectCheckPermission {
  readonly terms_review_status: TermsReviewStatus;
  readonly technical_classification: TechnicalClassification;
  /** Rendered capture is an exception to manual_capture_first only when explicit. */
  readonly rendered_capture_allowed?: boolean;
  readonly observation?: AccessObservation;
}

export interface RehearsalCheckInput {
  readonly check_id: string;
  readonly source_id: string;
  readonly checked_at: string;
  readonly planned_method?: CaptureMethod;
  readonly permission: DirectCheckPermission;
  readonly snapshot?: SnapshotArtifact;
  readonly previous_snapshot?: SnapshotArtifact;
  readonly diff?: DiffArtifact;
  readonly materiality?: MaterialityArtifact;
  readonly capture_failed?: boolean;
  readonly failure_reason?: string;
  readonly human_minutes?: number | null;
  readonly synthetic?: boolean;
}

export interface RehearsalCheck extends RehearsalCheckInput {
  readonly record_type: "rehearsal_check";
  readonly state: DirectCheckState;
  readonly blockers: readonly DirectCheckBlocker[];
  readonly transitions: readonly DirectCheckState[];
  readonly canonical_evidence_ids: readonly [];
  readonly record_hash: string;
}

function artifactHash<T extends Record<string, unknown>>(
  value: T,
  hashKey: string,
): string {
  const copy = { ...value };
  delete copy[hashKey];
  return canonicalSha256(copy as Parameters<typeof canonicalSha256>[0]);
}

export function createSnapshotArtifact(
  input: Omit<
    SnapshotArtifact,
    "snapshot_hash" | "canonical_evidence_eligible" | "artifact_type"
  >,
): SnapshotArtifact {
  const payload = {
    artifact_type: "snapshot" as const,
    ...input,
    canonical_evidence_eligible: false as const,
  };
  return deepFreeze({
    ...payload,
    snapshot_hash: artifactHash(payload, "snapshot_hash"),
  });
}

export function createDiffArtifact(
  input: Omit<DiffArtifact, "diff_hash" | "artifact_type">,
): DiffArtifact {
  const payload = { artifact_type: "diff" as const, ...input };
  return deepFreeze({
    ...payload,
    diff_hash: artifactHash(payload, "diff_hash"),
  });
}

export function createMaterialityArtifact(
  input: Omit<MaterialityArtifact, "materiality_hash" | "artifact_type">,
): MaterialityArtifact {
  const payload = { artifact_type: "materiality" as const, ...input };
  return deepFreeze({
    ...payload,
    materiality_hash: artifactHash(payload, "materiality_hash"),
  });
}

export function verifySnapshotArtifact(snapshot: SnapshotArtifact): boolean {
  try {
    return (
      snapshot.canonical_evidence_eligible === false &&
      verifyCanonicalHash(
        snapshot as unknown as Record<string, unknown>,
        "snapshot_hash",
      )
    );
  } catch {
    return false;
  }
}

export function verifyDiffArtifact(diff: DiffArtifact): boolean {
  try {
    return verifyCanonicalHash(
      diff as unknown as Record<string, unknown>,
      "diff_hash",
    );
  } catch {
    return false;
  }
}

export function verifyMaterialityArtifact(
  materiality: MaterialityArtifact,
): boolean {
  try {
    return verifyCanonicalHash(
      materiality as unknown as Record<string, unknown>,
      "materiality_hash",
    );
  } catch {
    return false;
  }
}

function block(
  code: DirectCheckBlockerCode,
  detail: string,
): DirectCheckBlocker {
  return { code, detail };
}

function stateForMateriality(materiality: Materiality): DirectCheckState {
  if (materiality === "unchanged" || materiality === "non_material")
    return "unchanged";
  if (materiality === "security") return "security_review";
  return "material_review";
}

function checkPayload(
  input: RehearsalCheckInput,
  result: {
    state: DirectCheckState;
    blockers: readonly DirectCheckBlocker[];
    transitions: readonly DirectCheckState[];
  },
): Omit<RehearsalCheck, "record_hash"> {
  return {
    ...input,
    record_type: "rehearsal_check",
    state: result.state,
    blockers: [...result.blockers],
    transitions: [...result.transitions],
    canonical_evidence_ids: [],
  };
}

/**
 * Evaluate one direct check without acquiring anything.  Permission and
 * source observations are explicit inputs; HTTP-like reachability alone is
 * never promoted to readiness.
 */
export function evaluateDirectCheck(
  input: RehearsalCheckInput,
  cohort: M4CohortManifest = M4_COHORT_MANIFEST,
): RehearsalCheck {
  const blockers: DirectCheckBlocker[] = [];
  if (!isValidIsoDateTime(input.checked_at)) {
    blockers.push(
      block(
        "check_timestamp_invalid",
        "The check timestamp must be a valid ISO date-time.",
      ),
    );
  }
  if (!isM4SourceId(input.source_id)) {
    blockers.push(
      block("source_not_in_cohort", `Unknown source ${input.source_id}.`),
    );
  }
  try {
    assertM4Cohort(cohort);
  } catch {
    blockers.push(
      block(
        "cohort_drift",
        "The supplied cohort is not the fixed M4 manifest.",
      ),
    );
  }

  const plannedMethod = input.planned_method ?? "manual_capture";
  const observation = input.permission.observation;
  if (
    input.permission.terms_review_status !== "approved" &&
    input.permission.terms_review_status !== "not_applicable"
  ) {
    blockers.push(
      block(
        "terms_not_approved",
        `Terms status ${input.permission.terms_review_status} does not permit capture.`,
      ),
    );
  }
  if (input.permission.technical_classification === "unknown") {
    blockers.push(
      block(
        "technical_feasibility_unknown",
        "Technical feasibility is not established.",
      ),
    );
  }
  if (
    ![
      "plain_http_observed_reachable",
      "rendered_capture_only",
      "manual_only",
      "official_api_available",
      "partner_feed_available",
    ].includes(input.permission.technical_classification)
  ) {
    blockers.push(
      block(
        "technical_classification_not_ready",
        `Technical classification ${input.permission.technical_classification} is not ready for capture.`,
      ),
    );
  }
  if (!observation) {
    blockers.push(
      block(
        "observation_missing",
        "A dated per-source observation is required.",
      ),
    );
  } else {
    if (
      !isValidIsoDateTime(observation.observed_at) ||
      (isValidIsoDateTime(input.checked_at) &&
        Date.parse(observation.observed_at) > Date.parse(input.checked_at))
    ) {
      blockers.push(
        block(
          "observation_timestamp_invalid",
          "Observation observed_at must be valid and no later than checked_at.",
        ),
      );
    }
    if (observation.source_id !== input.source_id) {
      blockers.push(
        block(
          "observation_source_mismatch",
          "Observation source does not match check source.",
        ),
      );
    }
    if (observation.scope === "aggregate") {
      blockers.push(
        block(
          "aggregate_observation_only",
          "Aggregate observations never establish source readiness.",
        ),
      );
    }
    if (observation.result !== "reachable") {
      blockers.push(
        block(
          "observation_not_reachable",
          "The per-source observation is not reachable.",
        ),
      );
    }
    if (!observation.permission_asserted) {
      blockers.push(
        block(
          "permission_not_asserted",
          "A successful response cannot imply capture permission.",
        ),
      );
    }
    if (observation.method !== plannedMethod) {
      blockers.push(
        block(
          "observation_method_mismatch",
          `Observation method ${observation.method} does not match planned method ${plannedMethod}.`,
        ),
      );
    }
  }

  const classification = input.permission.technical_classification;
  const methodCompatible =
    (classification === "manual_only" && plannedMethod === "manual_capture") ||
    (classification === "rendered_capture_only" &&
      (plannedMethod === "manual_capture" ||
        (plannedMethod === "rendered_capture" &&
          input.permission.rendered_capture_allowed === true))) ||
    (classification === "plain_http_observed_reachable" &&
      plannedMethod === "automated_http") ||
    (classification === "official_api_available" &&
      plannedMethod === "official_api") ||
    (classification === "partner_feed_available" &&
      plannedMethod === "partner_feed");
  const fixedManualFirst =
    isM4SourceId(input.source_id) &&
    cohort.sources[M4_COHORT_SOURCE_IDS_INDEX(input.source_id)]
      ?.initial_collection_path === "manual_capture_first";
  if (
    !methodCompatible ||
    (fixedManualFirst && plannedMethod === "automated_http")
  ) {
    blockers.push(
      block(
        "collection_path_not_permitted",
        `Planned method ${plannedMethod} is incompatible with technical classification ${classification} or the fixed manual_capture_first policy.`,
      ),
    );
  }

  if (input.snapshot) {
    if (
      !isValidIsoDateTime(input.snapshot.captured_at) ||
      (isValidIsoDateTime(input.checked_at) &&
        Date.parse(input.snapshot.captured_at) > Date.parse(input.checked_at))
    ) {
      blockers.push(
        block(
          "snapshot_timestamp_invalid",
          "Snapshot captured_at must be valid and no later than checked_at.",
        ),
      );
    }
    if (input.snapshot.capture_method !== plannedMethod) {
      blockers.push(
        block(
          "snapshot_method_mismatch",
          `Snapshot capture method ${input.snapshot.capture_method} does not match planned method ${plannedMethod}.`,
        ),
      );
    }
  }
  if (input.previous_snapshot) {
    if (!isValidIsoDateTime(input.previous_snapshot.captured_at)) {
      blockers.push(
        block(
          "previous_snapshot_timestamp_invalid",
          "Previous snapshot captured_at must be a valid ISO date-time.",
        ),
      );
    } else if (
      input.snapshot &&
      isValidIsoDateTime(input.snapshot.captured_at) &&
      Date.parse(input.previous_snapshot.captured_at) >
        Date.parse(input.snapshot.captured_at)
    ) {
      blockers.push(
        block(
          "previous_snapshot_timestamp_invalid",
          "Previous snapshot cannot be newer than the current snapshot.",
        ),
      );
    }
  }

  if (blockers.length > 0) {
    const technicalCodes = new Set<DirectCheckBlockerCode>([
      "technical_feasibility_unknown",
      "technical_classification_not_ready",
      "observation_missing",
      "observation_not_reachable",
      "observation_timestamp_invalid",
      "check_timestamp_invalid",
      "snapshot_timestamp_invalid",
      "previous_snapshot_timestamp_invalid",
    ]);
    const observationCodes = new Set<DirectCheckBlockerCode>([
      "aggregate_observation_only",
      "observation_source_mismatch",
      "permission_not_asserted",
    ]);
    const state = blockers.some((item) => item.code === "terms_not_approved")
      ? "blocked_permission"
      : blockers.some((item) => technicalCodes.has(item.code))
        ? "blocked_technical"
        : blockers.some((item) => observationCodes.has(item.code))
          ? "blocked_observation"
          : "blocked_permission";
    const payload = checkPayload(input, {
      state,
      blockers,
      transitions: ["planned", state],
    });
    return deepFreeze({
      ...payload,
      record_hash: canonicalSha256(
        payload as unknown as Parameters<typeof canonicalSha256>[0],
      ),
    });
  }

  if (
    input.previous_snapshot &&
    (input.previous_snapshot.source_id !== input.source_id ||
      !verifySnapshotArtifact(input.previous_snapshot))
  ) {
    blockers.push(
      block(
        input.previous_snapshot.source_id !== input.source_id
          ? "previous_snapshot_source_mismatch"
          : "previous_snapshot_hash_invalid",
        "Previous snapshot identity or immutable hash is invalid.",
      ),
    );
  }
  if (
    input.snapshot &&
    (input.snapshot.source_id !== input.source_id ||
      !verifySnapshotArtifact(input.snapshot))
  ) {
    blockers.push(
      block(
        input.snapshot.source_id !== input.source_id
          ? "snapshot_source_mismatch"
          : "snapshot_hash_invalid",
        "Snapshot identity or immutable hash is invalid.",
      ),
    );
  }
  if (input.diff) {
    if (!verifyDiffArtifact(input.diff)) {
      blockers.push(
        block("diff_hash_invalid", "Diff immutable hash is invalid."),
      );
    } else if (input.diff.source_id !== input.source_id) {
      blockers.push(
        block(
          "diff_source_mismatch",
          "Diff source does not match check source.",
        ),
      );
    } else if (
      !input.snapshot ||
      input.diff.after_snapshot_id !== input.snapshot.snapshot_id ||
      (input.previous_snapshot !== undefined &&
        input.diff.before_snapshot_id !==
          input.previous_snapshot.snapshot_id) ||
      (input.previous_snapshot === undefined &&
        input.diff.before_snapshot_id !== null)
    ) {
      blockers.push(
        block(
          "diff_snapshot_link_mismatch",
          "Diff snapshot links do not match the supplied snapshots.",
        ),
      );
    }
  }
  if (input.materiality) {
    if (!verifyMaterialityArtifact(input.materiality)) {
      blockers.push(
        block(
          "materiality_hash_invalid",
          "Materiality immutable hash is invalid.",
        ),
      );
    } else if (input.materiality.source_id !== input.source_id) {
      blockers.push(
        block(
          "materiality_source_mismatch",
          "Materiality source does not match check source.",
        ),
      );
    } else if (
      !input.diff ||
      input.materiality.diff_id !== input.diff.diff_id
    ) {
      blockers.push(
        block(
          "materiality_diff_mismatch",
          "Materiality diff link does not match the supplied diff.",
        ),
      );
    }
  }
  if (
    blockers.some((item) =>
      [
        "previous_snapshot_source_mismatch",
        "previous_snapshot_hash_invalid",
        "snapshot_source_mismatch",
        "snapshot_hash_invalid",
        "diff_source_mismatch",
        "diff_hash_invalid",
        "diff_snapshot_link_mismatch",
        "materiality_source_mismatch",
        "materiality_hash_invalid",
        "materiality_diff_mismatch",
      ].includes(item.code),
    )
  ) {
    const payload = checkPayload(input, {
      state: "capture_failed",
      blockers,
      transitions: ["planned", "ready_for_capture", "capture_failed"],
    });
    return deepFreeze({
      ...payload,
      record_hash: canonicalSha256(
        payload as unknown as Parameters<typeof canonicalSha256>[0],
      ),
    });
  }

  if (input.capture_failed || !input.snapshot) {
    const state: DirectCheckState = input.capture_failed
      ? "capture_failed"
      : "ready_for_capture";
    const transitions: DirectCheckState[] = ["planned", "ready_for_capture"];
    if (input.capture_failed) transitions.push("capture_failed");
    const payload = checkPayload(input, { state, blockers, transitions });
    return deepFreeze({
      ...payload,
      record_hash: canonicalSha256(
        payload as unknown as Parameters<typeof canonicalSha256>[0],
      ),
    });
  }

  if (!input.diff) {
    const payload = checkPayload(input, {
      state: "captured",
      blockers,
      transitions: ["planned", "ready_for_capture", "captured"],
    });
    return deepFreeze({
      ...payload,
      record_hash: canonicalSha256(
        payload as unknown as Parameters<typeof canonicalSha256>[0],
      ),
    });
  }

  if (!input.materiality) {
    const payload = checkPayload(input, {
      state: "captured",
      blockers,
      transitions: ["planned", "ready_for_capture", "captured"],
    });
    return deepFreeze({
      ...payload,
      record_hash: canonicalSha256(
        payload as unknown as Parameters<typeof canonicalSha256>[0],
      ),
    });
  }

  const state = stateForMateriality(input.materiality.materiality);
  const payload = checkPayload(input, {
    state,
    blockers,
    transitions: ["planned", "ready_for_capture", "captured", state],
  });
  return deepFreeze({
    ...payload,
    record_hash: canonicalSha256(
      payload as unknown as Parameters<typeof canonicalSha256>[0],
    ),
  });
}

function M4_COHORT_SOURCE_IDS_INDEX(sourceId: M4SourceId): number {
  return M4_COHORT_MANIFEST.source_ids.indexOf(sourceId);
}
