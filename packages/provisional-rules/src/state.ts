import { admitProvisionalRuleCandidate } from "./admission.js";
import { brandEnvelope, hasEnvelopeBrand } from "./brand.js";
import { hashCanonical } from "./canonical.js";
import { deepFreeze, scanPublicValue } from "./security.js";
import type {
  CorrectionResult,
  CorrectionSignalInput,
  CorrectionSignalRecord,
  ProvisionalAdmissionResult,
  ProvisionalCorrectionCategory,
  ProvisionalRuleAdmissionRequest,
  ProvisionalRuleEnvelope,
  ProvisionalRuleStatus,
  ProvisionalRuleStore,
  ProvisionalTransition,
  SelectionOptions,
  Sha256,
  TransitionFailure,
  TransitionResult,
} from "./types.js";
import {
  CORRECTION_CATEGORIES,
  PROVISIONAL_CORRECTION_VERSION,
  SEVERE_CORRECTION_CATEGORIES,
} from "./types.js";

const CORRECTION_KEYS = new Set([
  "version",
  "signal_id",
  "candidate_hash",
  "category",
  "credible",
  "reported_at",
  "severity",
]);
const CATEGORIES = new Set<string>([
  ...CORRECTION_CATEGORIES,
  ...SEVERE_CORRECTION_CATEGORIES,
]);
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const SIGNAL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

function failure(
  code: TransitionFailure["code"],
  message: string,
): TransitionFailure {
  return Object.freeze({ ok: false as const, code, message });
}

