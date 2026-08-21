import {
  type DecimalInput,
  evaluateTransfer,
  type TransferCalculationInput,
  type TransferCalculationResult,
  type TransferCalculationSpec,
} from "./m1b-calculations.js";
import {
  calculateExpiryAdjustment,
  type ExpiryInput,
  type LifecycleAdjustmentResult,
  type LifecycleRewardTarget,
} from "./m1b-lifecycle.js";
import type { Settlement } from "./types.js";

/**
 * M1B lifecycle events intentionally live outside PurchasePlan.operation_type.
 * They describe a correction or state transition evaluated after a plan, not
 * a new principal operation that a candidate may use to manufacture value.
 */
export interface TransferCancellationEvent {
  event_kind: "transfer_cancellation";
  calculation: TransferCalculationSpec;
  /** The original transfer amount is required even when evaluating only its cancellation. */
  source_amount: DecimalInput;
  period_source_used?: DecimalInput | null;
  visited_asset_ids?: readonly string[];
  cycle_path_asset_ids?: readonly string[];
  /** Either field is an explicit posting-state fact.  Omission is unknown. */
  posting?: Settlement | null;
  posted?: boolean;
}

export interface RewardExpiryEvent {
  event_kind: "reward_expiry";
  reward: LifecycleRewardTarget;
  /** Expiry is evaluated at this explicit timestamp; omission is unknown. */
  at?: string | null;
  operation_id?: string;
}

export type M1BEvent = TransferCancellationEvent | RewardExpiryEvent;

export interface TransferCancellationEventResult {
  event_kind: "transfer_cancellation";
  status: TransferCalculationResult["status"];
  reason_code: string | null;
  transfer: TransferCalculationResult;
}

export interface RewardExpiryEventResult {
  event_kind: "reward_expiry";
  status: LifecycleAdjustmentResult["status"];
  reason_code: string;
  adjustment: LifecycleAdjustmentResult;
}

export type M1BEventResult =
  | TransferCancellationEventResult
  | RewardExpiryEventResult;

function transferInputForCancellation(
  event: TransferCancellationEvent,
): TransferCalculationInput {
  const input: TransferCalculationInput = {
    source_amount: event.source_amount,
    cancel_requested: true,
  };
  if (event.period_source_used !== undefined)
    input.period_source_used = event.period_source_used;
  if (event.visited_asset_ids !== undefined)
    input.visited_asset_ids = event.visited_asset_ids;
  if (event.cycle_path_asset_ids !== undefined)
    input.cycle_path_asset_ids = event.cycle_path_asset_ids;
  if (event.posted !== undefined) input.posted = event.posted;

  // null and status=unknown are unknown facts, not evidence of a pending
  // transfer.  Leave them omitted so evaluateTransfer returns its explicit
  // posting_state_required conditional result.
  if (
    event.posting !== undefined &&
    event.posting !== null &&
    event.posting.status !== "unknown"
  )
    input.posting = event.posting;
  return input;
}

/** Evaluate cancellation while preserving the underlying transfer result. */
export function evaluateTransferCancellationEvent(
  event: TransferCancellationEvent,
): TransferCancellationEventResult {
  const transfer = evaluateTransfer(
    event.calculation,
    transferInputForCancellation(event),
  );
  return {
    event_kind: event.event_kind,
    status: transfer.status,
    reason_code: transfer.reason_code,
    transfer,
  };
}

/** Evaluate reward expiry without appending an expiry to the native ledger. */
export function evaluateRewardExpiryEvent(
  event: RewardExpiryEvent,
): RewardExpiryEventResult {
  const input: ExpiryInput = {
    reward: event.reward,
  };
  if (event.at !== undefined) input.at = event.at;
  if (event.operation_id !== undefined) input.operation_id = event.operation_id;
  const adjustment = calculateExpiryAdjustment(input);
  return {
    event_kind: event.event_kind,
    status: adjustment.status,
    reason_code: adjustment.reason_code,
    adjustment,
  };
}

/** Single public facade for the two non-PurchasePlan M1B event families. */
export function evaluateM1BEvent(event: M1BEvent): M1BEventResult {
  switch (event.event_kind) {
    case "transfer_cancellation":
      return evaluateTransferCancellationEvent(event);
    case "reward_expiry":
      return evaluateRewardExpiryEvent(event);
  }
}

export const evaluateLifecycleEvent = evaluateM1BEvent;
