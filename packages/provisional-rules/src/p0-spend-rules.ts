import { types as nodeTypes } from "node:util";

import { hashCanonical } from "./canonical.js";
import { deepFreeze } from "./security.js";

export const P0_SPEND_RULE_SET_VERSION = "p0-spend-rule-set.v0.1" as const;

export type P0SpendAssetKind =
  | "reward_point"
  | "airline_mile"
  | "stored_value"
  | "discount"
  | "other";

export interface P0SpendAsset {
  readonly asset_id: string;
  readonly asset_kind: P0SpendAssetKind;
  readonly program_id: string | null;
  readonly reward_class:
    | "normal"
    | "limited_period"
    | "usage_limited"
    | "promotional"
    | null;
  readonly scale: 0;
  readonly label_ja: string;
}

export interface P0SpendRule {
  readonly rule_id: string;
  readonly kind: "transfer" | "redemption";
  readonly label_ja: string;
  readonly source_claim_ids: readonly string[];
  readonly source_ids: readonly string[];
  readonly source_asset: P0SpendAsset;
  readonly destination_asset: P0SpendAsset;
  readonly source_units: string;
  readonly destination_units: string;
  readonly minimum_source_units: string | null;
  readonly increment_source_units: string | null;
  /** Provider-published discrete principals when no uniform increment exists. */
  readonly allowed_source_amounts?: readonly string[];
  readonly maximum_source_units_per_request: string | null;
  readonly maximum_source_units_per_period: string | null;
  readonly maximum_period:
    | "day"
    | "month"
    | "year"
    | "fiscal_year_april"
    | "campaign_period"
    | "lifetime"
    | "rolling_30_day"
    | null;
  readonly fee_source_units: string;
  readonly fee_schedule?: {
    readonly model: "percentage_of_source";
    readonly numerator: string;
    readonly denominator: string;
    readonly rounding: "ceil" | "floor";
  };
  readonly period_usage_key?: string;
  readonly period_usage_min_source_units?: string | null;
  readonly period_usage_max_source_units_exclusive?: string | null;
  readonly processing_time_days_min: number | null;
  readonly processing_time_days_max: number | null;
  readonly cancellation_policy: "not_cancelable" | "provider_defined";
  readonly valid_from: string | null;
  readonly valid_to: string | null;
  readonly timezone: "Asia/Tokyo";
  readonly required_conditions_ja: readonly string[];
  /** Structured prerequisite IDs consumed by the point-route kernel. */
  readonly requires_rule_ids?: readonly string[];
  /** Whether an aligned request may consume a partial available balance. */
  readonly partial_consumption?: boolean;
  /**
   * The rule only applies to units held directly in the source program.
   * Campaign uplifts are commonly withdrawn when the units arrived through an
   * intermediary, so routing eligibility depends on the path travelled.
   */
  readonly requires_direct_source: boolean;
  readonly status: "active_experimental";
}

export type P0SpendDispositionStatus =
  | "executable"
  | "companion_constraint"
  | "state_required"
  | "inactive"
  | "information_only";

export interface P0SpendClaimDisposition {
  readonly claim_id: string;
  readonly status: P0SpendDispositionStatus;
  readonly reason: string;
  readonly derived_rule_ids: readonly string[];
}

export interface P0SpendRuleSet {
  readonly version: typeof P0_SPEND_RULE_SET_VERSION;
  readonly source_artifact_ids: readonly string[];
  readonly rule_count: number;
  readonly rules: readonly P0SpendRule[];
  readonly dispositions: readonly P0SpendClaimDisposition[];
  readonly rule_set_hash: `sha256:${string}`;
}

type JsonRecord = Record<string, unknown>;

function clonePlainResearchValue(
  value: unknown,
  active: WeakSet<object> = new WeakSet(),
  depth = 0,
): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  )
    return value;
  if (typeof value !== "object" || depth > 32 || nodeTypes.isProxy(value))
    throw new TypeError("p0_spend_artifacts_invalid");
  if (active.has(value)) throw new TypeError("p0_spend_artifacts_invalid");
  active.add(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.getOwnPropertySymbols(value).length > 0)
    throw new TypeError("p0_spend_artifacts_invalid");
  if (Array.isArray(value)) {
    const keys = Reflect.ownKeys(descriptors);
    if (keys.length !== value.length + 1 || keys.length > 10_001)
      throw new TypeError("p0_spend_artifacts_invalid");
    const output: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (
        !descriptor ||
        descriptor.enumerable !== true ||
        !("value" in descriptor)
      )
        throw new TypeError("p0_spend_artifacts_invalid");
      output.push(clonePlainResearchValue(descriptor.value, active, depth + 1));
    }
    active.delete(value);
    return output;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    throw new TypeError("p0_spend_artifacts_invalid");
  const output = Object.create(null) as JsonRecord;
  const keys = Object.keys(descriptors);
  if (keys.length > 10_000) throw new TypeError("p0_spend_artifacts_invalid");
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (
      !descriptor ||
      descriptor.enumerable !== true ||
      !("value" in descriptor) ||
      key === "__proto__" ||
      key === "prototype" ||
      key === "constructor"
    )
      throw new TypeError("p0_spend_artifacts_invalid");
    output[key] = clonePlainResearchValue(descriptor.value, active, depth + 1);
  }
  active.delete(value);
  return output;
}

interface Claim {
  readonly claim_id: string;
  readonly family_id: string;
  readonly source_role_id: string;
  readonly source_ids: readonly string[];
  readonly subject: string;
  readonly predicate: string;
  readonly claim_type: string;
  readonly value: unknown;
  readonly applicability: JsonRecord;
  readonly exclusions: readonly string[];
}

interface RuleDraft {
  readonly claimIds: readonly string[];
  readonly build: (claims: ReadonlyMap<string, Claim>) => P0SpendRule;
}

const asset = (
  asset_id: string,
  asset_kind: P0SpendAssetKind,
  program_id: string | null,
  label_ja: string,
): P0SpendAsset => ({
  asset_id,
  asset_kind,
  program_id,
  reward_class:
    asset_kind === "reward_point" || asset_kind === "airline_mile"
      ? "normal"
      : null,
  scale: 0,
  label_ja,
});

