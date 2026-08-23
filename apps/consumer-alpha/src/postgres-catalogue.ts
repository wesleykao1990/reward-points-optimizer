import {
  createPostgresExperimentalCatalogueStore,
  createPostgresNanacoCreditChargeRouteStore,
  loadCurrentP0EconomicRuleIRs,
  type NanacoCreditChargeRouteRecord,
  P0_EXPERIMENTAL_CATALOGUE_QUERY,
  type P0ExperimentalCatalogueRecord,
  type P0ExperimentalPaymentAcceptanceRecord,
  type P0ExperimentalRewardRateRecord,
  type P0TrustedRuleIRBindings,
  type QueryTarget,
} from "@jro/agent-feed-postgres";
import {
  NANACO_CREDIT_CHARGE_CLAIM_IDS,
  NANACO_CREDIT_CHARGE_EVIDENCE_IDS,
} from "@jro/provisional-rules";
import type {
  ExperimentalCatalogueCard,
  ExperimentalCataloguePort,
  ExperimentalCatalogueSnapshot,
  ExperimentalCorrectionInput,
} from "./contracts.js";
import {
  createNanacoCreditChargeRecommendationPort,
  getNanacoCreditChargeRuleIRMaterial,
  NANACO_CREDIT_CHARGE_PUBLICATION_ID,
  type NanacoCreditChargeRuleSource,
} from "./nanaco-credit-charge-recommendation.js";
import { normalizeExperimentalCatalogueSnapshot } from "./provisional-catalog.js";
import {
  createNanacoExperimentalRecommendationPort,
  getNanacoExperimentalRuleIRMaterial,
  NANACO_EXPERIMENTAL_ACCEPTANCE_PUBLICATION_ID,
  NANACO_EXPERIMENTAL_ACCEPTANCE_RULE_ID,
  NANACO_EXPERIMENTAL_PUBLICATION_ID,
  type NanacoExperimentalRuleSource,
} from "./real-experimental-recommendation.js";

const NANACO_TITLE = "nanacoの買い物ポイント";
const NANACO_CONFIDENCE = "high" as const;
const NANACO_RULE_IR_BINDINGS: P0TrustedRuleIRBindings = Object.freeze({
  claim_id: "claim.point.nanaco.earn.shopping-immediate.004",
  evidence_ids: Object.freeze(["ev_m3_nanaco_shopping_earning_20260820"]),
  ...getNanacoExperimentalRuleIRMaterial(),
});
const NANACO_CREDIT_CHARGE_RULE_IR_BINDINGS: P0TrustedRuleIRBindings =
  Object.freeze({
    claim_id: NANACO_CREDIT_CHARGE_CLAIM_IDS[0],
    evidence_ids: Object.freeze([...NANACO_CREDIT_CHARGE_EVIDENCE_IDS]),
    ...getNanacoCreditChargeRuleIRMaterial(),
  });

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
    source_url: record.source_url,
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
    source_url: record.source_url,
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
    source_url: null,
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
      const compiled = await loadCurrentP0EconomicRuleIRs(target, {
        effective_at: effectiveAt,
        rule_ids: ["rr_jp_cvs_006_nanaco_purchase_reward"],
        bindings: {
          [reward.publication_id]: NANACO_RULE_IR_BINDINGS,
        },
      });
      const rewardRuleIR = compiled.rule_irs.find(
        (item) => item.rule.rule_id === "rr_jp_cvs_006_nanaco_purchase_reward",
      );
      if (!rewardRuleIR || compiled.issues.length > 0)
        throw new Error("nanaco_experimental_rule_ir_not_current");
      return {
        reward_candidate_id: reward.publication_id,
        reward_rule: rewardRuleIR.rule,
        rule_ir: rewardRuleIR,
        acceptance_candidate_id: acceptance.publication_id,
        acceptance_rule_id: NANACO_EXPERIMENTAL_ACCEPTANCE_RULE_ID,
      };
    },
  });
  return createNanacoExperimentalRecommendationPort(source);
}

export const createPostgresExperimentalRecommendationPort =
  createPostgresNanacoExperimentalRecommendationPort;

/**
 * Adapt the credit-charge route's complete candidate projection to the exact
 * row shape consumed by the generic P0 Rule IR loader. The route store has
 * already validated the DB row; this projection deliberately carries no
 * checked-in replacement candidate.
 */
function nanacoCreditChargeRuleIRRow(
  record: NanacoCreditChargeRouteRecord,
): Record<string, unknown> {
  return {
    admitted_at: record.admitted_at,
    candidate_hash: record.candidate_hash,
    candidate_id: record.candidate_id,
    candidate_payload: structuredClone(record.candidate_payload),
    definition_hash: record.definition_hash,
    machine_checked_at: record.checked_at,
    observation_fingerprint: record.observation_fingerprint,
    p0_family_id: record.p0_family_id,
    source_authority_role: record.source_authority_role,
    source_ids: [...record.source_ids],
    source_observation_id: record.source_observation_id,
    source_observation_key: record.source_observation_key,
    source_role_id: record.source_role_id,
    status: record.status,
  };
}

function creditChargeRuleIRTarget(
  target: QueryTarget,
  record: NanacoCreditChargeRouteRecord,
): QueryTarget {
  const row = nanacoCreditChargeRuleIRRow(record);
  return Object.freeze({
    async query<Row = unknown>(text: string, values?: readonly unknown[]) {
      if (text === P0_EXPERIMENTAL_CATALOGUE_QUERY)
        return { rows: [row as Row] };
      return target.query<Row>(text, values);
    },
  });
}

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
      const compiled = await loadCurrentP0EconomicRuleIRs(
        creditChargeRuleIRTarget(target, record),
        {
          effective_at: effectiveAt,
          rule_ids: [record.reward_rule.rule_id],
          bindings: {
            [record.candidate_id]: NANACO_CREDIT_CHARGE_RULE_IR_BINDINGS,
          },
        },
      );
      const ruleIR = compiled.rule_irs.find(
        (item) => item.rule.rule_id === record.reward_rule.rule_id,
      );
      if (!ruleIR || compiled.issues.length > 0)
        throw new Error("nanaco_credit_charge_rule_ir_not_current");
      return {
        route_id: record.route_id,
        candidate_id: record.candidate_id,
        candidate_hash: record.candidate_hash,
        definition_hash: record.definition_hash,
        finding_id: record.finding_id,
        claim_ids: record.claim_ids,
        evidence_ids: record.evidence_ids,
        source_ids: record.source_ids,
        reward_rule: ruleIR.rule,
        rule_ir: ruleIR,
      };
    },
  });
  return createNanacoCreditChargeRecommendationPort(source);
}
