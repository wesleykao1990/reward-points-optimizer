import {
  createPostgresExperimentalCatalogueStore,
  createPostgresNanacoCreditChargeRouteStore,
  type NanacoCreditChargeRouteRecord,
  type P0ExperimentalCatalogueRecord,
  type P0ExperimentalPaymentAcceptanceRecord,
  type P0ExperimentalRewardRateRecord,
  type QueryTarget,
} from "@jro/agent-feed-postgres";
import { getNanacoEconomicPilotRule } from "@jro/provisional-rules";
import type {
  ExperimentalCatalogueCard,
  ExperimentalCataloguePort,
  ExperimentalCatalogueSnapshot,
  ExperimentalCorrectionInput,
} from "./contracts.js";
import {
  createNanacoCreditChargeRecommendationPort,
  NANACO_CREDIT_CHARGE_PUBLICATION_ID,
  type NanacoCreditChargeRuleSource,
} from "./nanaco-credit-charge-recommendation.js";
import { normalizeExperimentalCatalogueSnapshot } from "./provisional-catalog.js";
import {
  createNanacoExperimentalRecommendationPort,
  NANACO_EXPERIMENTAL_ACCEPTANCE_PUBLICATION_ID,
  NANACO_EXPERIMENTAL_ACCEPTANCE_RULE_ID,
  NANACO_EXPERIMENTAL_PUBLICATION_ID,
  type NanacoExperimentalRuleSource,
} from "./real-experimental-recommendation.js";

const NANACO_TITLE = "nanacoの買い物ポイント";
const NANACO_CONFIDENCE = "high" as const;

/**
 * Reduce the database adapter's private record to the exact browser card.
 * The database record carries hashes and the candidate definition only long
 * enough for the trusted adapter to validate them; none of those fields are
 * copied into this projection.
 */
export function mapPostgresCatalogueRecordToCard(
  record: P0ExperimentalCatalogueRecord,
): ExperimentalCatalogueCard {
  if (record.kind === "payment_acceptance")
    return mapPostgresPaymentAcceptanceRecordToCard(record);
  return mapPostgresNanacoRecordToCard(record);
}

export function mapPostgresNanacoRecordToCard(
  record: P0ExperimentalRewardRateRecord,
): ExperimentalCatalogueCard {
  return Object.freeze({
    publication_id: record.publication_id,
    kind: "reward_rate",
    title: NANACO_TITLE,
    summary: `セブン‐イレブンでnanacoを利用すると、税抜${record.spend_jpy}円ごとにnanacoポイント${record.reward_units}ポイントが貯まるという先行公開情報です。`,
    display_status: "experimental_unverified",
    confidence: NANACO_CONFIDENCE,
    source_label: record.source_label,
    checked_at: record.checked_at,
    valid_from: record.valid_from,
    valid_to: record.valid_to,
  });
}

export function mapPostgresPaymentAcceptanceRecordToCard(
  record: P0ExperimentalPaymentAcceptanceRecord,
): ExperimentalCatalogueCard {
  return Object.freeze({
    publication_id: record.publication_id,
    kind: "payment_acceptance",
    title: "セブン‐イレブンの支払い方法",
    summary: `セブン‐イレブンで「${record.display_name_ja}」を利用できるという先行公開情報です。`,
    display_status: "experimental_unverified",
    confidence: "high",
    source_label: record.source_label,
    checked_at: record.checked_at,
    valid_from: record.valid_from,
    valid_to: record.valid_to,
  });
}

export function mapPostgresNanacoCreditChargeRecordToCard(
  record: NanacoCreditChargeRouteRecord,
): ExperimentalCatalogueCard {
  return Object.freeze({
    publication_id: record.route_id,
    kind: "other",
    title: "セブンカード・プラスからnanacoへチャージ",
    summary:
      "事前登録済みのセブンカード・プラスで、5,000円以上・1,000円単位、1回30,000円までnanacoへチャージできます。チャージ後残高は50,000円までです。",
    display_status: "experimental_unverified",
    confidence: "high",
    source_label: "nanaco・セブンカード公式情報",
    checked_at: record.checked_at,
    valid_from: record.valid_from,
    valid_to: record.valid_to,
  });
}

function latestDate(
  records: readonly {
    readonly checked_at: string;
    readonly admitted_at: string;
  }[],
): string | null {
  let latest: { readonly timestamp: number; readonly value: string } | null =
    null;
  for (const record of records) {
    for (const value of [record.checked_at, record.admitted_at]) {
      const timestamp = Date.parse(value);
      if (
        Number.isFinite(timestamp) &&
        (latest === null || timestamp > latest.timestamp)
      )
        latest = { timestamp, value };
    }
  }
  return latest?.value ?? null;
}