const ASSETS = Object.freeze({
  ana: asset(
    "asset.mile.ana",
    "airline_mile",
    "program.ana-mileage-club",
    "ANAマイル",
  ),
  anaPay: asset(
    "asset.value.ana-pay",
    "stored_value",
    "program.ana-pay",
    "ANA Pay残高",
  ),
  anaSkyCoin: asset(
    "asset.value.ana-sky-coin",
    "stored_value",
    "program.ana-mileage-club",
    "ANA SKY コイン",
  ),
  bic: asset(
    "asset.point.bic",
    "reward_point",
    "program.bic-point",
    "ビックポイント",
  ),
  d: asset("asset.point.d", "reward_point", "program.d-point", "dポイント"),
  jal: asset(
    "asset.mile.jal",
    "airline_mile",
    "program.jal-mileage-bank",
    "JALマイル",
  ),
  jalCampaignBonus: asset(
    "asset.mile.jal-campaign-bonus",
    "airline_mile",
    "program.jal-mileage-bank",
    "JALキャンペーン増量マイル",
  ),
  jpyValue: asset(
    "asset.value.jpy-redemption",
    "discount",
    null,
    "支払い充当価値",
  ),
  jre: asset(
    "asset.point.jre",
    "reward_point",
    "program.jre-point",
    "JRE POINT",
  ),
  moppy: asset(
    "asset.point.moppy",
    "reward_point",
    "program.moppy",
    "モッピーポイント",
  ),
  moppyCampaignRebate: asset(
    "asset.point.moppy-campaign-rebate",
    "reward_point",
    "program.moppy",
    "モッピー スカイボーナス",
  ),
  nanaco: asset(
    "asset.point.nanaco",
    "reward_point",
    "program.nanaco",
    "nanacoポイント",
  ),
  nanacoValue: asset(
    "asset.value.nanaco",
    "stored_value",
    "program.nanaco",
    "nanaco電子マネー",
  ),
  paypay: asset(
    "asset.point.paypay",
    "reward_point",
    "program.paypay-point",
    "PayPayポイント",
  ),
  ponta: asset(
    "asset.point.ponta",
    "reward_point",
    "program.ponta",
    "Pontaポイント",
  ),
  rakuten: asset(
    "asset.point.rakuten",
    "reward_point",
    "program.rakuten-point",
    "楽天ポイント",
  ),
  recruit: asset(
    "asset.point.recruit",
    "reward_point",
    "program.recruit-point",
    "リクルートポイント",
  ),
  revolutJpy: asset(
    "asset.value.revolut-jpy",
    "stored_value",
    "program.revolut-jp",
    "Revolut残高（日本円）",
  ),
  sevenMile: asset(
    "asset.point.seven-mile",
    "reward_point",
    "program.seven-mile",
    "セブンマイル",
  ),
  suica: asset(
    "asset.value.suica",
    "stored_value",
    "program.suica",
    "Suica残高",
  ),
  jrKyupo: asset(
    "asset.point.jr-kyupo",
    "reward_point",
    "program.jr-kyupo",
    "JRキューポ",
  ),
  saisonPermanent: asset(
    "asset.point.saison-permanent",
    "reward_point",
    "program.saison-permanent",
    "セゾン永久不滅ポイント",
  ),
  v: asset("asset.point.v", "reward_point", "program.v-point", "Vポイント"),
  waon: asset(
    "asset.point.waon",
    "reward_point",
    "program.waon-point",
    "WAON POINT",
  ),
  waonValue: asset(
    "asset.value.waon",
    "stored_value",
    "program.waon",
    "電子マネーWAON",
  ),
});

/**
 * Structured transfer claims refer to declared asset IDs rather than naming
 * an asset in compiler code for every new route.  Keeping the catalog here
 * still makes the binding closed-world: an artifact cannot inject a new
 * programme or silently attach a known rate to another balance.
 */
const STRUCTURED_ASSET_CATALOG: Readonly<Record<string, P0SpendAsset>> =
  Object.freeze(
    Object.fromEntries(
      Object.values(ASSETS).map((item) => [item.asset_id, item]),
    ),
  );

