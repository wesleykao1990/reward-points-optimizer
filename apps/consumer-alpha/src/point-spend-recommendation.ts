import { promises as fs } from "node:fs";

import {
  compileP0SpendRuleSet,
  type P0SpendAsset,
  type P0SpendRule,
  type P0SpendRuleSet,
} from "@jro/provisional-rules";
import {
  optimizePointSpend,
  type PointSpendEdge,
  type PointSpendObjective,
} from "@jro/rule-engine";
import { P0_PRODUCT_FAMILY_IDS, type P0ProductFamilyId } from "./contracts.js";

const RESEARCH_FILES = Object.freeze([
  "p0-point-rules-a.research.v0.1.json",
  "p0-point-rules-b.research.v0.1.json",
  "p0-wallet-card-rules.research.v0.1.json",
  "p0-merchant-transit-regulatory-rules.research.v0.1.json",
] as const);

export const MAX_POINT_SPEND_BODY_BYTES = 4_096;

export interface PointSpendBrowserInput {
  readonly source_asset_id: string;
  readonly target_asset_id: string;
  readonly balance: number;
  readonly objective: PointSpendObjective;
  readonly effective_at: string;
  readonly confirmed_rule_ids: readonly string[];
}

export interface PointSpendBrowserAsset {
  readonly asset_id: string;
  readonly label: string;
  readonly kind: string;
}

export type P0WalletCatalogueKind = "point" | "mobile_pay" | "credit_card";

export interface P0WalletCatalogueItem {
  readonly family_id: string;
  readonly label: string;
  readonly kind: P0WalletCatalogueKind;
  readonly fact_count: number;
  readonly calculation_status: "spend_route" | "information_only";
}

export interface P0LotteryBrowserLink {
  readonly title: string;
  readonly family: string;
  readonly status: "application_or_details" | "official_announcement";
  readonly period_label: string;
  readonly official_url: string;
}

export interface PointSpendBrowserStep {
  readonly label: string;
  readonly source_label: string;
  readonly destination_label: string;
  readonly source_amount: string;
  readonly destination_amount: string;
  readonly processing_days: string;
}

export interface PointSpendBrowserRoute {
  readonly recommendation_id: string;
  readonly target_amount: string;
  readonly target_label: string;
  readonly residual_source_amount: string;
  readonly processing_days: string;
  readonly steps: readonly PointSpendBrowserStep[];
}

export interface PointSpendBrowserResult {
  readonly version: "p0-point-spend-browser.v1";
  readonly status: "ready" | "no_route";
  readonly experimental: true;
  readonly current_advice: false;
  readonly objective: PointSpendObjective;
  readonly winner: PointSpendBrowserRoute | null;
  readonly alternatives: readonly PointSpendBrowserRoute[];
  readonly message: string;
  readonly rule_count: number;
}

type JsonRecord = Record<string, unknown>;

const REQUEST_KEYS = Object.freeze([
  "source_asset_id",
  "target_asset_id",
  "balance",
  "objective",
  "effective_at",
  "confirmed_rule_ids",
] as const);

function parseRecord(value: unknown): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("point_spend_request_invalid");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Object.keys(descriptors).sort();
  const expected = [...REQUEST_KEYS].sort();
  if (
    keys.length !== expected.length ||
    keys.some((key, index) => key !== expected[index]) ||
    Object.getOwnPropertySymbols(value).length > 0
  )
    throw new TypeError("point_spend_request_invalid");
  const output = Object.create(null) as JsonRecord;
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (
      !descriptor ||
      descriptor.enumerable !== true ||
      !("value" in descriptor)
    )
      throw new TypeError("point_spend_request_invalid");
    output[key] = descriptor.value;
  }
  return output;
}

function canonicalDateTime(value: string): boolean {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{3})?(?:Z|[+-](\d{2}):(\d{2}))$/u.exec(
      value,
    );
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return (
    year >= 1970 &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= (days[month - 1] ?? 0) &&
    Number(match[4]) <= 23 &&
    Number(match[5]) <= 59 &&
    Number(match[6]) <= 59 &&
    (match[7] === undefined || Number(match[7]) <= 23) &&
    (match[8] === undefined || Number(match[8]) <= 59) &&
    Number.isFinite(Date.parse(value))
  );
}

