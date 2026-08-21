import {
  CORRECTION_CATEGORIES,
  type CorrectionCategory,
  hashCandidate,
  hashCanonical,
  hashDefinition,
  type ProvisionalRuleCandidate,
  type Sha256,
} from "@jro/provisional-rules";
import type {
  PoolClient,
  QueryClient,
  QueryPool,
  QueryResult,
  QueryTarget,
} from "./adapter.js";

/** The only P0 view which this adapter is allowed to read. */
export const P0_EXPERIMENTAL_CATALOGUE_VIEW =
  "app_api.p0_unverified_experimental_catalogue" as const;

/**
 * The DB view is filtered to the P0 Nanaco canary.  These values are repeated
 * here as an adapter invariant: a privileged DB role is still an untrusted
 * boundary from the application's point of view.
 */
export const NANACO_P0_FAMILY_ID = "point.nanaco" as const;
export const NANACO_P0_SOURCE_ROLE_ID = "earn_rules" as const;
export const NANACO_P0_SOURCE_ID = "jp.nanaco.shopping-earning" as const;
export const NANACO_P0_RULE_ID =
  "rr_jp_cvs_006_nanaco_purchase_reward" as const;
export const NANACO_P0_RULE_VERSION = 1 as const;
export const NANACO_P0_DEFINITION_HASH =
  "sha256:9f8cb5de0af689ee8ca751a3ae6a34c2d974eb1c79c29c60bd555da4db116746" as const;

/** Canonical hash of the exact rule projection used by the P0 canary. */
const NANACO_P0_RULE_HASH =
  "sha256:1849f83d2c036718b082119098223adbec2ea70308d063916c942fefc912b5ee" as const;

export const SEVEN_ELEVEN_PAYMENT_FAMILY_LABELS = Object.freeze({
  barcode_payment: "バーコード決済",
  brand_debit_card: "ブランドデビット",
  brand_prepaid_card: "ブランドプリペイド",
  credit_card: "クレジットカード",
  gift_certificate: "共通商品券",
  id: "iD",
  nanaco: "nanaco",
  quo_card: "QUOカード",
  quicpay: "QUICPay",
  rakuten_edy: "楽天Edy",
  transport_e_money: "交通系電子マネー",
} as const);

export type SevenElevenPaymentFamily =
  keyof typeof SEVEN_ELEVEN_PAYMENT_FAMILY_LABELS;

type PaymentFamilyConfig = Readonly<{
  readonly publication_id: string;
  readonly instrument_id: string;
  readonly reason_code: string;
  readonly definition_hash: Sha256;
  readonly rule_hash: Sha256;
  readonly candidate_hash: Sha256;
}>;

const PAYMENT_FAMILY_CONFIG: Readonly<
  Record<SevenElevenPaymentFamily, PaymentFamilyConfig>