/**
 * Compose the app's existing ExperimentalCataloguePort with the driver-free
 * PostgreSQL store. This module imports no driver and exposes no DB fields.
 */
export function createPostgresExperimentalCataloguePort(
  target: QueryTarget,
): ExperimentalCataloguePort {
  const store = createPostgresExperimentalCatalogueStore(target);
  const creditChargeStore = createPostgresNanacoCreditChargeRouteStore(target);
  return Object.freeze({
    async list(effectiveAt?: string): Promise<ExperimentalCatalogueSnapshot> {
      const [records, creditCharge] = await Promise.all([
        store.list(effectiveAt),
        creditChargeStore
          .current(effectiveAt ?? new Date().toISOString())
          .catch(() => null),
      ]);
      const cards = records.map(mapPostgresCatalogueRecordToCard);
      if (creditCharge)
        cards.push(mapPostgresNanacoCreditChargeRecordToCard(creditCharge));
      return normalizeExperimentalCatalogueSnapshot({
        status: "ready",
        updated_at: latestDate([
          ...records,
          ...(creditCharge ? [creditCharge] : []),
        ]),
        rules: cards,
      });
    },

    async reportCorrection(
      input: ExperimentalCorrectionInput,
    ): Promise<unknown> {
      return store.reportCorrection(input);
    },
  });
}

export const createPostgresCataloguePort =
  createPostgresExperimentalCataloguePort;

/**
 * Bind the recommendation lane to the same current-view catalogue proof used
 * by the browser cards. A static rule accessor supplies only the exact sealed
 * body; it cannot make the route current, so both catalogue identities must be
 * present at the requested effective time before evaluation is admitted.
 */
export function createPostgresNanacoExperimentalRecommendationPort(
  target: QueryTarget,
) {
  const store = createPostgresExperimentalCatalogueStore(target);
  const source: NanacoExperimentalRuleSource = Object.freeze({
    async current(effectiveAt: string) {
      const records = await store.list(effectiveAt);
      const reward = records.find(
        (record): record is P0ExperimentalRewardRateRecord =>
          record.kind === "reward_rate" &&
          record.publication_id === NANACO_EXPERIMENTAL_PUBLICATION_ID &&
          record.rule_id === "rr_jp_cvs_006_nanaco_purchase_reward",
      );
      const acceptance = records.find(
        (record): record is P0ExperimentalPaymentAcceptanceRecord =>
          record.kind === "payment_acceptance" &&
          record.publication_id ===
            NANACO_EXPERIMENTAL_ACCEPTANCE_PUBLICATION_ID &&
          record.payment_family === "nanaco",
      );
      if (!reward || !acceptance)
        throw new Error("nanaco_experimental_route_not_current");
      return {
        reward_candidate_id: reward.publication_id,
        reward_rule: getNanacoEconomicPilotRule(),
        acceptance_candidate_id: acceptance.publication_id,
        acceptance_rule_id: NANACO_EXPERIMENTAL_ACCEPTANCE_RULE_ID,
      };
    },
  });
  return createNanacoExperimentalRecommendationPort(source);
}

export const createPostgresExperimentalRecommendationPort =
  createPostgresNanacoExperimentalRecommendationPort;

/** Bind the separate top-up lane to its own evidence-bound DB route. */
export function createPostgresNanacoCreditChargeRecommendationPort(
  target: QueryTarget,
) {
  const store = createPostgresNanacoCreditChargeRouteStore(target);
  const source: NanacoCreditChargeRuleSource = Object.freeze({
    async current(effectiveAt: string) {
      const record = await store.current(effectiveAt);
      if (record.route_id !== NANACO_CREDIT_CHARGE_PUBLICATION_ID)
        throw new Error("nanaco_credit_charge_route_not_current");
      return {
        route_id: record.route_id,
        candidate_id: record.candidate_id,
        candidate_hash: record.candidate_hash,
        definition_hash: record.definition_hash,
        finding_id: record.finding_id,
        claim_ids: record.claim_ids,
        evidence_ids: record.evidence_ids,
        source_ids: record.source_ids,
        reward_rule: record.reward_rule,
      };
    },
  });
  return createNanacoCreditChargeRecommendationPort(source);
}
