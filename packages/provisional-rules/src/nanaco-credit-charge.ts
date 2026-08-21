import { type RewardRule, tryValidateDocument } from "@jro/contracts";
import { hashCandidate, hashDefinition } from "./canonical.js";
import {
  NANACO_CREDIT_CHARGE_CANDIDATE,
  NANACO_CREDIT_CHARGE_CANDIDATE_ARTIFACT_HASH,
  NANACO_CREDIT_CHARGE_CLAIM_IDS,
  NANACO_CREDIT_CHARGE_DEFINITION_HASH,
  NANACO_CREDIT_CHARGE_EVIDENCE_IDS,
  NANACO_CREDIT_CHARGE_FAMILY_ID,
  NANACO_CREDIT_CHARGE_RULE_ID,
  NANACO_CREDIT_CHARGE_SOURCE_IDS,
  NANACO_CREDIT_CHARGE_SOURCE_ROLE_ID,
} from "./nanaco-credit-charge.generated.js";
import { scanPublicValue } from "./security.js";
import type { ProvisionalRuleCandidate, Sha256 } from "./types.js";

export {
  NANACO_CREDIT_CHARGE_CANDIDATE,
  NANACO_CREDIT_CHARGE_CANDIDATE_ARTIFACT_HASH,
  NANACO_CREDIT_CHARGE_CLAIM_IDS,
  NANACO_CREDIT_CHARGE_DEFINITION_HASH,
  NANACO_CREDIT_CHARGE_EVIDENCE_IDS,
  NANACO_CREDIT_CHARGE_FAMILY_ID,
  NANACO_CREDIT_CHARGE_RULE_ID,
  NANACO_CREDIT_CHARGE_SOURCE_IDS,
  NANACO_CREDIT_CHARGE_SOURCE_ROLE_ID,
};

export const NANACO_CREDIT_CHARGE_FINDING_ID =
  "nanaco-credit-charge-ui-canary-20260822-v1" as const;
export const NANACO_CREDIT_CHARGE_OBSERVATION_ID =
  "so_p0_nanaco_sevencard_credit_charge_20260822" as const;

export interface NanacoCreditChargeCompilationInput {
  readonly claim_ids: readonly string[];
  readonly evidence_ids: readonly string[];
  readonly source_ids: readonly string[];
}

export interface NanacoCreditChargeCompilationResult {
  readonly ok: boolean;
  readonly candidate?: ProvisionalRuleCandidate;
  readonly definition_hash?: Sha256;
  readonly candidate_hash?: Sha256;
  readonly issues: readonly string[];
}

function exactArray(
  actual: readonly string[],
  expected: readonly string[],
): boolean {
  return (
    actual.length === expected.length &&
    actual.every((item, index) => item === expected[index])
  );
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return (
    actual.length === wanted.length &&
    actual.every((key, index) => key === wanted[index])
  );
}

function candidateArtifactIsExact(): boolean {
  const candidate = NANACO_CREDIT_CHARGE_CANDIDATE;
  return (
    candidate.candidate_id ===
      "candidate_p0_nanaco_sevencard_credit_charge_20260822_v0_1" &&
    candidate.observation_id === NANACO_CREDIT_CHARGE_OBSERVATION_ID &&
    candidate.p0_family_id === NANACO_CREDIT_CHARGE_FAMILY_ID &&
    candidate.source_role_id === NANACO_CREDIT_CHARGE_SOURCE_ROLE_ID &&
    candidate.source_authority_role === "primary" &&
    exactArray(candidate.source_ids, NANACO_CREDIT_CHARGE_SOURCE_IDS) &&
    candidate.rule.rule_id === NANACO_CREDIT_CHARGE_RULE_ID &&
    candidate.rule.scope.operation_types.length === 1 &&
    candidate.rule.scope.operation_types[0] === "stored_value_top_up" &&
    candidate.rule.eligibility.transaction_conditions.minimum_amount_jpy ===
      5000 &&
    candidate.rule.eligibility.transaction_conditions.maximum_amount_jpy ===
      30000 &&
    candidate.rule.calculation?.model === "points_per_unit" &&
    candidate.rule.calculation.spend_jpy === 200 &&
    candidate.rule.provenance.human_verified === false &&
    exactArray(
      candidate.rule.provenance.evidence_ids,
      NANACO_CREDIT_CHARGE_EVIDENCE_IDS,
    )
  );
}

