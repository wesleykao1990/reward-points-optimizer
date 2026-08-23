import { types as nodeTypes } from "node:util";
import type {
  PoolClient,
  QueryClient,
  QueryPool,
  QueryResult,
  QueryTarget,
} from "./adapter.js";

/** The correction-sensitive safe projection for generic implementation facts. */
export const P0_IMPLEMENTATION_FACTS_VIEW =
  "app_api.p0_active_implementation_facts" as const;

/** The parameterized current projection; the DB owns top-level window checks. */
export const P0_IMPLEMENTATION_FACT_ROWS_AT_FUNCTION =
  "app_private.p0_active_implementation_fact_provenance_rows_at" as const;

export const MAX_P0_IMPLEMENTATION_FACTS = 128 as const;

/**
 * The query has a fixed shape and uses one extra row to make bounded search
 * pagination explicit.  Search text is escaped by the adapter before it is
 * supplied to the parameterized LIKE expression.
 */
export const P0_IMPLEMENTATION_FACTS_QUERY = `
select fact_id, implementation_version, fact_version,
       family_id, source_role_id, source_ids, claim_type, subject, predicate,
       short_paraphrase, disposition, reason, reason_detail,
       source_url, checked_at, effective_from, effective_to
  from ${P0_IMPLEMENTATION_FACT_ROWS_AT_FUNCTION}($7::timestamptz)
 where ($1::text is null or
        lower(subject) like '%' || lower($1::text) || '%' escape '\\'
        or lower(predicate) like '%' || lower($1::text) || '%' escape '\\'
        or lower(short_paraphrase) like '%' || lower($1::text) || '%' escape '\\')
   and ($2::text is null or family_id = $2::text)
   and ($3::text is null or source_role_id = $3::text)
   and ($4::text is null or claim_type = $4::text)
   and ($5::uuid is null or fact_id > $5::uuid)
 order by fact_id asc
 limit $6::integer
`;

/** The DB-owned correction routine resolves the opaque fact key to full identity. */
export const P0_IMPLEMENTATION_FACT_CORRECTION_QUERY = `
select outcome, fact_id
  from app_private.record_p0_implementation_fact_correction_by_id(
    $1::uuid, $2::text, $3::text
  )
`;

export const IMPLEMENTATION_FACTS_QUERY = P0_IMPLEMENTATION_FACTS_QUERY;
export const IMPLEMENTATION_FACT_CORRECTION_QUERY =
  P0_IMPLEMENTATION_FACT_CORRECTION_QUERY;

export interface P0ImplementationFact {
  /** Opaque stable key that the host can use for an exact correction. */
  readonly fact_id: string;
  readonly implementation_version: string;
  readonly fact_version: number;
  readonly family_id: string;
  readonly source_role_id: string;
  readonly source_ids: readonly string[];
  readonly claim_type: string;
  readonly subject: string;
  readonly predicate: string;
  readonly short_paraphrase: string;
  readonly disposition: "catalogue_fact" | "engine_rule";
  readonly reason: string;
  readonly reason_detail: string;
  /** First-party URL selected from source_identity, or null if unavailable. */
  readonly source_url: string | null;
  /** Snapshot as_of timestamp, or null for legacy/injected rows. */
  readonly checked_at: string | null;
  /** Source-declared applicability bounds; may be date-only strings. */
  readonly effective_from: string | null;
  readonly effective_to: string | null;
}

export interface P0ImplementationFactSearchInput {
  readonly query?: string;
  readonly family_id?: string;
  readonly source_role_id?: string;
  readonly claim_type?: string;
  readonly limit?: number;
  readonly cursor?: string;
  /** Host-owned instant shared by every page of one catalogue snapshot. */
  readonly effective_at?: string;
}

export interface P0ImplementationFactSearchResult {
  readonly facts: readonly P0ImplementationFact[];
  readonly has_more: boolean;
  readonly next_cursor?: string;
}

/** Host-owned clock used to make the current catalogue deterministic. */
export interface P0ImplementationCatalogueOptions {
  readonly clock?: () => Date | string;
  /** Alias for callers that name the injected clock `now`. */
  readonly now?: () => Date | string;
}

export interface P0ImplementationFactCorrectionInput {
  readonly fact_id: string;
  readonly correction_id: string;
  readonly reason: string;
}

