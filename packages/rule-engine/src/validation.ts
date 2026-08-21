import {
  amountFromUnits,
  decimal,
  decimalString,
  parseTime,
  unitsFromAmount,
} from "./math.js";
import type {
  AssetLot,
  AssetMovement,
  CapProgressState,
  PurchasePlan,
  Rejection,
  ReviewEvent,
  ReviewMode,
  RewardRule,
  UserState,
} from "./types.js";

export class SemanticValidationError extends Error {
  readonly code = "semantic_validation_failed";
  readonly errors: readonly ValidationIssue[];

  constructor(errors: ValidationIssue[] | ValidationIssue) {
    const list = Array.isArray(errors) ? errors : [errors];
    super(list.map((item) => `${item.path}:${item.code}`).join("; "));
    this.name = "SemanticValidationError";
    this.errors = list;
  }
}

export interface ValidationIssue {
  path: string;
  code: string;
  message: string;
}

function issue(path: string, code: string, message: string): ValidationIssue {
  return { path, code, message };
}

function assertNoIssues(issues: ValidationIssue[]): void {
  if (issues.length > 0) throw new SemanticValidationError(issues);
}

/**
 * Semantic validation for a candidate plan. Structural/lexical validation is
 * Public evaluation invokes the mandatory @jro/contracts boundary before
 * reaching these helpers; this module handles graph/accounting invariants.
 */
