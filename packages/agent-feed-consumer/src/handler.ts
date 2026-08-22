import {
  hasRunEnvelopeRequiredFields,
  isHostileObservation,
  isSupportedFindingType,
  mapFindingToObservation,
  mapRunLifecycle,
  runEnvelopeFromPayload,
} from "./mapping.js";
import {
  loadPublishedSchemaValidator,
  summarizeSchemaIssues,
  validateTerminalDeliveryPayload,
} from "./schema.js";
import { verifySignedRequest } from "./security.js";
import type {
  AgentFeedDeliveryEvent,
  AgentFeedFinding,
  AgentFeedSchemaValidator,
  AtomicPersistenceInput,
  ConsumerErrorDiagnostic,
  ConsumerHandler,
  ConsumerHandlerOptions,
  HandlerResponse,
  PersistenceOutcome,
  ReceiptInput,
  RunLifecycleMutation,
  SignatureVerification,
  SubmittedEvidence,
} from "./types.js";
import {
  canonicalJson,
  isoDate,
  isPlainRecord,
  prefixedSha256,
  redactedRecord,
} from "./util.js";
import { markVerifiedAtomicPersistenceInput } from "./verified-input.js";

function supportedEventType(
  value: unknown,
): value is AgentFeedDeliveryEvent["event_type"] {
  return (
    value === "run.started" ||
    value === "finding.submitted" ||
    value === "run.completed" ||
    value === "run.partial" ||
    value === "run.failed"
  );
}

function asEvent(
  value: Record<string, unknown>,
): AgentFeedDeliveryEvent | null {
  if (
    !supportedEventType(value.event_type) ||
    typeof value.event_id !== "string" ||
    typeof value.stream_id !== "string" ||
    typeof value.run_id !== "string" ||
    (typeof value.finding_id !== "string" && value.finding_id !== null) ||
    typeof value.occurred_at !== "string" ||
    !Number.isSafeInteger(value.attempt) ||
    !isPlainRecord(value.payload)
  )
    return null;
  return value as unknown as AgentFeedDeliveryEvent;
}

function receivedIso(value: Date | string | number): string {
  return isoDate(value);
}

function safeProtocolErrorCode(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : "";
  return /^(?:body_too_large|invalid_[a-z0-9_]+|missing_[a-z0-9_]+|unsupported_[a-z0-9_]+)$/u.test(
    message,
  )
    ? message
    : fallback;
}

function diagnostic(
  code: string,
  message: string,
  receivedAt: string,
  event?: Partial<AgentFeedDeliveryEvent>,
  details?: Record<string, unknown>,
): ConsumerErrorDiagnostic {
  return {
    code,
    message,
    received_at: receivedAt,
    ...(typeof event?.event_id === "string"
      ? { event_id: event.event_id }
      : {}),
    ...(typeof event?.stream_id === "string"
      ? { stream_id: event.stream_id }
      : {}),
    ...(typeof event?.run_id === "string" ? { run_id: event.run_id } : {}),
    ...(typeof event?.finding_id === "string"
      ? { finding_id: event.finding_id }
      : {}),
    ...(details === undefined ? {} : { details }),
  };
}

async function recordDeadLetter(
  options: ConsumerHandlerOptions,
  input: {
    diagnostic: ConsumerErrorDiagnostic;
    reason: string;
    payload?: unknown;
  },
): Promise<void> {
  if (options.dead_letter === undefined) return;
  try {
    await options.dead_letter.record({
      ...input.diagnostic,
      reason: input.reason,
      ...(input.payload === undefined
        ? {}
        : { redacted_payload: redactedRecord(input.payload) }),
    });
  } catch {
    // A diagnostics sink must not turn an already rejected request into an ACK.
  }
}

async function recordReplayAttempt(
  options: ConsumerHandlerOptions,
  event: AgentFeedDeliveryEvent,
  outcome: PersistenceOutcome,
  receivedAt: string,
): Promise<void> {
  if (options.replay_diagnostics?.recordAttempt === undefined) return;
  try {
    await options.replay_diagnostics.recordAttempt({
      event_id: event.event_id,
      attempt: event.attempt,
      outcome:
        outcome.status === "duplicate"
          ? "duplicate"
          : outcome.status === "quarantined"
            ? "rejected"
            : "accepted",
      diagnostic: diagnostic(
        `delivery_${outcome.status}`,
        `delivery ${outcome.status}`,
        receivedAt,
        event,
        {
          duplicate_kind: outcome.duplicate_kind ?? null,
        },
      ),
    });
  } catch {
    // Replay telemetry is intentionally best effort and can never affect ACK.
  }
}