> = Object.freeze({
  barcode_payment: {
    publication_id: "candidate_p0_seveneleven_barcode_payment_20260821_v0_1",
    instrument_id: "instrument.seveneleven.barcode_payment",
    reason_code: "accepted_payment_family_barcode_payment",
    definition_hash:
      "sha256:bf32efc04118a313c98a231d4ad0b530e6a50b204c71cebcb383c16bad35d4f2",
    rule_hash:
      "sha256:7a2ba7fd01b3c436e2e6adf46e1c5dfe2025fa5f77f1a33885e0fc118531080f",
    candidate_hash:
      "sha256:1741be627b37546bc6b8a8c94bc81bc617047a3eb495bea771ca3eea56ca38ce",
  },
  brand_debit_card: {
    publication_id: "candidate_p0_seveneleven_brand_debit_card_20260821_v0_1",
    instrument_id: "instrument.seveneleven.brand_debit_card",
    reason_code: "accepted_payment_family_brand_debit_card",
    definition_hash:
      "sha256:d085dd3836884177876e47e96bbcaa12b5354c0938204eb252df3b6765cb3f8c",
    rule_hash:
      "sha256:7636093bba88773e66615417d48337217252d6168af2c941b191cd907a3fa055",
    candidate_hash:
      "sha256:535ed6bca513dce9134370aeb556bb79378ea0fa6b2fcc4f9ae3ddef43fb56a6",
  },
  brand_prepaid_card: {
    publication_id: "candidate_p0_seveneleven_brand_prepaid_card_20260821_v0_1",
    instrument_id: "instrument.seveneleven.brand_prepaid_card",
    reason_code: "accepted_payment_family_brand_prepaid_card",
    definition_hash:
      "sha256:ae31cf16098f13d4043ace1f2e5e1116ca0799bb4fb47ec5b96e5890580b2ff1",
    rule_hash:
      "sha256:0401ca8ada677086ccead2533addd9c12d2ef9753994910dcb40d12845a11952",
    candidate_hash:
      "sha256:893b83f9dffb22f480aee5fb6d9035367c71990bb3a948121b9015b9217bbc77",
  },
  credit_card: {
    publication_id: "candidate_p0_seveneleven_credit_card_20260821_v0_1",
    instrument_id: "instrument.seveneleven.credit_card",
    reason_code: "accepted_payment_family_credit_card",
    definition_hash:
      "sha256:43d575f9eeecf2b99479116449225fa4f032fcd0cb92d92a90780cd0c14047b1",
    rule_hash:
      "sha256:8107cb721214840b564f22d5b743734b3ee80ef8c21bdc4f3d897fe930484d7f",
    candidate_hash:
      "sha256:dde9a8a11bda1400d834778bd172ece656fb1cdb5567e7f8b241304031f7c5ed",
  },
  gift_certificate: {
    publication_id: "candidate_p0_seveneleven_gift_certificate_20260821_v0_1",
    instrument_id: "instrument.seveneleven.gift_certificate",
    reason_code: "accepted_payment_family_gift_certificate",
    definition_hash:
      "sha256:a6122d7baa408de6d382cc25b823a6afd9642adf58dd8005653a166f812c32d1",
    rule_hash:
      "sha256:7a1f3bb0b81d71ca15e1824e3934697ffb1ec473189059907f76507ead52b358",
    candidate_hash:
      "sha256:970cdee595e796a6e3973151b47b15fb61b633052deb4c93610b1c95b3281232",
  },
  id: {
    publication_id: "candidate_p0_seveneleven_id_20260821_v0_1",
    instrument_id: "instrument.seveneleven.id",
    reason_code: "accepted_payment_family_id",
    definition_hash:
      "sha256:3926ae571376581d27406fc2defa4b057a06fea780ca8f0344037a390c44a2ca",
    rule_hash:
      "sha256:ba4d38a9a290b7781256318dd31e625af94e4be1901b08122613c2682c8e71b5",
    candidate_hash:
      "sha256:6b1e9f81e65f538526ed5f6028c2e267fa6421725ad8a951c7fafc1498a2f018",
  },
  nanaco: {
    publication_id: "candidate_p0_seveneleven_nanaco_20260821_v0_1",
    instrument_id: "instrument.seveneleven.nanaco",
    reason_code: "accepted_payment_family_nanaco",
    definition_hash:
      "sha256:90fc4b80507d127d5d64a871154dc989c002bef0927dc80c719889e24387ae17",
    rule_hash:
      "sha256:7d51d414123dd4811038df00582729e1695970e0738f5a535559cad2ad79a1b9",
    candidate_hash:
      "sha256:27ea0ed660ab3ae23b04cc781d804cdce7de0cfda61a98ced8ff891326cb9114",
  },
  quo_card: {
    publication_id: "candidate_p0_seveneleven_quo_card_20260821_v0_1",
    instrument_id: "instrument.seveneleven.quo_card",
    reason_code: "accepted_payment_family_quo_card",
    definition_hash:
      "sha256:e6b7e276cce049df6eb4c67349774aa78871ce6b77d8e6d3ca6ce72b10ba4f72",
    rule_hash:
      "sha256:c4d65913b5d633355d58d461374a798afca9866105c9e4642b9abcbabdeeb6a1",
    candidate_hash:
      "sha256:acac6f0f14899c4626fa4e9b0f24e54cbf1af583a5e54ad079b6f5193d21c0f5",
  },
  quicpay: {
    publication_id: "candidate_p0_seveneleven_quicpay_20260821_v0_1",
    instrument_id: "instrument.seveneleven.quicpay",
    reason_code: "accepted_payment_family_quicpay",
    definition_hash:
      "sha256:da2db7784420e0c0cce230f1df5f5f8285dec0ad01b6c151a875c098e60b8227",
    rule_hash:
      "sha256:7f3b7f4cd40a20b84ca2ac77f9136ea67eb7f4c461ceed4dbf116545adc874b0",
    candidate_hash:
      "sha256:941b4dfae2e7130a7875d9501ed3d8c7c4b861c02729c3b000a07574aeaa0b2f",
  },
  rakuten_edy: {
    publication_id: "candidate_p0_seveneleven_rakuten_edy_20260821_v0_1",
    instrument_id: "instrument.seveneleven.rakuten_edy",
    reason_code: "accepted_payment_family_rakuten_edy",
    definition_hash:
      "sha256:8ac0e55edf33fe392e283fad61a1e439cb5eaab6d68559112f2750e7e49db89a",
    rule_hash:
      "sha256:47cecf84d1883bcfb9ad6ab14f11f1fd847efa84af900cb6fc6114894a399170",
    candidate_hash:
      "sha256:0edaeeef02df950270f646941ab45a03028d8fb13b6a2e4e53356c9f75f79167",
  },
  transport_e_money: {
    publication_id: "candidate_p0_seveneleven_transport_e_money_20260821_v0_1",
    instrument_id: "instrument.seveneleven.transport_e_money",
    reason_code: "accepted_payment_family_transport_e_money",
    definition_hash:
      "sha256:1ef4b44b55c5343ad9e762be46cfccac9c7d2f415d22f74f4766e75636775e1d",
    rule_hash:
      "sha256:812b1bfc122c0fb161dcab1b4947dc5a94f525194fa85ddf3dfc01ca79759d7f",
    candidate_hash:
      "sha256:80ebeb1dcbe998f1badd6bebfd3013c387f9cfd50f5f506b6c2fef39284b4f89",
  },
});

export const MAX_P0_EXPERIMENTAL_CATALOGUE_ROWS = 128 as const;
const CATALOGUE_ROW_LIMIT = MAX_P0_EXPERIMENTAL_CATALOGUE_ROWS + 1;

/**
 * This query intentionally selects the immutable candidate snapshot.  The
 * adapter validates and reduces it before returning anything to a caller.
 * One extra row is requested so an unexpectedly large view fails closed
 * instead of being silently truncated.
 */
