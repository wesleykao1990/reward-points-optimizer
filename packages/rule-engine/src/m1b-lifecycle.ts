import type { DecimalInput } from "./m1b-calculations.js";
import {
  amountFromUnits,
  canonicalDecimal,
  decimal,
  decimalString,
  decimalToBigInt,
  power10,
  type RoundingMode,
} from "./math.js";
import type {
  AssetMovement,
  ClawbackPolicy,
  Expiry,
  Quantity,
  RewardComponent,
  Settlement,
} from "./types.js";

/** A lifecycle kernel emits instructions; it never edits a principal or
 * reward ledger in place. */
export type LifecycleKind = "refund" | "reversal" | "expiry" | "clawback";

export type LifecycleStatus =
  | "applied"
  | "no_op"
  | "not_due"
  | "conditional"
  | "rejected";

export interface LifecycleCondition {
  code: string;
  message: string;
}

export interface LifecycleRewardTarget {
  component_id?: string;
  quantity: Quantity;
  clawback?: ClawbackPolicy | null;
  settlement?: Settlement | null;
  expiry?: Expiry | null;
}

export interface LifecyclePrincipalInput {
  /** Actual principal quantity returned/reversed; callers must supply it. */
  principal_quantity?: Quantity | null;
  original_operation_id?: string | null;
}

export interface ClawbackInput {
  reward: LifecycleRewardTarget;
  policy?: ClawbackPolicy | null;
  trigger?: "refund" | "reversal" | "manual";
  refund_amount_jpy?: DecimalInput | null;
  original_amount_jpy?: DecimalInput | null;
  provider_defined_units?: DecimalInput | null;
  rounding_mode?: RoundingMode;
  original_operation_id?: string | null;
}

export interface RefundInput extends LifecyclePrincipalInput {
  reward?: LifecycleRewardTarget | null;
  refund_amount_jpy?: DecimalInput | null;
  original_amount_jpy?: DecimalInput | null;
  clawback?: ClawbackPolicy | null;
  provider_defined_units?: DecimalInput | null;
  rounding_mode?: RoundingMode;
  operation_id?: string;
}

export interface ReversalInput extends LifecyclePrincipalInput {
  reward?: LifecycleRewardTarget | null;
  clawback?: ClawbackPolicy | null;
  provider_defined_units?: DecimalInput | null;
  rounding_mode?: RoundingMode;
  operation_id?: string;
}

export interface ExpiryInput {
  reward: LifecycleRewardTarget;
  at?: string | null;
  operation_id?: string;
}

export interface PrincipalAdjustmentInstruction {
  instruction_id: string;
  kind: "refund" | "reversal";
  sign: "credit";
  direction: "return";
  movement_role: "refund" | "reversal";
  original_operation_id: string | null;
  quantity: Quantity;
}

export interface RewardDebitInstruction {
  instruction_id: string;
  kind: LifecycleKind;
  sign: "debit";
  source_component_id: string | null;
  quantity: Quantity;
  reason_code: string;
}

export interface ExpiryInstruction {
  instruction_id: string;
  kind: "expiry";
  sign: "debit";
  source_component_id: string | null;
  quantity: Quantity;
  expired_at: string;
}

