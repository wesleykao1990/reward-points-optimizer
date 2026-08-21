import { admitProvisionalRuleCandidate } from "./admission.js";
import { hashCanonical, normalizeCoverageIndex } from "./canonical.js";
import { activateExperimental } from "./lifecycle.js";
import { deepFreeze, scanPublicValue } from "./security.js";
import type {
  AdmissionIssue,
  ProvisionalPublicationBatch,
  ProvisionalPublicationBatchAccepted,
  ProvisionalPublicationBatchMember,
  ProvisionalPublicationBatchPreflight,
  ProvisionalPublicationBatchRejected,
  ProvisionalRuleAdmissionRequest,
  PublicationBatchIssue,
  Sha256,
} from "./types.js";
import {
  MAX_PROVISIONAL_PUBLICATION_BATCH_MEMBERS,
  P0_SOURCE_ROLE_PLAN_SHA256,
  PROVISIONAL_PUBLICATION_BATCH_VERSION,
} from "./types.js";

const BATCH_KEYS = new Set([
  "version",
  "batch_id",
  "plan_sha256",
  "published_at",
  "members",
]);
const MEMBER_KEYS = new Set(["member_id", "admission_request"]);
const ADMISSION_REQUEST_KEYS = new Set([
  "candidate",
  "observation",
  "p0_coverage_index",
]);
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/u;
const TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;

const batchBrands = new WeakSet<object>();

interface PreparedMember {
  readonly member_id: string;
  readonly candidate_hash: Sha256;
  readonly definition_hash: Sha256;
  readonly envelope: ProvisionalRuleMemberEnvelope;
  readonly admission_request: ProvisionalRuleAdmissionRequest;
}

// Keep the private prepared envelope alias local so this module never accepts
// a structural envelope supplied by a caller.  It is always returned by the
// package admission/activation boundaries.
type ProvisionalRuleMemberEnvelope =
  import("./types.js").ProvisionalRuleEnvelope;

function issue(
  code: PublicationBatchIssue["code"],
  path: string,
  message: string,
  details: Partial<PublicationBatchIssue> = {},
): PublicationBatchIssue {
  return Object.freeze({ code, path, message, ...details });
}

function rejected(
  issues: readonly PublicationBatchIssue[],
): ProvisionalPublicationBatchRejected {
  return Object.freeze({
    ok: false as const,
    issues: Object.freeze(
      [...issues].sort(
        (left, right) =>
          left.path.localeCompare(right.path) ||
          left.code.localeCompare(right.code) ||
          left.message.localeCompare(right.message),
      ),
    ),
  });
}

function validTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    TIMESTAMP_PATTERN.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: string,
): PublicationBatchIssue[] {
  return Object.keys(value)
    .filter((key) => !allowed.has(key))
    .map((key) =>
      issue("batch_shape_invalid", `${path}/${key}`, "unknown field"),
    );
}

