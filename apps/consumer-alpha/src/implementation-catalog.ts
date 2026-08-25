import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { types as nodeTypes } from "node:util";
import type {
  P0ImplementationCatalogueOptions,
  P0ImplementationCatalogueStore,
  P0ImplementationFact,
  P0ImplementationFactCorrectionResult,
} from "@jro/agent-feed-postgres";
import type {
  ImplementationFactCard,
  ImplementationFactCataloguePort,
  ImplementationFactCatalogueSnapshot,
  ImplementationFactCorrectionInput,
  ImplementationFactCorrectionResult,
  ImplementationFactCorrectionSuccess,
} from "./contracts.js";
import {
  IMPLEMENTATION_FACT_CATALOGUE_STATUSES,
  IMPLEMENTATION_FACT_CORRECTION_CATEGORIES,
} from "./contracts.js";
import {
  localizeImplementationPredicate,
  localizeImplementationSubject,
  localizeImplementationSummary,
} from "./implementation-localization.js";

const IMPLEMENTATION_FIXTURES = Object.freeze([
  "../../../fixtures/m3/provisional/p0-point-rules-a.implementation.v0.1.json",
  "../../../fixtures/m3/provisional/p0-point-rules-b.implementation.v0.4.json",
  "../../../fixtures/m3/provisional/p0-wallet-card-rules.implementation.v0.5.json",
  "../../../fixtures/m3/provisional/p0-merchant-transit-regulatory-rules.implementation.v0.6.json",
  "../../../fixtures/m3/provisional/p0-complex-route-benchmark.implementation.v0.7.json",
  "../../../fixtures/m3/provisional/p0-moppy-jal-standard.implementation.v0.8.json",
  "../../../fixtures/m3/provisional/p0-exchange-route-completeness.implementation.v0.9.json",
] as const);
/** The PostgreSQL adapter pages at 128; the browser catalogue has a separate
 * resource ceiling while accepting bounded additive snapshots. */
const MAX_FACTS = 512;
const DATABASE_PAGE_SIZE = 128;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const PUBLIC_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const URL_PATTERN = /https?:\/\//iu;
const EMAIL_PATTERN = /[^\s@]+@[^\s@]+\.[^\s@]+/u;

const FAMILY_LABELS: Readonly<Record<string, string>> = Object.freeze({
  "point.d": "dポイント",
  "point.jre": "JRE POINT",
  "point.nanaco": "nanacoポイント",
  "point.paypay": "PayPayポイント",
  "point.ponta": "Pontaポイント",
  "point.rakuten": "楽天ポイント",
  "point.v": "Vポイント",
  "point.waon": "WAON POINT",
  "point.bic": "ビックポイント",
  "point.doutor-value": "ドトール バリューポイント",
  "point.majica": "majicaポイント",
  "point.matsukiyococokara": "マツキヨココカラポイント",
  "point.skylark": "すかいらーくポイント",
  "point.starbucks-stars": "Starbucks Rewards Stars",
  "point.sugi": "スギポイント",
  "point.tullys-beans": "タリーズ ビーンズ",
  "storedvalue.majica": "majicaマネー",
  "storedvalue.starbucks-card": "スターバックス カード",
  "emoney.id": "iD",
  "emoney.quicpay": "QUICPay",
  "emoney.rakuten-edy": "楽天Edy",
  "transit.ic-generic": "交通系IC",
  "card.aeon": "イオンカード",
  "card.aupay": "au PAYカード",
  "card.d": "dカード",
  "card.paypay": "PayPayカード",
  "card.rakuten": "楽天カード",
  "card.smbc": "三井住友カード",
  "card.view": "ビューカード",
  "wallet.aeonpay": "AEON Pay",
  "wallet.aupay": "au PAY",
  "wallet.dbarai": "d払い",
  "wallet.famipay": "ファミペイ",
  "wallet.paypay": "PayPay",
  "wallet.rakutenpay": "楽天ペイ",
  "emoney.nanaco": "nanaco電子マネー",
  "emoney.waon": "WAON電子マネー",
  "merchant.7eleven": "セブン‐イレブン",
  "merchant.aeon-group": "イオングループ",
  "merchant.amazon-jp": "Amazon Pay",
  "merchant.biccamera": "ビックカメラ",
  "merchant.familymart": "ファミリーマート",
  "merchant.itoyokado": "イトーヨーカドー",
  "merchant.lawson": "ローソン",
  "merchant.matsukiyo": "マツキヨ",
  "merchant.mcdonalds": "マクドナルド",
  "merchant.newdays": "NewDays",
  "merchant.rakuten-market": "楽天市場",
  "merchant.starbucks": "スターバックス",
  "merchant.welcia": "ウエルシア",
  "merchant.yahoo-shopping": "Yahoo!ショッピング",
  "merchant.yodobashi": "ヨドバシカメラ",
  "reg.jp.caa.advertising": "消費者庁（広告）",
  "reg.jp.fsa.payments": "金融庁（決済）",
  "reg.jp.ppc.privacy": "個人情報保護委員会",
  "transit.suica": "Suica・JRE POINT",
  "point.moppy": "モッピーポイント",
  "point.saison": "セゾン永久不滅ポイント",
  "portal.jal-mileage-park": "JALマイレージパーク",
  "transit.jrkyushu": "JRキューポ",
  "wallet.anapay": "ANA Pay",
  "wallet.kyash": "Kyash",
  "wallet.revolut-jp": "Revolut",
});

