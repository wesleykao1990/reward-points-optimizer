import { type RewardRule, tryValidateDocument } from "@jro/contracts";
import { brandEnvelope } from "./brand.js";
import {
  hashCandidate,
  hashDefinition,
  normalizeCoverageIndex,
} from "./canonical.js";
import { deepFreeze, scanPublicValue } from "./security.js";
import type {
  AdmissionAccepted,
  AdmissionIssue,
  AdmissionIssueCode,
  AdmissionRejected,
  MachineCheckChecks,
  MachineCheckRecord,
  ProvisionalRuleAdmissionOptions,
  ProvisionalRuleCandidate,
  ProvisionalRuleEnvelope,
  ProvisionalSourceAuthorityRole,
  ProvisionalTransition,
  Sha256,
} from "./types.js";
import {
  PROVISIONAL_RULE_CANDIDATE_VERSION,
  PROVISIONAL_RULE_ENVELOPE_VERSION,
} from "./types.js";

const CANDIDATE_KEYS = new Set([
  "version",
  "candidate_id",
  "observation_id",
  "observation_fingerprint",
  "p0_family_id",
  "source_role_id",
  "source_authority_role",
  "source_ids",
  "rule",
  "extractor",
  "machine_check",
]);
const EXTRACTOR_KEYS = new Set(["name", "version"]);
const MACHINE_CHECK_KEYS = new Set([
  "checker",
  "checker_version",
  "checked_at",
  "checks",
]);
const MACHINE_CHECK_CHECK_KEYS = new Set([
  "representation_safe",
  "rule_structure",
  "rule_semantics",
  "observation_binding",
  "p0_coverage",
]);
const SOURCE_AUTHORITY_ROLES = new Set<ProvisionalSourceAuthorityRole>([
  "primary",
  "corroborating",
  "conflict",
]);
const REJECTED_RULE_STATUSES = new Set([
  "published",
  "superseded",
  "retired",
  "rejected",
]);
const REJECTED_OBSERVATION_STATUSES = new Set(["rejected"]);

function issue(
  code: AdmissionIssueCode,
  path: string,
  message: string,
): AdmissionIssue {
  return { code, path, message };
}

function sortedIssues(issues: readonly AdmissionIssue[]): AdmissionIssue[] {
  return [...issues].sort(
    (left, right) =>
      left.path.localeCompare(right.path) ||
      left.code.localeCompare(right.code) ||
      left.message.localeCompare(right.message),
  );
}

function rejected(
  issues: readonly AdmissionIssue[],
  candidate_hash?: Sha256,
  definition_hash?: Sha256,
): AdmissionRejected {
  const result: AdmissionRejected = {
    ok: false,
    status: "quarantined",
    issues: Object.freeze(sortedIssues(issues)),
  };
  if (candidate_hash !== undefined)
    (result as { candidate_hash?: Sha256 }).candidate_hash = candidate_hash;
  if (definition_hash !== undefined)
    (result as { definition_hash?: Sha256 }).definition_hash = definition_hash;
  return Object.freeze(result);
}

function accepted(
  status: AdmissionAccepted["status"],
  candidate_hash: Sha256,
  definition_hash: Sha256,
  envelope: ProvisionalRuleEnvelope,
): AdmissionAccepted {
  return Object.freeze({
    ok: true as const,
    status,
    candidate_hash,
    definition_hash,
    envelope,
    issues: Object.freeze([]) as readonly [],
  });
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: string,
): AdmissionIssue[] {
  const issues: AdmissionIssue[] = [];
  for (const key of Object.keys(value)) {
    if (!allowed.has(key))
      issues.push(
        issue("input_shape_invalid", `${path}/${key}`, "unknown field"),
      );
  }
  return issues;
}

function requiredString(
  record: Record<string, unknown>,
  key: string,
  path: string,
  issues: AdmissionIssue[],
): string | undefined {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    issues.push(
      issue(
        "input_shape_invalid",
        `${path}/${key}`,
        "non-empty string required",
      ),
    );
    return undefined;
  }
  return value;
}

function validDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(
      value,
    ) &&
    Number.isFinite(Date.parse(value))
  );
}

function parseSourceIds(
  record: Record<string, unknown>,
  path: string,
  issues: AdmissionIssue[],
): string[] {
  const value = record.source_ids;
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((item) => typeof item !== "string" || item.length === 0)
  ) {
    issues.push(
      issue(
        "source_ids_invalid",
        `${path}/source_ids`,
        "source_ids must be a non-empty string array",
      ),
    );
    return [];
  }
  const values = value as string[];
  if (new Set(values).size !== values.length)
    issues.push(
      issue(
        "source_ids_invalid",
        `${path}/source_ids`,
        "source_ids must be unique",
      ),
    );
  return [...values];
}

function parseMachineChecks(
  value: unknown,
  path: string,
  issues: AdmissionIssue[],
): MachineCheckRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    issues.push(
      issue("machine_check_invalid", path, "machine_check must be an object"),
    );
    return null;
  }
  const record = value as Record<string, unknown>;
  issues.push(...exactKeys(record, MACHINE_CHECK_KEYS, path));
  const checker = requiredString(record, "checker", path, issues);
  const checkerVersion = requiredString(
    record,
    "checker_version",
    path,
    issues,
  );
  if (!validDate(record.checked_at))
    issues.push(
      issue(
        "timestamp_invalid",
        `${path}/checked_at`,
        "checked_at must be an ISO date-time",
      ),
    );
  const checksValue = record.checks;
  if (
    !checksValue ||
    typeof checksValue !== "object" ||
    Array.isArray(checksValue)
  ) {
    issues.push(
      issue(
        "machine_check_invalid",
        `${path}/checks`,
        "checks must be an object",
      ),
    );
    return null;
  }
  const checksRecord = checksValue as Record<string, unknown>;
  issues.push(
    ...exactKeys(checksRecord, MACHINE_CHECK_CHECK_KEYS, `${path}/checks`),
  );
  const checks: {
    -readonly [Key in keyof MachineCheckChecks]?: boolean;
  } = {};
  for (const key of MACHINE_CHECK_CHECK_KEYS) {
    const valueForKey = checksRecord[key];
    if (typeof valueForKey !== "boolean")
      issues.push(
        issue(
          "machine_check_invalid",
          `${path}/checks/${key}`,
          "check must be boolean",
        ),
      );
    else checks[key as keyof MachineCheckChecks] = valueForKey;
  }
  if (
    checker === undefined ||
    checkerVersion === undefined ||
    !validDate(record.checked_at) ||
    Object.keys(checks).length !== MACHINE_CHECK_CHECK_KEYS.size
  )
    return null;
  return {
    checker,
    checker_version: checkerVersion,
    checked_at: record.checked_at,
    checks: checks as MachineCheckChecks,
  };
}

