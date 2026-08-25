import { hashCanonical } from "./canonical.js";
import { compileP0SpendRuleSet } from "./p0-spend-rules.js";
import { deepFreeze, scanPublicValue } from "./security.js";

export const PRODUCTION_EXCHANGE_DIRECTORY_SNAPSHOT_VERSION =
  "production-exchange-directory-snapshot.v1" as const;
export const PRODUCTION_EXCHANGE_DIRECTORY_RECONCILIATION_VERSION =
  "production-exchange-directory-reconciliation.v1" as const;

export type ProductionExchangeDirectoryDisposition =
  | "exact_executable"
  | "incomplete_parameters"
  | "inactive"
  | "informational_excluded";

export interface ProductionExchangeDirectoryResearchRequest {
  readonly missing_fields: readonly string[];
  readonly question_ja: string;
}

export interface ProductionExchangeDirectoryEntry {
  readonly entry_id: string;
  readonly destination_asset_id: string;
  readonly disposition: ProductionExchangeDirectoryDisposition;
  readonly primary_claim_id: string | null;
  readonly claims: readonly Readonly<Record<string, unknown>>[];
  readonly research_request: ProductionExchangeDirectoryResearchRequest | null;
}

export interface ProductionExchangeDirectorySnapshot {
  readonly version: typeof PRODUCTION_EXCHANGE_DIRECTORY_SNAPSHOT_VERSION;
  readonly directory_id: string;
  readonly family_id: string;
  readonly source_role_id: string;
  readonly source_asset_id: string;
  /** True only when the producer enumerated the complete current directory. */
  readonly complete: boolean;
  readonly sources: readonly Readonly<Record<string, unknown>>[];
  readonly entries: readonly ProductionExchangeDirectoryEntry[];
}

export interface ProductionExchangeDirectoryOutcome {
  readonly entry_id: string;
  readonly destination_asset_id: string;
  readonly disposition: ProductionExchangeDirectoryDisposition;
  readonly rule_ids: readonly string[];
  readonly research_request: ProductionExchangeDirectoryResearchRequest | null;
}

export interface ProductionExchangeDirectoryReconciliation {
  readonly version: typeof PRODUCTION_EXCHANGE_DIRECTORY_RECONCILIATION_VERSION;
  readonly snapshot: ProductionExchangeDirectorySnapshot;
  readonly outcomes: readonly ProductionExchangeDirectoryOutcome[];
  readonly affected_asset_ids: readonly string[];
  readonly affected_rule_ids: readonly string[];
  readonly snapshot_hash: `sha256:${string}`;
}

type JsonRecord = Record<string, unknown>;

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const CLAIM_ID = /^claim\.[A-Za-z0-9._:-]{1,240}$/u;
const ENTRY_KEYS = Object.freeze([
  "claims",
  "destination_asset_id",
  "disposition",
  "entry_id",
  "primary_claim_id",
  "research_request",
] as const);
const SNAPSHOT_KEYS = Object.freeze([
  "complete",
  "directory_id",
  "entries",
  "family_id",
  "source_asset_id",
  "source_role_id",
  "sources",
  "version",
] as const);
const RESEARCH_KEYS = Object.freeze(["missing_fields", "question_ja"] as const);

function record(value: unknown, code: string): JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new TypeError(code);
  return value as JsonRecord;
}

function exactKeys(
  value: JsonRecord,
  expected: readonly string[],
  code: string,
): void {
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (
    keys.length !== wanted.length ||
    keys.some((key, index) => key !== wanted[index])
  )
    throw new TypeError(code);
}

function identifier(value: unknown, code: string): string {
  if (typeof value !== "string" || !IDENTIFIER.test(value))
    throw new TypeError(code);
  return value;
}

function sortedUniqueStrings(
  value: unknown,
  code: string,
  maximum = 64,
): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > maximum ||
    value.some((item) => typeof item !== "string" || !IDENTIFIER.test(item)) ||
    new Set(value).size !== value.length
  )
    throw new TypeError(code);
  return Object.freeze([...value].sort());
}

