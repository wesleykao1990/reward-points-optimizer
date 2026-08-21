import { tryValidateDocument } from "@jro/contracts";
import { hashCandidate, hashCanonical, hashDefinition } from "./canonical.js";
import {
  NANACO_PILOT_CANDIDATE,
  NANACO_PILOT_CANONICAL_EVIDENCE_ID,
  NANACO_PILOT_COVERAGE,
  NANACO_PILOT_COVERAGE_HASH,
  NANACO_PILOT_DEFINITION_HASH,
  NANACO_PILOT_FAMILY_ID,
  NANACO_PILOT_RULE_ID,
  NANACO_PILOT_SOURCE_ID,
  NANACO_PILOT_SOURCE_ROLE_ID,
} from "./nanaco-pilot.generated.js";
import { scanPublicValue } from "./security.js";
import type {
  AdmissionIssue,
  AdmissionRejected,
  NanacoCanonicalEvidenceVerifier,
  ProvisionalAdmissionResult,
  ProvisionalRuleCandidate,
  ProvisionalRuleEnvelope,
  ProvisionalRuleStore,
  Sha256,
  TransitionResult,
} from "./types.js";

const EXACT_SOURCE_IDS = Object.freeze([NANACO_PILOT_SOURCE_ID]);

/**
 * The first economic canary is deliberately a single, exact Agent Feed
 * finding.  The feed remains an untrusted transport; these constants only
 * identify the one supported mapping and never make the finding canonical.
 */
export const NANACO_PILOT_FINDING_ID =
  "nanaco-economic-ui-canary-20260821-v1" as const;
export const NANACO_PILOT_PROGRAM_ID = "program.jp.nanaco" as const;
export const NANACO_PILOT_MERCHANT_ID = "merchant.seveneleven" as const;

const NANACO_CANARY_ATTRIBUTE_KEYS = new Set([
  "change_type",
  "program_id",
  "merchant_id",
  "reward_rate",
  "eligible_product_class",
  "posting_timing",
  "product_exclusions_apply",
  "canonical_publication",
  "human_verified",
  // These identity aliases are accepted only when present and exact.  The
  // live Agent Feed finding does not need to know Rewards' internal family
  // and role IDs, so they remain optional in the raw finding attributes.
  "source_id",
  "source_ids",
  "family_id",
  "p0_family_id",
  "source_role_id",
  "known_source_ids",
]);

const NANACO_ECONOMIC_ATTRIBUTE_KEYS = new Set([
  "change_type",
  "program_id",
  "merchant_id",
  "reward_rate",
  "eligible_product_class",
  "posting_timing",
  "product_exclusions_apply",
  "canonical_publication",
  "human_verified",
]);

function rejected(
  code: AdmissionIssue["code"],
  path: string,
  message: string,
): AdmissionRejected {
  return Object.freeze({
    ok: false as const,
    status: "quarantined" as const,
    issues: Object.freeze([{ code, path, message }]),
  });
}

function pilotArtifactCheck(): void {
  if (
    hashDefinition(NANACO_PILOT_CANDIDATE.rule) !== NANACO_PILOT_DEFINITION_HASH
  )
    throw new Error("nanaco_pilot_artifact_drift");
  if (hashCanonical(NANACO_PILOT_COVERAGE) !== NANACO_PILOT_COVERAGE_HASH)
    throw new Error("nanaco_pilot_coverage_drift");
  if (NANACO_PILOT_CANDIDATE.rule.rule_id !== NANACO_PILOT_RULE_ID)
    throw new Error("nanaco_pilot_rule_identity_drift");
  if (NANACO_PILOT_CANDIDATE.p0_family_id !== NANACO_PILOT_FAMILY_ID)
    throw new Error("nanaco_pilot_family_identity_drift");
  if (NANACO_PILOT_CANDIDATE.source_role_id !== NANACO_PILOT_SOURCE_ROLE_ID)
    throw new Error("nanaco_pilot_role_identity_drift");
  if (
    NANACO_PILOT_CANDIDATE.source_ids.length !== 1 ||
    NANACO_PILOT_CANDIDATE.source_ids[0] !== NANACO_PILOT_SOURCE_ID
  )
    throw new Error("nanaco_pilot_source_identity_drift");
}