function parseCandidate(value: unknown): {
  candidate: ProvisionalRuleCandidate | null;
  issues: AdmissionIssue[];
} {
  const issues: AdmissionIssue[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value))
    return {
      candidate: null,
      issues: [
        issue("input_not_object", "/candidate", "candidate must be an object"),
      ],
    };
  const record = value as Record<string, unknown>;
  issues.push(...exactKeys(record, CANDIDATE_KEYS, "/candidate"));
  if (record.version !== PROVISIONAL_RULE_CANDIDATE_VERSION)
    issues.push(
      issue(
        "input_shape_invalid",
        "/candidate/version",
        "unsupported candidate version",
      ),
    );
  const candidateId = record.candidate_id;
  if (
    candidateId !== undefined &&
    (typeof candidateId !== "string" || candidateId.length === 0)
  )
    issues.push(
      issue(
        "input_shape_invalid",
        "/candidate/candidate_id",
        "candidate_id must be a non-empty string",
      ),
    );
  const observationId = requiredString(
    record,
    "observation_id",
    "/candidate",
    issues,
  );
  const observationFingerprint = requiredString(
    record,
    "observation_fingerprint",
    "/candidate",
    issues,
  );
  const p0FamilyId = requiredString(
    record,
    "p0_family_id",
    "/candidate",
    issues,
  );
  const sourceRoleId = requiredString(
    record,
    "source_role_id",
    "/candidate",
    issues,
  );
  const authorityRole = record.source_authority_role;
  if (
    !SOURCE_AUTHORITY_ROLES.has(authorityRole as ProvisionalSourceAuthorityRole)
  )
    issues.push(
      issue(
        "source_role_invalid",
        "/candidate/source_authority_role",
        "source authority role is invalid",
      ),
    );
  const sourceIds = parseSourceIds(record, "/candidate", issues);
  const rule = record.rule;
  if (!rule || typeof rule !== "object" || Array.isArray(rule))
    issues.push(
      issue("rule_invalid", "/candidate/rule", "rule must be an object"),
    );
  const extractorValue = record.extractor;
  let extractor: { name: string; version: string } | null = null;
  if (
    !extractorValue ||
    typeof extractorValue !== "object" ||
    Array.isArray(extractorValue)
  ) {
    issues.push(
      issue(
        "extractor_invalid",
        "/candidate/extractor",
        "extractor must be an object",
      ),
    );
  } else {
    const extractorRecord = extractorValue as Record<string, unknown>;
    issues.push(
      ...exactKeys(extractorRecord, EXTRACTOR_KEYS, "/candidate/extractor"),
    );
    const name = requiredString(
      extractorRecord,
      "name",
      "/candidate/extractor",
      issues,
    );
    const version = requiredString(
      extractorRecord,
      "version",
      "/candidate/extractor",
      issues,
    );
    if (name !== undefined && version !== undefined)
      extractor = { name, version };
  }
  const machineCheck = parseMachineChecks(
    record.machine_check,
    "/candidate/machine_check",
    issues,
  );
  if (
    issues.length > 0 ||
    observationId === undefined ||
    observationFingerprint === undefined ||
    p0FamilyId === undefined ||
    sourceRoleId === undefined ||
    !SOURCE_AUTHORITY_ROLES.has(
      authorityRole as ProvisionalSourceAuthorityRole,
    ) ||
    !rule ||
    typeof rule !== "object" ||
    Array.isArray(rule) ||
    extractor === null ||
    machineCheck === null
  )
    return { candidate: null, issues };
  return {
    candidate: {
      version: PROVISIONAL_RULE_CANDIDATE_VERSION,
      ...(candidateId === undefined
        ? {}
        : { candidate_id: candidateId as string }),
      observation_id: observationId,
      observation_fingerprint: observationFingerprint,
      p0_family_id: p0FamilyId,
      source_role_id: sourceRoleId,
      source_authority_role: authorityRole as ProvisionalSourceAuthorityRole,
      source_ids: sourceIds,
      rule: rule as RewardRule,
      extractor,
      machine_check: machineCheck,
    },
    issues,
  };
}

interface ParsedObservation {
  readonly observation_id: string;
  readonly semantic_fingerprint: string;
  readonly source_ids: readonly string[];
  readonly status: string;
  readonly source_authority_claim:
    | "primary"
    | "official_secondary"
    | "third_party"
    | "unknown";
  readonly security_flags: readonly string[];
  readonly evidence_completeness: string | null;
  readonly submitted_evidence_refs: readonly string[];
  readonly change_type: string;
  readonly raw_attributes: Readonly<Record<string, unknown>>;
}

const ADMISSIBLE_OBSERVATION_STATUSES = new Set([
  "needs_review",
  "needs_evidence",
]);

