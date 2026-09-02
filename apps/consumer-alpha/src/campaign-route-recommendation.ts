import { types as nodeTypes } from "node:util";

import {
  type AssetDefinition,
  type AssetLot,
  type AssetRef,
  evaluateNativePlan,
  type PurchasePlan,
  type RewardRule,
  type RuleOutput,
  type Settlement,
  type UsageRestrictions,
} from "@jro/rule-engine";
import { isStrictCanonicalDateTime } from "./contracts.js";
import type {
  RouteGraphSourcePort,
  RouteGraphSourceResult,
} from "./point-spend-recommendation.js";

/** The campaign lane is intentionally smaller than the generic graph API. */
export const MAX_CAMPAIGN_ROUTE_BODY_BYTES = 4_096 as const;

export type CampaignRouteScenario =
  | "moppy_aug_2026"
  | "jal_mileage_park_rakuten";

export interface CampaignRouteBrowserInput {
  readonly scenario: CampaignRouteScenario;
  readonly effective_at: string;
  /** Defaults to the exact 12,000-point benchmark amount. */
  readonly moppy_balance_points: number | null;
  /** Advertising-earned Moppy points; null means not supplied. */
  readonly ad_earned_points: number | null;
  /** Number of this campaign exchange already used in the current month. */
  readonly monthly_exchange_count: number | null;
  /** Defaults to the exact ¥30,000 benchmark amount. */
  readonly purchase_amount_jpy: number | null;
  /** Null means that the immediate portal traversal was not confirmed. */
  readonly portal_traversal_confirmed: boolean | null;
}

export type CampaignRouteStatus = "eligible" | "conditional" | "no_valid_plan";

export type CampaignRouteReason =
  | "missing_prerequisite"
  | "monthly_limit_reached"
  | "balance_below_required"
  | "outside_validity_window"
  | "portal_traversal_required"
  | "amount_must_match_benchmark"
  | "engine_rejected"
  | null;

export interface CampaignRoutePrerequisite {
  readonly label: string;
  readonly status: "satisfied" | "missing" | "not_satisfied";
}

export interface CampaignRouteRewardCard {
  readonly kind: "principal" | "bonus" | "rebate" | "portal_reward";
  readonly label: string;
  readonly asset_id: string;
  readonly asset_label: string;
  readonly amount: string;
  readonly settlement: "posted" | "pending";
  readonly posting: string;
  readonly processing_days_min: number | null;
  readonly processing_days_max: number | null;
}

export interface CampaignRouteStep {
  readonly label: string;
  readonly source_node_id: string;
  readonly destination_node_id: string;
  readonly source_label: string;
  readonly destination_label: string;
  readonly source_amount: string;
  readonly destination_amount: string;
}

export interface CampaignRoutePlan {
  readonly label: string;
  readonly source_label: string;
  readonly source_amount: string;
  readonly steps: readonly CampaignRouteStep[];
  readonly rewards: readonly CampaignRouteRewardCard[];
  readonly prerequisites: readonly CampaignRoutePrerequisite[];
  readonly note: string;
}

export interface CampaignRouteRecommendationResult {
  readonly version: "campaign-route-recommendation.v1";
  readonly experimental: true;
  readonly current_advice: false;
  readonly scenario: CampaignRouteScenario;
  readonly effective_at: string;
  readonly status: CampaignRouteStatus;
  /** Alias kept explicit so consumers do not infer eligibility from a card. */
  readonly outcome: CampaignRouteStatus;
  readonly reason: CampaignRouteReason;
  readonly winner: CampaignRoutePlan | null;
  readonly message: string;
  readonly data_origin: "database";
  readonly data_as_of: string | null;
}

/**
 * Browser-safe campaign lane metadata.  Values are projected from the
 * source-bound native claims; the descriptor is not an independent rate
 * catalogue and contains no evidence internals.
 */
export interface CampaignRouteDescriptor {
  readonly route_id: CampaignRouteScenario;
  readonly scenario: CampaignRouteScenario;
  readonly label: string;
  readonly source_asset_id: string;
  readonly source_label: string;
  readonly source_kind: "reward_point" | "fiat";
  readonly target_asset_id: string;
  readonly target_label: string;
  readonly target_kind: "airline_mile";
  readonly principal_source_amount: string;
  readonly principal_target_amount: string;
  readonly valid_from: string | null;
  readonly valid_to: string | null;
}

interface JsonRecord {
  readonly [key: string]: unknown;
}

interface ParsedMoppyClaims {
  readonly principal: MoppyPrincipalClaim;
  readonly bonus: MoppyBonusClaim;
  readonly rebate: MoppyRebateClaim;
}

interface ParsedJalClaim {
  readonly source_units: number;
  readonly destination_units: number;
  readonly processing_time_days_min: number;
  readonly processing_time_days_max: number;
  readonly fresh_portal_traversal_required: true;
  readonly required_conditions_ja: readonly string[];
}

interface ClaimApplicability {
  readonly effective_from: string | null;
  readonly effective_to: string | null;
  readonly timezone: string;
}

interface MoppyValidity extends ClaimApplicability {
  readonly effective_from: string;
  readonly effective_to: string;
  readonly timezone: "Asia/Tokyo";
}

interface MoppyPrincipalClaim {
  readonly claim_id: "claim.campaign.moppy-jal.principal.001";
  readonly source_ids: readonly ["jp.moppy.jal-dream-campaign"];
  readonly validity: MoppyValidity;
  readonly source_asset_ref: "asset.point.moppy";
  readonly destination_asset_ref: "asset.mile.jal";
  readonly source_units_debited: 12_000;
  readonly destination_units_principal: 6_000;
  readonly minimum_ad_earned_source_units: 10_000;
  readonly separate_outputs: readonly [
    "claim.campaign.moppy-jal.jal-bonus.001",
    "claim.campaign.moppy-jal.moppy-rebate.001",
  ];
}

interface MoppyBonusClaim {
  readonly claim_id: "claim.campaign.moppy-jal.jal-bonus.001";
  readonly source_ids: readonly ["jp.jal.moppy-summer-rate-up"];
  readonly validity: MoppyValidity;
  readonly source_asset_ref: "asset.point.moppy";
  readonly destination_asset_ref: "asset.mile.jal-campaign-bonus";
  readonly base_destination_units: 6_000;
  readonly bonus_rate_percent: 20;
  readonly bonus_units: 1_200;
  readonly posting_description_ja: string;
}

interface MoppyRebateClaim {
  readonly claim_id: "claim.campaign.moppy-jal.moppy-rebate.001";
  readonly source_ids: readonly ["jp.moppy.jal-dream-campaign"];
  readonly validity: MoppyValidity;
  readonly source_asset_ref: "asset.point.moppy";
  readonly destination_asset_ref: "asset.point.moppy-campaign-rebate";
  readonly rebate_units: 4_500;
  readonly minimum_ad_earned_source_units: 10_000;
  readonly exchange_source_units: 12_000;
  readonly monthly_limit: 1;
  readonly posting_description_ja: string;
}

const MOPPY_PRINCIPAL_ID = "claim.campaign.moppy-jal.principal.001" as const;
const MOPPY_BONUS_ID = "claim.campaign.moppy-jal.jal-bonus.001" as const;
const MOPPY_REBATE_ID = "claim.campaign.moppy-jal.moppy-rebate.001" as const;
const JAL_RAKUTEN_ID =
  "claim.route.jal-mileage-park.rakuten-market.001" as const;

const MOPPY_VALID_FROM = "2026-08-01T00:00:00+09:00" as const;
const MOPPY_VALID_TO = "2026-09-01T00:00:00+09:00" as const;
const MOPPY_SOURCE_ASSET_ID = "asset.point.moppy" as const;
const MOPPY_JAL_ASSET_ID = "asset.mile.jal" as const;
const MOPPY_BONUS_ASSET_ID = "asset.mile.jal-campaign-bonus" as const;
const MOPPY_REBATE_ASSET_ID = "asset.point.moppy-campaign-rebate" as const;
const JAL_PORTAL_ID = "portal.jal-mileage-park" as const;
const JAL_RAKUTEN_MERCHANT_ID = "merchant.rakuten-market" as const;
const JAL_SPEND_ASSET_ID = "asset.value.jpy-spend" as const;
const JAL_MILE_ASSET_ID = "asset.mile.jal" as const;