/**
 * Compile only the reviewed claim/evidence tuple.  This intentionally does
 * not infer economics from arbitrary browser or feed values: a mismatch is a
 * quarantined result, and the sealed candidate remains unchanged.
 */
export function compileNanacoCreditChargeCandidate(
  input: unknown,
): NanacoCreditChargeCompilationResult {
  const scanned = scanPublicValue(input);
  if (
    !scanned.valid ||
    scanned.value === null ||
    typeof scanned.value !== "object" ||
    Array.isArray(scanned.value)
  )
    return { ok: false, issues: ["input_invalid"] };
  const value = scanned.value as Record<string, unknown>;
  if (!exactKeys(value, ["claim_ids", "evidence_ids", "source_ids"]))
    return { ok: false, issues: ["input_invalid"] };
  const claims = value.claim_ids;
  const evidence = value.evidence_ids;
  const sources = value.source_ids;
  if (
    !Array.isArray(claims) ||
    !Array.isArray(evidence) ||
    !Array.isArray(sources) ||
    claims.some((item) => typeof item !== "string") ||
    evidence.some((item) => typeof item !== "string") ||
    sources.some((item) => typeof item !== "string")
  )
    return { ok: false, issues: ["binding_invalid"] };
  if (!exactArray(claims, NANACO_CREDIT_CHARGE_CLAIM_IDS))
    return { ok: false, issues: ["claim_ids_not_supported"] };
  if (!exactArray(evidence, NANACO_CREDIT_CHARGE_EVIDENCE_IDS))
    return { ok: false, issues: ["evidence_ids_not_supported"] };
  if (!exactArray(sources, NANACO_CREDIT_CHARGE_SOURCE_IDS))
    return { ok: false, issues: ["source_ids_not_supported"] };
  if (!candidateArtifactIsExact())
    return { ok: false, issues: ["sealed_candidate_drift"] };
  const structure = tryValidateDocument(
    NANACO_CREDIT_CHARGE_CANDIDATE.rule,
    "reward-rule",
  );
  if (!structure.valid)
    return { ok: false, issues: ["rule_structure_invalid"] };
  return Object.freeze({
    ok: true,
    candidate: NANACO_CREDIT_CHARGE_CANDIDATE,
    definition_hash: NANACO_CREDIT_CHARGE_DEFINITION_HASH,
    candidate_hash: NANACO_CREDIT_CHARGE_CANDIDATE_ARTIFACT_HASH,
    issues: Object.freeze([]),
  });
}

export function getNanacoCreditChargeCandidate(): ProvisionalRuleCandidate {
  return structuredClone(NANACO_CREDIT_CHARGE_CANDIDATE);
}

export function getNanacoCreditChargeRule(): RewardRule {
  return structuredClone(NANACO_CREDIT_CHARGE_CANDIDATE.rule);
}

export function assertNanacoCreditChargeArtifact(): void {
  if (
    hashDefinition(NANACO_CREDIT_CHARGE_CANDIDATE.rule) !==
    NANACO_CREDIT_CHARGE_DEFINITION_HASH
  )
    throw new Error("nanaco_credit_charge_definition_artifact_drift");
  if (
    hashCandidate(
      NANACO_CREDIT_CHARGE_CANDIDATE,
      NANACO_CREDIT_CHARGE_DEFINITION_HASH,
    ) !== NANACO_CREDIT_CHARGE_CANDIDATE_ARTIFACT_HASH
  )
    throw new Error("nanaco_credit_charge_candidate_artifact_drift");
}

assertNanacoCreditChargeArtifact();