function scanIssues(
  issues: readonly AdmissionIssue[],
): PublicationBatchIssue[] {
  return issues.map((item) =>
    issue("input_invalid", item.path, item.message, {
      admission_issues: Object.freeze([item]),
    }),
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizedRequestSnapshot(
  safeRequest: Record<string, unknown>,
  rawRequest: Record<string, unknown>,
): ProvisionalRuleAdmissionRequest | null {
  const safeCandidate = safeRequest.candidate;
  const safeObservation = safeRequest.observation;
  const rawCoverage = rawRequest.p0_coverage_index;
  if (safeCandidate === undefined || safeObservation === undefined) return null;
  const coverage = normalizeCoverageIndex(rawCoverage);
  if (!coverage.index) return null;
  return deepFreeze({
    candidate: safeCandidate,
    observation: safeObservation,
    p0_coverage_index: coverage.index,
  });
}

function makeAdmissionRequest(
  safeMember: Record<string, unknown>,
  rawMember: Record<string, unknown>,
): ProvisionalRuleAdmissionRequest | null {
  const safeRequest = asRecord(safeMember.admission_request);
  const rawRequest = asRecord(rawMember.admission_request);
  if (!safeRequest || !rawRequest) return null;
  // `candidate` and `observation` come from the representation-checked clone;
  // the frozen index remains the caller-owned value so admission preserves its
  // immutable-index contract.  No caller getter/proxy is dereferenced here:
  // scanPublicValue has already rejected those representations.
  return {
    candidate: safeRequest.candidate,
    observation: safeRequest.observation,
    p0_coverage_index: rawRequest.p0_coverage_index,
  };
}

/**
 * Preflight and activate every member without touching a store.  A caller can
 * safely use this to inspect the complete batch result; the state store uses
 * the same immutable result as its sole commit input.
 */
export function preflightProvisionalPublicationBatch(
  value: unknown,
): ProvisionalPublicationBatchPreflight {
  const scanned = scanPublicValue(value);
  if (!scanned.valid) return rejected(scanIssues(scanned.issues));
  const rawBatch = asRecord(value);
  const safeBatch = asRecord(scanned.value);
  if (!rawBatch || !safeBatch)
    return rejected([
      issue("batch_shape_invalid", "", "publication batch must be an object"),
    ]);

  const issues = exactKeys(safeBatch, BATCH_KEYS, "");
  if (safeBatch.version !== PROVISIONAL_PUBLICATION_BATCH_VERSION)
    issues.push(
      issue("batch_shape_invalid", "/version", "unsupported batch version"),
    );
  const batchId = safeBatch.batch_id;
  if (typeof batchId !== "string" || !ID_PATTERN.test(batchId))
    issues.push(
      issue(
        "batch_id_invalid",
        "/batch_id",
        "batch_id must be a 3-128 character identifier",
      ),
    );
  if (safeBatch.plan_sha256 !== P0_SOURCE_ROLE_PLAN_SHA256)
    issues.push(
      issue(
        "plan_mismatch",
        "/plan_sha256",
        "publication batch must bind the sealed P0 source-role plan",
      ),
    );
  if (!validTimestamp(safeBatch.published_at))
    issues.push(
      issue(
        "published_at_invalid",
        "/published_at",
        "published_at must be an ISO date-time",
      ),
    );
  const safeMembers = safeBatch.members;
  const rawMembers = rawBatch.members;
  if (!Array.isArray(safeMembers) || !Array.isArray(rawMembers)) {
    issues.push(
      issue("members_invalid", "/members", "members must be an array"),
    );
    return rejected(issues);
  }
  if (
    safeMembers.length === 0 ||
    safeMembers.length > MAX_PROVISIONAL_PUBLICATION_BATCH_MEMBERS
  )
    issues.push(
      issue(
        "batch_too_large",
        "/members",
        `members must contain 1-${MAX_PROVISIONAL_PUBLICATION_BATCH_MEMBERS} entries`,
      ),
    );

  const seenMemberIds = new Set<string>();
  const memberInputs: {
    readonly index: number;
    readonly member_id: string;
    readonly admission_request: ProvisionalRuleAdmissionRequest | null;
  }[] = [];
  for (let index = 0; index < safeMembers.length; index += 1) {
    const safeMember = asRecord(safeMembers[index]);
    const rawMember = asRecord(rawMembers[index]);
    const path = `/members/${index}`;
    if (!safeMember || !rawMember) {
      issues.push(
        issue("member_shape_invalid", path, "member must be an object"),
      );
      continue;
    }
    issues.push(...exactKeys(safeMember, MEMBER_KEYS, path));
    const memberId = safeMember.member_id;
    if (typeof memberId !== "string" || !ID_PATTERN.test(memberId))
      issues.push(
        issue(
          "member_id_invalid",
          `${path}/member_id`,
          "member_id must be a 3-128 character identifier",
        ),
      );
    else if (seenMemberIds.has(memberId))
      issues.push(
        issue(
          "duplicate_member_id",
          `${path}/member_id`,
          "member_id must be unique within a batch",
          { member_id: memberId },
        ),
      );
    else seenMemberIds.add(memberId);
    const safeAdmissionRequest = asRecord(safeMember.admission_request);
    if (safeAdmissionRequest) {
      issues.push(
        ...exactKeys(
          safeAdmissionRequest,
          ADMISSION_REQUEST_KEYS,
          `${path}/admission_request`,
        ),
      );
      for (const key of ADMISSION_REQUEST_KEYS) {
        if (!Object.hasOwn(safeAdmissionRequest, key))
          issues.push(
            issue(
              "member_shape_invalid",
              `${path}/admission_request/${key}`,
              "required field is missing",
            ),
          );
      }
    }
    const admissionRequest = makeAdmissionRequest(safeMember, rawMember);
    if (!admissionRequest)
      issues.push(
        issue(
          "member_shape_invalid",
          `${path}/admission_request`,
          "admission_request must be an object containing candidate, observation, and p0_coverage_index",
        ),
      );
    memberInputs.push({
      index,
      member_id: typeof memberId === "string" ? memberId : `member-${index}`,
      admission_request: admissionRequest,
    });
  }
  if (issues.length > 0) return rejected(issues);

  const prepared: PreparedMember[] = [];
  const candidateHashes = new Map<Sha256, number>();
  const candidateIds = new Map<string, number>();
  for (const member of memberInputs) {
    if (!member.admission_request) continue;
    const result = admitProvisionalRuleCandidate(member.admission_request);
    if (!result.ok) {
      const details: Partial<PublicationBatchIssue> =
        result.candidate_hash === undefined
          ? {
              member_id: member.member_id,
              admission_issues: result.issues,
            }
          : {
              member_id: member.member_id,
              candidate_hash: result.candidate_hash,
              admission_issues: result.issues,
            };
      issues.push(
        issue(
          "admission_rejected",
          `/members/${member.index}/admission_request`,
          "member admission was rejected",
          details,
        ),
      );
      continue;
    }
    const previous = candidateHashes.get(result.candidate_hash);
    if (previous !== undefined) {
      issues.push(
        issue(
          "duplicate_candidate_hash",
          `/members/${member.index}/admission_request/candidate`,
          "candidate hash must be unique within a publication batch",
          {
            member_id: member.member_id,
            candidate_hash: result.candidate_hash,
          },
        ),
      );
      continue;
    }
    candidateHashes.set(result.candidate_hash, member.index);
    const candidateId = result.envelope.candidate.candidate_id;
    if (candidateId !== undefined) {
      const previousId = candidateIds.get(candidateId);
      if (previousId !== undefined) {
        issues.push(
          issue(
            "duplicate_candidate_id",
            `/members/${member.index}/admission_request/candidate/candidate_id`,
            "candidate_id must be unique within a publication batch",
            {
              member_id: member.member_id,
              candidate_hash: result.candidate_hash,
            },
          ),
        );
        continue;
      }
      candidateIds.set(candidateId, member.index);
    }
    // Use the representation-checked member clone for the stored identity.
    const safeMember = asRecord(
      Array.isArray((scanned.value as Record<string, unknown>).members)
        ? ((scanned.value as Record<string, unknown>).members as unknown[])[
            member.index
          ]
        : undefined,
    );
    const rawMember = asRecord(rawMembers[member.index]);
    const safeAdmission = safeMember
      ? asRecord(safeMember.admission_request)
      : null;
    const rawAdmission = rawMember
      ? asRecord(rawMember.admission_request)
      : null;
    const requestSnapshot =
      safeAdmission && rawAdmission
        ? normalizedRequestSnapshot(safeAdmission, rawAdmission)
        : null;
    if (!requestSnapshot) {
      issues.push(
        issue(
          "member_shape_invalid",
          `/members/${member.index}/admission_request`,
          "admission request could not be snapshotted",
          { member_id: member.member_id },
        ),
      );
      continue;
    }
    const activated = activateExperimental(
      result.envelope,
      safeBatch.published_at as string,
      `batch:${batchId as string}`,
    );
    if (!activated.ok) {
      issues.push(
        issue(
          "activation_rejected",
          `/members/${member.index}/admission_request`,
          activated.message,
          {
            member_id: member.member_id,
            candidate_hash: result.candidate_hash,
          },
        ),
      );
      continue;
    }
    prepared.push({
      member_id: member.member_id,
      candidate_hash: result.candidate_hash,
      definition_hash: result.definition_hash,
      envelope: activated.envelope,
      admission_request: requestSnapshot,
    });
  }
  if (issues.length > 0) return rejected(issues);

  const sorted = [...prepared].sort((left, right) =>
    left.candidate_hash.localeCompare(right.candidate_hash),
  );
  const published: ProvisionalPublicationBatchMember[] = sorted.map(
    (member) => ({
      member_id: member.member_id,
      candidate_hash: member.candidate_hash,
      definition_hash: member.definition_hash,
      envelope: member.envelope,
    }),
  );
  const batchHash = hashCanonical({
    version: PROVISIONAL_PUBLICATION_BATCH_VERSION,
    batch_id: batchId,
    plan_sha256: P0_SOURCE_ROLE_PLAN_SHA256,
    published_at: safeBatch.published_at,
    members: sorted.map((member) => ({
      member_id: member.member_id,
      candidate_hash: member.candidate_hash,
      definition_hash: member.definition_hash,
      admission_request: member.admission_request,
    })),
  });
  const batch: ProvisionalPublicationBatch = deepFreeze({
    version: PROVISIONAL_PUBLICATION_BATCH_VERSION,
    batch_id: batchId as string,
    plan_sha256: P0_SOURCE_ROLE_PLAN_SHA256,
    published_at: safeBatch.published_at as string,
    published,
    batch_hash: batchHash,
  });
  batchBrands.add(batch);
  const accepted: ProvisionalPublicationBatchAccepted = Object.freeze({
    ok: true as const,
    batch,
  });
  return accepted;
}

export function hasPublicationBatchBrand(
  value: unknown,
): value is ProvisionalPublicationBatch {
  return value !== null && typeof value === "object" && batchBrands.has(value);
}

/** Alias using the package's shorter admission vocabulary. */
export const prepareProvisionalPublicationBatch =
  preflightProvisionalPublicationBatch;