const MOPPY_SOURCE_LABEL = "モッピーポイント" as const;
const JAL_MILE_LABEL = "JALマイル" as const;
const MOPPY_REBATE_LABEL = "モッピーポイント（スカイボーナス）" as const;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/u;
const CAMPAIGN_ID =
  /^(?:moppy_aug_2026|moppy_jal_aug_2026|jal_mileage_park_rakuten|jal_mileage_park_rakuten_market|moppy-jal-summer-2026-08|moppy-jal-dream-2026-08)$/u;
const ROUTE_KEY_NAMES = ["scenario", "route_id", "route"] as const;
const MOPPY_BALANCE_KEYS = [
  "moppy_balance_points",
  "moppy_balance",
  "balance",
  "source_balance",
] as const;
const AD_EARNED_KEYS = [
  "ad_earned_points",
  "ad_earned_moppy_points",
  "ad_earned_source_units",
  "moppy_ad_earned_points",
] as const;
const MONTHLY_COUNT_KEYS = [
  "monthly_exchange_count",
  "exchange_count_this_month",
  "monthly_count",
] as const;
const PURCHASE_AMOUNT_KEYS = ["purchase_amount_jpy", "amount_jpy"] as const;
const TRAVERSAL_KEYS = [
  "portal_traversal_confirmed",
  "clickout_confirmed",
  "portal_clicked",
] as const;

function invalidRequest(): TypeError {
  return new TypeError("campaign_route_request_invalid");
}

/**
 * Copy only enumerable data descriptors. This is deliberately independent of
 * JSON.stringify so a port/test double with an accessor cannot influence the
 * trusted parser.
 */
function dataRecord(value: unknown): JsonRecord {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    nodeTypes.isProxy(value)
  )
    throw new Error("campaign_route_source_malformed");
  if (
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null
  )
    throw new Error("campaign_route_source_malformed");
  if (Object.getOwnPropertySymbols(value).length > 0)
    throw new Error("campaign_route_source_malformed");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const output: Record<string, unknown> = Object.create(null) as Record<
    string,
    unknown
  >;
  for (const key of Object.keys(descriptors)) {
    const descriptor = descriptors[key];
    if (
      !descriptor ||
      descriptor.enumerable !== true ||
      !("value" in descriptor)
    )
      throw new Error("campaign_route_source_malformed");
    output[key] = descriptor.value;
  }
  return output;
}

function dataArray(value: unknown): readonly unknown[] {
  if (
    !Array.isArray(value) ||
    nodeTypes.isProxy(value) ||
    Object.getPrototypeOf(value) !== Array.prototype
  )
    throw new Error("campaign_route_source_malformed");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.getOwnPropertySymbols(value).length > 0)
    throw new Error("campaign_route_source_malformed");
  const keys = Object.keys(descriptors);
  if (keys.length !== value.length + 1 || !Object.hasOwn(descriptors, "length"))
    throw new Error("campaign_route_source_malformed");
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (
      !descriptor ||
      descriptor.enumerable !== true ||
      !("value" in descriptor)
    )
      throw new Error("campaign_route_source_malformed");
  }
  return value.map((item) => item);
}

function text(
  value: unknown,
  code = "campaign_route_source_malformed",
): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(code);
  return value;
}

function nullableText(
  value: unknown,
  code = "campaign_route_source_malformed",
): string | null {
  if (value === null) return null;
  return text(value, code);
}

function safeInteger(value: unknown, minimum = 0): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum)
    throw new Error("campaign_route_source_malformed");
  return Number(value);
}

function exactStringArray(
  value: unknown,
  expected: readonly string[],
): readonly string[] {
  const values = dataArray(value);
  if (
    values.length !== expected.length ||
    values.some(
      (item, index) => typeof item !== "string" || item !== expected[index],
    )
  )
    throw new Error("campaign_route_source_malformed");
  return Object.freeze(values.map((item) => String(item)));
}

function applicability(value: unknown): ClaimApplicability {
  const record = dataRecord(value);
  const effectiveFrom = nullableText(record.effective_from);
  const effectiveTo = nullableText(record.effective_to);
  const timezone = text(record.timezone);
  if (effectiveFrom !== null && !DATE_ONLY.test(effectiveFrom))
    throw new Error("campaign_route_source_malformed");
  if (effectiveTo !== null && !DATE_ONLY.test(effectiveTo))
    throw new Error("campaign_route_source_malformed");
  if (
    effectiveFrom !== null &&
    effectiveTo !== null &&
    effectiveFrom >= effectiveTo
  )
    throw new Error("campaign_route_source_malformed");
  return { effective_from: effectiveFrom, effective_to: effectiveTo, timezone };
}

function moppyValidity(value: unknown): MoppyValidity {
  if (dataRecord(value).status !== "current_as_observed")
    throw new Error("campaign_route_source_malformed");
  const parsed = applicability(value);
  if (
    parsed.effective_from !== "2026-08-01" ||
    parsed.effective_to !== "2026-09-01" ||
    parsed.timezone !== "Asia/Tokyo"
  )
    throw new Error("campaign_route_source_malformed");
  return {
    effective_from: parsed.effective_from,
    effective_to: parsed.effective_to,
    timezone: "Asia/Tokyo",
  };
}

function campaignValidity(value: unknown): MoppyValidity {
  const record = dataRecord(value);
  const effectiveFrom = text(record.valid_from);
  const effectiveTo = text(record.valid_to);
  const timezone = text(record.timezone);
  if (
    !DATE_ONLY.test(effectiveFrom) ||
    !DATE_ONLY.test(effectiveTo) ||
    effectiveFrom !== "2026-08-01" ||
    effectiveTo !== "2026-09-01" ||
    timezone !== "Asia/Tokyo"
  )
    throw new Error("campaign_route_source_malformed");
  return {
    effective_from: effectiveFrom,
    effective_to: effectiveTo,
    timezone: "Asia/Tokyo",
  };
}

function validityOfClaim(claim: JsonRecord): MoppyValidity {
  const parsed = moppyValidity(claim.applicability);
  const value = dataRecord(claim.value);
  const campaign = dataRecord(value.campaign);
  const validity = campaignValidity(campaign.validity);
  if (
    validity.effective_from !== parsed.effective_from ||
    validity.effective_to !== parsed.effective_to ||
    validity.timezone !== parsed.timezone
  )
    throw new Error("campaign_route_source_malformed");
  return validity;
}

function claimEnvelope(
  value: unknown,
  claimId: string,
  familyId: string,
  claimType: string,
  predicate: string,
  sourceIds: readonly string[],
  subject: string,
): JsonRecord {
  const claim = dataRecord(value);
  if (
    claim.claim_id !== claimId ||
    claim.family_id !== familyId ||
    claim.source_role_id !== "earn_rules" ||
    claim.claim_type !== claimType ||
    claim.predicate !== predicate ||
    claim.subject !== subject
  )
    throw new Error("campaign_route_source_malformed");
  exactStringArray(claim.source_ids, sourceIds);
  text(claim.subject);
  return claim;
}

function campaignShape(claim: JsonRecord): JsonRecord {
  const value = dataRecord(claim.value);
  const campaign = dataRecord(value.campaign);
  const lottery = dataRecord(campaign.lottery);
  if (
    lottery.status !== "information_only" ||
    lottery.included_in_arithmetic !== false ||
    campaign.executable !== false ||
    typeof campaign.non_executable_reason !== "string"
  )
    throw new Error("campaign_route_source_malformed");
  campaignValidity(campaign.validity);
  return campaign;
}