export interface P0ImplementationFactCorrectionResult {
  readonly ok: true;
  readonly outcome: "recorded" | "duplicate";
  readonly fact_id: string;
}

export interface P0ImplementationCatalogueStore {
  readonly list: (
    input?: P0ImplementationFactSearchInput,
  ) => Promise<readonly P0ImplementationFact[]>;
  readonly search: (
    input?: P0ImplementationFactSearchInput,
  ) => Promise<P0ImplementationFactSearchResult>;
  readonly reportCorrection: (
    input: P0ImplementationFactCorrectionInput,
  ) => Promise<P0ImplementationFactCorrectionResult>;
}

type JsonRecord = Record<string, unknown>;

const FACT_ROW_KEYS = Object.freeze([
  "fact_id",
  "implementation_version",
  "fact_version",
  "family_id",
  "source_role_id",
  "source_ids",
  "claim_type",
  "subject",
  "predicate",
  "short_paraphrase",
  "disposition",
  "reason",
  "reason_detail",
  "source_url",
  "checked_at",
  "effective_from",
  "effective_to",
] as const);

const LEGACY_FACT_ROW_KEYS = Object.freeze([
  "fact_id",
  "implementation_version",
  "fact_version",
  "family_id",
  "source_role_id",
  "source_ids",
  "claim_type",
  "subject",
  "predicate",
  "short_paraphrase",
  "disposition",
  "reason",
  "reason_detail",
] as const);

const SEARCH_KEYS = Object.freeze([
  "query",
  "family_id",
  "source_role_id",
  "claim_type",
  "limit",
  "cursor",
  "effective_at",
] as const);

const CORRECTION_KEYS = Object.freeze([
  "fact_id",
  "correction_id",
  "reason",
] as const);

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const IMPLEMENTATION_VERSION_PATTERN =
  /^p0-[a-z0-9][a-z0-9._-]{0,95}\.implementation\.v[0-9]+(?:\.[0-9]+)*$/u;
const CORRECTION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/u;
const SECRET_PATTERN =
  /(?:password|passwd|secret|api[ _-]?key|access[ _-]?token|bearer|private[ _-]?key|cvv|cvc|(?:^|[^a-z0-9])pan(?:[^a-z0-9]|$))/iu;
const PAYMENT_CARD_NUMBER_PATTERN =
  /(?:^|[^0-9])(?:\d[ -]?){13,19}(?:[^0-9]|$)/u;

function isPlainRecord(value: unknown): value is JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return false;
  if (nodeTypes.isProxy(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value: JsonRecord, expected: readonly string[]): boolean {
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.getOwnPropertySymbols(value).length > 0) return false;
  const actual = Object.keys(descriptors).sort();
  const wanted = [...expected].sort();
  return (
    actual.length === wanted.length &&
    actual.every((key, index) => key === wanted[index])
  );
}

function dataRecord(
  value: unknown,
  expected: readonly string[],
  error: string,
): JsonRecord {
  if (!isPlainRecord(value) || !exactKeys(value, expected))
    throw new TypeError(error);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const output: JsonRecord = Object.create(null) as JsonRecord;
  for (const key of expected) {
    const descriptor = descriptors[key];
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !Object.hasOwn(descriptor, "value")
    )
      throw new TypeError(error);
    output[key] = descriptor.value;
  }
  return output;
}

function optionalDataRecord(
  value: unknown,
  allowed: readonly string[],
  error: string,
): JsonRecord {
  if (!isPlainRecord(value)) throw new TypeError(error);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Object.getOwnPropertySymbols(value).length > 0 ||
    Object.keys(descriptors).some((key) => !allowed.includes(key))
  )
    throw new TypeError(error);
  const output: JsonRecord = Object.create(null) as JsonRecord;
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value"))
      throw new TypeError(error);
    output[key] = descriptor.value;
  }
  return output;
}

function safeText(value: unknown, field: string, max: number): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > max ||
    value.includes("\n") ||
    value.includes("\r") ||
    SECRET_PATTERN.test(value) ||
    PAYMENT_CARD_NUMBER_PATTERN.test(value) ||
    /https?:\/\//iu.test(value)
  )
    throw new TypeError(`p0_implementation_${field}_invalid`);
  return value;
}

