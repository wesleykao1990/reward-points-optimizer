import { types as nodeTypes } from "node:util";
import type { QueryResult, QueryTarget } from "./adapter.js";

/** The private SQL function that owns the complete correction-aware graph material. */
export const P0_FACT_INFLUENCE_GRAPH_FUNCTION =
  "app_private.p0_implementation_fact_influence_graph_rows" as const;
export const P0_IMPLEMENTATION_FACT_INFLUENCE_GRAPH_FUNCTION =
  P0_FACT_INFLUENCE_GRAPH_FUNCTION;

/** Resource ceiling, not an expected data count. The SQL-reported total is
 * reconciled dynamically so additive snapshots do not require code edits. */
export const MAX_P0_FACT_INFLUENCE_GRAPH_FACTS = 4096 as const;
export const P0_FACT_INFLUENCE_GRAPH_QUERY = `
select graph_order, fact_id, implementation_version, implementation_hash,
       fact_version, parent_claim_id, family_id, source_role_id, source_ids,
       source_identity, claim_type, subject, predicate, value, applicability,
       exclusions, evidence_locator, short_paraphrase, disposition,
       derived_rule_ids, reason, reason_detail, fact_payload, active_at,
       corrected, (count(*) over ())::integer as total_count
  from ${P0_FACT_INFLUENCE_GRAPH_FUNCTION}($1::timestamptz)
 order by graph_order asc
 limit $2::integer
`;
export const IMPLEMENTATION_FACT_INFLUENCE_GRAPH_QUERY =
  P0_FACT_INFLUENCE_GRAPH_QUERY;

export interface P0FactInfluenceGraphFact {
  readonly graph_order: string;
  readonly fact_id: string;
  readonly implementation_version: string;
  readonly implementation_hash: string;
  readonly fact_version: number;
  readonly parent_claim_id: string;
  readonly family_id: string;
  readonly source_role_id: string;
  readonly source_ids: readonly string[];
  /** Exact source binding as persisted by 0012; never a browser DTO. */
  readonly source_identity: unknown;
  readonly claim_type: string;
  readonly subject: string;
  readonly predicate: string;
  /** Exact JSON value as persisted by 0012; never a browser DTO. */
  readonly value: unknown;
  readonly applicability: unknown;
  readonly exclusions: unknown;
  readonly evidence_locator: string;
  readonly short_paraphrase: string;
  readonly disposition: "catalogue_fact" | "engine_rule";
  readonly derived_rule_ids: readonly string[];
  readonly reason: string;
  readonly reason_detail: string;
  /** Exact original entry envelope as persisted by 0012. */
  readonly fact_payload: unknown;
  /** Effective-time activity does not account for a correction. */
  readonly active_at: boolean;
  /** A correction remains addressable in the graph but cannot rank. */
  readonly corrected: boolean;
}

export interface P0FactInfluenceGraphSnapshot {
  readonly version: "p0-fact-influence-graph-source.v1";
  readonly effective_at: string;
  readonly fact_count: number;
  readonly facts: readonly P0FactInfluenceGraphFact[];
}

export interface P0FactInfluenceGraphOptions {
  readonly clock?: () => Date | string;
  readonly now?: () => Date | string;
}

export interface P0FactInfluenceGraphStore {
  readonly list: (
    effectiveAt?: string,
  ) => Promise<P0FactInfluenceGraphSnapshot>;
}

/** Generic aliases make the host boundary discoverable without changing the
 * SQL contract used by the P0-specific caller. */
export type P0ImplementationFactInfluenceGraphFact = P0FactInfluenceGraphFact;
export type P0ImplementationFactInfluenceGraphSnapshot =
  P0FactInfluenceGraphSnapshot;
export type P0ImplementationFactInfluenceGraphStore = P0FactInfluenceGraphStore;

type JsonRecord = Record<string, unknown>;

