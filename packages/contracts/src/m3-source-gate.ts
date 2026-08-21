import type {
  SourceAccessObservation,
  TrustedSource,
  TrustedSourceRegistry,
} from "./types.js";

/**
 * The seed blueprint is intentionally narrower than a GoldenScenario.  The
 * M3 gate only needs the scenario identifier and the sources named by the
 * research plan; operation facts and evidence are downstream concerns.
 */
export interface M3SeedScenarioBlueprint {
  scenario_id: string;
  primary_source_ids: readonly string[];
}

export interface M3SeedBlueprintDocument {
  scenarios: readonly M3SeedScenarioBlueprint[];
}

/**
 * The review queue is a YAML work queue rather than a Draft schema document.
 * Keep its gate-facing contract deliberately small and use strings for the
 * status fields so an unknown future value fails closed at runtime.
 */
export interface SourceReviewQueueItem {
  source_id: string;
  current_automation_status: string;
  current_terms_review_status: string;
}

export interface SourceReviewQueueDocument {
  items: readonly SourceReviewQueueItem[];
}

export interface SourceAccessObservationDocument {
  observations: readonly SourceAccessObservation[];
}

export type M3SeedBlueprintInput =
  | M3SeedBlueprintDocument
  | readonly M3SeedScenarioBlueprint[];
export type SourceReviewQueueInput =
  | SourceReviewQueueDocument
  | readonly SourceReviewQueueItem[];
export type SourceAccessObservationInput =
  | SourceAccessObservationDocument
  | readonly SourceAccessObservation[];

export interface M3SourceGateInput {
  blueprints: M3SeedBlueprintInput;
  registry: TrustedSourceRegistry;
  review_queue: SourceReviewQueueInput;
  access_observations: SourceAccessObservationInput;
}

export type SourceReadinessBlockerCode =
  | "missing_registry_source"
  | "duplicate_registry_source_id"
  | "missing_review_queue_item"
  | "duplicate_review_queue_source_id"
  | "registry_terms_not_reviewed"
  | "registry_terms_not_approved"
  | "review_queue_terms_not_reviewed"
  | "review_queue_terms_not_approved"
  | "registry_automation_not_permitted"
  | "review_queue_automation_not_permitted"
  | "registry_collection_path_not_permitted"
  | "review_queue_collection_path_not_permitted"
  | "technical_feasibility_unknown"
  | "technical_observation_missing"
  | "technical_observation_unknown"
  | "technical_observation_source_mismatch"
  | "technical_observation_aggregate_only"
  | "technical_observation_not_reachable"
  | "manual_reachability_only"
  | "technical_feasibility_not_automatable"
  | "duplicate_observation_id"
  | "empty_primary_source_ids"
  | "duplicate_scenario_id"
  | "duplicate_scenario_source_id";

export interface M3SourceGateBlocker {
  code: SourceReadinessBlockerCode;
  source_id: string | null;
  scenario_id: string | null;
  detail: string;
}

export type M3SourceReadinessStatus = "ready" | "blocked";

export interface M3SourceReadiness {
  source_id: string;
  status: M3SourceReadinessStatus;
  registry_source_found: boolean;
  review_queue_item_found: boolean;
  registry_terms_review_status: string | null;
  review_queue_terms_review_status: string | null;
  registry_automation_status: string | null;
  review_queue_automation_status: string | null;
  technical_classification: string | null;
  declared_observation_ids: readonly string[];
  per_source_observation_ids: readonly string[];
  automation_ready: boolean;
  promotion_ready: boolean;
  blockers: readonly M3SourceGateBlocker[];
  automation_blockers: readonly M3SourceGateBlocker[];
  promotion_blockers: readonly M3SourceGateBlocker[];
}

export interface M3ScenarioReadiness {
  scenario_id: string;
  source_ids: readonly string[];
  automation_ready: boolean;
  promotion_ready: boolean;
  blockers: readonly M3SourceGateBlocker[];
  automation_blockers: readonly M3SourceGateBlocker[];
  promotion_blockers: readonly M3SourceGateBlocker[];
}

