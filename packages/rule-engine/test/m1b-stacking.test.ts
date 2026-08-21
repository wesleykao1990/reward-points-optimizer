import { describe, expect, it } from "vitest";
import {
  resolveStacking,
  type StackingCandidate,
} from "../src/m1b-stacking.js";

const candidate = (
  rule_id: string,
  value: string,
  overrides: Partial<StackingCandidate> = {},
): StackingCandidate => ({
  rule_id,
  stack_group: "group.test",
  mode: "additive",
  precedence: 0,
  value,
  ...overrides,
});

describe("Milestone 1B stacking kernel", () => {
  it("adds independent additive components", () => {
    const result = resolveStacking([
      candidate("rr.base", "10"),
      candidate("rr.bonus", "5"),
    ]);
    expect(result.applied_rule_ids).toEqual(["rr.base", "rr.bonus"]);
    expect(result.total_value).toBe("15");
  });

  it("selects only the best value within a best-of group", () => {
    const result = resolveStacking([
      candidate("rr.best_a", "10", {
        mode: "best_of_group",
        stack_group: "best",
      }),
      candidate("rr.best_b", "15", {
        mode: "best_of_group",
        stack_group: "best",
      }),
    ]);
    expect(result.applied_rule_ids).toEqual(["rr.best_b"]);
    expect(
      result.rejected.find((item) => item.rule_id === "rr.best_a")?.reason,
    ).toBe("not_best_of_group");
  });

  it("uses precedence for replacement and explicit conflicts", () => {
    const replacement = resolveStacking([
      candidate("rr.low", "100", { stack_group: "replace", precedence: 1 }),
      candidate("rr.high", "20", {
        stack_group: "replace",
        mode: "replaces_group",
        precedence: 2,
      }),
    ]);
    expect(replacement.applied_rule_ids).toEqual(["rr.high"]);
    expect(
      replacement.rejected.find((item) => item.rule_id === "rr.low")?.reason,
    ).toBe("replaced");

    const conflict = resolveStacking([
      candidate("rr.conflict_a", "10", {
        conflicts_with_rule_ids: ["rr.conflict_b"],
        precedence: 1,
      }),
      candidate("rr.conflict_b", "1", { precedence: 2 }),
    ]);
    expect(conflict.applied_rule_ids).toEqual(["rr.conflict_b"]);
    expect(conflict.conflicts[0]?.winner_rule_id).toBe("rr.conflict_b");
  });

  it("rejects missing and transitively rejected dependencies", () => {
    const result = resolveStacking([
      candidate("rr.child", "5", { requires_rule_ids: ["rr.missing"] }),
      candidate("rr.grandchild", "2", { requires_rule_ids: ["rr.child"] }),
    ]);
    expect(result.applied_rule_ids).toEqual([]);
    expect(
      result.rejected.find((item) => item.rule_id === "rr.child")?.reason,
    ).toBe("missing_dependency");
    expect(
      result.rejected.find((item) => item.rule_id === "rr.grandchild")?.reason,
    ).toBe("dependency_rejected");
  });

  it("does not double-count a standalone base when a bonus includes it", () => {
    const result = resolveStacking([
      candidate("rr.base", "10", { is_base_reward: true }),
      candidate("rr.includes_base", "15", {
        mode: "includes_base",
        base_reward_included: true,
      }),
    ]);
    expect(result.applied_rule_ids).toEqual(["rr.includes_base"]);
    expect(result.total_value).toBe("15");
    expect(result.suppressed_base_rule_ids).toEqual(["rr.base"]);
  });

  it("is deterministic under candidate reordering and keeps unrelated groups additive", () => {
    const first = resolveStacking([
      candidate("rr.z", "3", { stack_group: "other" }),
      candidate("rr.a", "4", { stack_group: "best", mode: "best_of_group" }),
      candidate("rr.b", "4", { stack_group: "best", mode: "best_of_group" }),
    ]);
    const second = resolveStacking([
      candidate("rr.b", "4", { stack_group: "best", mode: "best_of_group" }),
      candidate("rr.a", "4", { stack_group: "best", mode: "best_of_group" }),
      candidate("rr.z", "3", { stack_group: "other" }),
    ]);
    expect(first.applied_rule_ids).toEqual(second.applied_rule_ids);
    expect(first.total_value).toBe(second.total_value);
  });
});