const CLAIM_LABELS: Readonly<Record<string, string>> = Object.freeze({
  earn_rule: "貯まる条件",
  rounding: "計算方法",
  timing: "付与時期",
  timing_and_exclusion: "付与時期と対象外条件",
  timing_and_cap: "付与時期と上限",
  eligibility: "利用できる条件",
  eligibility_and_exclusion: "利用条件と対象外条件",
  exclusion: "対象外条件",
  expiry_rule: "有効期限",
  expiry_and_redemption_priority: "有効期限と利用順",
  redemption_rule: "使い方",
  redemption_value: "利用時の価値",
  redemption_priority: "利用順",
  transfer_rule: "移行・送付条件",
  campaign_rule: "キャンペーン条件",
  campaign_period: "キャンペーン期間",
  change_notice: "変更のお知らせ",
  adjustment_rule: "取消・調整",
  program_term: "サービス期間",
  merchant_acceptance: "利用できるお店",
  merchant_bonus: "加盟店ボーナス",
  card_catalog: "カード商品一覧",
  expiry_and_reward_classes: "有効期限とポイント区分",
  annual_fee: "年会費",
  annual_spend_bonus: "年間利用特典",
  wallet_bonus: "ウォレット特典",
  campaign_expiry: "キャンペーン特典の期限",
  funding_rule: "入金条件",
  funding_limit: "入金上限",
  funding_fee: "入金手数料",
  program_bonus: "プログラム特典",
  fee_rule: "手数料条件",
  campaign_cap: "キャンペーン上限",
});

type JsonRecord = Record<string, unknown>;

interface FixtureEntry {
  readonly parent_claim_id: string;
  readonly family_id: string;
  readonly claim_type: string;
  readonly subject: string;
  readonly predicate: string;
  readonly short_paraphrase: string;
  readonly disposition?: string;
  readonly source_identity?: readonly FixtureSourceIdentity[];
  readonly applicability?: FixtureApplicability;
}

interface FixtureSourceIdentity {
  readonly source_id: string;
  readonly url?: string;
}

interface FixtureApplicability {
  readonly effective_from?: string | null;
  readonly effective_to?: string | null;
}

interface FixtureDocument {
  readonly version: string;
  readonly as_of: string;
  readonly entries: readonly FixtureEntry[];
}

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x1f || codePoint === 0x7f) return true;
  }
  return false;
}

/**
 * A backend can be the strict browser port or the generic PostgreSQL store.
 * The latter is intentionally recognised by its `search` method and is
 * reduced below before it reaches the HTTP response.
 */