function scannedObservation(
  value: unknown,
):
  | { readonly record: Record<string, unknown> }
  | { readonly rejected: AdmissionRejected } {
  const scan = scanPublicValue(value);
  if (!scan.valid)
    return {
      rejected: Object.freeze({
        ok: false as const,
        status: "quarantined" as const,
        issues: Object.freeze([...scan.issues]),
      }),
    };
  if (
    !scan.value ||
    typeof scan.value !== "object" ||
    Array.isArray(scan.value)
  )
    return {
      rejected: rejected(
        "observation_invalid",
        "/observation",
        "nanaco pilot observation must be an object",
      ),
    };
  return { record: scan.value as Record<string, unknown> };
}

function sourceIdsExact(record: Record<string, unknown>): boolean {
  const sourceIds = record.source_ids;
  return (
    Array.isArray(sourceIds) &&
    sourceIds.length === EXACT_SOURCE_IDS.length &&
    sourceIds[0] === EXACT_SOURCE_IDS[0]
  );
}

function exactCanaryFinding(record: Record<string, unknown>): boolean {
  const feed = record.agent_feed;
  return (
    !!feed &&
    typeof feed === "object" &&
    !Array.isArray(feed) &&
    (feed as Record<string, unknown>).finding_id === NANACO_PILOT_FINDING_ID
  );
}

function authorityIsPrimary(record: Record<string, unknown>): boolean {
  const assessment = record.discovery_assessment;
  return (
    !!assessment &&
    typeof assessment === "object" &&
    !Array.isArray(assessment) &&
    (assessment as Record<string, unknown>).source_authority_claim === "primary"
  );
}

function rawAttributeIdentityMatches(record: Record<string, unknown>): boolean {
  const raw = record.raw_attributes;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return true;
  const attributes = raw as Record<string, unknown>;
  if (
    Object.keys(attributes).some(
      (key) => !NANACO_CANARY_ATTRIBUTE_KEYS.has(key),
    )
  )
    return false;
  const family = attributes.family_id ?? attributes.p0_family_id;
  const role = attributes.source_role_id;
  const source = attributes.source_id;
  const sourceIds = attributes.source_ids ?? attributes.known_source_ids;
  const sourceMatches =
    source === undefined || source === NANACO_PILOT_SOURCE_ID;
  const sourceIdsMatch =
    sourceIds === undefined ||
    (Array.isArray(sourceIds) &&
      sourceIds.length === 1 &&
      sourceIds[0] === NANACO_PILOT_SOURCE_ID);
  return (
    (family === undefined || family === NANACO_PILOT_FAMILY_ID) &&
    (role === undefined || role === NANACO_PILOT_SOURCE_ROLE_ID) &&
    sourceMatches &&
    sourceIdsMatch
  );
}

function exactNanacoEconomicAttributes(
  record: Record<string, unknown>,
): boolean {
  const raw = record.raw_attributes;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const attributes = raw as Record<string, unknown>;
  const economicKeys = Object.keys(attributes).filter((key) =>
    NANACO_ECONOMIC_ATTRIBUTE_KEYS.has(key),
  );
  if (economicKeys.length !== NANACO_ECONOMIC_ATTRIBUTE_KEYS.size) return false;

  const rewardRate = attributes.reward_rate;
  if (
    !rewardRate ||
    typeof rewardRate !== "object" ||
    Array.isArray(rewardRate)
  )
    return false;
  const rate = rewardRate as Record<string, unknown>;
  if (
    Object.keys(rate).length !== 3 ||
    rate.reward_units !== "1" ||
    rate.spend_jpy !== 200 ||
    rate.spend_basis !== "tax_exclusive"
  )
    return false;

  return (
    attributes.change_type === "reward_rate" &&
    attributes.program_id === NANACO_PILOT_PROGRAM_ID &&
    attributes.merchant_id === NANACO_PILOT_MERCHANT_ID &&
    attributes.eligible_product_class === "ordinary" &&
    attributes.posting_timing === "immediate_for_listed_merchant" &&
    attributes.product_exclusions_apply === true &&
    attributes.canonical_publication === false &&
    attributes.human_verified === false
  );
}