export function parsePointSpendBrowserInput(
  value: unknown,
): PointSpendBrowserInput {
  const record = parseRecord(value);
  const source = record.source_asset_id;
  const target = record.target_asset_id;
  const balance = record.balance;
  const objective = record.objective;
  const effectiveAt = record.effective_at;
  const confirmed = record.confirmed_rule_ids;
  if (
    typeof source !== "string" ||
    !/^asset\.[a-z0-9.-]{2,80}$/u.test(source) ||
    typeof target !== "string" ||
    !/^asset\.[a-z0-9.-]{2,80}$/u.test(target) ||
    source === target ||
    !Number.isSafeInteger(balance) ||
    Number(balance) < 1 ||
    Number(balance) > 1_000_000_000 ||
    !(["maximize_target", "fastest", "preserve_expiring"] as const).includes(
      objective as PointSpendObjective,
    ) ||
    typeof effectiveAt !== "string" ||
    !canonicalDateTime(effectiveAt) ||
    !Array.isArray(confirmed) ||
    confirmed.length > 32 ||
    !confirmed.every(
      (item) =>
        typeof item === "string" && /^p0\.[a-z0-9.-]{2,100}$/u.test(item),
    )
  )
    throw new TypeError("point_spend_request_invalid");
  return {
    source_asset_id: source,
    target_asset_id: target,
    balance: Number(balance),
    objective: objective as PointSpendObjective,
    effective_at: effectiveAt,
    confirmed_rule_ids: Object.freeze([...confirmed].sort()),
  };
}

const P0_WALLET_FAMILIES: Readonly<
  Record<
    P0ProductFamilyId,
    { readonly label: string; readonly kind: P0WalletCatalogueKind }
  >
> = Object.freeze({
  "point.d": { label: "dポイント", kind: "point" },
  "point.jre": { label: "JRE POINT", kind: "point" },
  "point.nanaco": { label: "nanacoポイント", kind: "point" },
  "point.paypay": { label: "PayPayポイント", kind: "point" },
  "point.ponta": { label: "Pontaポイント", kind: "point" },
  "point.rakuten": { label: "楽天ポイント", kind: "point" },
  "point.v": { label: "Vポイント", kind: "point" },
  "point.waon": { label: "WAON POINT", kind: "point" },
  "wallet.aeonpay": { label: "AEON Pay", kind: "mobile_pay" },
  "wallet.aupay": { label: "au PAY", kind: "mobile_pay" },
  "wallet.dbarai": { label: "d払い", kind: "mobile_pay" },
  "wallet.famipay": { label: "ファミペイ", kind: "mobile_pay" },
  "wallet.paypay": { label: "PayPay", kind: "mobile_pay" },
  "wallet.rakutenpay": { label: "楽天ペイ", kind: "mobile_pay" },
  "card.aeon": { label: "イオンカード", kind: "credit_card" },
  "card.aupay": { label: "au PAYカード", kind: "credit_card" },
  "card.d": { label: "dカード", kind: "credit_card" },
  "card.paypay": { label: "PayPayカード", kind: "credit_card" },
  "card.rakuten": { label: "楽天カード", kind: "credit_card" },
  "card.smbc": { label: "三井住友カード", kind: "credit_card" },
  "card.view": { label: "ビューカード", kind: "credit_card" },
});

if (Object.keys(P0_WALLET_FAMILIES).length !== P0_PRODUCT_FAMILY_IDS.length)
  throw new Error("p0_wallet_family_catalogue_incomplete");

function isP0ProductFamilyId(value: string): value is P0ProductFamilyId {
  return (P0_PRODUCT_FAMILY_IDS as readonly string[]).includes(value);
}

const LOTTERY_FAMILY_LABELS: Readonly<Record<string, string>> = Object.freeze({
  ...Object.fromEntries(
    Object.entries(P0_WALLET_FAMILIES).map(([id, value]) => [id, value.label]),
  ),
  "emoney.nanaco": "nanaco電子マネー",
  "emoney.waon": "WAON電子マネー",
  "merchant.newdays": "NewDays",
});

interface P0ResearchSource {
  readonly source_id: string;
  readonly url: string;
  readonly official_domain: string;
}

interface P0ResearchClaim {
  readonly family_id: string;
  readonly predicate: string;
  readonly subject: string;
  readonly short_paraphrase: string;
  readonly source_ids: readonly string[];
  readonly applicability: JsonRecord;
}

interface P0ResearchArtifact {
  readonly claims: readonly P0ResearchClaim[];
  readonly sources: readonly P0ResearchSource[];
}

interface PointSpendBundle {
  readonly ruleSet: P0SpendRuleSet;
  readonly artifacts: readonly P0ResearchArtifact[];
}

