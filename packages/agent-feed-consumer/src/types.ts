import type { JsonValue } from "./util.js";

export const AGENT_FEED_PROTOCOL_VERSION = "0.1" as const;
export const SEMANTIC_FINGERPRINT_VERSION = 1 as const;
export const DEFAULT_REPLAY_WINDOW_SECONDS = 300 as const;
export const DEFAULT_MAX_BODY_BYTES = 1_048_576 as const;

export type AgentFeedEventType =
  | "run.started"
  | "finding.submitted"
  | "run.completed"
  | "run.partial"
  | "run.failed";

export type FindingType =
  | "rewards.program_change"
  | "rewards.campaign"
  | "rewards.merchant_acceptance"
  | "rewards.transfer_change"
  | "rewards.source_relocation";

export type RewardChangeType =
  | "reward_rate"
  | "eligibility"
  | "campaign"
  | "cap"
  | "merchant_acceptance"
  | "funding_route"
  | "transfer"
  | "expiry"
  | "announcement"
  | "unknown";

export type ObservationStatus =
  | "new"
  | "duplicate"
  | "needs_evidence"
  | "needs_review"
  | "rejected"
  | "closed";

export type ReceiptProcessingStatus =
  | "received"
  | "mapped"
  | "duplicate"
  | "quarantined"
  | "failed";

export type ReceiptRedactionStatus = "pending" | "complete" | "rejected";

export interface AgentFeedDeliveryEvent {
  protocol_version: typeof AGENT_FEED_PROTOCOL_VERSION;
  event_id: string;
  event_type: AgentFeedEventType;
  stream_id: string;
  run_id: string;
  finding_id: string | null;
  occurred_at: string;
  attempt: number;
  payload: Record<string, unknown>;
}

export interface FindingSubject {
  type: string;
  id: string | null;
  name: string | null;
}

export interface FindingEffectiveTime {
  occurred_at: string | null;
  effective_from: string | null;
  effective_to: string | null;
}

export interface FindingAssessment {
  novelty: "new" | "known" | "uncertain";
  evidence_completeness: "complete" | "partial" | "lead_only";
  agent_confidence: number | null;
  source_authority_claim:
    | "primary"
    | "official_secondary"
    | "third_party"
    | "unknown";
}

export interface AgentFeedFinding {
  finding_id: string;
  finding_type: string;
  title: string;
  summary: string;
  subjects: FindingSubject[];
  effective_time: FindingEffectiveTime;
  assessment: FindingAssessment;
  evidence_refs: string[];
  producer_dedupe_key: string | null;
  routing_tags: string[];
  attributes: Record<string, unknown>;
  security_flags: string[];
}

export interface SubmittedEvidenceSource {
  uri: string | null;
  title: string | null;
  publisher: string | null;
  source_id: string | null;
}

export interface SubmittedEvidenceLocator {
  type: string;
  value: string;
  page: number | null;
}

export interface SubmittedEvidenceArtifact {
  uri: string | null;
  media_type: string | null;
  size_bytes: number | null;
}

export interface SubmittedEvidenceHandling {
  contains_personal_data: boolean;
  contains_secrets: boolean;
  redistribution_restricted: boolean;
}

export interface SubmittedEvidence {
  evidence_id: string;
  kind:
    | "web"
    | "document"
    | "email"
    | "api"
    | "social_post"
    | "database"
    | "human_observation"
    | "file"
    | "other";
  source: SubmittedEvidenceSource;
  captured_at: string;
  published_at: string | null;
  locator: SubmittedEvidenceLocator | null;
  excerpt: string | null;
  content_hash: string | null;
  artifact: SubmittedEvidenceArtifact;
  handling: SubmittedEvidenceHandling;
  metadata: Record<string, unknown>;
}

