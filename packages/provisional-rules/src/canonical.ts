import { canonicalize, canonicalSha256, definitionHash } from "@jro/contracts";
import { hasEnvelopeBrand } from "./brand.js";
import { deepFreeze, scanPublicValue } from "./security.js";
import type {
  AdmissionIssue,
  P0CoverageEntry,
  P0CoverageIndex,
  ProvisionalRuleCandidate,
  ProvisionalRuleEnvelope,
  Sha256,
} from "./types.js";

export { canonicalize };

export function hashDefinition(value: unknown): Sha256 {
  return definitionHash(value) as Sha256;
}

export function hashCanonical(value: unknown): Sha256 {
  return canonicalSha256(value) as Sha256;
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function candidateIdentityProjection(
  candidate: ProvisionalRuleCandidate,
  definition_hash: Sha256,
): Record<string, unknown> {
  return {
    version: candidate.version,
    candidate_id: candidate.candidate_id ?? null,
    observation_id: candidate.observation_id,
    observation_fingerprint: candidate.observation_fingerprint,
    p0_family_id: candidate.p0_family_id,
    source_role_id: candidate.source_role_id,
    source_authority_role: candidate.source_authority_role,
    source_ids: sortedUnique(candidate.source_ids),
    definition_hash,
    extractor: {
      name: candidate.extractor.name,
      version: candidate.extractor.version,
    },
  };
}

export function hashCandidate(
  candidate: ProvisionalRuleCandidate,
  definition_hash: Sha256,
): Sha256 {
  return hashCanonical(candidateIdentityProjection(candidate, definition_hash));
}

export function serializeProvisionalRuleEnvelope(
  envelope: ProvisionalRuleEnvelope,
): string {
  if (!hasEnvelopeBrand(envelope)) throw new TypeError("envelope_invalid");
  return canonicalize(envelope);
}

export function hashProvisionalRuleEnvelope(
  envelope: ProvisionalRuleEnvelope,
): Sha256 {
  if (!hasEnvelopeBrand(envelope)) throw new TypeError("envelope_invalid");
  return hashCanonical(envelope);
}

function issue(
  code: AdmissionIssue["code"],
  path: string,
  message: string,
): AdmissionIssue {
  return { code, path, message };
}

function parseCoverageEntry(
  value: unknown,
  family_id: string | undefined,
  path: string,
): { entry: P0CoverageEntry | null; issues: AdmissionIssue[] } {
  const issues: AdmissionIssue[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      entry: null,
      issues: [
        issue(
          "coverage_index_invalid",
          path,
          "coverage entry must be an object",
        ),
      ],
    };
  }
  const record = value as Record<string, unknown>;
  const actualFamily =
    typeof record.family_id === "string" ? record.family_id : family_id;
  if (actualFamily === undefined || actualFamily.length === 0)
    issues.push(
      issue(
        "coverage_index_invalid",
        `${path}/family_id`,
        "coverage family_id is required",
      ),
    );
  const sourceRoleId = record.source_role_id;
  if (typeof sourceRoleId !== "string" || sourceRoleId.length === 0)
    issues.push(
      issue(
        "coverage_index_invalid",
        `${path}/source_role_id`,
        "coverage source_role_id is required",
      ),
    );
  const knownValue = record.known_source_ids ?? record.source_ids;
  if (
    !Array.isArray(knownValue) ||
    knownValue.length === 0 ||
    knownValue.some((item) => typeof item !== "string")
  )
    issues.push(
      issue(
        "coverage_index_invalid",
        `${path}/known_source_ids`,
        "coverage known_source_ids must be a non-empty string array",
      ),
    );
  const known = Array.isArray(knownValue)
    ? (knownValue.filter(
        (item): item is string => typeof item === "string",
      ) as string[])
    : [];
  if (new Set(known).size !== known.length)
    issues.push(
      issue(
        "coverage_index_invalid",
        `${path}/known_source_ids`,
        "coverage known_source_ids must be unique",
      ),
    );
  if (
    issues.length > 0 ||
    actualFamily === undefined ||
    typeof sourceRoleId !== "string"
  )
    return { entry: null, issues };
  return {
    entry: {
      family_id: actualFamily,
      source_role_id: sourceRoleId,
      known_source_ids: sortedUnique(known),
    },
    issues,
  };
}