function parseMoppyPrincipal(value: unknown): MoppyPrincipalClaim {
  const claim = claimEnvelope(
    value,
    MOPPY_PRINCIPAL_ID,
    "point.moppy",
    "campaign_rule",
    "campaign_principal_exchange",
    ["jp.moppy.jal-dream-campaign"],
    "Moppy → JALマイル（本体交換）",
  );
  const validity = validityOfClaim(claim);
  const campaign = campaignShape(claim);
  if (
    campaign.campaign_id !== "moppy-jal-dream-2026-08" ||
    campaign.output_kind !== "principal_exchange" ||
    campaign.operation !== "transfer" ||
    campaign.source_asset_ref !== MOPPY_SOURCE_ASSET_ID ||
    campaign.destination_asset_ref !== MOPPY_JAL_ASSET_ID ||
    safeInteger(campaign.source_units_debited) !== 12_000 ||
    safeInteger(campaign.destination_units_principal) !== 6_000
  )
    throw new Error("campaign_route_source_malformed");
  const prerequisite = dataRecord(campaign.bonus_prerequisite);
  if (
    safeInteger(prerequisite.minimum_ad_earned_source_units) !== 10_000 ||
    prerequisite.source_asset_origin !== "advertising_only" ||
    prerequisite.must_be_earned_before_exchange !== true
  )
    throw new Error("campaign_route_source_malformed");
  const separateOutputs = exactStringArray(campaign.separate_outputs, [
    MOPPY_BONUS_ID,
    MOPPY_REBATE_ID,
  ]);
  return {
    claim_id: MOPPY_PRINCIPAL_ID,
    source_ids: ["jp.moppy.jal-dream-campaign"],
    validity,
    source_asset_ref: MOPPY_SOURCE_ASSET_ID,
    destination_asset_ref: MOPPY_JAL_ASSET_ID,
    source_units_debited: 12_000,
    destination_units_principal: 6_000,
    minimum_ad_earned_source_units: 10_000,
    separate_outputs:
      separateOutputs as MoppyPrincipalClaim["separate_outputs"],
  };
}

function parseMoppyBonus(value: unknown): MoppyBonusClaim {
  const claim = claimEnvelope(
    value,
    MOPPY_BONUS_ID,
    "portal.jal-mileage-park",
    "campaign_rule",
    "campaign_jal_bonus_posting",
    ["jp.jal.moppy-summer-rate-up"],
    "Moppy → JALマイル（20%増量分）",
  );
  const validity = validityOfClaim(claim);
  const campaign = campaignShape(claim);
  const posting = dataRecord(campaign.posting);
  if (
    campaign.campaign_id !== "moppy-jal-summer-2026-08" ||
    campaign.output_kind !== "pending_bonus" ||
    campaign.source_asset_ref !== MOPPY_SOURCE_ASSET_ID ||
    campaign.destination_asset_ref !== MOPPY_BONUS_ASSET_ID ||
    safeInteger(campaign.base_destination_units) !== 6_000 ||
    safeInteger(campaign.bonus_rate_percent) !== 20 ||
    safeInteger(campaign.bonus_units) !== 1_200
  )
    throw new Error("campaign_route_source_malformed");
  return {
    claim_id: MOPPY_BONUS_ID,
    source_ids: ["jp.jal.moppy-summer-rate-up"],
    validity,
    source_asset_ref: MOPPY_SOURCE_ASSET_ID,
    destination_asset_ref: MOPPY_BONUS_ASSET_ID,
    base_destination_units: 6_000,
    bonus_rate_percent: 20,
    bonus_units: 1_200,
    posting_description_ja: text(posting.description_ja),
  };
}

function parseMoppyRebate(value: unknown): MoppyRebateClaim {
  const claim = claimEnvelope(
    value,
    MOPPY_REBATE_ID,
    "point.moppy",
    "campaign_rule",
    "campaign_moppy_rebate_posting",
    ["jp.moppy.jal-dream-campaign"],
    "Moppy JALドリームキャンペーン スカイボーナス",
  );
  const validity = validityOfClaim(claim);
  const campaign = campaignShape(claim);
  const posting = dataRecord(campaign.posting);
  if (
    campaign.campaign_id !== "moppy-jal-dream-2026-08" ||
    campaign.output_kind !== "pending_rebate" ||
    campaign.source_asset_ref !== MOPPY_SOURCE_ASSET_ID ||
    campaign.destination_asset_ref !== MOPPY_REBATE_ASSET_ID ||
    safeInteger(campaign.rebate_units) !== 4_500
  )
    throw new Error("campaign_route_source_malformed");
  const eligibility = dataRecord(campaign.eligibility);
  if (
    safeInteger(eligibility.minimum_ad_earned_source_units) !== 10_000 ||
    eligibility.source_asset_origin !== "advertising_only" ||
    eligibility.must_be_earned_before_exchange !== true ||
    safeInteger(eligibility.exchange_source_units) !== 12_000 ||
    safeInteger(eligibility.monthly_limit) !== 1
  )
    throw new Error("campaign_route_source_malformed");
  return {
    claim_id: MOPPY_REBATE_ID,
    source_ids: ["jp.moppy.jal-dream-campaign"],
    validity,
    source_asset_ref: MOPPY_SOURCE_ASSET_ID,
    destination_asset_ref: MOPPY_REBATE_ASSET_ID,
    rebate_units: 4_500,
    minimum_ad_earned_source_units: 10_000,
    exchange_source_units: 12_000,
    monthly_limit: 1,
    posting_description_ja: text(posting.description_ja),
  };
}

function parseJalRakuten(value: unknown): ParsedJalClaim {
  const claim = claimEnvelope(
    value,
    JAL_RAKUTEN_ID,
    "portal.jal-mileage-park",
    "earn_rule",
    "portal_earn_rate_and_posting",
    ["jp.jal.mileage-park-rakuten-market"],
    "JALマイレージパーク → 楽天市場",
  );
  const applicabilityValue = dataRecord(claim.applicability);
  // This route is current but has no declared campaign validity bounds.
  const current = applicability(claim.applicability);
  if (
    applicabilityValue.status !== "current_as_observed" ||
    current.effective_from !== null ||
    current.effective_to !== null ||
    current.timezone !== "Asia/Tokyo"
  )
    throw new Error("campaign_route_source_malformed");
  const valueRecord = dataRecord(claim.value);
  if (
    valueRecord.operation !== "portal_earn" ||
    valueRecord.source_asset_ref !== JAL_SPEND_ASSET_ID ||
    valueRecord.destination_asset_ref !== JAL_MILE_ASSET_ID ||
    safeInteger(valueRecord.source_units) !== 300 ||
    safeInteger(valueRecord.destination_units) !== 1 ||
    safeInteger(valueRecord.processing_time_days_min) !== 90 ||
    safeInteger(valueRecord.processing_time_days_max) !== 120 ||
    valueRecord.fresh_portal_traversal_required !== true
  )
    throw new Error("campaign_route_source_malformed");
  const conditions = dataArray(valueRecord.required_conditions_ja);
  if (
    conditions.length !== 1 ||
    conditions[0] !==
      "購入直前にJALマイレージパークから楽天市場へ遷移してください"
  )
    throw new Error("campaign_route_source_malformed");
  exactStringArray(valueRecord.prerequisite_ids, []);
  return {
    source_units: 300,
    destination_units: 1,
    processing_time_days_min: 90,
    processing_time_days_max: 120,
    fresh_portal_traversal_required: true,
    required_conditions_ja: Object.freeze([String(conditions[0])]),
  };
}

function assertMoppyConsistency(claims: ParsedMoppyClaims): void {
  const validity = JSON.stringify(claims.principal.validity);
  if (
    JSON.stringify(claims.bonus.validity) !== validity ||
    JSON.stringify(claims.rebate.validity) !== validity ||
    claims.principal.source_asset_ref !== claims.bonus.source_asset_ref ||
    claims.principal.source_asset_ref !== claims.rebate.source_asset_ref ||
    claims.principal.destination_units_principal !==
      claims.bonus.base_destination_units ||
    claims.principal.source_units_debited !==
      claims.rebate.exchange_source_units ||
    claims.principal.minimum_ad_earned_source_units !==
      claims.rebate.minimum_ad_earned_source_units
  )
    throw new Error("campaign_route_source_inconsistent");
}