function stringValue(record: JsonRecord, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function positiveInteger(record: JsonRecord, key: string): string {
  const value = record[key];
  if (!Number.isSafeInteger(value) || Number(value) <= 0)
    throw new TypeError(`p0_spend_claim_${key}_invalid`);
  return String(value);
}

function claimValue(claim: Claim): JsonRecord {
  if (
    !claim.value ||
    typeof claim.value !== "object" ||
    Array.isArray(claim.value)
  )
    throw new TypeError(`p0_spend_claim_value_invalid:${claim.claim_id}`);
  return claim.value as JsonRecord;
}

function sourceIds(claims: readonly Claim[]): readonly string[] {
  return Object.freeze(
    [...new Set(claims.flatMap((claim) => claim.source_ids))].sort(),
  );
}

function validity(
  claim: Claim,
): Pick<P0SpendRule, "valid_from" | "valid_to" | "timezone"> {
  const from = claim.applicability.effective_from;
  const to = claim.applicability.effective_to;
  return {
    valid_from: typeof from === "string" ? from : null,
    valid_to: typeof to === "string" ? to : null,
    timezone: "Asia/Tokyo",
  };
}

function rule(
  claimList: readonly Claim[],
  input: Omit<
    P0SpendRule,
    | "source_claim_ids"
    | "source_ids"
    | "fee_source_units"
    | "fee_schedule"
    | "allowed_source_amounts"
    | "period_usage_key"
    | "period_usage_min_source_units"
    | "period_usage_max_source_units_exclusive"
    | "maximum_source_units_per_request"
    | "maximum_source_units_per_period"
    | "maximum_period"
    | "processing_time_days_min"
    | "processing_time_days_max"
    | "cancellation_policy"
    | "valid_from"
    | "valid_to"
    | "timezone"
    | "required_conditions_ja"
    | "requires_rule_ids"
    | "partial_consumption"
    | "requires_direct_source"
    | "status"
  > &
    Partial<
      Pick<
        P0SpendRule,
        | "fee_source_units"
        | "fee_schedule"
        | "allowed_source_amounts"
        | "period_usage_key"
        | "period_usage_min_source_units"
        | "period_usage_max_source_units_exclusive"
        | "maximum_source_units_per_request"
        | "maximum_source_units_per_period"
        | "maximum_period"
        | "processing_time_days_min"
        | "processing_time_days_max"
        | "cancellation_policy"
        | "valid_from"
        | "valid_to"
        | "requires_rule_ids"
        | "partial_consumption"
        | "required_conditions_ja"
        | "requires_direct_source"
      >
    >,
): P0SpendRule {
  const primaryClaim = claimList[0];
  if (!primaryClaim) throw new TypeError("p0_spend_rule_claims_empty");
  return {
    ...input,
    source_claim_ids: Object.freeze(
      claimList.map((claim) => claim.claim_id).sort(),
    ),
    source_ids: sourceIds(claimList),
    fee_source_units: input.fee_source_units ?? "0",
    ...(input.fee_schedule === undefined
      ? {}
      : { fee_schedule: Object.freeze({ ...input.fee_schedule }) }),
    ...(input.allowed_source_amounts === undefined
      ? {}
      : {
          allowed_source_amounts: Object.freeze([
            ...input.allowed_source_amounts,
          ]),
        }),
    ...(input.period_usage_key === undefined
      ? {}
      : { period_usage_key: input.period_usage_key }),
    ...(input.period_usage_min_source_units === undefined
      ? {}
      : {
          period_usage_min_source_units: input.period_usage_min_source_units,
        }),
    ...(input.period_usage_max_source_units_exclusive === undefined
      ? {}
      : {
          period_usage_max_source_units_exclusive:
            input.period_usage_max_source_units_exclusive,
        }),
    maximum_source_units_per_request:
      input.maximum_source_units_per_request ?? null,
    maximum_source_units_per_period:
      input.maximum_source_units_per_period ?? null,
    maximum_period: input.maximum_period ?? null,
    processing_time_days_min: input.processing_time_days_min ?? null,
    processing_time_days_max: input.processing_time_days_max ?? null,
    cancellation_policy: input.cancellation_policy ?? "provider_defined",
    valid_from:
      input.valid_from !== undefined
        ? input.valid_from
        : validity(primaryClaim).valid_from,
    valid_to:
      input.valid_to !== undefined
        ? input.valid_to
        : validity(primaryClaim).valid_to,
    timezone: "Asia/Tokyo",
    required_conditions_ja: input.required_conditions_ja ?? Object.freeze([]),
    ...(input.requires_rule_ids === undefined
      ? {}
      : {
          requires_rule_ids: Object.freeze([...input.requires_rule_ids].sort()),
        }),
    ...(input.partial_consumption === undefined
      ? {}
      : { partial_consumption: input.partial_consumption }),
    requires_direct_source: input.requires_direct_source ?? false,
    status: "active_experimental",
  };
}

function fixed(
  claimId: string,
  config: {
    readonly ruleId: string;
    readonly label: string;
    readonly kind: "transfer" | "redemption";
    readonly source: P0SpendAsset;
    readonly destination: P0SpendAsset;
    readonly sourceKey: string;
    readonly destinationKey: string;
    readonly minimumKey?: string;
    readonly incrementKey?: string;
    readonly conditions?: readonly string[];
    readonly processing?: readonly [number, number];
    readonly cancel?: "not_cancelable" | "provider_defined";
    readonly periodSourceMaximum?: string;
    readonly maximumPeriod?:
      | "day"
      | "month"
      | "year"
      | "campaign_period"
      | "lifetime";
    readonly requiresDirectSource?: boolean;
  },
): RuleDraft {
  return {
    claimIds: [claimId],
    build(claims) {
      const claim = claims.get(claimId);
      if (!claim) throw new TypeError(`p0_spend_claim_missing:${claimId}`);
      const value = claimValue(claim);
      return rule([claim], {
        rule_id: config.ruleId,
        kind: config.kind,
        label_ja: config.label,
        source_asset: config.source,
        destination_asset: config.destination,
        source_units: positiveInteger(value, config.sourceKey),
        destination_units: positiveInteger(value, config.destinationKey),
        minimum_source_units: config.minimumKey
          ? positiveInteger(value, config.minimumKey)
          : null,
        increment_source_units: config.incrementKey
          ? positiveInteger(value, config.incrementKey)
          : null,
        ...(config.conditions === undefined
          ? {}
          : { required_conditions_ja: config.conditions }),
        ...(config.processing === undefined
          ? {}
          : {
              processing_time_days_min: config.processing[0],
              processing_time_days_max: config.processing[1],
            }),
        ...(config.cancel === undefined
          ? {}
          : { cancellation_policy: config.cancel }),
        ...(config.requiresDirectSource === undefined
          ? {}
          : { requires_direct_source: config.requiresDirectSource }),
        ...(config.periodSourceMaximum === undefined
          ? {}
          : {
              maximum_source_units_per_period: config.periodSourceMaximum,
              maximum_period: config.maximumPeriod ?? "year",
            }),
      });
    },
  };
}

const DRAFTS: readonly RuleDraft[] = Object.freeze([
  fixed("claim.point.d.use.value.001", {
    ruleId: "p0.spend.d.jpy",
    label: "dポイントを支払いに使う",
    kind: "redemption",
    source: ASSETS.d,
    destination: ASSETS.jpyValue,
    sourceKey: "points",
    destinationKey: "yen",
  }),
  fixed("claim.point.jre.use.value.001", {
    ruleId: "p0.spend.jre.jpy",
    label: "JRE POINTを支払い・Suicaに使う",
    kind: "redemption",
    source: ASSETS.jre,
    destination: ASSETS.jpyValue,
    sourceKey: "points",
    destinationKey: "yen",
    conditions: ["利用先により期間限定ポイントの制約があります"],
  }),
  fixed("claim.point.paypay.use.value.001", {
    ruleId: "p0.spend.paypay.jpy",
    label: "PayPayポイントを支払いに使う",
    kind: "redemption",
    source: ASSETS.paypay,
    destination: ASSETS.jpyValue,
    sourceKey: "points",
    destinationKey: "yen_equivalent",
  }),
  fixed("claim.point.rakuten.use.value.001", {
    ruleId: "p0.spend.rakuten.jpy",
    label: "楽天ポイントを支払いに使う",
    kind: "redemption",
    source: ASSETS.rakuten,
    destination: ASSETS.jpyValue,
    sourceKey: "points",
    destinationKey: "discount_jpy",
  }),
  fixed("claim.point.v.use.value.001", {
    ruleId: "p0.spend.v.jpy",
    label: "Vポイントを支払いに使う",
    kind: "redemption",
    source: ASSETS.v,
    destination: ASSETS.jpyValue,
    sourceKey: "points",
    destinationKey: "value_jpy",
  }),
  fixed("claim.point.waon.terms.value.001", {
    ruleId: "p0.spend.waon.jpy",
    label: "WAON POINTを支払いに使う",
    kind: "redemption",
    source: ASSETS.waon,
    destination: ASSETS.jpyValue,
    sourceKey: "points",
    destinationKey: "value_jpy",
  }),
  fixed("claim.point.nanaco.transfer.ana-rate.001", {
    ruleId: "p0.transfer.nanaco.ana",
    label: "nanacoポイントをANAマイルへ",
    kind: "transfer",
    source: ASSETS.nanaco,
    destination: ASSETS.ana,
    sourceKey: "from_points",
    destinationKey: "to_units",
    minimumKey: "minimum_points",
    incrementKey: "increment_points",
    processing: [2, 7],
  }),
  fixed("claim.point.nanaco.transfer.sky-rate.002", {
    ruleId: "p0.transfer.nanaco.skycoin",
    label: "nanacoポイントをANA SKY コインへ",
    kind: "transfer",
    source: ASSETS.nanaco,
    destination: ASSETS.anaSkyCoin,
    sourceKey: "from_points",
    destinationKey: "to_units",
    minimumKey: "minimum_points",
    incrementKey: "increment_points",
    processing: [2, 2],
  }),
  fixed("claim.point.ponta.transfer.recruit.001", {
    ruleId: "p0.transfer.recruit.ponta",
    label: "リクルートポイントをPontaへ",
    kind: "transfer",
    source: ASSETS.recruit,
    destination: ASSETS.ponta,
    sourceKey: "source_points",
    destinationKey: "destination_points",
  }),
  fixed("claim.point.rakuten.transfer.ana-to-rakuten-rate.001", {
    ruleId: "p0.transfer.ana.rakuten",
    label: "ANAマイルを楽天ポイントへ",
    kind: "transfer",
    source: ASSETS.ana,
    destination: ASSETS.rakuten,
    sourceKey: "source_miles",
    destinationKey: "destination_points",
    conditions: ["同一年度のANA提携ポイント交換が、今回を含め2回目以内です"],
  }),
  fixed("claim.point.rakuten.transfer.rakuten-to-ana-rate.001", {
    ruleId: "p0.transfer.rakuten.ana",
    label: "楽天ポイントをANAマイルへ",
    kind: "transfer",
    source: ASSETS.rakuten,
    destination: ASSETS.ana,
    sourceKey: "source_points",
    destinationKey: "destination_miles",
    minimumKey: "minimum_points",
    conditions: ["ANAマイレージクラブへの登録が必要です"],
  }),
  fixed("claim.point.v.transfer.ana-to-v-rate.001", {
    ruleId: "p0.transfer.ana.v",
    label: "ANAマイルをVポイントへ",
    kind: "transfer",
    source: ASSETS.ana,
    destination: ASSETS.v,
    sourceKey: "source_miles",
    destinationKey: "destination_points",
    conditions: ["同一年度のANA提携ポイント交換が、今回を含め2回目以内です"],
  }),
  fixed("claim.point.v.transfer.v-to-ana.001", {
    ruleId: "p0.transfer.v.ana",
    label: "VポイントをANAマイルへ",
    kind: "transfer",
    source: ASSETS.v,
    destination: ASSETS.ana,
    sourceKey: "source_points",
    destinationKey: "destination_miles",
    minimumKey: "minimum_points",
    conditions: ["年間交換上限の使用済み数量が必要です"],
    periodSourceMaximum: "40000",
    maximumPeriod: "year",
  }),
  fixed("claim.point.waon.transfer.jal-campaign.001", {
    ruleId: "p0.transfer.jal.waon.campaign",
    label: "JALマイルをWAONへ（期間限定）",
    kind: "transfer",
    source: ASSETS.jal,
    destination: ASSETS.waonValue,
    sourceKey: "source_miles",
    destinationKey: "destination_waon",
    conditions: ["キャンペーン申込みが必要です"],
  }),
  fixed("claim.point.waon.use.point-value.001", {
    ruleId: "p0.transfer.waon.value",
    label: "WAON POINTを電子マネーWAONへ",
    kind: "redemption",
    source: ASSETS.waon,
    destination: ASSETS.waonValue,
    sourceKey: "source_points",
    destinationKey: "destination_waon_value_jpy",
    conditions: ["初回利用前のWAONカードは事前チャージが必要です"],
  }),
  fixed("claim.transit.suica.acceptance.001", {
    ruleId: "p0.transfer.jre.suica",
    label: "JRE POINTをSuicaへ",
    kind: "redemption",
    source: ASSETS.jre,
    destination: ASSETS.suica,
    sourceKey: "points",
    destinationKey: "yen",
    minimumKey: "min_points",
    conditions: ["登録済みSuicaとビューカード連携条件を確認してください"],
    cancel: "not_cancelable",
  }),
  {
    claimIds: [
      "claim.point.ponta.transfer.jal-rate.001",
      "claim.point.ponta.transfer.jal-unit-timing.001",
    ],
    build(claims) {
      const rate = claims.get("claim.point.ponta.transfer.jal-rate.001");
      const constraint = claims.get(
        "claim.point.ponta.transfer.jal-unit-timing.001",
      );
      if (!rate || !constraint)
        throw new TypeError("p0_spend_ponta_jal_missing");
      const rateValue = claimValue(rate);
      const constraintValue = claimValue(constraint);
      if (rateValue.source_points !== 1 || rateValue.destination_miles !== 0.5)
        throw new TypeError("p0_spend_ponta_jal_rate_invalid");
      return rule([rate, constraint], {
        rule_id: "p0.transfer.ponta.jal",
        kind: "transfer",
        label_ja: "PontaポイントをJALマイルへ",
        source_asset: ASSETS.ponta,
        destination_asset: ASSETS.jal,
        source_units: "2",
        destination_units: "1",
        minimum_source_units: positiveInteger(
          constraintValue,
          "minimum_points",
        ),
        increment_source_units: positiveInteger(constraintValue, "unit_points"),
        processing_time_days_min: 7,
        processing_time_days_max: 7,
      });
    },
  },
  ...([0, 1] as const).map(
    (rowIndex): RuleDraft => ({
      claimIds: ["claim.point.waon.transfer.jal-normal.001"],
      build(claims) {
        const claim = claims.get("claim.point.waon.transfer.jal-normal.001");
        if (!claim) throw new TypeError("p0_spend_jal_waon_missing");
        const rows = claimValue(claim).rate_rows;
        if (!Array.isArray(rows) || rows.length !== 2)
          throw new TypeError("p0_spend_jal_waon_rows_invalid");
        const row = rows[rowIndex];
        if (!row || typeof row !== "object" || Array.isArray(row))
          throw new TypeError("p0_spend_jal_waon_row_invalid");
        const value = row as JsonRecord;
        const source = positiveInteger(value, "source_miles");
        return rule([claim], {
          rule_id: `p0.transfer.jal.waon.normal-${source}`,
          kind: "transfer",
          label_ja: `JALマイルをWAONへ（${source}マイル枠）`,
          source_asset: ASSETS.jal,
          destination_asset: ASSETS.waonValue,
          source_units: source,
          destination_units: positiveInteger(value, "destination_waon"),
          minimum_source_units: source,
          increment_source_units: source,
          maximum_source_units_per_request: source,
        });
      },
    }),
  ),
  {
    claimIds: ["claim.card.view.exchange.values.001"],
    build(claims) {
      const claim = claims.get("claim.card.view.exchange.values.001");
      if (!claim) throw new TypeError("p0_spend_view_exchange_missing");
      const row = claimValue(claim).jre_to_bic;
      if (!row || typeof row !== "object" || Array.isArray(row))
        throw new TypeError("p0_spend_view_exchange_invalid");
      return rule([claim], {
        rule_id: "p0.transfer.jre.bic",
        kind: "transfer",
        label_ja: "JRE POINTをビックポイントへ",
        source_asset: ASSETS.jre,
        destination_asset: ASSETS.bic,
        source_units: positiveInteger(row as JsonRecord, "jre_points"),
        destination_units: positiveInteger(row as JsonRecord, "bic_points"),
        minimum_source_units: "1000",
        increment_source_units: "1000",
      });
    },
  },
  {
    claimIds: ["claim.card.view.exchange.values.001"],
    build(claims) {
      const claim = claims.get("claim.card.view.exchange.values.001");
      if (!claim) throw new TypeError("p0_spend_view_exchange_missing");
      const row = claimValue(claim).bic_points_to_suica;
      if (!row || typeof row !== "object" || Array.isArray(row))
        throw new TypeError("p0_spend_view_exchange_invalid");
      return rule([claim], {
        rule_id: "p0.transfer.bic.suica",
        kind: "transfer",
        label_ja: "ビックポイントをSuicaへ",
        source_asset: ASSETS.bic,
        destination_asset: ASSETS.suica,
        source_units: positiveInteger(row as JsonRecord, "bic_points"),
        destination_units: positiveInteger(row as JsonRecord, "yen_value"),
        minimum_source_units: "1500",
        increment_source_units: "1500",
      });
    },
  },
  fixed("claim.point.nanaco.campaign.z-sevenmile-exchange.012", {
    ruleId: "p0.transfer.seven-mile.nanaco",
    label: "セブンマイルをnanaco電子マネーへ",
    kind: "redemption",
    source: ASSETS.sevenMile,
    destination: ASSETS.nanacoValue,
    sourceKey: "from_miles",
    destinationKey: "to_electronic_money_yen",
    conditions: ["セブン‐イレブンアプリにnanacoを登録済みです"],
  }),
  {
    claimIds: [
      "claim.point.nanaco.use.value.001",
      "claim.emoney.nanaco.service.001",
    ],
    build(claims) {
      const pointClaim = claims.get("claim.point.nanaco.use.value.001");
      const serviceClaim = claims.get("claim.emoney.nanaco.service.001");
      if (!pointClaim || !serviceClaim)
        throw new TypeError("p0_spend_nanaco_value_missing");
      if (
        positiveInteger(claimValue(pointClaim), "points") !== "1" ||
        positiveInteger(claimValue(pointClaim), "electronic_money_yen") !==
          "1" ||
        positiveInteger(claimValue(serviceClaim), "points") !== "1" ||
        positiveInteger(claimValue(serviceClaim), "e_money_yen") !== "1"
      )
        throw new TypeError("p0_spend_nanaco_value_invalid");
      return rule([pointClaim, serviceClaim], {
        rule_id: "p0.transfer.nanaco.value",
        kind: "redemption",
        label_ja: "nanacoポイントを電子マネーへ",
        source_asset: ASSETS.nanaco,
        destination_asset: ASSETS.nanacoValue,
        source_units: "1",
        destination_units: "1",
        minimum_source_units: null,
        increment_source_units: null,
        cancellation_policy: "not_cancelable",
      });
    },
  },
]);

const STRUCTURED_TRANSFER_REQUIRED_KEYS = Object.freeze([
  "route_id",
  "operation",
  "source_asset_ref",
  "destination_asset_ref",
  "source_units",
  "destination_units",
  "minimum_source_units",
  "increment_source_units",
  "maximum_source_units_per_request",
  "maximum_source_units_per_period",
  "maximum_period",
  "fee_source_units",
  "processing_time_days_min",
  "processing_time_days_max",
  "cancellation_policy",
  "validity",
  "prerequisite_ids",
  "requires_rule_ids",
  "required_conditions_ja",
  "requires_direct_source",
  "partial_consumption",
] as const);

interface StructuredTransferForm {
  readonly route_id: string;
  readonly source_asset: P0SpendAsset;
  readonly destination_asset: P0SpendAsset;
  readonly source_units: string;
  readonly destination_units: string;
  readonly minimum_source_units: string | null;
  readonly increment_source_units: string | null;
  readonly allowed_source_amounts?: readonly string[];
  readonly maximum_source_units_per_request: string | null;
  readonly maximum_source_units_per_period: string | null;
  readonly maximum_period: P0SpendRule["maximum_period"];
  readonly fee_source_units: string;
  readonly fee_schedule?: P0SpendRule["fee_schedule"];
  readonly period_usage_key?: string;
  readonly period_usage_min_source_units?: string | null;
  readonly period_usage_max_source_units_exclusive?: string | null;
  readonly processing_time_days_min: number | null;
  readonly processing_time_days_max: number | null;
  readonly cancellation_policy: P0SpendRule["cancellation_policy"];
  readonly valid_from: string | null;
  readonly valid_to: string | null;
  readonly prerequisite_ids: readonly string[];
  readonly requires_rule_ids: readonly string[];
  readonly required_conditions_ja: readonly string[];
  readonly requires_direct_source: boolean;
  readonly partial_consumption: boolean;
}

interface StructuredTransferCheck {
  readonly form: StructuredTransferForm | null;
  readonly prerequisite_claim_ids: readonly string[];
  readonly status: P0SpendDispositionStatus | null;
  readonly reason: string | null;
}

interface SourceBinding {
  readonly family_id: string;
  readonly roles: ReadonlySet<string>;
  readonly url: string;
  readonly publisher: string;
  readonly official_domain: string;
}

function hasOwn(record: JsonRecord, key: string): boolean {
  return Object.hasOwn(record, key);
}

function nonNegativeIntegerValue(value: unknown, field: string): string | null {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || Number(value) < 0)
    throw new TypeError(`p0_spend_structured_${field}_invalid`);
  return String(value);
}

