import type { QueryResult, QueryTarget } from "./adapter.js";

/**
 * Load the current implementation facts as research-artifact documents.
 *
 * The routing graph and the payment layers are compiled from research claims.
 * Those claims live both in checked-in fixtures and in the database, but only
 * the fixtures were ever read, so a refreshed fact could not change an answer.
 * This loader closes that gap: it returns the same document shape the
 * compilers already accept, assembled from the current snapshot of each
 * research artifact, so nothing downstream needs to know where the claims came
 * from.
 *
 * It is read-only and driver-free, and it validates every column before
 * building a document — a row that is not exactly what the projection promises
 * fails the whole load rather than silently compiling a partial graph.
 */

export const P0_IMPLEMENTATION_RULE_FACTS_QUERY = `
select claim_id, family_id, source_role_id, claim_type, subject, predicate,
       source_ids, value, applicability, research_artifact_id,
       implementation_version, implementation_hash, as_of
  from app_private.p0_implementation_rule_facts_at($1::timestamptz)
`;

/** The projection is bounded at 2,049; anything at or beyond that is a fault. */
const MAX_FACT_ROWS = 2_048;

export interface P0ImplementationArtifactProvenance {
  readonly research_artifact_id: string;
  readonly implementation_version: string;
  readonly implementation_hash: string;
  readonly as_of: string;
  readonly claim_count: number;
}

export interface P0ImplementationArtifactLoad {
  /** Research-artifact documents, ready for the existing compilers. */
  readonly artifacts: readonly unknown[];
  readonly provenance: readonly P0ImplementationArtifactProvenance[];
  /** Newest `as_of` across the loaded artifacts, or null when none loaded. */
  readonly as_of: string | null;
}

type Row = Record<string, unknown>;

function text(row: Row, field: string): string {
  const value = row[field];
  if (typeof value !== "string" || value.length === 0)
    throw new TypeError(`p0_implementation_fact_${field}_invalid`);
  return value;
}

/**
 * Accept the timestamp in either of the shapes a driver may return.
 *
 * node-postgres parses `timestamptz` into a Date while other adapters leave it
 * as text, and both are correct; a value that is neither is not.
 */
function timestamp(row: Row, field: string): string {
  const value = row[field];
  if (value instanceof Date) {
    const time = value.getTime();
    if (!Number.isFinite(time))
      throw new TypeError(`p0_implementation_fact_${field}_invalid`);
    return value.toISOString();
  }
  if (typeof value === "string" && Number.isFinite(Date.parse(value)))
    return new Date(value).toISOString();
  throw new TypeError(`p0_implementation_fact_${field}_invalid`);
}

/** `jsonb` arrives parsed from most drivers and as text from a few. */
function json(row: Row, field: string): unknown {
  const value = row[field];
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      throw new TypeError(`p0_implementation_fact_${field}_invalid`);
    }
  }
  if (value === undefined)
    throw new TypeError(`p0_implementation_fact_${field}_invalid`);
  return value;
}

function stringArray(row: Row, field: string): readonly string[] {
  const value = json(row, field);
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every((item) => typeof item === "string" && item.length > 0)
  )
    throw new TypeError(`p0_implementation_fact_${field}_invalid`);
  return [...value].sort();
}

function record(row: Row, field: string): Record<string, unknown> {
  const value = json(row, field);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError(`p0_implementation_fact_${field}_invalid`);
  return value as Record<string, unknown>;
}

/**
 * Read the current facts and group them back into research artifacts.
 *
 * Claims are grouped by the artifact that published them so each compiled
 * document keeps its own identity and hash, which is what makes a per-artifact
 * refresh visible rather than blending every fact into one anonymous set.
 */
export async function loadCurrentP0ImplementationArtifacts(
  target: QueryTarget,
  effectiveAt: string,
): Promise<P0ImplementationArtifactLoad> {
  if (
    typeof effectiveAt !== "string" ||
    !Number.isFinite(Date.parse(effectiveAt))
  )
    throw new TypeError("p0_implementation_effective_at_invalid");
  const result: QueryResult<Row> = await target.query(
    P0_IMPLEMENTATION_RULE_FACTS_QUERY,
    [effectiveAt],
  );
  if (!result || !Array.isArray(result.rows))
    throw new TypeError("p0_implementation_fact_result_invalid");
  if (result.rows.length > MAX_FACT_ROWS)
    throw new TypeError("p0_implementation_fact_too_many_rows");

  interface Group {
    readonly implementation_version: string;
    readonly implementation_hash: string;
    readonly as_of: string;
    readonly claims: Record<string, unknown>[];
  }
  const groups = new Map<string, Group>();
  const seenClaims = new Set<string>();

  for (const row of result.rows) {
    if (!row || typeof row !== "object" || Array.isArray(row))
      throw new TypeError("p0_implementation_fact_row_invalid");
    const claimId = text(row, "claim_id");
    if (seenClaims.has(claimId))
      throw new TypeError(`p0_implementation_fact_claim_duplicate:${claimId}`);
    seenClaims.add(claimId);
    const artifactId = text(row, "research_artifact_id");
    const version = text(row, "implementation_version");
    const hash = text(row, "implementation_hash");
    const asOf = timestamp(row, "as_of");
    const existing = groups.get(artifactId);
    // Every row of one artifact comes from a single snapshot, so a group whose
    // rows disagree means the projection returned a mixture.  Compiling that
    // would produce a graph belonging to no snapshot and carrying a provenance
    // hash that describes only part of it.
    if (
      existing &&
      (existing.implementation_version !== version ||
        existing.implementation_hash !== hash ||
        existing.as_of !== asOf)
    )
      throw new TypeError(
        `p0_implementation_fact_snapshot_inconsistent:${artifactId}`,
      );
    const group = existing ?? {
      implementation_version: version,
      implementation_hash: hash,
      as_of: asOf,
      claims: [],
    };
    group.claims.push({
      claim_id: claimId,
      family_id: text(row, "family_id"),
      source_role_id: text(row, "source_role_id"),
      claim_type: text(row, "claim_type"),
      subject: text(row, "subject"),
      predicate: text(row, "predicate"),
      source_ids: stringArray(row, "source_ids"),
      value: json(row, "value"),
      applicability: record(row, "applicability"),
    });
    groups.set(artifactId, group);
  }

  const artifactIds = [...groups.keys()].sort();
  const artifacts = artifactIds.map((artifactId) => {
    const group = groups.get(artifactId) as Group;
    return {
      metadata: {
        artifact_id: artifactId,
        implementation_version: group.implementation_version,
        implementation_hash: group.implementation_hash,
        as_of: group.as_of,
      },
      // The compilers read claims only; the source directory is a separate
      // browse-time concern and is deliberately not widened by this loader.
      sources: [],
      claims: group.claims.sort((left, right) =>
        String(left.claim_id).localeCompare(String(right.claim_id)),
      ),
    };
  });

  const provenance = artifactIds.map((artifactId) => {
    const group = groups.get(artifactId) as Group;
    return {
      research_artifact_id: artifactId,
      implementation_version: group.implementation_version,
      implementation_hash: group.implementation_hash,
      as_of: group.as_of,
      claim_count: group.claims.length,
    };
  });

  const newest = provenance.reduce<string | null>(
    (latest, item) =>
      latest === null || Date.parse(item.as_of) > Date.parse(latest)
        ? item.as_of
        : latest,
    null,
  );

  return { artifacts, provenance, as_of: newest };
}
