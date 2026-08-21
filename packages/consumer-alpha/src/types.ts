/**
 * Contracts for the narrow, local consumer alpha.
 *
 * These types deliberately describe a small closed world.  The alpha accepts
 * canonical identifiers from an immutable host-supplied catalogue and a few
 * manual scalar facts.  It does not accept arbitrary metadata, evidence,
 * credentials, receipts, barcodes, or evaluator input from the browser.
 */

export const CONSUMER_ALPHA_VERSION = "1" as const;
export const CONSUMER_ALPHA_TIMEZONE = "Asia/Tokyo" as const;
export const CONSUMER_ALPHA_REGION = "Tokyo" as const;
export const MIN_PURCHASE_JPY = 1;
export const MAX_PURCHASE_JPY = 1_000_000;
export const MAX_CAP_JPY = 1_000_000;
export const MAX_CUSTOM_VALUE = 1;

export type ConsumerAlphaVersion = typeof CONSUMER_ALPHA_VERSION;
export type ConsumerAlphaTimezone = typeof CONSUMER_ALPHA_TIMEZONE;
export type ConsumerAlphaRegion = typeof CONSUMER_ALPHA_REGION;

export type ConsumerPhase =
  | "intro"
  | "merchant_selected"
  | "purchase_defined"
  | "wallets_defined"
  | "facts_defined"
  | "stored_value_question"
  | "caps_defined"
  | "ready"
  | "evaluating"
  | "result"
  | "no_valid_plan"
  | "blocked"
  | "correction";

export type AlphaWalletKind = "card" | "qr_wallet" | "stored_value" | "points";

export type AlphaProductKind = "stored_value" | "points";

/** A canonical Tokyo branch. Aliases are intentionally not part of alpha input. */
export interface AlphaBranch {
  readonly branch_id: string;
  readonly name: string;
  readonly city: ConsumerAlphaRegion;
}

export interface AlphaMerchant {
  readonly merchant_id: string;
  readonly name: string;
  readonly branches: readonly AlphaBranch[];
}

export interface AlphaWallet {
  readonly wallet_id: string;
  readonly name: string;
  readonly kind: AlphaWalletKind;
  /** Product IDs that this wallet can hold or expose. */
  readonly product_ids?: readonly string[];
}

export interface AlphaProduct {
  readonly product_id: string;
  readonly name: string;
  readonly kind: AlphaProductKind;
}

/**
 * Host-owned immutable allowlist.  A catalogue passed to
 * `createInitialConsumerState` is copied and frozen before it enters state.
 * The catalogue is Tokyo-scoped; a supplied `region` must therefore be Tokyo.
 */
export interface AlphaCatalog {
  readonly version: string;
  readonly merchants: readonly AlphaMerchant[];
  readonly wallets: readonly AlphaWallet[];
  readonly products: readonly AlphaProduct[];
  readonly region: ConsumerAlphaRegion;
}

export interface AlphaMerchantSelection {
  readonly merchant_id: string;
  readonly branch_id: string;
}

export type AlphaPurchaseChannel = "in_store";

export interface AlphaPurchaseInput {
  readonly amount_jpy: number;
  readonly channel: AlphaPurchaseChannel;
  /** Optional echo fields are checked against the canonical selection. */
  readonly merchant_id?: string;
  readonly branch_id?: string;
  readonly currency?: "JPY";
}

export interface AlphaPurchase {
  readonly amount_jpy: number;
  readonly channel: AlphaPurchaseChannel;
  readonly currency: "JPY";
}

export interface AlphaWalletSelectionInput {
  readonly wallet_ids: readonly string[];
  readonly product_ids: readonly string[];
}

export interface AlphaWalletSelection {
  readonly wallet_ids: readonly string[];
  readonly product_ids: readonly string[];
}

export type AlphaFactStatus =
  | "known"
  | "estimated"
  | "unknown"
  | "not_applicable";

export type AlphaFactValue = string | number | boolean;

export interface AlphaManualFactInput {
  readonly fact_id: string;
  readonly status: AlphaFactStatus;
  readonly value?: AlphaFactValue;
}

export interface AlphaManualFact {
  readonly fact_id: string;
  readonly status: AlphaFactStatus;
  /** Absent for unknown and not_applicable. Never synthesized as false. */
  readonly value?: AlphaFactValue;
}

export type AlphaStoredValueUsage =
  | "within_30_days"
  | "within_90_days"
  | "eventually"
  | "rarely"
  | "custom";

export interface AlphaStoredValueAnswerInput {
  readonly asset_id: string;
  readonly usage: AlphaStoredValueUsage;
  /** Required only for `custom`; normalized to a canonical decimal string. */
  readonly custom_value?: string | number;
}

export interface AlphaStoredValueAnswer {
  readonly asset_id: string;
  readonly usage: AlphaStoredValueUsage;
  readonly custom_value?: string;
}

export interface AlphaCapRangeInput {
  readonly asset_id: string;
  readonly min_jpy: number;
  readonly max_jpy: number;
}

export interface AlphaCapRange {
  readonly asset_id: string;
  readonly min_jpy: number;
  readonly max_jpy: number;
}

export interface AlphaSensitivity {
  readonly label: string;
  readonly base_jpy: number;
  readonly low_jpy: number;
  readonly high_jpy: number;
}

export type AlphaRecommendationOutcome = "definite" | "conditional";
export type AlphaRecommendationHash = `sha256:${string}`;

