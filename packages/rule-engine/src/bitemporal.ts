import { canonicalHash, canonicalize, parseTime } from "./math.js";
import type { RewardRule, RuleValidity } from "./types.js";
import { assertReviewPolicy } from "./validation.js";

function end(value: string | null): number {
  return value === null ? Number.POSITIVE_INFINITY : parseTime(value);
}

export function halfOpenContains(
  start: string,
  exclusiveEnd: string | null,
  at: string,
): boolean {
  const point = parseTime(at);
  return parseTime(start) <= point && point < end(exclusiveEnd);
}

export function halfOpenRangesOverlap(
  leftStart: string,
  leftEnd: string | null,
  rightStart: string,
  rightEnd: string | null,
): boolean {
  return (
    parseTime(leftStart) < end(rightEnd) && parseTime(rightStart) < end(leftEnd)
  );
}

export function bitemporalRectanglesOverlap(
  left: RuleValidity,
  right: RuleValidity,
): boolean {
  return (
    halfOpenRangesOverlap(
      left.valid_from,
      left.valid_to,
      right.valid_from,
      right.valid_to,
    ) &&
    halfOpenRangesOverlap(
      left.recorded_at,
      left.superseded_at,
      right.recorded_at,
      right.superseded_at,
    )
  );
}

export function ruleIsApproved(rule: RewardRule): boolean {
  if (rule.status !== "published") return false;
  try {
    assertReviewPolicy(
      rule.audit.required_review_modes,
      rule.audit.review_events,
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Experimental execution is an explicit host policy, not an alternate
 * publication status.  Under-review candidates may be evaluated only when a
 * caller has already entered the dedicated experimental recommendation lane;
 * approved review events and human verification are rejected here so this
 * path cannot mint trust by changing a status field.
 */
export function ruleIsExperimentalCandidate(rule: RewardRule): boolean {
  return (
    rule.status === "under_review" &&
    rule.provenance.human_verified === false &&
    rule.audit.review_mode === null &&
    rule.audit.reviewed_at === null &&
    rule.audit.reviewed_by === null &&
    Array.isArray(rule.audit.review_events) &&
    rule.audit.review_events.length === 0
  );
}

export type RuleEvaluationPolicy = "approved" | "experimental_unverified";

export function selectApprovedRule(
  rules: readonly RewardRule[],
  ruleId: string,
  transactionTime: string,
  replayKnowledgeTime: string,
): RewardRule | null {
  const matches = rules.filter(
    (rule) =>
      rule.rule_id === ruleId &&
      ruleIsApproved(rule) &&
      halfOpenContains(
        rule.validity.valid_from,
        rule.validity.valid_to,
        transactionTime,
      ) &&
      halfOpenContains(
        rule.validity.recorded_at,
        rule.validity.superseded_at,
        replayKnowledgeTime,
      ),
  );
  if (matches.length > 1) throw new Error("ambiguous_bitemporal_replay");
  return matches[0] ? structuredClone(matches[0]) : null;
}

export function selectApprovedRules(
  rules: readonly RewardRule[],
  transactionTime: string,
  replayKnowledgeTime: string,
): RewardRule[] {
  return selectRulesForEvaluation(
    rules,
    transactionTime,
    replayKnowledgeTime,
    "approved",
  );
}

export function selectRulesForEvaluation(
  rules: readonly RewardRule[],
  transactionTime: string,
  replayKnowledgeTime: string,
  policy: RuleEvaluationPolicy = "approved",
): RewardRule[] {
  const byId = new Map<string, RewardRule[]>();
  for (const rule of rules) {
    if (
      policy === "approved"
        ? !ruleIsApproved(rule)
        : !ruleIsExperimentalCandidate(rule)
    )
      continue;
    if (
      !halfOpenContains(
        rule.validity.valid_from,
        rule.validity.valid_to,
        transactionTime,
      )
    )
      continue;
    if (
      !halfOpenContains(
        rule.validity.recorded_at,
        rule.validity.superseded_at,
        replayKnowledgeTime,
      )
    )
      continue;
    const list = byId.get(rule.rule_id) ?? [];
    list.push(rule);
    byId.set(rule.rule_id, list);
  }
  const selected: RewardRule[] = [];
  for (const [ruleId, matches] of byId) {
    if (matches.length > 1)
      throw new Error(`ambiguous_bitemporal_replay:${ruleId}`);
    const match = matches[0];
    if (match === undefined)
      throw new Error(`missing_bitemporal_replay:${ruleId}`);
    selected.push(structuredClone(match));
  }
  return selected.sort(
    (left, right) =>
      left.rule_id.localeCompare(right.rule_id) || left.version - right.version,
  );
}

export interface PublishRuleCommand {
  idempotency_key: string;
  rule: RewardRule;
}

export interface LegacyPublishRuleCommand {
  idempotencyKey: string;
  ruleId: string;
  version: number;
  status: RewardRule["status"];
  definition: unknown;
  validity: {
    validFrom: string;
    validTo: string | null;
    recordedAt: string;
    supersededAt: string | null;
  };
}

export type RuleStoreCommand = PublishRuleCommand | LegacyPublishRuleCommand;

export class RuleVersionStore {
  readonly #versions = new Map<string, RewardRule[]>();
  readonly #publicationRequests = new Map<
    string,
    { commandCanonical: string; result: RewardRule }
  >();

  publish(command: RuleStoreCommand): RewardRule {
    const normalized = normalizeCommand(command);
    if (!normalized.idempotency_key)
      throw new Error("publication_idempotency_required");
    const commandCanonical = canonicalize(normalized);
    const previous = this.#publicationRequests.get(normalized.idempotency_key);
    if (previous) {
      if (previous.commandCanonical !== commandCanonical)
        throw new Error("publication_idempotency_mismatch");
      return structuredClone(previous.result);
    }
    const existing = this.#versions.get(normalized.rule.rule_id) ?? [];
    if (existing.some((version) => version.version === normalized.rule.version))
      throw new Error("rule_version_conflict");
    if (normalized.rule.status === "published") {
      if (
        existing.some(
          (version) =>
            ruleIsApproved(version) &&
            bitemporalRectanglesOverlap(
              version.validity,
              normalized.rule.validity,
            ),
        )
      )
        throw new Error("approved_bitemporal_overlap");
    }
    const result = structuredClone(normalized.rule);
    this.#versions.set(normalized.rule.rule_id, [...existing, result]);
    this.#publicationRequests.set(normalized.idempotency_key, {
      commandCanonical,
      result,
    });
    return structuredClone(result);
  }

  list(ruleId: string): RewardRule[] {
    return structuredClone(this.#versions.get(ruleId) ?? []).sort(
      (left, right) => left.version - right.version,
    );
  }

  selectApproved(
    ruleId: string,
    transactionTime: string,
    knowledgeTime: string,
  ): RewardRule | null {
    return selectApprovedRule(
      this.#versions.get(ruleId) ?? [],
      ruleId,
      transactionTime,
      knowledgeTime,
    );
  }

  all(): RewardRule[] {
    return [...this.#versions.values()]
      .flatMap((items) => items.map((item) => structuredClone(item)))
      .sort(
        (left, right) =>
          left.rule_id.localeCompare(right.rule_id) ||
          left.version - right.version,
      );
  }
}

export function definitionHash(definition: unknown): string {
  return canonicalHash(definition);
}

function normalizeCommand(command: RuleStoreCommand): PublishRuleCommand {
  if ("rule" in command) return structuredClone(command);
  const rule = commandToSyntheticRule(command);
  return { idempotency_key: command.idempotencyKey, rule };
}

/** Adapter retained for prototype-compatible callers while the schema package is adopted. */
function commandToSyntheticRule(command: LegacyPublishRuleCommand): RewardRule {
  const validity: RuleValidity = {
    valid_from: command.validity.validFrom,
    valid_to: command.validity.validTo,
    timezone: "Asia/Tokyo",
    recorded_at: command.validity.recordedAt,
    superseded_at: command.validity.supersededAt,
  };
  const now = command.validity.recordedAt;
  const result: RewardRule = {
    rule_id: command.ruleId,
    version: command.version,
    status: command.status,
    rule_type: "base_reward",
    name: command.ruleId,
    subject: { entity_type: "merchant", entity_id: "synthetic" },
    scope: {
      countries: ["JP"],
      operation_types: ["merchant_purchase"],
      channels: ["in_store"],
    },
    eligibility: {
      operation_match: {},
      user_conditions: [],
      transaction_conditions: {},
      campaign_conditions: {},
    },
    caps: [],
    stacking: {
      stack_group: "synthetic",
      mode: "additive",
      precedence: 0,
      conflicts_with_rule_ids: [],
      requires_rule_ids: [],
    },
    validity,
    provenance: {
      evidence_ids: ["ev_synthetic"],
      minimum_source_tier: "T1_CANONICAL",
      confidence: 1,
      human_verified: true,
    },
    audit: {
      created_at: now,
      created_by: "legacy-adapter",
      review_events: [
        {
          mode: "solo_dual_pass",
          reviewer_id: "legacy-adapter",
          completed_at: now,
          decision: "approved",
          notes: "legacy adapter",
        },
      ],
      required_review_modes: ["solo_dual_pass"],
      review_mode: "solo_dual_pass",
      reviewed_at: now,
      reviewed_by: "legacy-adapter",
      change_reason: canonicalize(command.definition),
    },
  };
  return result;
}