async function loadCampaignClaimMap(
  source: CampaignRouteSourcePort,
  effectiveAt: string,
): Promise<{
  readonly found: ReadonlyMap<string, unknown>;
  readonly data_as_of: string | null;
}> {
  const loaded: RouteGraphSourceResult = await source.current(effectiveAt);
  const result = dataRecord(loaded);
  const artifacts = dataArray(result.artifacts);
  if (artifacts.length === 0 || artifacts.length > 16)
    throw new Error("campaign_route_source_empty");
  const provenance = dataArray(result.provenance);
  if (provenance.length === 0 || provenance.length > 16)
    throw new Error("campaign_route_source_malformed");
  for (const item of provenance) {
    const record = dataRecord(item);
    text(record.research_artifact_id);
    text(record.implementation_version);
    text(record.implementation_hash);
    const provenanceAsOf = text(record.as_of);
    if (!Number.isFinite(Date.parse(provenanceAsOf)))
      throw new Error("campaign_route_source_malformed");
    safeInteger(record.claim_count, 1);
  }
  const found = new Map<string, unknown>();
  for (const artifact of artifacts) {
    const artifactRecord = dataRecord(artifact);
    const claims = dataArray(artifactRecord.claims);
    if (claims.length === 0 || claims.length > 2_048)
      throw new Error("campaign_route_source_malformed");
    for (const claim of claims) {
      const claimRecord = dataRecord(claim);
      const claimId = claimRecord.claim_id;
      if (typeof claimId !== "string") continue;
      if (
        claimId === MOPPY_PRINCIPAL_ID ||
        claimId === MOPPY_BONUS_ID ||
        claimId === MOPPY_REBATE_ID ||
        claimId === JAL_RAKUTEN_ID
      ) {
        if (found.has(claimId))
          throw new Error("campaign_route_source_duplicate");
        found.set(claimId, claimRecord);
      }
    }
  }
  const asOfValue = result.as_of;
  const dataAsOf = asOfValue === null ? null : text(asOfValue);
  if (dataAsOf !== null && !Number.isFinite(Date.parse(dataAsOf)))
    throw new Error("campaign_route_source_malformed");
  return { found, data_as_of: dataAsOf };
}

async function loadCampaignClaims(
  source: CampaignRouteSourcePort,
  effectiveAt: string,
): Promise<{
  readonly moppy: ParsedMoppyClaims;
  readonly jal: ParsedJalClaim;
  readonly data_as_of: string | null;
}> {
  const { found, data_as_of } = await loadCampaignClaimMap(source, effectiveAt);
  if (
    !found.has(MOPPY_PRINCIPAL_ID) ||
    !found.has(MOPPY_BONUS_ID) ||
    !found.has(MOPPY_REBATE_ID) ||
    !found.has(JAL_RAKUTEN_ID)
  )
    throw new Error("campaign_route_source_incomplete");
  const moppy = {
    principal: parseMoppyPrincipal(found.get(MOPPY_PRINCIPAL_ID)),
    bonus: parseMoppyBonus(found.get(MOPPY_BONUS_ID)),
    rebate: parseMoppyRebate(found.get(MOPPY_REBATE_ID)),
  };
  assertMoppyConsistency(moppy);
  return {
    moppy,
    jal: parseJalRakuten(found.get(JAL_RAKUTEN_ID)),
    data_as_of,
  };
}

async function loadCampaignDescriptorClaims(
  source: CampaignRouteSourcePort,
  effectiveAt: string,
): Promise<{
  readonly moppy: ParsedMoppyClaims | null;
  readonly jal: ParsedJalClaim;
}> {
  const { found } = await loadCampaignClaimMap(source, effectiveAt);
  const moppyClaimCount = [
    MOPPY_PRINCIPAL_ID,
    MOPPY_BONUS_ID,
    MOPPY_REBATE_ID,
  ].filter((claimId) => found.has(claimId)).length;
  if (
    !found.has(JAL_RAKUTEN_ID) ||
    (moppyClaimCount !== 0 && moppyClaimCount !== 3) ||
    (inMoppyWindow(effectiveAt) && moppyClaimCount !== 3)
  )
    throw new Error("campaign_route_source_incomplete");
  const moppy =
    moppyClaimCount === 0
      ? null
      : {
          principal: parseMoppyPrincipal(found.get(MOPPY_PRINCIPAL_ID)),
          bonus: parseMoppyBonus(found.get(MOPPY_BONUS_ID)),
          rebate: parseMoppyRebate(found.get(MOPPY_REBATE_ID)),
        };
  if (moppy !== null) assertMoppyConsistency(moppy);
  return {
    moppy,
    jal: parseJalRakuten(found.get(JAL_RAKUTEN_ID)),
  };
}

/**
 * Return the bounded campaign lanes exposed beside the generic point graph.
 * The source is mandatory here: labels, amounts, and validity are admitted
 * only after the same claim parser used by the native evaluator succeeds.
 */
export async function listCampaignRouteDescriptors(
  source: CampaignRouteSourcePort,
  effectiveAt = new Date().toISOString(),
): Promise<readonly CampaignRouteDescriptor[]> {
  const claims = await loadCampaignDescriptorClaims(source, effectiveAt);
  return Object.freeze([
    ...(claims.moppy === null
      ? []
      : [
          {
            route_id: "moppy_aug_2026" as const,
            scenario: "moppy_aug_2026" as const,
            label: "モッピーからJALマイルへ交換",
            source_asset_id: claims.moppy.principal.source_asset_ref,
            source_label: MOPPY_SOURCE_LABEL,
            source_kind: "reward_point" as const,
            target_asset_id: claims.moppy.principal.destination_asset_ref,
            target_label: JAL_MILE_LABEL,
            target_kind: "airline_mile" as const,
            principal_source_amount: String(
              claims.moppy.principal.source_units_debited,
            ),
            principal_target_amount: String(
              claims.moppy.principal.destination_units_principal,
            ),
            valid_from: claims.moppy.principal.validity.effective_from,
            valid_to: claims.moppy.principal.validity.effective_to,
          },
        ]),
    {
      route_id: "jal_mileage_park_rakuten" as const,
      scenario: "jal_mileage_park_rakuten" as const,
      label: "JALマイレージパーク経由で楽天市場を利用",
      source_asset_id: JAL_SPEND_ASSET_ID,
      source_label: "日本円での支出",
      source_kind: "fiat" as const,
      target_asset_id: JAL_MILE_ASSET_ID,
      target_label: JAL_MILE_LABEL,
      target_kind: "airline_mile" as const,
      principal_source_amount: String(claims.jal.source_units),
      principal_target_amount: String(claims.jal.destination_units),
      valid_from: null,
      valid_to: null,
    },
  ] satisfies readonly CampaignRouteDescriptor[]);
}

function recordInput(value: unknown): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    nodeTypes.isProxy(value)
  )
    throw invalidRequest();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.getOwnPropertySymbols(value).length > 0) throw invalidRequest();
  const output: Record<string, unknown> = Object.create(null) as Record<
    string,
    unknown
  >;
  for (const key of Object.keys(descriptors)) {
    const descriptor = descriptors[key];
    if (
      !descriptor ||
      descriptor.enumerable !== true ||
      !("value" in descriptor)
    )
      throw invalidRequest();
    output[key] = descriptor.value;
  }
  return output;
}

function firstPresent(
  record: Record<string, unknown>,
  keys: readonly string[],
): unknown {
  const present = keys.filter((key) => Object.hasOwn(record, key));
  if (present.length > 1) throw invalidRequest();
  return present.length === 0 ? undefined : record[present[0] as string];
}

function canonicalScenario(value: unknown): CampaignRouteScenario {
  if (typeof value !== "string" || !CAMPAIGN_ID.test(value))
    throw invalidRequest();
  if (
    value === "jal_mileage_park_rakuten" ||
    value === "jal_mileage_park_rakuten_market"
  )
    return "jal_mileage_park_rakuten";
  return "moppy_aug_2026";
}

function optionalCount(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < 0 ||
    Number(value) > 1_000_000_000
  )
    throw invalidRequest();
  return Number(value);
}

function optionalBoolean(value: unknown): boolean | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "boolean") throw invalidRequest();
  return value;
}

