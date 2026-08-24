import { types as nodeTypes } from "node:util";
import {
  isCanonicalProvisionalDateTime,
  scanPublicValue,
} from "@jro/provisional-rules";
import type { QueryResult, QueryTarget } from "./adapter.js";

/** The bounded private projection consumed by the trusted recommendation host. */
export const AGENT_FEED_TYPED_RULE_RECORDS_FUNCTION =
  "app_private.agent_feed_typed_rule_records_at" as const;
export const AGENT_FEED_ACTIVE_RULE_FAMILIES_FUNCTION =
  "app_private.agent_feed_active_rule_families_at" as const;
export const AGENT_FEED_ACTIVE_MERCHANT_PAYMENT_ACCEPTANCE_FUNCTION =
  "app_private.agent_feed_active_merchant_payment_acceptance_at" as const;

/** Descriptive aliases make the database boundary discoverable to callers. */
export const TYPED_RULE_RECORDS_FUNCTION =
  AGENT_FEED_TYPED_RULE_RECORDS_FUNCTION;
export const ACTIVE_RULE_FAMILIES_FUNCTION =
  AGENT_FEED_ACTIVE_RULE_FAMILIES_FUNCTION;
export const ACTIVE_MERCHANT_PAYMENT_ACCEPTANCE_FUNCTION =
  AGENT_FEED_ACTIVE_MERCHANT_PAYMENT_ACCEPTANCE_FUNCTION;

export const MAX_AGENT_FEED_TYPED_RULE_RECORDS = 4096 as const;
export const MAX_AGENT_FEED_ACTIVE_RULE_FAMILIES = 4096 as const;
export const MAX_AGENT_FEED_MERCHANT_PAYMENT_ACCEPTANCE = 4096 as const;

const TYPED_RULE_RECORD_LIMIT = MAX_AGENT_FEED_TYPED_RULE_RECORDS + 1;
const ACTIVE_RULE_FAMILY_LIMIT = MAX_AGENT_FEED_ACTIVE_RULE_FAMILIES + 1;
const MERCHANT_PAYMENT_ACCEPTANCE_LIMIT =
  MAX_AGENT_FEED_MERCHANT_PAYMENT_ACCEPTANCE + 1;

export const AGENT_FEED_TYPED_RULE_RECORDS_QUERY = `
select record_id, rule_id, rule_version, source_kind, source_id,
       source_identity, family_id, source_role_id, rule_class, calculable,
       merchant_id, payment_family, subjects, raw_attributes, applicability,
       payload_hash, observed_at
  from ${AGENT_FEED_TYPED_RULE_RECORDS_FUNCTION}($1::timestamptz)
 order by family_id asc, rule_id asc, rule_version asc
 limit ${TYPED_RULE_RECORD_LIMIT}
`;

export const TYPED_RULE_RECORDS_QUERY = AGENT_FEED_TYPED_RULE_RECORDS_QUERY;

export const AGENT_FEED_ACTIVE_RULE_FAMILIES_QUERY = `
select family_id, rule_count, calculable_rule_count, acceptance_count
  from ${AGENT_FEED_ACTIVE_RULE_FAMILIES_FUNCTION}($1::timestamptz)
 order by family_id asc
 limit ${ACTIVE_RULE_FAMILY_LIMIT}
`;

export const ACTIVE_RULE_FAMILIES_QUERY = AGENT_FEED_ACTIVE_RULE_FAMILIES_QUERY;

export const AGENT_FEED_ACTIVE_MERCHANT_PAYMENT_ACCEPTANCE_QUERY = `
select merchant_id, payment_family, accepted, rule_id, rule_version,
       source_kind, source_id, observed_at
  from ${AGENT_FEED_ACTIVE_MERCHANT_PAYMENT_ACCEPTANCE_FUNCTION}($1::timestamptz)
 order by merchant_id asc, payment_family asc
 limit ${MERCHANT_PAYMENT_ACCEPTANCE_LIMIT}
`;

