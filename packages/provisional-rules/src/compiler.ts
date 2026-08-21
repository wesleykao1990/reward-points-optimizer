import type { SourceObservation } from "@jro/agent-feed-consumer";
import { type RewardRule, tryValidateDocument } from "@jro/contracts";

import { freezeP0CoverageIndex, hashCanonical } from "./canonical.js";
import { parseRewardClaimDocument } from "./claim.js";
import { activateExperimental } from "./lifecycle.js";
import { scanPublicValue } from "./security.js";
import { createProvisionalRuleStore } from "./state.js";
import type {
  AdmissionIssue,
  P0CoverageIndex,
  ProvisionalRuleEnvelope,
  ProvisionalRuleStore,
  Sha256,
} from "./types.js";
import { PROVISIONAL_RULE_CANDIDATE_VERSION } from "./types.js";

export interface RewardClaimCompilerBinding {
  /** Rewards-owned P0 tuple. Never read from an untrusted claim. */
  readonly p0_family_id?: string;
  readonly family_id?: string;
  readonly source_role_id: string;
  /** If omitted, the observation/coverage intersection supplies the source. */
  readonly source_ids?: readonly string[];
  readonly p0_coverage_index?: unknown;
  readonly coverage_index?: unknown;
}

export interface RewardClaimCompilerOptions {
  readonly binding?: RewardClaimCompilerBinding;
  readonly p0_family_id?: string;
  readonly family_id?: string;
  readonly source_role_id?: string;
  readonly source_ids?: readonly string[];
  readonly p0_coverage_index?: unknown;
  readonly coverage_index?: unknown;
  readonly store?: ProvisionalRuleStore;
}

export type RewardClaimSourceTier =
  | "T0_REGULATOR"
  | "T1_CANONICAL"
  | "T2_OFFICIAL_SUPPORT"
  | "T3_PARTNER_CONTRACT";

export type RewardClaimCompilerIssueCode =
  | "input_invalid"
  | "observation_invalid"
  | "claim_document_missing"
  | "claim_document_invalid"
  | "claim_invalid"
  | "unsupported_claim_type"
  | "claim_economics_missing"
  | "claim_economics_invalid"
  | "claim_conflict"
  | "binding_invalid"
  | "activation_failed";

export interface RewardClaimCompilerIssue {
  readonly code: RewardClaimCompilerIssueCode;
  readonly path: string;
  readonly message: string;
  readonly claim_id?: string;
  readonly admission_issues?: readonly AdmissionIssue[];
}

export interface RewardClaimCompilationMember {
  readonly claim_id: string;
  readonly claim_type: string;
  readonly ok: boolean;
  readonly candidate_hash?: Sha256;
  readonly definition_hash?: Sha256;
  readonly envelope?: ProvisionalRuleEnvelope;
  readonly issues: readonly RewardClaimCompilerIssue[];
}

export interface RewardClaimCompilationResult {
  readonly ok: boolean;
  readonly observation_id?: string;
  readonly observation_fingerprint?: string;
  readonly store: ProvisionalRuleStore;
  readonly members: readonly RewardClaimCompilationMember[];
  /** Aliases make the per-claim surface convenient for feed adapters. */
  readonly results: readonly RewardClaimCompilationMember[];
  readonly envelopes: readonly ProvisionalRuleEnvelope[];
  readonly issues: readonly RewardClaimCompilerIssue[];
}

const ACCEPTED_PAYMENT_LEGACY_KEYS = new Set([
  "change_kind",
  "change_type",
  "merchant_id",
  "accepted_payment_family",
  "accepted_payment_families",
  "source_id",
  "source_ids",
  "source_snapshot_id",
]);

const NANACO_LEGACY_KEYS = new Set([
  "change_type",
  "program_id",
  "merchant_id",
  "reward_rate",
  "eligible_product_class",
  "posting_timing",
  "product_exclusions_apply",
  "canonical_publication",
  "human_verified",
  "source_id",
  "source_ids",
  "family_id",
  "p0_family_id",
  "source_role_id",
  "known_source_ids",
]);

const PAYMENT_FAMILY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}$/u;
const GENERIC_SOURCE_TIER: RewardClaimSourceTier = "T2_OFFICIAL_SUPPORT";
// These are sealed adapters for the two pre-existing structured finding
// shapes. Generic reward-claim.v1 input always uses GENERIC_SOURCE_TIER.
const PAYMENT_LEGACY_SOURCE_TIER: RewardClaimSourceTier = "T1_CANONICAL";
const NANACO_LEGACY_SOURCE_TIER: RewardClaimSourceTier = "T1_CANONICAL";

function issue(
  code: RewardClaimCompilerIssueCode,
  path: string,
  message: string,
  claim_id?: string,
  admission_issues?: readonly AdmissionIssue[],
): RewardClaimCompilerIssue {
  return Object.freeze({
    code,
    path,
    message,
    ...(claim_id === undefined ? {} : { claim_id }),
    ...(admission_issues === undefined ? {} : { admission_issues }),
  });
}

function sortedIssues(
  issues: readonly RewardClaimCompilerIssue[],
): readonly RewardClaimCompilerIssue[] {
  return Object.freeze(
    [...issues].sort(
      (left, right) =>
        (left.claim_id ?? "").localeCompare(right.claim_id ?? "") ||
        left.path.localeCompare(right.path) ||
        left.code.localeCompare(right.code) ||
        left.message.localeCompare(right.message),
    ),
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function arrayOfStrings(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === "string" && item.length > 0) &&
    new Set(value).size === value.length
  );
}