const ROW_KEYS = Object.freeze([
  "graph_order",
  "fact_id",
  "implementation_version",
  "implementation_hash",
  "fact_version",
  "parent_claim_id",
  "family_id",
  "source_role_id",
  "source_ids",
  "source_identity",
  "claim_type",
  "subject",
  "predicate",
  "value",
  "applicability",
  "exclusions",
  "evidence_locator",
  "short_paraphrase",
  "disposition",
  "derived_rule_ids",
  "reason",
  "reason_detail",
  "fact_payload",
  "active_at",
  "corrected",
  "total_count",
] as const);

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const VERSION_PATTERN =
  /^p0-[a-z0-9][a-z0-9._-]{0,95}\.implementation\.v[0-9]+(?:\.[0-9]+)*$/u;
const CLAIM_PATTERN = /^claim\.[A-Za-z0-9._:-]{1,240}$/u;
const GRAPH_ORDER_PATTERN =
  /^sha256:[0-9a-f]{64}:claim\.[A-Za-z0-9._:-]{1,240}:v[0-9]{4}$/u;
const SOURCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const REASONS = new Set([
  "non_calculable_fact",
  "insufficient_operation_mapping",
  "unsupported_calculation_model",
  "ended_or_future_inactive",
  "explicit_no_rate",
]);

function isPlainRecord(value: unknown): value is JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return false;
  if (nodeTypes.isProxy(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactRecord(value: unknown): JsonRecord {
  if (!isPlainRecord(value))
    throw new TypeError("p0_fact_influence_graph_row_shape_invalid");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actual = Object.keys(descriptors).sort();
  const expected = [...ROW_KEYS].sort();
  if (
    Object.getOwnPropertySymbols(value).length !== 0 ||
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  )
    throw new TypeError("p0_fact_influence_graph_row_shape_invalid");
  const result: JsonRecord = Object.create(null) as JsonRecord;
  for (const key of ROW_KEYS) {
    const descriptor = descriptors[key];
    if (
      descriptor === undefined ||
      descriptor.enumerable !== true ||
      !Object.hasOwn(descriptor, "value")
    )
      throw new TypeError("p0_fact_influence_graph_row_shape_invalid");
    result[key] = descriptor.value;
  }
  return result;
}

/**
 * Read an array by descriptors before touching any element.  The graph is a
 * host boundary, so sparse arrays, hidden/custom keys, accessors, symbols,
 * and proxies are all rejected without invoking a hostile getter.
 */
function arrayData(value: unknown, path: string): readonly unknown[] {
  if (
    value === null ||
    typeof value !== "object" ||
    nodeTypes.isProxy(value) ||
    !Array.isArray(value)
  )
    throw new TypeError(`p0_fact_influence_graph_${path}_array_invalid`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (
    lengthDescriptor === undefined ||
    lengthDescriptor.enumerable !== false ||
    !Object.hasOwn(lengthDescriptor, "value") ||
    typeof lengthDescriptor.value !== "number" ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0 ||
    lengthDescriptor.value > 4096
  )
    throw new TypeError(`p0_fact_influence_graph_${path}_array_invalid`);
  const length = lengthDescriptor.value;
  if (keys.length !== length + 1)
    throw new TypeError(`p0_fact_influence_graph_${path}_array_invalid`);
  const output: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const key = String(index);
    const descriptor = descriptors[key];
    if (
      descriptor === undefined ||
      descriptor.enumerable !== true ||
      !Object.hasOwn(descriptor, "value")
    )
      throw new TypeError(`p0_fact_influence_graph_${path}_array_invalid`);
    output.push(descriptor.value);
  }
  for (const key of keys) {
    if (key !== "length" && (typeof key !== "string" || !/^\d+$/u.test(key)))
      throw new TypeError(`p0_fact_influence_graph_${path}_array_invalid`);
  }
  if (
    keys.some(
      (key) =>
        typeof key === "string" &&
        key !== "length" &&
        (!Object.hasOwn(descriptors, key) ||
          !Object.hasOwn(descriptors[key] as object, "value")),
    )
  )
    throw new TypeError(`p0_fact_influence_graph_${path}_array_invalid`);
  return output;
}

function safeText(value: unknown, field: string, max = 4096): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > max ||
    value.includes("\n") ||
    value.includes("\r")
  )
    throw new TypeError(`p0_fact_influence_graph_${field}_invalid`);
  return value;
}