export interface SourceObservation {
  observation_id: string;
  agent_feed: {
    protocol_version: typeof AGENT_FEED_PROTOCOL_VERSION;
    event_id: string;
    stream_id: string;
    run_id: string;
    finding_id: string;
  };
  source_ids: string[];
  subjects: FindingSubject[];
  change_type: RewardChangeType;
  summary: string;
  effective_time: FindingEffectiveTime;
  discovery_assessment: {
    source_authority_claim: FindingAssessment["source_authority_claim"];
    evidence_completeness: FindingAssessment["evidence_completeness"];
    agent_confidence: number | null;
  };
  submitted_evidence_refs: string[];
  canonical_evidence_ids: string[];
  semantic_fingerprint_version: typeof SEMANTIC_FINGERPRINT_VERSION;
  semantic_fingerprint: string;
  status: ObservationStatus;
  security_flags: string[];
  raw_attributes: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface SubmittedEvidenceLead {
  observation_id: string;
  agent_feed_evidence_id: string;
  submitted_payload: SubmittedEvidence;
  promotion_status:
    | "unreviewed"
    | "lead_only"
    | "capture_required"
    | "promoted"
    | "rejected";
  promoted_evidence_id?: string | null;
}

export interface SigningKeyMaterial {
  /** Resolver lookup is already keyed by the header identity; key_id is an optional returned assertion. */
  key_id?: string;
  keyId?: string;
  secret: string | Uint8Array;
  active_from?: number;
  activeFrom?: number;
  expires_at?: number | null;
  expiresAt?: number | null;
}

/** Resolver-owned key identity and rotation boundary. Never expose this over HTTP. */
export interface SigningKeyResolver {
  resolve(
    keyId: string,
    timestampSeconds: number,
  ): SigningKeyMaterial | null | Promise<SigningKeyMaterial | null>;
}

export type HeaderValue = string | string[] | undefined;
export type HeadersLike =
  | Headers
  | Record<string, HeaderValue>
  | Iterable<readonly [string, string]>;

export interface SignedEventRequest {
  /** A string is encoded as UTF-8 once; a Uint8Array is used byte-for-byte. */
  raw_body: string | Uint8Array;
  headers: HeadersLike;
  received_at: Date | string | number;
}

export interface SignatureVerification {
  valid: boolean;
  reason?: string;
  eventId?: string;
  event_id?: string;
  deliveryId?: string;
  delivery_id?: string;
  keyId?: string;
  signature_key_id?: string;
  timestampSeconds?: number;
  signatureTimestamp?: string;
  signature_timestamp?: string;
  deliveryAttempt?: number;
  delivery_attempt?: number;
}

export interface SchemaIssue {
  instancePath?: string;
  schemaPath?: string;
  keyword?: string;
  message: string;
}

export interface SchemaValidationResult {
  valid: boolean;
  issues?: readonly SchemaIssue[];
}

export interface AgentFeedSchemaValidator {
  validate(
    schemaName: AgentFeedSchemaName,
    value: unknown,
  ): SchemaValidationResult | Promise<SchemaValidationResult>;
}

export type AgentFeedSchemaName =
  | "deliveryEvent"
  | "finding"
  | "evidence"
  | "runEnvelope"
  | "runBundle"
  | "beginRun"
  | "completeRun"
  | "submitBatch"
  | "streamExpectation";

export interface ReceiptInput {
  event_id: string;
  protocol_version: typeof AGENT_FEED_PROTOCOL_VERSION;
  stream_id: string;
  run_id: string;
  finding_id: string | null;
  event_type: AgentFeedEventType;
  received_at: string;
  occurred_at: string;
  attempt: number;
  /** Stable canonical event hash with only the top-level attempt omitted. */
  payload_hash: string;
  /** Exact received-byte hash; this changes when Agent Feed re-encodes attempt. */
  transport_payload_hash: string;
  delivery_id: string;
  signature_timestamp: string;
  signature_key_id: string;
  delivery_attempt: number;
  /** Redacted parsed body. Original bytes are represented only by hashes. */
  raw_payload: Record<string, unknown>;
  processing_status: ReceiptProcessingStatus;
  redaction_status: ReceiptRedactionStatus;
  error_code?: string;
}

export type RunTerminalStatus =
  | "completed"
  | "partial"
  | "failed"
  | "cancelled";

export interface AgentFeedTerminalPayload {
  status: RunTerminalStatus;
  completed_at: string;
  actual_scope: Record<string, unknown>;
  expected_scope: Record<string, unknown>;
  stats: {
    sources_attempted: number;
    sources_succeeded: number;
    findings_submitted: number;
    evidence_submitted: number;
    batches_submitted: number;
  };
  error_summary: string | null;
}

export interface RunLifecycleMutation {
  kind: "started" | "terminal";
  stream_id: string;
  run_id: string;
  event_id: string;
  status: "running" | RunTerminalStatus;
  completed_at: string | null;
  findings_submitted: number | null;
  completed_zero_findings: boolean;
  /** False here is meaningful: no terminal event is not represented by a delivery. */
  absent_run: false;
  actual_scope?: Record<string, unknown> | null;
  expected_scope?: Record<string, unknown> | null;
  error_summary?: string | null;
}

export interface AtomicPersistenceInput {
  receipt: ReceiptInput;
  observation: SourceObservation | null;
  submitted_evidence: readonly SubmittedEvidenceLead[];
  run_lifecycle: RunLifecycleMutation | null;
  quarantine_reason?: string;
}

export type PersistenceOutcomeStatus =
  | "inserted"
  | "mapped"
  | "duplicate"
  | "quarantined";

export interface PersistenceOutcome {
  status: PersistenceOutcomeStatus;
  receipt_id: string;
  observation?: SourceObservation | null;
  duplicate_kind?: "transport" | "semantic";
  duplicate_of_receipt_id?: string | null;
  reason_code?: string;
}

/** One atomic transaction must insert the receipt and any mapped state together. */
export interface AtomicPersistencePort {
  persist(input: AtomicPersistenceInput): Promise<PersistenceOutcome>;
}

export interface ConsumerErrorDiagnostic {
  code: string;
  message: string;
  event_id?: string | null;
  stream_id?: string | null;
  run_id?: string | null;
  finding_id?: string | null;
  received_at: string;
  details?: Record<string, unknown>;
}

export interface DeadLetterDiagnostic extends ConsumerErrorDiagnostic {
  reason: string;
  redacted_payload?: Record<string, unknown>;
}

export interface DeadLetterDiagnosticsPort {
  record(input: DeadLetterDiagnostic): Promise<void>;
  list?(filter?: {
    stream_id?: string;
    run_id?: string;
    limit?: number;
  }): Promise<readonly DeadLetterDiagnostic[]>;
}

export interface ReplayRequest {
  event_id?: string;
  cursor?: string;
  requested_by: string;
  requested_at: string;
  reason?: string;
}

export interface ReplayDiagnosticsPort {
  requestReplay(
    input: ReplayRequest,
  ): Promise<{ accepted: boolean; replay_id?: string; reason_code?: string }>;
  recordAttempt?(input: {
    event_id: string;
    attempt: number;
    replay_generation?: number;
    outcome: "accepted" | "duplicate" | "rejected" | "failed";
    diagnostic: ConsumerErrorDiagnostic;
  }): Promise<void>;
}

export interface HandlerResponse {
  status_code: 200 | 202 | 400 | 401 | 409 | 413 | 422 | 500;
  acknowledged: boolean;
  outcome?: PersistenceOutcome;
  error_code?: string;
  diagnostics?: ConsumerErrorDiagnostic;
}

export interface ConsumerHandlerOptions {
  key_resolver: SigningKeyResolver;
  persistence: AtomicPersistencePort;
  schema_validator?: AgentFeedSchemaValidator;
  dead_letter?: DeadLetterDiagnosticsPort;
  replay_diagnostics?: ReplayDiagnosticsPort;
  max_body_bytes?: number;
  replay_window_seconds?: number;
  now?: () => Date;
}

export interface ConsumerHandler {
  handle(request: SignedEventRequest): Promise<HandlerResponse>;
}

export interface MonitorStreamExpectation {
  stream_id: string;
  /** Consumer-owned mapping used to downgrade affected source freshness. */
  source_ids?: readonly string[];
  expected_cadence_seconds: number;
  grace_seconds: number;
  enabled: boolean;
  owner: string;
  last_terminal_run_at: string | null;
  next_due_at: string | null;
  liveness_status:
    | "healthy"
    | "due"
    | "overdue"
    | "degraded"
    | "disabled"
    | "never_seen";
}

export interface LivenessEvaluation {
  stream_id: string;
  source_ids?: readonly string[];
  status: MonitorStreamExpectation["liveness_status"];
  due_at: string | null;
  absent_run: boolean;
  reason_code: "disabled" | "never_seen" | "healthy" | "due" | "overdue";
}

export interface MonitorLivenessPort {
  registerExpectation(input: MonitorStreamExpectation): Promise<void>;
  recordTerminalRun(input: {
    stream_id: string;
    completed_at: string;
    status: RunTerminalStatus;
    findings_submitted: number;
  }): Promise<void>;
  sweepOverdue(now: string): Promise<readonly LivenessEvaluation[]>;
}

export interface RewardsEvidencePermissionPort {
  canPromote(input: {
    observation_id: string;
    evidence_id: string;
    requested_by: string;
  }): Promise<boolean> | boolean;
}

export interface CanonicalCapture {
  evidence_id: string;
  capture_hash: string;
  locator: string | { type: string; value: string; page?: number | null };
  captured_at: string;
}

export interface EvidenceReview {
  approved: boolean;
  reviewed_by: string;
  reviewed_at: string;
  decision_id?: string;
}

export interface EvidencePromotionRequest {
  observation_id: string;
  submitted_evidence: SubmittedEvidenceLead;
  requested_by: string;
  canonical_capture: CanonicalCapture;
  review: EvidenceReview;
}

export interface CanonicalEvidenceStore {
  persistCanonical(input: {
    observation_id: string;
    submitted_evidence_id: string;
    canonical_capture: CanonicalCapture;
    review: EvidenceReview;
    requested_by: string;
  }): Promise<{ canonical_evidence_id: string }>;
}

export interface PromotionResult {
  promoted: boolean;
  canonical_evidence_id?: string;
  reason_code?: string;
}

export type JsonRecord = Record<string, JsonValue>;
