import {
  canonicalSha256,
  deepFreeze,
  verifyCanonicalHash,
} from "./canonical.js";

export const M4_COHORT_REGISTRY_ID = "source-maintenance-pilot.v0.3" as const;
export const M4_COHORT_VERSION = "0.3.0" as const;
export const M4_REHEARSAL_VERSION = "0.4.1" as const;
export const M4_PLANNED_WINDOW_DAYS = 30 as const;

export const M4_COHORT_SOURCE_IDS = [
  "gov.ppc.credit-card-number-faq",
  "jp.smbc.eligible-merchant-rewards",
  "jp.rakutencard.product",
  "jp.paypay.reward-rate",
  "jp.rakutenpay.point-program",
  "jp.dbarai.campaigns",
  "jp.paypay.campaigns",
  "merchant.familymart.payment",
] as const;

export type M4SourceId = (typeof M4_COHORT_SOURCE_IDS)[number];

export type M4SourceRole =
  | "regulator"
  | "issuer_blocked_cluster"
  | "issuer_high_value"
  | "qr_wallet"
  | "campaign_directory"
  | "merchant";

export type M4SourceVolatility = "low" | "medium" | "high" | "very_high";

export interface M4CohortSource {
  readonly source_id: M4SourceId;
  readonly role: M4SourceRole;
  readonly volatility: M4SourceVolatility;
  readonly initial_collection_path: "manual_capture_first";
  readonly terms_review_required: true;
  /** All eight sources are deliberately blocked for production at rehearsal start. */
  readonly terms_review_status: "not_reviewed";
  readonly technical_classification: "unknown";
}

export interface M4CohortManifest {
  readonly manifest_version: typeof M4_REHEARSAL_VERSION;
  readonly registry_id: typeof M4_COHORT_REGISTRY_ID;
  readonly registry_version: typeof M4_COHORT_VERSION;
  readonly duration_days: typeof M4_PLANNED_WINDOW_DAYS;
  readonly sources: readonly M4CohortSource[];
  readonly source_ids: readonly M4SourceId[];
  readonly manifest_hash: string;
  /** A manifest is metadata only; it is never evidence. */
  readonly representation_kind: "contract_manifest";
}

const SOURCE_DEFINITIONS: readonly Omit<M4CohortSource, "source_id">[] = [
  {
    role: "regulator",
    volatility: "low",
    initial_collection_path: "manual_capture_first",
    terms_review_required: true,
    terms_review_status: "not_reviewed",
    technical_classification: "unknown",
  },
  {
    role: "issuer_blocked_cluster",
    volatility: "high",
    initial_collection_path: "manual_capture_first",
    terms_review_required: true,
    terms_review_status: "not_reviewed",
    technical_classification: "unknown",
  },
  {
    role: "issuer_high_value",
    volatility: "medium",
    initial_collection_path: "manual_capture_first",
    terms_review_required: true,
    terms_review_status: "not_reviewed",
    technical_classification: "unknown",
  },
  {
    role: "qr_wallet",
    volatility: "high",
    initial_collection_path: "manual_capture_first",
    terms_review_required: true,
    terms_review_status: "not_reviewed",
    technical_classification: "unknown",
  },
  {
    role: "qr_wallet",
    volatility: "high",
    initial_collection_path: "manual_capture_first",
    terms_review_required: true,
    terms_review_status: "not_reviewed",
    technical_classification: "unknown",
  },
  {
    role: "campaign_directory",
    volatility: "very_high",
    initial_collection_path: "manual_capture_first",
    terms_review_required: true,
    terms_review_status: "not_reviewed",
    technical_classification: "unknown",
  },
  {
    role: "campaign_directory",
    volatility: "very_high",
    initial_collection_path: "manual_capture_first",
    terms_review_required: true,
    terms_review_status: "not_reviewed",
    technical_classification: "unknown",
  },
  {
    role: "merchant",
    volatility: "high",
    initial_collection_path: "manual_capture_first",
    terms_review_required: true,
    terms_review_status: "not_reviewed",
    technical_classification: "unknown",
  },
];