/** Normalize a frozen caller index into a sorted, deterministic snapshot. */
export function normalizeCoverageIndex(value: unknown): {
  index: P0CoverageIndex | null;
  issues: readonly AdmissionIssue[];
} {
  const scan = scanPublicValue(value);
  if (!scan.valid) return { index: null, issues: scan.issues };
  if (!Object.isFrozen(value) || !isDeeplyFrozenRecord(value))
    return {
      index: null,
      issues: [
        issue(
          "coverage_index_not_immutable",
          "",
          "P0 coverage index must be deeply frozen before admission",
        ),
      ],
    };
  if (
    !scan.value ||
    typeof scan.value !== "object" ||
    Array.isArray(scan.value)
  )
    return {
      index: null,
      issues: [
        issue(
          "coverage_index_invalid",
          "",
          "P0 coverage index must be an object",
        ),
      ],
    };
  const record = scan.value as Record<string, unknown>;
  const version = record.version;
  if (typeof version !== "string" || version.length === 0)
    return {
      index: null,
      issues: [
        issue(
          "coverage_index_invalid",
          "/version",
          "P0 coverage index version is required",
        ),
      ],
    };
  const rawEntries = record.entries;
  const entries: P0CoverageEntry[] = [];
  const issues: AdmissionIssue[] = [];
  if (Array.isArray(rawEntries)) {
    rawEntries.forEach((entry, index) => {
      const parsed = parseCoverageEntry(entry, undefined, `/entries/${index}`);
      issues.push(...parsed.issues);
      if (parsed.entry) entries.push(parsed.entry);
    });
  } else if (
    record.families &&
    typeof record.families === "object" &&
    !Array.isArray(record.families)
  ) {
    for (const [family, entry] of Object.entries(record.families)) {
      const parsed = parseCoverageEntry(entry, family, `/families/${family}`);
      issues.push(...parsed.issues);
      if (parsed.entry) entries.push(parsed.entry);
    }
  } else {
    issues.push(
      issue(
        "coverage_index_invalid",
        "/entries",
        "P0 coverage index entries are required",
      ),
    );
  }
  const tupleIds = entries.map(
    (entry) => `${entry.family_id}\u0000${entry.source_role_id}`,
  );
  if (new Set(tupleIds).size !== tupleIds.length)
    issues.push(
      issue(
        "coverage_index_invalid",
        "/entries",
        "coverage family/source-role tuples must be unique",
      ),
    );
  if (entries.length === 0)
    issues.push(
      issue(
        "coverage_index_invalid",
        "/entries",
        "coverage index must contain a family",
      ),
    );
  if (issues.length > 0)
    return { index: null, issues: sortedCoverageIssues(issues) };
  const normalized: P0CoverageIndex = {
    version,
    entries: [...entries].sort(
      (left, right) =>
        left.family_id.localeCompare(right.family_id) ||
        left.source_role_id.localeCompare(right.source_role_id),
    ),
  };
  return { index: deepFreeze(normalized), issues: [] };
}

function sortedCoverageIssues(
  issues: readonly AdmissionIssue[],
): AdmissionIssue[] {
  return [...issues].sort(
    (left, right) =>
      left.path.localeCompare(right.path) ||
      left.code.localeCompare(right.code) ||
      left.message.localeCompare(right.message),
  );
}

function isDeeplyFrozenRecord(value: unknown): boolean {
  const visited = new WeakSet<object>();
  const visit = (current: unknown): boolean => {
    if (current === null || typeof current !== "object") return true;
    if (visited.has(current)) return true;
    if (!Object.isFrozen(current)) return false;
    visited.add(current);
    if (Array.isArray(current)) return current.every((item) => visit(item));
    return Object.values(current).every((item) => visit(item));
  };
  return visit(value);
}

/** Make a safe immutable index from a normal JSON-like input. */
export function freezeP0CoverageIndex(value: unknown): P0CoverageIndex {
  const scan = scanPublicValue(value);
  if (!scan.valid) throw new TypeError("invalid P0 coverage index input");
  const normalized = normalizeCoverageIndex(deepFreeze(scan.value));
  if (!normalized.index) throw new TypeError("invalid P0 coverage index");
  return normalized.index;
}
