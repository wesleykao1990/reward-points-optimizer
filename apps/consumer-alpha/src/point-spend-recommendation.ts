import { promises as fs } from "node:fs";

import {
  compileP0PaymentLayerSet,
  compileP0SpendRuleSet,
  type P0PaymentLayerSet,
  type P0SpendAsset,
  type P0SpendRule,
  type P0SpendRuleSet,
} from "@jro/provisional-rules";
import {
  type AssetValuation,
  buildValuationProfile,
  deriveBestExitValuations,
  type ExitOption,
  optimizePointRoute,
  type PointRouteEdge,
  type PointRoutePlan,
  type ValuationProfile,
} from "@jro/rule-engine";
import {
  isCanonicalProductFamilyId,
  isStrictCanonicalDateTime,
  P0_PRODUCT_FAMILY_IDS,
  type P0ProductFamilyId,
} from "./contracts.js";

const RESEARCH_FILES = Object.freeze([
  "p0-point-rules-a.research.v0.1.json",
  "p0-point-rules-b.research.v0.1.json",
  "p0-wallet-card-rules.research.v0.1.json",
  "p0-merchant-transit-regulatory-rules.research.v0.1.json",
  "p0-complex-route-benchmark.research.v0.1.json",
] as const);

export const MAX_POINT_SPEND_BODY_BYTES = 4_096;

/**
 * `maximize_value` compares routes that end in different assets by their
 * declared JPY worth; the other objectives keep the older native-unit and
 * timing orderings.
 */
export type PointSpendObjective =
  | "maximize_value"
  | "maximize_target"
  | "fastest"
  | "preserve_expiring";

export const POINT_SPEND_OBJECTIVES: readonly PointSpendObjective[] =
  Object.freeze([
    "maximize_value",
    "maximize_target",
    "fastest",
    "preserve_expiring",
  ]);

export interface PointSpendBrowserInput {
  readonly source_asset_id: string;
  /** `null` asks for the best exit instead of one chosen destination. */
  readonly target_asset_id: string | null;
  readonly balance: number;
  readonly objective: PointSpendObjective;
  readonly effective_at: string;
  readonly confirmed_rule_ids: readonly string[];
  /** Host-confirmed product/account prerequisites used by structured edges. */
  readonly confirmed_prerequisite_ids: readonly string[];
  /** Source units already used in the provider's declared cap window. */
  readonly period_source_used_by_rule: Readonly<Record<string, string>>;
  /**
   * What one unit of the destination is worth to this person.
   *
   * Supplied by the buyer, so it overrides the value derived from published
   * redemptions rather than competing with it.
   */
  readonly unit_value_jpy: number | null;
}

export interface PointSpendBrowserAsset {
  readonly asset_id: string;
  readonly label: string;
  readonly kind: string;
}

export interface PointSpendBrowserCoverageTarget {
  readonly asset_id: string;
  readonly label: string;
}

export interface PointSpendBrowserCoverageSource {
  readonly asset_id: string;
  readonly label: string;
  readonly targets: readonly PointSpendBrowserCoverageTarget[];
}

/** Browser-safe summary of the bounded spend graph. */
export interface PointSpendBrowserCoverage {
  readonly rule_count: number;
  readonly asset_count: number;
  readonly direct_pair_count: number;
  readonly reachable_pair_count: number;
  readonly conditional_rule_count: number;
  readonly targets_by_source: readonly PointSpendBrowserCoverageSource[];
}

export type P0WalletCatalogueKind =
  | "point"
  | "mobile_pay"
  | "credit_card"
  | "emoney"
  | "stored_value";

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
  readonly source_node_id: string;
  readonly destination_node_id: string;
  readonly source_label: string;
  readonly destination_label: string;
  readonly source_amount: string;
  readonly destination_amount: string;
  readonly processing_days: string;
  /** Units this hop had to leave behind, in the hop's own source units. */
  readonly stranded_amount: string;
  /** Why this hop could not carry more, when something other than the balance. */
  readonly limit_note: string | null;
  /** The date this hop would be started, when every lead time is known. */
  readonly start_date: string | null;
}

/** One route within a plan.  A plan holds several when a cap forces a split. */
export interface PointSpendBrowserLeg {
  readonly source_amount: string;
  readonly target_amount: string;
  readonly processing_days: string;
  readonly steps: readonly PointSpendBrowserStep[];
}

export interface PointSpendBrowserRoute {
  readonly recommendation_id: string;
  readonly target_amount: string;
  readonly target_label: string;
  readonly residual_source_amount: string;
  readonly processing_days: string;
  /** The first leg's hops, kept so a single-route plan reads as before. */
  readonly steps: readonly PointSpendBrowserStep[];
  readonly source_amount_used: string;
  readonly value_jpy: string | null;
  readonly value_note: string;
  readonly effective_rate_percent: string | null;
  readonly legs: readonly PointSpendBrowserLeg[];
  /** Present when the balance had to be split across more than one route. */
  readonly split_note: string | null;
  /** Present when units are left behind partway through the route. */
  readonly stranded_note: string | null;
}

export type PointSpendNoRouteReason =
  | "source_target_not_covered"
  | "condition_confirmation_required"
  | "period_usage_required_or_exceeded"
  | "balance_below_minimum"
  | "outside_validity_window"
  | "route_unavailable";

export interface PointSpendNoRouteDetails {
  /** Only populated when the initial source has an explicit minimum. */
  readonly minimum_source_amount: string | null;
  readonly conditions: readonly string[];
}

export interface PointSpendBrowserResult {
  readonly version: "p0-point-spend-browser.v2";
  readonly status: "ready" | "no_route";
  readonly experimental: true;
  readonly current_advice: false;
  readonly objective: PointSpendObjective;
  readonly winner: PointSpendBrowserRoute | null;
  readonly alternatives: readonly PointSpendBrowserRoute[];
  readonly message: string;
  readonly rule_count: number;
  readonly no_route_reason: PointSpendNoRouteReason | null;
  readonly no_route_details: PointSpendNoRouteDetails | null;
  /** Destinations that are reachable but have no declared yen value. */
  readonly unvalued_asset_labels: readonly string[];
  /** Whether these rates came from the database or the checked-in fixtures. */
  readonly data_origin: RouteGraphOrigin;
  readonly data_as_of: string | null;
  /** Present when the database claims could not be used. */
  readonly data_fallback_reason: string | null;
}

