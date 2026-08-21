import {
  assertFinding,
  assertSubmittedEvidence,
  validateTerminalDeliveryPayload,
} from "./schema.js";
import type {
  AgentFeedDeliveryEvent,
  AgentFeedFinding,
  AgentFeedTerminalPayload,
  FindingSubject,
  RewardChangeType,
  RunLifecycleMutation,
  SourceObservation,
  SubmittedEvidence,
  SubmittedEvidenceLead,
} from "./types.js";
import {
  canonicalJson,
  findSuspiciousStrings,
  isPlainRecord,
  normalizeText,
  prefixedSha256,
  trimCollapse,
  uniqueSorted,
} from "./util.js";

const SUPPORTED_FINDING_TYPES = new Set([
  "rewards.program_change",
  "rewards.campaign",
  "rewards.merchant_acceptance",
  "rewards.transfer_change",
  "rewards.source_relocation",
]);

const hostileSecurityFlags = new Set([
  "embedded_instruction",
  "attempted_authority_escalation",
  "credential_exposure",
  "secret_exposure",
  "prompt_injection",
  "exfiltration_attempt",
  "sensitive_content",
]);

const transportOnlyAttributeKeys = new Set([
  "event_id",
  "run_id",
  "finding_id",
  "attempt",
  "producer_dedupe_key",
  "evidence_refs",
  "security_flags",
  "agent_confidence",
]);

const domainAttributeAliases = [
  "change_kind",
  "change_type",
  "program_id",
  "program_identity",
  "program_name",
  "campaign_id",
  "campaign_identity",
  "campaign_name",
  "offer_id",
  "merchant_id",
  "merchant_identity",
  "merchant_name",
  "source_id",
  "source_ids",
  "source_keys",
  "route",
  "route_id",
  "funding_route",
  "transfer_route",
  "eligibility",
  "eligible",
  "reward_rate",
  "rate",
  "rate_bps",
  "cap",
  "cap_units",
  "cap_amount",
  "minimum_spend",
  "maximum_reward",
  "expiry",
  "effective_date",
  "effective_from",
  "effective_to",
  "claim",
  "claim_normalized",
  "benefit",
  "unit",
  "currency",
  "terms",
  "accepted_merchants",
  "relocated_to",
  "old_locator",
  "new_locator",
] as const;

function normalizeDomainValue(value: unknown): unknown {
  if (typeof value === "string") {
    const collapsed = trimCollapse(value);
    if (
      collapsed.length > 0 &&
      /(?:date|from|to|at|expiry)/iu.test(collapsed) &&
      Number.isFinite(Date.parse(collapsed))
    ) {
      return new Date(collapsed).toISOString();
    }
    return collapsed;
  }
  if (Array.isArray(value)) {
    const normalized = value.map(normalizeDomainValue);
    return normalized.sort((left, right) =>
      canonicalJson(left).localeCompare(canonicalJson(right)),
    );
  }
  if (isPlainRecord(value)) {
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value).sort(([left], [right]) =>
      left.localeCompare(right),
    )) {
      output[normalizeText(key)] = normalizeDomainValue(child);
    }
    return output;
  }
  return value;
}

function normalizeInstant(value: string | null): string | null {
  if (value === null) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed)
    ? new Date(parsed).toISOString()
    : trimCollapse(value);
}

function normalizedSubjects(
  subjects: readonly FindingSubject[],
): FindingSubject[] {
  return subjects
    .map((subject) => ({
      type: normalizeText(subject.type),
      id: subject.id === null ? null : normalizeText(subject.id),
      name: subject.name === null ? null : trimCollapse(subject.name),
    }))
    .sort((left, right) =>
      canonicalJson(left).localeCompare(canonicalJson(right)),
    );
}