export const P0_EXPERIMENTAL_CATALOGUE_QUERY = `
select candidate_hash, definition_hash, candidate_id, candidate_payload,
       source_observation_id, source_observation_key, observation_fingerprint,
       source_ids, p0_family_id, source_role_id, source_authority_role,
       status, machine_checked_at, admitted_at
  from app_api.p0_unverified_experimental_catalogue
 order by candidate_hash asc
 limit ${CATALOGUE_ROW_LIMIT}
`;

/** A single-publication lookup used inside the correction transaction. */
export const P0_EXPERIMENTAL_CATALOGUE_LOOKUP_QUERY = `
select candidate_hash, definition_hash, candidate_id, candidate_payload,
       source_observation_id, source_observation_key, observation_fingerprint,
       source_ids, p0_family_id, source_role_id, source_authority_role,
       status, machine_checked_at, admitted_at
  from app_api.p0_unverified_experimental_catalogue
 where candidate_id = $1::text
 order by candidate_hash asc
 limit 2
`;

/** The existing routine owns candidate locking and lifecycle transition. */
export const P0_EXPERIMENTAL_CORRECTION_QUERY = `
select app_private.record_provisional_correction(
    $1::jsonb,
    $2::text
) as disposition
`;

// Descriptive aliases make the boundary easy to discover without duplicating
// SQL text in downstream applications.
export const EXPERIMENTAL_CATALOGUE_QUERY = P0_EXPERIMENTAL_CATALOGUE_QUERY;
export const EXPERIMENTAL_CATALOGUE_LOOKUP_QUERY =
  P0_EXPERIMENTAL_CATALOGUE_LOOKUP_QUERY;
export const EXPERIMENTAL_CORRECTION_QUERY = P0_EXPERIMENTAL_CORRECTION_QUERY;

export type P0ExperimentalCatalogueStatus =
  | "machine_checked"
  | "active_experimental";

interface P0ExperimentalCatalogueRecordBase {
  readonly publication_id: string;
  readonly candidate_hash: Sha256;
  readonly definition_hash: Sha256;
  readonly status: P0ExperimentalCatalogueStatus;
  readonly checked_at: string;
  readonly admitted_at: string;
  readonly valid_from: string;
}

/** The bounded reward-rate record owned by this package; not a browser DTO. */
export interface P0ExperimentalRewardRateRecord
  extends P0ExperimentalCatalogueRecordBase {
  readonly kind: "reward_rate";
  readonly source_id: typeof NANACO_P0_SOURCE_ID;
  readonly source_label: "nanaco公式情報";
  readonly rule_id: typeof NANACO_P0_RULE_ID;
  readonly rule_version: typeof NANACO_P0_RULE_VERSION;
  readonly reward_units: "1";
  readonly spend_jpy: 200;
}

/** The bounded payment-acceptance record; no rate/product fields are present. */
export interface P0ExperimentalPaymentAcceptanceRecord
  extends P0ExperimentalCatalogueRecordBase {
  readonly kind: "payment_acceptance";
  readonly source_id: "merchant.seveneleven.payment-methods";
  readonly source_label: "セブン‐イレブン公式情報";
  readonly payment_family: SevenElevenPaymentFamily;
  readonly display_name_ja: string;
  readonly allowed_payment_instrument_id: string;
  readonly reason_code: string;
}

export type P0ExperimentalCatalogueRecord =
  | P0ExperimentalRewardRateRecord
  | P0ExperimentalPaymentAcceptanceRecord;

/** Generic aliases for callers that do not need the P0-specific spelling. */
export type ExperimentalCatalogueRecord = P0ExperimentalCatalogueRecord;
export type PostgresExperimentalCatalogueRecord = P0ExperimentalCatalogueRecord;

export interface ExperimentalCatalogueCorrectionInput {
  readonly publication_id: string;
  readonly category: CorrectionCategory;
}

export type P0ExperimentalCatalogueCorrectionInput =
  ExperimentalCatalogueCorrectionInput;

export type ExperimentalCatalogueCorrectionResult =
  | Readonly<{
      readonly ok: true;
      readonly publication_id: string;
      readonly category: CorrectionCategory;
      readonly accepted: true;
    }>
  | Readonly<{
      readonly ok: false;
      readonly code:
        | "publication_not_found"
        | "publication_not_active"
        | "correction_not_applied";
    }>;

export interface ExperimentalCatalogueStore {
  readonly list: () => Promise<readonly P0ExperimentalCatalogueRecord[]>;
  readonly reportCorrection: (
    input: ExperimentalCatalogueCorrectionInput,
  ) => Promise<ExperimentalCatalogueCorrectionResult>;
}

type JsonRecord = Record<string, unknown>;

const CATALOGUE_ROW_KEYS = Object.freeze([
  "candidate_hash",
  "definition_hash",
  "candidate_id",
  "candidate_payload",
  "source_observation_id",
  "source_observation_key",
  "observation_fingerprint",
  "source_ids",
  "p0_family_id",
  "source_role_id",
  "source_authority_role",
  "status",
  "machine_checked_at",
  "admitted_at",
] as const);

const CANDIDATE_KEYS = Object.freeze([
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
] as const);

const MACHINE_CHECK_KEYS = Object.freeze([
  "checker",
  "checker_version",
  "checked_at",
  "checks",
] as const);