let bundlePromise: Promise<PointSpendBundle> | undefined;

function researchArtifacts(value: unknown[]): readonly P0ResearchArtifact[] {
  return value.map((artifact) => {
    if (!artifact || typeof artifact !== "object" || Array.isArray(artifact))
      throw new TypeError("p0_research_artifact_invalid");
    const record = artifact as JsonRecord;
    if (!Array.isArray(record.claims) || !Array.isArray(record.sources))
      throw new TypeError("p0_research_artifact_invalid");
    return record as unknown as P0ResearchArtifact;
  });
}

async function loadBundle(): Promise<PointSpendBundle> {
  if (!bundlePromise) {
    bundlePromise = Promise.all(
      RESEARCH_FILES.map(async (name) =>
        JSON.parse(
          await fs.readFile(
            new URL(`../../../fixtures/m3/agent-feed/${name}`, import.meta.url),
            "utf8",
          ),
        ),
      ),
    ).then((rawArtifacts) => ({
      ruleSet: compileP0SpendRuleSet(rawArtifacts),
      artifacts: researchArtifacts(rawArtifacts),
    }));
  }
  return bundlePromise;
}

async function loadRuleSet(): Promise<P0SpendRuleSet> {
  return (await loadBundle()).ruleSet;
}

function engineAsset(asset: P0SpendAsset): PointSpendEdge["source_asset"] {
  return {
    asset_id: asset.asset_id,
    asset_kind: asset.asset_kind,
    program_id: asset.program_id,
    reward_class: asset.reward_class,
    scale: asset.scale,
  };
}

function edge(rule: P0SpendRule): PointSpendEdge {
  return {
    rule_id: rule.rule_id,
    label_ja: rule.label_ja,
    source_claim_ids: rule.source_claim_ids,
    source_asset: engineAsset(rule.source_asset),
    destination_asset: engineAsset(rule.destination_asset),
    source_units: rule.source_units,
    destination_units: rule.destination_units,
    minimum_source_units: rule.minimum_source_units,
    increment_source_units: rule.increment_source_units,
    maximum_source_units_per_request: rule.maximum_source_units_per_request,
    maximum_source_units_per_period: rule.maximum_source_units_per_period,
    maximum_period: rule.maximum_period,
    fee_source_units: rule.fee_source_units,
    processing_time_days_min: rule.processing_time_days_min,
    processing_time_days_max: rule.processing_time_days_max,
    cancellation_policy: rule.cancellation_policy,
    valid_from: rule.valid_from,
    valid_to: rule.valid_to,
    required_conditions_ja: rule.required_conditions_ja,
  };
}

function assets(ruleSet: P0SpendRuleSet): readonly P0SpendAsset[] {
  const result = new Map<string, P0SpendAsset>();
  for (const rule of ruleSet.rules) {
    result.set(rule.source_asset.asset_id, rule.source_asset);
    result.set(rule.destination_asset.asset_id, rule.destination_asset);
  }
  return [...result.values()].sort((left, right) =>
    left.label_ja.localeCompare(right.label_ja, "ja"),
  );
}

function p0WalletCatalogue(
  artifacts: readonly P0ResearchArtifact[],
  ruleSet: P0SpendRuleSet,
): readonly P0WalletCatalogueItem[] {
  const counts = new Map<string, number>();
  for (const artifact of artifacts) {
    for (const claim of artifact.claims) {
      if (
        !claim ||
        typeof claim !== "object" ||
        typeof claim.family_id !== "string"
      )
        throw new TypeError("p0_research_claim_invalid");
      if (isP0ProductFamilyId(claim.family_id))
        counts.set(claim.family_id, (counts.get(claim.family_id) ?? 0) + 1);
    }
  }
  const spendLabels = new Set(assets(ruleSet).map((asset) => asset.label_ja));
  return Object.freeze(
    [...counts.entries()]
      .map(([familyId, factCount]) => {
        if (!isP0ProductFamilyId(familyId))
          throw new TypeError("p0_wallet_family_unknown");
        const definition = P0_WALLET_FAMILIES[familyId];
        return Object.freeze({
          family_id: familyId,
          label: definition.label,
          kind: definition.kind,
          fact_count: factCount,
          calculation_status:
            definition.kind === "point" && spendLabels.has(definition.label)
              ? ("spend_route" as const)
              : ("information_only" as const),
        });
      })
      .sort((left, right) =>
        left.kind === right.kind
          ? left.label.localeCompare(right.label, "ja")
          : left.kind.localeCompare(right.kind),
      ),
  );
}