export function parseCampaignRouteBrowserInput(
  value: unknown,
): CampaignRouteBrowserInput {
  const record = recordInput(value);
  const routeKeys = ROUTE_KEY_NAMES.filter((key) => Object.hasOwn(record, key));
  if (routeKeys.length !== 1) throw invalidRequest();
  const scenario = canonicalScenario(record[routeKeys[0] as string]);
  const effectiveAt = record.effective_at;
  if (
    typeof effectiveAt !== "string" ||
    !isStrictCanonicalDateTime(effectiveAt)
  )
    throw invalidRequest();
  const allowed = new Set<string>([
    ...ROUTE_KEY_NAMES,
    "effective_at",
    ...MOPPY_BALANCE_KEYS,
    ...AD_EARNED_KEYS,
    ...MONTHLY_COUNT_KEYS,
    ...PURCHASE_AMOUNT_KEYS,
    ...TRAVERSAL_KEYS,
  ]);
  if (Object.keys(record).some((key) => !allowed.has(key)))
    throw invalidRequest();
  const moppyBalance = optionalCount(firstPresent(record, MOPPY_BALANCE_KEYS));
  const adEarned = optionalCount(firstPresent(record, AD_EARNED_KEYS));
  const monthlyCount = optionalCount(firstPresent(record, MONTHLY_COUNT_KEYS));
  const purchaseAmount = optionalCount(
    firstPresent(record, PURCHASE_AMOUNT_KEYS),
  );
  const traversal = optionalBoolean(firstPresent(record, TRAVERSAL_KEYS));
  if (scenario === "moppy_aug_2026") {
    if (purchaseAmount !== null || traversal !== null) throw invalidRequest();
  } else if (
    moppyBalance !== null ||
    adEarned !== null ||
    monthlyCount !== null
  ) {
    throw invalidRequest();
  }
  return Object.freeze({
    scenario,
    effective_at: effectiveAt,
    moppy_balance_points: moppyBalance,
    ad_earned_points: adEarned,
    monthly_exchange_count: monthlyCount,
    purchase_amount_jpy: purchaseAmount,
    portal_traversal_confirmed: traversal,
  });
}

function asset(
  assetId: string,
  kind: AssetRef["asset_kind"],
  programId: string,
  rewardClass: AssetRef["reward_class"],
): AssetRef {
  return {
    asset_id: assetId,
    asset_kind: kind,
    program_id: programId,
    reward_class: rewardClass,
    scale: 0,
  };
}

const moppyAsset = asset(
  MOPPY_SOURCE_ASSET_ID,
  "reward_point",
  "program.moppy",
  "normal",
);
const jalAsset = asset(
  JAL_MILE_ASSET_ID,
  "airline_mile",
  "program.jal",
  "normal",
);
const jalBonusAsset = asset(
  MOPPY_BONUS_ASSET_ID,
  "airline_mile",
  "program.jal",
  "pending",
);
const moppyRebateAsset = asset(
  MOPPY_REBATE_ASSET_ID,
  "reward_point",
  "program.moppy",
  "pending",
);
const jpySpendAsset = asset(JAL_SPEND_ASSET_ID, "fiat", "program.jpy", null);

const noExpiry = {
  policy: "none" as const,
  expires_at: null,
  duration_days: null,
  timezone: "Asia/Tokyo",
};

const transferRestrictions: UsageRestrictions = {
  transferable: true,
  redeemable_for_cash: false,
  usable_for_payment: true,
  investable: false,
  permitted_destination_ids: [],
  notes: "キャンペーン route の trusted host 内部資産です。",
};

function assetDefinition(ref: AssetRef, displayName: string): AssetDefinition {
  return {
    asset_id: ref.asset_id,
    asset_kind: ref.asset_kind,
    display_name: displayName,
    program_id: ref.program_id,
    scale: ref.scale,
    default_reward_class: ref.reward_class,
    default_expiry: noExpiry,
    default_usage_restrictions: transferRestrictions,
    status: "active",
    notes: "Campaign route host definition.",
  };
}

function settlement(
  status: Settlement["status"],
  from: string | null = null,
  to: string | null = null,
): Settlement {
  return {
    status,
    expected_posting_from: from,
    expected_posting_to: to,
    posted_at: status === "posted" ? null : null,
  };
}

function output(
  ref: AssetRef,
  settlementValue: Settlement,
  notes: string,
): RuleOutput {
  return {
    asset: ref,
    sign: "credit",
    certainty: {
      type: "guaranteed",
      probability: null,
      probability_source: null,
    },
    settlement: settlementValue,
    expiry: noExpiry,
    restrictions: {
      ...transferRestrictions,
      transferable:
        ref.asset_kind === "airline_mile" || ref.asset_kind === "reward_point",
      usable_for_payment: false,
      notes,
    },
    clawback: {
      on_refund: "provider_defined",
      posting_delay_days: null,
      notes: "キャンペーン付与の取消条件は提供元に従います。",
    },
  };
}

function validity(
  validFrom: string,
  validTo: string | null,
  recordedAt: string,
) {
  return {
    valid_from: validFrom,
    valid_to: validTo,
    timezone: "Asia/Tokyo",
    recorded_at: recordedAt,
    superseded_at: null,
  } as const;
}

function experimentalAudit() {
  return {
    created_at: "2026-08-24T00:00:00+09:00",
    created_by: "campaign-route-host",
    review_events: [] as RewardRule["audit"]["review_events"],
    required_review_modes: [
      "solo_dual_pass",
    ] as RewardRule["audit"]["required_review_modes"],
    review_mode: null,
    reviewed_at: null,
    reviewed_by: null,
    change_reason: "Campaign benchmark host binding.",
  } as const;
}

function experimentalProvenance(evidenceIds: readonly string[]) {
  return {
    evidence_ids: evidenceIds.map(
      (_, index) => `ev_campaign_route_${index + 1}`,
    ) as string[],
    minimum_source_tier: "T1_CANONICAL",
    confidence: 0.5,
    human_verified: false,
    review_notes: "実験用の source-bound claim です。",
  } as const;
}

function baseRule(
  ruleId: string,
  ruleType: string,
  name: string,
  operationTypes: RewardRule["scope"]["operation_types"],
  channels: RewardRule["scope"]["channels"],
  recordedAt: string,
  evidenceIds: readonly string[],
): RewardRule {
  return {
    rule_id: ruleId,
    version: 1,
    status: "under_review",
    rule_type: ruleType,
    name,
    description: "Trusted host campaign route rule.",
    subject: { entity_type: "campaign", entity_id: ruleId },
    scope: {
      countries: ["JP"],
      operation_types: operationTypes,
      merchant_ids: [],
      excluded_merchant_ids: [],
      merchant_group_ids: [],
      excluded_merchant_group_ids: [],
      merchant_location_ids: [],
      excluded_merchant_location_ids: [],
      merchant_category_codes: [],
      excluded_merchant_category_codes: [],
      channels,
      included_product_classes: [],
      excluded_product_classes: [],
      tax_basis: "not_applicable",
    },
    eligibility: {
      operation_match: {},
      user_conditions: [],
      transaction_conditions: {
        eligible_amount_basis: "operation_amount",
        requires_single_operation: true,
      },
      campaign_conditions: {
        campaign_id: null,
        entry_required: false,
        entry_deadline: null,
        targeted_offer: false,
        identity_verification_required: false,
        first_use_only: false,
      },
    },
    caps: [],
    stacking: {
      stack_group: ruleId,
      mode: "additive",
      precedence: 0,
      conflicts_with_rule_ids: [],
      requires_rule_ids: [],
      notes: "",
    },
    validity: validity("2026-01-01T00:00:00+09:00", null, recordedAt),
    provenance: experimentalProvenance(evidenceIds),
    audit: experimentalAudit(),
  };
}

function userConditions() {
  return [
    {
      fact_key: "campaign.moppy.ad_earned_source_units",
      operator: "gte" as const,
      value: 10_000,
      unknown_policy: "return_conditional" as const,
    },
  ];
}