const MACHINE_CHECK_CHECKS_KEYS = Object.freeze([
  "representation_safe",
  "rule_structure",
  "rule_semantics",
  "observation_binding",
  "p0_coverage",
] as const);

const EXTRACTOR_KEYS = Object.freeze(["name", "version"] as const);

const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const ISO_DATE_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})$/u;

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPlainRecord(value: unknown): value is JsonRecord {
  if (!isRecord(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value: JsonRecord, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    keys.length === sortedExpected.length &&
    keys.every((key, index) => key === sortedExpected[index])
  );
}

function strictIdentifier(value: unknown, field: string): string {
  if (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value))
    throw new TypeError(`p0_catalogue_${field}_invalid`);
  return value;
}

function strictHash(value: unknown, field: string): Sha256 {
  if (typeof value !== "string" || !HASH_PATTERN.test(value))
    throw new TypeError(`p0_catalogue_${field}_invalid`);
  return value as Sha256;
}

function isoDate(value: unknown, field: string): string {
  let text: string;
  if (typeof value === "string") {
    text = value;
  } else if (value instanceof Date && Number.isFinite(value.getTime())) {
    text = value.toISOString();
  } else {
    throw new TypeError(`p0_catalogue_${field}_invalid`);
  }
  if (
    text.length > 64 ||
    !ISO_DATE_PATTERN.test(text) ||
    !Number.isFinite(Date.parse(text))
  )
    throw new TypeError(`p0_catalogue_${field}_invalid`);
  return text;
}

function sameInstant(left: string, right: string): boolean {
  return Date.parse(left) === Date.parse(right);
}

function jsonValue(value: unknown, field: string): JsonRecord {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new TypeError(`p0_catalogue_${field}_invalid`);
    }
  }
  if (!isPlainRecord(parsed))
    throw new TypeError(`p0_catalogue_${field}_invalid`);
  return parsed;
}

function stringArray(value: unknown, field: string): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((item) => typeof item !== "string" || item.length === 0)
  )
    throw new TypeError(`p0_catalogue_${field}_invalid`);
  return Object.freeze([...value] as string[]);
}

function exactStringArray(
  value: unknown,
  expected: readonly string[],
  field: string,
): void {
  if (
    !Array.isArray(value) ||
    value.length !== expected.length ||
    value.some(
      (item, index) => typeof item !== "string" || item !== expected[index],
    )
  )
    throw new TypeError(`p0_catalogue_${field}_invalid`);
}

function boolean(value: unknown, field: string): true {
  if (value !== true) throw new TypeError(`p0_catalogue_${field}_invalid`);
  return true;
}

function candidateRule(
  candidate: JsonRecord,
  expectedRuleId: string,
): JsonRecord {
  const value = candidate.rule;
  const validity = isPlainRecord(value) ? value.validity : undefined;
  if (!isPlainRecord(value)) throw new TypeError("p0_catalogue_rule_invalid");
  // hashCanonical below is the final exact-definition check.  This extra
  // shape check makes accidental property renames fail with a local reason.
  if (
    typeof value.rule_id !== "string" ||
    value.rule_id !== expectedRuleId ||
    value.version !== NANACO_P0_RULE_VERSION ||
    value.status !== "under_review" ||
    !isPlainRecord(validity) ||
    typeof validity.valid_from !== "string"
  )
    throw new TypeError("p0_catalogue_rule_invalid");
  return value;
}