export const ACTIVE_MERCHANT_PAYMENT_ACCEPTANCE_QUERY =
  AGENT_FEED_ACTIVE_MERCHANT_PAYMENT_ACCEPTANCE_QUERY;

export type TypedRuleClass =
  | "arithmetic_reward"
  | "eligibility_constraint"
  | "cap_minimum_rounding"
  | "campaign_modifier"
  | "transfer_conversion"
  | "lifecycle"
  | "inactive_history"
  | "informational"
  | "missing_parameters";

export type TypedRuleSourceKind = "source_observation" | "implementation_fact";

export interface TypedRuleSubject {
  readonly type: string;
  readonly id: string | null;
  readonly name: string | null;
}

export interface AgentFeedTypedRuleRecord {
  readonly record_id: string;
  readonly rule_id: string;
  readonly rule_version: number;
  readonly source_kind: TypedRuleSourceKind;
  readonly source_id: string;
  readonly source_identity: Readonly<Record<string, unknown>>;
  readonly family_id: string;
  readonly source_role_id: string;
  readonly rule_class: TypedRuleClass;
  readonly calculable: boolean;
  readonly merchant_id: string | null;
  readonly payment_family: string | null;
  readonly subjects: readonly TypedRuleSubject[];
  /** Explicit producer attributes; no arithmetic is inferred by this adapter. */
  readonly raw_attributes: Readonly<Record<string, unknown>>;
  readonly applicability: Readonly<Record<string, unknown>>;
  readonly payload_hash: string;
  readonly observed_at: string;
}

export interface AgentFeedActiveRuleFamily {
  readonly family_id: string;
  readonly rule_count: number;
  readonly calculable_rule_count: number;
  readonly acceptance_count: number;
}

export interface AgentFeedMerchantPaymentAcceptance {
  readonly merchant_id: string;
  readonly payment_family: string;
  readonly accepted: boolean;
  readonly rule_id: string;
  readonly rule_version: number;
  readonly source_kind: TypedRuleSourceKind;
  readonly source_id: string;
  readonly observed_at: string;
}

export interface AgentFeedTypedRuleRecordStore {
  readonly list: (
    effectiveAt: string,
  ) => Promise<readonly AgentFeedTypedRuleRecord[]>;
  readonly listFamilies: (
    effectiveAt: string,
  ) => Promise<readonly AgentFeedActiveRuleFamily[]>;
  readonly listMerchantPaymentAcceptance: (
    effectiveAt: string,
  ) => Promise<readonly AgentFeedMerchantPaymentAcceptance[]>;
  /** Short aliases for hosts that model the projections as separate lists. */
  readonly families: (
    effectiveAt: string,
  ) => Promise<readonly AgentFeedActiveRuleFamily[]>;
  readonly acceptance: (
    effectiveAt: string,
  ) => Promise<readonly AgentFeedMerchantPaymentAcceptance[]>;
}

type JsonRecord = Record<string, unknown>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const RULE_ID_PATTERN = /^atr_[0-9a-f]{64}$/u;
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/u;

const TYPED_RULE_ROW_KEYS = Object.freeze([
  "record_id",
  "rule_id",
  "rule_version",
  "source_kind",
  "source_id",
  "source_identity",
  "family_id",
  "source_role_id",
  "rule_class",
  "calculable",
  "merchant_id",
  "payment_family",
  "subjects",
  "raw_attributes",
  "applicability",
  "payload_hash",
  "observed_at",
] as const);

const FAMILY_ROW_KEYS = Object.freeze([
  "family_id",
  "rule_count",
  "calculable_rule_count",
  "acceptance_count",
] as const);

const ACCEPTANCE_ROW_KEYS = Object.freeze([
  "merchant_id",
  "payment_family",
  "accepted",
  "rule_id",
  "rule_version",
  "source_kind",
  "source_id",
  "observed_at",
] as const);

