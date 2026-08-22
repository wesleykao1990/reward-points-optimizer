import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import type {
  P0FactInfluenceGraphFact,
  P0FactInfluenceGraphSnapshot,
  P0FactInfluenceGraphStore,
} from "@jro/agent-feed-postgres";
import { P0_FACT_INFLUENCE_GRAPH_FACT_COUNT } from "@jro/agent-feed-postgres";
import { NANACO_CREDIT_CHARGE_CLAIM_IDS } from "@jro/provisional-rules";
import {
  localizeImplementationPredicate,
  localizeImplementationSubject,
  localizeImplementationSummary,
} from "./implementation-localization.js";

export const FACT_INFLUENCE_GRAPH_VERSION =
  "p0-fact-influence-graph.v1" as const;
export const FACT_INFLUENCE_GRAPH_SOURCE_VERSION =
  "p0-fact-influence-graph-source.v1" as const;
export const MAX_FACT_INFLUENCE_FACTORS = 96 as const;
/** Host-owned claim bindings; these are never copied into the browser DTO. */
export const FACT_INFLUENCE_VERIFIED_APPLIED_PARENT_CLAIMS = Object.freeze({
  nanaco_purchase: "claim.point.nanaco.earn.shopping-immediate.004",
  nanaco_credit_charge: NANACO_CREDIT_CHARGE_CLAIM_IDS[0],
} as const);

export const FACT_INFLUENCE_KINDS = Object.freeze([
  "calculation_input",
  "eligibility_constraint",
  "timing_validity",
  "acceptance",
  "campaign",
  "advisory_unknown",
] as const);
export type FactInfluenceKind = (typeof FACT_INFLUENCE_KINDS)[number];

/** Host-only graph node.  The raw fact is deliberately not part of any
 * browser DTO; it exists solely for deterministic context matching. */
export interface FactInfluenceNode {
  readonly factor_id: string;
  readonly graph_order: string;
  readonly kind: FactInfluenceKind;
  readonly family_id: string;
  readonly claim_type: string;
  readonly subject: string;
  readonly predicate: string;
  readonly summary: string;
  readonly question: string | null;
  readonly warning: string | null;
  readonly active: boolean;
  readonly corrected: boolean;
  readonly rankable: boolean;
  readonly raw: P0FactInfluenceGraphFact;
}

export interface FactInfluenceGraph {
  readonly version: typeof FACT_INFLUENCE_GRAPH_VERSION;
  readonly effective_at: string;
  readonly graph_hash: `sha256:${string}`;
  readonly fact_count: number;
  readonly active_count: number;
  readonly rankable_count: number;
  readonly nodes: readonly FactInfluenceNode[];
}

export interface FactInfluenceGraphContext {
  readonly merchant_id: string;
  readonly payment_method?: string;
  readonly family_ids?: readonly string[];
}

export interface FactInfluenceBrowserFactor {
  readonly factor_id: string;
  readonly family: string;
  readonly claim: string;
  readonly influence_kind: FactInfluenceKind;
  readonly active: boolean;
  readonly corrected: boolean;
  readonly applied: boolean;
  readonly summary: string;
  readonly question: string | null;
  readonly warning: string | null;
}

export interface FactInfluenceBrowserView {
  readonly version: typeof FACT_INFLUENCE_GRAPH_VERSION;
  readonly fact_count: number;
  readonly active_count: number;
  readonly relevant_count: number;
  readonly applied_count: number;
  readonly unresolved_count: number;
  readonly relevant_factor_ids: readonly string[];
  readonly applied_factor_ids: readonly string[];
  readonly unresolved_conditions: readonly string[];
  readonly factors: readonly FactInfluenceBrowserFactor[];
}

export interface FactInfluenceGraphPort {
  readonly load: (effectiveAt?: string) => Promise<FactInfluenceGraph>;
}

export type FactInfluenceGraphBackend =
  | P0FactInfluenceGraphStore
  | FactInfluenceGraphPort;