function validateNanacoCandidate(
  row: JsonRecord,
  candidateValue: unknown,
  candidateHash: Sha256,
  definitionHash: Sha256,
): {
  readonly validFrom: string;
  readonly rewardUnits: "1";
  readonly spendJpy: 200;
} {
  const candidate = jsonValue(candidateValue, "candidate_payload");
  if (!exactKeys(candidate, CANDIDATE_KEYS))
    throw new TypeError("p0_catalogue_candidate_shape_invalid");
  if (candidate.version !== "provisional-rule-candidate.v1")
    throw new TypeError("p0_catalogue_candidate_version_invalid");

  const publicationId = strictIdentifier(
    candidate.candidate_id,
    "candidate_id",
  );
  if (publicationId !== row.candidate_id)
    throw new TypeError("p0_catalogue_publication_binding_invalid");
  if (candidate.observation_id !== row.source_observation_key)
    throw new TypeError("p0_catalogue_observation_binding_invalid");
  if (candidate.observation_fingerprint !== row.observation_fingerprint)
    throw new TypeError("p0_catalogue_observation_fingerprint_invalid");
  if (candidate.p0_family_id !== NANACO_P0_FAMILY_ID)
    throw new TypeError("p0_catalogue_family_invalid");
  if (candidate.source_role_id !== NANACO_P0_SOURCE_ROLE_ID)
    throw new TypeError("p0_catalogue_source_role_invalid");
  if (candidate.source_authority_role !== "primary")
    throw new TypeError("p0_catalogue_source_authority_invalid");
  const candidateSourceIds = stringArray(
    candidate.source_ids,
    "candidate_source_ids",
  );
  if (
    candidateSourceIds.length !== 1 ||
    candidateSourceIds[0] !== NANACO_P0_SOURCE_ID
  )
    throw new TypeError("p0_catalogue_source_ids_invalid");

  const rowSourceIds = stringArray(row.source_ids, "source_ids");
  if (
    rowSourceIds.length !== 1 ||
    rowSourceIds[0] !== NANACO_P0_SOURCE_ID ||
    rowSourceIds[0] !== candidateSourceIds[0]
  )
    throw new TypeError("p0_catalogue_source_ids_invalid");

  const extractor = jsonValue(candidate.extractor, "extractor");
  if (
    !exactKeys(extractor, EXTRACTOR_KEYS) ||
    extractor.name !== "p0-nanaco-economic-extractor" ||
    extractor.version !== "0.1"
  )
    throw new TypeError("p0_catalogue_extractor_invalid");

  const machineCheck = jsonValue(candidate.machine_check, "machine_check");
  if (!exactKeys(machineCheck, MACHINE_CHECK_KEYS))
    throw new TypeError("p0_catalogue_machine_check_shape_invalid");
  if (
    machineCheck.checker !== "p0-nanaco-economic-semantic-check" ||
    machineCheck.checker_version !== "0.1"
  )
    throw new TypeError("p0_catalogue_machine_check_invalid");
  const checkedAt = isoDate(machineCheck.checked_at, "candidate_checked_at");
  const rowCheckedAt = isoDate(row.machine_checked_at, "machine_checked_at");
  if (!sameInstant(checkedAt, rowCheckedAt))
    throw new TypeError("p0_catalogue_machine_check_binding_invalid");
  const checks = jsonValue(machineCheck.checks, "machine_check_checks");
  if (!exactKeys(checks, MACHINE_CHECK_CHECKS_KEYS))
    throw new TypeError("p0_catalogue_machine_check_shape_invalid");
  for (const key of MACHINE_CHECK_CHECKS_KEYS) boolean(checks[key], key);

  const rule = candidateRule(candidate, NANACO_P0_RULE_ID);
  const validity = rule.validity;
  if (!isPlainRecord(validity))
    throw new TypeError("p0_catalogue_validity_invalid");
  const validFrom = isoDate(validity.valid_from, "valid_from");
  if (hashCanonical(rule) !== NANACO_P0_RULE_HASH)
    throw new TypeError("p0_catalogue_rule_definition_invalid");
  if (definitionHash !== NANACO_P0_DEFINITION_HASH)
    throw new TypeError("p0_catalogue_definition_hash_invalid");

  let computedCandidateHash: Sha256;
  try {
    computedCandidateHash = hashCandidate(
      candidate as unknown as ProvisionalRuleCandidate,
      definitionHash,
    );
  } catch {
    throw new TypeError("p0_catalogue_candidate_hash_invalid");
  }
  if (computedCandidateHash !== candidateHash)
    throw new TypeError("p0_catalogue_candidate_hash_invalid");

  const calculation = rule.calculation;
  if (
    !isPlainRecord(calculation) ||
    calculation.model !== "points_per_unit" ||
    calculation.reward_units !== "1" ||
    calculation.spend_jpy !== 200
  )
    throw new TypeError("p0_catalogue_calculation_invalid");
  return { validFrom, rewardUnits: "1", spendJpy: 200 };
}

function paymentFamily(value: unknown): SevenElevenPaymentFamily {
  if (
    typeof value !== "string" ||
    !Object.hasOwn(SEVEN_ELEVEN_PAYMENT_FAMILY_LABELS, value)
  )
    throw new TypeError("p0_catalogue_payment_family_invalid");
  return value as SevenElevenPaymentFamily;
}