function isPlainRecord(value: unknown): value is JsonRecord {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    nodeTypes.isProxy(value)
  )
    return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value: JsonRecord, expected: readonly string[]): boolean {
  if (Object.getOwnPropertySymbols(value).length > 0) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actual = Object.keys(descriptors).sort();
  const wanted = [...expected].sort();
  return (
    actual.length === wanted.length &&
    actual.every(
      (key, index) =>
        key === wanted[index] &&
        descriptors[key]?.enumerable === true &&
        "value" in (descriptors[key] ?? {}),
    )
  );
}

function parseJson(value: unknown, field: string): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new TypeError(`agent_feed_typed_rule_${field}_invalid`);
  }
}

function scannedRecord(value: unknown, field: string): JsonRecord {
  const parsed = parseJson(value, field);
  const scan = scanPublicValue(parsed);
  if (!scan.valid || !isPlainRecord(scan.value))
    throw new TypeError(`agent_feed_typed_rule_${field}_invalid`);
  return scan.value;
}

function stringValue(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 4096)
    throw new TypeError(`agent_feed_typed_rule_${field}_invalid`);
  return value;
}

function identifier(value: unknown, field: string): string {
  const text = stringValue(value, field);
  if (!IDENTIFIER_PATTERN.test(text))
    throw new TypeError(`agent_feed_typed_rule_${field}_invalid`);
  return text;
}

function uuid(value: unknown, field: string): string {
  const text = stringValue(value, field);
  if (!UUID_PATTERN.test(text))
    throw new TypeError(`agent_feed_typed_rule_${field}_invalid`);
  return text;
}

function hash(value: unknown, field: string): string {
  const text = stringValue(value, field);
  if (!HASH_PATTERN.test(text))
    throw new TypeError(`agent_feed_typed_rule_${field}_invalid`);
  return text;
}

function ruleId(value: unknown, field: string): string {
  const text = stringValue(value, field);
  if (!RULE_ID_PATTERN.test(text))
    throw new TypeError(`agent_feed_typed_rule_${field}_invalid`);
  return text;
}

function positiveInteger(value: unknown, field: string): number {
  const number =
    typeof value === "string" && /^[0-9]+$/u.test(value)
      ? Number(value)
      : value;
  if (typeof number !== "number" || !Number.isSafeInteger(number) || number < 1)
    throw new TypeError(`agent_feed_typed_rule_${field}_invalid`);
  return number;
}

function nonNegativeInteger(value: unknown, field: string): number {
  const number =
    typeof value === "string" && /^[0-9]+$/u.test(value)
      ? Number(value)
      : value;
  if (typeof number !== "number" || !Number.isSafeInteger(number) || number < 0)
    throw new TypeError(`agent_feed_typed_rule_${field}_invalid`);
  return number;
}

function timestamp(value: unknown, field: string): string {
  const date =
    value instanceof Date ? value : new Date(stringValue(value, field));
  if (!Number.isFinite(date.getTime()))
    throw new TypeError(`agent_feed_typed_rule_${field}_invalid`);
  return date.toISOString();
}

function nullableIdentifier(value: unknown, field: string): string | null {
  if (value === null) return null;
  return identifier(value, field);
}

function ruleClass(value: unknown): TypedRuleClass {
  if (
    value !== "arithmetic_reward" &&
    value !== "eligibility_constraint" &&
    value !== "cap_minimum_rounding" &&
    value !== "campaign_modifier" &&
    value !== "transfer_conversion" &&
    value !== "lifecycle" &&
    value !== "inactive_history" &&
    value !== "informational" &&
    value !== "missing_parameters"
  )
    throw new TypeError("agent_feed_typed_rule_rule_class_invalid");
  return value;
}

function sourceKind(value: unknown): TypedRuleSourceKind {
  if (value !== "source_observation" && value !== "implementation_fact")
    throw new TypeError("agent_feed_typed_rule_source_kind_invalid");
  return value;
}

