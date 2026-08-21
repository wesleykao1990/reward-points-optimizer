import { describe, expect, it } from "vitest";
import {
  evaluateFeasibleStates,
  rankGuaranteedPlans,
  separateProbabilisticComponents,
} from "../src/m1b-uncertainty.js";

describe("Milestone 1B uncertainty and ranking kernel", () => {
  it("returns a definite winner only when it wins every explicit feasible state", () => {
    const result = evaluateFeasibleStates([
      {
        state_id: "known_a",
        assignments: { enrollment: "enrolled" },
        plans: { plan_a: { value: "20" }, plan_b: { value: "10" } },
      },
      {
        state_id: "known_b",
        assignments: { enrollment: "enrolled" },
        plans: { plan_a: { value: "21" }, plan_b: { value: "10" } },
      },
    ]);
    expect(result.outcome_mode).toBe("definite");
    expect(result.definite_winner_plan_id).toBe("plan_a");
    expect(result.conditional_winners).toEqual([]);
  });

  it("returns conditional winners and a targeted question when states disagree", () => {
    const result = evaluateFeasibleStates([
      {
        state_id: "not_enrolled",
        assignments: { enrollment: "unknown" },
        unknown_keys: ["enrollment"],
        questions: { enrollment: "Are you enrolled in the campaign?" },
        plans: { plan_a: { value: "10" }, plan_b: { value: "20" } },
      },
      {
        state_id: "enrolled",
        assignments: { enrollment: "unknown" },
        unknown_keys: ["enrollment"],
        plans: { plan_a: { value: "30" }, plan_b: { value: "20" } },
      },
    ]);
    expect(result.outcome_mode).toBe("conditional");
    expect(result.definite_winner_plan_id).toBeNull();
    expect(result.conditional_winners.map((item) => item.plan_id)).toEqual([
      "plan_a",
      "plan_b",
    ]);
    expect(result.questions_to_resolve).toContainEqual({
      fact_key: "enrollment",
      question: "Are you enrolled in the campaign?",
      could_change_winner: true,
    });
  });

  it("enumerates explicit compatible assignments without combining independent best cases", () => {
    const result = evaluateFeasibleStates([
      {
        state_id: "basic_not_enrolled",
        assignments: { tier: "basic", enrollment: false },
        plans: { plan_a: { value: "100" }, plan_b: { value: "80" } },
      },
      {
        state_id: "premium_enrolled",
        assignments: { tier: "premium", enrollment: true },
        plans: { plan_a: { value: "60" }, plan_b: { value: "120" } },
      },
    ]);
    expect(result.enumerated_state_ids).toEqual([
      "basic_not_enrolled",
      "premium_enrolled",
    ]);
    expect(
      result.plan_summaries.find((item) => item.plan_id === "plan_a")
        ?.value_range_jpy,
    ).toEqual({
      minimum_jpy: "60",
      maximum_jpy: "100",
      expected_jpy: null,
    });
    expect(
      result.plan_summaries.find((item) => item.plan_id === "plan_b")
        ?.value_range_jpy,
    ).toEqual({
      minimum_jpy: "80",
      maximum_jpy: "120",
      expected_jpy: null,
    });
  });

  it("keeps undisclosed lotteries out of guaranteed and expected values", () => {
    const undisclosed = separateProbabilisticComponents(
      [
        {
          component_id: "guaranteed",
          value_jpy: "10",
          certainty: "guaranteed",
        },
        {
          component_id: "lottery",
          value_jpy: "1000",
          certainty: "probabilistic",
          probability: "0.5",
          probability_source: "undisclosed",
        },
      ],
      { probability_policy: "include_user_estimate" },
    );
    expect(undisclosed.guaranteed_value_jpy).toBe("10");
    expect(undisclosed.probabilistic_expected_value_jpy).toBe("0");
    expect(undisclosed.excluded_probabilistic_component_ids).toEqual([
      "lottery",
    ]);

    const official = separateProbabilisticComponents(
      [
        {
          component_id: "guaranteed",
          value_jpy: "10",
          certainty: "guaranteed",
        },
        {
          component_id: "lottery",
          value_jpy: "1000",
          certainty: "probabilistic",
          probability: "0.5",
          probability_source: "official_disclosed",
        },
      ],
      { probability_policy: "expected_if_official_probability" },
    );
    expect(official.probabilistic_expected_value_jpy).toBe("500");
    expect(official.expected_value_jpy).toBe("510");
  });

  it("supports an expected objective only with a supported probability", () => {
    const result = evaluateFeasibleStates({
      objective: "maximize_expected",
      probability_policy: "expected_if_official_probability",
      states: [
        {
          state_id: "s",
          plans: {
            plan_a: {
              value: "100",
              components: [
                {
                  component_id: "lottery",
                  value_jpy: "1000",
                  certainty: "probabilistic",
                  probability: "0.2",
                  probability_source: "official_disclosed",
                },
              ],
            },
            plan_b: { value: "150" },
          },
        },
      ],
    });
    expect(result.definite_winner_plan_id).toBe("plan_a");
    expect(result.states[0]?.rankings[0]?.plan_id).toBe("plan_a");
  });

  it("ranks guaranteed values independently of probabilistic upside", () => {
    expect(
      rankGuaranteedPlans([
        { plan_id: "plan_a", guaranteed_value: "10", value: "999" },
        { plan_id: "plan_b", guaranteed_value: "20", value: "20" },
      ]),
    ).toEqual([
      { plan_id: "plan_b", value_jpy: "20", rank: 1 },
      { plan_id: "plan_a", value_jpy: "10", rank: 2 },
    ]);
  });
});
