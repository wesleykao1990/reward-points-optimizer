import type {
  CanonicalCapture,
  CanonicalEvidenceStore,
  EvidencePromotionRequest,
  EvidenceReview,
  EvidencePromotionRequest as PromotionRequest,
  PromotionResult,
  RewardsEvidencePermissionPort,
} from "./types.js";
import { isPlainRecord } from "./util.js";

function validLocator(locator: CanonicalCapture["locator"]): boolean {
  if (typeof locator === "string") return locator.trim().length > 0;
  return (
    isPlainRecord(locator) &&
    typeof locator.type === "string" &&
    locator.type.trim().length > 0 &&
    typeof locator.value === "string" &&
    locator.value.trim().length > 0
  );
}

function validReview(review: EvidenceReview): boolean {
  return (
    review.approved === true &&
    review.reviewed_by.trim().length > 0 &&
    Number.isFinite(Date.parse(review.reviewed_at))
  );
}

/**
 * Canonical evidence can only be written after an app-owned permission,
 * independently captured hash/locator, and approved review. A submitted
 * Agent Feed evidence object alone has no method that returns a canonical ID.
 */
export class EvidencePromotionService {
  readonly #permission: RewardsEvidencePermissionPort;
  readonly #store: CanonicalEvidenceStore;

  constructor(
    permission: RewardsEvidencePermissionPort,
    store: CanonicalEvidenceStore,
  ) {
    this.#permission = permission;
    this.#store = store;
  }

  async promote(input: EvidencePromotionRequest): Promise<PromotionResult> {
    if (input.submitted_evidence.promotion_status === "promoted")
      return {
        promoted: false,
        reason_code: "already_promoted_requires_existing_canonical_id",
      };
    if (!input.requested_by.trim())
      return { promoted: false, reason_code: "requested_by_required" };
    if (!/^sha256:[0-9a-f]{64}$/u.test(input.canonical_capture.capture_hash))
      return {
        promoted: false,
        reason_code: "canonical_capture_hash_required",
      };
    if (!validLocator(input.canonical_capture.locator))
      return { promoted: false, reason_code: "canonical_locator_required" };
    if (!validReview(input.review))
      return { promoted: false, reason_code: "approved_review_required" };
    const allowed = await this.#permission.canPromote({
      observation_id: input.observation_id,
      evidence_id: input.submitted_evidence.agent_feed_evidence_id,
      requested_by: input.requested_by,
    });
    if (!allowed)
      return { promoted: false, reason_code: "rewards_permission_required" };
    const result = await this.#store.persistCanonical({
      observation_id: input.observation_id,
      submitted_evidence_id: input.submitted_evidence.agent_feed_evidence_id,
      canonical_capture: input.canonical_capture,
      review: input.review,
      requested_by: input.requested_by,
    });
    if (
      !result.canonical_evidence_id ||
      !/^ev_[a-z0-9_-]+$/u.test(result.canonical_evidence_id)
    )
      return { promoted: false, reason_code: "invalid_canonical_evidence_id" };
    return {
      promoted: true,
      canonical_evidence_id: result.canonical_evidence_id,
    };
  }
}

export async function promoteSubmittedEvidence(
  input: PromotionRequest,
  permission: RewardsEvidencePermissionPort,
  store: CanonicalEvidenceStore,
): Promise<PromotionResult> {
  return new EvidencePromotionService(permission, store).promote(input);
}