function validatePaymentCandidate(
  row: JsonRecord,
  candidateValue: unknown,
  candidateHash: Sha256,
  definitionHash: Sha256,
): {
  readonly validFrom: string;
  readonly paymentFamily: SevenElevenPaymentFamily;
  readonly displayNameJa: string;
  readonly allowedPaymentInstrumentId: string;
  readonly reasonCode: string;
} {
  const candidate = jsonValue(candidateValue, "candidate_payload");
  if (!exactKeys(candidate, CANDIDATE_KEYS))
    throw new TypeError("p0_catalogue_candidate_shape_invalid");
  if (candidate.version !== "provisional-rule-candidate.v1")
    throw new TypeError("p0_catalogue_candidate_version_invalid");
  const publicationId = strictIdentifier(
    candidate.candidate_id,
    "candidate_id",
  );
  if (publicationId !== row.candidate_id)
    throw new TypeError("p0_catalogue_publication_binding_invalid");
  if (candidate.observation_id !== row.source_observation_key)
    throw new TypeError("p0_catalogue_observation_binding_invalid");
  if (candidate.observation_fingerprint !== row.observation_fingerprint)
    throw new TypeError("p0_catalogue_observation_fingerprint_invalid");
  if (
    candidate.p0_family_id !== "merchant.7eleven" ||
    candidate.source_role_id !== "accepted_payment_methods" ||
    candidate.source_authority_role !== "primary"
  )
    throw new TypeError("p0_catalogue_payment_identity_invalid");
  const candidateSourceIds = stringArray(
    candidate.source_ids,
    "candidate_source_ids",
  );
  if (
    candidateSourceIds.length !== 1 ||
    candidateSourceIds[0] !== "merchant.seveneleven.payment-methods"
  )
    throw new TypeError("p0_catalogue_source_ids_invalid");
  const rowSourceIds = stringArray(row.source_ids, "source_ids");
  if (
    rowSourceIds.length !== 1 ||
    rowSourceIds[0] !== "merchant.seveneleven.payment-methods"
  )
    throw new TypeError("p0_catalogue_source_ids_invalid");

  const family = paymentFamily(
    candidate.rule && isPlainRecord(candidate.rule)
      ? candidate.rule.rule_id
          ?.toString()
          .replace("rr_p0_seveneleven_accept_", "")
      : undefined,
  );
  const config = PAYMENT_FAMILY_CONFIG[family];
  if (publicationId !== config.publication_id)
    throw new TypeError("p0_catalogue_publication_binding_invalid");
  const extractor = jsonValue(candidate.extractor, "extractor");
  if (
    !exactKeys(extractor, EXTRACTOR_KEYS) ||
    extractor.name !== "p0-payment-family-extractor" ||
    extractor.version !== "0.1"
  )
    throw new TypeError("p0_catalogue_extractor_invalid");
  const machineCheck = jsonValue(candidate.machine_check, "machine_check");
  if (!exactKeys(machineCheck, MACHINE_CHECK_KEYS))
    throw new TypeError("p0_catalogue_machine_check_shape_invalid");
  if (
    machineCheck.checker !== "p0-payment-family-semantic-check" ||
    machineCheck.checker_version !== "0.1"
  )
    throw new TypeError("p0_catalogue_machine_check_invalid");
  const checkedAt = isoDate(machineCheck.checked_at, "candidate_checked_at");
  const rowCheckedAt = isoDate(row.machine_checked_at, "machine_checked_at");
  if (!sameInstant(checkedAt, rowCheckedAt))
    throw new TypeError("p0_catalogue_machine_check_binding_invalid");
  const checks = jsonValue(machineCheck.checks, "machine_check_checks");
  if (!exactKeys(checks, MACHINE_CHECK_CHECKS_KEYS))
    throw new TypeError("p0_catalogue_machine_check_shape_invalid");
  for (const key of MACHINE_CHECK_CHECKS_KEYS) boolean(checks[key], key);

  const rule = candidateRule(candidate, `rr_p0_seveneleven_accept_${family}`);
  const validity = rule.validity;
  if (!isPlainRecord(validity))
    throw new TypeError("p0_catalogue_validity_invalid");
  const validFrom = isoDate(validity.valid_from, "valid_from");
  if (
    hashDefinition(rule) !== definitionHash ||
    definitionHash !== config.definition_hash ||
    hashCanonical(rule) !== config.rule_hash
  )
    throw new TypeError("p0_catalogue_payment_definition_invalid");

  const eligibility = jsonValue(rule.eligibility, "eligibility");
  if (
    !exactKeys(eligibility, [
      "operation_match",
      "user_conditions",
      "transaction_conditions",
      "campaign_conditions",
    ])
  )
    throw new TypeError("p0_catalogue_payment_eligibility_invalid");
  const operationMatch = jsonValue(
    eligibility.operation_match,
    "operation_match",
  );
  if (
    !exactKeys(operationMatch, [
      "required_loyalty_program_ids",
      "excluded_payment_instrument_ids",
      "allowed_funding_source_ids",
      "excluded_funding_source_ids",
      "allowed_source_asset_ids",
      "excluded_source_asset_ids",
      "allowed_destination_asset_ids",
      "required_interfaces",
      "excluded_interfaces",
      "must_present_before_payment",
      "allowed_payment_instrument_ids",
    ])
  )
    throw new TypeError("p0_catalogue_payment_operation_match_invalid");
  for (const key of [
    "required_loyalty_program_ids",
    "excluded_payment_instrument_ids",
    "allowed_funding_source_ids",
    "excluded_funding_source_ids",
    "allowed_source_asset_ids",
    "excluded_source_asset_ids",
    "allowed_destination_asset_ids",
    "required_interfaces",
    "excluded_interfaces",
  ])
    exactStringArray(operationMatch[key], [], `payment_${key}`);
  if (operationMatch.must_present_before_payment !== false)
    throw new TypeError("p0_catalogue_payment_operation_match_invalid");
  exactStringArray(
    operationMatch.allowed_payment_instrument_ids,
    [config.instrument_id],
    "payment_instrument",
  );
  if (!Array.isArray(eligibility.user_conditions))
    throw new TypeError("p0_catalogue_payment_eligibility_invalid");
  const transactionConditions = jsonValue(
    eligibility.transaction_conditions,
    "transaction_conditions",
  );
  if (
    !exactKeys(transactionConditions, [
      "eligible_amount_basis",
      "requires_single_operation",
    ]) ||
    transactionConditions.eligible_amount_basis !== "not_applicable" ||
    transactionConditions.requires_single_operation !== true
  )
    throw new TypeError("p0_catalogue_payment_transaction_invalid");
  const campaignConditions = jsonValue(
    eligibility.campaign_conditions,
    "campaign_conditions",
  );
  if (
    !exactKeys(campaignConditions, [
      "entry_required",
      "targeted_offer",
      "identity_verification_required",
      "first_use_only",
    ]) ||
    campaignConditions.entry_required !== false ||
    campaignConditions.targeted_offer !== false ||
    campaignConditions.identity_verification_required !== false ||
    campaignConditions.first_use_only !== false
  )
    throw new TypeError("p0_catalogue_payment_campaign_invalid");

  const effect = jsonValue(rule.effect, "effect");
  if (
    !exactKeys(effect, [
      "decision",
      "effect_target",
      "target_rule_ids",
      "target_stack_groups",
      "reason_code",
    ]) ||
    effect.decision !== "allow" ||
    effect.effect_target !== "operation_eligibility" ||
    effect.reason_code !== config.reason_code
  )
    throw new TypeError("p0_catalogue_payment_effect_invalid");
  exactStringArray(effect.target_rule_ids, [], "payment_target_rule_ids");
  exactStringArray(
    effect.target_stack_groups,
    [],
    "payment_target_stack_groups",
  );

  let computedCandidateHash: Sha256;
  try {
    computedCandidateHash = hashCandidate(
      candidate as unknown as ProvisionalRuleCandidate,
      definitionHash,
    );
  } catch {
    throw new TypeError("p0_catalogue_candidate_hash_invalid");
  }
  if (
    computedCandidateHash !== candidateHash ||
    candidateHash !== config.candidate_hash
  )
    throw new TypeError("p0_catalogue_candidate_hash_invalid");
  return {
    validFrom,
    paymentFamily: family,
    displayNameJa: SEVEN_ELEVEN_PAYMENT_FAMILY_LABELS[family],
    allowedPaymentInstrumentId: config.instrument_id,
    reasonCode: config.reason_code,
  };
}

