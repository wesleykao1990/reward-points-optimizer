/* eslint-disable */
/**
 * Sealed P0 candidate for the Seven Card Plus -> nanaco credit-charge route.
 *
 * This is intentionally a separate artifact from the ordinary purchase
 * earning candidate.  The two operations have different principal and
 * eligibility semantics, so the purchase rule must never be reused here.
 */
import { hashCandidate, hashDefinition } from "./canonical.js";
import { deepFreeze } from "./security.js";
import type { ProvisionalRuleCandidate } from "./types.js";

const candidate = {
  version: "provisional-rule-candidate.v1",
  candidate_id: "candidate_p0_nanaco_sevencard_credit_charge_20260822_v0_1",
  observation_id: "so_p0_nanaco_sevencard_credit_charge_20260822",
  observation_fingerprint:
    "sha256:4d3c2e7c57f17b3c95f96d2e4e7de1bb174b1a5fb77b428db5e886d5c8f4e5a1",
  p0_family_id: "point.nanaco",
  source_role_id: "earn_rules",
  source_authority_role: "primary",
  source_ids: ["jp.nanaco.sevencard-earning", "jp.sevencard.nanaco-charge"],
  rule: {
    rule_id: "rr_jp_cvs_006_sevencard_credit_topup_reward",
    version: 1,
    status: "under_review",
    rule_type: "card_benefit",
    name: "Seven Card Plus nanaco credit-charge earning",
    description:
      "Under-review candidate for the separate Seven Card Plus credit-funded nanaco top-up operation.",
    subject: {
      entity_type: "credit_card",
      entity_id: "instrument.jp.seven-card-plus",
    },
    scope: {
      countries: ["JP"],
      operation_types: ["stored_value_top_up"],
      channels: ["not_applicable"],
      tax_basis: "tax_inclusive",
    },
    eligibility: {
      operation_match: {
        allowed_payment_instrument_ids: ["instrument.jp.seven-card-plus"],
        allowed_funding_source_ids: ["funding.jp.seven-card-plus"],
        allowed_destination_asset_ids: ["asset.jp.nanaco"],
      },
      user_conditions: [
        {
          fact_key: "nanaco_credit_charge_preregistered",
          operator: "eq",
          value: true,
          unknown_policy: "suppress_rule",
        },
      ],
      transaction_conditions: {
        minimum_amount_jpy: 5000,
        maximum_amount_jpy: 30000,
        eligible_amount_basis: "operation_amount",
        requires_single_operation: true,
      },
      campaign_conditions: {},
    },
    calculation: {
      model: "points_per_unit",
      reward_units: "1",
      spend_jpy: 200,
      rounding: {
        aggregation_scope: "per_operation",
        eligible_spend_quantum_jpy: 200,
        reward_rounding_mode: "floor",
      },
    },
    output: {
      asset: {
        asset_id: "asset.jp.nanaco-point",
        asset_kind: "reward_point",
        program_id: "program.jp.nanaco",
        reward_class: "normal",
        scale: 0,
      },
      sign: "credit",
      certainty: {
        type: "guaranteed",
        probability: null,
        probability_source: null,
      },
      settlement: {
        status: "pending",
        expected_posting_from: null,
        expected_posting_to: null,
        posted_at: null,
      },
      expiry: {
        policy: "unknown",
        expires_at: null,
        duration_days: null,
        timezone: "Asia/Tokyo",
      },
      restrictions: {
        transferable: null,
        redeemable_for_cash: null,
        usable_for_payment: null,
        investable: null,
        permitted_destination_ids: ["asset.jp.nanaco"],
        notes:
          "nanaco points are recorded separately from nanaco principal and are not a second top-up principal balance.",
      },
      clawback: {
        on_refund: "unknown",
        posting_delay_days: null,
        notes:
          "No refund operation is included in this narrow experimental route.",
      },
    },
    caps: [],
    stacking: {
      stack_group: "rr_jp_cvs_006_sevencard_credit_topup_reward",
      mode: "additive",
      precedence: 0,
      conflicts_with_rule_ids: [],
      requires_rule_ids: [],
    },
    validity: {
      valid_from: "2026-08-20T05:39:00+09:00",
      valid_to: null,
      timezone: "Asia/Tokyo",
      recorded_at: "2026-08-20T05:50:00+09:00",
      superseded_at: null,
    },
    provenance: {
      evidence_ids: [
        "ev_m3_sevencard_nanaco_charge_20260820",
        "ev_m3_nanaco_sevencard_earning_20260820",
      ],
      minimum_source_tier: "T1_CANONICAL",
      confidence: 0.95,
      human_verified: false,
      review_notes:
        "Bound to the two reviewed M3 evidence records and the exact credit-charge and eligible-card claims; no canonical publication or JPY valuation is asserted.",
    },
    audit: {
      created_at: "2026-08-22T00:05:00Z",
      created_by: "p0-nanaco-credit-charge-extractor",
      review_events: [],
      required_review_modes: ["solo_dual_pass", "agent_challenged"],
      review_mode: null,
      reviewed_at: null,
      reviewed_by: null,
      change_reason:
        "Deterministic under-review candidate copied from checked-in M3 credit-charge evidence; not a publication decision.",
    },
  },
  extractor: { name: "p0-nanaco-credit-charge-extractor", version: "0.1" },
  machine_check: {
    checker: "p0-nanaco-credit-charge-semantic-check",
    checker_version: "0.1",
    checked_at: "2026-08-22T00:06:00Z",
    checks: {
      representation_safe: true,
      rule_structure: true,
      rule_semantics: true,
      observation_binding: true,
      p0_coverage: true,
    },
  },
} as unknown as ProvisionalRuleCandidate;

export const NANACO_CREDIT_CHARGE_RULE_ID =
  "rr_jp_cvs_006_sevencard_credit_topup_reward" as const;
export const NANACO_CREDIT_CHARGE_FAMILY_ID = "point.nanaco" as const;
export const NANACO_CREDIT_CHARGE_SOURCE_ROLE_ID = "earn_rules" as const;
export const NANACO_CREDIT_CHARGE_SOURCE_IDS = Object.freeze([
  "jp.nanaco.sevencard-earning",
  "jp.sevencard.nanaco-charge",
] as const);
export const NANACO_CREDIT_CHARGE_CLAIM_IDS = Object.freeze([
  "claim.point.nanaco.earn.credit-charge.003",
  "claim.emoney.nanaco.eligible.001",
] as const);
export const NANACO_CREDIT_CHARGE_EVIDENCE_IDS = Object.freeze([
  "ev_m3_sevencard_nanaco_charge_20260820",
  "ev_m3_nanaco_sevencard_earning_20260820",
] as const);
export const NANACO_CREDIT_CHARGE_CANDIDATE = deepFreeze(candidate);
export const NANACO_CREDIT_CHARGE_DEFINITION_HASH = hashDefinition(
  NANACO_CREDIT_CHARGE_CANDIDATE.rule,
);
export const NANACO_CREDIT_CHARGE_CANDIDATE_ARTIFACT_HASH = hashCandidate(
  NANACO_CREDIT_CHARGE_CANDIDATE,
  NANACO_CREDIT_CHARGE_DEFINITION_HASH,
);