function exactNanacoSubjects(record: Record<string, unknown>): boolean {
  const subjects = record.subjects;
  if (!Array.isArray(subjects) || subjects.length !== 2) return false;
  const identities = subjects.map((subject) => {
    if (!subject || typeof subject !== "object" || Array.isArray(subject))
      return null;
    const value = subject as Record<string, unknown>;
    return `${value.type ?? ""}\u0000${value.id ?? ""}`;
  });
  return (
    identities.includes(`loyalty_program\u0000${NANACO_PILOT_PROGRAM_ID}`) &&
    identities.includes(`merchant\u0000${NANACO_PILOT_MERCHANT_ID}`)
  );
}

function canonicalEvidenceExact(record: Record<string, unknown>): boolean {
  const evidence = record.canonical_evidence_ids;
  return (
    Array.isArray(evidence) &&
    evidence.length === 1 &&
    evidence[0] === NANACO_PILOT_CANONICAL_EVIDENCE_ID
  );
}

function candidateForObservation(
  record: Record<string, unknown>,
): ProvisionalRuleCandidate {
  // Only the observation identity is mapped from the scanned observation.  The
  // rule, source, family, role, extractor, and machine-check record all come
  // from the generated artifact and cannot be supplied by a caller.
  return {
    ...NANACO_PILOT_CANDIDATE,
    observation_id:
      typeof record.observation_id === "string" ? record.observation_id : "",
    observation_fingerprint:
      typeof record.semantic_fingerprint === "string"
        ? record.semantic_fingerprint
        : "",
  };
}

function observationForAdmission(
  record: Record<string, unknown>,
): Record<string, unknown> {
  // A complete, primary, needs_review finding with producer evidence is
  // machine-checkable even though its evidence remains lead-only.  Canonical
  // evidence promotion is a separate activation gate and must not be used to
  // downgrade this correction-sensitive experimental row.
  return record;
}