async function persistVerifiedInput(
  options: ConsumerHandlerOptions,
  input: AtomicPersistenceInput,
): Promise<PersistenceOutcome> {
  markVerifiedAtomicPersistenceInput(input);
  return options.persistence.persist(input);
}

function receiptFor(
  event: AgentFeedDeliveryEvent,
  receivedAt: string,
  metadata: ReceiptMetadata,
  rawPayload: Record<string, unknown>,
  status: ReceiptInput["processing_status"],
  errorCode?: string,
): ReceiptInput {
  return {
    event_id: event.event_id,
    protocol_version: "0.1",
    stream_id: event.stream_id,
    run_id: event.run_id,
    finding_id: event.finding_id,
    event_type: event.event_type,
    received_at: receivedAt,
    occurred_at: event.occurred_at,
    attempt: event.attempt,
    payload_hash: metadata.payload_hash,
    transport_payload_hash: metadata.transport_payload_hash,
    delivery_id: metadata.delivery_id,
    signature_timestamp: metadata.signature_timestamp,
    signature_key_id: metadata.signature_key_id,
    delivery_attempt: metadata.delivery_attempt,
    raw_payload: rawPayload,
    processing_status: status,
    redaction_status: "complete",
    ...(errorCode === undefined ? {} : { error_code: errorCode }),
  };
}

interface ReceiptMetadata {
  payload_hash: string;
  transport_payload_hash: string;
  delivery_id: string;
  signature_timestamp: string;
  signature_key_id: string;
  delivery_attempt: number;
}

function stablePayloadHash(event: AgentFeedDeliveryEvent): string {
  // The destructuring copy intentionally omits only the top-level delivery
  // attempt. It does not mutate the parsed event or strip nested attributes.
  const { attempt: _attempt, ...withoutAttempt } = event;
  return prefixedSha256(canonicalJson(withoutAttempt));
}

function receiptMetadata(
  event: AgentFeedDeliveryEvent,
  rawBytes: Uint8Array,
  verification: SignatureVerification,
): ReceiptMetadata {
  if (
    verification.deliveryId === undefined ||
    verification.signatureTimestamp === undefined ||
    verification.keyId === undefined ||
    verification.deliveryAttempt === undefined
  ) {
    throw new TypeError("verified_delivery_metadata_missing");
  }
  return {
    payload_hash: stablePayloadHash(event),
    transport_payload_hash: prefixedSha256(rawBytes),
    delivery_id: verification.deliveryId,
    signature_timestamp: verification.signatureTimestamp,
    signature_key_id: verification.keyId,
    delivery_attempt: verification.deliveryAttempt,
  };
}

function findingFromPayload(
  event: AgentFeedDeliveryEvent,
): AgentFeedFinding | null {
  const finding = event.payload.finding;
  return isPlainRecord(finding)
    ? (finding as unknown as AgentFeedFinding)
    : null;
}

function evidenceFromPayload(
  event: AgentFeedDeliveryEvent,
): SubmittedEvidence[] | null {
  const evidence = event.payload.submitted_evidence;
  if (evidence === undefined) return [];
  return Array.isArray(evidence) ? (evidence as SubmittedEvidence[]) : null;
}

async function validate(
  validator: AgentFeedSchemaValidator,
  name: Parameters<AgentFeedSchemaValidator["validate"]>[0],
  value: unknown,
): Promise<string | null> {
  const result = await validator.validate(name, value);
  return result.valid ? null : summarizeSchemaIssues(result);
}