function moppyRules(
  claims: ParsedMoppyClaims,
  effectiveAt: string,
): readonly RewardRule[] {
  const principal = baseRule(
    "rr_campaign_moppy_jal_principal",
    "transfer",
    "MoppyからJALマイルへの本体交換",
    ["point_transfer"],
    ["transfer"],
    effectiveAt,
    claims.principal.source_ids,
  );
  principal.scope.merchant_ids = [];
  principal.eligibility.operation_match = {
    allowed_source_asset_ids: [MOPPY_SOURCE_ASSET_ID],
    allowed_destination_asset_ids: [MOPPY_JAL_ASSET_ID],
  };
  principal.eligibility.campaign_conditions = {
    campaign_id: "moppy-jal-dream-2026-08",
    entry_required: false,
    entry_deadline: MOPPY_VALID_TO,
    targeted_offer: false,
    identity_verification_required: false,
    first_use_only: false,
  };
  principal.calculation = {
    model: "transfer_ratio",
    source_asset: moppyAsset,
    destination_asset: jalAsset,
    source_units: "12000",
    destination_units: "6000",
    minimum_source_units: "12000",
    increment_source_units: "12000",
    maximum_source_units_per_request: null,
    maximum_source_units_per_period: null,
    maximum_period: null,
    fee: null,
    rounding: {
      aggregation_scope: "transfer_request",
      eligible_spend_quantum_jpy: null,
      reward_rounding_mode: "exact",
    },
    processing_time_days_min: null,
    processing_time_days_max: null,
    cancellation_policy: "provider_defined",
    bonus_rule_ids: [
      "rr_campaign_moppy_jal_bonus",
      "rr_campaign_moppy_jal_rebate",
    ],
  };
  principal.output = output(
    jalAsset,
    settlement("posted"),
    "JALマイル本体交換分です。増量分とは別に表示します。",
  );
  principal.validity = validity(MOPPY_VALID_FROM, MOPPY_VALID_TO, effectiveAt);

  const bonus = baseRule(
    "rr_campaign_moppy_jal_bonus",
    "campaign_bonus",
    "Moppy JALキャンペーン増量分",
    ["point_transfer"],
    ["transfer"],
    effectiveAt,
    claims.bonus.source_ids,
  );
  bonus.eligibility.operation_match = {
    allowed_source_asset_ids: [MOPPY_SOURCE_ASSET_ID],
  };
  bonus.eligibility.user_conditions = userConditions();
  bonus.eligibility.campaign_conditions = {
    campaign_id: "moppy-jal-summer-2026-08",
    entry_required: false,
    entry_deadline: MOPPY_VALID_TO,
    targeted_offer: false,
    identity_verification_required: false,
    first_use_only: false,
  };
  bonus.calculation = {
    model: "fixed",
    reward_units: "1200",
    rounding: {
      aggregation_scope: "per_operation",
      eligible_spend_quantum_jpy: null,
      reward_rounding_mode: "exact",
    },
  };
  bonus.output = output(
    jalBonusAsset,
    settlement(
      "pending",
      "2026-09-30T00:00:00+09:00",
      "2026-10-01T00:00:00+09:00",
    ),
    "JALマイルの後日積算分です。",
  );
  bonus.validity = validity(MOPPY_VALID_FROM, MOPPY_VALID_TO, effectiveAt);

  const rebate = baseRule(
    "rr_campaign_moppy_jal_rebate",
    "campaign_bonus",
    "Moppy JALキャンペーン スカイボーナス",
    ["point_transfer"],
    ["transfer"],
    effectiveAt,
    claims.rebate.source_ids,
  );
  rebate.eligibility.operation_match = {
    allowed_source_asset_ids: [MOPPY_SOURCE_ASSET_ID],
  };
  rebate.eligibility.user_conditions = userConditions();
  rebate.eligibility.campaign_conditions = {
    campaign_id: "moppy-jal-dream-2026-08",
    entry_required: false,
    entry_deadline: MOPPY_VALID_TO,
    targeted_offer: false,
    identity_verification_required: false,
    first_use_only: false,
  };
  rebate.calculation = {
    model: "fixed",
    reward_units: "4500",
    rounding: {
      aggregation_scope: "per_operation",
      eligible_spend_quantum_jpy: null,
      reward_rounding_mode: "exact",
    },
  };
  rebate.caps = [
    {
      cap_id: "cap_campaign_moppy_jal_monthly_once",
      cap_type: "per_month",
      max_reward_units: "4500",
      max_eligible_spend_jpy: null,
      shared_cap_group: null,
      progress_source: "user_input",
      reset: { period: "month", timezone: "Asia/Tokyo", boundary: "calendar" },
      partial_consumption: false,
      unknown_progress_policy: "ask_user",
    },
  ];
  rebate.output = output(
    moppyRebateAsset,
    settlement(
      "pending",
      "2026-09-30T00:00:00+09:00",
      "2026-10-01T00:00:00+09:00",
    ),
    "モッピーポイントとして翌月末頃に付与される別出力です。",
  );
  rebate.validity = validity(MOPPY_VALID_FROM, MOPPY_VALID_TO, effectiveAt);
  return Object.freeze([principal, bonus, rebate]);
}

function jalRule(claim: ParsedJalClaim, effectiveAt: string): RewardRule {
  const rule = baseRule(
    "rr_campaign_jal_mileage_park_rakuten",
    "campaign_bonus",
    "JALマイレージパーク 楽天市場利用分",
    ["merchant_purchase"],
    ["online"],
    effectiveAt,
    ["jp.jal.mileage-park-rakuten-market"],
  );
  rule.scope.merchant_ids = [JAL_RAKUTEN_MERCHANT_ID];
  rule.eligibility.operation_match = {
    must_present_before_payment: true,
  };
  rule.eligibility.campaign_conditions = {
    campaign_id: null,
    entry_required: false,
    entry_deadline: null,
    targeted_offer: false,
    identity_verification_required: false,
    first_use_only: false,
  };
  rule.calculation = {
    model: "points_per_unit",
    reward_units: "1",
    spend_jpy: 300,
    rounding: {
      aggregation_scope: "per_operation",
      eligible_spend_quantum_jpy: 300,
      reward_rounding_mode: "floor",
    },
  };
  const start = new Date(
    Date.parse(effectiveAt) + claim.processing_time_days_min * 86_400_000,
  ).toISOString();
  const end = new Date(
    Date.parse(effectiveAt) + claim.processing_time_days_max * 86_400_000,
  ).toISOString();
  rule.output = output(
    jalAsset,
    settlement("pending", start, end),
    "JALマイルは後日積算です。",
  );
  return rule;
}

function openingLot(
  ref: AssetRef,
  amount: number,
  lotId: string,
  acquiredAt: string,
): AssetLot {
  return {
    lot_id: lotId,
    quantity: { asset: ref, amount: String(amount) },
    acquired_at: acquiredAt,
    source_operation_id: null,
    settlement: settlement("posted"),
    expiry: noExpiry,
    restrictions: transferRestrictions,
    provenance_rule_ids: [],
  };
}

function moppyPlan(effectiveAt: string, balance: number): PurchasePlan {
  return {
    plan_id: "plan_campaign_moppy_jal_aug_2026",
    operations: [
      {
        operation_id: "op_campaign_moppy_jal_exchange",
        sequence: 1,
        occurred_at: effectiveAt,
        operation_type: "point_transfer",
        merchant_id: null,
        merchant_location_id: null,
        channel: "transfer",
        interface: "manual_transfer",
        payment_instrument_id: null,
        funding_source_id: null,
        amount_jpy: null,
        asset_inputs: [
          {
            input_id: "in_campaign_moppy_points",
            source_lot_id: "lot_campaign_moppy_points",
            quantity: { asset: moppyAsset, amount: "12000" },
            role: "transfer_source",
          },
        ],
        output_requests: [
          {
            request_id: "out_campaign_jal_principal",
            created_lot_id: "lot_campaign_jal_principal",
            asset: jalAsset,
            requested_amount: "6000",
            role: "transfer_destination",
          },
        ],
        original_operation_id: null,
        portal_id: null,
        line_items: [],
        notes: `Moppy ${balance}ポイントからキャンペーン交換分12,000ポイントを使用します。`,
      },
    ],
    dependencies: [],
    loyalty_presentments: [],
    assumptions: [
      "本体・JAL増量分・モッピーリベートは別々の出力として扱います。",
      "抽選特典は算術に含めません。",
    ],
  };
}