function subject(value: unknown): TypedRuleSubject {
  if (!isPlainRecord(value) || !exactKeys(value, ["type", "id", "name"]))
    throw new TypeError("agent_feed_typed_rule_subject_invalid");
  const type = stringValue(value.type, "subject_type");
  const id = value.id === null ? null : stringValue(value.id, "subject_id");
  const name =
    value.name === null ? null : stringValue(value.name, "subject_name");
  return Object.freeze({ type, id, name });
}

function subjects(value: unknown): readonly TypedRuleSubject[] {
  const parsed = parseJson(value, "subjects");
  if (!Array.isArray(parsed) || parsed.length === 0)
    throw new TypeError("agent_feed_typed_rule_subjects_invalid");
  return Object.freeze(parsed.map((item) => subject(item)));
}

function reduceTypedRuleRow(value: unknown): AgentFeedTypedRuleRecord {
  if (!isPlainRecord(value) || !exactKeys(value, TYPED_RULE_ROW_KEYS))
    throw new TypeError("agent_feed_typed_rule_row_shape_invalid");
  const sourceIdentity = scannedRecord(
    value.source_identity,
    "source_identity",
  );
  const rawAttributes = scannedRecord(value.raw_attributes, "raw_attributes");
  const applicability = scannedRecord(value.applicability, "applicability");
  return Object.freeze({
    record_id: uuid(value.record_id, "record_id"),
    rule_id: ruleId(value.rule_id, "rule_id"),
    rule_version: positiveInteger(value.rule_version, "rule_version"),
    source_kind: sourceKind(value.source_kind),
    source_id: uuid(value.source_id, "source_id"),
    source_identity: Object.freeze(sourceIdentity),
    family_id: identifier(value.family_id, "family_id"),
    source_role_id: identifier(value.source_role_id, "source_role_id"),
    rule_class: ruleClass(value.rule_class),
    calculable: (() => {
      if (typeof value.calculable !== "boolean")
        throw new TypeError("agent_feed_typed_rule_calculable_invalid");
      return value.calculable;
    })(),
    merchant_id: nullableIdentifier(value.merchant_id, "merchant_id"),
    payment_family: nullableIdentifier(value.payment_family, "payment_family"),
    subjects: subjects(value.subjects),
    raw_attributes: Object.freeze(rawAttributes),
    applicability: Object.freeze(applicability),
    payload_hash: hash(value.payload_hash, "payload_hash"),
    observed_at: timestamp(value.observed_at, "observed_at"),
  });
}

function reduceFamilyRow(value: unknown): AgentFeedActiveRuleFamily {
  if (!isPlainRecord(value) || !exactKeys(value, FAMILY_ROW_KEYS))
    throw new TypeError("agent_feed_typed_rule_family_row_shape_invalid");
  return Object.freeze({
    family_id: identifier(value.family_id, "family_id"),
    rule_count: nonNegativeInteger(value.rule_count, "rule_count"),
    calculable_rule_count: nonNegativeInteger(
      value.calculable_rule_count,
      "calculable_rule_count",
    ),
    acceptance_count: nonNegativeInteger(
      value.acceptance_count,
      "acceptance_count",
    ),
  });
}

function reduceAcceptanceRow(
  value: unknown,
): AgentFeedMerchantPaymentAcceptance {
  if (!isPlainRecord(value) || !exactKeys(value, ACCEPTANCE_ROW_KEYS))
    throw new TypeError("agent_feed_typed_rule_acceptance_row_shape_invalid");
  if (typeof value.accepted !== "boolean")
    throw new TypeError("agent_feed_typed_rule_acceptance_invalid");
  return Object.freeze({
    merchant_id: identifier(value.merchant_id, "merchant_id"),
    payment_family: identifier(value.payment_family, "payment_family"),
    accepted: value.accepted,
    rule_id: ruleId(value.rule_id, "rule_id"),
    rule_version: positiveInteger(value.rule_version, "rule_version"),
    source_kind: sourceKind(value.source_kind),
    source_id: uuid(value.source_id, "source_id"),
    observed_at: timestamp(value.observed_at, "observed_at"),
  });
}