function positiveIntegerValue(value: unknown, field: string): string {
  if (!Number.isSafeInteger(value) || Number(value) <= 0)
    throw new TypeError(`p0_spend_structured_${field}_invalid`);
  return String(value);
}

function structuredForm(record: JsonRecord): JsonRecord | null {
  const form = record.transfer;
  return form && typeof form === "object" && !Array.isArray(form)
    ? (form as JsonRecord)
    : null;
}

function structuredInvalid(
  status: P0SpendDispositionStatus,
  reason: string,
): StructuredTransferCheck {
  return {
    form: null,
    prerequisite_claim_ids: Object.freeze([]),
    status,
    reason,
  };
}

function sourceRoleMatches(
  claim: Claim,
  sourceBindings: ReadonlyMap<string, SourceBinding>,
): boolean {
  return claim.source_ids.every(
    (sourceId) =>
      sourceBindings.get(sourceId)?.roles.has(claim.source_role_id) === true,
  );
}

function checkStructuredTransfer(
  claim: Claim,
  claims: ReadonlyMap<string, Claim>,
  sourceBindings: ReadonlyMap<string, SourceBinding>,
): StructuredTransferCheck {
  const value = claimValue(claim);
  const raw = structuredForm(value);
  if (!raw)
    return structuredInvalid(
      "information_only",
      "structured transfer form is missing",
    );

  if (!sourceRoleMatches(claim, sourceBindings))
    return structuredInvalid(
      "information_only",
      "official source-role membership is not exact",
    );
  if (new Set(claim.source_ids).size !== claim.source_ids.length)
    return structuredInvalid(
      "information_only",
      "structured transfer source IDs must be unique",
    );

  const missing = STRUCTURED_TRANSFER_REQUIRED_KEYS.find(
    (key) => !hasOwn(raw, key),
  );
  if (missing)
    return structuredInvalid(
      "information_only",
      `structured transfer parameter is missing: ${missing}`,
    );
  if (claim.exclusions.length > 0)
    return structuredInvalid(
      "information_only",
      "claim has an explicit exclusion and cannot become executable",
    );
  if (claim.claim_type !== "transfer_rule")
    return structuredInvalid(
      "information_only",
      "only transfer_rule claims can become executable transfer rules",
    );

  if (raw.operation !== "transfer" && raw.operation !== "conversion")
    return structuredInvalid(
      "information_only",
      "structured operation is not a transfer or conversion",
    );
  const routeId = raw.route_id;
  if (
    typeof routeId !== "string" ||
    !/^[a-z0-9][a-z0-9.-]{1,119}$/u.test(routeId)
  )
    return structuredInvalid(
      "information_only",
      "structured route ID is invalid",
    );
  const sourceAssetRef = raw.source_asset_ref;
  const destinationAssetRef = raw.destination_asset_ref;
  if (
    typeof sourceAssetRef !== "string" ||
    typeof destinationAssetRef !== "string"
  )
    return structuredInvalid(
      "information_only",
      "structured asset references are invalid",
    );
  const sourceAsset = STRUCTURED_ASSET_CATALOG[sourceAssetRef];
  const destinationAsset = STRUCTURED_ASSET_CATALOG[destinationAssetRef];
  if (!sourceAsset || !destinationAsset)
    return structuredInvalid(
      "information_only",
      "structured asset reference is not declared",
    );

  let sourceUnits: string;
  let destinationUnits: string;
  let minimum: string | null;
  let increment: string | null;
  let requestMaximum: string | null;
  let periodMaximum: string | null;
  let fee: string | null;
  try {
    sourceUnits = positiveIntegerValue(raw.source_units, "source_units");
    destinationUnits = positiveIntegerValue(
      raw.destination_units,
      "destination_units",
    );
    minimum = nonNegativeIntegerValue(
      raw.minimum_source_units,
      "minimum_source_units",
    );
    increment = nonNegativeIntegerValue(
      raw.increment_source_units,
      "increment_source_units",
    );
    requestMaximum = nonNegativeIntegerValue(
      raw.maximum_source_units_per_request,
      "maximum_source_units_per_request",
    );
    periodMaximum = nonNegativeIntegerValue(
      raw.maximum_source_units_per_period,
      "maximum_source_units_per_period",
    );
    fee = nonNegativeIntegerValue(raw.fee_source_units, "fee_source_units");
  } catch {
    return structuredInvalid(
      "information_only",
      "structured quantity or fee is invalid",
    );
  }
  if (fee === null)
    return structuredInvalid(
      "information_only",
      "structured fee must be explicit, including zero",
    );
  const maximumPeriod = raw.maximum_period;
  if (
    maximumPeriod !== null &&
    maximumPeriod !== "day" &&
    maximumPeriod !== "month" &&
    maximumPeriod !== "year" &&
    maximumPeriod !== "fiscal_year_april" &&
    maximumPeriod !== "campaign_period" &&
    maximumPeriod !== "lifetime" &&
    maximumPeriod !== "rolling_30_day"
  )
    return structuredInvalid(
      "information_only",
      "structured maximum period is invalid",
    );
  let periodUsageMin: string | null | undefined;
  let periodUsageMax: string | null | undefined;
  try {
    periodUsageMin = hasOwn(raw, "period_usage_min_source_units")
      ? nonNegativeIntegerValue(
          raw.period_usage_min_source_units,
          "period_usage_min_source_units",
        )
      : undefined;
    periodUsageMax = hasOwn(raw, "period_usage_max_source_units_exclusive")
      ? nonNegativeIntegerValue(
          raw.period_usage_max_source_units_exclusive,
          "period_usage_max_source_units_exclusive",
        )
      : undefined;
  } catch {
    return structuredInvalid(
      "information_only",
      "structured period tier is invalid",
    );
  }
  const hasPeriodConstraint =
    periodMaximum !== null || periodUsageMin != null || periodUsageMax != null;
  if (hasPeriodConstraint !== (maximumPeriod !== null))
    return structuredInvalid(
      "information_only",
      "structured period constraint and period must be both present or both null",
    );
  if (
    periodUsageMin !== undefined &&
    periodUsageMax !== undefined &&
    periodUsageMin !== null &&
    periodUsageMax !== null &&
    Number(periodUsageMin) >= Number(periodUsageMax)
  )
    return structuredInvalid(
      "information_only",
      "structured period tier bounds are inverted",
    );
  const periodUsageKey = raw.period_usage_key;
  if (
    periodUsageKey !== undefined &&
    (typeof periodUsageKey !== "string" ||
      !/^[a-z0-9][a-z0-9.-]{1,119}$/u.test(periodUsageKey))
  )
    return structuredInvalid(
      "information_only",
      "structured period usage key is invalid",
    );
  let feeSchedule: P0SpendRule["fee_schedule"] | undefined;
  if (raw.fee_schedule !== undefined) {
    const schedule = raw.fee_schedule;
    if (!schedule || typeof schedule !== "object" || Array.isArray(schedule))
      return structuredInvalid(
        "information_only",
        "structured fee schedule is invalid",
      );
    const feeRecord = schedule as JsonRecord;
    if (
      feeRecord.model !== "percentage_of_source" ||
      !Number.isSafeInteger(feeRecord.numerator) ||
      Number(feeRecord.numerator) < 0 ||
      !Number.isSafeInteger(feeRecord.denominator) ||
      Number(feeRecord.denominator) <= 0 ||
      Number(feeRecord.numerator) >= Number(feeRecord.denominator) ||
      (feeRecord.rounding !== "ceil" && feeRecord.rounding !== "floor")
    )
      return structuredInvalid(
        "information_only",
        "structured fee schedule is invalid",
      );
    feeSchedule = Object.freeze({
      model: "percentage_of_source",
      numerator: String(feeRecord.numerator),
      denominator: String(feeRecord.denominator),
      rounding: feeRecord.rounding,
    });
  }
  let allowedSourceAmounts: readonly string[] | undefined;
  if (raw.allowed_source_amounts !== undefined) {
    if (
      !Array.isArray(raw.allowed_source_amounts) ||
      raw.allowed_source_amounts.length < 1 ||
      raw.allowed_source_amounts.length > 64
    )
      return structuredInvalid(
        "information_only",
        "structured allowed source amounts are invalid",
      );
    try {
      allowedSourceAmounts = Object.freeze(
        raw.allowed_source_amounts.map((value) =>
          positiveIntegerValue(value, "allowed_source_amounts"),
        ),
      );
    } catch {
      return structuredInvalid(
        "information_only",
        "structured allowed source amounts are invalid",
      );
    }
    if (
      increment !== null ||
      new Set(allowedSourceAmounts).size !== allowedSourceAmounts.length ||
      allowedSourceAmounts.some((value, index, values) => {
        const previous = values[index - 1];
        return previous !== undefined && Number(value) <= Number(previous);
      })
    )
      return structuredInvalid(
        "information_only",
        "structured allowed source amounts must be strictly increasing and replace the increment",
      );
  }
  if (
    minimum !== null &&
    increment !== null &&
    (Number(minimum) <= 0 || Number(increment) <= 0)
  )
    return structuredInvalid(
      "information_only",
      "structured minimum and increment must be positive when supplied",
    );

  const processingMin =
    raw.processing_time_days_min === null
      ? null
      : Number.isSafeInteger(raw.processing_time_days_min) &&
          Number(raw.processing_time_days_min) >= 0
        ? Number(raw.processing_time_days_min)
        : undefined;
  const processingMax =
    raw.processing_time_days_max === null
      ? null
      : Number.isSafeInteger(raw.processing_time_days_max) &&
          Number(raw.processing_time_days_max) >= 0
        ? Number(raw.processing_time_days_max)
        : undefined;
  if (
    processingMin === undefined ||
    processingMax === undefined ||
    (processingMin !== null &&
      processingMax !== null &&
      processingMin > processingMax)
  )
    return structuredInvalid(
      "information_only",
      "structured processing window is invalid",
    );
  if (
    raw.cancellation_policy !== "not_cancelable" &&
    raw.cancellation_policy !== "provider_defined"
  )
    return structuredInvalid(
      "information_only",
      "structured cancellation policy is invalid",
    );

  const validityValue = raw.validity;
  if (
    !validityValue ||
    typeof validityValue !== "object" ||
    Array.isArray(validityValue)
  )
    return structuredInvalid(
      "information_only",
      "structured validity is missing",
    );
  const validityRecord = validityValue as JsonRecord;
  if (
    !hasOwn(validityRecord, "valid_from") ||
    !hasOwn(validityRecord, "valid_to") ||
    !hasOwn(validityRecord, "timezone")
  )
    return structuredInvalid(
      "information_only",
      "structured validity fields must be explicit",
    );
  const validFrom = validityRecord.valid_from;
  const validTo = validityRecord.valid_to;
  if (
    (validFrom !== null &&
      (typeof validFrom !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/u.test(validFrom))) ||
    (validTo !== null &&
      (typeof validTo !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(validTo))) ||
    validityRecord.timezone !== "Asia/Tokyo" ||
    (typeof validFrom === "string" &&
      typeof validTo === "string" &&
      validTo <= validFrom)
  )
    return structuredInvalid(
      "information_only",
      "structured validity is invalid",
    );
  const claimValidFrom =
    typeof claim.applicability.effective_from === "string"
      ? claim.applicability.effective_from
      : null;
  const claimValidTo =
    typeof claim.applicability.effective_to === "string"
      ? claim.applicability.effective_to
      : null;
  if (validFrom !== claimValidFrom || validTo !== claimValidTo)
    return structuredInvalid(
      "information_only",
      "structured validity must match claim applicability",
    );

  const prerequisiteIds = raw.prerequisite_ids;
  const requiresRuleIds = raw.requires_rule_ids;
  if (
    !Array.isArray(prerequisiteIds) ||
    !Array.isArray(requiresRuleIds) ||
    !prerequisiteIds.every(
      (item) => typeof item === "string" && item.length > 0,
    ) ||
    !requiresRuleIds.every(
      (item) =>
        typeof item === "string" && /^[a-z0-9][a-z0-9.-]{1,119}$/u.test(item),
    ) ||
    new Set(prerequisiteIds).size !== prerequisiteIds.length ||
    new Set(requiresRuleIds).size !== requiresRuleIds.length ||
    prerequisiteIds.length !== requiresRuleIds.length
  )
    return structuredInvalid(
      "information_only",
      "structured prerequisite IDs must be explicit, unique and paired",
    );
  const prerequisiteClaims: Claim[] = [];
  for (let index = 0; index < prerequisiteIds.length; index += 1) {
    const prerequisiteId = prerequisiteIds[index] as string;
    const prerequisite = claims.get(prerequisiteId);
    if (!prerequisite)
      return structuredInvalid(
        "state_required",
        `structured prerequisite claim is missing: ${prerequisiteId}`,
      );
    if (!sourceRoleMatches(prerequisite, sourceBindings))
      return structuredInvalid(
        "information_only",
        `prerequisite source-role membership is not exact: ${prerequisiteId}`,
      );
    if (
      !prerequisite.value ||
      typeof prerequisite.value !== "object" ||
      Array.isArray(prerequisite.value)
    )
      return structuredInvalid(
        "information_only",
        `prerequisite claim is incomplete: ${prerequisiteId}`,
      );
    const prerequisiteValue = prerequisite.value as JsonRecord;
    const declaredPrerequisiteId = prerequisiteValue.prerequisite_id;
    const condition = prerequisiteValue.condition_ja;
    if (
      declaredPrerequisiteId !== requiresRuleIds[index] ||
      typeof condition !== "string" ||
      condition.length === 0
    )
      return structuredInvalid(
        "information_only",
        `prerequisite claim is incomplete: ${prerequisiteId}`,
      );
    prerequisiteClaims.push(prerequisite);
  }
  if (
    !Array.isArray(raw.required_conditions_ja) ||
    !raw.required_conditions_ja.every(
      (item) => typeof item === "string" && item.length <= 120,
    ) ||
    typeof raw.requires_direct_source !== "boolean" ||
    typeof raw.partial_consumption !== "boolean"
  )
    return structuredInvalid(
      "information_only",
      "structured conditions and consumption policy must be explicit",
    );

  return {
    form: {
      route_id: routeId,
      source_asset: sourceAsset,
      destination_asset: destinationAsset,
      source_units: sourceUnits,
      destination_units: destinationUnits,
      minimum_source_units: minimum,
      increment_source_units: increment,
      maximum_source_units_per_request: requestMaximum,
      maximum_source_units_per_period: periodMaximum,
      maximum_period: maximumPeriod,
      fee_source_units: fee,
      ...(feeSchedule === undefined ? {} : { fee_schedule: feeSchedule }),
      ...(allowedSourceAmounts === undefined
        ? {}
        : { allowed_source_amounts: allowedSourceAmounts }),
      ...(periodUsageKey === undefined
        ? {}
        : { period_usage_key: periodUsageKey }),
      ...(periodUsageMin === undefined
        ? {}
        : { period_usage_min_source_units: periodUsageMin }),
      ...(periodUsageMax === undefined
        ? {}
        : { period_usage_max_source_units_exclusive: periodUsageMax }),
      processing_time_days_min: processingMin,
      processing_time_days_max: processingMax,
      cancellation_policy: raw.cancellation_policy,
      valid_from: validFrom,
      valid_to: validTo,
      prerequisite_ids: Object.freeze([...prerequisiteIds]),
      requires_rule_ids: Object.freeze([...requiresRuleIds]),
      required_conditions_ja: Object.freeze([...raw.required_conditions_ja]),
      requires_direct_source: raw.requires_direct_source,
      partial_consumption: raw.partial_consumption,
    },
    prerequisite_claim_ids: Object.freeze(
      prerequisiteClaims.map((item) => item.claim_id),
    ),
    status: null,
    reason: null,
  };
}