function slug(value: string): string {
  const normalized = value
    .replace(/[^A-Za-z0-9_-]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .toLowerCase();
  return normalized.slice(0, 80) || "claim";
}

function claimIdentityHash(
  familyId: string,
  roleId: string,
  claimId: string | undefined,
  claimType: string,
): string {
  return hashCanonical({
    family_id: familyId,
    source_role_id: roleId,
    claim_id: claimId ?? null,
    claim_type: claimType,
  }).slice("sha256:".length);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return record(value) ? value : null;
}

function assetRefEqual(left: unknown, right: unknown): boolean {
  const leftRecord = asRecord(left);
  const rightRecord = asRecord(right);
  if (!leftRecord || !rightRecord) return false;
  return (
    leftRecord.asset_id === rightRecord.asset_id &&
    leftRecord.asset_kind === rightRecord.asset_kind &&
    leftRecord.program_id === rightRecord.program_id &&
    leftRecord.reward_class === rightRecord.reward_class &&
    leftRecord.scale === rightRecord.scale
  );
}

function subjectFromObservation(
  observation: Record<string, unknown>,
  claim: Readonly<Record<string, unknown>>,
  familyId: string,
): Record<string, unknown> {
  const explicit = asRecord(claim.subject);
  if (explicit) return { ...explicit };
  const subjects = Array.isArray(observation.subjects)
    ? observation.subjects
    : [];
  const first = subjects.find(
    (item) => record(item) && typeof item.id === "string",
  ) as Record<string, unknown> | undefined;
  if (first && typeof first.id === "string") {
    const type = first.type;
    const entityType =
      type === "loyalty_program"
        ? "stored_value_program"
        : type === "credit_card"
          ? "credit_card"
          : type === "payment_method"
            ? "payment_method"
            : type === "merchant"
              ? "merchant"
              : "merchant";
    return { entity_type: entityType, entity_id: first.id };
  }
  return { entity_type: "merchant", entity_id: familyId };
}

function subjectIds(
  observation: Record<string, unknown>,
  type: string,
): string[] {
  if (!Array.isArray(observation.subjects)) return [];
  return observation.subjects
    .filter((item): item is Record<string, unknown> => record(item))
    .filter((item) => item.type === type && typeof item.id === "string")
    .map((item) => item.id as string);
}

function defaultScope(
  observation: Record<string, unknown>,
  claim: Readonly<Record<string, unknown>>,
  claimType: string,
  allowLegacyDefaults: boolean,
): Record<string, unknown> {
  const explicit = asRecord(claim.scope);
  if (explicit) return { ...explicit };
  if (!allowLegacyDefaults) return {};
  const operationTypes =
    claimType === "transfer_ratio" ||
    claimType === "conversion" ||
    claimType === "redemption"
      ? [claimType === "redemption" ? "point_redemption" : "point_transfer"]
      : ["merchant_purchase"];
  const channels =
    claimType === "transfer_ratio" ||
    claimType === "conversion" ||
    claimType === "redemption"
      ? ["transfer"]
      : ["in_store"];
  const merchants = subjectIds(observation, "merchant");
  return {
    countries: ["JP"],
    operation_types: operationTypes,
    ...(merchants.length === 0 ? {} : { merchant_ids: merchants }),
    channels,
    tax_basis: "tax_inclusive",
  };
}

function defaultEligibility(
  observation: Record<string, unknown>,
  claim: Readonly<Record<string, unknown>>,
  claimType: string,
  allowLegacyDefaults: boolean,
): Record<string, unknown> {
  const explicit = asRecord(claim.eligibility);
  if (explicit) {
    const result = structuredClone(explicit) as Record<string, unknown>;
    if (Array.isArray(claim.conditions)) {
      const existing = Array.isArray(result.user_conditions)
        ? result.user_conditions
        : [];
      result.user_conditions = [
        ...existing,
        ...(structuredClone(claim.conditions) as unknown[]),
      ];
    }
    if (asRecord(claim.campaign_conditions)) {
      result.campaign_conditions = {
        ...(asRecord(result.campaign_conditions) ?? {}),
        ...(structuredClone(claim.campaign_conditions) as Record<
          string,
          unknown
        >),
      };
    }
    return result;
  }
  if (!allowLegacyDefaults) return {};
  const subject =
    asRecord(claim.subject) ??
    subjectFromObservation(observation, claim, "merchant");
  const op: Record<string, unknown> = {};
  if (
    subject.entity_type === "stored_value_program" &&
    typeof subject.entity_id === "string"
  )
    op.required_loyalty_program_ids = [subject.entity_id];
  if (typeof claim.instrument_id === "string")
    op.allowed_payment_instrument_ids = [claim.instrument_id];
  const transactionBasis =
    claimType === "points_per_unit" ||
    claimType === "fixed" ||
    claimType === "percentage"
      ? "operation_amount"
      : "not_applicable";
  return {
    operation_match: op,
    user_conditions: Array.isArray(claim.conditions)
      ? structuredClone(claim.conditions)
      : [],
    transaction_conditions: {
      eligible_amount_basis: transactionBasis,
    },
    campaign_conditions: asRecord(claim.campaign_conditions)
      ? structuredClone(claim.campaign_conditions)
      : {},
  };
}

function observationInstant(observation: Record<string, unknown>): string {
  const effective = asRecord(observation.effective_time);
  for (const value of [
    effective?.effective_from,
    effective?.occurred_at,
    observation.created_at,
    observation.updated_at,
  ]) {
    if (typeof value === "string" && Number.isFinite(Date.parse(value)))
      return value;
  }
  // The source-observation contract normally makes this unreachable. Keeping
  // the deterministic fallback makes the per-claim error come from admission
  // rather than from a wall-clock call.
  return "1970-01-01T00:00:00Z";
}

function observationRecordedAt(observation: Record<string, unknown>): string {
  for (const value of [observation.updated_at, observation.created_at])
    if (typeof value === "string" && Number.isFinite(Date.parse(value)))
      return value;
  return observationInstant(observation);
}

function outputAssetFromClaim(
  claim: Readonly<Record<string, unknown>>,
  observation: Record<string, unknown>,
): Record<string, unknown> | null {
  const output = asRecord(claim.output);
  if (output && asRecord(output.asset))
    return structuredClone(output.asset) as Record<string, unknown>;
  if (asRecord(claim.reward_asset))
    return structuredClone(claim.reward_asset) as Record<string, unknown>;
  const subject = asRecord(claim.subject);
  const programId =
    subject?.entity_type === "stored_value_program" &&
    typeof subject.entity_id === "string"
      ? subject.entity_id
      : typeof observation.raw_attributes === "object" &&
          record(observation.raw_attributes) &&
          typeof observation.raw_attributes.program_id === "string"
        ? observation.raw_attributes.program_id
        : null;
  if (!programId) return null;
  const suffix = programId.startsWith("program.")
    ? programId.slice("program.".length)
    : slug(programId);
  return {
    asset_id: `asset.${suffix}-point`,
    asset_kind: "reward_point",
    program_id: programId,
    reward_class: "normal",
    scale: 0,
  };
}

function unknownOutput(
  claim: Readonly<Record<string, unknown>>,
  observation: Record<string, unknown>,
): Record<string, unknown> | null {
  const asset = outputAssetFromClaim(claim, observation);
  if (!asset) return null;
  const explicit = asRecord(claim.output);
  const raw = asRecord(observation.raw_attributes);
  const postingTiming = raw?.posting_timing;
  const expiry =
    claim.expiry !== undefined
      ? structuredClone(claim.expiry)
      : explicit?.expiry !== undefined
        ? structuredClone(explicit.expiry)
        : {
            policy: "unknown",
            expires_at: null,
            duration_days: null,
            timezone: "Asia/Tokyo",
          };
  const settlementStatus =
    explicit?.settlement !== undefined
      ? asRecord(explicit.settlement)?.status
      : postingTiming === "immediate_for_listed_merchant"
        ? "posted"
        : "unknown";
  const nanacoCompatibility =
    raw?.program_id === "program.jp.nanaco" &&
    raw?.posting_timing === "immediate_for_listed_merchant";
  const base = {
    asset,
    sign: "credit",
    certainty: {
      type: "guaranteed",
      probability: null,
      probability_source: null,
    },
    settlement: {
      status: settlementStatus === "posted" ? "posted" : "unknown",
      expected_posting_from: null,
      expected_posting_to: null,
      posted_at: null,
    },
    expiry,
    restrictions: {
      transferable: null,
      redeemable_for_cash: null,
      usable_for_payment: null,
      investable: null,
      permitted_destination_ids: nanacoCompatibility ? ["asset.jp.nanaco"] : [],
      notes: nanacoCompatibility
        ? "nanaco points are recorded separately from nanaco principal and are not a second top-up principal balance."
        : "Structured claim does not state usage restrictions.",
    },
    clawback: {
      on_refund: "unknown",
      posting_delay_days: null,
      notes: nanacoCompatibility
        ? "No refund operation is included in this narrow candidate slice."
        : "Structured claim does not state refund clawback behavior.",
    },
  };
  if (!explicit) return base;
  const explicitOutput = structuredClone(explicit) as Record<string, unknown>;
  const merged = {
    ...base,
    ...explicitOutput,
    asset:
      explicitOutput.asset === undefined
        ? structuredClone(asset)
        : structuredClone(explicitOutput.asset),
    certainty:
      asRecord(explicitOutput.certainty) === null
        ? base.certainty
        : {
            ...base.certainty,
            ...(structuredClone(explicitOutput.certainty) as Record<
              string,
              unknown
            >),
          },
    settlement:
      asRecord(explicitOutput.settlement) === null
        ? base.settlement
        : {
            ...base.settlement,
            ...(structuredClone(explicitOutput.settlement) as Record<
              string,
              unknown
            >),
          },
    expiry:
      explicitOutput.expiry === undefined
        ? expiry
        : structuredClone(explicitOutput.expiry),
    restrictions:
      asRecord(explicitOutput.restrictions) === null
        ? base.restrictions
        : {
            ...base.restrictions,
            ...(structuredClone(explicitOutput.restrictions) as Record<
              string,
              unknown
            >),
          },
    clawback:
      asRecord(explicitOutput.clawback) === null
        ? base.clawback
        : {
            ...base.clawback,
            ...(structuredClone(explicitOutput.clawback) as Record<
              string,
              unknown
            >),
          },
  };
  return merged;
}

function makeRounding(
  aggregationScope: string,
  quantum: unknown,
): Record<string, unknown> {
  return {
    aggregation_scope: aggregationScope,
    eligible_spend_quantum_jpy: quantum ?? null,
    reward_rounding_mode: "floor",
  };
}

function makeCalculation(
  claim: Readonly<Record<string, unknown>>,
  claimType: string,
  allowLegacyDefaults: boolean,
): {
  readonly calculation: Record<string, unknown> | null;
  readonly error?: string;
} {
  const supplied = asRecord(claim.calculation);
  if (supplied) {
    const expectedModel =
      claimType === "conversion" ||
      claimType === "redemption" ||
      claimType === "transfer_ratio"
        ? "transfer_ratio"
        : claimType;
    if (supplied.model !== expectedModel)
      return {
        calculation: null,
        error: `calculation.model must be ${expectedModel}`,
      };
    const result = structuredClone(supplied) as Record<string, unknown>;
    if (
      allowLegacyDefaults &&
      (claimType === "points_per_unit" || claimType === "percentage") &&
      asRecord(result.rounding)?.eligible_spend_quantum_jpy === undefined
    ) {
      const quantum =
        result.model === "points_per_unit" ? result.spend_jpy : null;
      result.rounding = {
        ...asRecord(result.rounding),
        eligible_spend_quantum_jpy: quantum,
      };
    }
    if (!allowLegacyDefaults && asRecord(result.rounding) === null)
      return {
        calculation: null,
        error: "calculation.rounding is required for a structured claim",
      };
    if (
      !allowLegacyDefaults &&
      (claimType === "transfer_ratio" ||
        claimType === "conversion" ||
        claimType === "redemption")
    ) {
      const requiredTransferKeys = [
        "minimum_source_units",
        "increment_source_units",
        "maximum_source_units_per_request",
        "maximum_source_units_per_period",
        "maximum_period",
        "fee",
        "processing_time_days_min",
        "processing_time_days_max",
        "cancellation_policy",
      ];
      if (requiredTransferKeys.some((key) => result[key] === undefined))
        return {
          calculation: null,
          error:
            "transfer calculation must explicitly state all transfer limits, fee, timing, and cancellation fields",
        };
    }
    return { calculation: result };
  }
  switch (claimType) {
    case "points_per_unit":
      if (
        typeof claim.reward_units !== "string" ||
        typeof claim.spend_jpy !== "number"
      )
        return {
          calculation: null,
          error: "points_per_unit requires reward_units and spend_jpy",
        };
      return {
        calculation: {
          model: "points_per_unit",
          reward_units: claim.reward_units,
          spend_jpy: claim.spend_jpy,
          rounding: makeRounding("per_operation", claim.spend_jpy),
        },
      };
    case "fixed":
      if (typeof claim.reward_units !== "string")
        return { calculation: null, error: "fixed requires reward_units" };
      return {
        calculation: {
          model: "fixed",
          reward_units: claim.reward_units,
          rounding: makeRounding("per_operation", null),
        },
      };
    case "percentage":
      if (typeof claim.rate_basis_points !== "number")
        return {
          calculation: null,
          error: "percentage requires rate_basis_points",
        };
      return {
        calculation: {
          model: "percentage",
          rate_basis_points: claim.rate_basis_points,
          rounding: makeRounding("per_operation", null),
        },
      };
    case "transfer_ratio":
    case "conversion":
    case "redemption": {
      const source = asRecord(claim.source_asset);
      const destination = asRecord(claim.destination_asset);
      if (
        !source ||
        !destination ||
        typeof claim.source_units !== "string" ||
        typeof claim.destination_units !== "string"
      )
        return {
          calculation: null,
          error: "transfer_ratio requires source/destination assets and units",
        };
      return {
        calculation: {
          model: "transfer_ratio",
          source_asset: structuredClone(source),
          destination_asset: structuredClone(destination),
          source_units: claim.source_units,
          destination_units: claim.destination_units,
          minimum_source_units: claim.minimum_source_units ?? null,
          increment_source_units: claim.increment_source_units ?? null,
          maximum_source_units_per_request:
            claim.maximum_source_units_per_request ?? null,
          maximum_source_units_per_period:
            claim.maximum_source_units_per_period ?? null,
          maximum_period: claim.maximum_period ?? null,
          fee: claim.fee === undefined ? null : structuredClone(claim.fee),
          rounding: asRecord(claim.rounding)
            ? structuredClone(claim.rounding)
            : makeRounding("transfer_request", null),
          processing_time_days_min: claim.processing_time_days_min ?? null,
          processing_time_days_max: claim.processing_time_days_max ?? null,
          cancellation_policy: claim.cancellation_policy ?? "unknown",
        },
      };
    }
    default:
      return { calculation: null };
  }
}

function legacyAllowed(
  raw: Record<string, unknown>,
  keys: ReadonlySet<string>,
): boolean {
  return Object.keys(raw).every((key) => keys.has(key));
}

function legacyClaims(
  observation: Record<string, unknown>,
): readonly Readonly<Record<string, unknown>>[] {
  const raw = asRecord(observation.raw_attributes);
  if (!raw) return [];
  const structured = raw.reward_claims;
  if (structured !== undefined) return [];

  const accepted = raw.accepted_payment_families;
  const singular = raw.accepted_payment_family;
  if (
    (Array.isArray(accepted) || typeof singular === "string") &&
    legacyAllowed(raw, ACCEPTED_PAYMENT_LEGACY_KEYS)
  ) {
    const families = Array.isArray(accepted) ? accepted : [singular];
    if (
      families.length === 0 ||
      families.some(
        (family) =>
          typeof family !== "string" || !PAYMENT_FAMILY_PATTERN.test(family),
      )
    )
      return [];
    return families.map((family) => ({
      claim_id: `legacy-payment-${slug(family as string)}`,
      claim_type: "payment_acceptance",
      decision: "allow",
      payment_family: family,
    }));
  }

  const rate = asRecord(raw.reward_rate);
  if (
    raw.change_type === "reward_rate" &&
    rate &&
    legacyAllowed(raw, NANACO_LEGACY_KEYS) &&
    typeof raw.program_id === "string" &&
    typeof raw.merchant_id === "string" &&
    rate.reward_units !== undefined &&
    rate.spend_jpy !== undefined &&
    rate.spend_basis !== undefined
  ) {
    if (raw.canonical_publication === true || raw.human_verified === true)
      return [];
    const taxBasis = rate.spend_basis;
    if (taxBasis !== "tax_exclusive" && taxBasis !== "tax_inclusive") return [];
    const program = raw.program_id;
    const instrument =
      program === "program.jp.nanaco"
        ? "instrument.jp.nanaco"
        : `instrument.${slug(program)}`;
    const funding =
      program === "program.jp.nanaco"
        ? "funding.jp.nanaco"
        : `funding.${slug(program)}`;
    const asset =
      program === "program.jp.nanaco"
        ? "asset.jp.nanaco"
        : `asset.${slug(program)}`;
    const pointAsset =
      program === "program.jp.nanaco"
        ? "asset.jp.nanaco-point"
        : `asset.${slug(program)}-point`;
    return [
      {
        claim_id: "legacy-nanaco-reward-rate",
        claim_type: "points_per_unit",
        name: "Structured reward-rate claim",
        subject: { entity_type: "stored_value_program", entity_id: program },
        scope: {
          countries: ["JP"],
          operation_types: ["merchant_purchase"],
          merchant_ids: [raw.merchant_id],
          channels: ["in_store"],
          included_product_classes:
            typeof raw.eligible_product_class === "string"
              ? [raw.eligible_product_class]
              : [],
          tax_basis: taxBasis,
        },
        eligibility: {
          operation_match: {
            required_loyalty_program_ids: [program],
            allowed_payment_instrument_ids: [instrument],
            allowed_funding_source_ids: [funding],
            allowed_source_asset_ids: [asset],
          },
          user_conditions: [],
          transaction_conditions: {
            eligible_amount_basis:
              taxBasis === "tax_exclusive"
                ? "eligible_line_items"
                : "operation_amount",
          },
          campaign_conditions: {},
        },
        calculation: {
          model: "points_per_unit",
          reward_units: rate.reward_units,
          spend_jpy: rate.spend_jpy,
          rounding: {
            aggregation_scope: "per_operation",
            eligible_spend_quantum_jpy: rate.spend_jpy,
            reward_rounding_mode: "floor",
          },
        },
        reward_asset: {
          asset_id: pointAsset,
          asset_kind: "reward_point",
          program_id: program,
          reward_class: "normal",
          scale: 0,
        },
        description:
          "Structured reward-rate claim; output expiry and usage restrictions remain unknown unless explicitly stated.",
      },
    ];
  }
  return [];
}

function structuredClaims(observation: Record<string, unknown>): {
  readonly claims: readonly Readonly<Record<string, unknown>>[];
  readonly issues: readonly RewardClaimCompilerIssue[];
  readonly legacy: boolean;
} {
  const raw = asRecord(observation.raw_attributes);
  if (!raw)
    return {
      claims: [],
      legacy: false,
      issues: [
        issue(
          "observation_invalid",
          "/raw_attributes",
          "raw_attributes must be an object",
        ),
      ],
    };
  if (raw.reward_claims === undefined) {
    const claims = legacyClaims(observation);
    return claims.length > 0
      ? { claims, issues: [], legacy: true }
      : {
          claims: [],
          legacy: false,
          issues: [
            issue(
              "claim_document_missing",
              "/raw_attributes/reward_claims",
              "explicit reward_claims or a supported structured legacy adapter is required",
            ),
          ],
        };
  }
  const parsed = parseRewardClaimDocument(raw.reward_claims);
  const parserIssues = parsed.issues.map((item) =>
    issue(
      item.code === "hostile_input"
        ? "input_invalid"
        : "claim_document_invalid",
      `/raw_attributes/reward_claims${item.path}`,
      item.message,
      item.claim_id,
    ),
  );
  if (!parsed.document)
    return { claims: [], issues: parserIssues, legacy: false };
  // Preserve valid parsed siblings; parser issues are attached globally and
  // are also repeated against the matching member when a claim ID is known.
  return {
    claims: parsed.claims.map((item) => item.value),
    issues: parserIssues,
    legacy: false,
  };
}

function bindingInput(
  options: RewardClaimCompilerOptions,
  observation: Record<string, unknown>,
): {
  readonly familyId: string;
  readonly roleId: string;
  readonly sourceIds: readonly string[];
  readonly sourceTier: RewardClaimSourceTier;
  readonly coverage: P0CoverageIndex;
  readonly issues: readonly RewardClaimCompilerIssue[];
} {
  const nested: Partial<RewardClaimCompilerBinding> = options.binding ?? {};
  const familyId =
    nested.p0_family_id ??
    nested.family_id ??
    options.p0_family_id ??
    options.family_id;
  const roleId = nested.source_role_id ?? options.source_role_id;
  const sourceTier = GENERIC_SOURCE_TIER;
  const coverageInput =
    nested.p0_coverage_index ??
    nested.coverage_index ??
    options.p0_coverage_index ??
    options.coverage_index;
  const issues: RewardClaimCompilerIssue[] = [];
  if (typeof familyId !== "string" || !ID_PATTERN.test(familyId))
    issues.push(
      issue(
        "binding_invalid",
        "/binding/p0_family_id",
        "host-owned family_id is required",
      ),
    );
  if (typeof roleId !== "string" || !ID_PATTERN.test(roleId))
    issues.push(
      issue(
        "binding_invalid",
        "/binding/source_role_id",
        "host-owned source_role_id is required",
      ),
    );
  let coverage: P0CoverageIndex | null = null;
  try {
    if (coverageInput === undefined) throw new TypeError("coverage_missing");
    coverage = freezeP0CoverageIndex(coverageInput);
  } catch {
    issues.push(
      issue(
        "binding_invalid",
        "/binding/p0_coverage_index",
        "host-owned frozen P0 coverage index is required",
      ),
    );
  }
  if (!coverage || typeof familyId !== "string" || typeof roleId !== "string")
    return {
      familyId: familyId ?? "",
      roleId: roleId ?? "",
      sourceIds: [],
      sourceTier: sourceTier as RewardClaimSourceTier,
      coverage: coverage as P0CoverageIndex,
      issues,
    };
  const entry = coverage.entries.find(
    (item) => item.family_id === familyId && item.source_role_id === roleId,
  );
  if (!entry) {
    issues.push(
      issue(
        "binding_invalid",
        "/binding",
        "host-owned family/source-role tuple is absent from P0 coverage",
      ),
    );
    return {
      familyId,
      roleId,
      sourceIds: [],
      sourceTier: sourceTier as RewardClaimSourceTier,
      coverage,
      issues,
    };
  }
  const supplied = nested.source_ids ?? options.source_ids;
  const observationSources = Array.isArray(observation.source_ids)
    ? observation.source_ids.filter(
        (item): item is string => typeof item === "string",
      )
    : [];
  const sourceIds =
    supplied === undefined
      ? entry.known_source_ids.filter((source) =>
          observationSources.includes(source),
        )
      : arrayOfStrings(supplied)
        ? [...supplied]
        : [];
  if (sourceIds.length === 0)
    issues.push(
      issue(
        "binding_invalid",
        "/binding/source_ids",
        "host-owned source_ids must intersect the observation",
      ),
    );
  return {
    familyId,
    roleId,
    sourceIds,
    sourceTier: sourceTier as RewardClaimSourceTier,
    coverage,
    issues,
  };
}

function requiredStructuredFields(
  claim: Readonly<Record<string, unknown>>,
  claimType: string,
): RewardClaimCompilerIssue | undefined {
  const claimId =
    typeof claim.claim_id === "string" ? claim.claim_id : undefined;
  for (const field of ["subject", "scope", "eligibility"] as const) {
    if (!asRecord(claim[field]))
      return issue(
        "claim_economics_missing",
        `/${field}`,
        `structured ${claimType} claims require an explicit ${field}`,
        claimId,
      );
  }
  const scope = asRecord(claim.scope);
  const taxBasis = scope?.tax_basis;
  if (typeof taxBasis !== "string")
    return issue(
      "claim_economics_missing",
      "/scope/tax_basis",
      `structured ${claimType} claims require an explicit scope.tax_basis`,
      claimId,
    );
  if (
    taxBasis !== "tax_inclusive" &&
    taxBasis !== "tax_exclusive" &&
    taxBasis !== "provider_defined" &&
    taxBasis !== "not_applicable"
  )
    return issue(
      "claim_economics_invalid",
      "/scope/tax_basis",
      "scope.tax_basis is not a supported RewardRule tax basis",
      claimId,
    );
  if (!asRecord(claim.calculation))
    return issue(
      "claim_economics_missing",
      "/calculation",
      `structured ${claimType} claims require an explicit calculation`,
      claimId,
    );
  const output = asRecord(claim.output);
  if (!output)
    return issue(
      "claim_economics_missing",
      "/output",
      `structured ${claimType} claims require an explicit output`,
      claimId,
    );
  if (!asRecord(output.asset))
    return issue(
      "claim_economics_missing",
      "/output/asset",
      `structured ${claimType} claims require an explicit output asset`,
      claimId,
    );
  return undefined;
}

function ruleForClaim(
  claim: Readonly<Record<string, unknown>>,
  observation: Record<string, unknown>,
  binding: {
    readonly familyId: string;
    readonly roleId: string;
    readonly sourceTier: RewardClaimSourceTier;
  },
  allowLegacyDefaults: boolean,
): {
  readonly rule: RewardRule | null;
  readonly issue?: RewardClaimCompilerIssue;
} {
  const claimId =
    typeof claim.claim_id === "string" ? claim.claim_id : undefined;
  const claimType =
    typeof claim.claim_type === "string" ? claim.claim_type : "";
  if (!allowLegacyDefaults) {
    const requiredIssue = requiredStructuredFields(claim, claimType);
    if (
      requiredIssue &&
      [
        "points_per_unit",
        "fixed",
        "percentage",
        "transfer_ratio",
        "conversion",
        "redemption",
        "campaign",
      ].includes(claimType)
    )
      return { rule: null, issue: requiredIssue };
  }
  const allowSimpleRuleDefaults =
    allowLegacyDefaults ||
    claimType === "payment_acceptance" ||
    claimType === "exclusion";
  const baseScope = defaultScope(
    observation,
    claim,
    claimType,
    allowSimpleRuleDefaults,
  );
  const baseSubject = subjectFromObservation(
    observation,
    claim,
    binding.familyId,
  );
  const validityExplicit = asRecord(claim.validity);
  const validity = validityExplicit
    ? structuredClone(validityExplicit)
    : {
        valid_from: observationInstant(observation),
        valid_to: null,
        timezone: "Asia/Tokyo",
        recorded_at: observationRecordedAt(observation),
        superseded_at: null,
      };
  const identityHash = claimIdentityHash(
    binding.familyId,
    binding.roleId,
    claimId,
    claimType,
  );
  const ruleId = `rr_p0_${slug(binding.familyId)}_${slug(binding.roleId)}_${slug(claimId ?? claimType)}_${identityHash}`;
  const stackGroup = ruleId;
  const audit = {
    created_at: observationRecordedAt(observation),
    created_by: "reward-claim-compiler",
    review_events: [],
    required_review_modes: ["agent_challenged"],
    review_mode: null,
    reviewed_at: null,
    reviewed_by: null,
    change_reason:
      "Deterministic provisional rule compiled from an explicit structured claim.",
  };
  const submitted = Array.isArray(observation.submitted_evidence_refs)
    ? observation.submitted_evidence_refs.filter(
        (item): item is string =>
          typeof item === "string" && /^ev_[a-z0-9_-]+$/u.test(item),
      )
    : [];
  const canonical = Array.isArray(observation.canonical_evidence_ids)
    ? observation.canonical_evidence_ids.filter(
        (item): item is string =>
          typeof item === "string" && /^ev_[a-z0-9_-]+$/u.test(item),
      )
    : [];
  const evidenceIds = [...new Set([...canonical, ...submitted])];
  if (evidenceIds.length === 0)
    return {
      rule: null,
      issue: issue(
        "claim_economics_invalid",
        "/provenance/evidence_ids",
        "an explicit ev_ evidence reference is required",
        claimId,
      ),
    };
  const provenance = {
    evidence_ids: evidenceIds,
    minimum_source_tier: binding.sourceTier,
    confidence: 0,
    human_verified: false,
    review_notes:
      "Provisional structured claim; no human verification or canonical publication is asserted.",
  };

  if (claimType === "payment_acceptance") {
    if (
      claim.decision !== "allow" ||
      typeof claim.payment_family !== "string" ||
      !PAYMENT_FAMILY_PATTERN.test(claim.payment_family)
    )
      return {
        rule: null,
        issue: issue(
          "claim_invalid",
          "/claim",
          "payment_acceptance requires decision allow and payment_family",
          claimId,
        ),
      };
    const instrument =
      typeof claim.instrument_id === "string"
        ? claim.instrument_id
        : `instrument.${slug(String(baseSubject.entity_id))}.${slug(claim.payment_family)}`;
    const eligibility = defaultEligibility(
      observation,
      claim,
      claimType,
      allowSimpleRuleDefaults,
    );
    const operationMatch = asRecord(eligibility.operation_match) ?? {};
    operationMatch.allowed_payment_instrument_ids = [instrument];
    eligibility.operation_match = operationMatch;
    const rule: RewardRule = {
      rule_id: ruleId,
      version: 1,
      status: "under_review",
      rule_type: "payment_acceptance",
      name:
        typeof claim.name === "string"
          ? claim.name
          : `Structured payment acceptance ${claim.payment_family}`,
      ...(typeof claim.description === "string"
        ? { description: claim.description }
        : {}),
      subject: baseSubject as unknown as RewardRule["subject"],
      scope: baseScope as unknown as RewardRule["scope"],
      eligibility: eligibility as unknown as RewardRule["eligibility"],
      effect: {
        decision: "allow",
        effect_target: "operation_eligibility",
        target_rule_ids: [],
        target_stack_groups: [],
        reason_code: `accepted_payment_family_${claim.payment_family}`,
      },
      caps: Array.isArray(claim.caps)
        ? (structuredClone(claim.caps) as RewardRule["caps"])
        : [],
      stacking: {
        stack_group: stackGroup,
        mode: "non_reward_acceptance",
        precedence: 0,
        conflicts_with_rule_ids: [],
        requires_rule_ids: [],
      },
      validity: validity as unknown as RewardRule["validity"],
      provenance: provenance as unknown as RewardRule["provenance"],
      audit: audit as unknown as RewardRule["audit"],
    };
    return { rule };
  }

  if (claimType === "exclusion") {
    const target =
      typeof claim.target === "string"
        ? claim.target
        : typeof claim.payment_family === "string"
          ? claim.payment_family
          : null;
    if (!target)
      return {
        rule: null,
        issue: issue(
          "claim_invalid",
          "/target",
          "exclusion requires an explicit target",
          claimId,
        ),
      };
    const eligibility = defaultEligibility(
      observation,
      claim,
      claimType,
      allowSimpleRuleDefaults,
    );
    const op = asRecord(eligibility.operation_match) ?? {};
    op.excluded_payment_instrument_ids = [
      typeof claim.instrument_id === "string"
        ? claim.instrument_id
        : `instrument.${slug(String(baseSubject.entity_id))}.${slug(target)}`,
    ];
    eligibility.operation_match = op;
    const rule: RewardRule = {
      rule_id: ruleId,
      version: 1,
      status: "under_review",
      rule_type: "exclusion",
      name:
        typeof claim.name === "string"
          ? claim.name
          : `Structured exclusion ${target}`,
      ...(typeof claim.description === "string"
        ? { description: claim.description }
        : {}),
      subject: baseSubject as unknown as RewardRule["subject"],
      scope: baseScope as unknown as RewardRule["scope"],
      eligibility: eligibility as unknown as RewardRule["eligibility"],
      effect: {
        decision: "deny",
        effect_target: "operation_eligibility",
        target_rule_ids: [],
        target_stack_groups: [],
        reason_code: `excluded_${slug(target)}`,
      },
      caps: Array.isArray(claim.caps)
        ? (structuredClone(claim.caps) as RewardRule["caps"])
        : [],
      stacking: {
        stack_group: stackGroup,
        mode: "non_reward_acceptance",
        precedence: 0,
        conflicts_with_rule_ids: [],
        requires_rule_ids: [],
      },
      validity: validity as unknown as RewardRule["validity"],
      provenance: provenance as unknown as RewardRule["provenance"],
      audit: audit as unknown as RewardRule["audit"],
    };
    return { rule };
  }

  if (
    ![
      "points_per_unit",
      "fixed",
      "percentage",
      "transfer_ratio",
      "conversion",
      "redemption",
      "campaign",
    ].includes(claimType)
  )
    return {
      rule: null,
      issue: issue(
        "unsupported_claim_type",
        "/claim_type",
        `unsupported structured claim type ${claimType}`,
        claimId,
      ),
    };

  const calculationResult =
    claimType === "campaign"
      ? makeCalculation(
          claim,
          asRecord(claim.calculation)?.model === "fixed" ||
            (claim.calculation === undefined &&
              typeof claim.reward_units === "string" &&
              claim.spend_jpy === undefined)
            ? "fixed"
            : asRecord(claim.calculation)?.model === "percentage" ||
                (claim.calculation === undefined &&
                  typeof claim.rate_basis_points === "number")
              ? "percentage"
              : "points_per_unit",
          allowLegacyDefaults,
        )
      : makeCalculation(claim, claimType, allowLegacyDefaults);
  if (!calculationResult.calculation)
    return {
      rule: null,
      issue: issue(
        "claim_economics_missing",
        "/calculation",
        calculationResult.error ?? "explicit economic calculation is required",
        claimId,
      ),
    };
  const transfer =
    claimType === "transfer_ratio" ||
    claimType === "conversion" ||
    claimType === "redemption";
  const output = transfer
    ? allowLegacyDefaults
      ? undefined
      : (structuredClone(claim.output) as Record<string, unknown>)
    : unknownOutput(claim, observation);
  if (transfer && !allowLegacyDefaults) {
    const calculation = calculationResult.calculation;
    const explicitOutput = asRecord(output);
    if (
      !calculation ||
      !assetRefEqual(
        explicitOutput?.asset,
        (calculation as Record<string, unknown>).destination_asset,
      )
    )
      return {
        rule: null,
        issue: issue(
          "claim_economics_invalid",
          "/output/asset",
          "transfer output asset must exactly match calculation.destination_asset",
          claimId,
        ),
      };
  }
  if (!transfer && !output)
    return {
      rule: null,
      issue: issue(
        "claim_economics_missing",
        "/output/asset",
        "reward claim requires an explicit or structurally identifiable reward asset",
        claimId,
      ),
    };
  const eligibility = defaultEligibility(
    observation,
    claim,
    claimType,
    allowSimpleRuleDefaults,
  );
  if (claim.campaign_id !== undefined) {
    const conditions = asRecord(eligibility.campaign_conditions) ?? {};
    conditions.campaign_id = claim.campaign_id;
    eligibility.campaign_conditions = conditions;
  }
  const ruleType =
    claimType === "campaign"
      ? "campaign_bonus"
      : transfer
        ? claimType === "conversion"
          ? "asset_conversion"
          : claimType === "redemption"
            ? "redemption"
            : "transfer"
        : "base_reward";
  const rule: RewardRule = {
    rule_id: ruleId,
    version: 1,
    status: "under_review",
    rule_type: ruleType,
    name:
      typeof claim.name === "string"
        ? claim.name
        : `Structured ${claimType} claim ${claimId ?? ""}`,
    ...(typeof claim.description === "string"
      ? { description: claim.description }
      : {}),
    subject: baseSubject as unknown as RewardRule["subject"],
    scope: baseScope as unknown as RewardRule["scope"],
    eligibility: eligibility as unknown as RewardRule["eligibility"],
    calculation: calculationResult.calculation as unknown as NonNullable<
      RewardRule["calculation"]
    >,
    ...(output === undefined
      ? {}
      : { output: output as unknown as NonNullable<RewardRule["output"]> }),
    caps: Array.isArray(claim.caps)
      ? (structuredClone(claim.caps) as RewardRule["caps"])
      : [],
    stacking: {
      stack_group: stackGroup,
      mode: "additive",
      precedence: 0,
      conflicts_with_rule_ids: [],
      requires_rule_ids: [],
    },
    validity: validity as unknown as RewardRule["validity"],
    provenance: provenance as unknown as RewardRule["provenance"],
    audit: audit as unknown as RewardRule["audit"],
  };
  return { rule };
}

function candidateForClaim(
  claim: Readonly<Record<string, unknown>>,
  observation: Record<string, unknown>,
  binding: {
    readonly familyId: string;
    readonly roleId: string;
    readonly sourceIds: readonly string[];
    readonly sourceTier: RewardClaimSourceTier;
  },
  allowLegacyDefaults: boolean,
): {
  readonly candidate: Record<string, unknown> | null;
  readonly issue?: RewardClaimCompilerIssue;
} {
  const claimId =
    typeof claim.claim_id === "string" ? claim.claim_id : undefined;
  const claimType =
    typeof claim.claim_type === "string" ? claim.claim_type : "";
  const sourceTier =
    allowLegacyDefaults && claimId === "legacy-nanaco-reward-rate"
      ? NANACO_LEGACY_SOURCE_TIER
      : allowLegacyDefaults && claimId?.startsWith("legacy-payment-")
        ? PAYMENT_LEGACY_SOURCE_TIER
        : binding.sourceTier;
  const ruleBinding = { ...binding, sourceTier };
  const built = ruleForClaim(
    claim,
    observation,
    ruleBinding,
    allowLegacyDefaults,
  );
  if (!built.rule)
    return built.issue === undefined
      ? { candidate: null }
      : { candidate: null, issue: built.issue };
  const authority = asRecord(
    observation.discovery_assessment,
  )?.source_authority_claim;
  const authorityRole =
    authority === "primary"
      ? "primary"
      : authority === "official_secondary" || authority === "third_party"
        ? "corroborating"
        : "conflict";
  const observationId = observation.observation_id;
  const fingerprint = observation.semantic_fingerprint;
  if (typeof observationId !== "string" || typeof fingerprint !== "string")
    return {
      candidate: null,
      issue: issue(
        "observation_invalid",
        "/observation",
        "observation identity is required",
        claimId,
      ),
    };
  const identityHash = claimIdentityHash(
    binding.familyId,
    binding.roleId,
    claimId,
    claimType,
  );
  const candidateId = `candidate_p0_${slug(binding.familyId)}_${slug(binding.roleId)}_${slug(claimId ?? claimType)}_${identityHash}_${fingerprint.slice(-12)}`;
  const checkedAt = observationRecordedAt(observation);
  const structure = tryValidateDocument(built.rule, "reward-rule").valid;
  const candidate = {
    version: PROVISIONAL_RULE_CANDIDATE_VERSION,
    candidate_id: candidateId,
    observation_id: observationId,
    observation_fingerprint: fingerprint,
    p0_family_id: binding.familyId,
    source_role_id: binding.roleId,
    source_authority_role: authorityRole,
    source_ids: [...binding.sourceIds].sort((left, right) =>
      left.localeCompare(right),
    ),
    rule: built.rule,
    extractor: { name: "reward-claim-compiler", version: "1" },
    machine_check: {
      checker: "reward-claim-compiler",
      checker_version: "1",
      checked_at: checkedAt,
      checks: {
        representation_safe: true,
        rule_structure: structure,
        rule_semantics: structure,
        observation_binding: true,
        p0_coverage: true,
      },
    },
  };
  return { candidate };
}

function emptyResult(
  store: ProvisionalRuleStore,
  issues: readonly RewardClaimCompilerIssue[],
  observation?: Record<string, unknown>,
): RewardClaimCompilationResult {
  const frozenIssues = sortedIssues(issues);
  return Object.freeze({
    ok: false,
    ...(typeof observation?.observation_id === "string"
      ? { observation_id: observation.observation_id }
      : {}),
    ...(typeof observation?.semantic_fingerprint === "string"
      ? { observation_fingerprint: observation.semantic_fingerprint }
      : {}),
    store,
    members: Object.freeze([]),
    results: Object.freeze([]),
    envelopes: Object.freeze([]),
    issues: frozenIssues,
  });
}

/** Compile all explicit claims in a SourceObservation into private prototypes. */
export function compileRewardClaims(
  observationValue: unknown,
  options: RewardClaimCompilerOptions,
): RewardClaimCompilationResult {
  const store = options.store ?? createProvisionalRuleStore();
  const observationScan = scanPublicValue(observationValue);
  if (!observationScan.valid)
    return emptyResult(
      store,
      observationScan.issues.map((item) =>
        issue("input_invalid", item.path, item.message),
      ),
    );
  const observation = asRecord(observationScan.value);
  if (!observation)
    return emptyResult(store, [
      issue("observation_invalid", "", "source observation must be an object"),
    ]);
  const binding = bindingInput(options, observation);
  if (binding.issues.length > 0)
    return emptyResult(store, binding.issues, observation);
  const selected = structuredClaims(observation);
  if (
    selected.issues.some(
      (item) =>
        item.claim_id === undefined &&
        (item.code === "input_invalid" ||
          item.code === "claim_document_invalid"),
    )
  )
    return emptyResult(store, selected.issues, observation);
  const members: RewardClaimCompilationMember[] = [];
  const globalIssues = selected.issues.filter(
    (item) => item.claim_id === undefined,
  );
  for (const claim of selected.claims) {
    const claimId = typeof claim.claim_id === "string" ? claim.claim_id : "";
    const claimType =
      typeof claim.claim_type === "string" ? claim.claim_type : "";
    const claimIssues = selected.issues.filter(
      (item) => item.claim_id === claimId,
    );
    if (claimIssues.length > 0) {
      members.push(
        Object.freeze({
          claim_id: claimId,
          claim_type: claimType,
          ok: false,
          issues: Object.freeze(claimIssues),
        }),
      );
      continue;
    }
    const prepared = candidateForClaim(
      claim,
      observation,
      binding,
      selected.legacy,
    );
    if (!prepared.candidate) {
      members.push(
        Object.freeze({
          claim_id: claimId,
          claim_type: claimType,
          ok: false,
          issues: Object.freeze([
            prepared.issue ??
              issue(
                "claim_invalid",
                "/claim",
                "claim could not be compiled",
                claimId,
              ),
          ]),
        }),
      );
      continue;
    }
    const admitted = store.admit({
      candidate: prepared.candidate,
      observation,
      p0_coverage_index: binding.coverage,
    });
    if (!admitted.ok) {
      members.push(
        Object.freeze({
          claim_id: claimId,
          claim_type: claimType,
          ok: false,
          ...(admitted.candidate_hash === undefined
            ? {}
            : { candidate_hash: admitted.candidate_hash }),
          ...(admitted.definition_hash === undefined
            ? {}
            : { definition_hash: admitted.definition_hash }),
          issues: Object.freeze([
            issue(
              "claim_invalid",
              `/claims/${claimId}`,
              "provisional admission rejected the compiled rule",
              claimId,
              admitted.issues,
            ),
          ]),
        }),
      );
      continue;
    }
    let envelope = admitted.envelope;
    const authority = asRecord(
      observation.discovery_assessment,
    )?.source_authority_claim;
    const completePrimary =
      observation.status === "needs_review" &&
      asRecord(observation.discovery_assessment)?.evidence_completeness ===
        "complete" &&
      Array.isArray(observation.submitted_evidence_refs) &&
      observation.submitted_evidence_refs.length > 0 &&
      authority === "primary";
    if (completePrimary) {
      const existing = store.get(admitted.candidate_hash);
      if (existing?.status === "active_experimental") {
        members.push(
          Object.freeze({
            claim_id: claimId,
            claim_type: claimType,
            ok: true,
            candidate_hash: admitted.candidate_hash,
            definition_hash: admitted.definition_hash,
            envelope: existing,
            issues: Object.freeze([]),
          }),
        );
        continue;
      }
      const activation = activateExperimental(
        envelope,
        envelope.history.at(-1)?.occurred_at ??
          observationRecordedAt(observation),
        "automatic_structured_claim_activation",
      );
      if (!activation.ok) {
        members.push(
          Object.freeze({
            claim_id: claimId,
            claim_type: claimType,
            ok: false,
            candidate_hash: admitted.candidate_hash,
            definition_hash: admitted.definition_hash,
            issues: Object.freeze([
              issue(
                "activation_failed",
                "/status",
                activation.message,
                claimId,
              ),
            ]),
          }),
        );
        continue;
      }
      envelope = activation.envelope;
      // Store activation is deliberately performed through its public state
      // owner, retaining the process-local envelope brand.
      const persisted = store.activate(
        admitted.candidate_hash,
        envelope.history.at(-1)?.occurred_at ??
          observationRecordedAt(observation),
        "automatic_structured_claim_activation",
      );
      if (!persisted.ok) {
        members.push(
          Object.freeze({
            claim_id: claimId,
            claim_type: claimType,
            ok: false,
            candidate_hash: admitted.candidate_hash,
            definition_hash: admitted.definition_hash,
            issues: Object.freeze([
              issue("activation_failed", "/status", persisted.message, claimId),
            ]),
          }),
        );
        continue;
      }
      envelope = persisted.envelope;
    }
    members.push(
      Object.freeze({
        claim_id: claimId,
        claim_type: claimType,
        ok: true,
        candidate_hash: admitted.candidate_hash,
        definition_hash: admitted.definition_hash,
        envelope,
        issues: Object.freeze([]),
      }),
    );
  }
  const successful = members
    .filter((item) => item.ok && item.envelope !== undefined)
    .map((item) => item.envelope as ProvisionalRuleEnvelope);
  const issues = sortedIssues([
    ...globalIssues,
    ...members.flatMap((item) => item.issues),
  ]);
  return Object.freeze({
    ok: members.some((item) => item.ok),
    observation_id: observation.observation_id as string,
    observation_fingerprint: observation.semantic_fingerprint as string,
    store,
    members: Object.freeze(members),
    results: Object.freeze(members),
    envelopes: Object.freeze(successful),
    issues,
  });
}

/** Finding/observation naming used by the Agent Feed integration boundary. */
export const compileFindingToProvisionalRules = compileRewardClaims;
export const compileSourceObservationClaims = compileRewardClaims;
export const compileRewardClaimDocument = compileRewardClaims;

export function createRewardClaimCompiler(
  options: RewardClaimCompilerOptions,
): {
  readonly compile: (observation: unknown) => RewardClaimCompilationResult;
  readonly store: ProvisionalRuleStore;
} {
  const store = options.store ?? createProvisionalRuleStore();
  const boundOptions = { ...options, store };
  return Object.freeze({
    store,
    compile: (observation: unknown) =>
      compileRewardClaims(observation, boundOptions),
  });
}

export type RewardClaimObservation = SourceObservation;
