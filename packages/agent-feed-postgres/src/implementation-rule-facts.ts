import { types as nodeTypes } from "node:util";

import type { QueryResult, QueryTarget } from "./adapter.js";

/**
 * The original implementation-fact function has a deployed return contract.
 * Route-graph callers use the additive v2 projection so source descriptors can
 * be carried without changing that existing function signature.
 */
export const P0_ROUTE_GRAPH_FACTS_FUNCTION =
  "app_private.p0_route_graph_facts_at" as const;
export const P0_IMPLEMENTATION_RULE_FACTS_FUNCTION =
  P0_ROUTE_GRAPH_FACTS_FUNCTION;

export const P0_ROUTE_GRAPH_FACTS_QUERY = `
select claim_id, family_id, source_role_id, claim_type, subject, predicate,
       source_ids, value, applicability, research_artifact_id,
       implementation_version, implementation_hash, as_of,
       source_identity, exclusions
  from ${P0_ROUTE_GRAPH_FACTS_FUNCTION}($1::timestamptz)
 order by research_artifact_id asc, claim_id asc
 limit 2049
`;
export const P0_IMPLEMENTATION_RULE_FACTS_QUERY = P0_ROUTE_GRAPH_FACTS_QUERY;

/** The private projection is bounded at 2,049; anything at or beyond that is a fault. */
export const MAX_P0_ROUTE_GRAPH_FACT_ROWS = 2_048 as const;
export const MAX_P0_IMPLEMENTATION_RULE_FACT_ROWS =
  MAX_P0_ROUTE_GRAPH_FACT_ROWS;

export interface P0ImplementationSourceDescriptor {
  readonly source_id: string;
  readonly family_id: string;
  readonly roles: readonly string[];
  readonly url: string;
  readonly publisher: string;
  readonly official_domain: string;
}

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

type JsonRecord = Record<string, unknown>;

const FACT_ROW_KEYS = Object.freeze([
  "claim_id",
  "family_id",
  "source_role_id",
  "claim_type",
  "subject",
  "predicate",
  "source_ids",
  "value",
  "applicability",
  "research_artifact_id",
  "implementation_version",
  "implementation_hash",
  "as_of",
  "source_identity",
  "exclusions",
] as const);

const SOURCE_IDENTITY_KEYS = Object.freeze([
  "source_id",
  "family_id",
  "roles",
  "url",
  "publisher",
  "official_domain",
] as const);

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,4095}$/u;
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/u;

function isPlainRecord(value: unknown): value is JsonRecord {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    nodeTypes.isProxy(value)
  )
    return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function keySetEquals(
  keys: readonly string[],
  expected: readonly string[],
): boolean {
  if (keys.length !== expected.length) return false;
  const actual = new Set(keys);
  return expected.every((key) => actual.has(key));
}

/** Read only data descriptors; accessors and proxies are rejected first. */
function descriptorRecord(
  value: unknown,
  expected: readonly string[],
  error: string,
): JsonRecord {
  if (!isPlainRecord(value)) throw new TypeError(error);
  let descriptors: Record<string, PropertyDescriptor>;
  try {
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    throw new TypeError(error);
  }
  const ownKeys = Reflect.ownKeys(descriptors);
  if (ownKeys.some((key) => typeof key !== "string"))
    throw new TypeError(error);
  const keys = Object.keys(descriptors);
  if (!keySetEquals(keys, expected)) throw new TypeError(error);
  const output = Object.create(null) as JsonRecord;
  for (const key of expected) {
    const descriptor = descriptors[key];
    if (
      !descriptor ||
      descriptor.enumerable !== true ||
      !Object.hasOwn(descriptor, "value")
    )
      throw new TypeError(error);
    output[key] = descriptor.value;
  }
  return output;
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 4096)
    throw new TypeError(`p0_implementation_fact_${field}_invalid`);
  return value;
}