function structuredTransferDrafts(
  claims: ReadonlyMap<string, Claim>,
  sourceBindings: ReadonlyMap<string, SourceBinding>,
): {
  readonly drafts: readonly RuleDraft[];
  readonly dispositions: ReadonlyMap<string, P0SpendClaimDisposition>;
  readonly companionClaimIds: ReadonlySet<string>;
} {
  const drafts: RuleDraft[] = [];
  const dispositions = new Map<string, P0SpendClaimDisposition>();
  const companionClaimIds = new Set<string>();
  const routeIds = new Set<string>();
  const ordered = [...claims.values()].sort((left, right) =>
    left.claim_id.localeCompare(right.claim_id),
  );
  for (const claim of ordered) {
    if (
      !claim.value ||
      typeof claim.value !== "object" ||
      Array.isArray(claim.value)
    )
      continue;
    const value = claim.value as JsonRecord;
    if (!structuredForm(value)) continue;
    if (claim.applicability.status === "ended") continue;
    const checked = checkStructuredTransfer(claim, claims, sourceBindings);
    if (!checked.form) {
      if (checked.status && checked.reason)
        dispositions.set(claim.claim_id, {
          claim_id: claim.claim_id,
          status: checked.status,
          reason: checked.reason,
          derived_rule_ids: Object.freeze([]),
        });
      continue;
    }
    const form = checked.form;
    if (routeIds.has(form.route_id))
      throw new TypeError(
        `p0_spend_structured_route_duplicate:${form.route_id}`,
      );
    routeIds.add(form.route_id);
    for (const prerequisiteId of checked.prerequisite_claim_ids)
      companionClaimIds.add(prerequisiteId);
    const claimIds = Object.freeze([
      claim.claim_id,
      ...checked.prerequisite_claim_ids,
    ]);
    drafts.push({
      claimIds,
      build(claimMap) {
        const routeClaim = claimMap.get(claim.claim_id);
        const prerequisiteClaims = checked.prerequisite_claim_ids.map((id) =>
          claimMap.get(id),
        );
        if (!routeClaim || prerequisiteClaims.some((item) => !item))
          throw new TypeError(
            `p0_spend_structured_claim_missing:${claim.claim_id}`,
          );
        const conditionClaims = prerequisiteClaims as Claim[];
        const conditions = [
          ...form.required_conditions_ja,
          ...conditionClaims.map(
            (item) => claimValue(item).condition_ja as string,
          ),
        ];
        return rule([routeClaim, ...conditionClaims], {
          rule_id: `p0.transfer.${form.route_id}`,
          kind: "transfer",
          label_ja: routeClaim.subject,
          source_asset: form.source_asset,
          destination_asset: form.destination_asset,
          source_units: form.source_units,
          destination_units: form.destination_units,
          minimum_source_units: form.minimum_source_units,
          increment_source_units: form.increment_source_units,
          maximum_source_units_per_request:
            form.maximum_source_units_per_request,
          maximum_source_units_per_period: form.maximum_source_units_per_period,
          maximum_period: form.maximum_period,
          fee_source_units: form.fee_source_units,
          ...(form.fee_schedule === undefined
            ? {}
            : { fee_schedule: form.fee_schedule }),
          ...(form.allowed_source_amounts === undefined
            ? {}
            : { allowed_source_amounts: form.allowed_source_amounts }),
          ...(form.period_usage_key === undefined
            ? {}
            : { period_usage_key: form.period_usage_key }),
          ...(form.period_usage_min_source_units === undefined
            ? {}
            : {
                period_usage_min_source_units:
                  form.period_usage_min_source_units,
              }),
          ...(form.period_usage_max_source_units_exclusive === undefined
            ? {}
            : {
                period_usage_max_source_units_exclusive:
                  form.period_usage_max_source_units_exclusive,
              }),
          processing_time_days_min: form.processing_time_days_min,
          processing_time_days_max: form.processing_time_days_max,
          cancellation_policy: form.cancellation_policy,
          valid_from: form.valid_from,
          valid_to: form.valid_to,
          required_conditions_ja: conditions,
          requires_rule_ids: form.requires_rule_ids,
          partial_consumption: form.partial_consumption,
          requires_direct_source: form.requires_direct_source,
        });
      },
    });
  }
  return {
    drafts: Object.freeze(drafts),
    dispositions,
    companionClaimIds,
  };
}