export type ImplementationFactBackend =
  | ImplementationFactCataloguePort
  | P0ImplementationCatalogueStore;

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPlainRecord(value: unknown): value is JsonRecord {
  if (!isRecord(value) || nodeTypes.isProxy(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactDataRecord(
  value: unknown,
  keys: readonly string[],
  error: string,
): JsonRecord {
  if (!isPlainRecord(value)) throw new TypeError(error);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actual = Object.keys(descriptors).sort();
  const expected = [...keys].sort();
  if (
    Object.getOwnPropertySymbols(value).length !== 0 ||
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  )
    throw new TypeError(error);
  const output: JsonRecord = Object.create(null) as JsonRecord;
  for (const key of keys) {
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

function safePublicText(
  value: unknown,
  field: string,
  maxLength: number,
): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maxLength ||
    containsControlCharacter(value) ||
    URL_PATTERN.test(value) ||
    EMAIL_PATTERN.test(value)
  )
    throw new TypeError(`implementation_fact_${field}_invalid`);
  return value;
}

function safePublicIdentifier(
  value: unknown,
  field: string,
  maxLength: number,
): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maxLength ||
    !PUBLIC_IDENTIFIER_PATTERN.test(value)
  )
    throw new TypeError(`implementation_fact_${field}_invalid`);
  return value;
}

function safeUpdatedAt(value: unknown): string | null {
  if (value === null) return null;
  if (
    typeof value !== "string" ||
    !Number.isFinite(Date.parse(value)) ||
    value.length > 64
  )
    throw new TypeError("implementation_fact_updated_at_invalid");
  return value;
}

function safeDateOrNull(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  if (
    typeof value !== "string" ||
    value.length > 64 ||
    containsControlCharacter(value) ||
    !/^\d{4}-\d{2}-\d{2}(?:$|T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})$)/u.test(
      value,
    ) ||
    !Number.isFinite(Date.parse(value))
  )
    throw new TypeError(`implementation_fact_${field}_invalid`);
  return value;
}

function safeSourceUrl(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (
    typeof value !== "string" ||
    value.length > 2048 ||
    containsControlCharacter(value) ||
    !/^https:\/\/[^\s]+$/u.test(value)
  )
    throw new TypeError("implementation_fact_source_url_invalid");
  return value;
}

function fixtureSourceIdentity(
  value: unknown,
): readonly FixtureSourceIdentity[] {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value))
    throw new TypeError("implementation_fixture_source_identity_invalid");
  return Object.freeze(
    value.map((item) => {
      if (!isPlainRecord(item))
        throw new TypeError("implementation_fixture_source_identity_invalid");
      const sourceId = safePublicText(item.source_id, "source_id", 256);
      const url = safeSourceUrl(item.url);
      return Object.freeze({ source_id: sourceId, ...(url ? { url } : {}) });
    }),
  );
}

function fixtureApplicability(value: unknown): FixtureApplicability {
  if (value === undefined) return Object.freeze({});
  if (!isPlainRecord(value))
    throw new TypeError("implementation_fixture_applicability_invalid");
  return Object.freeze({
    effective_from: safeDateOrNull(value.effective_from, "effective_from"),
    effective_to: safeDateOrNull(value.effective_to, "effective_to"),
  });
}

function sourceUrlFromIdentity(
  sourceIdentity: readonly FixtureSourceIdentity[] | undefined,
): string | null {
  for (const identity of sourceIdentity ?? []) {
    if (identity.url !== undefined) return identity.url;
  }
  return null;
}

function opaqueFixtureKey(
  entry: FixtureEntry,
  index: number,
  implementationVersion: string,
): string {
  const digest = createHash("sha256")
    .update(
      `${implementationVersion}\u0000${index}\u0000${entry.parent_claim_id}`,
    )
    .digest("hex");
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(
    13,
    16,
  )}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

function displayFamily(value: string): string {
  return FAMILY_LABELS[value] ?? "ポイント情報";
}

function displayClaim(value: string): string {
  return CLAIM_LABELS[value] ?? "その他の条件";
}

function mapRecordToCard(record: P0ImplementationFact): ImplementationFactCard {
  if (!UUID_PATTERN.test(record.fact_id))
    throw new TypeError("implementation_fact_fact_id_invalid");
  const familyId = safePublicIdentifier(record.family_id, "family_id", 128);
  const claimType = safePublicIdentifier(record.claim_type, "claim_type", 256);
  const family = displayFamily(familyId);
  const claim = displayClaim(claimType);
  const subject = localizeImplementationSubject(
    safePublicText(record.subject, "subject", 4096),
  );
  const sourcePredicate = safePublicText(record.predicate, "predicate", 512);
  const sourceSummary = safePublicText(
    record.short_paraphrase,
    "summary",
    4096,
  );
  return Object.freeze({
    fact_key: record.fact_id,
    family_id: familyId,
    claim_type: claimType,
    family,
    claim,
    subject,
    predicate: localizeImplementationPredicate(sourcePredicate),
    summary: localizeImplementationSummary(
      sourceSummary,
      subject,
      claim,
      family,
    ),
    // The current generic implementation snapshot contains catalogue facts
    // with no derived engine rules.  A future explicit engine-rule row may
    // opt into the comparison lane through this one boolean only.
    use_in_comparison: record.disposition === "engine_rule",
    source_url: record.source_url ?? null,
    checked_at: record.checked_at ?? null,
    effective_from: record.effective_from ?? null,
    effective_to: record.effective_to ?? null,
  });
}