function manifestPayload(): Omit<M4CohortManifest, "manifest_hash"> {
  const sources = M4_COHORT_SOURCE_IDS.map((source_id, index) => ({
    source_id,
    ...(SOURCE_DEFINITIONS[index] as Omit<M4CohortSource, "source_id">),
  }));
  return {
    manifest_version: M4_REHEARSAL_VERSION,
    registry_id: M4_COHORT_REGISTRY_ID,
    registry_version: M4_COHORT_VERSION,
    duration_days: M4_PLANNED_WINDOW_DAYS,
    sources,
    source_ids: [...M4_COHORT_SOURCE_IDS],
    representation_kind: "contract_manifest",
  };
}

export function createM4CohortManifest(): M4CohortManifest {
  const payload = manifestPayload();
  return deepFreeze({
    ...payload,
    manifest_hash: canonicalSha256(
      payload as unknown as Parameters<typeof canonicalSha256>[0],
    ),
  });
}

export const M4_COHORT_MANIFEST = createM4CohortManifest();
export const M4_COHORT_MANIFEST_HASH = M4_COHORT_MANIFEST.manifest_hash;

export type CohortDriftCode =
  | "manifest_hash_mismatch"
  | "source_count_mismatch"
  | "source_order_mismatch"
  | "source_id_mismatch"
  | "source_definition_mismatch"
  | "source_ids_not_unique"
  | "duration_mismatch"
  | "version_mismatch";

export interface CohortDrift {
  readonly code: CohortDriftCode;
  readonly index: number | null;
  readonly expected: string | number | null;
  readonly actual: string | number | null;
  readonly detail: string;
}

export interface CohortValidationResult {
  readonly valid: boolean;
  readonly drifts: readonly CohortDrift[];
}

function sourceDefinitionKey(source: M4CohortSource): string {
  return JSON.stringify({
    source_id: source.source_id,
    role: source.role,
    volatility: source.volatility,
    initial_collection_path: source.initial_collection_path,
    terms_review_required: source.terms_review_required,
    terms_review_status: source.terms_review_status,
    technical_classification: source.technical_classification,
  });
}