function safeIdentifier(value: unknown, field: string, max = 256): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > max ||
    !SAFE_IDENTIFIER_PATTERN.test(value)
  )
    throw new TypeError(`p0_fact_influence_graph_${field}_invalid`);
  return value;
}

/** Validate JSON without rewriting it.  This rejects accessors, proxies,
 * bigint, undefined, and class instances while preserving key order and
 * scalar representation for the host graph canonicalizer. */
function validateJson(inputValue: unknown, path: string, depth = 0): unknown {
  if (depth > 32) throw new TypeError(`p0_fact_influence_graph_${path}_deep`);
  if (
    inputValue === null ||
    typeof inputValue === "string" ||
    typeof inputValue === "boolean"
  )
    return inputValue;
  if (typeof inputValue === "number") {
    if (!Number.isFinite(inputValue))
      throw new TypeError(`p0_fact_influence_graph_${path}_number_invalid`);
    return inputValue;
  }
  if (typeof inputValue !== "object" || nodeTypes.isProxy(inputValue))
    throw new TypeError(`p0_fact_influence_graph_${path}_json_invalid`);
  if (Array.isArray(inputValue)) {
    const values = arrayData(inputValue, path);
    return Object.freeze(
      values.map((item, index) =>
        validateJson(item, `${path}_${index}`, depth + 1),
      ),
    );
  }
  if (!isPlainRecord(inputValue))
    throw new TypeError(`p0_fact_influence_graph_${path}_object_invalid`);
  const output: JsonRecord = Object.create(null) as JsonRecord;
  const descriptors = Object.getOwnPropertyDescriptors(inputValue);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string")
      throw new TypeError(`p0_fact_influence_graph_${path}_key_invalid`);
    const descriptor = descriptors[key];
    if (
      descriptor === undefined ||
      descriptor.enumerable !== true ||
      !Object.hasOwn(descriptor, "value")
    )
      throw new TypeError(`p0_fact_influence_graph_${path}_descriptor_invalid`);
    output[key] = validateJson(
      descriptor.value,
      `${path}_${key.slice(0, 40)}`,
      depth + 1,
    );
  }
  return Object.freeze(output);
}

function stringArray(
  value: unknown,
  field: string,
  pattern: RegExp,
): readonly string[] {
  const parsed =
    typeof value === "string"
      ? (() => {
          try {
            return JSON.parse(value) as unknown;
          } catch {
            throw new TypeError(`p0_fact_influence_graph_${field}_invalid`);
          }
        })()
      : value;
  const items = arrayData(parsed, field);
  const output = items.map((item) => {
    if (typeof item !== "string" || item.length < 1 || !pattern.test(item))
      throw new TypeError(`p0_fact_influence_graph_${field}_invalid`);
    return item;
  });
  for (let index = 1; index < output.length; index += 1) {
    const previous = output[index - 1];
    const current = output[index];
    if (previous === undefined || current === undefined || previous >= current)
      throw new TypeError(`p0_fact_influence_graph_${field}_unsorted`);
  }
  return Object.freeze(output);
}

