import { createHash } from "node:crypto";
import {
  type RecommendationRequest,
  type RuleAssurance,
  recommend,
} from "@jro/recommendation-api";
import {
  makeAssetDefinitions,
  makeDirectPurchasePlan,
  makeOpeningWalletLot,
  makeSyntheticRules,
  makeTopupPurchasePlan,
  makeUserState,
  SYNTHETIC_REPLAY_KNOWLEDGE_TIME,
  SYNTHETIC_TRANSACTION_TIME,
} from "@jro/test-fixtures";
import {
  type ManualAlphaState,
  SYNTHETIC_BRANCH_ID,
  SYNTHETIC_MERCHANT_ID,
} from "./contracts.js";

type UserState = ReturnType<typeof makeUserState>;

export const SYNTHETIC_CATALOG = Object.freeze({
  version: "m6-synthetic-catalog-v1",
  merchants: [
    {
      merchant_id: "merchant.synthetic",
      name: "Synthetic convenience store",
      aliases: ["Synthetic Shop", "Synthetic Merchant"],
      branches: [
        {
          branch_id: "location.synthetic",
          name: "Tokyo synthetic branch",
          aliases: ["Tokyo Synthetic", "Tokyo branch"],
        },
      ],
    },
  ],
} as const);

const SYNTHETIC_CATALOG_VERSION = SYNTHETIC_CATALOG.version;
const SYNTHETIC_REQUEST_VERSION = "1" as const;

const SYNTHETIC_SOURCE_ID = "source.synthetic";
const USAGE_VALUATIONS: Readonly<Record<string, string>> = Object.freeze({
  within_30_days: "1",
  within_90_days: "0.95",
  eventually: "0.8",
  rarely: "0.5",
});

function assuranceFor(ruleId: string, version: number): RuleAssurance {
  return {
    rule_id: ruleId,
    version,
    status: "approved",
    terms_reviewed: true,
    terms_status: "approved",
    review_approved: true,
    review_status: "approved",
    canonical_evidence: [
      {
        evidence_id: `ev_${ruleId}`,
        source_id: SYNTHETIC_SOURCE_ID,
        verified: true,
      },
    ],
    canonical_evidence_ids: [`ev_${ruleId}`],
    evidence_verified: true,
    sources: [{ source_id: SYNTHETIC_SOURCE_ID, verified: true }],
    source_ids: [SYNTHETIC_SOURCE_ID],
    sources_verified: true,
    freshness_status: "healthy",
    risk_status: "low",
    unresolved_high_risk: false,
  };
}

function userStateFor(input: ManualAlphaState): UserState {
  const valuation =
    input.stored_value_use === "yes"
      ? input.stored_value_usage === "custom"
        ? input.stored_value_value_jpy_per_unit
        : USAGE_VALUATIONS[input.stored_value_usage ?? ""]
      : "0";
  if (!valuation) throw new Error("stored_value_valuation_unavailable");
  const openingLots =
    input.stored_value_use === "yes"
      ? [makeOpeningWalletLot("1000", "lot_m6_opening_wallet")]
      : [];
  const state = makeUserState(valuation, openingLots);
  state.owned_instrument_ids = input.owned_instruments.map((instrument) => {
    if (instrument === "synthetic_card") return "instrument.synthetic.card";
    if (instrument === "synthetic_qr_wallet") return "instrument.synthetic.qr";
    return "instrument.synthetic.stored_value";
  });
  state.facts = Object.fromEntries(
    input.facts.map((fact) => [
      fact.key,
      {
        status: fact.status,
        ...(fact.status === "known" ? { value: fact.value } : {}),
        source: "user_input" as const,
        observed_at: SYNTHETIC_TRANSACTION_TIME,
      },
    ]),
  );
  state.cap_progress = Object.fromEntries(
    input.caps.map((cap) => [
      cap.key,
      {
        status: cap.status,
        ...(cap.status === "known"
          ? {
              eligible_spend_jpy_min: cap.spend_jpy,
              eligible_spend_jpy_max: cap.spend_jpy,
            }
          : {}),
        period_start: "2026-08-01T00:00:00+09:00",
        period_end: "2026-08-31T23:59:59+09:00",
        observed_at: SYNTHETIC_TRANSACTION_TIME,
        source: "user_input" as const,
      },
    ]),
  );
  return state;
}

function requestIdFor(input: ManualAlphaState): string {
  const normalized = {
    app_version: "m6-alpha-v1",
    catalog_version: SYNTHETIC_CATALOG_VERSION,
    request_version: SYNTHETIC_REQUEST_VERSION,
    merchant_id: input.merchant_id,
    branch_id: input.branch_id,
    amount_jpy: input.amount_jpy,
    owned_instruments: input.owned_instruments,
    stored_value_use: input.stored_value_use,
    stored_value_usage: input.stored_value_usage ?? null,
    stored_value_value_jpy_per_unit:
      input.stored_value_value_jpy_per_unit ?? null,
    facts: input.facts,
    caps: input.caps,
  } as const;
  const canonical = canonicalJson(normalized);
  const digest = createHash("sha256").update(canonical, "utf8").digest("hex");
  return `sha256:${digest}`;
}