export function validateM4Cohort(
  candidate: M4CohortManifest | readonly string[],
): CohortValidationResult {
  const drifts: CohortDrift[] = [];
  if (Array.isArray(candidate)) {
    if (candidate.length !== M4_COHORT_SOURCE_IDS.length) {
      drifts.push({
        code: "source_count_mismatch",
        index: null,
        expected: M4_COHORT_SOURCE_IDS.length,
        actual: candidate.length,
        detail: "The rehearsal cohort has exactly eight ordered source IDs.",
      });
    }
    const unique = new Set(candidate);
    if (unique.size !== candidate.length) {
      drifts.push({
        code: "source_ids_not_unique",
        index: null,
        expected: M4_COHORT_SOURCE_IDS.length,
        actual: unique.size,
        detail: "Duplicate source IDs cannot establish cohort coverage.",
      });
    }
    for (let index = 0; index < M4_COHORT_SOURCE_IDS.length; index += 1) {
      const expected = M4_COHORT_SOURCE_IDS[index] ?? null;
      const actual = candidate[index] ?? null;
      if (actual !== expected) {
        drifts.push({
          code: "source_order_mismatch",
          index,
          expected,
          actual,
          detail: "The fixed cohort order is part of the rehearsal contract.",
        });
      }
    }
    return deepFreeze({ valid: drifts.length === 0, drifts });
  }

  const manifest = candidate as M4CohortManifest;
  if (manifest.manifest_version !== M4_REHEARSAL_VERSION) {
    drifts.push({
      code: "version_mismatch",
      index: null,
      expected: M4_REHEARSAL_VERSION,
      actual: manifest.manifest_version,
      detail: "Only the M4 rehearsal manifest version is accepted.",
    });
  }
  if (manifest.registry_version !== M4_COHORT_VERSION) {
    drifts.push({
      code: "version_mismatch",
      index: null,
      expected: M4_COHORT_VERSION,
      actual: manifest.registry_version,
      detail: "The source-maintenance pilot registry version is pinned.",
    });
  }
  if (manifest.registry_id !== M4_COHORT_REGISTRY_ID) {
    drifts.push({
      code: "version_mismatch",
      index: null,
      expected: M4_COHORT_REGISTRY_ID,
      actual: manifest.registry_id,
      detail: "The source-maintenance pilot registry identifier is pinned.",
    });
  }
  if (manifest.duration_days !== M4_PLANNED_WINDOW_DAYS) {
    drifts.push({
      code: "duration_mismatch",
      index: null,
      expected: M4_PLANNED_WINDOW_DAYS,
      actual: manifest.duration_days,
      detail: "The planned comparison window is thirty days.",
    });
  }
  if (manifest.sources.length !== M4_COHORT_SOURCE_IDS.length) {
    drifts.push({
      code: "source_count_mismatch",
      index: null,
      expected: M4_COHORT_SOURCE_IDS.length,
      actual: manifest.sources.length,
      detail: "The rehearsal manifest has exactly eight source entries.",
    });
  }
  if (
    manifest.source_ids.length !== M4_COHORT_SOURCE_IDS.length ||
    manifest.source_ids.some(
      (sourceId, index) => sourceId !== M4_COHORT_SOURCE_IDS[index],
    )
  ) {
    drifts.push({
      code: "source_order_mismatch",
      index: null,
      expected: M4_COHORT_SOURCE_IDS.join(","),
      actual: manifest.source_ids.join(","),
      detail: "The manifest source_ids must match the fixed ordered cohort.",
    });
  }
  const sourceIds = manifest.sources.map((source) => source.source_id);
  if (new Set(sourceIds).size !== sourceIds.length) {
    drifts.push({
      code: "source_ids_not_unique",
      index: null,
      expected: M4_COHORT_SOURCE_IDS.length,
      actual: new Set(sourceIds).size,
      detail: "Duplicate source entries cannot establish source coverage.",
    });
  }
  for (let index = 0; index < M4_COHORT_SOURCE_IDS.length; index += 1) {
    const expected = M4_COHORT_MANIFEST.sources[index];
    const actual = manifest.sources[index];
    if (
      actual &&
      expected &&
      sourceDefinitionKey(actual) !== sourceDefinitionKey(expected)
    ) {
      drifts.push({
        code: "source_definition_mismatch",
        index,
        expected: sourceDefinitionKey(expected),
        actual: sourceDefinitionKey(actual),
        detail:
          "Source role, volatility, permission, and technical states are pinned.",
      });
    }
  }
  if (
    manifest.manifest_hash !== M4_COHORT_MANIFEST_HASH ||
    !verifyCanonicalHash(
      manifest as unknown as Record<string, unknown>,
      "manifest_hash",
    )
  ) {
    drifts.push({
      code: "manifest_hash_mismatch",
      index: null,
      expected: M4_COHORT_MANIFEST_HASH,
      actual: manifest.manifest_hash,
      detail: "The manifest hash must cover the ordered source definitions.",
    });
  }
  return deepFreeze({ valid: drifts.length === 0, drifts });
}

export function assertM4Cohort(
  candidate: M4CohortManifest | readonly string[],
): asserts candidate is M4CohortManifest | readonly string[] {
  const result = validateM4Cohort(candidate);
  if (!result.valid) {
    throw new Error(
      `M4 cohort drift: ${result.drifts.map((drift) => drift.code).join(", ")}`,
    );
  }
}

export function isM4SourceId(value: string): value is M4SourceId {
  return (M4_COHORT_SOURCE_IDS as readonly string[]).includes(value);
}