function validTimestamp(value: unknown): value is string {
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

function timeRegresses(
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

function transition(
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

function appendCorrection(
  envelope: ProvisionalRuleEnvelope,
  signal: CorrectionSignalRecord,
): ProvisionalRuleEnvelope {
  if (!hasEnvelopeBrand(envelope)) throw new TypeError("envelope_invalid");
  return brandEnvelope(
    deepFreeze({
      ...envelope,
      corrections: [...envelope.corrections, signal],
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
    return failure(
      "envelope_invalid",
      "envelope was not minted by provisional admission",
    );
  if (!validTimestamp(occurred_at))
    return failure("timestamp_invalid", "activation timestamp is invalid");
  if (timeRegresses(envelope, occurred_at))
    return failure(
      "transition_time_regression",
      "activation timestamp precedes envelope history",
    );
  if (
    envelope.candidate.source_authority_role !== "primary" ||
    envelope.observation.source_authority_claim !== "primary"
  )
    return failure(
      "source_authority_required_for_activation",
      "only a primary observation authority may activate experimentally",
    );
  if (!validReason(reason))
    return failure("reason_invalid", "activation reason is invalid");
  if (envelope.status !== "machine_checked")
    return failure(
      "activation_not_allowed",
      "only machine_checked provisional candidates may become active_experimental",
    );
  const next = transition(envelope, "active_experimental", occurred_at, reason);
  return Object.freeze({ ok: true as const, envelope: next });
}

function parseCorrection(value: unknown): {
  signal: CorrectionSignalInput | null;
  code?: TransitionFailure["code"];
  message?: string;
} {
  const scan = scanPublicValue(value);
  if (!scan.valid)
    return {
      signal: null,
      code: "correction_invalid",
      message: "correction signal representation is invalid",
    };
  if (
    !scan.value ||
    typeof scan.value !== "object" ||
    Array.isArray(scan.value)
  )
    return {
      signal: null,
      code: "correction_invalid",
      message: "correction signal must be an object",
    };
  const record = scan.value as Record<string, unknown>;
  const unknown = Object.keys(record).find((key) => !CORRECTION_KEYS.has(key));
  if (unknown)
    return {
      signal: null,
      code: "correction_invalid",
      message: `unknown correction field ${unknown}`,
    };
  if (record.version !== PROVISIONAL_CORRECTION_VERSION)
    return {
      signal: null,
      code: "correction_invalid",
      message: "unsupported correction version",
    };
  if (
    typeof record.signal_id !== "string" ||
    !SIGNAL_ID_PATTERN.test(record.signal_id)
  )
    return {
      signal: null,
      code: "correction_invalid",
      message: "invalid correction signal_id",
    };
  if (
    typeof record.candidate_hash !== "string" ||
    !HASH_PATTERN.test(record.candidate_hash)
  )
    return {
      signal: null,
      code: "correction_invalid",
      message: "invalid candidate_hash",
    };
  if (typeof record.category !== "string" || !CATEGORIES.has(record.category))
    return {
      signal: null,
      code: "correction_invalid",
      message: "invalid correction category",
    };
  if (typeof record.credible !== "boolean")
    return {
      signal: null,
      code: "correction_invalid",
      message: "credible must be boolean",
    };
  if (!validTimestamp(record.reported_at))
    return {
      signal: null,
      code: "correction_invalid",
      message: "reported_at must be an ISO date-time",
    };
  if (
    record.severity !== undefined &&
    record.severity !== "normal" &&
    record.severity !== "severe"
  )
    return {
      signal: null,
      code: "correction_invalid",
      message: "invalid correction severity",
    };
  return {
    signal: {
      version: PROVISIONAL_CORRECTION_VERSION,
      signal_id: record.signal_id,
      candidate_hash: record.candidate_hash as Sha256,
      category: record.category as ProvisionalCorrectionCategory,
      credible: record.credible,
      reported_at: record.reported_at,
      ...(record.severity === undefined ? {} : { severity: record.severity }),
    },
  };
}

function correctionHash(signal: CorrectionSignalInput): Sha256 {
  return hashCanonical(signal);
}

function severe(signal: CorrectionSignalInput): boolean {
  return (
    signal.severity === "severe" ||
    signal.category === "security_mismatch" ||
    signal.category === "source_mismatch"
  );
}

/**
 * Append one immutable correction signal and apply only the bounded dispute /
 * quarantine transitions.  A signal cannot create a candidate or change the
 * RewardRule body.
 */
export function recordCorrectionSignal(
  envelope: ProvisionalRuleEnvelope,
  value: unknown,
): CorrectionResult {
  if (!hasEnvelopeBrand(envelope))
    return failure(
      "envelope_invalid",
      "envelope was not minted by provisional admission",
    );
  const parsed = parseCorrection(value);
  if (!parsed.signal)
    return failure(
      parsed.code ?? "correction_invalid",
      parsed.message ?? "invalid correction signal",
    );
  const signal = parsed.signal;
  if (signal.candidate_hash !== envelope.candidate_hash)
    return failure(
      "candidate_hash_mismatch",
      "correction is not bound to this candidate hash",
    );
  const existing = envelope.corrections.find(
    (item) => item.signal_id === signal.signal_id,
  );
  if (existing) {
    const incomingHash = correctionHash(signal);
    const existingHash = existing.signal_hash;
    return failure(
      incomingHash === existingHash
        ? "duplicate_correction"
        : "tampered_correction",
      incomingHash === existingHash
        ? "correction signal was already recorded"
        : "correction signal ID was reused with different content",
    );
  }
  if (timeRegresses(envelope, signal.reported_at))
    return failure(
      "transition_time_regression",
      "correction timestamp precedes envelope history",
    );
  const signal_hash = correctionHash(signal);
  const record: CorrectionSignalRecord = deepFreeze({ ...signal, signal_hash });
  let next = appendCorrection(envelope, record);
  let disposition: "recorded" | "disputed" | "quarantined" = "recorded";
  if (signal.credible) {
    if (severe(signal)) {
      if (next.status !== "quarantined") {
        next = transition(
          next,
          "quarantined",
          signal.reported_at,
          "severe_correction_signal",
          signal_hash,
        );
      }
      disposition = "quarantined";
    } else if (
      next.status === "active_experimental" ||
      next.status === "machine_checked"
    ) {
      next = transition(
        next,
        "disputed",
        signal.reported_at,
        `credible_correction:${signal.category}`,
        signal_hash,
      );
      disposition = "disputed";
    }
  }
  return Object.freeze({
    ok: true as const,
    envelope: next,
    signal: record,
    disposition,
  });
}

function selectable(
  envelope: ProvisionalRuleEnvelope,
  options: SelectionOptions,
): boolean {
  if (envelope.status === "disputed" || envelope.status === "quarantined")
    return false;
  if (envelope.candidate.source_authority_role !== "primary") return false;
  if (
    envelope.status !== "active_experimental" &&
    !options.include_machine_checked
  )
    return false;
  if (
    options.p0_family_id !== undefined &&
    envelope.candidate.p0_family_id !== options.p0_family_id
  )
    return false;
  return true;
}

export function selectProvisionalRules(
  envelopes: readonly ProvisionalRuleEnvelope[],
  options: SelectionOptions = {},
): readonly ProvisionalRuleEnvelope[] {
  return Object.freeze(
    [...envelopes]
      .filter((envelope) => hasEnvelopeBrand(envelope))
      .filter((envelope) => selectable(envelope, options))
      .sort((left, right) =>
        left.candidate_hash.localeCompare(right.candidate_hash),
      ),
  );
}

/** A small in-memory append-only state owner for experimental prototypes. */
export function createProvisionalRuleStore(): ProvisionalRuleStore {
  const envelopes = new Map<Sha256, ProvisionalRuleEnvelope>();
  const signalHashes = new Map<string, Sha256>();

  const store: ProvisionalRuleStore = {
    admit(
      request: ProvisionalRuleAdmissionRequest,
    ): ProvisionalAdmissionResult {
      const result = admitProvisionalRuleCandidate(request);
      if (result.ok) {
        const existing = envelopes.get(result.candidate_hash);
        if (!existing) envelopes.set(result.candidate_hash, result.envelope);
      }
      return result;
    },
    activate(candidate_hash, occurred_at, reason) {
      const current = envelopes.get(candidate_hash);
      if (!current)
        return failure(
          "candidate_not_found",
          "candidate hash is not in the store",
        );
      const result = activateExperimental(current, occurred_at, reason);
      if (result.ok) envelopes.set(candidate_hash, result.envelope);
      return result;
    },
    reportCorrection(value) {
      const parsed = parseCorrection(value);
      if (!parsed.signal)
        return failure(
          parsed.code ?? "correction_invalid",
          parsed.message ?? "invalid correction signal",
        );
      const existingSignalHash = signalHashes.get(parsed.signal.signal_id);
      const incomingHash = correctionHash(parsed.signal);
      if (
        existingSignalHash !== undefined &&
        existingSignalHash !== incomingHash
      )
        return failure(
          "tampered_correction",
          "correction signal ID was reused with different content",
        );
      const current = envelopes.get(parsed.signal.candidate_hash);
      if (!current)
        return failure(
          "candidate_not_found",
          "candidate hash is not in the store",
        );
      const result = recordCorrectionSignal(current, parsed.signal);
      if (result.ok) {
        signalHashes.set(parsed.signal.signal_id, result.signal.signal_hash);
        envelopes.set(parsed.signal.candidate_hash, result.envelope);
      }
      return result;
    },
    get(candidate_hash) {
      return envelopes.get(candidate_hash) ?? null;
    },
    select(options = {}) {
      return selectProvisionalRules([...envelopes.values()], options);
    },
    snapshot() {
      return Object.freeze(
        [...envelopes.values()].sort((left, right) =>
          left.candidate_hash.localeCompare(right.candidate_hash),
        ),
      );
    },
  };
  return Object.freeze(store);
}

export const activateExperimentalRule = activateExperimental;
export const applyCorrectionSignal = recordCorrectionSignal;