export interface LifecycleAdjustmentResult {
  status: LifecycleStatus;
  kind: LifecycleKind;
  reason_code: string;
  conditions: LifecycleCondition[];
  principal_instruction: PrincipalAdjustmentInstruction | null;
  reward_instruction: RewardDebitInstruction | ExpiryInstruction | null;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function parseInput(
  value: DecimalInput,
  label: string,
): ReturnType<typeof decimalString> {
  try {
    if (typeof value === "string") return decimalString(value);
    if (typeof value === "bigint") {
      if (value < 0n) throw new Error("negative");
      return decimalString(value.toString());
    }
    if (!Number.isSafeInteger(value) || value < 0)
      throw new Error("not_a_safe_nonnegative_integer");
    return decimalString(value.toString());
  } catch (error) {
    throw new Error(
      `invalid_${label}:${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function parseOptional(
  value: DecimalInput | null | undefined,
  label: string,
): ReturnType<typeof decimalString> | null {
  return value === null || value === undefined
    ? null
    : parseInput(value, label);
}

function quantityUnits(quantity: Quantity): bigint {
  return decimalToBigInt(
    parseInput(quantity.amount, "reward_amount").mul(
      power10(quantity.asset.scale).toString(),
    ),
    "exact",
  );
}

function quantityFromUnits(quantity: Quantity, units: bigint): Quantity {
  if (units < 0n) throw new Error("negative_adjustment_units");
  return {
    asset: clone(quantity.asset),
    amount: amountFromUnits(units, quantity.asset.scale),
  };
}

function condition(code: string, message: string): LifecycleCondition[] {
  return [{ code, message }];
}

function result(
  kind: LifecycleKind,
  status: LifecycleStatus,
  reasonCode: string,
  conditions: LifecycleCondition[] = [],
  principalInstruction: PrincipalAdjustmentInstruction | null = null,
  rewardInstruction: RewardDebitInstruction | ExpiryInstruction | null = null,
): LifecycleAdjustmentResult {
  return {
    status,
    kind,
    reason_code: reasonCode,
    conditions,
    principal_instruction: principalInstruction,
    reward_instruction: rewardInstruction,
  };
}

function adjustmentId(
  kind: LifecycleKind,
  target: LifecycleRewardTarget,
  operationId?: string,
): string {
  return `${kind}:${operationId ?? "operation"}:${target.component_id ?? "component"}`;
}

function principalInstruction(
  kind: "refund" | "reversal",
  input: LifecyclePrincipalInput,
  operationId: string | undefined,
): PrincipalAdjustmentInstruction | null {
  const quantity = input.principal_quantity;
  if (quantity === null || quantity === undefined) return null;
  return {
    instruction_id: `${kind}:${operationId ?? "operation"}:principal`,
    kind,
    sign: "credit",
    direction: "return",
    movement_role: kind,
    original_operation_id: input.original_operation_id ?? null,
    quantity: clone(quantity),
  };
}

function rewardDebit(
  kind: LifecycleKind,
  target: LifecycleRewardTarget,
  units: bigint,
  reasonCode: string,
  operationId?: string,
): RewardDebitInstruction {
  return {
    instruction_id: adjustmentId(kind, target, operationId),
    kind,
    sign: "debit",
    source_component_id: target.component_id ?? null,
    quantity: quantityFromUnits(target.quantity, units),
    reason_code: reasonCode,
  };
}

function parsePolicy(input: ClawbackInput): ClawbackPolicy {
  return (
    input.policy ??
    input.reward.clawback ?? {
      on_refund: "unknown",
      posting_delay_days: null,
      notes: "",
    }
  );
}

function boundedRatio(
  refundAmount: ReturnType<typeof decimalString> | null,
  originalAmount: ReturnType<typeof decimalString> | null,
): ReturnType<typeof decimalString> | null {
  if (refundAmount === null || originalAmount === null) return null;
  if (originalAmount.lte(0))
    throw new Error("original_amount_must_be_positive");
  if (refundAmount.lt(0) || refundAmount.gt(originalAmount))
    throw new Error("refund_amount_out_of_bounds");
  return refundAmount.div(originalAmount);
}

/**
 * Calculate only the reward-side debit implied by a policy.  Proportional
 * clawback defaults to floor so it never debits more units than the refunded
 * share; callers can require a different, explicit rounding mode.
 */
export function calculateClawbackAdjustment(
  input: ClawbackInput,
): LifecycleAdjustmentResult {
  const kind = input.trigger === "reversal" ? "reversal" : "clawback";
  let earnedUnits: bigint;
  try {
    earnedUnits = quantityUnits(input.reward.quantity);
  } catch (error) {
    return result(
      kind,
      "rejected",
      "invalid_reward_quantity",
      condition(
        "invalid_reward_quantity",
        error instanceof Error ? error.message : String(error),
      ),
    );
  }
  const policy = parsePolicy(input);
  switch (policy.on_refund) {
    case "none":
      return result(kind, "no_op", "clawback_not_required");
    case "unknown":
      return result(
        kind,
        "conditional",
        "clawback_policy_unknown",
        condition(
          "clawback_policy_unknown",
          "provider clawback behavior is unknown",
        ),
      );
    case "provider_defined": {
      const providerUnits = parseOptional(
        input.provider_defined_units,
        "provider_defined_units",
      );
      if (providerUnits === null)
        return result(
          kind,
          "conditional",
          "provider_clawback_required",
          condition(
            "provider_clawback_required",
            "provider-defined debit quantity was not supplied",
          ),
        );
      try {
        const units = decimalToBigInt(
          providerUnits.mul(
            power10(input.reward.quantity.asset.scale).toString(),
          ),
          "exact",
        );
        if (units > earnedUnits)
          return result(
            kind,
            "rejected",
            "clawback_exceeds_earned",
            condition(
              "clawback_exceeds_earned",
              "provider-defined clawback exceeds earned units",
            ),
          );
        return result(
          kind,
          "applied",
          "provider_defined_clawback",
          [],
          null,
          rewardDebit(kind, input.reward, units, "provider_defined_clawback"),
        );
      } catch (error) {
        return result(
          kind,
          "rejected",
          "invalid_provider_clawback",
          condition(
            "invalid_provider_clawback",
            error instanceof Error ? error.message : String(error),
          ),
        );
      }
    }
    case "full":
      return result(
        kind,
        "applied",
        "full_clawback",
        [],
        null,
        rewardDebit(kind, input.reward, earnedUnits, "full_clawback"),
      );
    case "proportional": {
      try {
        const ratio = boundedRatio(
          parseOptional(input.refund_amount_jpy, "refund_amount_jpy"),
          parseOptional(input.original_amount_jpy, "original_amount_jpy"),
        );
        if (ratio === null)
          return result(
            kind,
            "conditional",
            "refund_amounts_required",
            condition(
              "refund_amounts_required",
              "proportional clawback requires refund and original amounts",
            ),
          );
        const units = decimalToBigInt(
          decimal(earnedUnits.toString()).mul(ratio),
          input.rounding_mode ?? "floor",
        );
        return result(
          kind,
          "applied",
          "proportional_clawback",
          [],
          null,
          rewardDebit(kind, input.reward, units, "proportional_clawback"),
        );
      } catch (error) {
        return result(
          kind,
          "rejected",
          "invalid_proportional_clawback",
          condition(
            "invalid_proportional_clawback",
            error instanceof Error ? error.message : String(error),
          ),
        );
      }
    }
  }
}

/** Refunds return an explicitly supplied principal quantity and, separately,
 * emit a debit for the reward share dictated by the clawback policy. */
export function calculateRefundAdjustment(
  input: RefundInput,
): LifecycleAdjustmentResult {
  const principal = principalInstruction("refund", input, input.operation_id);
  if (
    input.principal_quantity === null ||
    input.principal_quantity === undefined
  )
    return result(
      "refund",
      "rejected",
      "refund_principal_required",
      condition(
        "refund_principal_required",
        "refund requires an explicit principal quantity",
      ),
    );
  if (input.reward === null || input.reward === undefined)
    return result(
      "refund",
      "conditional",
      "refund_reward_component_unknown",
      condition(
        "refund_reward_component_unknown",
        "principal refund is explicit but no reward component was supplied",
      ),
      principal,
    );
  const clawback = calculateClawbackAdjustment({
    reward: input.reward,
    policy: input.clawback ?? null,
    trigger: "refund",
    refund_amount_jpy: input.refund_amount_jpy ?? null,
    original_amount_jpy: input.original_amount_jpy ?? null,
    provider_defined_units: input.provider_defined_units ?? null,
    rounding_mode: input.rounding_mode ?? "floor",
    original_operation_id: input.original_operation_id ?? null,
  });
  return result(
    "refund",
    clawback.status,
    clawback.reason_code,
    clawback.conditions,
    principal,
    clawback.reward_instruction,
  );
}

/** Reversals are full corrections by default; an explicit policy may instead
 * request proportional or provider-defined treatment. */
export function calculateReversalAdjustment(
  input: ReversalInput,
): LifecycleAdjustmentResult {
  const principal = principalInstruction("reversal", input, input.operation_id);
  if (
    input.principal_quantity === null ||
    input.principal_quantity === undefined
  )
    return result(
      "reversal",
      "rejected",
      "reversal_principal_required",
      condition(
        "reversal_principal_required",
        "reversal requires an explicit principal quantity",
      ),
    );
  if (input.reward === null || input.reward === undefined)
    return result(
      "reversal",
      "conditional",
      "reversal_reward_component_unknown",
      condition(
        "reversal_reward_component_unknown",
        "principal reversal is explicit but no reward component was supplied",
      ),
      principal,
    );
  const clawback = calculateClawbackAdjustment({
    reward: input.reward,
    policy: input.clawback ?? {
      on_refund: "full",
      posting_delay_days: null,
      notes: "reversal defaults to full correction",
    },
    trigger: "reversal",
    provider_defined_units: input.provider_defined_units ?? null,
    rounding_mode: input.rounding_mode ?? "floor",
    original_operation_id: input.original_operation_id ?? null,
  });
  return result(
    "reversal",
    clawback.status,
    clawback.reason_code,
    clawback.conditions,
    principal,
    clawback.reward_instruction,
  );
}

function expiryDue(
  target: LifecycleRewardTarget,
  at: string,
): {
  status: "due" | "not_due" | "conditional";
  expiresAt?: string;
  reasonCode: string;
} {
  const expiry = target.expiry;
  if (expiry === null || expiry === undefined)
    return { status: "conditional", reasonCode: "expiry_metadata_unknown" };
  switch (expiry.policy) {
    case "none":
      return { status: "not_due", reasonCode: "no_expiry" };
    case "fixed_date": {
      if (expiry.expires_at === null)
        return { status: "conditional", reasonCode: "expiry_date_unknown" };
      const atTime = Date.parse(at);
      const expiryTime = Date.parse(expiry.expires_at);
      if (!Number.isFinite(atTime) || !Number.isFinite(expiryTime))
        return {
          status: "conditional",
          reasonCode: "invalid_expiry_timestamp",
        };
      return atTime >= expiryTime
        ? {
            status: "due",
            expiresAt: expiry.expires_at,
            reasonCode: "reward_expired",
          }
        : {
            status: "not_due",
            expiresAt: expiry.expires_at,
            reasonCode: "expiry_not_reached",
          };
    }
    case "relative_to_posting": {
      const posting = target.settlement?.posted_at ?? null;
      if (posting === null || expiry.duration_days === null)
        return {
          status: "conditional",
          reasonCode: "posting_time_required_for_expiry",
        };
      const postingTime = Date.parse(posting);
      const atTime = Date.parse(at);
      if (!Number.isFinite(postingTime) || !Number.isFinite(atTime))
        return {
          status: "conditional",
          reasonCode: "invalid_expiry_timestamp",
        };
      const expiresAt = new Date(
        postingTime + expiry.duration_days * 86_400_000,
      ).toISOString();
      return atTime >= Date.parse(expiresAt)
        ? { status: "due", expiresAt, reasonCode: "reward_expired" }
        : { status: "not_due", expiresAt, reasonCode: "expiry_not_reached" };
    }
    case "provider_defined":
    case "unknown":
      return { status: "conditional", reasonCode: "provider_expiry_unknown" };
  }
}

/** Expiry emits a debit only once the explicit expiry boundary is reached. */
export function calculateExpiryAdjustment(
  input: ExpiryInput,
): LifecycleAdjustmentResult {
  const at = input.at;
  if (at === null || at === undefined)
    return result(
      "expiry",
      "conditional",
      "expiry_time_required",
      condition(
        "expiry_time_required",
        "expiry evaluation requires an explicit evaluation timestamp",
      ),
    );
  let due: ReturnType<typeof expiryDue>;
  try {
    due = expiryDue(input.reward, at);
  } catch (error) {
    return result(
      "expiry",
      "conditional",
      "invalid_expiry_metadata",
      condition(
        "invalid_expiry_metadata",
        error instanceof Error ? error.message : String(error),
      ),
    );
  }
  if (due.status === "conditional")
    return result(
      "expiry",
      "conditional",
      due.reasonCode,
      condition(
        due.reasonCode,
        "expiry boundary depends on unknown provider or posting state",
      ),
    );
  if (due.status === "not_due")
    return result("expiry", "not_due", due.reasonCode);
  try {
    const units = quantityUnits(input.reward.quantity);
    const instruction: ExpiryInstruction = {
      instruction_id: adjustmentId("expiry", input.reward, input.operation_id),
      kind: "expiry",
      sign: "debit",
      source_component_id: input.reward.component_id ?? null,
      quantity: quantityFromUnits(input.reward.quantity, units),
      expired_at: due.expiresAt ?? at,
    };
    return result("expiry", "applied", due.reasonCode, [], null, instruction);
  } catch (error) {
    return result(
      "expiry",
      "rejected",
      "invalid_reward_quantity",
      condition(
        "invalid_reward_quantity",
        error instanceof Error ? error.message : String(error),
      ),
    );
  }
}

/** Structural adapter for existing RewardComponent objects. */
export function lifecycleTargetFromRewardComponent(
  component: RewardComponent,
): LifecycleRewardTarget {
  return {
    component_id: component.component_id,
    quantity: clone(component.quantity),
    clawback: clone(component.clawback),
    settlement: clone(component.settlement),
    expiry: clone(component.expiry),
  };
}

/** Alias names make the lifecycle contract easy to discover from adapters. */
export const applyRefund = calculateRefundAdjustment;
export const applyReversal = calculateReversalAdjustment;
export const applyExpiry = calculateExpiryAdjustment;
export const applyClawback = calculateClawbackAdjustment;

/**
 * AssetMovement-shaped metadata for an adapter that needs to append the
 * principal instruction to the native movement ledger.  The returned object
 * is a new value and does not mutate the input instruction.
 */
export function principalInstructionAsMovement(
  instruction: PrincipalAdjustmentInstruction,
  movementId: string,
  operationId: string,
): AssetMovement {
  return {
    movement_id: movementId,
    operation_id: operationId,
    direction: instruction.direction,
    movement_role: instruction.movement_role,
    quantity: clone(instruction.quantity),
    source_lot_id: null,
    destination_lot_id: null,
    notes: `lifecycle:${instruction.kind}:original:${instruction.original_operation_id ?? "unknown"}`,
  };
}
