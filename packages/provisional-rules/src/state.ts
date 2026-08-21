import { admitProvisionalRuleCandidate } from "./admission.js";
import {
  hasPublicationBatchBrand,
  preflightProvisionalPublicationBatch,
} from "./batch.js";
import { brandEnvelope, hasEnvelopeBrand } from "./brand.js";
import { hashCanonical } from "./canonical.js";
import {
  activateExperimental,
  provisionalTimeRegresses,
  transitionEnvelope,
  transitionFailure,
  validProvisionalTimestamp,
} from "./lifecycle.js";
import { deepFreeze, scanPublicValue } from "./security.js";
import type {
  CorrectionResult,
  CorrectionSignalInput,
  CorrectionSignalRecord,
  ProvisionalAdmissionResult,
  ProvisionalCorrectionCategory,
  ProvisionalPublicationBatchResult,
  ProvisionalRuleAdmissionRequest,
  ProvisionalRuleEnvelope,
  ProvisionalRuleStore,
  SelectionOptions,
  Sha256,
  TransitionFailure,
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
  if (!validProvisionalTimestamp(record.reported_at))
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
    return transitionFailure(
      "envelope_invalid",
      "envelope was not minted by provisional admission",
    );
  const parsed = parseCorrection(value);
  if (!parsed.signal)
    return transitionFailure(
      parsed.code ?? "correction_invalid",
      parsed.message ?? "invalid correction signal",
    );
  const signal = parsed.signal;
  if (signal.candidate_hash !== envelope.candidate_hash)
    return transitionFailure(
      "candidate_hash_mismatch",
      "correction is not bound to this candidate hash",
    );
  const existing = envelope.corrections.find(
    (item) => item.signal_id === signal.signal_id,
  );
  if (existing) {
    const incomingHash = correctionHash(signal);
    const existingHash = existing.signal_hash;
    return transitionFailure(
      incomingHash === existingHash
        ? "duplicate_correction"
        : "tampered_correction",
      incomingHash === existingHash
        ? "correction signal was already recorded"
        : "correction signal ID was reused with different content",
    );
  }
  if (provisionalTimeRegresses(envelope, signal.reported_at))
    return transitionFailure(
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
        next = transitionEnvelope(
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
      next = transitionEnvelope(
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
  const publicationBatches = new Map<
    string,
    import("./types.js").ProvisionalPublicationBatch
  >();

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
        return transitionFailure(
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
        return transitionFailure(
          parsed.code ?? "correction_invalid",
          parsed.message ?? "invalid correction signal",
        );
      const existingSignalHash = signalHashes.get(parsed.signal.signal_id);
      const incomingHash = correctionHash(parsed.signal);
      if (
        existingSignalHash !== undefined &&
        existingSignalHash !== incomingHash
      )
        return transitionFailure(
          "tampered_correction",
          "correction signal ID was reused with different content",
        );
      const current = envelopes.get(parsed.signal.candidate_hash);
      if (!current)
        return transitionFailure(
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
    publishBatch(request): ProvisionalPublicationBatchResult {
      const preflight = preflightProvisionalPublicationBatch(request);
      if (!preflight.ok) return preflight;
      const batch = preflight.batch;
      if (!hasPublicationBatchBrand(batch))
        return Object.freeze({
          ok: false as const,
          issues: Object.freeze([
            {
              code: "batch_identity_mismatch" as const,
              path: "",
              message: "publication batch was not minted by this process",
            },
          ]),
        });

      const existingBatch = publicationBatches.get(batch.batch_id);
      if (existingBatch) {
        if (existingBatch.batch_hash !== batch.batch_hash)
          return Object.freeze({
            ok: false as const,
            issues: Object.freeze([
              {
                code: "batch_identity_mismatch" as const,
                path: "/batch_id",
                message:
                  "batch_id was already used with different publication content",
              },
            ]),
          });
        // A correction may have replaced an envelope after its batch was
        // published. Replaying the batch must never resurrect that candidate.
        for (const member of existingBatch.published) {
          const current = envelopes.get(member.candidate_hash);
          if (
            current !== member.envelope ||
            current.status !== "active_experimental"
          )
            return Object.freeze({
              ok: false as const,
              issues: Object.freeze([
                {
                  code: "candidate_already_present" as const,
                  path: `/published/${member.candidate_hash}`,
                  message:
                    "exact batch replay is no longer active after a correction",
                  candidate_hash: member.candidate_hash,
                },
              ]),
            });
        }
        return Object.freeze({ ok: true as const, batch: existingBatch });
      }

      // All preflight and activation checks completed above. Check existing
      // candidate identities once more before the first mutation, then commit
      // every envelope as one synchronous map transaction.
      const existingPublicationIds = new Set(
        [...publicationBatches.values()].flatMap((existing) =>
          existing.published.map(
            (member) =>
              member.envelope.candidate.candidate_id ?? member.member_id,
          ),
        ),
      );
      for (const member of batch.published) {
        const publicationId =
          member.envelope.candidate.candidate_id ?? member.member_id;
        if (existingPublicationIds.has(publicationId))
          return Object.freeze({
            ok: false as const,
            issues: Object.freeze([
              {
                code: "candidate_already_present" as const,
                path: `/members/${member.member_id}`,
                message:
                  "candidate publication identity is already present in another batch",
                member_id: member.member_id,
                candidate_hash: member.candidate_hash,
              },
            ]),
          });
        if (envelopes.has(member.candidate_hash))
          return Object.freeze({
            ok: false as const,
            issues: Object.freeze([
              {
                code: "candidate_already_present" as const,
                path: `/members/${member.member_id}`,
                message:
                  "candidate hash is already present outside this publication batch",
                member_id: member.member_id,
                candidate_hash: member.candidate_hash,
              },
            ]),
          });
      }
      for (const member of batch.published)
        envelopes.set(member.candidate_hash, member.envelope);
      publicationBatches.set(batch.batch_id, batch);
      return Object.freeze({ ok: true as const, batch });
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
export { activateExperimental };
