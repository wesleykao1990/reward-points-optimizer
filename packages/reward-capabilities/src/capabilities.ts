import { DEMO_REWARDS_PASSPORT } from "./demo-passport.js";
import {
  REWARD_CAPABILITIES_VERSION,
  type CapabilityActivity,
  type CapabilityName,
  type PurchaseContext,
  type RewardCalculationPort,
  type RewardCapabilitySnapshot,
  type RewardExpiryLot,
  type RewardsPassportSummary,
  type RouteComparison,
  type RouteExplanation,
  type SessionPurchasePreferences,
  type SessionPurchasePreferenceUpdate,
} from "./types.js";

export const DEFAULT_SESSION_PURCHASE_PREFERENCES: SessionPurchasePreferences =
  Object.freeze({
  preferred_reward_class: null,
  preferred_assets: Object.freeze([]),
  excluded_family_ids: Object.freeze([]),
  max_extra_steps: null,
  minimum_incremental_value_jpy: null,
  });

export interface RewardCapabilitiesOptions {
  readonly calculator: RewardCalculationPort;
  readonly passport?: RewardsPassportSummary;
  readonly purchaseContext?: PurchaseContext | null;
  readonly preferences?: SessionPurchasePreferences;
  readonly now?: () => Date;
}

function boundedIds(values: readonly string[]): readonly string[] {
  if (values.length > 64) throw new TypeError("preference_ids_too_many");
  const output = [...new Set(values)];
  if (
    output.length !== values.length ||
    !output.every(
      (value) =>
        typeof value === "string" &&
        /^[a-z][a-z0-9._-]{1,127}$/u.test(value),
    )
  )
    throw new TypeError("preference_id_invalid");
  return Object.freeze(output.sort());
}

function preferenceNumber(
  value: number | null | undefined,
  maximum: number,
  code: string,
): number | null | undefined {
  if (value === undefined || value === null) return value;
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum)
    throw new TypeError(code);
  return value;
}

export function normalizeSessionPurchasePreferences(
  update: SessionPurchasePreferenceUpdate,
  current: SessionPurchasePreferences = DEFAULT_SESSION_PURCHASE_PREFERENCES,
): SessionPurchasePreferences {
  const preferredAssets =
    update.preferred_assets === undefined
      ? current.preferred_assets
      : boundedIds(update.preferred_assets);
  const excludedFamilyIds =
    update.excluded_family_ids === undefined
      ? current.excluded_family_ids
      : boundedIds(update.excluded_family_ids);
  const maxExtraSteps = preferenceNumber(
    update.max_extra_steps,
    8,
    "max_extra_steps_invalid",
  );
  const minimumIncrementalValue = preferenceNumber(
    update.minimum_incremental_value_jpy,
    1_000_000,
    "minimum_incremental_value_invalid",
  );
  return Object.freeze({
    preferred_reward_class:
      update.preferred_reward_class === undefined
        ? current.preferred_reward_class
        : update.preferred_reward_class,
    preferred_assets: preferredAssets,
    excluded_family_ids: excludedFamilyIds,
    max_extra_steps:
      maxExtraSteps === undefined ? current.max_extra_steps : maxExtraSteps,
    minimum_incremental_value_jpy:
      minimumIncrementalValue === undefined
        ? current.minimum_incremental_value_jpy
        : minimumIncrementalValue,
  });
}