function researchRequest(
  value: unknown,
  required: boolean,
): ProductionExchangeDirectoryResearchRequest | null {
  if (value === null && !required) return null;
  const candidate = record(
    value,
    "exchange_directory_research_request_invalid",
  );
  exactKeys(
    candidate,
    RESEARCH_KEYS,
    "exchange_directory_research_request_invalid",
  );
  const question = candidate.question_ja;
  if (
    typeof question !== "string" ||
    question.length === 0 ||
    question.length > 500
  )
    throw new TypeError("exchange_directory_research_request_invalid");
  return Object.freeze({
    missing_fields: sortedUniqueStrings(
      candidate.missing_fields,
      "exchange_directory_research_request_invalid",
    ),
    question_ja: question,
  });
}

function normalizeSnapshot(
  input: unknown,
): ProductionExchangeDirectorySnapshot {
  const scan = scanPublicValue(input);
  if (!scan.valid) throw new TypeError("exchange_directory_snapshot_invalid");
  const candidate = record(scan.value, "exchange_directory_snapshot_invalid");
  exactKeys(candidate, SNAPSHOT_KEYS, "exchange_directory_snapshot_invalid");
  if (
    candidate.version !== PRODUCTION_EXCHANGE_DIRECTORY_SNAPSHOT_VERSION ||
    typeof candidate.complete !== "boolean" ||
    !Array.isArray(candidate.sources) ||
    candidate.sources.length === 0 ||
    candidate.sources.length > 64 ||
    !Array.isArray(candidate.entries) ||
    candidate.entries.length === 0 ||
    candidate.entries.length > 256
  )
    throw new TypeError("exchange_directory_snapshot_invalid");

  const directoryId = identifier(
    candidate.directory_id,
    "exchange_directory_directory_id_invalid",
  );
  const familyId = identifier(
    candidate.family_id,
    "exchange_directory_family_id_invalid",
  );
  const sourceRoleId = identifier(
    candidate.source_role_id,
    "exchange_directory_source_role_id_invalid",
  );
  const sourceAssetId = identifier(
    candidate.source_asset_id,
    "exchange_directory_source_asset_id_invalid",
  );
  const sources = Object.freeze(
    candidate.sources.map((source) =>
      Object.freeze({ ...record(source, "exchange_directory_source_invalid") }),
    ),
  );
  const sourceIds = new Set<string>();
  for (const source of sources) {
    const sourceId = identifier(
      source.source_id,
      "exchange_directory_source_invalid",
    );
    if (sourceIds.has(sourceId))
      throw new TypeError("exchange_directory_source_duplicate");
    sourceIds.add(sourceId);
    if (
      source.family_id !== familyId ||
      !Array.isArray(source.roles) ||
      !source.roles.includes(sourceRoleId)
    )
      throw new TypeError("exchange_directory_source_binding_invalid");
  }

  const seenEntries = new Set<string>();
  const entries = candidate.entries.map((rawEntry) => {
    const entry = record(rawEntry, "exchange_directory_entry_invalid");
    exactKeys(entry, ENTRY_KEYS, "exchange_directory_entry_invalid");
    const entryId = identifier(
      entry.entry_id,
      "exchange_directory_entry_id_invalid",
    );
    if (seenEntries.has(entryId))
      throw new TypeError("exchange_directory_entry_duplicate");
    seenEntries.add(entryId);
    const destinationAssetId = identifier(
      entry.destination_asset_id,
      "exchange_directory_destination_asset_id_invalid",
    );
    const disposition = entry.disposition;
    if (
      disposition !== "exact_executable" &&
      disposition !== "incomplete_parameters" &&
      disposition !== "inactive" &&
      disposition !== "informational_excluded"
    )
      throw new TypeError("exchange_directory_disposition_invalid");
    if (!Array.isArray(entry.claims) || entry.claims.length > 16)
      throw new TypeError("exchange_directory_claims_invalid");
    const claims = Object.freeze(
      entry.claims.map((claim) =>
        Object.freeze({ ...record(claim, "exchange_directory_claim_invalid") }),
      ),
    );
    const primaryClaimId = entry.primary_claim_id;
    if (
      primaryClaimId !== null &&
      (typeof primaryClaimId !== "string" || !CLAIM_ID.test(primaryClaimId))
    )
      throw new TypeError("exchange_directory_primary_claim_id_invalid");
    const request = researchRequest(
      entry.research_request,
      disposition === "incomplete_parameters",
    );
    if (
      disposition === "exact_executable" &&
      (primaryClaimId === null || claims.length === 0)
    )
      throw new TypeError("exchange_directory_executable_claim_missing");
    if (disposition !== "exact_executable" && claims.length > 0)
      throw new TypeError("exchange_directory_nonexecutable_claims_present");
    return Object.freeze({
      entry_id: entryId,
      destination_asset_id: destinationAssetId,
      disposition,
      primary_claim_id: primaryClaimId,
      claims,
      research_request: request,
    }) as ProductionExchangeDirectoryEntry;
  });

  return deepFreeze({
    version: PRODUCTION_EXCHANGE_DIRECTORY_SNAPSHOT_VERSION,
    directory_id: directoryId,
    family_id: familyId,
    source_role_id: sourceRoleId,
    source_asset_id: sourceAssetId,
    complete: candidate.complete,
    sources,
    entries: entries.sort((left, right) =>
      left.entry_id.localeCompare(right.entry_id),
    ),
  }) as ProductionExchangeDirectorySnapshot;
}