function row(rawRow: unknown): P0FactInfluenceGraphFact {
  const input = exactRecord(rawRow);
  const graphOrder = safeText(input.graph_order, "graph_order", 512);
  if (!GRAPH_ORDER_PATTERN.test(graphOrder))
    throw new TypeError("p0_fact_influence_graph_graph_order_invalid");
  const factId = input.fact_id;
  if (typeof factId !== "string" || !UUID_PATTERN.test(factId))
    throw new TypeError("p0_fact_influence_graph_fact_id_invalid");
  const implementationHash = input.implementation_hash;
  if (
    typeof implementationHash !== "string" ||
    !HASH_PATTERN.test(implementationHash)
  )
    throw new TypeError("p0_fact_influence_graph_hash_invalid");
  const implementationVersion = safeText(
    input.implementation_version,
    "implementation_version",
    128,
  );
  if (!VERSION_PATTERN.test(implementationVersion))
    throw new TypeError("p0_fact_influence_graph_version_invalid");
  if (
    typeof input.fact_version !== "number" ||
    !Number.isSafeInteger(input.fact_version) ||
    input.fact_version < 1
  )
    throw new TypeError("p0_fact_influence_graph_fact_version_invalid");
  const parentClaimId = safeText(input.parent_claim_id, "parent_claim_id", 256);
  if (!CLAIM_PATTERN.test(parentClaimId))
    throw new TypeError("p0_fact_influence_graph_parent_claim_id_invalid");
  const familyId = safeIdentifier(input.family_id, "family_id", 128);
  const sourceRoleId = safeIdentifier(
    input.source_role_id,
    "source_role_id",
    128,
  );
  const sourceIds = stringArray(
    input.source_ids,
    "source_ids",
    SOURCE_ID_PATTERN,
  );
  const sourceIdentity = validateJson(input.source_identity, "source_identity");
  if (
    !Array.isArray(sourceIdentity) ||
    sourceIdentity.length !== sourceIds.length
  )
    throw new TypeError("p0_fact_influence_graph_source_identity_invalid");
  const claimType = safeIdentifier(input.claim_type, "claim_type", 256);
  const subject = safeText(input.subject, "subject");
  const predicate = safeText(input.predicate, "predicate", 512);
  const value = validateJson(input.value, "value");
  const applicability = validateJson(input.applicability, "applicability");
  if (!isPlainRecord(applicability))
    throw new TypeError("p0_fact_influence_graph_applicability_invalid");
  const exclusions = validateJson(input.exclusions, "exclusions");
  if (!Array.isArray(exclusions))
    throw new TypeError("p0_fact_influence_graph_exclusions_invalid");
  const evidenceLocator = safeText(input.evidence_locator, "evidence_locator");
  const shortParaphrase = safeText(input.short_paraphrase, "short_paraphrase");
  if (
    input.disposition !== "catalogue_fact" &&
    input.disposition !== "engine_rule"
  )
    throw new TypeError("p0_fact_influence_graph_disposition_invalid");
  const derivedRuleIds = stringArray(
    input.derived_rule_ids,
    "derived_rule_ids",
    SAFE_IDENTIFIER_PATTERN,
  );
  const reason = safeIdentifier(input.reason, "reason", 128);
  if (!REASONS.has(reason))
    throw new TypeError("p0_fact_influence_graph_reason_invalid");
  const reasonDetail = safeText(input.reason_detail, "reason_detail");
  const factPayload = validateJson(input.fact_payload, "fact_payload");
  if (!isPlainRecord(factPayload))
    throw new TypeError("p0_fact_influence_graph_fact_payload_invalid");
  if (typeof input.active_at !== "boolean")
    throw new TypeError("p0_fact_influence_graph_active_at_invalid");
  if (typeof input.corrected !== "boolean")
    throw new TypeError("p0_fact_influence_graph_corrected_invalid");
  return Object.freeze({
    graph_order: graphOrder,
    fact_id: factId,
    implementation_version: implementationVersion,
    implementation_hash: implementationHash,
    fact_version: input.fact_version,
    parent_claim_id: parentClaimId,
    family_id: familyId,
    source_role_id: sourceRoleId,
    source_ids: sourceIds,
    source_identity: sourceIdentity,
    claim_type: claimType,
    subject,
    predicate,
    value,
    applicability,
    exclusions,
    evidence_locator: evidenceLocator,
    short_paraphrase: shortParaphrase,
    disposition: input.disposition,
    derived_rule_ids: derivedRuleIds,
    reason,
    reason_detail: reasonDetail,
    fact_payload: factPayload,
    active_at: input.active_at,
    corrected: input.corrected,
  });
}

