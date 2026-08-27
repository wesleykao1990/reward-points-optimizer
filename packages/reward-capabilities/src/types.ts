export const REWARD_CAPABILITIES_VERSION = "reward-capabilities.v1" as const;

export type RewardClass =
  | "cash_equivalent"
  | "airline_miles"
  | "hotel_points"
  | "merchant_points";

export interface RewardBalance {
  readonly program_id: string;
  readonly label: string;
  readonly available: number;
  readonly limited: number;
  readonly unit: "points" | "miles" | "jpy";
  readonly pending: number;
  readonly last_synced_at: string | null;
  readonly source: "demo_fixture" | "user_input" | "provider_observation";
}

export interface RewardExpiryLot {
  readonly lot_id: string;
  readonly program_id: string;
  readonly amount: number;
  readonly expires_at: string;
  readonly source: "demo_fixture" | "user_input" | "provider_observation";
}

export interface RewardsPassportSummary {
  readonly version: typeof REWARD_CAPABILITIES_VERSION;
  readonly mode: "demo_fixture" | "authenticated";
  readonly balances: readonly RewardBalance[];
  readonly expiry_lots: readonly RewardExpiryLot[];
  readonly owned_family_ids: readonly string[];
}

export interface PurchaseContext {
  readonly merchant_id: string;
  readonly branch_id: string;
  readonly amount_jpy: number;
  readonly tax_exclusive_amount_jpy: number;
  readonly nanaco_balance_jpy: number;
  readonly nanaco_credit_charge_balance_jpy: number;
  readonly charge_amount_jpy: number;
  readonly seven_card_plus_owned: boolean;
  readonly nanaco_credit_charge_preregistered: boolean;
  readonly effective_at: string;
  readonly owned_instruments: readonly string[];
  readonly selected_p0_products: readonly string[];
  readonly stored_value_use: "yes" | "no" | "unknown";
  readonly stored_value_usage?: string;
  readonly stored_value_value_jpy_per_unit?: string;
  readonly facts: readonly Readonly<Record<string, unknown>>[];
  readonly caps: readonly Readonly<Record<string, unknown>>[];
}

export interface SessionPurchasePreferences {
  readonly preferred_reward_class: RewardClass | null;
  readonly preferred_assets: readonly string[];
  readonly excluded_family_ids: readonly string[];
  readonly max_extra_steps: number | null;
  readonly minimum_incremental_value_jpy: number | null;
}

export interface SessionPurchasePreferenceUpdate {
  readonly preferred_reward_class?: RewardClass | null;
  readonly preferred_assets?: readonly string[];
  readonly excluded_family_ids?: readonly string[];
  readonly max_extra_steps?: number | null;
  readonly minimum_incremental_value_jpy?: number | null;
}

export interface RouteComparison {
  readonly routes: readonly Readonly<Record<string, unknown>>[];
  readonly supplemental_routes: readonly Readonly<Record<string, unknown>>[];
  readonly comparison: Readonly<Record<string, unknown>>;
  readonly fact_influence_shared: Readonly<Record<string, unknown>> | null;
  readonly questions: readonly string[];
}

export interface RewardCalculationPort {
  comparePurchaseRoutes(
    context: PurchaseContext,
    preferences: SessionPurchasePreferences,
  ): Promise<RouteComparison>;
}

export type CapabilityName =
  | "get_rewards_passport_summary"
  | "get_expiring_rewards"
  | "get_current_purchase_context"
  | "compare_purchase_routes"
  | "set_session_purchase_preferences"
  | "explain_purchase_route";

export interface CapabilityActivity {
  readonly activity_id: string;
  readonly timestamp: string;
  readonly tool: CapabilityName;
  readonly outcome: "success" | "rejected" | "unavailable";
  readonly visible_ui_effect:
    | "none"
    | "purchase_preferences_updated"
    | "purchase_routes_reranked"
    | "route_explanation_selected";
}

export interface RewardCapabilitySnapshot {
  readonly version: typeof REWARD_CAPABILITIES_VERSION;
  readonly purchase_context: PurchaseContext | null;
  readonly preferences: SessionPurchasePreferences;
  readonly comparison: RouteComparison | null;
  readonly selected_route_id: string | null;
  readonly activity: readonly CapabilityActivity[];
}

export interface RouteExplanation {
  readonly route_id: string;
  readonly route: Readonly<Record<string, unknown>>;
  readonly deterministic_summary: {
    readonly label: string;
    readonly objective_score_jpy: string | null;
    readonly reward_asset_id: string | null;
    readonly conditions: readonly unknown[];
  };
}