function preparePilotAdmission(observation: unknown):
  | {
      readonly candidate: ProvisionalRuleCandidate;
      readonly observation: Record<string, unknown>;
    }
  | { readonly rejected: AdmissionRejected } {
  pilotArtifactCheck();
  const scanned = scannedObservation(observation);
  if ("rejected" in scanned) return scanned;
  const record = scanned.record;
  if (!sourceIdsExact(record))
    return {
      rejected: rejected(
        "source_observation_mismatch",
        "/observation/source_ids",
        "nanaco pilot requires exactly the trusted shopping-earning source",
      ),
    };
  if (!exactCanaryFinding(record))
    return {
      rejected: rejected(
        "semantic_support_mismatch",
        "/observation/agent_feed/finding_id",
        "nanaco pilot supports only the exact economic canary finding",
      ),
    };
  if (!authorityIsPrimary(record))
    return {
      rejected: rejected(
        "source_authority_mismatch",
        "/observation/discovery_assessment/source_authority_claim",
        "nanaco pilot requires a primary source authority claim",
      ),
    };
  const assessment = record.discovery_assessment;
  if (
    !assessment ||
    typeof assessment !== "object" ||
    Array.isArray(assessment) ||
    (assessment as Record<string, unknown>).evidence_completeness !==
      "complete" ||
    record.status !== "needs_review" ||
    !Array.isArray(record.submitted_evidence_refs) ||
    record.submitted_evidence_refs.length === 0
  )
    return {
      rejected: rejected(
        "observation_status_forbidden",
        "/observation",
        "nanaco pilot requires a complete needs_review observation with submitted evidence",
      ),
    };
  if (
    !Array.isArray(record.security_flags) ||
    record.security_flags.length !== 0
  )
    return {
      rejected: rejected(
        "observation_hostile",
        "/observation/security_flags",
        "security-flagged nanaco observations cannot become experimental candidates",
      ),
    };
  if (!exactNanacoSubjects(record))
    return {
      rejected: rejected(
        "semantic_support_mismatch",
        "/observation/subjects",
        "nanaco pilot requires the exact nanaco and Seven-Eleven subjects",
      ),
    };
  if (!exactNanacoEconomicAttributes(record))
    return {
      rejected: rejected(
        "semantic_support_mismatch",
        "/observation/raw_attributes",
        "nanaco pilot requires the exact supported reward-rate attributes",
      ),
    };
  if (!rawAttributeIdentityMatches(record))
    return {
      rejected: rejected(
        "source_role_coverage_mismatch",
        "/observation/raw_attributes",
        "nanaco pilot observation family and role do not match the sealed mapping",
      ),
    };
  if (!Array.isArray(record.canonical_evidence_ids))
    return {
      rejected: rejected(
        "observation_invalid",
        "/observation/canonical_evidence_ids",
        "canonical_evidence_ids must be an array",
      ),
    };
  if (record.canonical_evidence_ids.length !== 0)
    return {
      rejected: rejected(
        "observation_binding_mismatch",
        "/observation/canonical_evidence_ids",
        "economic canary intake does not accept asserted canonical evidence",
      ),
    };
  return {
    candidate: candidateForObservation(record),
    observation: observationForAdmission(record),
  };
}

function activationFailure(message: string): TransitionResult {
  return Object.freeze({
    ok: false as const,
    code: "activation_not_allowed" as const,
    message,
  });
}

async function canonicalEvidenceVerified(
  verifier: NanacoCanonicalEvidenceVerifier,
  observationId: string,
): Promise<boolean> {
  if (typeof verifier !== "function") return false;
  try {
    return (
      (await verifier({
        observation_id: observationId,
        evidence_id: NANACO_PILOT_CANONICAL_EVIDENCE_ID,
        source_id: NANACO_PILOT_SOURCE_ID,
      })) === true
    );
  } catch {
    return false;
  }
}

function exactEnvelopeForObservation(
  envelope: ProvisionalRuleEnvelope,
  candidate: ProvisionalRuleCandidate,
  candidateHash: Sha256,
): boolean {
  if (
    envelope.candidate_hash !== candidateHash ||
    envelope.definition_hash !== NANACO_PILOT_DEFINITION_HASH ||
    hashDefinition(envelope.rule) !== NANACO_PILOT_DEFINITION_HASH ||
    envelope.candidate.rule.rule_id !== NANACO_PILOT_RULE_ID ||
    envelope.candidate.p0_family_id !== NANACO_PILOT_FAMILY_ID ||
    envelope.candidate.source_role_id !== NANACO_PILOT_SOURCE_ROLE_ID ||
    envelope.candidate.source_ids.length !== 1 ||
    envelope.candidate.source_ids[0] !== NANACO_PILOT_SOURCE_ID
  )
    return false;
  return (
    hashCandidate(candidate, NANACO_PILOT_DEFINITION_HASH) === candidateHash &&
    hashCanonical(candidate) === hashCanonical(envelope.candidate)
  );
}

/**
 * Admit the one sealed nanaco economic candidate against an untrusted source
 * observation.  There is deliberately no candidate or coverage argument.
 */
export function admitNanacoEconomicPilot(
  store: ProvisionalRuleStore,
  observation: unknown,
): ProvisionalAdmissionResult {
  const prepared = preparePilotAdmission(observation);
  if ("rejected" in prepared) return prepared.rejected;
  const result = store.admit({
    candidate: prepared.candidate,
    observation: prepared.observation,
    p0_coverage_index: NANACO_PILOT_COVERAGE,
  });
  return result;
}