export function validatePurchasePlan(plan: PurchasePlan): void {
  const issues: ValidationIssue[] = [];
  if (!plan || typeof plan !== "object") {
    throw new SemanticValidationError(
      issue("$", "type", "plan must be an object"),
    );
  }
  if (typeof plan.plan_id !== "string" || !plan.plan_id.startsWith("plan_")) {
    issues.push(
      issue("/plan_id", "invalid_plan_id", "plan_id must use the plan_ prefix"),
    );
  }
  if (!Array.isArray(plan.operations) || plan.operations.length === 0) {
    issues.push(
      issue(
        "/operations",
        "operations_empty",
        "a plan requires at least one operation",
      ),
    );
    assertNoIssues(issues);
    return;
  }

  const operationIds = new Set<string>();
  const sequences = new Map<number, string>();
  const operationsById = new Map<string, PurchasePlan["operations"][number]>();
  const allInputIds = new Set<string>();
  const allOutputIds = new Set<string>();

  for (const [index, operation] of plan.operations.entries()) {
    const path = `/operations/${index}`;
    if (operationIds.has(operation.operation_id)) {
      issues.push(
        issue(
          `${path}/operation_id`,
          "duplicate_operation_id",
          "operation IDs must be unique",
        ),
      );
    }
    operationIds.add(operation.operation_id);
    operationsById.set(operation.operation_id, operation);
    if (sequences.has(operation.sequence)) {
      issues.push(
        issue(
          `${path}/sequence`,
          "duplicate_sequence",
          "operation sequence numbers must be unique",
        ),
      );
    }
    sequences.set(operation.sequence, operation.operation_id);
    try {
      const time = parseTime(operation.occurred_at);
      void time;
    } catch {
      issues.push(
        issue(
          `${path}/occurred_at`,
          "invalid_timestamp",
          "occurred_at must be a valid date-time",
        ),
      );
    }
    if (!Number.isInteger(operation.sequence) || operation.sequence < 1) {
      issues.push(
        issue(
          `${path}/sequence`,
          "invalid_sequence",
          "sequence must be a positive integer",
        ),
      );
    }
    if (
      operation.amount_jpy !== null &&
      (!Number.isSafeInteger(operation.amount_jpy) || operation.amount_jpy < 0)
    ) {
      issues.push(
        issue(
          `${path}/amount_jpy`,
          "invalid_amount",
          "JPY amounts must be safe non-negative integers",
        ),
      );
    }
    if (operation.operation_type === "merchant_purchase") {
      if (!operation.merchant_id)
        issues.push(
          issue(
            `${path}/merchant_id`,
            "merchant_required",
            "merchant purchase requires a merchant",
          ),
        );
      if (operation.amount_jpy === null)
        issues.push(
          issue(
            `${path}/amount_jpy`,
            "amount_required",
            "merchant purchase requires an amount",
          ),
        );
      if (operation.asset_inputs.length === 0)
        issues.push(
          issue(
            `${path}/asset_inputs`,
            "tender_required",
            "merchant purchase requires tender",
          ),
        );
      if (operation.output_requests.length !== 0)
        issues.push(
          issue(
            `${path}/output_requests`,
            "purchase_outputs_forbidden",
            "merchant purchase cannot request an output lot",
          ),
        );
      if (operation.line_items.length === 0)
        issues.push(
          issue(
            `${path}/line_items`,
            "line_items_required",
            "merchant purchase requires line items",
          ),
        );
    }
    for (const [lineIndex, line] of operation.line_items.entries()) {
      if (
        line.tax_exclusive_amount_jpy !== undefined &&
        line.tax_exclusive_amount_jpy !== null &&
        (!Number.isSafeInteger(line.tax_exclusive_amount_jpy) ||
          line.tax_exclusive_amount_jpy < 0 ||
          line.tax_exclusive_amount_jpy > line.amount_jpy)
      )
        issues.push(
          issue(
            `${path}/line_items/${lineIndex}/tax_exclusive_amount_jpy`,
            "invalid_tax_exclusive_amount",
            "tax-exclusive line amount must be a safe non-negative integer no greater than the line tender amount",
          ),
        );
    }
    if (
      operation.operation_type === "stored_value_top_up" ||
      operation.operation_type === "voucher_purchase"
    ) {
      if (operation.amount_jpy === null || operation.amount_jpy < 1)
        issues.push(
          issue(
            `${path}/amount_jpy`,
            "acquisition_amount_required",
            "acquisition requires a positive JPY amount",
          ),
        );
      if (operation.asset_inputs.length === 0)
        issues.push(
          issue(
            `${path}/asset_inputs`,
            "funding_required",
            "acquisition requires funding",
          ),
        );
      if (operation.output_requests.length === 0)
        issues.push(
          issue(
            `${path}/output_requests`,
            "output_required",
            "acquisition requires an output lot",
          ),
        );
    }
    for (const [inputIndex, input] of operation.asset_inputs.entries()) {
      if (allInputIds.has(input.input_id))
        issues.push(
          issue(
            `${path}/asset_inputs/${inputIndex}/input_id`,
            "duplicate_asset_input_id",
            "input IDs must be unique in a plan",
          ),
        );
      allInputIds.add(input.input_id);
      try {
        unitsFromAmount(
          input.quantity.amount,
          input.quantity.asset.scale,
          "exact",
        );
      } catch (error) {
        issues.push(
          issue(
            `${path}/asset_inputs/${inputIndex}/quantity/amount`,
            "invalid_quantity",
            error instanceof Error ? error.message : "invalid quantity",
          ),
        );
      }
      if (input.role === "external_funding" && input.source_lot_id !== null) {
        issues.push(
          issue(
            `${path}/asset_inputs/${inputIndex}/source_lot_id`,
            "external_funding_source_lot",
            "external funding cannot masquerade as a reusable lot",
          ),
        );
      }
      if (
        input.role !== "external_funding" &&
        input.role !== "other" &&
        input.source_lot_id === null
      ) {
        issues.push(
          issue(
            `${path}/asset_inputs/${inputIndex}/source_lot_id`,
            "asset_lot_required",
            "reusable asset tender requires a source lot",
          ),
        );
      }
    }
    for (const [outputIndex, output] of operation.output_requests.entries()) {
      if (allOutputIds.has(output.request_id))
        issues.push(
          issue(
            `${path}/output_requests/${outputIndex}/request_id`,
            "duplicate_output_request_id",
            "output request IDs must be unique in a plan",
          ),
        );
      if (allOutputIds.has(output.created_lot_id))
        issues.push(
          issue(
            `${path}/output_requests/${outputIndex}/created_lot_id`,
            "duplicate_output_lot_id",
            "created lot IDs must be unique in a plan",
          ),
        );
      allOutputIds.add(output.request_id);
      allOutputIds.add(output.created_lot_id);
      if (output.requested_amount !== null) {
        try {
          unitsFromAmount(output.requested_amount, output.asset.scale, "exact");
        } catch (error) {
          issues.push(
            issue(
              `${path}/output_requests/${outputIndex}/requested_amount`,
              "invalid_quantity",
              error instanceof Error ? error.message : "invalid quantity",
            ),
          );
        }
      }
    }
  }

  const sorted = [...plan.operations].sort(
    (left, right) => left.sequence - right.sequence,
  );
  const sortedTimes = sorted.map((operation) => {
    try {
      return parseTime(operation.occurred_at);
    } catch {
      return Number.NaN;
    }
  });
  for (let index = 1; index < sortedTimes.length; index += 1) {
    const previous = sortedTimes[index - 1];
    const current = sortedTimes[index];
    if (
      previous !== undefined &&
      current !== undefined &&
      Number.isFinite(previous) &&
      Number.isFinite(current) &&
      current < previous
    ) {
      issues.push(
        issue(
          `/operations/${index}/occurred_at`,
          "timestamp_backwards",
          "timestamps may not move backwards in sequence order",
        ),
      );
    }
  }
  for (const [index, dependency] of plan.dependencies.entries()) {
    const from = operationsById.get(dependency.from_operation_id);
    const to = operationsById.get(dependency.to_operation_id);
    if (!from || !to) {
      issues.push(
        issue(
          `/dependencies/${index}`,
          "dependency_missing",
          "dependency endpoints must reference operations",
        ),
      );
    } else if (from.sequence >= to.sequence) {
      issues.push(
        issue(
          `/dependencies/${index}`,
          "dependency_not_prior",
          "dependency source must be an earlier operation",
        ),
      );
    }
    if (dependency.from_operation_id === dependency.to_operation_id) {
      issues.push(
        issue(
          `/dependencies/${index}`,
          "dependency_self_reference",
          "an operation cannot depend on itself",
        ),
      );
    }
  }

  const calculatedFields = [
    "asset_movements",
    "movements",
    "reward_components",
    "rewards",
    "ending_asset_lots",
    "ending_lots",
    "economics",
    "objective_score_jpy",
    "winner",
    "runner_up",
    "native_ledger",
  ];
  for (const field of calculatedFields) {
    if (Object.hasOwn(plan as unknown as object, field)) {
      issues.push(
        issue(
          `/${field}`,
          "calculated_field_supplied",
          "candidate plans cannot supply engine-calculated output",
        ),
      );
    }
  }
  assertNoIssues(issues);
}