function domainAttributes(
  attributes: Record<string, unknown>,
): Record<string, unknown> {
  const allowlist = new Set<string>(domainAttributeAliases);
  const selected: Record<string, unknown> = Object.create(null) as Record<
    string,
    unknown
  >;
  for (const [key, value] of Object.entries(attributes)) {
    const normalizedKey = normalizeText(key).replaceAll(" ", "_");
    if (transportOnlyAttributeKeys.has(normalizedKey)) continue;
    // Keep known reward fields and unknown JSON fields as normalized claims:
    // a future protocol field can affect semantic identity without affecting
    // transport identity, while transport metadata is explicitly excluded.
    if (
      allowlist.has(normalizedKey) ||
      !/^(?:trace|delivery|transport|signature)/iu.test(normalizedKey)
    ) {
      selected[normalizedKey] = normalizeDomainValue(value);
    }
  }
  return selected;
}

function rewardChangeType(finding: AgentFeedFinding): RewardChangeType {
  const requested =
    finding.attributes.change_type ?? finding.attributes.change_kind;
  const value =
    typeof requested === "string"
      ? normalizeText(requested).replaceAll(" ", "_")
      : "";
  const valid = new Set<RewardChangeType>([
    "reward_rate",
    "eligibility",
    "campaign",
    "cap",
    "merchant_acceptance",
    "funding_route",
    "transfer",
    "expiry",
    "announcement",
    "unknown",
  ]);
  if (valid.has(value as RewardChangeType)) return value as RewardChangeType;
  switch (finding.finding_type) {
    case "rewards.campaign":
      return "campaign";
    case "rewards.merchant_acceptance":
      return "merchant_acceptance";
    case "rewards.transfer_change":
      return "transfer";
    case "rewards.source_relocation":
      return "announcement";
    case "rewards.program_change":
      return "announcement";
    default:
      return "unknown";
  }
}

function effectiveTime(
  finding: AgentFeedFinding,
): AgentFeedFinding["effective_time"] {
  const input = finding.effective_time;
  return {
    occurred_at: input.occurred_at,
    effective_from: input.effective_from,
    effective_to: input.effective_to,
  };
}

export interface NormalizedRewardDomainFields {
  finding_type: string;
  change_type: RewardChangeType;
  subjects: FindingSubject[];
  effective_time: AgentFeedFinding["effective_time"];
  source_ids: string[];
  program_identity: string | null;
  campaign_identity: string | null;
  claim: { title: string; summary: string };
  attributes: Record<string, unknown>;
}

/**
 * Version-1 semantic input. Notice that event/run/finding IDs, attempts,
 * producer confidence, evidence references, and security flags are omitted.
 */
export function normalizeRewardDomainFields(
  finding: AgentFeedFinding,
  sourceIds: readonly string[] = [],
): NormalizedRewardDomainFields {
  const attrs = domainAttributes(finding.attributes);
  const pickString = (...keys: string[]): string | null => {
    for (const key of keys) {
      const value = attrs[key];
      if (typeof value === "string" && value.length > 0)
        return normalizeText(value);
    }
    return null;
  };
  return {
    finding_type: normalizeText(finding.finding_type),
    change_type: rewardChangeType(finding),
    subjects: normalizedSubjects(finding.subjects),
    effective_time: {
      occurred_at: normalizeInstant(finding.effective_time.occurred_at),
      effective_from: normalizeInstant(finding.effective_time.effective_from),
      effective_to: normalizeInstant(finding.effective_time.effective_to),
    },
    source_ids: uniqueSorted(sourceIds.map(normalizeText)),
    program_identity: pickString(
      "program_identity",
      "program_id",
      "program_name",
    ),
    campaign_identity: pickString(
      "campaign_identity",
      "campaign_id",
      "campaign_name",
      "offer_id",
    ),
    claim: {
      title: normalizeText(finding.title),
      summary: normalizeText(finding.summary),
    },
    attributes: attrs,
  };
}

export function computeSemanticFingerprint(
  finding: AgentFeedFinding,
  sourceIds: readonly string[] = [],
): string {
  return prefixedSha256(
    canonicalJson(normalizeRewardDomainFields(finding, sourceIds)),
  );
}

function slug(value: string): string {
  const result = normalizeText(value)
    .replace(/[^a-z0-9_-]+/gu, "_")
    .replace(/^_+|_+$/gu, "");
  return result.slice(0, 96) || "finding";
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter(
          (item): item is string =>
            typeof item === "string" && trimCollapse(item).length > 0,
        )
        .map(trimCollapse)
    : [];
}