function normalizeDatabaseRow(value: unknown): JsonRecord {
  if (!isPlainRecord(value)) throw new TypeError("p0_catalogue_row_invalid");
  if (!exactKeys(value, CATALOGUE_ROW_KEYS))
    throw new TypeError("p0_catalogue_row_shape_invalid");
  // Copy through data properties before validation. A query driver normally
  // gives us an ordinary record; this also rejects accessor-backed test rows.
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const output: JsonRecord = Object.create(null) as JsonRecord;
  for (const key of CATALOGUE_ROW_KEYS) {
    const descriptor = descriptors[key];
    if (!descriptor || !("value" in descriptor))
      throw new TypeError("p0_catalogue_row_accessor_invalid");
    output[key] = descriptor.value;
  }
  return output;
}

function recordFromRow(value: unknown): P0ExperimentalCatalogueRecord {
  const row = normalizeDatabaseRow(value);
  const candidateHash = strictHash(row.candidate_hash, "candidate_hash");
  const definitionHash = strictHash(row.definition_hash, "definition_hash");
  const publicationId = strictIdentifier(row.candidate_id, "publication_id");
  if (row.status !== "machine_checked" && row.status !== "active_experimental")
    throw new TypeError("p0_catalogue_status_invalid");
  const sourceObservationKey = strictIdentifier(
    row.source_observation_key,
    "source_observation_key",
  );
  const observationFingerprint = strictHash(
    row.observation_fingerprint,
    "observation_fingerprint",
  );
  const checkedAt = isoDate(row.machine_checked_at, "machine_checked_at");
  const admittedAt = isoDate(row.admitted_at, "admitted_at");
  const payload =
    typeof row.candidate_payload === "string"
      ? jsonValue(row.candidate_payload, "candidate_payload")
      : row.candidate_payload;
  const boundRow = {
    ...row,
    source_observation_key: sourceObservationKey,
    observation_fingerprint: observationFingerprint,
  };
  if (row.p0_family_id === NANACO_P0_FAMILY_ID) {
    const { validFrom, rewardUnits, spendJpy } = validateNanacoCandidate(
      boundRow,
      payload,
      candidateHash,
      definitionHash,
    );
    return Object.freeze({
      kind: "reward_rate" as const,
      publication_id: publicationId,
      candidate_hash: candidateHash,
      definition_hash: definitionHash,
      status: row.status,
      checked_at: checkedAt,
      admitted_at: admittedAt,
      valid_from: validFrom,
      source_id: NANACO_P0_SOURCE_ID,
      source_label: "nanaco公式情報" as const,
      rule_id: NANACO_P0_RULE_ID,
      rule_version: NANACO_P0_RULE_VERSION,
      reward_units: rewardUnits,
      spend_jpy: spendJpy,
    });
  }
  if (row.p0_family_id !== "merchant.7eleven")
    throw new TypeError("p0_catalogue_family_invalid");
  if (row.status !== "active_experimental")
    throw new TypeError("p0_catalogue_payment_status_invalid");
  const payment = validatePaymentCandidate(
    boundRow,
    payload,
    candidateHash,
    definitionHash,
  );
  return Object.freeze({
    kind: "payment_acceptance" as const,
    publication_id: publicationId,
    candidate_hash: candidateHash,
    definition_hash: definitionHash,
    status: row.status,
    checked_at: checkedAt,
    admitted_at: admittedAt,
    valid_from: payment.validFrom,
    source_id: "merchant.seveneleven.payment-methods" as const,
    source_label: "セブン‐イレブン公式情報" as const,
    payment_family: payment.paymentFamily,
    display_name_ja: payment.displayNameJa,
    allowed_payment_instrument_id: payment.allowedPaymentInstrumentId,
    reason_code: payment.reasonCode,
  });
}

function rowsOf<Row>(result: QueryResult<Row>, field: string): readonly Row[] {
  if (!result || !Array.isArray(result.rows))
    throw new TypeError(`p0_catalogue_${field}_result_invalid`);
  return result.rows;
}

function validCategory(value: unknown): value is CorrectionCategory {
  return (
    typeof value === "string" &&
    (CORRECTION_CATEGORIES as readonly string[]).includes(value)
  );
}