type JsonRecord = Record<string, unknown>;

const REQUEST_REQUIRED_KEYS = Object.freeze([
  "source_asset_id",
  "target_asset_id",
  "balance",
  "objective",
  "effective_at",
  "confirmed_rule_ids",
  "unit_value_jpy",
] as const);

const REQUEST_OPTIONAL_KEYS = Object.freeze([
  "confirmed_prerequisite_ids",
  "period_source_used_by_rule",
] as const);

const POINT_ROUTE_ID = /^[a-z0-9][a-z0-9.-]{1,119}$/u;

function parseRecord(value: unknown): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("point_spend_request_invalid");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Object.keys(descriptors).sort();
  const required = new Set<string>(REQUEST_REQUIRED_KEYS);
  const allowed = new Set<string>([
    ...REQUEST_REQUIRED_KEYS,
    ...REQUEST_OPTIONAL_KEYS,
  ]);
  if (
    keys.some((key) => !allowed.has(key)) ||
    [...required].some((key) => !keys.includes(key)) ||
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

function parseConfirmationIds(value: unknown): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.length > 64 ||
    new Set(value).size !== value.length ||
    value.some((item) => typeof item !== "string" || !POINT_ROUTE_ID.test(item))
  )
    throw new TypeError("point_spend_request_invalid");
  return Object.freeze([...value].sort());
}

function parsePeriodUsage(value: unknown): Readonly<Record<string, string>> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("point_spend_request_invalid");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Object.keys(descriptors).sort();
  if (keys.length > 64 || Object.getOwnPropertySymbols(value).length > 0)
    throw new TypeError("point_spend_request_invalid");
  const output = Object.create(null) as Record<string, string>;
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (
      !POINT_ROUTE_ID.test(key) ||
      !descriptor ||
      descriptor.enumerable !== true ||
      !("value" in descriptor) ||
      !Number.isSafeInteger(descriptor.value) ||
      Number(descriptor.value) < 0 ||
      Number(descriptor.value) > 1_000_000_000
    )
      throw new TypeError("point_spend_request_invalid");
    output[key] = String(descriptor.value);
  }
  return Object.freeze(output);
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
  const confirmedPrerequisites = record.confirmed_prerequisite_ids ?? [];
  const periodUsage = record.period_source_used_by_rule ?? {};
  const unitValue = record.unit_value_jpy;
  if (
    typeof source !== "string" ||
    !/^asset\.[a-z0-9.-]{2,80}$/u.test(source) ||
    (target !== null &&
      (typeof target !== "string" ||
        !/^asset\.[a-z0-9.-]{2,80}$/u.test(target))) ||
    source === target ||
    !Number.isSafeInteger(balance) ||
    Number(balance) < 1 ||
    Number(balance) > 1_000_000_000 ||
    (unitValue !== null &&
      (typeof unitValue !== "number" ||
        !Number.isFinite(unitValue) ||
        unitValue <= 0 ||
        unitValue > 1_000_000)) ||
    !POINT_SPEND_OBJECTIVES.includes(objective as PointSpendObjective) ||
    typeof effectiveAt !== "string" ||
    !isStrictCanonicalDateTime(effectiveAt) ||
    !Array.isArray(confirmed)
  )
    throw new TypeError("point_spend_request_invalid");
  return {
    source_asset_id: source,
    target_asset_id: target === null ? null : String(target),
    balance: Number(balance),
    objective: objective as PointSpendObjective,
    effective_at: effectiveAt,
    confirmed_rule_ids: parseConfirmationIds(confirmed),
    confirmed_prerequisite_ids: parseConfirmationIds(confirmedPrerequisites),
    period_source_used_by_rule: parsePeriodUsage(periodUsage),
    // Rounded to sen so a long float cannot perturb the canonical hash.
    unit_value_jpy:
      unitValue === null ? null : Math.round(Number(unitValue) * 100) / 100,
  };
}

const P0_WALLET_FAMILIES: Readonly<
  Record<
    string,
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

const FAMILY_PREFIX_KIND: Readonly<Record<string, P0WalletCatalogueKind>> =
  Object.freeze({
    point: "point",
    wallet: "mobile_pay",
    card: "credit_card",
    emoney: "emoney",
    storedvalue: "stored_value",
  });

const FAMILY_PREFIX_LABEL: Readonly<Record<string, string>> = Object.freeze({
  point: "ポイント",
  wallet: "ウォレット",
  card: "カード",
  emoney: "電子マネー",
  storedvalue: "電子マネー残高",
});

function dynamicFamilyDefinition(
  familyId: string,
): { readonly label: string; readonly kind: P0WalletCatalogueKind } | null {
  if (!isCanonicalProductFamilyId(familyId)) return null;
  const prefix = familyId.slice(0, familyId.indexOf("."));
  const kind = FAMILY_PREFIX_KIND[prefix];
  const prefixLabel = FAMILY_PREFIX_LABEL[prefix];
  if (!kind || !prefixLabel) return null;
  const suffix = familyId.slice(prefix.length + 1);
  // IDs are canonical ASCII, so this fallback is safe to render in Japanese
  // without trusting a database-provided label or HTML fragment.
  return Object.freeze({
    label: `${prefixLabel}（${suffix}）`,
    kind,
  });
}

export function p0ProductFamilyDefinition(
  familyId: string,
): { readonly label: string; readonly kind: P0WalletCatalogueKind } | null {
  return P0_WALLET_FAMILIES[familyId] ?? dynamicFamilyDefinition(familyId);
}

if (Object.keys(P0_WALLET_FAMILIES).length !== P0_PRODUCT_FAMILY_IDS.length)
  throw new Error("p0_wallet_family_catalogue_incomplete");