function parseObservation(
  value: unknown,
  issues: AdmissionIssue[],
): ParsedObservation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    issues.push(
      issue(
        "observation_invalid",
        "/observation",
        "observation must be an object",
      ),
    );
    return null;
  }
  const record = value as Record<string, unknown>;
  let contractValid = false;
  try {
    const contract = tryValidateDocument(value, "source-observation");
    contractValid = contract.valid;
    if (!contract.valid) {
      for (const item of contract.issues)
        issues.push(
          issue(
            "observation_invalid",
            `/observation${item.path ?? ""}`,
            item.message,
          ),
        );
    }
  } catch {
    issues.push(
      issue(
        "observation_invalid",
        "/observation",
        "source observation contract validation failed",
      ),
    );
  }
  const observationId = record.observation_id;
  const fingerprint = record.semantic_fingerprint;
  const sourceIds = record.source_ids;
  const status = record.status;
  const flags = record.security_flags;
  if (typeof observationId !== "string" || observationId.length === 0)
    issues.push(
      issue(
        "observation_invalid",
        "/observation/observation_id",
        "observation_id is required",
      ),
    );
  if (typeof fingerprint !== "string" || fingerprint.length === 0)
    issues.push(
      issue(
        "observation_invalid",
        "/observation/semantic_fingerprint",
        "semantic_fingerprint is required",
      ),
    );
  if (
    !Array.isArray(sourceIds) ||
    sourceIds.some((item) => typeof item !== "string" || item.length === 0)
  )
    issues.push(
      issue(
        "observation_invalid",
        "/observation/source_ids",
        "source_ids must be a string array",
      ),
    );
  if (Array.isArray(sourceIds) && new Set(sourceIds).size !== sourceIds.length)
    issues.push(
      issue(
        "observation_invalid",
        "/observation/source_ids",
        "source_ids must be unique",
      ),
    );
  if (typeof status !== "string")
    issues.push(
      issue("observation_invalid", "/observation/status", "status is required"),
    );
  else if (!ADMISSIBLE_OBSERVATION_STATUSES.has(status))
    issues.push(
      issue(
        "observation_status_forbidden",
        "/observation/status",
        "only needs_review or needs_evidence observations may be admitted",
      ),
    );
  if (status === "rejected")
    issues.push(
      issue(
        "observation_rejected",
        "/observation/status",
        "rejected observations cannot create provisional candidates",
      ),
    );
  if (!Array.isArray(flags) || flags.some((item) => typeof item !== "string"))
    issues.push(
      issue(
        "observation_invalid",
        "/observation/security_flags",
        "security_flags must be a string array",
      ),
    );
  const assessment = record.discovery_assessment;
  const authorityClaim =
    assessment && typeof assessment === "object" && !Array.isArray(assessment)
      ? (assessment as Record<string, unknown>).source_authority_claim
      : undefined;
  if (
    authorityClaim !== "primary" &&
    authorityClaim !== "official_secondary" &&
    authorityClaim !== "third_party" &&
    authorityClaim !== "unknown"
  )
    issues.push(
      issue(
        "observation_invalid",
        "/observation/discovery_assessment/source_authority_claim",
        "source_authority_claim is required",
      ),
    );
  const completeness =
    assessment && typeof assessment === "object" && !Array.isArray(assessment)
      ? (assessment as Record<string, unknown>).evidence_completeness
      : null;
  if (completeness !== null && typeof completeness !== "string")
    issues.push(
      issue(
        "observation_invalid",
        "/observation/discovery_assessment/evidence_completeness",
        "evidence_completeness must be a string",
      ),
    );
  const submitted = record.submitted_evidence_refs;
  if (
    submitted !== undefined &&
    (!Array.isArray(submitted) ||
      submitted.some((item) => typeof item !== "string"))
  )
    issues.push(
      issue(
        "observation_invalid",
        "/observation/submitted_evidence_refs",
        "submitted_evidence_refs must be a string array",
      ),
    );
  const changeType = record.change_type;
  const rawAttributes = record.raw_attributes;
  if (typeof changeType !== "string" || changeType.length === 0)
    issues.push(
      issue(
        "observation_invalid",
        "/observation/change_type",
        "change_type is required",
      ),
    );
  if (
    !rawAttributes ||
    typeof rawAttributes !== "object" ||
    Array.isArray(rawAttributes)
  )
    issues.push(
      issue(
        "observation_invalid",
        "/observation/raw_attributes",
        "raw_attributes must be an object",
      ),
    );
  if (
    issues.length > 0 ||
    !contractValid ||
    typeof observationId !== "string" ||
    typeof fingerprint !== "string" ||
    !Array.isArray(sourceIds) ||
    typeof status !== "string" ||
    typeof changeType !== "string" ||
    !rawAttributes ||
    typeof rawAttributes !== "object" ||
    Array.isArray(rawAttributes) ||
    (authorityClaim !== "primary" &&
      authorityClaim !== "official_secondary" &&
      authorityClaim !== "third_party" &&
      authorityClaim !== "unknown") ||
    !Array.isArray(flags)
  )
    return null;
  return {
    observation_id: observationId,
    semantic_fingerprint: fingerprint,
    source_ids: sourceIds as string[],
    status,
    source_authority_claim: authorityClaim,
    security_flags: flags as string[],
    evidence_completeness:
      typeof completeness === "string" ? completeness : null,
    submitted_evidence_refs: Array.isArray(submitted)
      ? (submitted as string[])
      : [],
    change_type: changeType,
    raw_attributes: rawAttributes as Record<string, unknown>,
  };
}