export interface M3SourceGateCounts {
  scenario_count: number;
  unique_source_count: number;
  automation_ready_scenario_count: number;
  automation_blocked_scenario_count: number;
  promotion_ready_scenario_count: number;
  promotion_blocked_scenario_count: number;
  automation_ready_source_count: number;
  automation_blocked_source_count: number;
  promotion_ready_source_count: number;
  promotion_blocked_source_count: number;
  blocker_count: number;
  blocker_counts: Readonly<Record<SourceReadinessBlockerCode, number>>;
  promotion_blocker_count: number;
  promotion_blocker_counts: Readonly<
    Record<SourceReadinessBlockerCode, number>
  >;
}

export interface M3SourceGateResult {
  automation_ready: boolean;
  promotion_ready: boolean;
  source_readiness: readonly M3SourceReadiness[];
  scenario_readiness: readonly M3ScenarioReadiness[];
  blockers: readonly M3SourceGateBlocker[];
  promotion_blockers: readonly M3SourceGateBlocker[];
  counts: M3SourceGateCounts;
}

const BLOCKER_CODES: readonly SourceReadinessBlockerCode[] = [
  "missing_registry_source",
  "duplicate_registry_source_id",
  "missing_review_queue_item",
  "duplicate_review_queue_source_id",
  "registry_terms_not_reviewed",
  "registry_terms_not_approved",
  "review_queue_terms_not_reviewed",
  "review_queue_terms_not_approved",
  "registry_automation_not_permitted",
  "review_queue_automation_not_permitted",
  "registry_collection_path_not_permitted",
  "review_queue_collection_path_not_permitted",
  "technical_feasibility_unknown",
  "technical_observation_missing",
  "technical_observation_unknown",
  "technical_observation_source_mismatch",
  "technical_observation_aggregate_only",
  "technical_observation_not_reachable",
  "manual_reachability_only",
  "technical_feasibility_not_automatable",
  "duplicate_observation_id",
  "empty_primary_source_ids",
  "duplicate_scenario_id",
  "duplicate_scenario_source_id",
];

const AUTOMATION_ALLOWED_STATUSES = new Set([
  "official_documentation",
  "official_api",
]);

const PROMOTION_ALLOWED_STATUSES = new Set([
  "manual_only",
  "official_documentation",
  "official_api",
]);

const AUTOMATION_TECHNICAL_CLASSES = new Set([
  "plain_http_observed_reachable",
  "partner_feed_candidate",
]);

const NON_MANUAL_REACHABILITY_METHODS = new Set([
  "plain_http",
  "official_api",
  "partner_feed",
]);

const MANUAL_REACHABILITY_METHODS = new Set([
  "manual_browser",
  "browser_session",
]);

const PROMOTION_COMMON_BLOCKERS = new Set<SourceReadinessBlockerCode>([
  "missing_registry_source",
  "duplicate_registry_source_id",
  "missing_review_queue_item",
  "duplicate_review_queue_source_id",
  "registry_terms_not_reviewed",
  "registry_terms_not_approved",
  "review_queue_terms_not_reviewed",
  "review_queue_terms_not_approved",
]);

function blueprintsOf(
  input: M3SeedBlueprintInput,
): readonly M3SeedScenarioBlueprint[] {
  return "scenarios" in input ? input.scenarios : input;
}

function queueItemsOf(
  input: SourceReviewQueueInput,
): readonly SourceReviewQueueItem[] {
  return "items" in input ? input.items : input;
}