function isP0ProductFamilyId(value: string): value is P0ProductFamilyId {
  return isCanonicalProductFamilyId(value);
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
  readonly retrieval?: {
    readonly accessed_at?: unknown;
  };
}

interface P0ResearchClaim {
  readonly claim_id: string;
  readonly family_id: string;
  readonly source_role_id: string;
  readonly claim_type: string;
  readonly predicate: string;
  readonly subject: string;
  readonly short_paraphrase: string;
  readonly source_ids: readonly string[];
  readonly applicability: JsonRecord;
  readonly value: unknown;
}

interface P0ResearchArtifact {
  readonly claims: readonly P0ResearchClaim[];
  readonly sources: readonly P0ResearchSource[];
}

export interface RouteGraphProvenance {
  readonly research_artifact_id: string;
  readonly implementation_version: string;
  readonly implementation_hash: string;
  readonly as_of: string;
  readonly claim_count: number;
}

export interface RouteGraphSourceResult {
  readonly artifacts: readonly unknown[];
  readonly provenance: readonly RouteGraphProvenance[];
  readonly as_of: string | null;
}

/** Supplies the current research claims, normally from the database. */
export interface RouteGraphSourcePort {
  current(effectiveAt: string): Promise<RouteGraphSourceResult>;
}

export type RouteGraphOrigin = "database" | "bundled_fixture";

interface PointSpendBundle {
  readonly ruleSet: P0SpendRuleSet;
  readonly paymentLayers: P0PaymentLayerSet;
  readonly artifacts: readonly P0ResearchArtifact[];
  readonly origin: RouteGraphOrigin;
  readonly as_of: string | null;
  readonly provenance: readonly RouteGraphProvenance[];
  /** Why the database claims were not used, when they were not. */
  readonly fallback_reason: string | null;
}

let fixturePromise: Promise<PointSpendBundle> | undefined;

/**
 * Compiled graphs, keyed by the snapshot hashes they were built from.
 *
 * The claims are queried on every request so an updated snapshot takes effect
 * immediately, but compiling is only redone when those hashes actually change.
 * A time-based cache would have been simpler and wrong: it would keep serving
 * a rate the database had already corrected.
 */
const compiledByHashKey = new Map<string, PointSpendBundle>();
const MAX_COMPILED_GRAPHS = 8;

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

function compileBundle(
  rawArtifacts: unknown[],
  origin: RouteGraphOrigin,
  asOf: string | null,
  provenance: readonly RouteGraphProvenance[],
  fallbackReason: string | null,
): PointSpendBundle {
  return {
    ruleSet: compileP0SpendRuleSet(rawArtifacts),
    paymentLayers: compileP0PaymentLayerSet(rawArtifacts),
    artifacts: researchArtifacts(rawArtifacts),
    origin,
    as_of: asOf,
    provenance,
    fallback_reason: fallbackReason,
  };
}

async function loadFixtureBundle(
  fallbackReason: string | null,
): Promise<PointSpendBundle> {
  if (!fixturePromise) {
    fixturePromise = Promise.all(
      RESEARCH_FILES.map(async (name) =>
        JSON.parse(
          await fs.readFile(
            new URL(`../../../fixtures/m3/agent-feed/${name}`, import.meta.url),
            "utf8",
          ),
        ),
      ),
    ).then((rawArtifacts) =>
      compileBundle(rawArtifacts, "bundled_fixture", null, [], null),
    );
  }
  const bundle = await fixturePromise;
  return fallbackReason === null
    ? bundle
    : { ...bundle, fallback_reason: fallbackReason };
}

/**
 * Compile the routing graph and payment layers from the freshest claims.
 *
 * Supplying a source makes that source authoritative. A source failure, an
 * empty projection, or a rejected snapshot fails closed; live requests never
 * resurrect checked-in economics. Calling without a source is an explicit
 * offline-fixture mode used by focused compiler tests and local examples.
 */
export async function loadPointSpendBundle(
  source?: RouteGraphSourcePort,
  effectiveAt: string = new Date().toISOString(),
): Promise<PointSpendBundle> {
  if (!source) return loadFixtureBundle(null);
  const loaded: RouteGraphSourceResult = await source.current(effectiveAt);
  if (loaded.artifacts.length === 0)
    throw new Error("route_graph_source_empty");
  const hashKey = loaded.provenance
    .map((item) => `${item.research_artifact_id}:${item.implementation_hash}`)
    .sort()
    .join("|");
  const cached = compiledByHashKey.get(hashKey);
  if (cached) return cached;
  const compiled = compileBundle(
    [...loaded.artifacts],
    "database",
    loaded.as_of,
    loaded.provenance,
    null,
  );
  if (compiledByHashKey.size >= MAX_COMPILED_GRAPHS) compiledByHashKey.clear();
  compiledByHashKey.set(hashKey, compiled);
  return compiled;
}

export interface SelectedProductPurchaseCalculation {
  readonly family_id: P0ProductFamilyId;
  readonly label: string;
  readonly reward_label: string;
  readonly reward_points: string;
  readonly rate_percent: string;
  readonly calculation_note: string;
  /** Host-only binding back to the selected Agent Feed claim. */
  readonly source_claim_id: string;
  /** Browser-safe official source locator for the calculation. */
  readonly source_url?: string;
  /** Agent Feed retrieval timestamp projected as the browser checked time. */
  readonly checked_at: string;
  readonly calculation_source: "agent_feed_structured";
}

/**
 * Only base reward roles are eligible for the generic purchase calculation.
 * The role names are Agent Feed data, not product/family bindings; new claim
 * identifiers therefore do not require a code change here.
 */
const BASE_RATE_SOURCE_ROLES = new Set([
  "base_point_rules",
  "base_reward_rules",
]);

function jsonRecord(value: unknown): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("p0_purchase_rate_invalid");
  return value as JsonRecord;
}

function positiveNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
    throw new TypeError("p0_purchase_rate_invalid");
  return value;
}