const CARD_KEYS = Object.freeze([
  "fact_key",
  "family_id",
  "claim_type",
  "family",
  "claim",
  "subject",
  "predicate",
  "summary",
  "use_in_comparison",
  "source_url",
  "checked_at",
  "effective_from",
  "effective_to",
] as const);

function normalizeCard(value: unknown): ImplementationFactCard {
  const input = exactDataRecord(
    value,
    CARD_KEYS,
    "implementation_fact_card_shape_invalid",
  );
  if (typeof input.fact_key !== "string" || !UUID_PATTERN.test(input.fact_key))
    throw new TypeError("implementation_fact_fact_key_invalid");
  const familyId = safePublicIdentifier(input.family_id, "family_id", 128);
  const claimType = safePublicIdentifier(input.claim_type, "claim_type", 256);
  if (typeof input.use_in_comparison !== "boolean")
    throw new TypeError("implementation_fact_comparison_flag_invalid");
  const subject = localizeImplementationSubject(
    safePublicText(input.subject, "subject", 4096),
  );
  return Object.freeze({
    fact_key: input.fact_key,
    family_id: familyId,
    claim_type: claimType,
    family: safePublicText(input.family, "family", 96),
    claim: safePublicText(input.claim, "claim", 96),
    subject,
    predicate: safePublicText(input.predicate, "predicate", 512),
    summary: safePublicText(input.summary, "summary", 4096),
    use_in_comparison: input.use_in_comparison,
    source_url: safeSourceUrl(input.source_url),
    checked_at: safeDateOrNull(input.checked_at, "checked_at"),
    effective_from: safeDateOrNull(input.effective_from, "effective_from"),
    effective_to: safeDateOrNull(input.effective_to, "effective_to"),
  });
}

export function normalizeImplementationFactSnapshot(
  value: unknown,
): ImplementationFactCatalogueSnapshot {
  const input = exactDataRecord(
    value,
    ["status", "updated_at", "facts"],
    "implementation_fact_snapshot_shape_invalid",
  );
  if (
    !(IMPLEMENTATION_FACT_CATALOGUE_STATUSES as readonly string[]).includes(
      input.status as string,
    )
  )
    throw new TypeError("implementation_fact_snapshot_status_invalid");
  if (!Array.isArray(input.facts) || input.facts.length > MAX_FACTS)
    throw new TypeError("implementation_fact_snapshot_facts_invalid");
  const facts = input.facts.map(normalizeCard);
  const seen = new Set<string>();
  for (const fact of facts) {
    if (seen.has(fact.fact_key))
      throw new TypeError("implementation_fact_duplicate_fact_key");
    seen.add(fact.fact_key);
  }
  return Object.freeze({
    status: input.status as "ready" | "partial",
    updated_at: safeUpdatedAt(input.updated_at),
    facts: Object.freeze(facts),
  });
}

function fixtureEntry(value: unknown): FixtureEntry {
  if (!isPlainRecord(value))
    throw new TypeError("implementation_fixture_entry_invalid");
  const entry = value as JsonRecord;
  return Object.freeze({
    parent_claim_id: safePublicText(
      entry.parent_claim_id,
      "parent_claim_id",
      256,
    ),
    family_id: safePublicIdentifier(entry.family_id, "family_id", 128),
    claim_type: safePublicIdentifier(entry.claim_type, "claim_type", 256),
    subject: safePublicText(entry.subject, "subject", 4096),
    predicate: safePublicText(entry.predicate, "predicate", 512),
    short_paraphrase: safePublicText(entry.short_paraphrase, "summary", 4096),
    disposition:
      typeof entry.disposition === "string" ? entry.disposition : undefined,
    source_identity: fixtureSourceIdentity(entry.source_identity),
    applicability: fixtureApplicability(entry.applicability),
  });
}

function fixtureDocument(value: unknown): FixtureDocument {
  if (!isPlainRecord(value))
    throw new TypeError("implementation_fixture_shape_invalid");
  const document = value as JsonRecord;
  if (
    typeof document.version !== "string" ||
    document.version.length === 0 ||
    document.version.length > 128
  )
    throw new TypeError("implementation_fixture_version_invalid");
  if (!Array.isArray(document.entries))
    throw new TypeError("implementation_fixture_entries_invalid");
  const asOf = safeUpdatedAt(document.as_of);
  if (asOf === null)
    throw new TypeError("implementation_fixture_as_of_invalid");
  const entries = document.entries.map(fixtureEntry);
  return Object.freeze({
    version: document.version,
    as_of: asOf,
    entries: Object.freeze(entries),
  });
}