function reportedTotal(rawRow: unknown): number {
  const input = exactRecord(rawRow);
  if (
    typeof input.total_count !== "number" ||
    !Number.isSafeInteger(input.total_count) ||
    input.total_count < 1
  )
    throw new TypeError("p0_fact_influence_graph_total_count_invalid");
  return input.total_count;
}

function rowsOf(result: QueryResult<unknown>): readonly unknown[] {
  if (!result || !Array.isArray(result.rows))
    throw new TypeError("p0_fact_influence_graph_query_result_invalid");
  return result.rows;
}

function effectiveAt(
  raw: string | undefined,
  clock: () => Date | string,
): string {
  const value = raw === undefined ? clock() : raw;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime()))
    throw new TypeError("p0_fact_influence_graph_effective_at_invalid");
  return date.toISOString();
}

/** Construct the server-only adapter. It reconciles the returned rows against
 * the SQL window total, while retaining a separate resource ceiling. */
export function createPostgresP0FactInfluenceGraphStore(
  target: QueryTarget,
  options: P0FactInfluenceGraphOptions = {},
): P0FactInfluenceGraphStore {
  if (options.clock !== undefined && options.now !== undefined)
    throw new TypeError("p0_fact_influence_graph_clock_ambiguous");
  const clock = options.clock ?? options.now ?? (() => new Date());
  return Object.freeze({
    async list(rawEffectiveAt?: string): Promise<P0FactInfluenceGraphSnapshot> {
      const timestamp = effectiveAt(rawEffectiveAt, clock);
      const result = await target.query(P0_FACT_INFLUENCE_GRAPH_QUERY, [
        timestamp,
        MAX_P0_FACT_INFLUENCE_GRAPH_FACTS + 1,
      ]);
      const rawRows = rowsOf(result);
      if (rawRows.length === 0)
        throw new Error("p0_fact_influence_graph_incomplete");
      const totals = new Set(rawRows.map(reportedTotal));
      if (totals.size !== 1)
        throw new Error("p0_fact_influence_graph_total_count_mismatch");
      const total = [...totals][0];
      if (total === undefined)
        throw new Error("p0_fact_influence_graph_incomplete");
      if (
        total > MAX_P0_FACT_INFLUENCE_GRAPH_FACTS ||
        rawRows.length > MAX_P0_FACT_INFLUENCE_GRAPH_FACTS
      )
        throw new Error("p0_fact_influence_graph_too_many_rows");
      if (rawRows.length !== total)
        throw new Error("p0_fact_influence_graph_incomplete");
      const facts = rawRows.map(row);
      facts.sort((left, right) =>
        left.graph_order < right.graph_order
          ? -1
          : left.graph_order > right.graph_order
            ? 1
            : 0,
      );
      const factIds = new Set<string>();
      const identities = new Set<string>();
      for (let index = 1; index < facts.length; index += 1) {
        const previous = facts[index - 1];
        const current = facts[index];
        if (previous?.graph_order === current?.graph_order)
          throw new Error("p0_fact_influence_graph_duplicate_order");
      }
      for (const fact of facts) {
        if (factIds.has(fact.fact_id))
          throw new Error("p0_fact_influence_graph_duplicate_fact");
        factIds.add(fact.fact_id);
        const identity = `${fact.implementation_hash}\u0000${fact.parent_claim_id}\u0000${fact.fact_version}`;
        if (identities.has(identity))
          throw new Error("p0_fact_influence_graph_duplicate_identity");
        identities.add(identity);
      }
      return Object.freeze({
        version: "p0-fact-influence-graph-source.v1",
        effective_at: timestamp,
        fact_count: facts.length,
        facts: Object.freeze(facts),
      });
    },
  });
}

export const createPostgresImplementationFactInfluenceGraphStore =
  createPostgresP0FactInfluenceGraphStore;
export const createPostgresP0ImplementationFactInfluenceGraphStore =
  createPostgresP0FactInfluenceGraphStore;
export const createPostgresP0FactInfluenceGraph =
  createPostgresP0FactInfluenceGraphStore;