function rateParts(
  familyId: string,
  claim: P0ResearchClaim,
): {
  readonly unit: number;
  readonly points: number;
  readonly rewardLabel: string;
  readonly note: string;
} {
  const value = jsonRecord(claim.value);
  if (familyId === "card.paypay") {
    if (!Array.isArray(value.tiers))
      throw new TypeError("p0_purchase_rate_invalid");
    const tier = value.tiers
      .map(jsonRecord)
      .find((item) => String(item.method).includes("PayPay Card"));
    if (!tier) throw new TypeError("p0_purchase_rate_invalid");
    const unit = positiveNumber(value.basis_amount);
    const ratePercent = positiveNumber(tier.rate_percent);
    return {
      unit,
      points: (unit * ratePercent) / 100,
      rewardLabel: "PayPayポイント",
      note: `${unit}円単位・基本還元率${ratePercent}%で計算`,
    };
  }
  if (familyId === "wallet.paypay") {
    const unit = positiveNumber(value.calculation_unit_yen);
    const rate = positiveNumber(value.balance_rate);
    return {
      unit,
      points: unit * rate,
      rewardLabel: String(value.point || "PayPayポイント"),
      note: `${unit}円単位・残高払いの基本還元率${rate * 100}%で計算`,
    };
  }
  if (familyId === "wallet.rakutenpay") {
    if (!Array.isArray(value.balance_payment_rate_range))
      throw new TypeError("p0_purchase_rate_invalid");
    const rate = Math.min(
      ...value.balance_payment_rate_range.map(positiveNumber),
    );
    return {
      unit: 100,
      points: 100 * rate,
      rewardLabel: String(value.point || "楽天ポイント"),
      note: `通常還元率の下限${rate * 100}%で計算`,
    };
  }
  const unit = positiveNumber(value.spend_yen);
  const points = positiveNumber(value.points);
  return {
    unit,
    points,
    rewardLabel: String(value.point || "ポイント"),
    note: `${unit}円ごとに${points}ポイントで計算`,
  };
}

interface PurchaseRateCandidate {
  readonly claim: P0ResearchClaim;
  readonly rate: ReturnType<typeof rateParts>;
  readonly source_url?: string;
  readonly checked_at: string;
  readonly d_card_dependency: boolean;
}

function officialSourceProvenance(
  claim: P0ResearchClaim,
  sources: ReadonlyMap<string, P0ResearchSource>,
): { readonly source_url: string; readonly checked_at: string } | null {
  // Source order is not a semantic signal.  Sorting keeps selection stable if
  // an Agent Feed producer reorders source_ids or the source records.
  if (
    !Array.isArray(claim.source_ids) ||
    !claim.source_ids.every((sourceId) => typeof sourceId === "string")
  )
    return null;
  for (const sourceId of [...claim.source_ids].sort()) {
    const source = sources.get(sourceId);
    if (
      !source ||
      typeof source !== "object" ||
      typeof source.url !== "string" ||
      typeof source.official_domain !== "string"
    )
      continue;
    let parsed: URL;
    try {
      parsed = new URL(source.url);
    } catch {
      continue;
    }
    if (parsed.protocol !== "https:" || parsed.username || parsed.password)
      continue;
    const hostname = parsed.hostname.toLowerCase();
    const officialDomain = source.official_domain.toLowerCase();
    if (
      !officialDomain ||
      (hostname !== officialDomain && !hostname.endsWith(`.${officialDomain}`))
    )
      continue;
    const accessedAt = source.retrieval?.accessed_at;
    if (
      typeof accessedAt !== "string" ||
      !Number.isFinite(Date.parse(accessedAt))
    )
      continue;
    return Object.freeze({ source_url: source.url, checked_at: accessedAt });
  }
  return null;
}

function hasDCardDependency(claim: P0ResearchClaim): boolean {
  const value =
    claim.value &&
    typeof claim.value === "object" &&
    !Array.isArray(claim.value)
      ? (claim.value as JsonRecord)
      : null;
  // `components` is a typed Agent Feed field.  Do not inspect
  // short_paraphrase (or any other prose) to infer dependencies.
  return (
    Array.isArray(value?.components) &&
    value.components.some(
      (component) =>
        typeof component === "string" && /\bd\s*card\b/iu.test(component),
    )
  );
}

function purchaseRateCandidates(
  familyId: P0ProductFamilyId,
  claims: readonly P0ResearchClaim[],
  sources: ReadonlyMap<string, P0ResearchSource>,
  databaseAsOf: string | null,
): readonly PurchaseRateCandidate[] {
  const candidates: PurchaseRateCandidate[] = [];
  for (const claim of claims) {
    if (!claim || typeof claim !== "object" || Array.isArray(claim)) continue;
    if (
      claim.family_id !== familyId ||
      claim.claim_type !== "earn_rule" ||
      !BASE_RATE_SOURCE_ROLES.has(claim.source_role_id)
    )
      continue;
    let rate: ReturnType<typeof rateParts>;
    try {
      rate = rateParts(familyId, claim);
    } catch {
      // A malformed/unsupported claim must not hide a valid sibling claim or
      // prevent other selected families from being calculated.
      continue;
    }
    const provenance = officialSourceProvenance(claim, sources);
    const checkedAt = provenance?.checked_at ?? databaseAsOf;
    if (checkedAt === null) continue;
    candidates.push({
      claim,
      rate,
      ...(provenance ? { source_url: provenance.source_url } : {}),
      checked_at: checkedAt,
      d_card_dependency: hasDCardDependency(claim),
    });
  }
  return Object.freeze(candidates);
}

function comparePurchaseRates(
  left: PurchaseRateCandidate,
  right: PurchaseRateCandidate,
): number {
  const leftRate = left.rate.points / left.rate.unit;
  const rightRate = right.rate.points / right.rate.unit;
  return (
    leftRate - rightRate ||
    left.rate.unit - right.rate.unit ||
    left.rate.points - right.rate.points ||
    left.claim.claim_id.localeCompare(right.claim.claim_id)
  );
}