function jalPlan(effectiveAt: string, amount: number): PurchasePlan {
  return {
    plan_id: "plan_campaign_jal_mileage_park_rakuten",
    operations: [
      {
        operation_id: "op_campaign_jal_mileage_park_clickout",
        sequence: 1,
        occurred_at: effectiveAt,
        operation_type: "portal_clickout",
        merchant_id: JAL_RAKUTEN_MERCHANT_ID,
        merchant_location_id: null,
        channel: "portal_clickout",
        interface: "portal_redirect",
        payment_instrument_id: null,
        funding_source_id: null,
        amount_jpy: null,
        asset_inputs: [],
        output_requests: [],
        original_operation_id: null,
        portal_id: JAL_PORTAL_ID,
        line_items: [],
        notes: "購入直前のJALマイレージパーク clickout。",
      },
      {
        operation_id: "op_campaign_jal_rakuten_purchase",
        sequence: 2,
        occurred_at: effectiveAt,
        operation_type: "merchant_purchase",
        merchant_id: JAL_RAKUTEN_MERCHANT_ID,
        merchant_location_id: null,
        channel: "online",
        interface: "web_checkout",
        payment_instrument_id: "instrument.jpy-spend",
        funding_source_id: "funding.jpy-spend",
        amount_jpy: amount,
        asset_inputs: [
          {
            input_id: "in_campaign_jal_rakuten_spend",
            source_lot_id: null,
            quantity: { asset: jpySpendAsset, amount: String(amount) },
            role: "external_funding",
          },
        ],
        output_requests: [],
        original_operation_id: null,
        portal_id: JAL_PORTAL_ID,
        line_items: [
          {
            line_item_id: "line_campaign_jal_rakuten",
            product_class: "ordinary_goods",
            amount_jpy: amount,
            tax_exclusive_amount_jpy: null,
            quantity: 1,
            eligible_for_rewards: true,
          },
        ],
        notes:
          "楽天市場での購入金額。JALマイレージパークの clickout attribution が必要です。",
      },
    ],
    dependencies: [
      {
        from_operation_id: "op_campaign_jal_mileage_park_clickout",
        to_operation_id: "op_campaign_jal_rakuten_purchase",
        dependency_type: "attribution",
      },
    ],
    loyalty_presentments: [],
    assumptions: [
      "購入直前のポータル遷移を行った場合のみJALマイルを計算します。",
    ],
  };
}

function moppyPrerequisites(
  input: CampaignRouteBrowserInput,
): readonly CampaignRoutePrerequisite[] {
  return Object.freeze([
    {
      label: "広告利用で獲得したモッピーポイント10,000ポイント以上",
      status:
        input.ad_earned_points === null
          ? ("missing" as const)
          : input.ad_earned_points >= 10_000
            ? ("satisfied" as const)
            : ("not_satisfied" as const),
    },
    {
      label: "キャンペーン交換は対象月に1回まで",
      status:
        input.monthly_exchange_count === null
          ? ("missing" as const)
          : input.monthly_exchange_count < 1
            ? ("satisfied" as const)
            : ("not_satisfied" as const),
    },
  ]);
}

/** Browser-safe prerequisite projection shared by the unified point route. */
export function campaignRoutePrerequisites(
  input: CampaignRouteBrowserInput,
): readonly CampaignRoutePrerequisite[] {
  if (input.scenario === "moppy_aug_2026") return moppyPrerequisites(input);
  return Object.freeze([
    {
      label: "購入直前にJALマイレージパークから楽天市場へ遷移してください",
      status:
        input.portal_traversal_confirmed === null
          ? ("missing" as const)
          : input.portal_traversal_confirmed
            ? ("satisfied" as const)
            : ("not_satisfied" as const),
    },
  ]);
}

function moppyPlanDto(
  claims: ParsedMoppyClaims,
  input: CampaignRouteBrowserInput,
): CampaignRoutePlan {
  return {
    label: "モッピーからJALマイルへ交換",
    source_label: MOPPY_SOURCE_LABEL,
    source_amount: "12000",
    steps: [
      {
        label: "キャンペーン本体を交換",
        source_node_id: MOPPY_SOURCE_ASSET_ID,
        destination_node_id: MOPPY_JAL_ASSET_ID,
        source_label: MOPPY_SOURCE_LABEL,
        destination_label: JAL_MILE_LABEL,
        source_amount: "12000",
        destination_amount: "6000",
      },
    ],
    rewards: [
      {
        kind: "principal",
        label: "本体交換分",
        asset_id: MOPPY_JAL_ASSET_ID,
        asset_label: JAL_MILE_LABEL,
        amount: String(claims.principal.destination_units_principal),
        settlement: "posted",
        posting: "交換時に積算される本体分",
        processing_days_min: null,
        processing_days_max: null,
      },
      {
        kind: "bonus",
        label: "JAL増量分（別途積算）",
        asset_id: MOPPY_BONUS_ASSET_ID,
        asset_label: JAL_MILE_LABEL,
        amount: String(claims.bonus.bonus_units),
        settlement: "pending",
        posting: claims.bonus.posting_description_ja,
        processing_days_min: null,
        processing_days_max: null,
      },
      {
        kind: "rebate",
        label: "モッピー スカイボーナス（別付与）",
        asset_id: MOPPY_REBATE_ASSET_ID,
        asset_label: MOPPY_REBATE_LABEL,
        amount: String(claims.rebate.rebate_units),
        settlement: "pending",
        posting: claims.rebate.posting_description_ja,
        processing_days_min: null,
        processing_days_max: null,
      },
    ],
    prerequisites: moppyPrerequisites(input),
    note: "モッピーのリベートはJALマイルの還元率に合算せず、別の付与として表示しています。抽選特典は計算していません。",
  };
}

function jalPlanDto(
  claim: ParsedJalClaim,
  amount: number,
  traversal: boolean | null,
): CampaignRoutePlan {
  return {
    label: "JALマイレージパーク経由で楽天市場を利用",
    source_label: "楽天市場での支出",
    source_amount: String(amount),
    steps: [
      {
        label: "購入直前にポータルから遷移",
        source_node_id: JAL_PORTAL_ID,
        destination_node_id: JAL_RAKUTEN_MERCHANT_ID,
        source_label: "JALマイレージパーク",
        destination_label: "楽天市場",
        source_amount: "—",
        destination_amount: "—",
      },
      {
        label: "楽天市場で購入してマイル獲得",
        source_node_id: JAL_RAKUTEN_MERCHANT_ID,
        destination_node_id: JAL_MILE_ASSET_ID,
        source_label: "楽天市場での購入",
        destination_label: JAL_MILE_LABEL,
        source_amount: String(amount),
        destination_amount: String(
          Math.floor(amount / claim.source_units) * claim.destination_units,
        ),
      },
    ],
    rewards: [
      {
        kind: "portal_reward",
        label: "ポータル経由の還元",
        asset_id: JAL_MILE_ASSET_ID,
        asset_label: JAL_MILE_LABEL,
        amount: String(
          Math.floor(amount / claim.source_units) * claim.destination_units,
        ),
        settlement: "pending",
        posting: `購入後${claim.processing_time_days_min}〜${claim.processing_time_days_max}日程度で積算予定`,
        processing_days_min: claim.processing_time_days_min,
        processing_days_max: claim.processing_time_days_max,
      },
    ],
    prerequisites: [
      {
        label:
          claim.required_conditions_ja[0] ?? "購入直前のポータル遷移が必要です",
        status:
          traversal === null
            ? "missing"
            : traversal
              ? "satisfied"
              : "not_satisfied",
      },
    ],
    note: "ポータルの clickout と楽天市場での購入を同じ経路として確認できた場合だけ還元を表示します。",
  };
}

function result(
  input: CampaignRouteBrowserInput,
  dataAsOf: string | null,
  status: CampaignRouteStatus,
  reason: CampaignRouteReason,
  winner: CampaignRoutePlan | null,
  message: string,
): CampaignRouteRecommendationResult {
  return Object.freeze({
    version: "campaign-route-recommendation.v1",
    experimental: true,
    current_advice: false,
    scenario: input.scenario,
    effective_at: input.effective_at,
    status,
    outcome: status,
    reason,
    winner,
    message,
    data_origin: "database",
    data_as_of: dataAsOf,
  });
}

function inMoppyWindow(effectiveAt: string): boolean {
  const value = Date.parse(effectiveAt);
  return (
    value >= Date.parse(MOPPY_VALID_FROM) && value < Date.parse(MOPPY_VALID_TO)
  );
}

const assetDefinitions = Object.freeze([
  assetDefinition(moppyAsset, MOPPY_SOURCE_LABEL),
  assetDefinition(jalAsset, JAL_MILE_LABEL),
  assetDefinition(jalBonusAsset, "JALマイル（増量分）"),
  assetDefinition(moppyRebateAsset, MOPPY_REBATE_LABEL),
  assetDefinition(jpySpendAsset, "日本円での支出"),
]);

