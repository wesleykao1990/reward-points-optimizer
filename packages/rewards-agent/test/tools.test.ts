import { RewardCapabilities } from "@jro/reward-capabilities";
import { describe, expect, it } from "vitest";
import { createRewardsAgent, createRewardsAgentTools } from "../src/index.js";

describe("Rewards Agent tools", () => {
  it("exposes bounded domain capabilities instead of engine or SQL primitives", () => {
    const capabilities = new RewardCapabilities({
      calculator: {
        async comparePurchaseRoutes() {
          throw new Error("not used");
        },
      },
    });
    const tools = createRewardsAgentTools(capabilities);

    expect(tools.map((item) => item.name)).toEqual([
      "get_rewards_passport_summary",
      "get_expiring_rewards",
      "get_current_purchase_context",
      "compare_purchase_routes",
      "set_session_purchase_preferences",
      "explain_purchase_route",
    ]);
    expect(tools.map((item) => item.name)).not.toContain("run_sql");
    expect(tools.map((item) => item.name)).not.toContain("execute_rule");
    expect(createRewardsAgent(capabilities).tools).toHaveLength(6);
  });
});