function selectPurchaseRateCandidate(
  familyId: P0ProductFamilyId,
  candidates: readonly PurchaseRateCandidate[],
  selected: ReadonlySet<P0ProductFamilyId>,
): PurchaseRateCandidate | null {
  if (!candidates.length) return null;
  let eligible = candidates;
  // d払い's higher dカード route is an explicit request dependency.  It is
  // represented by a typed `components` field rather than a claim identifier
  // or short_paraphrase, so a producer can rename/reorder claims safely.
  if (familyId === "wallet.dbarai" && selected.has("card.d")) {
    const dCardCandidates = candidates.filter(
      (candidate) => candidate.d_card_dependency,
    );
    if (dCardCandidates.length) eligible = dCardCandidates;
  }
  return [...eligible].sort(comparePurchaseRates)[0] ?? null;
}

/** Calculate every selected card/mobile-payment base route from the current
 * structured research projection. Supplying a source makes PostgreSQL the
 * sole authority; omission is an explicit offline-fixture mode for tests. */
export async function calculateSelectedProductPurchases(
  selectedProductIds: readonly P0ProductFamilyId[],
  amountJpy: number,
  source?: RouteGraphSourcePort,
  effectiveAt: string = new Date().toISOString(),
): Promise<readonly SelectedProductPurchaseCalculation[]> {
  if (
    !Number.isSafeInteger(amountJpy) ||
    amountJpy < 1 ||
    amountJpy > 1_000_000
  )
    throw new TypeError("p0_purchase_amount_invalid");
  const selected = new Set(selectedProductIds);
  const bundle = await loadPointSpendBundle(source, effectiveAt);
  const { artifacts } = bundle;
  const claims = artifacts.flatMap((artifact) => artifact.claims);
  const sources = new Map(
    artifacts
      .flatMap((artifact) => artifact.sources)
      .filter(
        (source) =>
          source &&
          typeof source === "object" &&
          typeof source.source_id === "string",
      )
      .map((source) => [source.source_id, source]),
  );
  const calculations: SelectedProductPurchaseCalculation[] = [];
  for (const familyId of [...selected].sort()) {
    const definition = p0ProductFamilyDefinition(familyId);
    if (
      !definition ||
      (definition.kind !== "credit_card" && definition.kind !== "mobile_pay")
    )
      continue;
    const candidate = selectPurchaseRateCandidate(
      familyId,
      purchaseRateCandidates(familyId, claims, sources, bundle.as_of),
      selected,
    );
    // A surfaced family can remain informational until its Agent Feed has a
    // typed, computable base claim.  Do not let that suppress valid siblings.
    if (!candidate) continue;
    const { claim, rate } = candidate;
    const rewardPoints = Math.floor(amountJpy / rate.unit) * rate.points;
    const ratePercent = (rate.points / rate.unit) * 100;
    calculations.push(
      Object.freeze({
        family_id: familyId,
        label: definition.label,
        reward_label: rate.rewardLabel,
        reward_points: String(rewardPoints),
        rate_percent: String(ratePercent),
        calculation_note:
          familyId === "wallet.dbarai" && candidate.d_card_dependency
            ? `${rate.note}（dカード設定を含む）`
            : rate.note,
        source_claim_id: claim.claim_id,
        ...(candidate.source_url ? { source_url: candidate.source_url } : {}),
        checked_at: candidate.checked_at,
        calculation_source: "agent_feed_structured",
      }),
    );
  }
  return Object.freeze(
    calculations.sort(
      (left, right) =>
        Number(right.reward_points) - Number(left.reward_points) ||
        left.label.localeCompare(right.label, "ja"),
    ),
  );
}

function engineAsset(asset: P0SpendAsset): PointRouteEdge["source_asset"] {
  return {
    asset_id: asset.asset_id,
    asset_kind: asset.asset_kind,
    program_id: asset.program_id,
    reward_class: asset.reward_class,
    scale: asset.scale,
  };
}

function edge(rule: P0SpendRule): PointRouteEdge {
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
    ...(rule.requires_rule_ids === undefined
      ? {}
      : { requires_rule_ids: rule.requires_rule_ids }),
    ...(rule.partial_consumption === undefined
      ? {}
      : { partial_consumption: rule.partial_consumption }),
    requires_direct_source: rule.requires_direct_source,
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

function pointSpendCoverage(
  ruleSet: P0SpendRuleSet,
  allAssets: readonly P0SpendAsset[],
): PointSpendBrowserCoverage {
  const labelByAsset = new Map(
    allAssets.map((asset) => [asset.asset_id, asset.label_ja]),
  );
  const adjacency = new Map<string, readonly P0SpendRule[]>();
  for (const rule of ruleSet.rules)
    adjacency.set(rule.source_asset.asset_id, [
      ...(adjacency.get(rule.source_asset.asset_id) ?? []),
      rule,
    ]);

  const sources = allAssets.map((source) => {
    const targets = new Set<string>();
    const visited = new Set<string>([source.asset_id]);
    const queue: { readonly asset_id: string; readonly steps: number }[] = [
      { asset_id: source.asset_id, steps: 0 },
    ];
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || current.steps >= 4) continue;
      for (const rule of adjacency.get(current.asset_id) ?? []) {
        const target = rule.destination_asset.asset_id;
        if (visited.has(target)) continue;
        visited.add(target);
        targets.add(target);
        queue.push({ asset_id: target, steps: current.steps + 1 });
      }
    }
    return Object.freeze({
      asset_id: source.asset_id,
      label: source.label_ja,
      targets: Object.freeze(
        [...targets]
          .sort((left, right) =>
            (labelByAsset.get(left) ?? left).localeCompare(
              labelByAsset.get(right) ?? right,
              "ja",
            ),
          )
          .map((assetId) =>
            Object.freeze({
              asset_id: assetId,
              label: labelByAsset.get(assetId) ?? "交換先",
            }),
          ),
      ),
    });
  });

  return Object.freeze({
    rule_count: ruleSet.rule_count,
    asset_count: allAssets.length,
    direct_pair_count: new Set(
      ruleSet.rules.map(
        (rule) =>
          `${rule.source_asset.asset_id}=>${rule.destination_asset.asset_id}`,
      ),
    ).size,
    reachable_pair_count: sources.reduce(
      (count, source) => count + source.targets.length,
      0,
    ),
    conditional_rule_count: ruleSet.rules.filter(
      (rule) => rule.required_conditions_ja.length > 0,
    ).length,
    targets_by_source: Object.freeze(sources),
  });
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
        const definition = p0ProductFamilyDefinition(familyId);
        if (!definition) throw new TypeError("p0_wallet_family_unknown");
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
  const { artifacts } = await loadFixtureBundle(null);
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

