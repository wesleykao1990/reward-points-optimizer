import { Decimal } from "decimal.js";
import { canonicalDecimal, D } from "./math.js";

export type StackingMode =
  | "additive"
  | "replaces_group"
  | "best_of_group"
  | "includes_base"
  | "non_reward_acceptance"
  | string;

export type StackingValue = string | number | bigint | Decimal;

/** Local candidate shape.  Adapters may pass either snake_case or camelCase fields. */
export interface StackingCandidate {
  rule_id?: string;
  ruleId?: string;
  stack_group?: string;
  stackGroup?: string;
  mode?: StackingMode;
  precedence?: number;
  value?: StackingValue;
  reward_units?: StackingValue;
  rewardUnits?: StackingValue;
  base_reward_included?: boolean;
  baseRewardIncluded?: boolean;
  base_rule_id?: string | null;
  baseRuleId?: string | null;
  is_base_reward?: boolean;
  isBaseReward?: boolean;
  rule_type?: string;
  requires_rule_ids?: readonly string[];
  requiresRuleIds?: readonly string[];
  conflicts_with_rule_ids?: readonly string[];
  conflictsWithRuleIds?: readonly string[];
  eligible?: boolean;
  certainty?: "guaranteed" | "probabilistic" | "conditional_selection" | string;
  notes?: string;
  [key: string]: unknown;
}

export interface NormalizedStackingCandidate {
  rule_id: string;
  stack_group: string;
  mode: StackingMode;
  precedence: number;
  value: Decimal;
  base_reward_included: boolean;
  base_rule_id: string | null;
  is_base_reward: boolean;
  requires_rule_ids: string[];
  conflicts_with_rule_ids: string[];
  original: StackingCandidate;
}

export type StackRejectionReason =
  | "ineligible"
  | "missing_dependency"
  | "dependency_rejected"
  | "conflict"
  | "replaced"
  | "not_best_of_group"
  | "base_included"
  | "duplicate_rule_id"
  | "invalid_candidate"
  | string;

export interface StackRejection {
  rule_id: string;
  reason: StackRejectionReason;
  by_rule_id?: string;
  stack_group?: string;
  detail?: string;
}

export interface StackingResolution {
  selected: NormalizedStackingCandidate[];
  rejected: StackRejection[];
  applied_rule_ids: string[];
  rejected_rule_ids: string[];
  total_value: string;
  selected_by_group: Record<string, string[]>;
  base_included_rule_ids: string[];
  suppressed_base_rule_ids: string[];
  conflicts: Array<{ rule_ids: string[]; winner_rule_id: string | null }>;
  dependencies: Array<{
    rule_id: string;
    required_rule_ids: string[];
    satisfied: boolean;
  }>;
  unresolved: string[];
  /** Native-style aliases for callers that use TypeScript naming. */
  selectedCandidates: NormalizedStackingCandidate[];
  rejectedCandidates: StackRejection[];
  totalValue: string;
}

export interface StackingEvaluationInput {
  candidates: readonly StackingCandidate[];
  /** Optional separately calculated base reward; this is never added twice. */
  base_reward?: StackingCandidate | null;
  baseReward?: StackingCandidate | null;
}

function candidateId(candidate: StackingCandidate): string {
  return candidate.rule_id ?? candidate.ruleId ?? "";
}

function candidateGroup(candidate: StackingCandidate): string {
  return candidate.stack_group ?? candidate.stackGroup ?? "";
}

function asDecimal(value: StackingValue | undefined): Decimal {
  if (value === undefined) return D(0);
  if (value instanceof Decimal) return new D(value.toString());
  if (typeof value === "number" && !Number.isSafeInteger(value))
    throw new Error("binary_number_not_allowed");
  const parsed = new D(value.toString());
  if (!parsed.isFinite()) throw new Error("invalid_stacking_value");
  return parsed;
}