/** The dedicated source alias makes the DB-only production composition clear. */
export interface CampaignRouteSourcePort extends RouteGraphSourcePort {}

export async function recommendCampaignRoute(
  input: CampaignRouteBrowserInput,
  source: CampaignRouteSourcePort,
): Promise<CampaignRouteRecommendationResult> {
  const claims = await loadCampaignClaims(source, input.effective_at);
  if (input.scenario === "moppy_aug_2026") {
    const balance = input.moppy_balance_points ?? 12_000;
    const winner = moppyPlanDto(claims.moppy, input);
    const plan = moppyPlan(input.effective_at, balance);
    const rules = moppyRules(claims.moppy, input.effective_at);
    const facts = {
      "campaign.moppy.ad_earned_source_units":
        input.ad_earned_points === null
          ? {
              status: "unknown" as const,
              observed_at: null,
              source: "user_input" as const,
            }
          : {
              status: "known" as const,
              value: input.ad_earned_points,
              observed_at: input.effective_at,
              source: "user_input" as const,
            },
    };
    const capProgress =
      input.monthly_exchange_count === null
        ? {
            cap_campaign_moppy_jal_monthly_once: {
              status: "unknown" as const,
              eligible_spend_jpy_min: 0,
              eligible_spend_jpy_max: 0,
              reward_earned_units_min: null,
              reward_earned_units_max: null,
              period_start: "2026-08-01T00:00:00+09:00",
              period_end: "2026-09-01T00:00:00+09:00",
              observed_at: null,
              source: "user_input" as const,
            },
          }
        : {
            cap_campaign_moppy_jal_monthly_once: {
              status: "known" as const,
              eligible_spend_jpy_min: 0,
              eligible_spend_jpy_max: 0,
              reward_earned_units_min: String(
                input.monthly_exchange_count * 4_500,
              ),
              reward_earned_units_max: String(
                input.monthly_exchange_count * 4_500,
              ),
              period_start: "2026-08-01T00:00:00+09:00",
              period_end: "2026-09-01T00:00:00+09:00",
              observed_at: input.effective_at,
              source: "user_input" as const,
            },
          };
    let evaluation: ReturnType<typeof evaluateNativePlan>;
    try {
      evaluation = evaluateNativePlan(plan, {
        rules: [...rules],
        assets: [...assetDefinitions],
        opening_asset_lots: [
          openingLot(
            moppyAsset,
            balance,
            "lot_campaign_moppy_points",
            input.effective_at,
          ),
        ],
        user_state: {
          owned_instrument_ids: [],
          owned_loyalty_program_ids: [],
          facts,
          asset_lots: [
            openingLot(
              moppyAsset,
              balance,
              "lot_campaign_moppy_points",
              input.effective_at,
            ),
          ],
          valuation_profile: { version: "campaign-route.v1", entries: [] },
          cap_progress: capProgress,
        },
        transaction_time: input.effective_at,
        replay_knowledge_at: input.effective_at,
        rule_evaluation_policy: "experimental_unverified",
        valuation_policy: "unvalued",
      });
    } catch {
      return result(
        input,
        claims.data_as_of,
        "no_valid_plan",
        "engine_rejected",
        null,
        "このキャンペーンは現在安全に計算できません。",
      );
    }
    if (!inMoppyWindow(input.effective_at))
      return result(
        input,
        claims.data_as_of,
        "no_valid_plan",
        "outside_validity_window",
        null,
        "指定日時はキャンペーン期間外です。",
      );
    if (balance < 12_000)
      return result(
        input,
        claims.data_as_of,
        "no_valid_plan",
        "balance_below_required",
        null,
        "モッピーポイントが12,000ポイント未満です。",
      );
    if (input.ad_earned_points === null)
      return result(
        input,
        claims.data_as_of,
        "conditional",
        "missing_prerequisite",
        null,
        "広告利用で獲得したポイント数を確認してください。",
      );
    if (input.ad_earned_points < 10_000)
      return result(
        input,
        claims.data_as_of,
        "no_valid_plan",
        "missing_prerequisite",
        null,
        "広告利用で獲得したモッピーポイントが10,000ポイント未満です。",
      );
    if (input.monthly_exchange_count === null)
      return result(
        input,
        claims.data_as_of,
        "conditional",
        "missing_prerequisite",
        null,
        "今月のキャンペーン交換回数を確認してください。",
      );
    if (input.monthly_exchange_count >= 1)
      return result(
        input,
        claims.data_as_of,
        "no_valid_plan",
        "monthly_limit_reached",
        null,
        "このキャンペーンの今月分はすでに利用済みです。",
      );
    if (!evaluation.eligible)
      return result(
        input,
        claims.data_as_of,
        "no_valid_plan",
        "engine_rejected",
        null,
        "入力条件では有効なキャンペーン計画がありません。",
      );
    const principalMovement = evaluation.asset_movements.find(
      (movement) =>
        movement.direction === "create" &&
        movement.quantity.asset.asset_id === MOPPY_JAL_ASSET_ID,
    );
    const bonusComponent = evaluation.reward_components.find(
      (component) => component.quantity.asset.asset_id === MOPPY_BONUS_ASSET_ID,
    );
    const rebateComponent = evaluation.reward_components.find(
      (component) =>
        component.quantity.asset.asset_id === MOPPY_REBATE_ASSET_ID,
    );
    if (
      principalMovement?.quantity.amount !== "6000" ||
      bonusComponent?.quantity.amount !== "1200" ||
      rebateComponent?.quantity.amount !== "4500" ||
      evaluation.reward_components.length !== 2
    )
      return result(
        input,
        claims.data_as_of,
        "no_valid_plan",
        "engine_rejected",
        null,
        "キャンペーンの出力を個別に確認できませんでした。",
      );
    return result(
      input,
      claims.data_as_of,
      "eligible",
      null,
      winner,
      "本体・増量分・モッピーリベートを別々の出力として表示しています。",
    );
  }

  const amount = input.purchase_amount_jpy ?? 30_000;
  const winner = jalPlanDto(
    claims.jal,
    amount,
    input.portal_traversal_confirmed,
  );
  const plan = jalPlan(input.effective_at, amount);
  const rule = jalRule(claims.jal, input.effective_at);
  let evaluation: ReturnType<typeof evaluateNativePlan>;
  try {
    evaluation = evaluateNativePlan(plan, {
      rules: [rule],
      assets: [...assetDefinitions],
      transaction_time: input.effective_at,
      replay_knowledge_at: input.effective_at,
      rule_evaluation_policy: "experimental_unverified",
      valuation_policy: "unvalued",
    });
  } catch {
    return result(
      input,
      claims.data_as_of,
      "no_valid_plan",
      "engine_rejected",
      null,
      "このポータル経由ルートは現在安全に計算できません。",
    );
  }
  if (amount !== 30_000)
    return result(
      input,
      claims.data_as_of,
      "no_valid_plan",
      "amount_must_match_benchmark",
      null,
      "このベンチマークは楽天市場30,000円の購入を対象にしています。",
    );
  if (input.portal_traversal_confirmed === null)
    return result(
      input,
      claims.data_as_of,
      "conditional",
      "portal_traversal_required",
      null,
      "購入直前のJALマイレージパーク経由を確認してください。",
    );
  if (!input.portal_traversal_confirmed)
    return result(
      input,
      claims.data_as_of,
      "no_valid_plan",
      "portal_traversal_required",
      null,
      "JALマイレージパークから楽天市場へ直前に遷移していないため、還元を計算しません。",
    );
  if (!evaluation.eligible)
    return result(
      input,
      claims.data_as_of,
      "no_valid_plan",
      "engine_rejected",
      null,
      "入力条件では有効なポータル経由計画がありません。",
    );
  if (
    evaluation.reward_components.length !== 1 ||
    evaluation.reward_components[0]?.quantity.asset.asset_id !==
      JAL_MILE_ASSET_ID ||
    evaluation.reward_components[0]?.quantity.amount !== "100"
  )
    return result(
      input,
      claims.data_as_of,
      "no_valid_plan",
      "engine_rejected",
      null,
      "ポータル報酬を個別に確認できませんでした。",
    );
  return result(
    input,
    claims.data_as_of,
    "eligible",
    null,
    winner,
    "ポータル遷移と購入を同じ経路として確認した場合のJALマイルです。",
  );
}