export const validatePlan = validatePurchasePlan;
export const validateOperationGraph = validatePurchasePlan;

export function validateUserState(userState: UserState): void {
  const issues: ValidationIssue[] = [];
  for (const [key, fact] of Object.entries(userState.facts)) {
    const path = `/facts/${key}`;
    if (fact.status === "known") {
      if (!Object.hasOwn(fact, "value") || !fact.observed_at)
        issues.push(
          issue(
            path,
            "known_fact_incomplete",
            "known facts require value and observed_at",
          ),
        );
      if (
        (fact.lower_bound !== null && fact.lower_bound !== undefined) ||
        (fact.upper_bound !== null && fact.upper_bound !== undefined)
      )
        issues.push(
          issue(
            path,
            "known_bounds_present",
            "known facts cannot carry estimated bounds",
          ),
        );
    }
    if (fact.status === "estimated") {
      if (
        fact.lower_bound === null ||
        fact.lower_bound === undefined ||
        fact.upper_bound === null ||
        fact.upper_bound === undefined
      ) {
        issues.push(
          issue(
            path,
            "estimated_bounds_missing",
            "estimated facts require lower and upper bounds",
          ),
        );
      } else {
        try {
          if (decimal(fact.lower_bound).gt(decimal(fact.upper_bound)))
            issues.push(
              issue(
                path,
                "estimated_lower_above_upper",
                "lower_bound must not exceed upper_bound",
              ),
            );
        } catch {
          issues.push(
            issue(
              path,
              "estimated_bounds_not_comparable",
              "estimated bounds must be numeric",
            ),
          );
        }
      }
      if (
        !fact.observed_at ||
        fact.confidence === null ||
        fact.confidence === undefined
      )
        issues.push(
          issue(
            path,
            "estimated_fact_incomplete",
            "estimated facts require confidence and observed_at",
          ),
        );
    }
    if (
      (fact.status === "unknown" || fact.status === "not_applicable") &&
      fact.confidence !== null &&
      fact.confidence !== undefined
    ) {
      issues.push(
        issue(
          `${path}/confidence`,
          "unknown_confidence_present",
          "unknown and not-applicable facts have null confidence",
        ),
      );
    }
  }
  for (const [key, progress] of Object.entries(userState.cap_progress))
    validateCapProgress(progress, `/cap_progress/${key}`, issues);
  assertNoIssues(issues);
}