const COMPANION_CLAIM_IDS = new Set([
  "claim.point.ponta.transfer.jal-unit-timing.001",
  "claim.emoney.nanaco.service.001",
]);

function claimRecord(value: unknown): Claim {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("p0_spend_claim_invalid");
  const record = value as JsonRecord;
  const claimId = stringValue(record, "claim_id");
  const familyId = stringValue(record, "family_id");
  const sourceRoleId = stringValue(record, "source_role_id");
  const subject = stringValue(record, "subject");
  const predicate = stringValue(record, "predicate");
  const claimType = stringValue(record, "claim_type");
  const valueRecord = record.value;
  const applicability = record.applicability;
  const ids = record.source_ids;
  const exclusions = record.exclusions ?? [];
  if (
    !claimId ||
    !familyId ||
    !sourceRoleId ||
    !subject ||
    !predicate ||
    !claimType ||
    valueRecord === undefined ||
    !applicability ||
    typeof applicability !== "object" ||
    Array.isArray(applicability) ||
    !Array.isArray(ids) ||
    ids.length === 0 ||
    !ids.every((id) => typeof id === "string" && id.length > 0) ||
    !Array.isArray(exclusions) ||
    !exclusions.every((item) => typeof item === "string")
  )
    throw new TypeError(`p0_spend_claim_invalid:${claimId ?? "unknown"}`);
  return {
    claim_id: claimId,
    family_id: familyId,
    source_role_id: sourceRoleId,
    source_ids: Object.freeze([...ids].sort()),
    subject,
    predicate,
    claim_type: claimType,
    value: valueRecord,
    applicability: applicability as JsonRecord,
    exclusions: Object.freeze([...exclusions]),
  };
}