function normalized(candidate: StackingCandidate): NormalizedStackingCandidate {
  const ruleId = candidateId(candidate);
  if (!ruleId) throw new Error("stacking_candidate_rule_id_required");
  const mode = candidate.mode ?? "additive";
  const baseIncluded =
    candidate.base_reward_included ??
    candidate.baseRewardIncluded ??
    mode === "includes_base";
  const isBase =
    candidate.is_base_reward ??
    candidate.isBaseReward ??
    candidate.rule_type === "base_reward";
  return {
    rule_id: ruleId,
    stack_group: candidateGroup(candidate),
    mode,
    precedence: Number.isFinite(candidate.precedence ?? 0)
      ? (candidate.precedence ?? 0)
      : 0,
    value: asDecimal(
      candidate.value ?? candidate.reward_units ?? candidate.rewardUnits,
    ),
    base_reward_included: baseIncluded,
    base_rule_id: candidate.base_rule_id ?? candidate.baseRuleId ?? null,
    is_base_reward: isBase,
    requires_rule_ids: [
      ...(candidate.requires_rule_ids ?? candidate.requiresRuleIds ?? []),
    ].sort(),
    conflicts_with_rule_ids: [
      ...(candidate.conflicts_with_rule_ids ??
        candidate.conflictsWithRuleIds ??
        []),
    ].sort(),
    original: candidate,
  };
}

function priorityCompare(
  left: NormalizedStackingCandidate,
  right: NormalizedStackingCandidate,
): number {
  if (left.precedence !== right.precedence)
    return right.precedence - left.precedence;
  const value = right.value.comparedTo(left.value);
  if (value !== 0) return value;
  return left.rule_id.localeCompare(right.rule_id);
}

function valueCompare(
  left: NormalizedStackingCandidate,
  right: NormalizedStackingCandidate,
): number {
  const value = right.value.comparedTo(left.value);
  if (value !== 0) return value;
  return priorityCompare(left, right);
}

function normalizeInput(
  inputOrCandidates: readonly StackingCandidate[] | StackingEvaluationInput,
  baseReward?: StackingCandidate | null,
): StackingEvaluationInput {
  if (!Array.isArray(inputOrCandidates) && "candidates" in inputOrCandidates)
    return inputOrCandidates;
  return {
    candidates: inputOrCandidates,
    ...(baseReward === undefined ? {} : { base_reward: baseReward }),
  };
}

/**
 * Resolve all stack semantics in a fixed order.  The order is part of the
 * kernel contract: eligibility/dependencies, explicit conflicts, replacement,
 * best-of, and finally included-base suppression.
 */