export function validateCapProgress(
  progress: CapProgressState,
  path = "$",
  issues: ValidationIssue[] = [],
): void {
  const spendMin = progress.eligible_spend_jpy_min;
  const spendMax = progress.eligible_spend_jpy_max;
  if (
    spendMin !== null &&
    spendMin !== undefined &&
    spendMax !== null &&
    spendMax !== undefined &&
    spendMin > spendMax
  )
    issues.push(
      issue(
        path,
        "cap_spend_lower_above_upper",
        "eligible spend lower bound must not exceed upper bound",
      ),
    );
  const rewardMin = progress.reward_earned_units_min;
  const rewardMax = progress.reward_earned_units_max;
  if (
    rewardMin !== null &&
    rewardMin !== undefined &&
    rewardMax !== null &&
    rewardMax !== undefined
  ) {
    try {
      if (decimalString(rewardMin).gt(decimalString(rewardMax)))
        issues.push(
          issue(
            path,
            "cap_reward_lower_above_upper",
            "reward lower bound must not exceed upper bound",
          ),
        );
    } catch {
      issues.push(
        issue(
          path,
          "cap_reward_not_comparable",
          "reward bounds must be decimal strings",
        ),
      );
    }
  }
  if (progress.status === "known") {
    if (
      spendMin === null ||
      spendMin === undefined ||
      spendMax === null ||
      spendMax === undefined ||
      rewardMin === null ||
      rewardMin === undefined ||
      rewardMax === null ||
      rewardMax === undefined
    )
      issues.push(
        issue(
          path,
          "known_cap_progress_incomplete",
          "known cap progress requires all exact bounds",
        ),
      );
    if (spendMin !== spendMax)
      issues.push(
        issue(
          path,
          "known_cap_spend_unequal",
          "known cap progress requires equal spend bounds",
        ),
      );
    if (rewardMin !== rewardMax)
      issues.push(
        issue(
          path,
          "known_cap_reward_unequal",
          "known cap progress requires equal reward bounds",
        ),
      );
  }
  if (progress.period_start !== null && progress.period_end !== null) {
    try {
      if (parseTime(progress.period_start) >= parseTime(progress.period_end))
        issues.push(
          issue(
            path,
            "invalid_cap_period",
            "period_end must be after period_start",
          ),
        );
    } catch {
      issues.push(
        issue(
          path,
          "invalid_cap_period_timestamp",
          "cap period timestamps must be valid",
        ),
      );
    }
  }
}