function safeOfficialSource(value: unknown): P0ResearchSource | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as JsonRecord;
  if (
    typeof source.source_id !== "string" ||
    typeof source.url !== "string" ||
    typeof source.official_domain !== "string"
  )
    return null;
  try {
    const parsed = new URL(source.url);
    if (
      parsed.protocol !== "https:" ||
      parsed.hostname !== source.official_domain ||
      parsed.username ||
      parsed.password ||
      parsed.port ||
      parsed.hash ||
      source.url.length > 512
    )
      return null;
  } catch {
    return null;
  }
  return {
    source_id: source.source_id,
    url: source.url,
    official_domain: source.official_domain,
  };
}

function lotteryClaim(value: P0ResearchClaim): boolean {
  const text = `${value.predicate} ${value.subject} ${value.short_paraphrase}`;
  return /lottery|(?:^|_)draws?(?:_|$)|scratch|randomized|抽選|当選|くじ/iu.test(
    text,
  );
}

function japaneseLotteryTitle(claim: P0ResearchClaim, family: string): string {
  if (
    /\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Han}/u.test(
      claim.subject,
    )
  )
    return claim.subject.slice(0, 80);
  const known: Readonly<Record<string, string>> = Object.freeze({
    "FamiPay payment game": "ファミペイ払いゲーム",
    "Rakuten Pay daily scratch": "楽天ペイ デイリースクラッチ",
    "Rakuten Pay scratch limited points": "楽天ペイ スクラッチ特典",
    "nanaco summer festival": "nanaco夏祭り",
    "WAON August campaign": "WAON 8月キャンペーン",
    "JRE POINT scratch": "JRE POINT スクラッチ",
  });
  return known[claim.subject] ?? `${family}の抽選キャンペーン`;
}

function lotteryPeriod(
  applicability: JsonRecord,
  effectiveDate: string,
): {
  status: P0LotteryBrowserLink["status"];
  label: string;
} {
  const from =
    typeof applicability.effective_from === "string"
      ? applicability.effective_from
      : null;
  const to =
    typeof applicability.effective_to === "string"
      ? applicability.effective_to
      : null;
  const ended =
    applicability.status === "ended" || (to !== null && to < effectiveDate);
  if (ended)
    return { status: "official_announcement", label: "終了したキャンペーン" };
  if (from && to)
    return {
      status: "application_or_details",
      label: `${from.replaceAll("-", "/")}〜${to.replaceAll("-", "/")}`,
    };
  if (to)
    return {
      status: "application_or_details",
      label: `${to.replaceAll("-", "/")}まで`,
    };
  return { status: "application_or_details", label: "期間は公式ページで確認" };
}

function currentTokyoDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export async function listP0LotteryBrowserLinks(
  effectiveDate = currentTokyoDate(),
): Promise<{
  readonly version: "p0-lottery-links.v1";
  readonly calculation_use: false;
  readonly links: readonly P0LotteryBrowserLink[];
}> {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(effectiveDate))
    throw new TypeError("p0_lottery_effective_date_invalid");
  const { artifacts } = await loadBundle();
  const sourceById = new Map<string, P0ResearchSource>();
  for (const artifact of artifacts)
    for (const rawSource of artifact.sources) {
      const source = safeOfficialSource(rawSource);
      if (source) sourceById.set(source.source_id, source);
    }
  const byUrl = new Map<string, P0LotteryBrowserLink>();
  for (const artifact of artifacts)
    for (const claim of artifact.claims) {
      if (!lotteryClaim(claim) || !Array.isArray(claim.source_ids)) continue;
      const source = claim.source_ids
        .map((sourceId) => sourceById.get(sourceId))
        .find((candidate) => candidate !== undefined);
      const familyLabel = LOTTERY_FAMILY_LABELS[claim.family_id];
      if (!source || !familyLabel || !claim.applicability) continue;
      const period = lotteryPeriod(claim.applicability, effectiveDate);
      const next: P0LotteryBrowserLink = Object.freeze({
        title: japaneseLotteryTitle(claim, familyLabel),
        family: familyLabel,
        status: period.status,
        period_label: period.label,
        official_url: source.url,
      });
      const previous = byUrl.get(source.url);
      if (!previous || previous.status === "official_announcement")
        byUrl.set(source.url, next);
    }
  return Object.freeze({
    version: "p0-lottery-links.v1",
    calculation_use: false,
    links: Object.freeze(
      [...byUrl.values()].sort((left, right) =>
        left.family.localeCompare(right.family, "ja"),
      ),
    ),
  });
}