/**
 * Validate one complete or partial official-directory enumeration and compile
 * every exact entry through the same graph compiler used by recommendations.
 * An entry cannot call itself executable merely because a producer says so.
 */
export function reconcileProductionExchangeDirectory(
  input: unknown,
): ProductionExchangeDirectoryReconciliation {
  const snapshot = normalizeSnapshot(input);
  const outcomes: ProductionExchangeDirectoryOutcome[] = [];
  const affectedRuleIds = new Set<string>();
  const affectedAssetIds = new Set<string>([snapshot.source_asset_id]);
  for (const entry of snapshot.entries) {
    affectedAssetIds.add(entry.destination_asset_id);
    let ruleIds: readonly string[] = Object.freeze([]);
    if (entry.disposition === "exact_executable") {
      const compiled = compileP0SpendRuleSet([
        {
          metadata: {
            artifact_id: `agent-feed.exchange-directory.${snapshot.directory_id}`,
          },
          sources: snapshot.sources,
          claims: entry.claims,
        },
      ]);
      const disposition = compiled.dispositions.find(
        (item) => item.claim_id === entry.primary_claim_id,
      );
      if (!disposition || disposition.status !== "executable")
        throw new TypeError("exchange_directory_claim_not_executable");
      ruleIds = Object.freeze([...disposition.derived_rule_ids].sort());
      const rules = compiled.rules.filter((rule) =>
        ruleIds.includes(rule.rule_id),
      );
      if (
        rules.length !== ruleIds.length ||
        rules.some(
          (rule) =>
            rule.source_asset.asset_id !== snapshot.source_asset_id ||
            rule.destination_asset.asset_id !== entry.destination_asset_id,
        )
      )
        throw new TypeError("exchange_directory_asset_binding_invalid");
      for (const ruleId of ruleIds) affectedRuleIds.add(ruleId);
    }
    outcomes.push(
      Object.freeze({
        entry_id: entry.entry_id,
        destination_asset_id: entry.destination_asset_id,
        disposition: entry.disposition,
        rule_ids: ruleIds,
        research_request: entry.research_request,
      }),
    );
  }
  const projection = {
    version: PRODUCTION_EXCHANGE_DIRECTORY_RECONCILIATION_VERSION,
    snapshot,
    outcomes: Object.freeze(outcomes),
    affected_asset_ids: Object.freeze([...affectedAssetIds].sort()),
    affected_rule_ids: Object.freeze([...affectedRuleIds].sort()),
  };
  return deepFreeze({
    ...projection,
    snapshot_hash: hashCanonical(snapshot),
  }) as ProductionExchangeDirectoryReconciliation;
}