export async function listPointSpendBrowserOptions(
  source?: RouteGraphSourcePort,
): Promise<{
  readonly version: "p0-point-spend-options.v2";
  readonly experimental: true;
  /** Whether the graph was compiled from the database or the fixtures. */
  readonly data_origin: RouteGraphOrigin;
  readonly data_as_of: string | null;
  readonly rule_count: number;
  readonly coverage: PointSpendBrowserCoverage;
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
  const bundle = await loadPointSpendBundle(source);
  const { ruleSet, artifacts } = bundle;
  const allAssets = assets(ruleSet);
  return {
    version: "p0-point-spend-options.v2",
    data_origin: bundle.origin,
    data_as_of: bundle.as_of,
    experimental: true,
    rule_count: ruleSet.rule_count,
    coverage: pointSpendCoverage(ruleSet, allAssets),
    assets: allAssets.map((item) => ({
      asset_id: item.asset_id,
      label: item.label_ja,
      kind: item.asset_kind,
    })),
    wallet_catalogue: p0WalletCatalogue(artifacts, ruleSet),
    conditional_rules: ruleSet.rules
      .filter(
        (rule) =>
          rule.required_conditions_ja.length > 0 ||
          (rule.requires_rule_ids?.length ?? 0) > 0 ||
          rule.maximum_source_units_per_period !== null,
      )
      .map((rule) => ({
        rule_id: rule.rule_id,
        label: rule.label_ja,
        source_asset_id: rule.source_asset.asset_id,
        destination_asset_id: rule.destination_asset.asset_id,
        conditions: rule.required_conditions_ja,
        prerequisite_ids: rule.requires_rule_ids ?? [],
        period_cap:
          rule.maximum_source_units_per_period === null
            ? null
            : {
                maximum_source_units: rule.maximum_source_units_per_period,
                period: rule.maximum_period,
                partial_consumption: rule.partial_consumption ?? true,
              },
      })),
  };
}

const JPY_DENOMINATED_KINDS = new Set(["stored_value", "discount"]);

/**
 * Price the assets in the graph from what can actually be done with them.
 *
 * Stored-value and discount assets are denominated in yen, so one unit is one
 * yen by definition rather than by assumption.  Every other asset is worth the
 * best published exit it has — a point that redeems at 1 yen is worth 1 yen,
 * and a point with no published redemption stays unpriced rather than being
 * assumed to be worth face value.  A value the buyer supplies for the
 * destination replaces the derived one, because their own redemption plans
 * beat any published default.
 */
export function pointValuationProfile(
  ruleSet: P0SpendRuleSet,
  paymentLayers: P0PaymentLayerSet,
  targetAssetId: string | null,
  unitValueJpy: number | null,
): ValuationProfile {
  const allAssets = assets(ruleSet);
  const denominated: AssetValuation[] = allAssets
    .filter((asset) => JPY_DENOMINATED_KINDS.has(asset.asset_kind))
    .map((asset) => ({
      asset_id: asset.asset_id,
      reward_class: asset.reward_class,
      jpy_per_unit_min: "1",
      jpy_per_unit_expected: "1",
      jpy_per_unit_max: "1",
      source: "face_value_default" as const,
      note: "円建ての残高のため1単位=1円",
    }));

  const exits: ExitOption[] = [];
  for (const rule of ruleSet.rules) {
    const destination = allAssets.find(
      (asset) => asset.asset_id === rule.destination_asset.asset_id,
    );
    if (!destination || !JPY_DENOMINATED_KINDS.has(destination.asset_kind))
      continue;
    const source = Number(rule.source_units);
    const yen = Number(rule.destination_units);
    if (!Number.isFinite(source) || source <= 0 || !Number.isFinite(yen))
      continue;
    exits.push({
      exit_id: `exit.${rule.rule_id}`,
      asset_id: rule.source_asset.asset_id,
      reward_class: rule.source_asset.reward_class,
      label_ja: rule.label_ja,
      jpy_per_unit: String(Math.round((yen / source) * 10_000) / 10_000),
      source: "official_disclosed",
      source_claim_ids: rule.source_claim_ids.slice(0, 16),
    });
  }
  for (const exit of paymentLayers.exit_options)
    exits.push({
      exit_id: exit.exit_id,
      asset_id: exit.asset_id,
      reward_class: "normal",
      label_ja: exit.label_ja,
      jpy_per_unit: exit.jpy_per_unit,
      source: "official_disclosed",
      source_claim_ids: exit.source_claim_ids.slice(0, 16),
    });

  const derived = deriveBestExitValuations(
    buildValuationProfile("p0-point-value", denominated),
    exits,
  );
  if (unitValueJpy === null || targetAssetId === null) return derived.profile;
  const target = allAssets.find((asset) => asset.asset_id === targetAssetId);
  if (!target) return derived.profile;
  const supplied: AssetValuation = {
    asset_id: target.asset_id,
    reward_class: target.reward_class,
    jpy_per_unit_min: String(unitValueJpy),
    jpy_per_unit_expected: String(unitValueJpy),
    jpy_per_unit_max: String(unitValueJpy),
    source: "user_profile",
    note: "入力した1単位の価値",
  };
  return buildValuationProfile("p0-point-value", [
    ...derived.profile.entries.filter(
      (entry) =>
        entry.asset_id !== supplied.asset_id ||
        entry.reward_class !== supplied.reward_class,
    ),
    supplied,
  ]);
}

function dayLabel(minimum: number | null, maximum: number | null): string {
  if (minimum === null || maximum === null) return "所要日数は提供元で確認";
  if (maximum === 0) return "即時見込み";
  return minimum === maximum ? `約${maximum}日` : `約${minimum}〜${maximum}日`;
}