function readRecord(
  value: Readonly<Record<string, unknown>>,
  key: string,
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

export class RewardCapabilities {
  readonly #calculator: RewardCalculationPort;
  readonly #passport: RewardsPassportSummary;
  readonly #now: () => Date;
  #purchaseContext: PurchaseContext | null;
  #preferences: SessionPurchasePreferences;
  #comparison: RouteComparison | null = null;
  #selectedRouteId: string | null = null;
  #activity: CapabilityActivity[] = [];
  #activitySequence = 0;

  constructor(options: RewardCapabilitiesOptions) {
    this.#calculator = options.calculator;
    this.#passport = options.passport ?? DEMO_REWARDS_PASSPORT;
    this.#purchaseContext = options.purchaseContext ?? null;
    this.#preferences =
      options.preferences ?? DEFAULT_SESSION_PURCHASE_PREFERENCES;
    this.#now = options.now ?? (() => new Date());
  }

  #record(
    tool: CapabilityName,
    visibleUiEffect: CapabilityActivity["visible_ui_effect"],
    outcome: CapabilityActivity["outcome"] = "success",
  ): void {
    this.#activitySequence += 1;
    this.#activity.push(
      Object.freeze({
        activity_id: `activity-${this.#activitySequence}`,
        timestamp: this.#now().toISOString(),
        tool,
        outcome,
        visible_ui_effect: visibleUiEffect,
      }),
    );
    if (this.#activity.length > 32) this.#activity = this.#activity.slice(-32);
  }

  getRewardsPassportSummary(): RewardsPassportSummary {
    this.#record("get_rewards_passport_summary", "none");
    return this.#passport;
  }

  getExpiringRewards(withinDays = 30): readonly RewardExpiryLot[] {
    if (!Number.isSafeInteger(withinDays) || withinDays < 1 || withinDays > 365)
      throw new TypeError("expiry_window_invalid");
    const now = this.#now().getTime();
    const horizon = now + withinDays * 86_400_000;
    const lots = this.#passport.expiry_lots
      .filter((lot) => {
        const expiry = Date.parse(lot.expires_at);
        return Number.isFinite(expiry) && expiry >= now && expiry <= horizon;
      })
      .sort((left, right) => left.expires_at.localeCompare(right.expires_at));
    this.#record("get_expiring_rewards", "none");
    return Object.freeze(lots);
  }

  getCurrentPurchaseContext(): PurchaseContext | null {
    this.#record("get_current_purchase_context", "none");
    return this.#purchaseContext;
  }

  setCurrentPurchaseContext(context: PurchaseContext): void {
    this.#purchaseContext = context;
    this.#comparison = null;
    this.#selectedRouteId = null;
  }

  setSessionPurchasePreferences(
    update: SessionPurchasePreferenceUpdate,
  ): SessionPurchasePreferences {
    this.#preferences = normalizeSessionPurchasePreferences(
      update,
      this.#preferences,
    );
    this.#record(
      "set_session_purchase_preferences",
      "purchase_preferences_updated",
    );
    return this.#preferences;
  }

  async comparePurchaseRoutes(): Promise<RouteComparison> {
    if (!this.#purchaseContext) {
      this.#record("compare_purchase_routes", "none", "unavailable");
      throw new TypeError("purchase_context_unavailable");
    }
    this.#comparison = await this.#calculator.comparePurchaseRoutes(
      this.#purchaseContext,
      this.#preferences,
    );
    this.#selectedRouteId =
      typeof this.#comparison.comparison.winner_route_id === "string"
        ? this.#comparison.comparison.winner_route_id
        : null;
    this.#record("compare_purchase_routes", "purchase_routes_reranked");
    return this.#comparison;
  }

  explainPurchaseRoute(routeId?: string): RouteExplanation {
    if (!this.#comparison) throw new TypeError("route_comparison_unavailable");
    const selected = routeId ?? this.#selectedRouteId;
    if (!selected) throw new TypeError("route_id_unavailable");
    const route = [...this.#comparison.routes, ...this.#comparison.supplemental_routes].find(
      (candidate) => readRecord(candidate, "route_id") === selected,
    );
    if (!route) throw new TypeError("route_not_found");
    const recommendation = readRecord(route, "recommendation");
    const winner =
      recommendation &&
      typeof recommendation === "object" &&
      !Array.isArray(recommendation)
        ? readRecord(
            recommendation as Readonly<Record<string, unknown>>,
            "winner",
          )
        : null;
    const winnerRecord =
      winner && typeof winner === "object" && !Array.isArray(winner)
        ? (winner as Readonly<Record<string, unknown>>)
        : null;
    this.#selectedRouteId = selected;
    this.#record("explain_purchase_route", "route_explanation_selected");
    return Object.freeze({
      route_id: selected,
      route,
      deterministic_summary: Object.freeze({
        label:
          typeof readRecord(route, "label") === "string"
            ? (readRecord(route, "label") as string)
            : selected,
        objective_score_jpy:
          typeof readRecord(route, "objective_score_jpy") === "string"
            ? (readRecord(route, "objective_score_jpy") as string)
            : null,
        reward_asset_id:
          typeof readRecord(route, "reward_asset_id") === "string"
            ? (readRecord(route, "reward_asset_id") as string)
            : null,
        conditions:
          winnerRecord && Array.isArray(readRecord(winnerRecord, "conditions"))
            ? (readRecord(winnerRecord, "conditions") as readonly unknown[])
            : Object.freeze([]),
      }),
    });
  }

  snapshot(): RewardCapabilitySnapshot {
    return Object.freeze({
      version: REWARD_CAPABILITIES_VERSION,
      purchase_context: this.#purchaseContext,
      preferences: this.#preferences,
      comparison: this.#comparison,
      selected_route_id: this.#selectedRouteId,
      activity: Object.freeze([...this.#activity]),
    });
  }
}
