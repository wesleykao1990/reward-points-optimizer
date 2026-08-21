import { describe, expect, it } from "vitest";
import {
  type CapProgressLike,
  type CapRuleLike,
  evaluateCap,
  evaluateCaps,
} from "../src/m1b-caps.js";

const cap = (overrides: Partial<CapRuleLike> = {}): CapRuleLike => ({
  cap_id: "cap.test",
  cap_type: "per_day",
  max_reward_units: "100",
  max_eligible_spend_jpy: null,
  shared_cap_group: null,
  progress_source: "user_input",
  reset: {
    period: "day",
    timezone: "Asia/Tokyo",
    boundary: "calendar",
  },
  partial_consumption: true,
  unknown_progress_policy: "return_range",
  ...overrides,
});

const progress = (
  overrides: Partial<CapProgressLike> = {},
): CapProgressLike => ({
  status: "known",
  eligible_spend_jpy_min: 0,
  eligible_spend_jpy_max: 0,
  reward_earned_units_min: "20",
  reward_earned_units_max: "20",
  period_start: "2026-08-17T00:00:00.000Z",
  period_end: "2026-08-18T00:00:00.000Z",
  source: "user_input",
  ...overrides,
});

describe("Milestone 1B cap kernel", () => {
  it("supports every cap type and preserves the declared reset metadata", () => {
    for (const capType of [
      "per_operation",
      "per_day",
      "per_month",
      "per_campaign",
      "per_year",
      "lifetime",
    ] as const) {
      const result = evaluateCap(
        cap({
          cap_id: `cap.${capType}`,
          cap_type: capType,
          reset: {
            period:
              capType === "lifetime" ? "never" : capType.replace("per_", ""),
            timezone: "Asia/Tokyo",
            boundary:
              capType === "per_campaign" ? "campaign_defined" : "calendar",
          },
          progress_source:
            capType === "per_operation" ? "not_required" : "user_input",
        }),
        capType === "per_operation" ? undefined : progress(),
        { reward_units: "10" },
      );
      expect(result.cap_type).toBe(capType);
      expect(result.reset_period.timezone).toBe("Asia/Tokyo");
      expect(result.allowed_reward_units.maximum).toBe("10");
    }
  });

  it("reports partial remaining and caps the requested reward", () => {
    const result = evaluateCap(cap(), progress(), { reward_units: "90" });
    expect(result.remaining_reward_units).toEqual({
      minimum: "80",
      maximum: "80",
      expected: "80",
    });
    expect(result.availability).toBe("partial");
    expect(result.consumption).toBe("partial");
    expect(result.allowed_reward_units.maximum).toBe("80");
  });

  it("reports exhausted progress without treating it as available", () => {
    const result = evaluateCap(
      cap(),
      progress({
        reward_earned_units_min: "100",
        reward_earned_units_max: "100",
      }),
      { reward_units: "1" },
    );
    expect(result.availability).toBe("exhausted");
    expect(result.exhausted).toBe(true);
    expect(result.allowed_reward_units.maximum).toBe("0");
  });

  it("suppresses an over-cap request when partial consumption is disallowed", () => {
    const result = evaluateCap(
      cap({ partial_consumption: false }),
      progress(),
      { reward_units: "90" },
    );
    expect(result.availability).toBe("blocked");
    expect(result.allowed_reward_units).toEqual({
      minimum: "0",
      maximum: "0",
      expected: "0",
    });
  });

  it("keeps estimated and unknown progress as uncertainty ranges", () => {
    const estimated = evaluateCap(
      cap(),
      progress({
        status: "estimated",
        reward_earned_units_min: "20",
        reward_earned_units_max: "40",
      }),
      { reward_units: "90" },
    );
    expect(estimated.remaining_reward_units).toEqual({
      minimum: "60",
      maximum: "80",
      expected: null,
    });
    expect(estimated.uncertain).toBe(true);

    const unknown = evaluateCap(cap(), undefined, { reward_units: "90" });
    expect(unknown.progress_status).toBe("unknown");
    expect(unknown.remaining_reward_units).toEqual({
      minimum: "0",
      maximum: "100",
      expected: null,
    });
    expect(unknown.availability).toBe("unknown");
    expect(unknown.reasons).toContain("progress_unknown_not_treated_as_zero");
  });

  it("applies a new timezone period when the observed period is stale", () => {
    const result = evaluateCap(
      cap(),
      progress({
        period_start: "2026-08-16T15:00:00.000Z",
        period_end: "2026-08-17T15:00:00.000Z",
      }),
      { reward_units: "100", eligible_spend_jpy: 100 },
    );
    // The operation is supplied through the input form in this assertion.
    const nextDay = evaluateCap({
      cap: cap(),
      progress: progress({
        period_start: "2026-08-16T15:00:00.000Z",
        period_end: "2026-08-17T15:00:00.000Z",
      }),
      operation_timestamp: "2026-08-17T16:00:00.000Z",
      candidate: { reward_units: "100" },
    });
    expect(result.reset_period.timezone).toBe("Asia/Tokyo");
    expect(nextDay.reset_period.applied).toBe(true);
    expect(nextDay.remaining_reward_units.maximum).toBe("100");
  });

  it("uses one shared pool for caps in the same group", () => {
    const caps = [
      cap({ cap_id: "cap.a", shared_cap_group: "group.shared" }),
      cap({ cap_id: "cap.b", shared_cap_group: "group.shared" }),
    ];
    const result = evaluateCaps(
      caps,
      {
        "group.shared": progress({
          reward_earned_units_min: "30",
          reward_earned_units_max: "30",
        }),
      },
      { reward_units: "80" },
    );
    expect(result.shared_groups).toHaveLength(1);
    expect(result.shared_groups[0]?.remaining_reward_units.maximum).toBe("70");
    expect(result.shared_groups[0]?.allowed_reward_units.maximum).toBe("70");
    expect(result.by_cap_id["cap.a"]?.shared_cap_group).toBe("group.shared");
  });

  it("limits an eligible-spend cap proportionally when partial consumption is allowed", () => {
    const result = evaluateCap(
      cap({ max_reward_units: null, max_eligible_spend_jpy: 500 }),
      progress({ eligible_spend_jpy_min: 300, eligible_spend_jpy_max: 300 }),
      { reward_units: "100", eligible_spend_jpy: 400 },
    );
    expect(result.remaining_eligible_spend_jpy.maximum).toBe(200);
    expect(result.allowed_eligible_spend_jpy.maximum).toBe(200);
    expect(result.allowed_reward_units.maximum).toBe("50");
  });
});
