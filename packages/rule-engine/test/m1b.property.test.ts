import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { evaluateCap } from "../src/m1b-caps.js";
import { evaluateFeasibleStates } from "../src/m1b-uncertainty.js";

describe("Milestone 1B properties", () => {
  it("never awards more than the remaining cap and is monotone in used progress", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100_000 }),
        fc.integer({ min: 0, max: 100_000 }),
        fc.integer({ min: 0, max: 100_000 }),
        (maximum, arbitraryUsed, request) => {
          const used = Math.min(arbitraryUsed, maximum);
          const cap = {
            cap_id: "cap_property",
            cap_type: "per_month" as const,
            max_reward_units: maximum.toString(),
            max_eligible_spend_jpy: null,
            shared_cap_group: null,
            progress_source: "transaction_aggregation" as const,
            reset: {
              period: "month" as const,
              timezone: "Asia/Tokyo",
              boundary: "calendar" as const,
            },
            partial_consumption: true,
            unknown_progress_policy: "return_range" as const,
          };
          const atUsed = evaluateCap(
            cap,
            {
              status: "known",
              eligible_spend_jpy_min: 0,
              eligible_spend_jpy_max: 0,
              reward_earned_units_min: used.toString(),
              reward_earned_units_max: used.toString(),
              period_start: null,
              period_end: null,
              source: "transaction_history",
            },
            { reward_units: request.toString() },
          );
          const laterUsed = Math.min(maximum, used + 1);
          const afterOneMore = evaluateCap(
            cap,
            {
              status: "known",
              eligible_spend_jpy_min: 0,
              eligible_spend_jpy_max: 0,
              reward_earned_units_min: laterUsed.toString(),
              reward_earned_units_max: laterUsed.toString(),
              period_start: null,
              period_end: null,
              source: "transaction_history",
            },
            { reward_units: request.toString() },
          );
          const allowed = BigInt(atUsed.allowed_reward_units.maximum ?? "0");
          const allowedLater = BigInt(
            afterOneMore.allowed_reward_units.maximum ?? "0",
          );
          expect(allowed).toBeLessThanOrEqual(BigInt(maximum - used));
          expect(allowedLater).toBeLessThanOrEqual(allowed);
        },
      ),
      { numRuns: 120 },
    );
  });

  it("derives ranges only from enumerated compatible states", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -10_000, max: 10_000 }),
        fc.integer({ min: -10_000, max: 10_000 }),
        fc.integer({ min: -10_000, max: 10_000 }),
        fc.integer({ min: -10_000, max: 10_000 }),
        (aOne, aTwo, bOne, bTwo) => {
          const result = evaluateFeasibleStates([
            {
              state_id: "compatible_one",
              assignments: { tier: "basic", enrolled: false },
              plans: {
                plan_a: { value: aOne.toString() },
                plan_b: { value: bOne.toString() },
              },
            },
            {
              state_id: "compatible_two",
              assignments: { tier: "premium", enrolled: true },
              plans: {
                plan_a: { value: aTwo.toString() },
                plan_b: { value: bTwo.toString() },
              },
            },
          ]);
          const planA = result.plan_summaries.find(
            (summary) => summary.plan_id === "plan_a",
          );
          const planB = result.plan_summaries.find(
            (summary) => summary.plan_id === "plan_b",
          );
          expect(planA?.value_range_jpy.minimum_jpy).toBe(
            Math.min(aOne, aTwo).toString(),
          );
          expect(planA?.value_range_jpy.maximum_jpy).toBe(
            Math.max(aOne, aTwo).toString(),
          );
          expect(planB?.value_range_jpy.minimum_jpy).toBe(
            Math.min(bOne, bTwo).toString(),
          );
          expect(planB?.value_range_jpy.maximum_jpy).toBe(
            Math.max(bOne, bTwo).toString(),
          );
          expect(result.enumerated_state_ids).toEqual([
            "compatible_one",
            "compatible_two",
          ]);
        },
      ),
      { numRuns: 120 },
    );
  });
});