type JsonRecord = Record<string, unknown>;

const FAMILY_LABELS: Readonly<Record<string, string>> = Object.freeze({
  "point.d": "dポイント",
  "point.jre": "JRE POINT",
  "point.nanaco": "nanacoポイント",
  "point.paypay": "PayPayポイント",
  "point.ponta": "Pontaポイント",
  "point.rakuten": "楽天ポイント",
  "point.v": "Vポイント",
  "point.waon": "WAON POINT",
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

const CALCULATION_CLAIMS = new Set([
  "earn_rule",
  "rounding",
  "redemption_value",
  "redemption_rule",
  "transfer_rule",
  "wallet_bonus",
  "program_bonus",
  "annual_spend_bonus",
]);
const ELIGIBILITY_CLAIMS = new Set([
  "eligibility",
  "eligibility_and_exclusion",
  "exclusion",
  "funding_rule",
  "funding_limit",
  "funding_fee",
  "fee_rule",
]);
const TIMING_CLAIMS = new Set([
  "timing",
  "timing_and_exclusion",
  "timing_and_cap",
  "expiry_rule",
  "expiry_and_redemption_priority",
  "expiry_and_reward_classes",
  "campaign_expiry",
  "program_term",
  "change_notice",
]);
const CLAIM_ID_PATTERN = /^claim\.[A-Za-z0-9._:-]{1,240}$/u;
const UNSAFE_PUBLIC_TEXT_PATTERN =
  /https?:\/\/|www\.|sha256:|claim\.|source[_-]?(?:id|url)|evidence[_-]?locator/iu;
const VERIFIED_APPLIED_PARENT_CLAIMS = new Set<string>(
  Object.values(FACT_INFLUENCE_VERIFIED_APPLIED_PARENT_CLAIMS),
);

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  const record = value as JsonRecord;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function hash(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function displayFamily(value: string): string {
  return FAMILY_LABELS[value] ?? "ポイント情報";
}

function displayClaim(value: string): string {
  return CLAIM_LABELS[value] ?? "その他の条件";
}

function localDateFor(value: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) throw new Error("fact_influence_date_invalid");
  return `${year}-${month}-${day}`;
}

function activeAt(fact: P0FactInfluenceGraphFact, timestamp: string): boolean {
  const applicability = fact.applicability;
  if (!isRecord(applicability)) return false;
  const hasBounds =
    fact.claim_type === "campaign_period" ||
    fact.reason === "ended_or_future_inactive" ||
    Object.hasOwn(applicability, "effective_from") ||
    Object.hasOwn(applicability, "effective_to");
  if (!hasBounds) return true;
  if (applicability.timezone !== "Asia/Tokyo") return false;
  const from = applicability.effective_from;
  const to = applicability.effective_to;
  const hasFrom = from !== null && from !== undefined;
  const hasTo = to !== null && to !== undefined;
  if (!hasFrom && !hasTo) return fact.reason !== "ended_or_future_inactive";
  if (
    (hasFrom && typeof from !== "string") ||
    (hasTo && typeof to !== "string")
  )
    return false;
  if (
    (hasFrom && !/^\d{4}-\d{2}-\d{2}$/u.test(from as string)) ||
    (hasTo && !/^\d{4}-\d{2}-\d{2}$/u.test(to as string))
  )
    return false;
  const fromDate = hasFrom
    ? new Date(`${from as string}T00:00:00+09:00`)
    : null;
  const toDate = hasTo ? new Date(`${to as string}T23:59:59.999+09:00`) : null;
  const effectiveDate = new Date(timestamp);
  if (
    (fromDate !== null && !Number.isFinite(fromDate.getTime())) ||
    (toDate !== null && !Number.isFinite(toDate.getTime())) ||
    !Number.isFinite(effectiveDate.getTime()) ||
    (hasFrom && hasTo && (from as string) > (to as string))
  )
    return false;
  const localDate = localDateFor(effectiveDate);
  return (
    (!hasFrom || localDate >= (from as string)) &&
    (!hasTo || localDate <= (to as string))
  );
}

export function classifyFactInfluence(
  fact: Pick<
    P0FactInfluenceGraphFact,
    "claim_type" | "predicate" | "disposition" | "derived_rule_ids"
  >,
): FactInfluenceKind {
  const claim = fact.claim_type;
  const predicate = fact.predicate.toLocaleLowerCase("en-US");
  if (fact.disposition === "engine_rule" && fact.derived_rule_ids.length > 0)
    return "calculation_input";
  if (claim.startsWith("campaign_") || claim === "campaign_rule")
    return "campaign";
  if (
    claim === "merchant_acceptance" ||
    predicate.includes("accept") ||
    predicate.includes("tender") ||
    predicate.includes("payment_method")
  )
    return "acceptance";
  if (TIMING_CLAIMS.has(claim)) return "timing_validity";
  if (ELIGIBILITY_CLAIMS.has(claim)) return "eligibility_constraint";
  if (CALCULATION_CLAIMS.has(claim)) return "advisory_unknown";
  return "advisory_unknown";
}

function nodeText(
  fact: P0FactInfluenceGraphFact,
  kind: FactInfluenceKind,
  active: boolean,
): { readonly question: string | null; readonly warning: string | null } {
  if (fact.corrected)
    return {
      question: null,
      warning: "訂正済みのため、この情報は判定に使っていません。",
    };
  if (!active)
    return {
      question: "この情報の適用期間を確認できますか？",
      warning: "適用期間外のため、現在の判定には使っていません。",
    };
  if (
    fact.reason === "insufficient_operation_mapping" ||
    fact.reason === "unsupported_calculation_model"
  )
    return {
      question: "この条件を公式情報で確認できますか？",
      warning: "現在の計算モデルでは数値計算に使えない情報です。",
    };
  if (kind === "calculation_input") return { question: null, warning: null };
  if (fact.reason === "explicit_no_rate")
    return {
      question: "この支払いに特典が付かない条件を確認しますか？",
      warning: "明示的に還元対象外と記載された情報です。",
    };
  if (kind === "advisory_unknown")
    return {
      question: "この条件が今回の支払いに当てはまるか確認できますか？",
      warning: "参考情報として表示しています。特典額は推定していません。",
    };
  return { question: null, warning: null };
}

function publicSubject(subject: string): string {
  const localized = localizeImplementationSubject(subject);
  if (
    localized === "このサービス" ||
    localized === subject ||
    UNSAFE_PUBLIC_TEXT_PATTERN.test(localized)
  )
    return "このサービス";
  return localized;
}

function publicSummary(
  summary: string,
  subject: string,
  claim: string,
  family: string,
): string {
  const localized = localizeImplementationSummary(
    summary,
    subject,
    claim,
    family,
  );
  return UNSAFE_PUBLIC_TEXT_PATTERN.test(localized)
    ? `「このサービス」の${family}・${claim}に関する情報です。`
    : localized;
}

function graphNode(
  fact: P0FactInfluenceGraphFact,
  timestamp: string,
): FactInfluenceNode {
  const active = fact.active_at && activeAt(fact, timestamp);
  const kind = classifyFactInfluence(fact);
  const family = displayFamily(fact.family_id);
  const claim = displayClaim(fact.claim_type);
  const subject = publicSubject(fact.subject);
  const summary = publicSummary(fact.short_paraphrase, subject, claim, family);
  const text = nodeText(fact, kind, active);
  const identity = `${fact.implementation_hash}\u0000${fact.parent_claim_id}\u0000${fact.fact_version}`;
  return Object.freeze({
    factor_id: `factor_${hash(identity).slice(7, 39)}`,
    graph_order: fact.graph_order,
    kind,
    family_id: fact.family_id,
    claim_type: fact.claim_type,
    subject,
    predicate: localizeImplementationPredicate(fact.predicate),
    summary,
    question: text.question,
    warning: text.warning,
    active,
    corrected: fact.corrected,
    rankable: active && !fact.corrected && kind === "calculation_input",
    raw: fact,
  });
}

export function buildFactInfluenceGraph(
  facts: readonly P0FactInfluenceGraphFact[],
  effectiveAt: string,
): FactInfluenceGraph {
  const timestamp = new Date(effectiveAt);
  if (!Number.isFinite(timestamp.getTime()))
    throw new TypeError("fact_influence_effective_at_invalid");
  const nodes = facts.map((fact) => graphNode(fact, timestamp.toISOString()));
  nodes.sort((left, right) =>
    left.graph_order < right.graph_order
      ? -1
      : left.graph_order > right.graph_order
        ? 1
        : 0,
  );
  const seen = new Set<string>();
  for (const node of nodes) {
    if (seen.has(node.factor_id))
      throw new Error("fact_influence_duplicate_factor_id");
    seen.add(node.factor_id);
  }
  const canonicalNodes = nodes.map((node) => ({
    factor_id: node.factor_id,
    graph_order: node.graph_order,
    kind: node.kind,
    active: node.active,
    corrected: node.corrected,
    rankable: node.rankable,
  }));
  return Object.freeze({
    version: FACT_INFLUENCE_GRAPH_VERSION,
    effective_at: timestamp.toISOString(),
    graph_hash: hash(canonicalJson(canonicalNodes)),
    fact_count: nodes.length,
    active_count: nodes.filter((node) => node.active && !node.corrected).length,
    rankable_count: nodes.filter((node) => node.rankable).length,
    nodes: Object.freeze(nodes),
  });
}

function contextTokens(
  context: FactInfluenceGraphContext,
): ReadonlySet<string> {
  const tokens = new Set<string>(context.family_ids ?? []);
  const merchant = context.merchant_id.toLocaleLowerCase("en-US");
  const payment = context.payment_method?.toLocaleLowerCase("en-US");
  if (merchant.includes("seveneleven") || merchant.includes("7eleven")) {
    tokens.add("merchant.7eleven");
    tokens.add("merchant.seveneleven");
    tokens.add("point.nanaco");
    tokens.add("emoney.nanaco");
  }
  if (merchant === "merchant.synthetic") tokens.add("merchant.synthetic");
  if (payment === "nanaco") {
    tokens.add("point.nanaco");
    tokens.add("emoney.nanaco");
  }
  if (payment === "seven_card_plus") {
    tokens.add("point.nanaco");
    tokens.add("emoney.nanaco");
    tokens.add("card.seven-card-plus");
  }
  return tokens;
}

function relevantNodes(
  graph: FactInfluenceGraph,
  context: FactInfluenceGraphContext,
  appliedParentClaimIds: ReadonlySet<string>,
): readonly FactInfluenceNode[] {
  const tokens = contextTokens(context);
  const matched = graph.nodes.filter(
    (node) =>
      tokens.has(node.family_id) ||
      appliedParentClaimIds.has(node.raw.parent_claim_id),
  );
  const applied = matched.filter((node) =>
    appliedParentClaimIds.has(node.raw.parent_claim_id),
  );
  const related = matched.filter(
    (node) => !appliedParentClaimIds.has(node.raw.parent_claim_id),
  );
  return Object.freeze(
    [...applied, ...related].slice(0, MAX_FACT_INFLUENCE_FACTORS),
  );
}

function browserFactor(
  node: FactInfluenceNode,
  applied: boolean,
): FactInfluenceBrowserFactor {
  return Object.freeze({
    factor_id: node.factor_id,
    family: displayFamily(node.family_id),
    claim: displayClaim(node.claim_type),
    influence_kind: node.kind,
    active: node.active && !node.corrected,
    corrected: node.corrected,
    applied,
    summary: node.summary,
    question: node.question,
    warning: node.warning,
  });
}

/** Reduce a complete graph to the bounded Japanese DTO used by a result. */
export function projectFactInfluenceForRecommendation(
  graph: FactInfluenceGraph,
  context: FactInfluenceGraphContext,
  appliedParentClaimIds: readonly string[] = [],
): FactInfluenceBrowserView {
  if (
    graph.fact_count !== P0_FACT_INFLUENCE_GRAPH_FACT_COUNT ||
    graph.nodes.length !== P0_FACT_INFLUENCE_GRAPH_FACT_COUNT
  )
    throw new Error("fact_influence_graph_count_invalid");
  const appliedClaims = new Set<string>();
  for (const claimId of appliedParentClaimIds) {
    if (
      typeof claimId !== "string" ||
      !CLAIM_ID_PATTERN.test(claimId) ||
      !VERIFIED_APPLIED_PARENT_CLAIMS.has(claimId)
    )
      throw new Error("fact_influence_applied_claim_invalid");
    appliedClaims.add(claimId);
  }
  const appliedNodes = new Map<string, FactInfluenceNode>();
  for (const claimId of appliedClaims) {
    const matches = graph.nodes.filter(
      (node) => node.raw.parent_claim_id === claimId,
    );
    const activeMatches = matches.filter(
      (node) => node.active && !node.corrected,
    );
    if (matches.length === 0)
      throw new Error("fact_influence_applied_claim_missing");
    if (activeMatches.length !== 1)
      throw new Error("fact_influence_applied_claim_unavailable");
    const node = activeMatches[0];
    if (node === undefined)
      throw new Error("fact_influence_applied_claim_missing");
    appliedNodes.set(node.factor_id, node);
  }
  const nodes = relevantNodes(graph, context, appliedClaims);
  const relevantFactorIds = nodes.map((node) => node.factor_id);
  const applied = nodes.filter((node) => appliedNodes.has(node.factor_id));
  const appliedFactorIds = applied.map((node) => node.factor_id);
  const unresolvedConditions = [
    ...new Set(
      nodes
        .filter(
          (node) =>
            !appliedNodes.has(node.factor_id) &&
            (node.question !== null || node.warning !== null),
        )
        .flatMap((node) => [node.question, node.warning])
        .filter((value): value is string => value !== null),
    ),
  ].slice(0, 24);
  return Object.freeze({
    version: FACT_INFLUENCE_GRAPH_VERSION,
    fact_count: graph.fact_count,
    active_count: graph.active_count,
    relevant_count: nodes.length,
    applied_count: applied.length,
    unresolved_count: unresolvedConditions.length,
    relevant_factor_ids: Object.freeze(relevantFactorIds),
    applied_factor_ids: Object.freeze(appliedFactorIds),
    unresolved_conditions: Object.freeze(unresolvedConditions),
    factors: Object.freeze(
      nodes.map((node) =>
        browserFactor(node, appliedNodes.has(node.factor_id)),
      ),
    ),
  });
}

function sourceFacts(
  value: P0FactInfluenceGraphSnapshot,
): readonly P0FactInfluenceGraphFact[] {
  if (
    !value ||
    value.version !== FACT_INFLUENCE_GRAPH_SOURCE_VERSION ||
    value.fact_count !== P0_FACT_INFLUENCE_GRAPH_FACT_COUNT ||
    !Array.isArray(value.facts) ||
    value.facts.length !== P0_FACT_INFLUENCE_GRAPH_FACT_COUNT
  )
    throw new TypeError("fact_influence_graph_source_invalid");
  return value.facts;
}

export function createFactInfluenceGraphPort(
  backend: FactInfluenceGraphBackend,
): FactInfluenceGraphPort {
  if ("load" in backend && typeof backend.load === "function") return backend;
  const store = backend as P0FactInfluenceGraphStore;
  return Object.freeze({
    async load(effectiveAt?: string): Promise<FactInfluenceGraph> {
      const snapshot = await store.list(effectiveAt);
      const facts = sourceFacts(snapshot);
      return buildFactInfluenceGraph(facts, snapshot.effective_at);
    },
  });
}

const FIXTURE_FILES = Object.freeze([
  "p0-point-rules-a.implementation.v0.1.json",
  "p0-point-rules-b.implementation.v0.4.json",
  "p0-wallet-card-rules.implementation.v0.5.json",
  "p0-merchant-transit-regulatory-rules.implementation.v0.6.json",
] as const);
const FIXTURE_ROOT = "../../../fixtures/m3/provisional/";

interface FixtureDocument {
  readonly version: string;
  readonly implementation_hash: string;
  readonly entries: readonly JsonRecord[];
}

function fixtureFact(
  document: FixtureDocument,
  entry: JsonRecord,
): P0FactInfluenceGraphFact {
  const parentClaimId = entry.parent_claim_id;
  if (typeof parentClaimId !== "string")
    throw new Error("fact_influence_fixture_invalid");
  const implementationHash = document.implementation_hash;
  if (typeof implementationHash !== "string")
    throw new Error("fact_influence_fixture_invalid");
  const clone = structuredClone(entry) as JsonRecord;
  return {
    graph_order: `${implementationHash}:${parentClaimId}:v0001`,
    fact_id: `00000000-0000-4000-8000-${hash(`${implementationHash}:${parentClaimId}`).slice(-12)}`,
    implementation_version: document.version,
    implementation_hash: implementationHash,
    fact_version: 1,
    parent_claim_id: parentClaimId,
    family_id: String(clone.family_id),
    source_role_id: String(clone.source_role_id),
    source_ids: Object.freeze([...(clone.source_ids as string[])]),
    source_identity: clone.source_identity,
    claim_type: String(clone.claim_type),
    subject: String(clone.subject),
    predicate: String(clone.predicate),
    value: clone.value,
    applicability: clone.applicability,
    exclusions: clone.exclusions,
    evidence_locator: String(clone.evidence_locator),
    short_paraphrase: String(clone.short_paraphrase),
    disposition:
      clone.disposition === "engine_rule" ? "engine_rule" : "catalogue_fact",
    derived_rule_ids: Object.freeze([...(clone.derived_rule_ids as string[])]),
    reason: String(clone.reason),
    reason_detail: String(clone.reason_detail),
    fact_payload: clone,
    active_at: true,
    corrected: false,
  };
}

let fixturePromise: Promise<readonly P0FactInfluenceGraphFact[]> | undefined;

async function loadFixtureFacts(): Promise<
  readonly P0FactInfluenceGraphFact[]
> {
  if (fixturePromise === undefined) {
    fixturePromise = Promise.all(
      FIXTURE_FILES.map(async (file) => {
        const value = JSON.parse(
          await fs.readFile(
            new URL(`${FIXTURE_ROOT}${file}`, import.meta.url),
            "utf8",
          ),
        ) as FixtureDocument;
        return value.entries.map((entry) => fixtureFact(value, entry));
      }),
    ).then((documents) => {
      const facts = documents.flat();
      if (facts.length !== P0_FACT_INFLUENCE_GRAPH_FACT_COUNT)
        throw new Error("fact_influence_fixture_count_invalid");
      return Object.freeze(facts);
    });
  }
  return fixturePromise;
}

/** The no-database localhost port still builds the complete 364-node graph. */
export function getDefaultFactInfluenceGraphPort(): FactInfluenceGraphPort {
  return Object.freeze({
    async load(
      effectiveAt = new Date().toISOString(),
    ): Promise<FactInfluenceGraph> {
      const facts = await loadFixtureFacts();
      return buildFactInfluenceGraph(facts, effectiveAt);
    },
  });
}

export const getDefaultP0FactInfluenceGraphPort =
  getDefaultFactInfluenceGraphPort;