function safeSourceUrl(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (
    typeof value !== "string" ||
    value.length > 2048 ||
    !/^https:\/\/[^\s]+$/u.test(value) ||
    value.includes("\n") ||
    value.includes("\r")
  )
    throw new TypeError("p0_implementation_source_url_invalid");
  return value;
}

function safeDate(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  // node-postgres decodes `timestamptz` columns as Date instances. Keep the
  // public adapter canonical while accepting that standard driver shape.
  if (value instanceof Date && !nodeTypes.isProxy(value)) {
    const timestamp = value.getTime();
    if (Number.isFinite(timestamp)) return value.toISOString();
    throw new TypeError(`p0_implementation_${field}_invalid`);
  }
  if (
    typeof value !== "string" ||
    value.length > 64 ||
    !/^\d{4}-\d{2}-\d{2}(?:$|T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})$)/u.test(
      value,
    ) ||
    !Number.isFinite(Date.parse(value))
  )
    throw new TypeError(`p0_implementation_${field}_invalid`);
  return value;
}

function identifier(value: unknown, field: string): string {
  if (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value))
    throw new TypeError(`p0_implementation_${field}_invalid`);
  return value;
}

function uuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value))
    throw new TypeError(`p0_implementation_${field}_invalid`);
  return value;
}

function stringArray(value: unknown): readonly string[] {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new TypeError("p0_implementation_source_ids_invalid");
    }
  }
  if (!Array.isArray(parsed) || parsed.length === 0)
    throw new TypeError("p0_implementation_source_ids_invalid");
  const output = parsed.map((item) => safeText(item, "source_id", 256));
  for (let index = 1; index < output.length; index += 1) {
    const previous = output[index - 1];
    const current = output[index];
    if (
      previous === undefined ||
      current === undefined ||
      previous.localeCompare(current) >= 0
    )
      throw new TypeError("p0_implementation_source_ids_invalid");
  }
  return Object.freeze(output);
}

function row(value: unknown): P0ImplementationFact {
  if (!isPlainRecord(value))
    throw new TypeError("p0_implementation_fact_row_shape_invalid");
  const input = exactKeys(value, FACT_ROW_KEYS)
    ? dataRecord(
        value,
        FACT_ROW_KEYS,
        "p0_implementation_fact_row_shape_invalid",
      )
    : exactKeys(value, LEGACY_FACT_ROW_KEYS)
      ? dataRecord(
          value,
          LEGACY_FACT_ROW_KEYS,
          "p0_implementation_fact_row_shape_invalid",
        )
      : (() => {
          throw new TypeError("p0_implementation_fact_row_shape_invalid");
        })();
  const factId = uuid(input.fact_id, "fact_id");
  const implementationVersion = identifier(
    input.implementation_version,
    "implementation_version",
  );
  if (!IMPLEMENTATION_VERSION_PATTERN.test(implementationVersion))
    throw new TypeError("p0_implementation_version_invalid");
  if (
    typeof input.fact_version !== "number" ||
    !Number.isSafeInteger(input.fact_version) ||
    input.fact_version < 1
  )
    throw new TypeError("p0_implementation_fact_version_invalid");
  const familyId = identifier(input.family_id, "family_id");
  const sourceRoleId = identifier(input.source_role_id, "source_role_id");
  const sourceIds = stringArray(input.source_ids);
  const claimType = identifier(input.claim_type, "claim_type");
  const subject = safeText(input.subject, "subject", 4096);
  const predicate = safeText(input.predicate, "predicate", 512);
  const shortParaphrase = safeText(
    input.short_paraphrase,
    "short_paraphrase",
    4096,
  );
  if (
    input.disposition !== "catalogue_fact" &&
    input.disposition !== "engine_rule"
  )
    throw new TypeError("p0_implementation_disposition_invalid");
  const reason = safeText(input.reason, "reason", 1024);
  const reasonDetail = safeText(input.reason_detail, "reason_detail", 4096);
  return Object.freeze({
    fact_id: factId,
    implementation_version: implementationVersion,
    fact_version: input.fact_version,
    family_id: familyId,
    source_role_id: sourceRoleId,
    source_ids: sourceIds,
    claim_type: claimType,
    subject,
    predicate,
    short_paraphrase: shortParaphrase,
    disposition: input.disposition,
    reason,
    reason_detail: reasonDetail,
    source_url: safeSourceUrl(input.source_url),
    checked_at: safeDate(input.checked_at, "checked_at"),
    effective_from: safeDate(input.effective_from, "effective_from"),
    effective_to: safeDate(input.effective_to, "effective_to"),
  });
}