function validateRule(
  value: RewardRule,
  issues: AdmissionIssue[],
): { valid: boolean; definition_hash: Sha256 | null } {
  let definition_hash: Sha256;
  try {
    definition_hash = hashDefinition(value);
  } catch {
    issues.push(
      issue(
        "rule_invalid",
        "/candidate/rule",
        "rule cannot be canonically hashed",
      ),
    );
    return { valid: false, definition_hash: null };
  }
  let result: {
    valid: boolean;
    issues?: readonly { path?: string; code?: string; message?: string }[];
  };
  try {
    result = tryValidateDocument(value, "reward-rule");
  } catch {
    issues.push(
      issue(
        "rule_invalid",
        "/candidate/rule",
        "rule contract validator failed",
      ),
    );
    return { valid: false, definition_hash };
  }
  if (!result.valid) {
    for (const item of result.issues ?? [])
      issues.push(
        issue(
          "rule_invalid",
          `/candidate/rule${item.path ?? ""}`,
          item.message ?? item.code ?? "rule validation failed",
        ),
      );
  }
  const ruleRecord = value as unknown as Record<string, unknown>;
  const status = ruleRecord.status;
  if (typeof status !== "string" || REJECTED_RULE_STATUSES.has(status))
    issues.push(
      issue(
        "rule_publication_status_forbidden",
        "/candidate/rule/status",
        "provisional candidates cannot claim published, historical, or rejected rule status",
      ),
    );
  const provenance = ruleRecord.provenance;
  if (
    !provenance ||
    typeof provenance !== "object" ||
    Array.isArray(provenance)
  ) {
    issues.push(
      issue(
        "rule_review_claim_forbidden",
        "/candidate/rule/provenance",
        "provenance is required",
      ),
    );
  } else if ((provenance as Record<string, unknown>).human_verified !== false) {
    issues.push(
      issue(
        "rule_review_claim_forbidden",
        "/candidate/rule/provenance/human_verified",
        "provisional rule must not claim human verification",
      ),
    );
  }
  const audit = ruleRecord.audit;
  if (!audit || typeof audit !== "object" || Array.isArray(audit)) {
    issues.push(
      issue(
        "rule_review_claim_forbidden",
        "/candidate/rule/audit",
        "audit is required",
      ),
    );
  } else {
    const auditRecord = audit as Record<string, unknown>;
    if (
      auditRecord.reviewed_at !== null ||
      auditRecord.reviewed_by !== null ||
      auditRecord.review_mode !== null
    )
      issues.push(
        issue(
          "rule_review_claim_forbidden",
          "/candidate/rule/audit",
          "provisional rule cannot claim completed review",
        ),
      );
    const events = auditRecord.review_events;
    if (Array.isArray(events)) {
      events.forEach((event, index) => {
        if (
          event &&
          typeof event === "object" &&
          !Array.isArray(event) &&
          (event as Record<string, unknown>).decision === "approved"
        )
          issues.push(
            issue(
              "rule_review_claim_forbidden",
              `/candidate/rule/audit/review_events/${index}`,
              "approved review events are not allowed",
            ),
          );
      });
    }
  }
  const validity = ruleRecord.validity;
  if (
    validity &&
    typeof validity === "object" &&
    !Array.isArray(validity) &&
    (validity as Record<string, unknown>).superseded_at !== null
  )
    issues.push(
      issue(
        "rule_review_claim_forbidden",
        "/candidate/rule/validity/superseded_at",
        "provisional rule cannot claim supersession",
      ),
    );
  return { valid: result.valid && issues.length === 0, definition_hash };
}