export interface AlphaEvaluationResultInput {
  readonly outcome: AlphaRecommendationOutcome;
  readonly recommendation_hash: AlphaRecommendationHash;
  readonly winner_plan_id: string;
  readonly fallback_plan_id: string | null;
  readonly explanation: string;
  readonly sensitivities: readonly AlphaSensitivity[];
}

export interface AlphaEvaluationResult {
  readonly outcome: AlphaRecommendationOutcome;
  readonly recommendation_hash: AlphaRecommendationHash;
  readonly winner_plan_id: string;
  readonly fallback_plan_id: string | null;
  readonly explanation: string;
  readonly sensitivities: readonly AlphaSensitivity[];
}

export interface AlphaEvaluationNoValidPlanInput {
  readonly reasons: readonly string[];
}

export interface AlphaEvaluationBlockedInput {
  readonly reason: string;
}

/** Mirrors the bounded correction categories; no user narrative crosses state. */
export type AlphaCorrectionCategory =
  | "wrong_merchant"
  | "wrong_branch"
  | "wrong_plan"
  | "missing_reward"
  | "unexpected_reward"
  | "wrong_reward_amount";

export interface AlphaCorrectionInput {
  readonly category: AlphaCorrectionCategory;
  readonly recommendation_hash: `sha256:${string}`;
}

export interface AlphaCorrection {
  readonly category: AlphaCorrectionCategory;
  readonly recommendation_hash: `sha256:${string}`;
}

export interface ConsumerState {
  readonly version: ConsumerAlphaVersion;
  readonly region: ConsumerAlphaRegion;
  readonly timezone: ConsumerAlphaTimezone;
  readonly phase: ConsumerPhase;
  readonly revision: number;
  /** Bound to the displayed host recommendation for correction reporting. */
  readonly recommendation_hash: AlphaRecommendationHash | null;
  readonly catalog: AlphaCatalog;
  readonly merchant: AlphaMerchantSelection | null;
  readonly purchase: AlphaPurchase | null;
  readonly wallets: AlphaWalletSelection | null;
  readonly facts: readonly AlphaManualFact[];
  readonly stored_value_answers: readonly AlphaStoredValueAnswer[];
  readonly caps: readonly AlphaCapRange[];
  readonly result: AlphaEvaluationResult | null;
  readonly no_valid_plan_reasons: readonly string[];
  readonly blockers: readonly string[];
  readonly correction: AlphaCorrection | null;
}

export type ConsumerInputEvent =
  | {
      readonly type: "select_merchant";
      readonly merchant_id: string;
      readonly branch_id: string;
    }
  | { readonly type: "define_purchase"; readonly purchase: AlphaPurchaseInput }
  | {
      readonly type: "define_wallets";
      readonly selection: AlphaWalletSelectionInput;
    }
  | {
      readonly type: "define_facts";
      readonly facts: readonly AlphaManualFactInput[];
    }
  | { readonly type: "ask_stored_value_question" }
  | {
      readonly type: "answer_stored_value_question";
      readonly answers: readonly AlphaStoredValueAnswerInput[];
    }
  | {
      readonly type: "define_caps";
      readonly caps: readonly AlphaCapRangeInput[];
    }
  | { readonly type: "start_evaluation" }
  | { readonly type: "open_correction" }
  | {
      readonly type: "record_correction";
      readonly correction: AlphaCorrectionInput;
    }
  | { readonly type: "reset" };

/** Events that may only be produced by the trusted host/evaluator boundary. */
export type HostEvaluationEvent =
  | {
      readonly type: "evaluation_result";
      readonly result: AlphaEvaluationResultInput;
    }
  | {
      readonly type: "evaluation_no_valid_plan";
      readonly result: AlphaEvaluationNoValidPlanInput;
    }
  | {
      readonly type: "evaluation_blocked";
      readonly result: AlphaEvaluationBlockedInput;
    };

/** Full trusted-host orchestration event union. */
export type ConsumerEvent = ConsumerInputEvent | HostEvaluationEvent;

export type ConsumerEventType = ConsumerEvent["type"];

export type ConsumerStateErrorCode =
  | "invalid_state"
  | "invalid_event"
  | "unknown_field"
  | "dangerous_field"
  | "phase_event_not_allowed"
  | "catalog_invalid"
  | "catalog_region_unsupported"
  | "duplicate_id"
  | "merchant_not_found"
  | "branch_not_found"
  | "branch_not_tokyo"
  | "merchant_branch_mismatch"
  | "purchase_invalid"
  | "purchase_channel_unsupported"
  | "purchase_location_mismatch"
  | "wallet_not_allowlisted"
  | "product_not_allowlisted"
  | "wallet_selection_required"
  | "wallet_product_mismatch"
  | "fact_invalid"
  | "fact_duplicate"
  | "stored_value_answer_invalid"
  | "stored_value_answer_missing"
  | "cap_invalid"
  | "cap_duplicate"
  | "cap_asset_not_selected"
  | "cap_asset_missing"
  | "missing_valuation"
  | "evaluation_result_invalid"
  | "correction_invalid";

export class ConsumerStateError extends Error {
  readonly code: ConsumerStateErrorCode;
  readonly phase: ConsumerPhase | null;

  constructor(
    code: ConsumerStateErrorCode,
    message: string,
    phase: ConsumerPhase | null = null,
  ) {
    super(`${code}:${message}`);
    this.name = "ConsumerStateError";
    this.code = code;
    this.phase = phase;
  }
}