function rowsOf(result: QueryResult<unknown>): readonly unknown[] {
  if (!result || !Array.isArray(result.rows))
    throw new TypeError("p0_implementation_query_result_invalid");
  return result.rows;
}

function escapeLike(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_");
}

function searchInput(
  value: unknown,
): Required<
  Pick<
    P0ImplementationFactSearchInput,
    | "query"
    | "family_id"
    | "source_role_id"
    | "claim_type"
    | "limit"
    | "cursor"
    | "effective_at"
  >
> {
  const input =
    value === undefined
      ? Object.create(null)
      : optionalDataRecord(
          value,
          SEARCH_KEYS,
          "p0_implementation_search_input_shape_invalid",
        );
  const query =
    input.query === undefined ? "" : safeText(input.query, "query", 256);
  const familyId =
    input.family_id === undefined
      ? ""
      : identifier(input.family_id, "family_id");
  const sourceRoleId =
    input.source_role_id === undefined
      ? ""
      : identifier(input.source_role_id, "source_role_id");
  const claimType =
    input.claim_type === undefined
      ? ""
      : identifier(input.claim_type, "claim_type");
  const limit =
    input.limit === undefined ? MAX_P0_IMPLEMENTATION_FACTS : input.limit;
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > MAX_P0_IMPLEMENTATION_FACTS
  )
    throw new RangeError("p0_implementation_limit_out_of_bounds");
  const cursor = input.cursor === undefined ? "" : uuid(input.cursor, "cursor");
  let effectiveAt = "";
  if (input.effective_at !== undefined) {
    if (
      typeof input.effective_at !== "string" ||
      input.effective_at.length > 32 ||
      !Number.isFinite(Date.parse(input.effective_at)) ||
      new Date(input.effective_at).toISOString() !== input.effective_at
    )
      throw new TypeError("p0_implementation_effective_at_invalid");
    effectiveAt = input.effective_at;
  }
  return {
    query,
    family_id: familyId,
    source_role_id: sourceRoleId,
    claim_type: claimType,
    limit,
    cursor,
    effective_at: effectiveAt,
  };
}

function correctionInput(value: unknown): P0ImplementationFactCorrectionInput {
  const input = dataRecord(
    value,
    CORRECTION_KEYS,
    "p0_implementation_correction_input_shape_invalid",
  );
  return {
    fact_id: uuid(input.fact_id, "fact_id"),
    correction_id:
      typeof input.correction_id === "string" &&
      CORRECTION_ID_PATTERN.test(input.correction_id)
        ? input.correction_id
        : (() => {
            throw new TypeError("p0_implementation_correction_id_invalid");
          })(),
    reason: safeText(input.reason, "correction_reason", 1024),
  };
}

function correctionResult(value: unknown): {
  readonly outcome: "recorded" | "duplicate";
  readonly fact_id: string;
} {
  const input = dataRecord(
    value,
    ["outcome", "fact_id"],
    "p0_implementation_correction_result_shape_invalid",
  );
  if (input.outcome !== "recorded" && input.outcome !== "duplicate")
    throw new TypeError("p0_implementation_correction_outcome_invalid");
  const factId = uuid(input.fact_id, "fact_id");
  return Object.freeze({ outcome: input.outcome, fact_id: factId });
}

function isQueryPool(target: QueryTarget): target is QueryPool {
  return "connect" in target && typeof target.connect === "function";
}

function asError(value: unknown): Error {
  return value instanceof Error
    ? value
    : new Error("p0_implementation_query_failed");
}

/**
 * Construct a driver-neutral implementation-fact catalogue store.  The
 * database owns exact identity/correction checks; this adapter owns bounded
 * input validation, parameter binding, deterministic result reduction, and a
 * safe projection that never returns hashes, URLs, evidence locators, or raw
 * fact values.
 */