function identifier(value: unknown, field: string): string {
  const result = text(value, field);
  if (!IDENTIFIER_PATTERN.test(result))
    throw new TypeError(`p0_implementation_fact_${field}_invalid`);
  return result;
}

function hash(value: unknown, field: string): string {
  const result = text(value, field);
  if (!HASH_PATTERN.test(result))
    throw new TypeError(`p0_implementation_fact_${field}_invalid`);
  return result;
}

function timestamp(value: unknown, field: string): string {
  if (value instanceof Date && !nodeTypes.isProxy(value)) {
    if (!Number.isFinite(value.getTime()))
      throw new TypeError(`p0_implementation_fact_${field}_invalid`);
    return value.toISOString();
  }
  if (typeof value === "string" && Number.isFinite(Date.parse(value)))
    return new Date(value).toISOString();
  throw new TypeError(`p0_implementation_fact_${field}_invalid`);
}

/**
 * Clone JSON-shaped values by descriptors before any domain field is read.
 * This intentionally does not apply public-secret redaction: implementation
 * claim values may legitimately use abstract keys such as `credential`, while
 * the route loader still rejects proxies, accessors, cycles, and non-plain
 * values.
 */
function clonePlainJson(
  value: unknown,
  field: string,
  active: WeakSet<object> = new WeakSet(),
  depth = 0,
): unknown {
  const invalid = () =>
    new TypeError(`p0_implementation_fact_${field}_invalid`);
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    if (typeof value === "string" && value.length > 1_000_000) throw invalid();
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw invalid();
    return value;
  }
  if (
    typeof value !== "object" ||
    nodeTypes.isProxy(value) ||
    depth > 32 ||
    active.has(value)
  )
    throw invalid();
  active.add(value);
  let prototype: object | null;
  let descriptors: Record<string, PropertyDescriptor>;
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    active.delete(value);
    throw invalid();
  }
  const keys = Object.keys(descriptors);
  const ownKeys = Reflect.ownKeys(descriptors);
  if (ownKeys.some((key) => typeof key !== "string")) {
    active.delete(value);
    throw invalid();
  }
  if (Array.isArray(value)) {
    const lengthDescriptor = descriptors.length;
    const length =
      lengthDescriptor &&
      Object.hasOwn(lengthDescriptor, "value") &&
      typeof lengthDescriptor.value === "number"
        ? lengthDescriptor.value
        : -1;
    if (
      !Number.isSafeInteger(length) ||
      length < 0 ||
      length > 10_000 ||
      ownKeys.length !== length + 1
    ) {
      active.delete(value);
      throw invalid();
    }
    const output: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (
        !descriptor ||
        descriptor.enumerable !== true ||
        !Object.hasOwn(descriptor, "value")
      ) {
        active.delete(value);
        throw invalid();
      }
      output.push(clonePlainJson(descriptor.value, field, active, depth + 1));
    }
    active.delete(value);
    return output;
  }
  if (prototype !== Object.prototype && prototype !== null) {
    active.delete(value);
    throw invalid();
  }
  if (keys.length > 10_000) {
    active.delete(value);
    throw invalid();
  }
  const output = Object.create(null) as JsonRecord;
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (
      key === "__proto__" ||
      key === "prototype" ||
      key === "constructor" ||
      !descriptor ||
      descriptor.enumerable !== true ||
      !Object.hasOwn(descriptor, "value")
    ) {
      active.delete(value);
      throw invalid();
    }
    output[key] = clonePlainJson(descriptor.value, field, active, depth + 1);
  }
  active.delete(value);
  return output;
}

/** Parse and descriptor-scan JSONB values before any domain field is read. */
function json(value: unknown, field: string): unknown {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      throw new TypeError(`p0_implementation_fact_${field}_invalid`);
    }
  }
  return clonePlainJson(parsed, field);
}

function jsonRecord(value: unknown, field: string): JsonRecord {
  const parsed = json(value, field);
  if (!isPlainRecord(parsed))
    throw new TypeError(`p0_implementation_fact_${field}_invalid`);
  return parsed;
}