function validateCorrectionInput(
  value: unknown,
): ExperimentalCatalogueCorrectionInput {
  if (!isPlainRecord(value))
    throw new TypeError("p0_catalogue_correction_input_invalid");
  if (!exactKeys(value, ["publication_id", "category"]))
    throw new TypeError("p0_catalogue_correction_input_shape_invalid");
  return {
    publication_id: strictIdentifier(value.publication_id, "publication_id"),
    category: validCategory(value.category)
      ? value.category
      : (() => {
          throw new TypeError("p0_catalogue_correction_category_invalid");
        })(),
  };
}

function correctionTimestamp(record: P0ExperimentalCatalogueRecord): string {
  const floor = Math.max(
    Date.parse(record.checked_at),
    Date.parse(record.admitted_at),
  );
  const now = Date.now();
  return new Date(
    Math.max(Number.isFinite(now) ? now : floor, floor),
  ).toISOString();
}

function correctionSignalId(publicationId: string, reportedAt: string): string {
  const encodedTime = Date.parse(reportedAt).toString(36);
  return `consumer_alpha_${publicationId}_${encodedTime}`.slice(0, 128);
}

function correctionResultRow(
  value: unknown,
): "disputed" | "recorded" | "quarantined" {
  if (!isPlainRecord(value) || !exactKeys(value, ["disposition"]))
    throw new TypeError("p0_catalogue_correction_result_invalid");
  if (
    value.disposition !== "disputed" &&
    value.disposition !== "recorded" &&
    value.disposition !== "quarantined"
  )
    throw new TypeError("p0_catalogue_correction_disposition_invalid");
  return value.disposition;
}

function isQueryPool(target: QueryTarget): target is QueryPool {
  return "connect" in target && typeof target.connect === "function";
}

function asError(value: unknown, fallback: string): Error {
  return value instanceof Error ? value : new Error(fallback);
}

/**
 * Construct a driver-neutral PostgreSQL catalogue/correction store. No
 * PostgreSQL driver is imported; callers provide a node-postgres,
 * postgres.js, or test-double query client/pool.
 */
export function createPostgresExperimentalCatalogueStore(
  target: QueryTarget,
): ExperimentalCatalogueStore {
  const list = async (): Promise<readonly P0ExperimentalCatalogueRecord[]> => {
    const result = await target.query(P0_EXPERIMENTAL_CATALOGUE_QUERY);
    const rows = rowsOf(result, "list");
    if (rows.length > MAX_P0_EXPERIMENTAL_CATALOGUE_ROWS)
      throw new Error("p0_catalogue_too_many_rows");
    const records = rows.map((row) => recordFromRow(row));
    const seen = new Set<string>();
    const seenHashes = new Set<string>();
    for (const record of records) {
      if (seen.has(record.publication_id))
        throw new Error("p0_catalogue_publication_duplicate");
      if (seenHashes.has(record.candidate_hash))
        throw new Error("p0_catalogue_candidate_duplicate");
      seen.add(record.publication_id);
      seenHashes.add(record.candidate_hash);
    }
    return Object.freeze(
      [...records].sort((left, right) =>
        left.candidate_hash.localeCompare(right.candidate_hash),
      ),
    );
  };

  const reportCorrection = async (
    rawInput: ExperimentalCatalogueCorrectionInput,
  ): Promise<ExperimentalCatalogueCorrectionResult> => {
    const input = validateCorrectionInput(rawInput);
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
      const lookup = await client.query(
        P0_EXPERIMENTAL_CATALOGUE_LOOKUP_QUERY,
        [input.publication_id],
      );
      const lookupRows = rowsOf(lookup, "lookup");
      if (lookupRows.length === 0) {
        await client.query("COMMIT");
        committed = true;
        return Object.freeze({ ok: false, code: "publication_not_found" });
      }
      if (lookupRows.length !== 1)
        throw new Error("p0_catalogue_publication_ambiguous");
      const record = recordFromRow(lookupRows[0]);
      if (record.publication_id !== input.publication_id)
        throw new Error("p0_catalogue_publication_binding_invalid");

      const reportedAt = correctionTimestamp(record);
      const signal = {
        version: "provisional-correction.v1" as const,
        signal_id: correctionSignalId(record.publication_id, reportedAt),
        candidate_hash: record.candidate_hash,
        category: input.category,
        credible: true as const,
        reported_at: reportedAt,
        severity: "normal" as const,
      };
      const signalHash = hashCanonical(signal);
      const correction = await client.query(P0_EXPERIMENTAL_CORRECTION_QUERY, [
        JSON.stringify(signal),
        signalHash,
      ]);
      const correctionRows = rowsOf(correction, "correction");
      if (correctionRows.length !== 1 || correctionRows[0] === undefined)
        throw new Error("p0_catalogue_correction_empty_result");
      const disposition = correctionResultRow(correctionRows[0]);
      await client.query("COMMIT");
      committed = true;
      if (disposition !== "disputed")
        return Object.freeze({ ok: false, code: "correction_not_applied" });
      return Object.freeze({
        ok: true,
        publication_id: input.publication_id,
        category: input.category,
        accepted: true,
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
          if (failed) release(asError(originalError, "p0_catalogue_failed"));
          else release();
        } catch {
          // Preserve the original query/transaction error.
        }
      }
    }
  };

  return Object.freeze({ list, reportCorrection });
}

export const createPostgresCatalogueStore =
  createPostgresExperimentalCatalogueStore;
export const createPostgresP0ExperimentalCatalogueStore =
  createPostgresExperimentalCatalogueStore;
