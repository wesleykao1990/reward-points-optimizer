import type { ObservationStatus, SourceObservation } from "./types.js";

const allowedTransitions: Readonly<
  Record<ObservationStatus, readonly ObservationStatus[]>
> = {
  new: [
    "new",
    "duplicate",
    "needs_evidence",
    "needs_review",
    "rejected",
    "closed",
  ],
  duplicate: ["duplicate"],
  needs_evidence: ["needs_evidence", "needs_review", "rejected", "closed"],
  needs_review: ["needs_review", "rejected", "closed"],
  rejected: ["rejected"],
  closed: ["closed"],
};

export function isValidObservationTransition(
  from: ObservationStatus,
  to: ObservationStatus,
): boolean {
  return allowedTransitions[from]?.includes(to) ?? false;
}

export function assertObservationTransition(
  from: ObservationStatus,
  to: ObservationStatus,
): void {
  if (!isValidObservationTransition(from, to))
    throw new Error(`invalid SourceObservation transition ${from} -> ${to}`);
}

export function transitionObservationStatus(
  observation: SourceObservation,
  status: ObservationStatus,
  updatedAt = observation.updated_at,
): SourceObservation {
  assertObservationTransition(observation.status, status);
  return { ...observation, status, updated_at: updatedAt };
}