/**
 * Trusted-host accessors for the sealed executable artifact.  These return
 * defensive copies; callers cannot mutate the generated candidate that is
 * used by admission and lifecycle checks.  They are intentionally not part
 * of any browser DTO.
 */
export function getNanacoEconomicPilotCandidate(): ProvisionalRuleCandidate {
  pilotArtifactCheck();
  return structuredClone(NANACO_PILOT_CANDIDATE);
}

export function getNanacoEconomicPilotRule(): ProvisionalRuleCandidate["rule"] {
  pilotArtifactCheck();
  return structuredClone(NANACO_PILOT_CANDIDATE.rule);
}

/**
 * Activate only an exact sealed nanaco candidate whose observation has the
 * canonical shopping-earning evidence and complete review-ready status. The
 * host-supplied verifier is awaited because the observation's evidence ID is
 * an untrusted assertion; verifier authenticity/isolation is a host concern.
 */
export async function activateNanacoEconomicPilot(
  store: ProvisionalRuleStore,
  candidateHash: Sha256,
  observation: unknown,
  occurredAt: string,
  canonicalEvidenceVerifier: NanacoCanonicalEvidenceVerifier,
  reason?: string,
): Promise<TransitionResult> {
  pilotArtifactCheck();
  const current = store.get(candidateHash);
  if (!current)
    return Object.freeze({
      ok: false as const,
      code: "candidate_not_found" as const,
      message: "candidate hash is not in the process-local nanaco pilot store",
    });
  const scanned = scannedObservation(observation);
  if ("rejected" in scanned) return activationFailure("observation is invalid");
  const record = scanned.record;
  if (
    !sourceIdsExact(record) ||
    !authorityIsPrimary(record) ||
    !rawAttributeIdentityMatches(record) ||
    !canonicalEvidenceExact(record)
  )
    return activationFailure(
      "nanaco pilot activation requires exact primary source binding and canonical evidence",
    );
  const assessment = record.discovery_assessment as Record<string, unknown>;
  if (
    record.status !== "needs_review" ||
    assessment.evidence_completeness !== "complete" ||
    !Array.isArray(record.submitted_evidence_refs) ||
    record.submitted_evidence_refs.length === 0
  )
    return activationFailure(
      "nanaco pilot activation requires a complete needs_review observation",
    );
  const contract = tryValidateDocument(record, "source-observation");
  if (!contract.valid)
    return activationFailure("observation contract is invalid");
  const candidate = candidateForObservation(record);
  if (
    candidate.observation_id !== current.candidate.observation_id ||
    candidate.observation_fingerprint !==
      current.candidate.observation_fingerprint ||
    !exactEnvelopeForObservation(current, candidate, candidateHash)
  )
    return activationFailure(
      "candidate is not the sealed nanaco pilot artifact",
    );
  if (
    !(await canonicalEvidenceVerified(
      canonicalEvidenceVerifier,
      candidate.observation_id,
    ))
  )
    return activationFailure(
      "canonical evidence verifier did not approve the exact binding",
    );
  return store.activate(candidateHash, occurredAt, reason);
}

export function createNanacoEconomicPilot(
  store: ProvisionalRuleStore,
  canonicalEvidenceVerifier: NanacoCanonicalEvidenceVerifier,
): import("./types.js").NanacoEconomicPilotRoute {
  return Object.freeze({
    admit: (observation: unknown) =>
      admitNanacoEconomicPilot(store, observation),
    activate: async (
      candidateHash: Sha256,
      observation: unknown,
      occurredAt: string,
      reason?: string,
    ) =>
      activateNanacoEconomicPilot(
        store,
        candidateHash,
        observation,
        occurredAt,
        canonicalEvidenceVerifier,
        reason,
      ),
  });
}