function fixtureCards(
  document: FixtureDocument,
): readonly ImplementationFactCard[] {
  return Object.freeze(
    document.entries.map((entry, index) => {
      const family = displayFamily(entry.family_id);
      const claim = displayClaim(entry.claim_type);
      return Object.freeze({
        fact_key: opaqueFixtureKey(entry, index, document.version),
        family_id: entry.family_id,
        claim_type: entry.claim_type,
        family,
        claim,
        subject: localizeImplementationSubject(entry.subject),
        predicate: localizeImplementationPredicate(entry.predicate),
        summary: localizeImplementationSummary(
          entry.short_paraphrase,
          localizeImplementationSubject(entry.subject),
          claim,
          family,
        ),
        use_in_comparison: entry.disposition === "engine_rule",
        source_url: sourceUrlFromIdentity(entry.source_identity),
        checked_at: document.as_of,
        effective_from: entry.applicability?.effective_from ?? null,
        effective_to: entry.applicability?.effective_to ?? null,
      });
    }),
  );
}

function correctionSuccess(
  input: ImplementationFactCorrectionInput,
  result: P0ImplementationFactCorrectionResult,
): ImplementationFactCorrectionSuccess {
  return Object.freeze({
    ok: true as const,
    fact_key: input.fact_key,
    category: input.category,
    outcome: result.outcome,
  });
}

function isPostgresStore(
  value: ImplementationFactBackend,
): value is P0ImplementationCatalogueStore {
  return "search" in value && typeof value.search === "function";
}

/**
 * Adapt the generic PostgreSQL implementation-fact store to the browser
 * contract.  The correction ID is host-generated from the opaque UUID; the
 * database resolves that UUID to the exact implementation version/fact
 * version before recording it.
 */
export function createPostgresImplementationFactCataloguePort(
  store: P0ImplementationCatalogueStore,
  options: P0ImplementationCatalogueOptions = {},
): ImplementationFactCataloguePort {
  if (options.clock !== undefined && options.now !== undefined)
    throw new TypeError("p0_implementation_clock_ambiguous");
  const clock = options.clock ?? options.now ?? (() => new Date());
  return Object.freeze({
    async list(): Promise<ImplementationFactCatalogueSnapshot> {
      const clockValue = clock();
      const effectiveAt =
        clockValue instanceof Date ? clockValue : new Date(clockValue);
      if (!Number.isFinite(effectiveAt.getTime()))
        throw new TypeError("p0_implementation_clock_invalid");
      const snapshotEffectiveAt = effectiveAt.toISOString();
      const records: P0ImplementationFact[] = [];
      let cursor: string | undefined;
      for (
        let page = 0;
        page < Math.ceil(MAX_FACTS / DATABASE_PAGE_SIZE);
        page += 1
      ) {
        const result = await store.search({
          limit: DATABASE_PAGE_SIZE,
          effective_at: snapshotEffectiveAt,
          ...(cursor === undefined ? {} : { cursor }),
        });
        records.push(...result.facts);
        if (records.length > MAX_FACTS)
          throw new Error("implementation_fact_catalogue_too_many_rows");
        if (!result.has_more) break;
        if (result.next_cursor === undefined)
          throw new Error("implementation_fact_catalogue_missing_cursor");
        if (result.next_cursor === cursor)
          throw new Error("implementation_fact_catalogue_cursor_stalled");
        cursor = result.next_cursor;
        if (page === Math.ceil(MAX_FACTS / DATABASE_PAGE_SIZE) - 1)
          throw new Error("implementation_fact_catalogue_too_many_rows");
      }
      const facts = records.map(mapRecordToCard);
      return normalizeImplementationFactSnapshot({
        status: "ready",
        updated_at: null,
        facts,
      });
    },
    async reportCorrection(
      input: ImplementationFactCorrectionInput,
    ): Promise<ImplementationFactCorrectionResult> {
      const result = await store.reportCorrection({
        fact_id: input.fact_key,
        correction_id: `consumer_alpha_fact_${input.fact_key}`,
        reason: `category:${input.category}`,
      });
      return correctionSuccess(input, result);
    },
  });
}

