import {
  type CampaignRouteBrowserInput,
  type CampaignRoutePlan,
  type CampaignRouteRecommendationResult,
  type CampaignRouteRewardCard,
  campaignRoutePrerequisites,
  recommendCampaignRoute,
} from "./campaign-route-recommendation.js";
import {
  type PointSpendBrowserCampaignPrerequisite,
  type PointSpendBrowserCampaignReward,
  type PointSpendBrowserInput,
  type PointSpendBrowserResult,
  type PointSpendBrowserRoute,
  parsePointSpendBrowserInput,
  type RouteGraphSourcePort,
  recommendParsedPointSpend,
} from "./point-spend-recommendation.js";

const MOPPY_SOURCE_ASSET_ID = "asset.point.moppy" as const;
const MOPPY_TARGET_ASSET_ID = "asset.mile.jal" as const;
const JPY_SPEND_SOURCE_ASSET_ID = "asset.value.jpy-spend" as const;
const JAL_TARGET_ASSET_ID = "asset.mile.jal" as const;

/** The only source/target pairs admitted to the unified campaign lane. */
const CAMPAIGN_PAIR_BY_ASSET = Object.freeze({
  [`${MOPPY_SOURCE_ASSET_ID}->${MOPPY_TARGET_ASSET_ID}`]: "moppy_aug_2026",
  [`${JPY_SPEND_SOURCE_ASSET_ID}->${JAL_TARGET_ASSET_ID}`]:
    "jal_mileage_park_rakuten",
} as const);

type UnifiedCampaignScenario =
  (typeof CAMPAIGN_PAIR_BY_ASSET)[keyof typeof CAMPAIGN_PAIR_BY_ASSET];

type CampaignModifierReward = Omit<CampaignRouteRewardCard, "kind"> & {
  readonly kind: Extract<CampaignRouteRewardCard["kind"], "bonus" | "rebate">;
};

function campaignScenarioFor(
  input: PointSpendBrowserInput,
): UnifiedCampaignScenario | null {
  if (!input.campaign_application || input.target_asset_id === null)
    return null;
  return (
    CAMPAIGN_PAIR_BY_ASSET[
      `${input.source_asset_id}->${input.target_asset_id}` as keyof typeof CAMPAIGN_PAIR_BY_ASSET
    ] ?? null
  );
}

function campaignInput(
  input: PointSpendBrowserInput,
  scenario: UnifiedCampaignScenario,
): CampaignRouteBrowserInput {
  return Object.freeze({
    scenario,
    effective_at: input.effective_at,
    moppy_balance_points: scenario === "moppy_aug_2026" ? input.balance : null,
    ad_earned_points:
      scenario === "moppy_aug_2026" ? input.campaign_ad_earned_points : null,
    monthly_exchange_count:
      scenario === "moppy_aug_2026"
        ? input.campaign_monthly_exchange_count
        : null,
    purchase_amount_jpy:
      scenario === "jal_mileage_park_rakuten" ? input.balance : null,
    portal_traversal_confirmed:
      scenario === "jal_mileage_park_rakuten"
        ? input.portal_traversal_confirmed
        : null,
  });
}

function processingDays(reward: CampaignRouteRewardCard | undefined): string {
  if (
    !reward ||
    reward.processing_days_min === null ||
    reward.processing_days_max === null
  )
    return "即時見込み";
  if (reward.processing_days_min === reward.processing_days_max)
    return `約${reward.processing_days_min}日`;
  return `約${reward.processing_days_min}〜${reward.processing_days_max}日`;
}

function numericRatePercent(
  sourceAmount: string,
  targetAmount: string,
): string | null {
  const source = Number(sourceAmount);
  const target = Number(targetAmount);
  if (!Number.isFinite(source) || source <= 0 || !Number.isFinite(target))
    return null;
  return String(Math.round((target / source) * 100 * 1_000_000) / 1_000_000);
}

function campaignRoute(
  plan: CampaignRoutePlan,
  input: PointSpendBrowserInput,
  scenario: UnifiedCampaignScenario,
): PointSpendBrowserRoute {
  const principal = plan.rewards.find((reward) => reward.kind === "principal");
  const portal = plan.rewards.find((reward) => reward.kind === "portal_reward");
  const targetReward = principal ?? portal;
  const sourceAmount = plan.source_amount;
  const processingReward = portal ?? principal;
  const source = Number(input.balance);
  const used = Number(sourceAmount);
  const residual =
    Number.isFinite(source) && Number.isFinite(used)
      ? String(Math.max(0, source - used))
      : "0";
  const steps = Object.freeze(
    plan.steps.map((step) => ({
      label: step.label,
      source_node_id: step.source_node_id,
      destination_node_id: step.destination_node_id,
      source_label: step.source_label,
      destination_label: step.destination_label,
      source_amount: step.source_amount,
      destination_amount: step.destination_amount,
      processing_days: processingDays(processingReward),
      stranded_amount: "0",
      limit_note: null,
      start_date: null,
    })),
  );
  const targetAmount = targetReward?.amount ?? "0";
  const targetLabel = targetReward?.asset_label ?? "交換先";
  const leg = Object.freeze({
    source_amount: sourceAmount,
    target_amount: targetAmount,
    processing_days: processingDays(processingReward),
    steps,
  });
  return Object.freeze({
    recommendation_id: `campaign.${scenario}`,
    target_amount: targetAmount,
    target_label: targetLabel,
    residual_source_amount: residual,
    processing_days: processingDays(processingReward),
    steps,
    source_amount_used: sourceAmount,
    value_jpy: null,
    value_note:
      "キャンペーンの本体出力を表示しています。別付与は合算していません。",
    effective_rate_percent: numericRatePercent(sourceAmount, targetAmount),
    legs: [leg],
    split_note: null,
    stranded_note: null,
  });
}