function deriveSourceIds(
  finding: AgentFeedFinding,
  submittedEvidence: readonly SubmittedEvidence[],
): string[] {
  const attrs = finding.attributes;
  const fromAttributes = [
    ...stringArray(attrs.source_ids),
    ...stringArray(attrs.source_keys),
    ...(typeof attrs.source_id === "string" ? [attrs.source_id] : []),
  ];
  const fromEvidence = submittedEvidence
    .map((evidence) => evidence.source.source_id)
    .filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    );
  return uniqueSorted([...fromAttributes, ...fromEvidence]);
}

function securityFlags(
  finding: AgentFeedFinding,
  evidence: readonly SubmittedEvidence[],
): string[] {
  const supplied = [...finding.security_flags];
  const suspicious = findSuspiciousStrings({
    attributes: finding.attributes,
    title: finding.title,
    summary: finding.summary,
  });
  for (const item of evidence) {
    if (item.handling.contains_secrets) supplied.push("credential_exposure");
    if (item.handling.contains_personal_data) supplied.push("personal_data");
    if (item.handling.redistribution_restricted)
      supplied.push("redistribution_restricted");
  }
  return uniqueSorted([...supplied, ...suspicious]);
}

function hostile(flags: readonly string[]): boolean {
  return flags.some((flag) =>
    hostileSecurityFlags.has(normalizeText(flag).replaceAll(" ", "_")),
  );
}

export interface MapFindingInput {
  event: AgentFeedDeliveryEvent;
  finding: AgentFeedFinding;
  submitted_evidence?: readonly SubmittedEvidence[];
  received_at: string;
}

export interface MappedFinding {
  observation: SourceObservation;
  submitted_evidence: SubmittedEvidenceLead[];
}

/** Map only supported reward findings; callers must quarantine unsupported types. */
export function mapFindingToObservation(
  input: MapFindingInput,
): MappedFinding | null {
  if (!SUPPORTED_FINDING_TYPES.has(input.finding.finding_type)) return null;
  assertFinding(input.finding);
  const evidence = [...(input.submitted_evidence ?? [])];
  for (const item of evidence) assertSubmittedEvidence(item);
  const sourceIds = deriveSourceIds(input.finding, evidence);
  const fingerprint = computeSemanticFingerprint(input.finding, sourceIds);
  const flags = securityFlags(input.finding, evidence);
  const observationId = `so_${slug(input.finding.finding_id)}_${fingerprint.slice("sha256:".length, "sha256:".length + 16)}`;
  const status = hostile(flags)
    ? "rejected"
    : input.finding.assessment.evidence_completeness === "complete"
      ? "needs_review"
      : "needs_evidence";
  const observation: SourceObservation = {
    observation_id: observationId,
    agent_feed: {
      protocol_version: "0.1",
      event_id: input.event.event_id,
      stream_id: input.event.stream_id,
      run_id: input.event.run_id,
      finding_id: input.finding.finding_id,
    },
    source_ids: sourceIds,
    subjects: input.finding.subjects,
    change_type: rewardChangeType(input.finding),
    summary: input.finding.summary,
    effective_time: effectiveTime(input.finding),
    discovery_assessment: {
      source_authority_claim: input.finding.assessment.source_authority_claim,
      evidence_completeness: input.finding.assessment.evidence_completeness,
      agent_confidence: input.finding.assessment.agent_confidence,
    },
    submitted_evidence_refs: uniqueSorted(input.finding.evidence_refs),
    canonical_evidence_ids: [],
    semantic_fingerprint_version: 1,
    semantic_fingerprint: fingerprint,
    status,
    security_flags: flags,
    raw_attributes: input.finding.attributes,
    created_at: input.received_at,
    updated_at: input.received_at,
  };
  const submitted = evidence.map(
    (evidenceItem) =>
      ({
        observation_id: observationId,
        agent_feed_evidence_id: evidenceItem.evidence_id,
        submitted_payload: evidenceItem,
        promotion_status: hostile(flags) ? "rejected" : "lead_only",
      }) satisfies SubmittedEvidenceLead,
  );
  return { observation, submitted_evidence: submitted };
}

function recordNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function payloadRecord(event: AgentFeedDeliveryEvent): Record<string, unknown> {
  return event.payload;
}

/**
 * Started-run payloads use the published run envelope either directly or
 * under one of the documented wrapper names. Terminal deliveries use the
 * separate compact producer payload validated below.
 */
export function runEnvelopeFromPayload(
  event: AgentFeedDeliveryEvent,
): Record<string, unknown> | null {
  const payload = payloadRecord(event);
  if (isPlainRecord(payload.run_envelope)) return payload.run_envelope;
  if (isPlainRecord(payload.run)) return payload.run;
  const envelopeMarkers = [
    "protocol_version",
    "producer",
    "task",
    "started_at",
    "completed_at",
    "status",
    "expected_scope",
    "actual_scope",
    "stats",
    "parent_run_id",
    "error_summary",
    "metadata",
  ];
  return envelopeMarkers.some((key) => Object.hasOwn(payload, key))
    ? payload
    : null;
}

const runEnvelopeRequiredFields = [
  "protocol_version",
  "run_id",
  "stream_id",
  "producer",
  "task",
  "started_at",
  "completed_at",
  "status",
  "expected_scope",
  "actual_scope",
  "stats",
  "parent_run_id",
  "error_summary",
  "metadata",
] as const;

export function hasRunEnvelopeRequiredFields(
  value: Record<string, unknown>,
): boolean {
  return runEnvelopeRequiredFields.every((field) =>
    Object.hasOwn(value, field),
  );
}

function requireRunEnvelope(
  event: AgentFeedDeliveryEvent,
): Record<string, unknown> {
  const envelope = runEnvelopeFromPayload(event);
  if (envelope === null || !hasRunEnvelopeRequiredFields(envelope)) {
    throw new TypeError("run_envelope_required");
  }
  if (
    envelope.protocol_version !== "0.1" ||
    envelope.run_id !== event.run_id ||
    envelope.stream_id !== event.stream_id
  ) {
    throw new TypeError("run_envelope_context_mismatch");
  }
  return envelope;
}

export function mapRunLifecycle(
  event: AgentFeedDeliveryEvent,
): RunLifecycleMutation {
  if (event.event_type === "run.started") {
    const envelope = requireRunEnvelope(event);
    if (envelope.status !== "running")
      throw new TypeError("run_started_status_mismatch");
    return {
      kind: "started",
      stream_id: event.stream_id,
      run_id: event.run_id,
      event_id: event.event_id,
      status: "running",
      completed_at: null,
      findings_submitted: null,
      completed_zero_findings: false,
      absent_run: false,
      expected_scope: isPlainRecord(envelope.expected_scope)
        ? envelope.expected_scope
        : null,
    };
  }
  const validation = validateTerminalDeliveryPayload(
    event.payload,
    event.event_type,
  );
  if (!validation.valid) throw new TypeError("terminal_payload_schema_invalid");
  const payload = event.payload as unknown as AgentFeedTerminalPayload;
  const status = payload.status;
  const findingsSubmitted = recordNumber(payload.stats.findings_submitted);
  return {
    kind: "terminal",
    stream_id: event.stream_id,
    run_id: event.run_id,
    event_id: event.event_id,
    status,
    completed_at: payload.completed_at,
    findings_submitted: findingsSubmitted,
    completed_zero_findings: status === "completed" && findingsSubmitted === 0,
    absent_run: false,
    actual_scope: payload.actual_scope,
    expected_scope: payload.expected_scope,
    error_summary: payload.error_summary,
  };
}

export function isSupportedFindingType(
  value: string,
): value is `rewards.${"program_change" | "campaign" | "merchant_acceptance" | "transfer_change" | "source_relocation"}` {
  return SUPPORTED_FINDING_TYPES.has(value);
}

export function isHostileObservation(observation: SourceObservation): boolean {
  return (
    observation.status === "rejected" || hostile(observation.security_flags)
  );
}