function actualMachineChecks(
  ruleValid: boolean,
  semanticSupport: boolean,
  sourceBinding: boolean,
  coverage: boolean,
): MachineCheckChecks {
  return {
    representation_safe: true,
    rule_structure: ruleValid,
    rule_semantics: ruleValid && semanticSupport,
    observation_binding: sourceBinding,
    p0_coverage: coverage,
  };
}

function merchantAcceptanceSemanticSupport(
  candidate: ProvisionalRuleCandidate,
  observation: ParsedObservation,
): boolean {
  if (candidate.source_role_id !== "accepted_payment_methods") return true;
  const effect = candidate.rule.effect;
  const operationMatch = candidate.rule.eligibility?.operation_match;
  if (
    observation.change_type !== "merchant_acceptance" ||
    candidate.rule.rule_type !== "payment_acceptance" ||
    effect?.decision !== "allow" ||
    effect.effect_target !== "operation_eligibility" ||
    operationMatch === undefined
  )
    return false;

  const raw = observation.raw_attributes;
  const families = new Set<string>();
  if (typeof raw.accepted_payment_family === "string")
    families.add(raw.accepted_payment_family);
  if (Array.isArray(raw.accepted_payment_families)) {
    for (const value of raw.accepted_payment_families) {
      if (typeof value === "string") families.add(value);
    }
  }

  const prefix = "accepted_payment_family_";
  const reason = effect.reason_code;
  if (!reason.startsWith(prefix)) return false;
  const family = reason.slice(prefix.length);
  const instruments = operationMatch.allowed_payment_instrument_ids;
  return (
    family.length > 0 &&
    families.has(family) &&
    Array.isArray(instruments) &&
    instruments.length === 1 &&
    instruments[0]?.endsWith(`.${family}`) === true
  );
}

function sameChecks(
  left: MachineCheckChecks,
  right: MachineCheckChecks,
): boolean {
  return (
    left.representation_safe === right.representation_safe &&
    left.rule_structure === right.rule_structure &&
    left.rule_semantics === right.rule_semantics &&
    left.observation_binding === right.observation_binding &&
    left.p0_coverage === right.p0_coverage
  );
}

function freezeCandidate(
  candidate: ProvisionalRuleCandidate,
): ProvisionalRuleCandidate {
  return deepFreeze(candidate);
}

/**
 * Admit one untrusted candidate.  The public boundary accepts either an
 * envelope (`candidate`, `observation`, `p0_coverage_index`) or a candidate
 * plus those two values in the second argument.  No candidate reaches the
 * contracts validator until representation checks have produced a plain clone.
 */