function stringArray(
  value: unknown,
  field: string,
  allowEmpty: boolean,
  sortValues = true,
): readonly string[] {
  const parsed = json(value, field);
  if (
    !Array.isArray(parsed) ||
    parsed.length > 512 ||
    (!allowEmpty && parsed.length === 0)
  )
    throw new TypeError(`p0_implementation_fact_${field}_invalid`);
  const values = parsed.map((item) => text(item, field));
  if (new Set(values).size !== values.length)
    throw new TypeError(`p0_implementation_fact_${field}_invalid`);
  return Object.freeze(
    sortValues
      ? [...values].sort((left, right) => left.localeCompare(right))
      : [...values],
  );
}

function sourceIdentity(
  value: unknown,
  field: string,
): P0ImplementationSourceDescriptor {
  const record = descriptorRecord(
    value,
    SOURCE_IDENTITY_KEYS,
    `p0_implementation_fact_${field}_invalid`,
  );
  return Object.freeze({
    source_id: identifier(record.source_id, `${field}_source_id`),
    family_id: identifier(record.family_id, `${field}_family_id`),
    roles: stringArray(record.roles, `${field}_roles`, false),
    url: text(record.url, `${field}_url`),
    publisher: text(record.publisher, `${field}_publisher`),
    official_domain: text(record.official_domain, `${field}_official_domain`),
  });
}

function sourceIdentities(
  value: unknown,
  claimId: string,
): readonly P0ImplementationSourceDescriptor[] {
  const parsed = json(value, "source_identity");
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 512)
    throw new TypeError(
      `p0_implementation_fact_source_identity_invalid:${claimId}`,
    );
  const descriptors = parsed.map((item) =>
    sourceIdentity(item, "source_identity"),
  );
  if (
    new Set(descriptors.map((item) => item.source_id)).size !==
    descriptors.length
  )
    throw new TypeError(
      `p0_implementation_fact_source_identity_duplicate:${claimId}`,
    );
  return Object.freeze(
    [...descriptors].sort((left, right) =>
      left.source_id.localeCompare(right.source_id),
    ),
  );
}

function sameSource(
  left: P0ImplementationSourceDescriptor,
  right: P0ImplementationSourceDescriptor,
): boolean {
  return (
    left.source_id === right.source_id &&
    left.family_id === right.family_id &&
    left.url === right.url &&
    left.publisher === right.publisher &&
    left.official_domain === right.official_domain &&
    left.roles.length === right.roles.length &&
    left.roles.every((role, index) => role === right.roles[index])
  );
}

function claimSourceIdentityMatches(
  claimId: string,
  sourceIds: readonly string[],
  identities: readonly P0ImplementationSourceDescriptor[],
): void {
  const identityIds = identities.map((item) => item.source_id);
  if (
    identityIds.length !== sourceIds.length ||
    identityIds.some((sourceId, index) => sourceId !== sourceIds[index])
  )
    throw new TypeError(
      `p0_implementation_fact_source_identity_mismatch:${claimId}`,
    );
}

function effectiveAt(value: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)))
    throw new TypeError("p0_implementation_effective_at_invalid");
  return value;
}

/**
 * Read the current facts and rebuild descriptor-first research artifacts.
 *
 * The source directory is reconstructed per artifact from the exact identity
 * stored on each fact. Repeated source IDs are accepted only when their full
 * descriptor is identical; a conflict fails the entire load.
 */