function defaultDisposition(claim: Claim): P0SpendClaimDisposition {
  const status = claim.applicability.status;
  const effectiveTo = claim.applicability.effective_to;
  if (
    status === "ended" ||
    (typeof effectiveTo === "string" && effectiveTo < "2026-08-23")
  )
    return {
      claim_id: claim.claim_id,
      status: "inactive",
      reason: "適用期間外のため計算しません",
      derived_rule_ids: [],
    };
  if (
    /third|annual|cap|eligibility|minimum|timing|cancel|priority/u.test(
      `${claim.claim_id} ${claim.predicate}`,
    )
  )
    return {
      claim_id: claim.claim_id,
      status: "state_required",
      reason: "利用回数・上限・会員状態などの追加入力が必要です",
      derived_rule_ids: [],
    };
  return {
    claim_id: claim.claim_id,
    status: "information_only",
    reason: "固定比率として安全に表現できる数量が不足しています",
    derived_rule_ids: [],
  };
}

/**
 * Compile the explicit fixed-ratio/redemption subset of the P0 research wave.
 * Every other claim receives a deterministic non-executable disposition; the
 * compiler never guesses a rate from prose, examples, lotteries, or maxima.
 */
export function compileP0SpendRuleSet(input: unknown): P0SpendRuleSet {
  const cloned = clonePlainResearchValue(input);
  if (!Array.isArray(cloned)) throw new TypeError("p0_spend_artifacts_invalid");
  const artifacts = cloned as unknown[];
  const claims = new Map<string, Claim>();
  const artifactIds: string[] = [];
  const sourceBindings = new Map<string, SourceBinding>();
  for (const artifact of artifacts) {
    if (!artifact || typeof artifact !== "object" || Array.isArray(artifact))
      throw new TypeError("p0_spend_artifact_invalid");
    const record = artifact as JsonRecord;
    const metadata = record.metadata;
    const artifactId =
      metadata && typeof metadata === "object" && !Array.isArray(metadata)
        ? stringValue(metadata as JsonRecord, "artifact_id")
        : null;
    if (!artifactId || !Array.isArray(record.claims))
      throw new TypeError("p0_spend_artifact_invalid");
    artifactIds.push(artifactId);
    if (Array.isArray(record.sources))
      for (const rawSource of record.sources) {
        if (
          !rawSource ||
          typeof rawSource !== "object" ||
          Array.isArray(rawSource)
        )
          throw new TypeError("p0_spend_source_invalid");
        const source = rawSource as JsonRecord;
        const sourceId = stringValue(source, "source_id");
        const familyId = stringValue(source, "family_id");
        const url = stringValue(source, "url");
        const publisher = stringValue(source, "publisher");
        const officialDomain = stringValue(source, "official_domain");
        const roles = source.roles;
        if (
          !sourceId ||
          !familyId ||
          !url ||
          !publisher ||
          !officialDomain ||
          !Array.isArray(roles) ||
          roles.length === 0 ||
          !roles.every((role) => typeof role === "string" && role.length > 0)
        )
          throw new TypeError(
            `p0_spend_source_invalid:${sourceId ?? "unknown"}`,
          );
        const normalizedRoles = new Set(roles as string[]);
        const existingSource = sourceBindings.get(sourceId);
        if (existingSource) {
          const sameRoles =
            existingSource.roles.size === normalizedRoles.size &&
            [...existingSource.roles].every((role) =>
              normalizedRoles.has(role),
            );
          if (
            existingSource.family_id !== familyId ||
            existingSource.url !== url ||
            existingSource.publisher !== publisher ||
            existingSource.official_domain !== officialDomain ||
            !sameRoles
          )
            throw new TypeError(`p0_spend_source_conflict:${sourceId}`);
        } else {
          sourceBindings.set(sourceId, {
            family_id: familyId,
            roles: normalizedRoles,
            url,
            publisher,
            official_domain: officialDomain,
          });
        }
      }
    for (const rawClaim of record.claims) {
      const claim = claimRecord(rawClaim);
      if (claims.has(claim.claim_id))
        throw new TypeError(`p0_spend_claim_duplicate:${claim.claim_id}`);
      claims.set(claim.claim_id, claim);
    }
  }

  const structured = structuredTransferDrafts(claims, sourceBindings);
  // Built-in legacy drafts describe known checked-in claim groups. Dynamic
  // Agent Feed directory snapshots are intentionally smaller and must not be
  // forced to carry every historical claim merely to compile one exact row.
  const drafts = [
    ...DRAFTS.filter((draft) =>
      draft.claimIds.every((claimId) => claims.has(claimId)),
    ),
    ...structured.drafts,
  ];
  const rules = drafts
    .map((draft) => draft.build(claims))
    .sort((left, right) => left.rule_id.localeCompare(right.rule_id));
  const ruleByClaim = new Map<string, string[]>();
  for (const item of rules)
    for (const claimId of item.source_claim_ids)
      ruleByClaim.set(claimId, [
        ...(ruleByClaim.get(claimId) ?? []),
        item.rule_id,
      ]);
  const dispositions = [...claims.values()]
    .map((claim): P0SpendClaimDisposition => {
      const ids = ruleByClaim.get(claim.claim_id);
      const structuredDisposition = structured.dispositions.get(claim.claim_id);
      return ids
        ? {
            claim_id: claim.claim_id,
            status:
              COMPANION_CLAIM_IDS.has(claim.claim_id) ||
              structured.companionClaimIds.has(claim.claim_id)
                ? "companion_constraint"
                : "executable",
            reason:
              COMPANION_CLAIM_IDS.has(claim.claim_id) ||
              structured.companionClaimIds.has(claim.claim_id)
                ? "互換性のある固定比率ルールへ条件を統合しました"
                : "明示された固定比率を計算できます",
            derived_rule_ids: Object.freeze(ids.sort()),
          }
        : (structuredDisposition ?? defaultDisposition(claim));
    })
    .sort((left, right) => left.claim_id.localeCompare(right.claim_id));
  const projection = {
    version: P0_SPEND_RULE_SET_VERSION,
    source_artifact_ids: [...new Set(artifactIds)].sort(),
    rule_count: rules.length,
    rules,
    dispositions,
  };
  return deepFreeze({
    ...projection,
    rule_set_hash: hashCanonical(projection),
  }) as P0SpendRuleSet;
}