export async function listPointSpendBrowserOptions(): Promise<{
  readonly version: "p0-point-spend-options.v2";
  readonly experimental: true;
  readonly rule_count: number;
  readonly assets: readonly PointSpendBrowserAsset[];
  readonly wallet_catalogue: readonly P0WalletCatalogueItem[];
  readonly conditional_rules: readonly {
    readonly rule_id: string;
    readonly label: string;
    readonly source_asset_id: string;
    readonly destination_asset_id: string;
    readonly conditions: readonly string[];
  }[];
}> {
  const { ruleSet, artifacts } = await loadBundle();
  return {
    version: "p0-point-spend-options.v2",
    experimental: true,
    rule_count: ruleSet.rule_count,
    assets: assets(ruleSet).map((item) => ({
      asset_id: item.asset_id,
      label: item.label_ja,
      kind: item.asset_kind,
    })),
    wallet_catalogue: p0WalletCatalogue(artifacts, ruleSet),
    conditional_rules: ruleSet.rules
      .filter((rule) => rule.required_conditions_ja.length > 0)
      .map((rule) => ({
        rule_id: rule.rule_id,
        label: rule.label_ja,
        source_asset_id: rule.source_asset.asset_id,
        destination_asset_id: rule.destination_asset.asset_id,
        conditions: rule.required_conditions_ja,
      })),
  };
}

function dayLabel(minimum: number | null, maximum: number | null): string {
  if (minimum === null || maximum === null) return "所要日数は提供元で確認";
  if (maximum === 0) return "即時見込み";
  return minimum === maximum ? `約${maximum}日` : `約${minimum}〜${maximum}日`;
}

function browserRoute(
  route: NonNullable<ReturnType<typeof optimizePointSpend>["winner"]>,
  labelByAsset: ReadonlyMap<string, string>,
): PointSpendBrowserRoute {
  return {
    recommendation_id: route.route_id,
    target_amount: route.target_amount,
    target_label: labelByAsset.get(route.target_asset.asset_id) ?? "交換先",
    residual_source_amount: route.residual_source_amount,
    processing_days: dayLabel(
      route.processing_time_days_min,
      route.processing_time_days_max,
    ),
    steps: route.steps.map((step) => ({
      label: step.label_ja,
      source_label: labelByAsset.get(step.source_asset_id) ?? "交換元",
      destination_label:
        labelByAsset.get(step.destination_asset_id) ?? "交換先",
      source_amount: step.source_amount,
      destination_amount: step.destination_amount,
      processing_days: dayLabel(
        step.processing_time_days_min,
        step.processing_time_days_max,
      ),
    })),
  };
}

export async function recommendPointSpend(
  raw: unknown,
): Promise<PointSpendBrowserResult> {
  const input = parsePointSpendBrowserInput(raw);
  const ruleSet = await loadRuleSet();
  const allAssets = assets(ruleSet);
  const sourceAsset = allAssets.find(
    (candidate) => candidate.asset_id === input.source_asset_id,
  );
  if (
    !sourceAsset ||
    !allAssets.some((item) => item.asset_id === input.target_asset_id)
  )
    throw new TypeError("point_spend_asset_unknown");
  const result = optimizePointSpend({
    effective_at: input.effective_at,
    objective: input.objective,
    target_asset_id: input.target_asset_id,
    balances: [
      {
        asset: engineAsset(sourceAsset),
        amount: String(input.balance),
        expires_at: null,
      },
    ],
    edges: ruleSet.rules.map(edge),
    confirmed_rule_ids: input.confirmed_rule_ids,
    period_source_used_by_rule: {},
    max_steps: 4,
  });
  const labels = new Map(
    allAssets.map((item) => [item.asset_id, item.label_ja]),
  );
  const routes = result.routes
    .slice(0, 3)
    .map((route) => browserRoute(route, labels));
  return {
    version: "p0-point-spend-browser.v1",
    status: routes.length > 0 ? "ready" : "no_route",
    experimental: true,
    current_advice: false,
    objective: input.objective,
    winner: routes[0] ?? null,
    alternatives: routes.slice(1),
    message:
      routes.length > 0
        ? "P0の明示レートだけで計算した交換候補です。実行前に提供元で条件を確認してください。"
        : "この残高・交換先で、安全に計算できるP0ルートは見つかりませんでした。",
    rule_count: ruleSet.rule_count,
  };
}