export function createPostgresP0ImplementationCatalogueStore(
  target: QueryTarget,
  options: P0ImplementationCatalogueOptions = {},
): P0ImplementationCatalogueStore {
  if (options.clock !== undefined && options.now !== undefined)
    throw new TypeError("p0_implementation_clock_ambiguous");
  const clock = options.clock ?? options.now ?? (() => new Date());

  const search = async (
    rawInput: P0ImplementationFactSearchInput = {},
  ): Promise<P0ImplementationFactSearchResult> => {
    const input = searchInput(rawInput);
    let effectiveAt: Date;
    if (input.effective_at !== "") {
      effectiveAt = new Date(input.effective_at);
    } else {
      const clockValue = clock();
      effectiveAt =
        clockValue instanceof Date ? clockValue : new Date(clockValue);
      if (!Number.isFinite(effectiveAt.getTime()))
        throw new TypeError("p0_implementation_clock_invalid");
    }
    const result = await target.query(P0_IMPLEMENTATION_FACTS_QUERY, [
      input.query === "" ? null : escapeLike(input.query),
      input.family_id === "" ? null : input.family_id,
      input.source_role_id === "" ? null : input.source_role_id,
      input.claim_type === "" ? null : input.claim_type,
      input.cursor === "" ? null : input.cursor,
      input.limit + 1,
      effectiveAt.toISOString(),
    ]);
    const rawRows = rowsOf(result);
    if (rawRows.length > input.limit + 1)
      throw new Error("p0_implementation_too_many_rows");
    const parsed = rawRows.map(row);
    parsed.sort((left, right) => left.fact_id.localeCompare(right.fact_id));
    for (let index = 1; index < parsed.length; index += 1) {
      if (parsed[index - 1]?.fact_id === parsed[index]?.fact_id)
        throw new Error("p0_implementation_duplicate_fact");
    }
    const hasMore = parsed.length > input.limit;
    const facts = hasMore ? parsed.slice(0, input.limit) : parsed;
    const frozenFacts = Object.freeze(facts);
    if (!hasMore) return Object.freeze({ facts: frozenFacts, has_more: false });
    const nextCursor = facts.at(-1)?.fact_id;
    if (nextCursor === undefined)
      throw new Error("p0_implementation_missing_next_cursor");
    return Object.freeze({
      facts: frozenFacts,
      has_more: true,
      next_cursor: nextCursor,
    });
  };

  const list = async (
    rawInput: P0ImplementationFactSearchInput = {},
  ): Promise<readonly P0ImplementationFact[]> => {
    const result = await search(rawInput);
    if (result.has_more) throw new Error("p0_implementation_too_many_rows");
    return result.facts;
  };

  const reportCorrection = async (
    rawInput: P0ImplementationFactCorrectionInput,
  ): Promise<P0ImplementationFactCorrectionResult> => {
    const input = correctionInput(rawInput);
    let client: QueryClient | PoolClient = target;
    let release: ((error?: Error) => void) | undefined;
    let began = false;
    let committed = false;
    let failed = false;
    let originalError: unknown;
    try {
      if (isQueryPool(target)) {
        const checkedOut = await target.connect();
        client = checkedOut;
        release = checkedOut.release;
      }
      began = true;
      await client.query("BEGIN");
      const result = await client.query(
        P0_IMPLEMENTATION_FACT_CORRECTION_QUERY,
        [input.fact_id, input.correction_id, input.reason],
      );
      const rows = rowsOf(result);
      if (rows.length !== 1 || rows[0] === undefined)
        throw new Error("p0_implementation_correction_empty_result");
      const correction = correctionResult(rows[0]);
      if (correction.fact_id !== input.fact_id)
        throw new TypeError("p0_implementation_correction_fact_mismatch");
      await client.query("COMMIT");
      committed = true;
      return Object.freeze({
        ok: true as const,
        outcome: correction.outcome,
        fact_id: input.fact_id,
      });
    } catch (error) {
      failed = true;
      originalError = error;
      if (began && !committed) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // Preserve the original query/transaction error.
        }
      }
      throw error;
    } finally {
      if (release !== undefined) {
        try {
          if (failed) release(asError(originalError));
          else release();
        } catch {
          // Preserve the original transaction/query error.
        }
      }
    }
  };

  return Object.freeze({ list, search, reportCorrection });
}

export const createPostgresImplementationCatalogueStore =
  createPostgresP0ImplementationCatalogueStore;
export const createPostgresP0ImplementationFactStore =
  createPostgresP0ImplementationCatalogueStore;
