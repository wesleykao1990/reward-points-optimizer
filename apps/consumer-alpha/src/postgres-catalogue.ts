import {
  createPostgresExperimentalCatalogueStore,
  type P0ExperimentalCatalogueRecord,
  type P0ExperimentalPaymentAcceptanceRecord,
  type P0ExperimentalRewardRateRecord,
  type QueryTarget,
} from "@jro/agent-feed-postgres";
import type {
  ExperimentalCatalogueCard,
  ExperimentalCataloguePort,
  ExperimentalCatalogueSnapshot,
  ExperimentalCorrectionInput,
} from "./contracts.js";
import { normalizeExperimentalCatalogueSnapshot } from "./provisional-catalog.js";

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
  });
}

function latestDate(
  records: readonly P0ExperimentalCatalogueRecord[],
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
  return Object.freeze({
    async list(): Promise<ExperimentalCatalogueSnapshot> {
      const records = await store.list();
      return normalizeExperimentalCatalogueSnapshot({
        status: "ready",
        updated_at: latestDate(records),
        rules: records.map(mapPostgresCatalogueRecordToCard),
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
