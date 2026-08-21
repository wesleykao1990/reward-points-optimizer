/**
 * Keep the adapter contract tied to the consumer's authoritative protocol
 * types. This file is type-only and therefore adds no runtime dependency.
 */
export type {
  AtomicPersistenceInput,
  AtomicPersistencePort,
  PersistenceOutcome,
  PersistenceOutcomeStatus,
  SourceObservation,
} from "@jro/agent-feed-consumer";
