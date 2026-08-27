import type {
  RewardCapabilities,
  SessionPurchasePreferenceUpdate,
} from "@jro/reward-capabilities";
import { tool } from "@openai/agents";
import { z } from "zod";

const rewardClass = z.enum([
  "cash_equivalent",
  "airline_miles",
  "hotel_points",
  "merchant_points",
]);

const canonicalId = z
  .string()
  .min(2)
  .max(128)
  .regex(/^[a-z][a-z0-9._-]+$/u);

export function createRewardsAgentTools(capabilities: RewardCapabilities) {
  return [
    tool({
      name: "get_rewards_passport_summary",
      description:
        "Read the minimum Rewards Passport summary needed for planning. Demo mode returns clearly labeled synthetic fixture data.",
      parameters: z.object({}),
      async execute() {
        return capabilities.getRewardsPassportSummary();
      },
    }),
    tool({
      name: "get_expiring_rewards",
      description:
        "List reward lots expiring inside a bounded number of days without exposing a full account ledger.",
      parameters: z.object({ within_days: z.number().int().min(1).max(365) }),
      async execute({ within_days }) {
        return capabilities.getExpiringRewards(within_days);
      },
    }),
    tool({
      name: "get_current_purchase_context",
      description:
        "Read the normalized current merchant, amount, owned instruments, and checkout context.",
      parameters: z.object({}),
      async execute() {
        return capabilities.getCurrentPurchaseContext();
      },
    }),
    tool({
      name: "compare_purchase_routes",
      description:
        "Run the trusted deterministic reward engine for the current purchase context and typed preferences. Never perform reward arithmetic yourself.",
      parameters: z.object({}),
      async execute() {
        return capabilities.comparePurchaseRoutes();
      },
    }),
    tool({
      name: "set_session_purchase_preferences",
      description:
        "Translate a user's natural-language goal into bounded session-only preference fields before recomputing routes.",
      parameters: z.object({
        preferred_reward_class: rewardClass.nullable().optional(),
        preferred_assets: z.array(canonicalId).max(64).optional(),
        excluded_family_ids: z.array(canonicalId).max(64).optional(),
        max_extra_steps: z.number().int().min(0).max(8).nullable().optional(),
        minimum_incremental_value_jpy: z
          .number()
          .int()
          .min(0)
          .max(1_000_000)
          .nullable()
          .optional(),
      }),
      async execute(update) {
        return capabilities.setSessionPurchasePreferences(
          update as SessionPurchasePreferenceUpdate,
        );
      },
    }),
    tool({
      name: "explain_purchase_route",
      description:
        "Read the deterministic components and conditions of a previously compared route. This tool explains facts; it does not recalculate them.",
      parameters: z.object({ route_id: canonicalId.optional() }),
      async execute({ route_id }) {
        return capabilities.explainPurchaseRoute(route_id);
      },
    }),
  ] as const;
}