const LIMIT_NOTES: Readonly<Record<string, string>> = Object.freeze({
  period_cap: "期間内の交換上限に達するため",
  request_maximum: "1回あたりの上限があるため",
  increment: "交換単位に満たない分が残るため",
});

function browserStep(
  hop: PointRoutePlan["legs"][number]["hops"][number],
  labelByAsset: ReadonlyMap<string, string>,
): PointSpendBrowserStep {
  return {
    label: hop.label_ja,
    source_node_id: hop.source_asset_id,
    destination_node_id: hop.destination_asset_id,
    source_label: labelByAsset.get(hop.source_asset_id) ?? "交換元",
    destination_label: labelByAsset.get(hop.destination_asset_id) ?? "交換先",
    source_amount: hop.source_amount,
    destination_amount: hop.destination_amount,
    processing_days: dayLabel(
      hop.processing_time_days_min,
      hop.processing_time_days_max,
    ),
    stranded_amount: hop.stranded_source_amount,
    limit_note: LIMIT_NOTES[hop.binding_constraint] ?? null,
    start_date: hop.initiated_on,
  };
}

/**
 * Project one plan for the browser.
 *
 * The older single-route fields are preserved so a plan with one leg reads
 * exactly as before; the split, the value, and the units left behind partway
 * through are added because they change what the buyer should do.
 */
function browserRoute(
  plan: PointRoutePlan,
  labelByAsset: ReadonlyMap<string, string>,
): PointSpendBrowserRoute {
  const targetLabel = labelByAsset.get(plan.target_asset.asset_id) ?? "交換先";
  const legs = plan.legs.map((leg) => ({
    source_amount: leg.allocated_source_amount,
    target_amount: leg.target_amount,
    processing_days: dayLabel(
      leg.processing_time_days_min,
      leg.processing_time_days_max,
    ),
    steps: leg.hops.map((hop) => browserStep(hop, labelByAsset)),
  }));
  const strandedLabel = plan.stranded
    .map(
      (item) =>
        `${item.amount} ${labelByAsset.get(item.asset_id) ?? item.asset_id}`,
    )
    .join("・");
  return {
    recommendation_id: plan.plan_id,
    target_amount: plan.target_amount,
    target_label: targetLabel,
    residual_source_amount: residual(plan),
    processing_days: dayLabel(
      plan.processing_time_days_min,
      plan.processing_time_days_max,
    ),
    steps: legs[0]?.steps ?? [],
    source_amount_used: plan.source_amount_used,
    value_jpy: plan.value?.expected_jpy ?? null,
    value_note: valueNote(plan),
    effective_rate_percent: plan.effective_rate_percent,
    legs,
    split_note:
      legs.length > 1
        ? `上限があるため${legs.length}つのルートに分けています。合計で${plan.target_amount} ${targetLabel}です。`
        : null,
    stranded_note:
      strandedLabel.length > 0
        ? `途中で${strandedLabel}が交換されずに残ります。`
        : null,
  };
}

function residual(plan: PointRoutePlan): string {
  const available = Number(plan.source_amount_available);
  const used = Number(plan.source_amount_used);
  if (!Number.isFinite(available) || !Number.isFinite(used)) return "0";
  return String(Math.max(0, available - used));
}

function valueNote(plan: PointRoutePlan): string {
  if (!plan.value) return "この交換先の円換算は登録されていません。";
  const source = plan.value.valuation.source;
  if (source === "user_profile") return "入力した1単位の価値で試算しています。";
  if (source === "best_exit_derived")
    return `公表された使い道（${plan.value.valuation.note.replace("best exit: ", "")}）から換算しています。`;
  return "収録された交換条件から換算しています。";
}

function potentialRouteRuleIds(
  sourceAssetId: string,
  targetAssetId: string,
  ruleSet: P0SpendRuleSet,
): ReadonlySet<string> {
  const rulesBySource = new Map<string, readonly P0SpendRule[]>();
  for (const rule of ruleSet.rules)
    rulesBySource.set(rule.source_asset.asset_id, [
      ...(rulesBySource.get(rule.source_asset.asset_id) ?? []),
      rule,
    ]);
  const relevant = new Set<string>();
  const canReach = (
    assetId: string,
    visited: ReadonlySet<string>,
    steps: number,
  ): boolean => {
    if (assetId === targetAssetId) return true;
    if (steps >= 4) return false;
    let found = false;
    for (const rule of rulesBySource.get(assetId) ?? []) {
      const nextAssetId = rule.destination_asset.asset_id;
      if (visited.has(nextAssetId)) continue;
      const nextVisited = new Set(visited);
      nextVisited.add(nextAssetId);
      if (!canReach(nextAssetId, nextVisited, steps + 1)) continue;
      relevant.add(rule.rule_id);
      found = true;
    }
    return found;
  };
  canReach(sourceAssetId, new Set([sourceAssetId]), 0);
  return relevant;
}