/** Canonical JSON for the already-normalized, scalar-only browser contract. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

export function buildSyntheticRecommendationRequest(
  input: ManualAlphaState,
): RecommendationRequest {
  const rules = makeSyntheticRules();
  // The fixture helper supplies a complete, deterministic rule set.  Keep
  // this explicit check so a future fixture edit cannot silently omit a rule.
  if (rules.length === 0) throw new Error("synthetic_rules_unavailable");
  const amount = input.amount_jpy;
  const purchaseLine = {
    product_class: "ordinary",
    amount_jpy: amount,
    quantity: 1,
    eligible_for_rewards: true,
  } as const;
  const assurances = rules.map((rule) =>
    assuranceFor(rule.rule_id, rule.version),
  );
  const valuation =
    input.stored_value_use === "yes"
      ? input.stored_value_usage === "custom"
        ? input.stored_value_value_jpy_per_unit
        : USAGE_VALUATIONS[input.stored_value_usage ?? ""]
      : null;
  const userState = userStateFor(input);
  const questions = [
    ...(input.stored_value_use === "unknown"
      ? ["Should stored value be used for this purchase?"]
      : []),
  ];
  const candidatePlans = [];
  if (input.owned_instruments.includes("synthetic_card")) {
    candidatePlans.push(makeDirectPurchasePlan(amount));
    if (
      input.stored_value_use === "yes" &&
      input.stored_value_usage !== undefined &&
      input.owned_instruments.includes("synthetic_stored_value")
    )
      candidatePlans.push(
        makeTopupPurchasePlan(Math.max(amount, 1000), amount),
      );
  }
  if (candidatePlans.length === 0)
    throw new Error("no_supported_owned_instrument");
  return {
    version: "1",
    request_id: requestIdFor(input),
    mode: "synthetic_internal",
    transaction_time: SYNTHETIC_TRANSACTION_TIME,
    replay_knowledge_at: SYNTHETIC_REPLAY_KNOWLEDGE_TIME,
    timezone: "Asia/Tokyo",
    source_maintenance_status: { status: "insufficient_data" },
    merchant_query: {
      merchant_id: SYNTHETIC_MERCHANT_ID,
      branch_id: SYNTHETIC_BRANCH_ID,
    },
    merchant_catalog: SYNTHETIC_CATALOG,
    comparison: {
      merchant_id: SYNTHETIC_MERCHANT_ID,
      merchant_location_id: SYNTHETIC_BRANCH_ID,
      amount_jpy: amount,
      channel: "in_store",
      interface: "physical_card",
      line_items: [purchaseLine],
    },
    candidate_plans: candidatePlans,
    rules,
    assets: makeAssetDefinitions(),
    user_state: userState,
    opening_asset_lots: userState.asset_lots,
    valuation_profile: userState.valuation_profile.entries,
    objective: {
      primary: "maximize_guaranteed_net_value",
      probabilistic_reward_policy: "guaranteed_only",
      ending_asset_valuation: "use_user_profile",
      tie_breakers: ["lower_external_funding", "fewer_operations"],
    },
    rule_assurances: assurances,
    freshness: {
      checked_at: SYNTHETIC_REPLAY_KNOWLEDGE_TIME,
      source_ids: [SYNTHETIC_SOURCE_ID],
      notes: ["Synthetic fixture only; not a current source observation."],
    },
    evidence_refs: rules.map((rule) => ({
      evidence_id: `ev_${rule.rule_id}`,
      source_id: SYNTHETIC_SOURCE_ID,
      captured_at: SYNTHETIC_REPLAY_KNOWLEDGE_TIME,
    })),
    assumptions: [
      "All merchant, acceptance, reward, and valuation facts are synthetic.",
      "The host supplies the complete fixture rule and evidence set.",
      ...(input.stored_value_use === "yes" && valuation
        ? [
            `Stored-value usage is ${input.stored_value_usage}; the fixture valuation is ${valuation} JPY per unit.`,
          ]
        : []),
      ...(input.stored_value_use === "no"
        ? ["The user opted out of stored-value use for this run."]
        : []),
      ...(input.stored_value_use === "unknown"
        ? [
            "Stored-value use is unknown; the stored-value candidate is withheld.",
          ]
        : []),
    ],
    questions,
  };
}

export function evaluateSynthetic(input: ManualAlphaState) {
  return recommend(buildSyntheticRecommendationRequest(input));
}

/** Small non-sensitive fixture metadata for the browser contract. */
export const SYNTHETIC_ALPHA_CONFIG = Object.freeze({
  version: "m6-alpha-v1",
  timezone: "Asia/Tokyo",
  region: "Tokyo",
  merchant_id: SYNTHETIC_MERCHANT_ID,
  merchant_name: "Synthetic convenience store",
  branch_id: SYNTHETIC_BRANCH_ID,
  branch_name: "Tokyo synthetic branch",
  amount_min_jpy: 1,
  amount_max_jpy: 1_000_000,
  instruments: [
    "synthetic_card",
    "synthetic_qr_wallet",
    "synthetic_stored_value",
  ],
  stored_value_use: ["yes", "no", "unknown"],
  stored_value_usage: [
    "within_30_days",
    "within_90_days",
    "eventually",
    "rarely",
    "custom",
  ],
  correction_categories: [
    "wrong_merchant",
    "wrong_branch",
    "wrong_plan",
    "missing_reward",
    "unexpected_reward",
    "wrong_reward_amount",
  ],
  synthetic_only: true,
});
