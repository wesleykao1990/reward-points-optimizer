import { brandEnvelope, hasEnvelopeBrand } from "./brand.js";
import { deepFreeze } from "./security.js";
import type {
  ProvisionalRuleEnvelope,
  ProvisionalRuleStatus,
  ProvisionalTransition,
  Sha256,
  TransitionFailure,
  TransitionResult,
} from "./types.js";

export function transitionFailure(
  code: TransitionFailure["code"],
  message: string,
): TransitionFailure {
  return Object.freeze({ ok: false as const, code, message });
}

export function validProvisionalTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(
      value,
    ) &&
    Number.isFinite(Date.parse(value))
  );
}

function validReason(value: string): boolean {
  return value.length > 0 && value.length <= 160 && !/[\r\n]/u.test(value);
}

export function provisionalTimeRegresses(
  envelope: ProvisionalRuleEnvelope,
  occurred_at: string,
): boolean {
  const lastTransition = envelope.history.at(-1)?.occurred_at;
  const lastCorrection = envelope.corrections.at(-1)?.reported_at;
  const previous = [lastTransition, lastCorrection]
    .filter((value): value is string => value !== undefined)
    .map((value) => Date.parse(value))
    .reduce((max, value) => Math.max(max, value), Number.NEGATIVE_INFINITY);
  return Date.parse(occurred_at) < previous;
}

export function transitionEnvelope(
  envelope: ProvisionalRuleEnvelope,
  status: ProvisionalRuleStatus,
  occurred_at: string,
  reason: string,
  correction_hash?: Sha256,
): ProvisionalRuleEnvelope {
  if (!hasEnvelopeBrand(envelope)) throw new TypeError("envelope_invalid");
  const record: ProvisionalTransition = {
    sequence: envelope.history.length,
    from_status: envelope.status,
    to_status: status,
    occurred_at,
    reason,
    candidate_hash: envelope.candidate_hash,
    ...(correction_hash === undefined ? {} : { correction_hash }),
  };
  return brandEnvelope(
    deepFreeze({
      ...envelope,
      status,
      history: [...envelope.history, record],
      corrections: [...envelope.corrections],
    }),
  );
}

/** Activate only a machine-checked envelope for experimental evaluation. */
export function activateExperimental(
  envelope: ProvisionalRuleEnvelope,
  occurred_at: string,
  reason = "explicit_experimental_activation",
): TransitionResult {
  if (!hasEnvelopeBrand(envelope))
    return transitionFailure(
      "envelope_invalid",
      "envelope was not minted by provisional admission",
    );
  if (!validProvisionalTimestamp(occurred_at))
    return transitionFailure(
      "timestamp_invalid",
      "activation timestamp is invalid",
    );
  if (provisionalTimeRegresses(envelope, occurred_at))
    return transitionFailure(
      "transition_time_regression",
      "activation timestamp precedes envelope history",
    );
  if (
    envelope.candidate.source_authority_role !== "primary" ||
    envelope.observation.source_authority_claim !== "primary"
  )
    return transitionFailure(
      "source_authority_required_for_activation",
      "only a primary observation authority may activate experimentally",
    );
  if (!validReason(reason))
    return transitionFailure("reason_invalid", "activation reason is invalid");
  if (envelope.status !== "machine_checked")
    return transitionFailure(
      "activation_not_allowed",
      "only machine_checked provisional candidates may become active_experimental",
    );
  const next = transitionEnvelope(
    envelope,
    "active_experimental",
    occurred_at,
    reason,
  );
  return Object.freeze({ ok: true as const, envelope: next });
}