export function admitProvisionalRuleCandidate(
  request: unknown,
  options: ProvisionalRuleAdmissionOptions = {},
): import("./types.js").ProvisionalAdmissionResult {
  const requestScan = scanPublicValue(request);
  if (!requestScan.valid) return rejected(requestScan.issues);
  const optionScan = scanPublicValue(options);
  if (!optionScan.valid) return rejected(optionScan.issues);

  let candidateValue: unknown;
  let observationValue: unknown;
  let coverageValue: unknown;
  let coverageOriginal: unknown;
  if (
    options.observation !== undefined ||
    options.p0_coverage_index !== undefined
  ) {
    candidateValue = requestScan.value;
    observationValue =
      optionScan.value && typeof optionScan.value === "object"
        ? (optionScan.value as Record<string, unknown>).observation
        : undefined;
    coverageValue =
      optionScan.value && typeof optionScan.value === "object"
        ? (optionScan.value as Record<string, unknown>).p0_coverage_index
        : undefined;
    coverageOriginal = options.p0_coverage_index;
  } else {
    if (
      !requestScan.value ||
      typeof requestScan.value !== "object" ||
      Array.isArray(requestScan.value)
    )
      return rejected([
        issue("input_not_object", "", "admission request must be an object"),
      ]);
    const envelope = requestScan.value as Record<string, unknown>;
    const envelopeIssues = exactKeys(
      envelope,
      new Set(["candidate", "observation", "p0_coverage_index"]),
      "",
    );
    if (envelopeIssues.length > 0) return rejected(envelopeIssues);
    candidateValue = envelope.candidate;
    observationValue = envelope.observation;
    coverageValue = envelope.p0_coverage_index;
    coverageOriginal =
      requestScan.value && typeof request === "object"
        ? (request as Record<string, unknown>).p0_coverage_index
        : coverageValue;
  }

  const candidateParsed = parseCandidate(candidateValue);
  const issues = [...candidateParsed.issues];
  const observation = parseObservation(observationValue, issues);
  // The request/option object was representation-checked above, so reading
  // this data descriptor is safe.  Preserve its frozen identity for the
  // immutable-index requirement instead of normalizing only the scan clone.
  const coverageParsed = normalizeCoverageIndex(
    coverageOriginal ?? coverageValue,
  );
  issues.push(...coverageParsed.issues);
  if (!candidateParsed.candidate || !observation || !coverageParsed.index)
    return rejected(issues);
  const candidate = candidateParsed.candidate;
  const coverage = coverageParsed.index;
  const familyEntry = coverage.entries.find(
    (item) => item.family_id === candidate.p0_family_id,
  );
  const entry = coverage.entries.find(
    (item) =>
      item.family_id === candidate.p0_family_id &&
      item.source_role_id === candidate.source_role_id,
  );
  if (!familyEntry)
    issues.push(
      issue(
        "coverage_family_unknown",
        "/candidate/p0_family_id",
        "P0 family is not present in the supplied coverage index",
      ),
    );
  else if (!entry)
    issues.push(
      issue(
        "source_role_coverage_mismatch",
        "/candidate/source_role_id",
        "the P0 family/source role pair is not present in the supplied coverage index",
      ),
    );
  if (candidate.source_authority_role === "conflict")
    issues.push(
      issue(
        "source_role_invalid",
        "/candidate/source_authority_role",
        "conflict authority cannot admit a provisional rule",
      ),
    );
  const authorityBinding =
    (candidate.source_authority_role === "primary" &&
      observation.source_authority_claim === "primary") ||
    (candidate.source_authority_role === "corroborating" &&
      (observation.source_authority_claim === "official_secondary" ||
        observation.source_authority_claim === "third_party"));
  if (!authorityBinding)
    issues.push(
      issue(
        "source_authority_mismatch",
        "/candidate/source_authority_role",
        "candidate authority role does not match the observation authority claim",
      ),
    );
  const knownSourceIds = new Set(entry?.known_source_ids ?? []);
  for (const sourceId of candidate.source_ids) {
    if (!knownSourceIds.has(sourceId))
      issues.push(
        issue(
          "source_unregistered",
          "/candidate/source_ids",
          `source ${sourceId} is not registered in P0 coverage`,
        ),
      );
  }
  const observationSourceIds = new Set(observation.source_ids);
  const sourceIntersection = candidate.source_ids.filter((sourceId) =>
    observationSourceIds.has(sourceId),
  );
  const sourceBinding =
    sourceIntersection.length === candidate.source_ids.length &&
    sourceIntersection.length > 0;
  if (!sourceBinding)
    issues.push(
      issue(
        "source_observation_mismatch",
        "/candidate/source_ids",
        "candidate source IDs must be exactly covered by the observation intersection",
      ),
    );
  if (
    candidate.observation_id !== observation.observation_id ||
    candidate.observation_fingerprint !== observation.semantic_fingerprint
  )
    issues.push(
      issue(
        "observation_binding_mismatch",
        "/candidate/observation_id",
        "candidate observation identity does not match the observation",
      ),
    );
  if (REJECTED_OBSERVATION_STATUSES.has(observation.status))
    issues.push(
      issue(
        "observation_rejected",
        "/observation/status",
        "rejected observations cannot create provisional candidates",
      ),
    );
  if (observation.security_flags.length > 0)
    issues.push(
      issue(
        "observation_hostile",
        "/observation/security_flags",
        "security-flagged observations are quarantined",
      ),
    );
  const ruleValidation = validateRule(candidate.rule, issues);
  const semanticSupport = merchantAcceptanceSemanticSupport(
    candidate,
    observation,
  );
  if (!semanticSupport)
    issues.push(
      issue(
        "semantic_support_mismatch",
        "/candidate/rule",
        "candidate payment-family semantics are not explicitly supported by the bound observation",
      ),
    );
  const coverageValid =
    entry !== undefined &&
    entry.source_role_id === candidate.source_role_id &&
    candidate.source_authority_role !== "conflict" &&
    authorityBinding &&
    candidate.source_ids.every((sourceId) => knownSourceIds.has(sourceId));
  const checks = actualMachineChecks(
    ruleValidation.valid,
    semanticSupport,
    sourceBinding && authorityBinding,
    coverageValid,
  );
  if (!sameChecks(candidate.machine_check.checks, checks))
    issues.push(
      issue(
        "machine_check_mismatch",
        "/candidate/machine_check/checks",
        "supplied machine-check record does not match recomputed checks",
      ),
    );
  if (issues.length > 0) {
    const definition_hash = ruleValidation.definition_hash ?? undefined;
    let candidate_hash: Sha256 | undefined;
    if (definition_hash) {
      try {
        candidate_hash = hashCandidate(candidate, definition_hash);
      } catch {
        // The normal issue already explains an unhashable rule.
      }
    }
    return rejected(issues, candidate_hash, definition_hash);
  }

  const definition_hash = ruleValidation.definition_hash as Sha256;
  const candidate_hash = hashCandidate(candidate, definition_hash);
  const status =
    observation.status === "needs_review" &&
    observation.evidence_completeness === "complete" &&
    observation.submitted_evidence_refs.length > 0
      ? "machine_checked"
      : "needs_evidence";
  const transition: ProvisionalTransition = {
    sequence: 0,
    from_status: null,
    to_status: status,
    occurred_at: candidate.machine_check.checked_at,
    reason:
      status === "machine_checked"
        ? "machine_checks_passed"
        : "evidence_required",
    candidate_hash,
  };
  const frozenCandidate = freezeCandidate(candidate);
  const envelope: ProvisionalRuleEnvelope = brandEnvelope(
    deepFreeze({
      version: PROVISIONAL_RULE_ENVELOPE_VERSION,
      candidate_hash,
      definition_hash,
      status,
      candidate: frozenCandidate,
      rule: frozenCandidate.rule,
      observation: {
        observation_id: observation.observation_id,
        observation_fingerprint: observation.semantic_fingerprint,
        source_ids: [...candidate.source_ids].sort((left, right) =>
          left.localeCompare(right),
        ),
        source_authority_claim: observation.source_authority_claim,
      },
      history: [transition],
      corrections: [],
    }),
  );
  return accepted(status, candidate_hash, definition_hash, envelope);
}

/** Alias kept short for callers embedding this pure boundary. */
export const admitProvisionalRule = admitProvisionalRuleCandidate;

/** Construct a machine-check record for trusted test/checker code. */
export function createMachineCheckRecord(
  checked_at: string,
  checks: MachineCheckChecks,
  checker = "provisional-rules",
  checker_version = "1",
): MachineCheckRecord {
  if (!validDate(checked_at))
    throw new TypeError("checked_at must be an ISO date-time");
  return deepFreeze({
    checker,
    checker_version,
    checked_at,
    checks: { ...checks },
  });
}