export function resolveStacking(
  input: StackingEvaluationInput,
): StackingResolution;
export function resolveStacking(
  candidates: readonly StackingCandidate[],
  baseReward?: StackingCandidate | null,
): StackingResolution;
export function resolveStacking(
  inputOrCandidates: readonly StackingCandidate[] | StackingEvaluationInput,
  baseReward?: StackingCandidate | null,
): StackingResolution {
  const input = normalizeInput(inputOrCandidates, baseReward);
  const allRejected: StackRejection[] = [];
  const source = [...input.candidates];
  const separatelyCalculatedBase = input.base_reward ?? input.baseReward;
  if (separatelyCalculatedBase) {
    source.push({
      ...separatelyCalculatedBase,
      is_base_reward:
        separatelyCalculatedBase.is_base_reward ??
        separatelyCalculatedBase.isBaseReward ??
        true,
    });
  }
  const byId = new Map<string, NormalizedStackingCandidate>();
  for (const candidate of source) {
    const id = candidateId(candidate);
    if (!id) {
      allRejected.push({
        rule_id: "",
        reason: "invalid_candidate",
        detail: "rule_id is required",
      });
      continue;
    }
    if (byId.has(id)) {
      allRejected.push({ rule_id: id, reason: "duplicate_rule_id" });
      continue;
    }
    try {
      byId.set(id, normalized(candidate));
    } catch (error) {
      allRejected.push({
        rule_id: id,
        reason: "invalid_candidate",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const dependencyMap = new Map<
    string,
    StackingResolution["dependencies"][number]
  >();
  const rejectedById = new Map<string, StackRejection>();
  const active = new Set<string>();
  for (const [id, candidate] of byId) {
    if (candidate.original.eligible === false) {
      const rejection = {
        rule_id: id,
        reason: "ineligible",
      } satisfies StackRejection;
      allRejected.push(rejection);
      rejectedById.set(id, rejection);
      continue;
    }
    active.add(id);
  }
  // A dependency can depend on another rejected dependency.  Iterating to a
  // fixed point makes this independent of input order.
  let changed = true;
  while (changed) {
    changed = false;
    for (const [id, candidate] of byId) {
      if (!active.has(id)) continue;
      const missing = candidate.requires_rule_ids.filter(
        (required) => !byId.has(required),
      );
      const rejected = candidate.requires_rule_ids.filter((required) =>
        rejectedById.has(required),
      );
      dependencyMap.set(id, {
        rule_id: id,
        required_rule_ids: [...candidate.requires_rule_ids],
        satisfied: missing.length === 0 && rejected.length === 0,
      });
      if (missing.length > 0 || rejected.length > 0) {
        const rejection: StackRejection = {
          rule_id: id,
          reason:
            missing.length > 0 ? "missing_dependency" : "dependency_rejected",
          detail: [...missing, ...rejected].sort().join(","),
          ...([...(missing.length > 0 ? missing : rejected)].sort()[0]
            ? {
                by_rule_id: [
                  ...(missing.length > 0 ? missing : rejected),
                ].sort()[0],
              }
            : {}),
        };
        active.delete(id);
        rejectedById.set(id, rejection);
        allRejected.push(rejection);
        changed = true;
      }
    }
  }

  const conflicts: StackingResolution["conflicts"] = [];
  const conflictPairs = new Set<string>();
  for (const candidate of [...byId.values()].sort((a, b) =>
    a.rule_id.localeCompare(b.rule_id),
  )) {
    if (!active.has(candidate.rule_id)) continue;
    for (const otherId of candidate.conflicts_with_rule_ids) {
      if (!active.has(otherId) || !byId.has(otherId)) continue;
      const key = [candidate.rule_id, otherId].sort().join("\u0000");
      if (conflictPairs.has(key)) continue;
      conflictPairs.add(key);
      const other = byId.get(otherId)!;
      const winner = priorityCompare(candidate, other) <= 0 ? candidate : other;
      const loser = winner.rule_id === candidate.rule_id ? other : candidate;
      active.delete(loser.rule_id);
      const rejection: StackRejection = {
        rule_id: loser.rule_id,
        reason: "conflict",
        by_rule_id: winner.rule_id,
        stack_group: loser.stack_group,
      };
      rejectedById.set(loser.rule_id, rejection);
      allRejected.push(rejection);
      conflicts.push({
        rule_ids: [candidate.rule_id, other.rule_id].sort(),
        winner_rule_id: winner.rule_id,
      });
    }
  }

  const groupMap = new Map<string, NormalizedStackingCandidate[]>();
  for (const candidate of byId.values()) {
    if (!active.has(candidate.rule_id)) continue;
    const group = groupMap.get(candidate.stack_group) ?? [];
    group.push(candidate);
    groupMap.set(candidate.stack_group, group);
  }
  const suppress = (
    candidate: NormalizedStackingCandidate,
    reason: StackRejectionReason,
    by?: NormalizedStackingCandidate,
  ) => {
    if (!active.delete(candidate.rule_id)) return;
    const rejection: StackRejection = {
      rule_id: candidate.rule_id,
      reason,
      ...(by ? { by_rule_id: by.rule_id } : {}),
      stack_group: candidate.stack_group,
    };
    rejectedById.set(candidate.rule_id, rejection);
    allRejected.push(rejection);
  };

  for (const candidates of groupMap.values()) {
    const replacements = candidates.filter(
      (candidate) => candidate.mode === "replaces_group",
    );
    if (replacements.length > 0) {
      const winner = [...replacements].sort(priorityCompare)[0]!;
      for (const candidate of candidates) {
        if (candidate.rule_id !== winner.rule_id)
          suppress(candidate, "replaced", winner);
      }
    }
  }
  // Rebuild groups after replacement.  Best-of never compares candidates from
  // unrelated stack groups, and additive candidates remain additive.
  for (const group of [
    ...new Set([...byId.values()].map((candidate) => candidate.stack_group)),
  ].sort()) {
    const candidates = [...byId.values()].filter(
      (candidate) =>
        active.has(candidate.rule_id) &&
        candidate.stack_group === group &&
        candidate.mode === "best_of_group",
    );
    if (candidates.length <= 1) continue;
    const winner = [...candidates].sort(valueCompare)[0]!;
    for (const candidate of candidates) {
      if (candidate.rule_id !== winner.rule_id)
        suppress(candidate, "not_best_of_group", winner);
    }
  }

  // Conflict/replacement/best-of decisions can remove a dependency after the
  // first dependency pass.  Re-check active candidates before included-base
  // suppression, where a base may intentionally be represented by its parent.
  let dependencyChanged = true;
  while (dependencyChanged) {
    dependencyChanged = false;
    for (const candidate of byId.values()) {
      if (!active.has(candidate.rule_id)) continue;
      const unavailable = candidate.requires_rule_ids.find(
        (required) => !active.has(required),
      );
      if (!unavailable) continue;
      suppress(candidate, "dependency_rejected", byId.get(unavailable));
      dependencyChanged = true;
    }
  }

  const suppressedBaseRuleIds: string[] = [];
  const includedBaseRuleIds: string[] = [];
  for (const candidate of byId.values()) {
    if (!active.has(candidate.rule_id) || !candidate.base_reward_included)
      continue;
    includedBaseRuleIds.push(candidate.rule_id);
    const baseIds = candidate.base_rule_id
      ? [candidate.base_rule_id]
      : [...byId.values()]
          .filter(
            (base) =>
              base.is_base_reward &&
              base.stack_group === candidate.stack_group &&
              base.rule_id !== candidate.rule_id,
          )
          .map((base) => base.rule_id);
    for (const baseId of baseIds) {
      const base = byId.get(baseId);
      if (!base || !active.has(baseId)) continue;
      suppress(base, "base_included", candidate);
      suppressedBaseRuleIds.push(baseId);
    }
  }

  const selected = [...byId.values()]
    .filter((candidate) => active.has(candidate.rule_id))
    .sort((left, right) => left.rule_id.localeCompare(right.rule_id));
  const rejected = [...allRejected].sort(
    (left, right) =>
      left.rule_id.localeCompare(right.rule_id) ||
      left.reason.localeCompare(right.reason),
  );
  const selectedByGroup: Record<string, string[]> = {};
  for (const candidate of selected) {
    const group = selectedByGroup[candidate.stack_group] ?? [];
    group.push(candidate.rule_id);
    selectedByGroup[candidate.stack_group] = group;
  }
  for (const ids of Object.values(selectedByGroup)) ids.sort();
  const total = selected.reduce(
    (sum, candidate) => sum.plus(candidate.value),
    D(0),
  );
  const unresolved = rejected
    .filter(
      (item) => item.reason === "conflict" && item.by_rule_id === undefined,
    )
    .map((item) => item.rule_id)
    .sort();
  const result: StackingResolution = {
    selected,
    rejected,
    applied_rule_ids: selected.map((candidate) => candidate.rule_id).sort(),
    rejected_rule_ids: [
      ...new Set(rejected.map((item) => item.rule_id)),
    ].sort(),
    total_value: canonicalDecimal(total),
    selected_by_group: selectedByGroup,
    base_included_rule_ids: [...new Set(includedBaseRuleIds)].sort(),
    suppressed_base_rule_ids: [...new Set(suppressedBaseRuleIds)].sort(),
    conflicts: conflicts.sort((left, right) =>
      left.rule_ids.join("\u0000").localeCompare(right.rule_ids.join("\u0000")),
    ),
    dependencies: [...dependencyMap.values()].sort((left, right) =>
      left.rule_id.localeCompare(right.rule_id),
    ),
    unresolved,
    selectedCandidates: selected,
    rejectedCandidates: rejected,
    totalValue: canonicalDecimal(total),
  };
  return result;
}

export const resolveStack = resolveStacking;
export const applyStacking = resolveStacking;
export const stackRewards = resolveStacking;