function campaignRewards(
  plan: CampaignRoutePlan,
): readonly PointSpendBrowserCampaignReward[] {
  return Object.freeze(
    plan.rewards
      .filter(
        (reward): reward is CampaignModifierReward =>
          reward.kind === "bonus" || reward.kind === "rebate",
      )
      .map((reward) => ({
        kind: reward.kind,
        label: reward.label,
        asset_id: reward.asset_id,
        asset_label: reward.asset_label,
        amount: reward.amount,
        settlement: reward.settlement,
        posting: reward.posting,
        processing_days_min: reward.processing_days_min,
        processing_days_max: reward.processing_days_max,
      })),
  );
}

function campaignPrerequisites(
  input: CampaignRouteBrowserInput,
  winner: CampaignRoutePlan | null,
): readonly PointSpendBrowserCampaignPrerequisite[] {
  const source = winner?.prerequisites ?? campaignRoutePrerequisites(input);
  return Object.freeze(
    source.map((item) => ({ label: item.label, status: item.status })),
  );
}

function pointReason(
  result: CampaignRouteRecommendationResult,
): PointSpendBrowserResult["no_route_reason"] {
  if (result.reason === "outside_validity_window")
    return "outside_validity_window";
  if (result.reason === "balance_below_required")
    return "balance_below_minimum";
  if (result.reason === "monthly_limit_reached")
    return "period_usage_required_or_exceeded";
  if (
    result.reason === "missing_prerequisite" ||
    result.reason === "portal_traversal_required"
  )
    return "condition_confirmation_required";
  if (result.reason === "amount_must_match_benchmark")
    return "balance_below_minimum";
  return "route_unavailable";
}

function campaignNoRouteDetails(
  input: PointSpendBrowserInput,
  result: CampaignRouteRecommendationResult,
): PointSpendBrowserResult["no_route_details"] {
  const prerequisites = campaignPrerequisites(
    campaignInput(input, result.scenario),
    result.winner,
  );
  const reason = pointReason(result);
  return Object.freeze({
    minimum_source_amount:
      reason === "balance_below_minimum" && result.scenario === "moppy_aug_2026"
        ? "12000"
        : null,
    conditions:
      reason === "condition_confirmation_required"
        ? Object.freeze(
            prerequisites
              .filter((item) => item.status !== "satisfied")
              .map((item) => item.label),
          )
        : Object.freeze([]),
  });
}

function campaignResult(
  input: PointSpendBrowserInput,
  result: CampaignRouteRecommendationResult,
): Promise<PointSpendBrowserResult> {
  const prerequisites = campaignPrerequisites(
    campaignInput(input, result.scenario),
    result.winner,
  );
  const ready = result.status === "eligible" && result.winner !== null;
  const winner = ready
    ? campaignRoute(result.winner, input, result.scenario)
    : null;
  const reason = ready ? null : pointReason(result);
  return Promise.resolve(
    Object.freeze({
      version: "p0-point-spend-browser.v2" as const,
      status: ready ? ("ready" as const) : ("no_route" as const),
      experimental: true as const,
      current_advice: false as const,
      objective: input.objective,
      winner,
      alternatives: Object.freeze([]),
      message: result.message,
      // The native campaign evaluator intentionally does not expose generic
      // graph rules; campaign lanes remain source-bound and self-contained.
      rule_count: ready ? (result.winner?.rewards.length ?? 0) : 0,
      no_route_reason: reason,
      no_route_details: ready ? null : campaignNoRouteDetails(input, result),
      unvalued_asset_labels: Object.freeze([]),
      data_origin: "database" as const,
      data_as_of: result.data_as_of,
      data_fallback_reason: null,
      campaign_applied: ready,
      campaign_rewards: ready
        ? campaignRewards(result.winner)
        : Object.freeze([]),
      campaign_prerequisites: prerequisites,
    }),
  );
}

/**
 * Unified point-spend endpoint contract.  Generic routes retain their native
 * optimizer; only the two exact campaign source/target pairs enter the
 * source-bound native campaign evaluator.
 */
export async function recommendUnifiedPointSpend(
  raw: unknown,
  source: RouteGraphSourcePort,
): Promise<PointSpendBrowserResult> {
  const input = parsePointSpendBrowserInput(raw);
  return recommendUnifiedParsedPointSpend(input, source);
}

/** Run the unified adapter after the HTTP layer has already parsed input. */
export async function recommendUnifiedParsedPointSpend(
  input: PointSpendBrowserInput,
  source: RouteGraphSourcePort,
): Promise<PointSpendBrowserResult> {
  const scenario = campaignScenarioFor(input);
  if (scenario === null) return recommendParsedPointSpend(input, source);
  const nativeResult = await recommendCampaignRoute(
    campaignInput(input, scenario),
    source,
  );
  return campaignResult(input, nativeResult);
}

export const UNIFIED_CAMPAIGN_SOURCE_TARGETS = Object.freeze(
  Object.keys(CAMPAIGN_PAIR_BY_ASSET),
);