export function validateRewardRule(rule: RewardRule): void {
  const issues: ValidationIssue[] = [];
  try {
    if (
      parseTime(rule.validity.valid_from) >=
      (rule.validity.valid_to
        ? parseTime(rule.validity.valid_to)
        : Number.POSITIVE_INFINITY)
    )
      issues.push(
        issue(
          "/validity",
          "invalid_economic_interval",
          "valid_to is exclusive and must be after valid_from",
        ),
      );
    if (
      parseTime(rule.validity.recorded_at) >=
      (rule.validity.superseded_at
        ? parseTime(rule.validity.superseded_at)
        : Number.POSITIVE_INFINITY)
    )
      issues.push(
        issue(
          "/validity",
          "invalid_system_interval",
          "superseded_at is exclusive and must be after recorded_at",
        ),
      );
  } catch {
    issues.push(
      issue(
        "/validity",
        "invalid_timestamp",
        "rule validity timestamps must be valid",
      ),
    );
  }
  if (rule.audit.required_review_modes.length === 0)
    issues.push(
      issue(
        "/audit/required_review_modes",
        "review_policy_empty",
        "at least one review mode is required",
      ),
    );
  if (
    rule.scope.tax_basis === "tax_exclusive" &&
    rule.eligibility.transaction_conditions.eligible_amount_basis !==
      "eligible_line_items"
  )
    issues.push(
      issue(
        "/eligibility/transaction_conditions/eligible_amount_basis",
        "tax_exclusive_basis_requires_eligible_line_items",
        "tax-exclusive rules must calculate from explicit eligible line-item amounts",
      ),
    );
  if (rule.status === "published") {
    try {
      assertReviewPolicy(
        rule.audit.required_review_modes,
        rule.audit.review_events,
      );
    } catch (error) {
      issues.push(
        issue(
          "/audit/review_events",
          "review_policy_incomplete",
          error instanceof Error ? error.message : "review policy incomplete",
        ),
      );
    }
  }
  if (
    rule.calculation?.model === "percentage" &&
    (!Number.isInteger(rule.calculation.rate_basis_points) ||
      rule.calculation.rate_basis_points < 0)
  )
    issues.push(
      issue(
        "/calculation/rate_basis_points",
        "invalid_rate",
        "percentage basis points must be a non-negative integer",
      ),
    );
  if (
    rule.calculation?.model === "points_per_unit" &&
    rule.calculation.spend_jpy < 1
  )
    issues.push(
      issue(
        "/calculation/spend_jpy",
        "invalid_denominator",
        "points denominator must be positive",
      ),
    );
  assertNoIssues(issues);
}

export function assertReviewPolicy(
  requiredModes: ReviewMode[],
  events: ReviewEvent[],
): void {
  if (requiredModes.length === 0) throw new Error("review_policy_empty");
  const completed = new Set(
    events
      .filter((event) => event.decision === "approved")
      .map((event) => event.mode),
  );
  const missing = requiredModes.filter((mode) => !completed.has(mode));
  if (missing.length > 0)
    throw new Error(`required_review_missing:${missing.join(",")}`);
}

function conservationBucket(
  assetId: string,
  rewardClass: string | null,
): string {
  return `${assetId}::${rewardClass ?? "<none>"}`;
}

/** Exact principal conservation, deliberately excluding external funding and reward components. */
export function validateConservation(
  openingLots: AssetLot[],
  movements: AssetMovement[],
  endingLots: AssetLot[],
): void {
  const balance = new Map<string, bigint>();
  const add = (key: string, value: bigint) =>
    balance.set(key, (balance.get(key) ?? 0n) + value);
  for (const lot of openingLots)
    add(
      conservationBucket(
        lot.quantity.asset.asset_id,
        lot.quantity.asset.reward_class,
      ),
      unitsFromAmount(lot.quantity.amount, lot.quantity.asset.scale),
    );
  for (const movement of movements) {
    if ((movement.direction as string) === "adjust")
      throw new Error("adjust_not_supported");
    if (
      movement.movement_role === "external_funding" ||
      (movement.movement_role === "fee" && movement.source_lot_id === null)
    )
      continue;
    const units = unitsFromAmount(
      movement.quantity.amount,
      movement.quantity.asset.scale,
    );
    const sign =
      movement.direction === "create" || movement.direction === "return"
        ? 1n
        : -1n;
    add(
      conservationBucket(
        movement.quantity.asset.asset_id,
        movement.quantity.asset.reward_class,
      ),
      sign * units,
    );
  }
  for (const lot of endingLots)
    add(
      conservationBucket(
        lot.quantity.asset.asset_id,
        lot.quantity.asset.reward_class,
      ),
      -unitsFromAmount(lot.quantity.amount, lot.quantity.asset.scale),
    );
  const mismatch = [...balance.entries()].find(([, units]) => units !== 0n);
  if (mismatch)
    throw new Error(`conservation_failed:${mismatch[0]}:${mismatch[1]}`);
}

/** Used by the engine to turn a semantic failure into a stable rejected reason. */
export function rejectionFromError(error: unknown): Rejection {
  const message = error instanceof Error ? error.message : String(error);
  return { code: "invalid_plan", message };
}

// Keep this helper exported for consumers that need to inspect a lot exactly.
export { amountFromUnits };