export async function loadCurrentP0ImplementationArtifacts(
  target: QueryTarget,
  requestedEffectiveAt: string,
): Promise<P0ImplementationArtifactLoad> {
  const instant = effectiveAt(requestedEffectiveAt);
  const result: QueryResult<unknown> = await target.query(
    P0_ROUTE_GRAPH_FACTS_QUERY,
    [instant],
  );
  if (!result || !Array.isArray(result.rows))
    throw new TypeError("p0_implementation_fact_result_invalid");
  if (result.rows.length > MAX_P0_ROUTE_GRAPH_FACT_ROWS)
    throw new TypeError("p0_implementation_fact_too_many_rows");

  interface Claim {
    readonly claim_id: string;
    readonly family_id: string;
    readonly source_role_id: string;
    readonly claim_type: string;
    readonly subject: string;
    readonly predicate: string;
    readonly source_ids: readonly string[];
    readonly value: unknown;
    readonly applicability: JsonRecord;
    readonly exclusions: readonly string[];
  }
  interface Group {
    readonly implementation_version: string;
    readonly implementation_hash: string;
    readonly as_of: string;
    readonly claims: Claim[];
    readonly sources: Map<string, P0ImplementationSourceDescriptor>;
  }

  const groups = new Map<string, Group>();
  const seenClaims = new Set<string>();

  for (const rawRow of result.rows) {
    const row = descriptorRecord(
      rawRow,
      FACT_ROW_KEYS,
      "p0_implementation_fact_row_shape_invalid",
    );
    const claimId = identifier(row.claim_id, "claim_id");
    if (seenClaims.has(claimId))
      throw new TypeError(`p0_implementation_fact_claim_duplicate:${claimId}`);
    seenClaims.add(claimId);

    const artifactId = identifier(
      row.research_artifact_id,
      "research_artifact_id",
    );
    const version = text(row.implementation_version, "implementation_version");
    const implementationHash = hash(
      row.implementation_hash,
      "implementation_hash",
    );
    const asOf = timestamp(row.as_of, "as_of");
    const sourceIds = stringArray(row.source_ids, "source_ids", false);
    const identities = sourceIdentities(row.source_identity, claimId);
    claimSourceIdentityMatches(claimId, sourceIds, identities);
    const applicability = jsonRecord(row.applicability, "applicability");
    const exclusions = stringArray(row.exclusions, "exclusions", true, false);
    const existing = groups.get(artifactId);
    if (
      existing &&
      (existing.implementation_version !== version ||
        existing.implementation_hash !== implementationHash ||
        existing.as_of !== asOf)
    )
      throw new TypeError(
        `p0_implementation_fact_snapshot_inconsistent:${artifactId}`,
      );
    const group: Group = existing ?? {
      implementation_version: version,
      implementation_hash: implementationHash,
      as_of: asOf,
      claims: [],
      sources: new Map(),
    };

    for (const descriptor of identities) {
      const prior = group.sources.get(descriptor.source_id);
      if (prior && !sameSource(prior, descriptor))
        throw new TypeError(
          `p0_implementation_fact_source_identity_conflict:${artifactId}:${descriptor.source_id}`,
        );
      if (!prior) group.sources.set(descriptor.source_id, descriptor);
    }
    group.claims.push({
      claim_id: claimId,
      family_id: identifier(row.family_id, "family_id"),
      source_role_id: identifier(row.source_role_id, "source_role_id"),
      claim_type: text(row.claim_type, "claim_type"),
      subject: text(row.subject, "subject"),
      predicate: text(row.predicate, "predicate"),
      source_ids: sourceIds,
      value: json(row.value, "value"),
      applicability,
      exclusions,
    });
    groups.set(artifactId, group);
  }

  const artifactIds = [...groups.keys()].sort((left, right) =>
    left.localeCompare(right),
  );
  const artifacts = artifactIds.map((artifactId) => {
    const group = groups.get(artifactId) as Group;
    return {
      metadata: {
        artifact_id: artifactId,
        implementation_version: group.implementation_version,
        implementation_hash: group.implementation_hash,
        as_of: group.as_of,
      },
      sources: [...group.sources.values()].sort((left, right) =>
        left.source_id.localeCompare(right.source_id),
      ),
      claims: group.claims.sort((left, right) =>
        left.claim_id.localeCompare(right.claim_id),
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