function noRouteInfo(
  input: PointSpendBrowserInput,
  optimization: ReturnType<typeof optimizePointRoute>,
  coverage: PointSpendBrowserCoverage,
  ruleSet: P0SpendRuleSet,
): {
  readonly reason: PointSpendNoRouteReason;
  readonly details: PointSpendNoRouteDetails;
} {
  const sourceCoverage = coverage.targets_by_source.find(
    (source) => source.asset_id === input.source_asset_id,
  );
  const covered =
    input.target_asset_id === null
      ? (sourceCoverage?.targets.length ?? 0) > 0
      : sourceCoverage?.targets.some(
          (target) => target.asset_id === input.target_asset_id,
        );
  if (!covered)
    return {
      reason: "source_target_not_covered",
      details: { minimum_source_amount: null, conditions: [] },
    };

  // With no chosen destination every rule reachable from the source is
  // relevant, so the reason is drawn from the whole skipped set.
  const relevantRuleIds =
    input.target_asset_id === null
      ? new Set(optimization.skipped.map((item) => item.rule_id))
      : potentialRouteRuleIds(
          input.source_asset_id,
          input.target_asset_id,
          ruleSet,
        );
  const skippedByReason = new Set(
    optimization.skipped
      .filter((item) => relevantRuleIds.has(item.rule_id))
      .map((item) => item.reason_code),
  );
  const conditionRuleIds = new Set(
    optimization.skipped
      .filter(
        (item) =>
          relevantRuleIds.has(item.rule_id) &&
          (item.reason_code === "condition_confirmation_required" ||
            item.reason_code === "prerequisite_confirmation_required"),
      )
      .map((item) => item.rule_id),
  );
  const conditions = [
    ...new Set(
      ruleSet.rules
        .filter((rule) => conditionRuleIds.has(rule.rule_id))
        .flatMap((rule) =>
          rule.required_conditions_ja.length > 0
            ? rule.required_conditions_ja
            : [`${rule.label_ja}に必要なカード・会員資格を確認してください`],
        ),
    ),
  ].sort((left, right) => left.localeCompare(right, "ja"));
  if (conditions.length > 0)
    return {
      reason: "condition_confirmation_required",
      details: { minimum_source_amount: null, conditions },
    };

  if (skippedByReason.has("insufficient_or_unaligned_balance")) {
    const minimum = ruleSet.rules
      .filter(
        (rule) =>
          relevantRuleIds.has(rule.rule_id) &&
          rule.source_asset.asset_id === input.source_asset_id &&
          rule.minimum_source_units !== null,
      )
      .sort((left, right) =>
        left.rule_id.localeCompare(right.rule_id),
      )[0]?.minimum_source_units;
    return {
      reason: "balance_below_minimum",
      details: { minimum_source_amount: minimum ?? null, conditions: [] },
    };
  }

  if (skippedByReason.has("outside_validity_window"))
    return {
      reason: "outside_validity_window",
      details: { minimum_source_amount: null, conditions: [] },
    };

  if (
    skippedByReason.has("transfer_period_usage_unknown") ||
    skippedByReason.has("transfer_period_maximum_exceeded") ||
    skippedByReason.has("period_cap_exhausted")
  )
    return {
      reason: "period_usage_required_or_exceeded",
      details: { minimum_source_amount: null, conditions: [] },
    };

  return {
    reason: "route_unavailable",
    details: { minimum_source_amount: null, conditions: [] },
  };
}

function noRouteMessage(
  reason: PointSpendNoRouteReason,
  sourceLabel: string,
  targetLabel: string,
  details: PointSpendNoRouteDetails,
): string {
  if (reason === "source_target_not_covered")
    return `${sourceLabel}から${targetLabel}への交換ルートは、現在の収録範囲にありません。`;
  if (reason === "condition_confirmation_required")
    return details.conditions.length > 0
      ? `この交換ルートには条件の確認が必要です：${details.conditions.join("・")}`
      : "この交換ルートには条件の確認が必要です。";
  if (reason === "balance_below_minimum")
    return details.minimum_source_amount === null
      ? "現在の残高では交換条件を満たしません。"
      : `現在の残高では交換条件を満たしません。最低${details.minimum_source_amount}単位から交換できます。`;
  if (reason === "outside_validity_window")
    return "指定した日時に利用できる交換条件を確認できません。";
  if (reason === "period_usage_required_or_exceeded")
    return "対象期間の利用済み金額を確認してください。上限を超える交換は実行できません。";
  return "この残高・交換先で計算できるルートを確認できませんでした。";
}

export async function recommendPointSpend(
  raw: unknown,
  source?: RouteGraphSourcePort,
): Promise<PointSpendBrowserResult> {
  const input = parsePointSpendBrowserInput(raw);
  const bundle = await loadPointSpendBundle(source, input.effective_at);
  const { ruleSet, paymentLayers } = bundle;
  const allAssets = assets(ruleSet);
  const sourceAsset = allAssets.find(
    (candidate) => candidate.asset_id === input.source_asset_id,
  );
  if (
    !sourceAsset ||
    (input.target_asset_id !== null &&
      !allAssets.some((item) => item.asset_id === input.target_asset_id))
  )
    throw new TypeError("point_spend_asset_unknown");
  const valuation = pointValuationProfile(
    ruleSet,
    paymentLayers,
    input.target_asset_id,
    input.unit_value_jpy,
  );
  const result = optimizePointRoute({
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
    confirmed_prerequisite_ids: input.confirmed_prerequisite_ids,
    period_source_used_by_rule: input.period_source_used_by_rule,
    max_steps: 6,
    max_legs: 3,
    valuation,
  });
  const labels = new Map(
    allAssets.map((item) => [item.asset_id, item.label_ja]),
  );
  const coverage = pointSpendCoverage(ruleSet, allAssets);
  const routes = result.plans
    .slice(0, 3)
    .map((plan) => browserRoute(plan, labels));
  const noRoute =
    routes.length === 0 ? noRouteInfo(input, result, coverage, ruleSet) : null;
  return {
    version: "p0-point-spend-browser.v2",
    status: routes.length > 0 ? "ready" : "no_route",
    experimental: true,
    current_advice: false,
    objective: input.objective,
    winner: routes[0] ?? null,
    alternatives: routes.slice(1),
    message:
      routes.length > 0
        ? "収録されている交換レートで計算した候補です。実行前に提供元で条件を確認してください。"
        : noRouteMessage(
            noRoute?.reason ?? "route_unavailable",
            labels.get(input.source_asset_id) ?? "交換元",
            input.target_asset_id === null
              ? "使いみち"
              : (labels.get(input.target_asset_id) ?? "交換先"),
            noRoute?.details ?? {
              minimum_source_amount: null,
              conditions: [],
            },
          ),
    rule_count: ruleSet.rule_count,
    no_route_reason: noRoute?.reason ?? null,
    no_route_details: noRoute?.details ?? null,
    data_origin: bundle.origin,
    data_as_of: bundle.as_of,
    data_fallback_reason: bundle.fallback_reason,
    unvalued_asset_labels: Object.freeze(
      result.unvalued_asset_ids
        .map((id) => labels.get(id.split("#")[0] ?? id) ?? null)
        .filter((label): label is string => label !== null)
        .sort((left, right) => left.localeCompare(right, "ja")),
    ),
  };
}