function validEffectiveAt(value: string): string {
  if (!isCanonicalProvisionalDateTime(value))
    throw new TypeError("agent_feed_typed_rule_effective_at_invalid");
  return value;
}

export function createPostgresAgentFeedTypedRuleRecordStore(
  target: QueryTarget,
): AgentFeedTypedRuleRecordStore {
  const list = async (
    effectiveAt: string,
  ): Promise<readonly AgentFeedTypedRuleRecord[]> => {
    const instant = validEffectiveAt(effectiveAt);
    const result: QueryResult<unknown> = await target.query(
      AGENT_FEED_TYPED_RULE_RECORDS_QUERY,
      [instant],
    );
    if (!result || !Array.isArray(result.rows))
      throw new TypeError("agent_feed_typed_rule_result_invalid");
    if (result.rows.length > MAX_AGENT_FEED_TYPED_RULE_RECORDS)
      throw new Error("agent_feed_typed_rule_too_many_rows");
    return Object.freeze(result.rows.map((row) => reduceTypedRuleRow(row)));
  };

  const listFamilies = async (
    effectiveAt: string,
  ): Promise<readonly AgentFeedActiveRuleFamily[]> => {
    const instant = validEffectiveAt(effectiveAt);
    const result: QueryResult<unknown> = await target.query(
      AGENT_FEED_ACTIVE_RULE_FAMILIES_QUERY,
      [instant],
    );
    if (!result || !Array.isArray(result.rows))
      throw new TypeError("agent_feed_typed_rule_family_result_invalid");
    if (result.rows.length > MAX_AGENT_FEED_ACTIVE_RULE_FAMILIES)
      throw new Error("agent_feed_typed_rule_family_too_many_rows");
    return Object.freeze(result.rows.map((row) => reduceFamilyRow(row)));
  };

  const listMerchantPaymentAcceptance = async (
    effectiveAt: string,
  ): Promise<readonly AgentFeedMerchantPaymentAcceptance[]> => {
    const instant = validEffectiveAt(effectiveAt);
    const result: QueryResult<unknown> = await target.query(
      AGENT_FEED_ACTIVE_MERCHANT_PAYMENT_ACCEPTANCE_QUERY,
      [instant],
    );
    if (!result || !Array.isArray(result.rows))
      throw new TypeError("agent_feed_typed_rule_acceptance_result_invalid");
    if (result.rows.length > MAX_AGENT_FEED_MERCHANT_PAYMENT_ACCEPTANCE)
      throw new Error("agent_feed_typed_rule_acceptance_too_many_rows");
    return Object.freeze(result.rows.map((row) => reduceAcceptanceRow(row)));
  };

  return Object.freeze({
    list,
    listFamilies,
    listMerchantPaymentAcceptance,
    families: listFamilies,
    acceptance: listMerchantPaymentAcceptance,
  });
}

export const createPostgresTypedRuleRecordStore =
  createPostgresAgentFeedTypedRuleRecordStore;
export const createPostgresAgentFeedTypedRuleStore =
  createPostgresAgentFeedTypedRuleRecordStore;

/** Test-facing strict reducers for one row from each private projection. */
export function reduceAgentFeedTypedRuleRecord(
  row: unknown,
): AgentFeedTypedRuleRecord {
  return reduceTypedRuleRow(row);
}

export function reduceAgentFeedActiveRuleFamily(
  row: unknown,
): AgentFeedActiveRuleFamily {
  return reduceFamilyRow(row);
}

export function reduceAgentFeedMerchantPaymentAcceptance(
  row: unknown,
): AgentFeedMerchantPaymentAcceptance {
  return reduceAcceptanceRow(row);
}