export const createPostgresImplementationCataloguePort =
  createPostgresImplementationFactCataloguePort;

/** Normalize a browser-safe injected port or reduce a generic DB store. */
export function adaptImplementationFactBackend(
  backend: ImplementationFactBackend,
): ImplementationFactCataloguePort {
  if (isPostgresStore(backend))
    return createPostgresImplementationFactCataloguePort(backend);
  return Object.freeze({
    async list(): Promise<ImplementationFactCatalogueSnapshot> {
      return normalizeImplementationFactSnapshot(await backend.list());
    },
    async reportCorrection(
      input: ImplementationFactCorrectionInput,
    ): Promise<ImplementationFactCorrectionResult> {
      const result = await backend.reportCorrection(input);
      if (
        result.ok !== true ||
        result.fact_key !== input.fact_key ||
        result.category !== input.category ||
        (result.outcome !== "recorded" && result.outcome !== "duplicate")
      )
        throw new TypeError("implementation_fact_correction_result_invalid");
      return Object.freeze(result);
    },
  });
}

export const createImplementationFactCataloguePort =
  adaptImplementationFactBackend;

interface FixtureState {
  readonly cards: readonly ImplementationFactCard[];
  readonly updated_at: string;
  readonly corrected: Map<
    string,
    ImplementationFactCorrectionInput["category"]
  >;
}

function createFixturePort(
  documents: readonly FixtureDocument[],
): ImplementationFactCataloguePort {
  const cards = Object.freeze(
    documents.flatMap((document) => fixtureCards(document)),
  );
  if (cards.length < 1)
    throw new Error("implementation_fixture_fact_count_invalid");
  const updatedAt = documents
    .map((document) => document.as_of)
    .sort()
    .at(-1);
  if (updatedAt === undefined)
    throw new Error("implementation_fixture_as_of_missing");
  const state: FixtureState = {
    cards,
    updated_at: updatedAt,
    corrected: new Map(),
  };
  return Object.freeze({
    async list(): Promise<ImplementationFactCatalogueSnapshot> {
      const facts = state.cards.filter(
        (card) => !state.corrected.has(card.fact_key),
      );
      return normalizeImplementationFactSnapshot({
        status: "partial",
        updated_at: state.updated_at,
        facts,
      });
    },
    async reportCorrection(
      input: ImplementationFactCorrectionInput,
    ): Promise<ImplementationFactCorrectionResult> {
      if (
        !(
          IMPLEMENTATION_FACT_CORRECTION_CATEGORIES as readonly string[]
        ).includes(input.category)
      )
        throw new TypeError("implementation_fact_correction_category_invalid");
      const card = state.cards.find(
        (candidate) => candidate.fact_key === input.fact_key,
      );
      if (!card)
        return Object.freeze({ ok: false as const, code: "fact_not_found" });
      const previous = state.corrected.get(input.fact_key);
      if (previous !== undefined) {
        if (previous === input.category)
          return Object.freeze({
            ok: true as const,
            fact_key: input.fact_key,
            category: input.category,
            outcome: "duplicate" as const,
          });
        return Object.freeze({ ok: false as const, code: "fact_not_active" });
      }
      state.corrected.set(input.fact_key, input.category);
      return Object.freeze({
        ok: true as const,
        fact_key: input.fact_key,
        category: input.category,
        outcome: "recorded" as const,
      });
    },
  });
}

let defaultPortPromise: Promise<ImplementationFactCataloguePort> | undefined;

export function getDefaultImplementationFactCataloguePort(): ImplementationFactCataloguePort {
  if (defaultPortPromise === undefined) {
    defaultPortPromise = Promise.all(
      IMPLEMENTATION_FIXTURES.map(async (fixture) =>
        fixtureDocument(
          JSON.parse(
            await fs.readFile(new URL(fixture, import.meta.url), "utf8"),
          ),
        ),
      ),
    ).then(createFixturePort);
  }
  const portPromise = defaultPortPromise;
  // The promise is intentionally hidden behind the port so the app's normal
  // dependency shape remains synchronous to construct.
  return Object.freeze({
    async list() {
      return (await portPromise).list();
    },
    async reportCorrection(input: ImplementationFactCorrectionInput) {
      return (await portPromise).reportCorrection(input);
    },
  });
}

/** Reset only the volatile fixture correction state used by tests/sessions. */
export function resetImplementationFactCatalogue(): void {
  defaultPortPromise = undefined;
}