function observationsOf(
  input: SourceAccessObservationInput,
): readonly SourceAccessObservation[] {
  return "observations" in input ? input.observations : input;
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function indexById<T>(
  values: readonly T[],
  idOf: (value: T) => string,
): { first: ReadonlyMap<string, T>; duplicates: ReadonlySet<string> } {
  const first = new Map<string, T>();
  const duplicates = new Set<string>();
  for (const value of values) {
    const id = idOf(value);
    if (first.has(id)) duplicates.add(id);
    else first.set(id, value);
  }
  return { first, duplicates };
}

function blocker(
  code: SourceReadinessBlockerCode,
  sourceId: string | null,
  scenarioId: string | null,
  detail: string,
): M3SourceGateBlocker {
  return {
    code,
    source_id: sourceId,
    scenario_id: scenarioId,
    detail,
  };
}

function blockerSort(
  left: M3SourceGateBlocker,
  right: M3SourceGateBlocker,
): number {
  return (
    left.code.localeCompare(right.code) ||
    (left.source_id ?? "").localeCompare(right.source_id ?? "") ||
    (left.scenario_id ?? "").localeCompare(right.scenario_id ?? "") ||
    left.detail.localeCompare(right.detail)
  );
}

function isTermsApproved(status: string | null): boolean {
  return status === "approved" || status === "not_applicable";
}

function addTermsBlocker(
  blockers: M3SourceGateBlocker[],
  status: string | null,
  sourceId: string,
  field: "registry" | "review_queue",
): void {
  if (isTermsApproved(status)) return;
  const code =
    field === "registry"
      ? status === "not_reviewed"
        ? "registry_terms_not_reviewed"
        : "registry_terms_not_approved"
      : status === "not_reviewed"
        ? "review_queue_terms_not_reviewed"
        : "review_queue_terms_not_approved";
  blockers.push(
    blocker(
      code,
      sourceId,
      null,
      `${field} terms review status ${status ?? "missing"} does not permit automated collection or promotion`,
    ),
  );
}

function addAutomationStatusBlocker(
  blockers: M3SourceGateBlocker[],
  status: string | null,
  sourceId: string,
  field: "registry" | "review_queue",
): void {
  if (status !== null && AUTOMATION_ALLOWED_STATUSES.has(status)) return;
  blockers.push(
    blocker(
      field === "registry"
        ? "registry_automation_not_permitted"
        : "review_queue_automation_not_permitted",
      sourceId,
      null,
      `${field} automation status ${status ?? "missing"} is not an approved automated collection path`,
    ),
  );
}

function addPromotionStatusBlocker(
  blockers: M3SourceGateBlocker[],
  status: string | null,
  sourceId: string,
  field: "registry" | "review_queue",
): void {
  if (status !== null && PROMOTION_ALLOWED_STATUSES.has(status)) return;
  blockers.push(
    blocker(
      field === "registry"
        ? "registry_collection_path_not_permitted"
        : "review_queue_collection_path_not_permitted",
      sourceId,
      null,
      `${field} collection path status ${status ?? "missing"} does not permit source promotion`,
    ),
  );
}

interface TechnicalAssessment {
  technical_classification: string | null;
  declared_observation_ids: readonly string[];
  per_source_observation_ids: readonly string[];
  blockers: M3SourceGateBlocker[];
}

function assessTechnicalReadiness(
  sourceId: string,
  source: TrustedSource | undefined,
  observationsById: ReadonlyMap<string, SourceAccessObservation>,
  duplicateObservationIds: ReadonlySet<string>,
): TechnicalAssessment {
  const technical = source?.access.technical_feasibility;
  const classification = technical?.current_classification ?? null;
  const declaredObservationIds = technical?.observation_ids
    ? [...technical.observation_ids]
    : [];
  const blockers: M3SourceGateBlocker[] = [];
  const perSourceObservationIds: string[] = [];
  const perSourceObservations: SourceAccessObservation[] = [];

  if (!source) {
    return {
      technical_classification: null,
      declared_observation_ids: [],
      per_source_observation_ids: [],
      blockers,
    };
  }

  if (classification === "unknown" || classification === null) {
    blockers.push(
      blocker(
        "technical_feasibility_unknown",
        sourceId,
        null,
        "technical feasibility is unknown; automation must fail closed",
      ),
    );
  }

  if (declaredObservationIds.length === 0) {
    blockers.push(
      blocker(
        "technical_observation_missing",
        sourceId,
        null,
        "no source-access observation is declared for the technical classification",
      ),
    );
  }

  for (const observationId of declaredObservationIds) {
    if (duplicateObservationIds.has(observationId)) {
      // A duplicate ID is malformed evidence, even if one of the duplicate
      // records happens to be reachable. Do not inspect either record: doing
      // so would make readiness depend on input order.
      blockers.push(
        blocker(
          "duplicate_observation_id",
          sourceId,
          null,
          `technical observation ID ${observationId} appears more than once`,
        ),
      );
      continue;
    }
    const observation = observationsById.get(observationId);
    if (!observation) {
      blockers.push(
        blocker(
          "technical_observation_unknown",
          sourceId,
          null,
          `technical observation ${observationId} is not present in the supplied observation records`,
        ),
      );
      continue;
    }

    const explicitlyCoversSource = observation.source_ids.includes(sourceId);
    const isPerSourceScope =
      (observation.scope === "single_source" ||
        observation.scope === "source_group") &&
      explicitlyCoversSource;

    // Registry-wide aggregate observations are intentionally never accepted as
    // per-source technical state, even if their source_ids happen to list the
    // source. This keeps reachability counts from becoming permissions.
    if (!isPerSourceScope) {
      blockers.push(
        blocker(
          observation.scope === "single_source" ||
            observation.scope === "source_group"
            ? "technical_observation_source_mismatch"
            : "technical_observation_aggregate_only",
          sourceId,
          null,
          observation.scope === "single_source" ||
            observation.scope === "source_group"
            ? `technical observation ${observationId} does not cover this source ID`
            : `technical observation ${observationId} is aggregate and cannot establish per-source state`,
        ),
      );
      continue;
    }

    perSourceObservationIds.push(observationId);
    perSourceObservations.push(observation);
    if (observation.result !== "reachable") {
      blockers.push(
        blocker(
          "technical_observation_not_reachable",
          sourceId,
          null,
          `technical observation ${observationId} reports ${observation.result}, not reachable`,
        ),
      );
    }
  }

  if (
    declaredObservationIds.length > 0 &&
    perSourceObservationIds.length === 0
  ) {
    // The specific aggregate-only blocker above explains the evidence gap. Do
    // not add a second generic blocker for unknown/missing references, since
    // those already have their own stable reason codes.
  }

  const reachable = perSourceObservations.filter(
    (observation) => observation.result === "reachable",
  );
  const nonManualReachable = reachable.some((observation) =>
    NON_MANUAL_REACHABILITY_METHODS.has(observation.method),
  );
  const manualReachable = reachable.some((observation) =>
    MANUAL_REACHABILITY_METHODS.has(observation.method),
  );

  if (
    classification === "plain_http_observed_reachable" &&
    !nonManualReachable
  ) {
    blockers.push(
      blocker(
        manualReachable
          ? "manual_reachability_only"
          : "technical_feasibility_not_automatable",
        sourceId,
        null,
        manualReachable
          ? "manual/browser reachability does not grant automated collection permission"
          : "no non-manual reachable observation supports automated collection",
      ),
    );
  }

  if (
    classification === "partner_feed_candidate" &&
    !reachable.some((observation) => observation.method === "partner_feed")
  ) {
    blockers.push(
      blocker(
        "technical_feasibility_not_automatable",
        sourceId,
        null,
        "partner-feed candidacy has no reachable partner-feed observation",
      ),
    );
  }

  if (
    classification !== null &&
    classification !== "unknown" &&
    !AUTOMATION_TECHNICAL_CLASSES.has(classification)
  ) {
    blockers.push(
      blocker(
        "technical_feasibility_not_automatable",
        sourceId,
        null,
        `technical classification ${classification} does not establish an automated collection path`,
      ),
    );
  }

  return {
    technical_classification: classification,
    declared_observation_ids: declaredObservationIds,
    per_source_observation_ids: sortedUnique(perSourceObservationIds),
    blockers,
  };
}

function assessSource(
  sourceId: string,
  registryIndex: ReadonlyMap<string, TrustedSource>,
  registryDuplicates: ReadonlySet<string>,
  queueIndex: ReadonlyMap<string, SourceReviewQueueItem>,
  queueDuplicates: ReadonlySet<string>,
  observationsById: ReadonlyMap<string, SourceAccessObservation>,
  duplicateObservationIds: ReadonlySet<string>,
): M3SourceReadiness {
  const source = registryIndex.get(sourceId);
  const queueItem = queueIndex.get(sourceId);
  const blockers: M3SourceGateBlocker[] = [];

  if (!source) {
    blockers.push(
      blocker(
        "missing_registry_source",
        sourceId,
        null,
        "blueprint source ID does not resolve in the trusted-source registry",
      ),
    );
  }
  if (registryDuplicates.has(sourceId)) {
    blockers.push(
      blocker(
        "duplicate_registry_source_id",
        sourceId,
        null,
        "trusted-source registry contains more than one record for this source ID",
      ),
    );
  }
  if (!queueItem) {
    blockers.push(
      blocker(
        "missing_review_queue_item",
        sourceId,
        null,
        "blueprint source ID does not resolve in the source-review queue",
      ),
    );
  }
  if (queueDuplicates.has(sourceId)) {
    blockers.push(
      blocker(
        "duplicate_review_queue_source_id",
        sourceId,
        null,
        "source-review queue contains more than one item for this source ID",
      ),
    );
  }

  const registryTerms = source?.access.terms_review_status ?? null;
  const queueTerms = queueItem?.current_terms_review_status ?? null;
  if (source) addTermsBlocker(blockers, registryTerms, sourceId, "registry");
  else addTermsBlocker(blockers, null, sourceId, "registry");
  if (queueItem)
    addTermsBlocker(blockers, queueTerms, sourceId, "review_queue");
  else addTermsBlocker(blockers, null, sourceId, "review_queue");

  const registryAutomation = source?.access.automation_status ?? null;
  const queueAutomation = queueItem?.current_automation_status ?? null;
  addAutomationStatusBlocker(
    blockers,
    registryAutomation,
    sourceId,
    "registry",
  );
  addAutomationStatusBlocker(
    blockers,
    queueAutomation,
    sourceId,
    "review_queue",
  );

  const promotionStatusBlockers: M3SourceGateBlocker[] = [];
  addPromotionStatusBlocker(
    promotionStatusBlockers,
    registryAutomation,
    sourceId,
    "registry",
  );
  addPromotionStatusBlocker(
    promotionStatusBlockers,
    queueAutomation,
    sourceId,
    "review_queue",
  );

  const technical = assessTechnicalReadiness(
    sourceId,
    source,
    observationsById,
    duplicateObservationIds,
  );
  blockers.push(...technical.blockers);

  const sortedBlockers = blockers.sort(blockerSort);
  const hasManualCollectionPath =
    registryAutomation === "manual_only" || queueAutomation === "manual_only";
  const promotionBlockers = [
    ...sortedBlockers.filter((item) =>
      PROMOTION_COMMON_BLOCKERS.has(item.code),
    ),
    ...promotionStatusBlockers,
    ...(hasManualCollectionPath
      ? technical.blockers.filter(
          (item) => item.code === "duplicate_observation_id",
        )
      : technical.blockers),
  ].sort(blockerSort);
  const automationReady = sortedBlockers.length === 0;
  const promotionReady = promotionBlockers.length === 0;
  return {
    source_id: sourceId,
    // `status` and the legacy `blockers` field describe automation readiness.
    // Manual promotion readiness is intentionally reported separately below.
    status: automationReady ? "ready" : "blocked",
    registry_source_found: source !== undefined,
    review_queue_item_found: queueItem !== undefined,
    registry_terms_review_status: registryTerms,
    review_queue_terms_review_status: queueTerms,
    registry_automation_status: registryAutomation,
    review_queue_automation_status: queueAutomation,
    technical_classification: technical.technical_classification,
    declared_observation_ids: technical.declared_observation_ids,
    per_source_observation_ids: technical.per_source_observation_ids,
    automation_ready: automationReady,
    // This module is only the source-readiness portion of M3. Promotion-ready
    // means a permitted source collection path exists; evidence capture and
    // review still happen in the downstream M3 workflow.
    promotion_ready: promotionReady,
    blockers: sortedBlockers,
    automation_blockers: sortedBlockers,
    promotion_blockers: promotionBlockers,
  };
}

function scenarioBlocker(
  scenarioId: string,
  sourceBlockers: readonly M3SourceGateBlocker[],
): M3SourceGateBlocker[] {
  return sourceBlockers.map((item) => ({
    ...item,
    scenario_id: scenarioId,
  }));
}

function countBlockers(
  blockers: readonly M3SourceGateBlocker[],
): Readonly<Record<SourceReadinessBlockerCode, number>> {
  const counts = Object.fromEntries(
    BLOCKER_CODES.map((code) => [code, 0]),
  ) as Record<SourceReadinessBlockerCode, number>;
  for (const item of blockers) counts[item.code] += 1;
  return counts;
}

/**
 * Audit the M3 seed scenarios without fetching, modifying, approving, or
 * promoting anything. Every decision is derived from the supplied parsed
 * records and is therefore deterministic and straightforward to replay.
 */
export function auditM3SourceReadiness(
  input: M3SourceGateInput,
): M3SourceGateResult {
  const scenarios = blueprintsOf(input.blueprints);
  const queueItems = queueItemsOf(input.review_queue);
  const observations = observationsOf(input.access_observations);
  const registryIndex = indexById(
    input.registry.sources,
    (source) => source.id,
  );
  const queueIndex = indexById(queueItems, (item) => item.source_id);
  const observationIndex = indexById(
    observations,
    (observation) => observation.observation_id,
  );

  const sourceIds = sortedUnique(
    scenarios.flatMap((scenario) => scenario.primary_source_ids),
  );
  const sourceReadiness = sourceIds.map((sourceId) =>
    assessSource(
      sourceId,
      registryIndex.first,
      registryIndex.duplicates,
      queueIndex.first,
      queueIndex.duplicates,
      observationIndex.first,
      observationIndex.duplicates,
    ),
  );
  const sourceById = new Map(
    sourceReadiness.map((readiness) => [readiness.source_id, readiness]),
  );

  const scenarioIds = scenarios.map((scenario) => scenario.scenario_id);
  const duplicateScenarioIds = new Set(
    scenarioIds.filter(
      (scenarioId, index) => scenarioIds.indexOf(scenarioId) !== index,
    ),
  );
  const scenarioReadiness = [...scenarios]
    .sort((left, right) => left.scenario_id.localeCompare(right.scenario_id))
    .map((scenario) => {
      const scenarioSourceIds = sortedUnique(scenario.primary_source_ids);
      const automationBlockers = scenarioSourceIds.flatMap((sourceId) =>
        scenarioBlocker(
          scenario.scenario_id,
          sourceById.get(sourceId)?.blockers ?? [
            blocker(
              "missing_registry_source",
              sourceId,
              scenario.scenario_id,
              "source readiness record is missing",
            ),
          ],
        ),
      );
      const promotionBlockers = scenarioSourceIds.flatMap((sourceId) =>
        scenarioBlocker(
          scenario.scenario_id,
          sourceById.get(sourceId)?.promotion_blockers ?? [
            blocker(
              "missing_registry_source",
              sourceId,
              scenario.scenario_id,
              "source readiness record is missing",
            ),
          ],
        ),
      );
      if (scenarioSourceIds.length === 0)
        for (const target of [automationBlockers, promotionBlockers])
          target.push(
            blocker(
              "empty_primary_source_ids",
              null,
              scenario.scenario_id,
              "scenario must name at least one primary source",
            ),
          );
      if (duplicateScenarioIds.has(scenario.scenario_id))
        for (const target of [automationBlockers, promotionBlockers])
          target.push(
            blocker(
              "duplicate_scenario_id",
              null,
              scenario.scenario_id,
              "seed blueprint contains more than one scenario with this ID",
            ),
          );

      const duplicateSourceIds = scenario.primary_source_ids.filter(
        (sourceId, index) =>
          scenario.primary_source_ids.indexOf(sourceId) !== index,
      );
      for (const sourceId of sortedUnique(duplicateSourceIds))
        for (const target of [automationBlockers, promotionBlockers])
          target.push(
            blocker(
              "duplicate_scenario_source_id",
              sourceId,
              scenario.scenario_id,
              "scenario lists the same primary source ID more than once",
            ),
          );

      const sortedAutomationBlockers = automationBlockers.sort(blockerSort);
      const sortedPromotionBlockers = promotionBlockers.sort(blockerSort);
      return {
        scenario_id: scenario.scenario_id,
        source_ids: scenarioSourceIds,
        automation_ready: sortedAutomationBlockers.length === 0,
        promotion_ready: sortedPromotionBlockers.length === 0,
        blockers: sortedAutomationBlockers,
        automation_blockers: sortedAutomationBlockers,
        promotion_blockers: sortedPromotionBlockers,
      } satisfies M3ScenarioReadiness;
    });

  const sourceBlockers = sourceReadiness.flatMap(
    (item) => item.automation_blockers,
  );
  const sourcePromotionBlockers = sourceReadiness.flatMap(
    (item) => item.promotion_blockers,
  );
  const scenarioSpecificBlockers = scenarioReadiness.flatMap((item) =>
    item.automation_blockers.filter(
      (blockerItem) =>
        blockerItem.code === "empty_primary_source_ids" ||
        blockerItem.code === "duplicate_scenario_id" ||
        blockerItem.code === "duplicate_scenario_source_id",
    ),
  );
  const scenarioSpecificPromotionBlockers = scenarioReadiness.flatMap((item) =>
    item.promotion_blockers.filter(
      (blockerItem) =>
        blockerItem.code === "empty_primary_source_ids" ||
        blockerItem.code === "duplicate_scenario_id" ||
        blockerItem.code === "duplicate_scenario_source_id",
    ),
  );
  // Source blockers are already represented once per unique source. Scenario
  // readiness repeats them with scenario context, but repeating those records
  // in aggregate counts would make a shared source look like several failures.
  const blockers = [...sourceBlockers, ...scenarioSpecificBlockers].sort(
    blockerSort,
  );
  const promotionBlockers = [
    ...sourcePromotionBlockers,
    ...scenarioSpecificPromotionBlockers,
  ].sort(blockerSort);
  const counts: M3SourceGateCounts = {
    scenario_count: scenarioReadiness.length,
    unique_source_count: sourceReadiness.length,
    automation_ready_scenario_count: scenarioReadiness.filter(
      (item) => item.automation_ready,
    ).length,
    automation_blocked_scenario_count: scenarioReadiness.filter(
      (item) => !item.automation_ready,
    ).length,
    promotion_ready_scenario_count: scenarioReadiness.filter(
      (item) => item.promotion_ready,
    ).length,
    promotion_blocked_scenario_count: scenarioReadiness.filter(
      (item) => !item.promotion_ready,
    ).length,
    automation_ready_source_count: sourceReadiness.filter(
      (item) => item.automation_ready,
    ).length,
    automation_blocked_source_count: sourceReadiness.filter(
      (item) => !item.automation_ready,
    ).length,
    promotion_ready_source_count: sourceReadiness.filter(
      (item) => item.promotion_ready,
    ).length,
    promotion_blocked_source_count: sourceReadiness.filter(
      (item) => !item.promotion_ready,
    ).length,
    blocker_count: blockers.length,
    blocker_counts: countBlockers(blockers),
    promotion_blocker_count: promotionBlockers.length,
    promotion_blocker_counts: countBlockers(promotionBlockers),
  };

  return {
    automation_ready:
      scenarioReadiness.length > 0 &&
      scenarioReadiness.every((item) => item.automation_ready),
    promotion_ready:
      scenarioReadiness.length > 0 &&
      scenarioReadiness.every((item) => item.promotion_ready),
    source_readiness: sourceReadiness,
    scenario_readiness: scenarioReadiness,
    blockers,
    promotion_blockers: promotionBlockers,
    counts,
  };
}

/** A concise alias for callers that use the generic gate vocabulary. */
export const auditSourceReadiness = auditM3SourceReadiness;