export function createAgentFeedConsumerHandler(
  options: ConsumerHandlerOptions,
): ConsumerHandler {
  if (!options.key_resolver || !options.persistence)
    throw new TypeError("key_resolver_and_persistence_required");
  const maxBodyBytes = options.max_body_bytes;
  const validatorPromise =
    options.schema_validator === undefined
      ? loadPublishedSchemaValidator()
      : Promise.resolve(options.schema_validator);
  const now = options.now ?? (() => new Date());

  return {
    async handle(request): Promise<HandlerResponse> {
      try {
        const receivedAt = receivedIso(request.received_at);
        let validator: AgentFeedSchemaValidator;
        try {
          validator = await validatorPromise;
        } catch {
          const diag = diagnostic(
            "schema_dependency_unavailable",
            "schema validation unavailable",
            receivedAt,
          );
          await recordDeadLetter(options, {
            diagnostic: diag,
            reason: "schema_dependency_unavailable",
          });
          return {
            status_code: 500,
            acknowledged: false,
            error_code: diag.code,
            diagnostics: diag,
          };
        }

        let verified: Awaited<ReturnType<typeof verifySignedRequest>>;
        try {
          verified = await verifySignedRequest(request, options.key_resolver, {
            now_seconds: Math.floor(now().getTime() / 1000),
            ...(options.replay_window_seconds === undefined
              ? {}
              : { replay_window_seconds: options.replay_window_seconds }),
            ...(maxBodyBytes === undefined
              ? {}
              : { max_body_bytes: maxBodyBytes }),
          });
        } catch (error) {
          const code = safeProtocolErrorCode(error, "signed_request_invalid");
          const status = code === "body_too_large" ? 413 : 401;
          const diag = diagnostic(
            code,
            "signed Agent Feed request rejected",
            receivedAt,
          );
          await recordDeadLetter(options, { diagnostic: diag, reason: code });
          return {
            status_code: status,
            acknowledged: false,
            error_code: code,
            diagnostics: diag,
          };
        }
        if (!verified.verification.valid) {
          const code = verified.verification.reason ?? "signature_invalid";
          const status = code === "body_too_large" ? 413 : 401;
          const partialEvent = {
            ...(typeof verified.parsed_body.event_id === "string"
              ? { event_id: verified.parsed_body.event_id }
              : {}),
            ...(typeof verified.parsed_body.stream_id === "string"
              ? { stream_id: verified.parsed_body.stream_id }
              : {}),
            ...(typeof verified.parsed_body.run_id === "string"
              ? { run_id: verified.parsed_body.run_id }
              : {}),
            ...(typeof verified.parsed_body.finding_id === "string"
              ? { finding_id: verified.parsed_body.finding_id }
              : {}),
          };
          const diag = diagnostic(
            code,
            "signed Agent Feed request rejected",
            receivedAt,
            partialEvent,
          );
          await recordDeadLetter(options, {
            diagnostic: diag,
            reason: code,
            payload: verified.parsed_body,
          });
          return {
            status_code: status,
            acknowledged: false,
            error_code: code,
            diagnostics: diag,
          };
        }

        const event = asEvent(verified.parsed_body);
        if (event === null) {
          const diag = diagnostic(
            "invalid_event_shape",
            "signed request is not a delivery event",
            receivedAt,
          );
          await recordDeadLetter(options, {
            diagnostic: diag,
            reason: "invalid_event_shape",
            payload: verified.parsed_body,
          });
          return {
            status_code: 422,
            acknowledged: false,
            error_code: diag.code,
            diagnostics: diag,
          };
        }
        const metadata = receiptMetadata(
          event,
          verified.raw_bytes,
          verified.verification,
        );
        const redactedPayload = redactedRecord(verified.parsed_body);
        const eventSchemaError = await validate(
          validator,
          "deliveryEvent",
          event,
        );
        if (eventSchemaError !== null) {
          const diag = diagnostic(
            "delivery_event_schema_invalid",
            eventSchemaError,
            receivedAt,
            event,
          );
          // A validly signed but structurally invalid event is retained as a
          // quarantined receipt, allowing operators to audit and replay it.
          const input: AtomicPersistenceInput = {
            receipt: receiptFor(
              event,
              receivedAt,
              metadata,
              redactedPayload,
              "quarantined",
              "delivery_event_schema_invalid",
            ),
            observation: null,
            submitted_evidence: [],
            run_lifecycle: null,
            quarantine_reason: "delivery_event_schema_invalid",
          };
          try {
            const outcome = await persistVerifiedInput(options, input);
            await recordReplayAttempt(options, event, outcome, receivedAt);
            return {
              status_code: 202,
              acknowledged: true,
              outcome,
              error_code: diag.code,
              diagnostics: diag,
            };
          } catch {
            await recordDeadLetter(options, {
              diagnostic: diag,
              reason: diag.code,
              payload: verified.parsed_body,
            });
            return {
              status_code: 500,
              acknowledged: false,
              error_code: diag.code,
              diagnostics: diag,
            };
          }
        }

        if (event.event_type === "finding.submitted") {
          const finding = findingFromPayload(event);
          const submittedEvidence = evidenceFromPayload(event);
          const findingSchemaError =
            finding === null
              ? "payload.finding is required"
              : await validate(validator, "finding", finding);
          const evidenceSchemaError =
            submittedEvidence === null
              ? "payload.submitted_evidence must be an array"
              : ((
                  await Promise.all(
                    submittedEvidence.map((item) =>
                      validate(validator, "evidence", item),
                    ),
                  )
                ).find((error): error is string => error !== null) ?? null);
          if (
            findingSchemaError !== null ||
            evidenceSchemaError !== null ||
            (finding !== null && finding.finding_id !== event.finding_id)
          ) {
            const reason =
              findingSchemaError !== null
                ? "finding_schema_invalid"
                : evidenceSchemaError !== null
                  ? "evidence_schema_invalid"
                  : "finding_id_mismatch";
            const message =
              findingSchemaError ??
              evidenceSchemaError ??
              "event finding_id does not match payload finding_id";
            const diag = diagnostic(reason, message, receivedAt, event);
            const input: AtomicPersistenceInput = {
              receipt: receiptFor(
                event,
                receivedAt,
                metadata,
                redactedPayload,
                "quarantined",
                reason,
              ),
              observation: null,
              submitted_evidence: [],
              run_lifecycle: null,
              quarantine_reason: reason,
            };
            try {
              const outcome = await persistVerifiedInput(options, input);
              await recordReplayAttempt(options, event, outcome, receivedAt);
              return {
                status_code: 202,
                acknowledged: true,
                outcome,
                error_code: reason,
                diagnostics: diag,
              };
            } catch {
              await recordDeadLetter(options, {
                diagnostic: diag,
                reason,
                payload: verified.parsed_body,
              });
              return {
                status_code: 500,
                acknowledged: false,
                error_code: reason,
                diagnostics: diag,
              };
            }
          }
          if (finding === null || submittedEvidence === null)
            throw new Error("unreachable_finding_validation");
          if (!isSupportedFindingType(finding.finding_type)) {
            const diag = diagnostic(
              "unsupported_finding_type",
              "unsupported finding type retained without routing",
              receivedAt,
              event,
              { finding_type: finding.finding_type },
            );
            const input: AtomicPersistenceInput = {
              receipt: receiptFor(
                event,
                receivedAt,
                metadata,
                redactedPayload,
                "quarantined",
                "unsupported_finding_type",
              ),
              observation: null,
              submitted_evidence: [],
              run_lifecycle: null,
              quarantine_reason: "unsupported_finding_type",
            };
            try {
              const outcome = await persistVerifiedInput(options, input);
              await recordReplayAttempt(options, event, outcome, receivedAt);
              return {
                status_code: 202,
                acknowledged: true,
                outcome,
                error_code: diag.code,
                diagnostics: diag,
              };
            } catch {
              await recordDeadLetter(options, {
                diagnostic: diag,
                reason: diag.code,
                payload: verified.parsed_body,
              });
              return {
                status_code: 500,
                acknowledged: false,
                error_code: diag.code,
                diagnostics: diag,
              };
            }
          }
          const mapped = mapFindingToObservation({
            event,
            finding,
            submitted_evidence: submittedEvidence,
            received_at: receivedAt,
          });
          if (mapped === null) throw new Error("supported_finding_did_not_map");
          const hostile = isHostileObservation(mapped.observation);
          const input: AtomicPersistenceInput = {
            receipt: receiptFor(
              event,
              receivedAt,
              metadata,
              redactedPayload,
              hostile ? "quarantined" : "received",
              hostile ? "hostile_security_flags" : undefined,
            ),
            observation: mapped.observation,
            submitted_evidence: mapped.submitted_evidence,
            run_lifecycle: null,
            ...(hostile ? { quarantine_reason: "hostile_security_flags" } : {}),
          };
          try {
            const outcome = await persistVerifiedInput(options, input);
            await recordReplayAttempt(options, event, outcome, receivedAt);
            const statusCode = outcome.status === "quarantined" ? 202 : 200;
            return { status_code: statusCode, acknowledged: true, outcome };
          } catch {
            const diag = diagnostic(
              "durable_persistence_failed",
              "durable persistence failed",
              receivedAt,
              event,
            );
            await recordDeadLetter(options, {
              diagnostic: diag,
              reason: diag.code,
              payload: verified.parsed_body,
            });
            return {
              status_code: 500,
              acknowledged: false,
              error_code: diag.code,
              diagnostics: diag,
            };
          }
        }

        let lifecycle: RunLifecycleMutation;
        let lifecycleErrorCode: string;
        let lifecycleSchemaError: string | null;
        if (event.event_type === "run.started") {
          const lifecycleEnvelope = runEnvelopeFromPayload(event);
          lifecycleErrorCode = "run_envelope_schema_invalid";
          lifecycleSchemaError =
            lifecycleEnvelope === null
              ? "a schema-valid run envelope is required"
              : !hasRunEnvelopeRequiredFields(lifecycleEnvelope)
                ? "run envelope is missing required fields"
                : await validate(validator, "runEnvelope", lifecycleEnvelope);
        } else {
          lifecycleErrorCode = "terminal_payload_schema_invalid";
          const terminalResult = validateTerminalDeliveryPayload(
            event.payload,
            event.event_type,
          );
          lifecycleSchemaError = terminalResult.valid
            ? null
            : summarizeSchemaIssues(terminalResult);
        }
        if (lifecycleSchemaError !== null) {
          const diag = diagnostic(
            lifecycleErrorCode,
            lifecycleSchemaError,
            receivedAt,
            event,
          );
          const input: AtomicPersistenceInput = {
            receipt: receiptFor(
              event,
              receivedAt,
              metadata,
              redactedPayload,
              "quarantined",
              lifecycleErrorCode,
            ),
            observation: null,
            submitted_evidence: [],
            run_lifecycle: null,
            quarantine_reason: lifecycleErrorCode,
          };
          try {
            const outcome = await persistVerifiedInput(options, input);
            await recordReplayAttempt(options, event, outcome, receivedAt);
            return {
              status_code: 202,
              acknowledged: true,
              outcome,
              error_code: diag.code,
              diagnostics: diag,
            };
          } catch {
            await recordDeadLetter(options, {
              diagnostic: diag,
              reason: diag.code,
              payload: verified.parsed_body,
            });
            return {
              status_code: 500,
              acknowledged: false,
              error_code: diag.code,
              diagnostics: diag,
            };
          }
        }
        try {
          lifecycle = mapRunLifecycle(event);
        } catch {
          const diag = diagnostic(
            "run_lifecycle_invalid",
            "run lifecycle rejected",
            receivedAt,
            event,
          );
          const input: AtomicPersistenceInput = {
            receipt: receiptFor(
              event,
              receivedAt,
              metadata,
              redactedPayload,
              "quarantined",
              diag.code,
            ),
            observation: null,
            submitted_evidence: [],
            run_lifecycle: null,
            quarantine_reason: diag.code,
          };
          try {
            const outcome = await persistVerifiedInput(options, input);
            await recordReplayAttempt(options, event, outcome, receivedAt);
            return {
              status_code: 202,
              acknowledged: true,
              outcome,
              error_code: diag.code,
              diagnostics: diag,
            };
          } catch {
            await recordDeadLetter(options, {
              diagnostic: diag,
              reason: diag.code,
              payload: verified.parsed_body,
            });
            return {
              status_code: 500,
              acknowledged: false,
              error_code: diag.code,
              diagnostics: diag,
            };
          }
        }
        const input: AtomicPersistenceInput = {
          receipt: receiptFor(
            event,
            receivedAt,
            metadata,
            redactedPayload,
            "received",
          ),
          observation: null,
          submitted_evidence: [],
          run_lifecycle: lifecycle,
        };
        try {
          const outcome = await persistVerifiedInput(options, input);
          await recordReplayAttempt(options, event, outcome, receivedAt);
          return {
            status_code: outcome.status === "quarantined" ? 202 : 200,
            acknowledged: true,
            outcome,
          };
        } catch {
          const diag = diagnostic(
            "durable_persistence_failed",
            "durable persistence failed",
            receivedAt,
            event,
          );
          await recordDeadLetter(options, {
            diagnostic: diag,
            reason: diag.code,
            payload: verified.parsed_body,
          });
          return {
            status_code: 500,
            acknowledged: false,
            error_code: diag.code,
            diagnostics: diag,
          };
        }
      } catch {
        const receivedAt = now().toISOString();
        const diag = diagnostic(
          "consumer_processing_failed",
          "request processing failed",
          receivedAt,
        );
        await recordDeadLetter(options, {
          diagnostic: diag,
          reason: diag.code,
        });
        return {
          status_code: 500,
          acknowledged: false,
          error_code: diag.code,
          diagnostics: diag,
        };
      }
    },
  };
}

export async function handleAgentFeedEvent(
  request: Parameters<ConsumerHandler["handle"]>[0],
  options: ConsumerHandlerOptions,
): Promise<HandlerResponse> {
  return createAgentFeedConsumerHandler(options).handle(request);
}
