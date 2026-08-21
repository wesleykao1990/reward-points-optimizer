import { promises as fs } from "node:fs";
import {
  type AgentFeedFinding,
  importRunBundle,
  mapFindingToObservation,
  type SubmittedEvidence,
} from "@jro/agent-feed-consumer";
import {
  type CorrectionCategory,
  createProvisionalRuleStore,
  freezeP0CoverageIndex,
  P0_SOURCE_ROLE_PLAN_SHA256,
  PROVISIONAL_PUBLICATION_BATCH_VERSION,
  type ProvisionalRuleEnvelope,
  type ProvisionalRuleStore,
  type Sha256,
} from "@jro/provisional-rules";
import {
  EXPERIMENTAL_CATALOGUE_KINDS,
  EXPERIMENTAL_CATALOGUE_STATUSES,
  EXPERIMENTAL_CONFIDENCE_LEVELS,
  EXPERIMENTAL_DISPLAY_STATUSES,
  type ExperimentalCatalogueCard,
  type ExperimentalCataloguePort,
  type ExperimentalCatalogueSnapshot,
  type ExperimentalCorrectionCategory,
  type ExperimentalCorrectionInput,
  MAX_EXPERIMENTAL_CATALOGUE_CARDS,
  MAX_EXPERIMENTAL_SOURCE_LABEL_LENGTH,
  MAX_EXPERIMENTAL_SUMMARY_LENGTH,
  MAX_EXPERIMENTAL_TITLE_LENGTH,
} from "./contracts.js";

export type {
  ExperimentalCatalogueCard,
  ExperimentalCataloguePort,
  ExperimentalCatalogueSnapshot,
  ExperimentalCorrectionInput,
} from "./contracts.js";

const IMPORTED_AT = "2026-08-21T04:51:00.000Z";
const ACTIVATED_AT = "2026-08-21T04:53:00.000Z";

const CANDIDATE_FIXTURE =
  "../../../fixtures/m3/provisional/p0-seveneleven-payment-family-candidates.v0.1.json";
const COVERAGE_FIXTURE =
  "../../../fixtures/m3/provisional/p0-coverage-index.v0.1.json";
const RUN_BUNDLE_FIXTURE =
  "../../../fixtures/m3/agent-feed/p0-seveneleven-payment-families.run-bundle.v0.1.json";

type JsonRecord = Record<string, unknown>;

/**
 * The only catalogue data that can be sent to the browser.  Keep this type
 * separate from the provisional-rule envelope so a new field on the internal
 * rule cannot accidentally become a public field.
 */
export type ExperimentalRuleProjection = ExperimentalCatalogueCard;

export type ExperimentalCorrectionSuccess = Readonly<{
  readonly ok: true;
  readonly publication_id: string;
  readonly category: ExperimentalCorrectionCategory;
  /** Safe UI acknowledgement; canonical lifecycle status stays host-owned. */
  readonly accepted: true;
}>;

export type ExperimentalCorrectionFailure = Readonly<{
  readonly ok: false;
  readonly code:
    | "publication_not_found"
    | "publication_not_active"
    | "correction_not_applied";
}>;

export type ExperimentalCorrectionResult =
  | ExperimentalCorrectionSuccess
  | ExperimentalCorrectionFailure;

interface CatalogueEntry {
  readonly publication_id: string;
  readonly candidate_hash: Sha256;
  readonly card: ExperimentalCatalogueCard;
}

interface CatalogueState {
  readonly store: ProvisionalRuleStore;
  readonly entries: readonly CatalogueEntry[];
  readonly updated_at: string;
}

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPlainRecord(value: unknown): value is JsonRecord {
  if (!isRecord(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

async function readFixture(path: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(new URL(path, import.meta.url), "utf8"));
}

function requiredRecord(value: unknown, label: string): JsonRecord {
  if (!isRecord(value)) throw new Error(`${label}_invalid`);
  return value;
}

function findingDelivery(
  deliveries: readonly {
    event: {
      event_type: string;
      payload: Record<string, unknown>;
    };
  }[],
): {
  event: {
    event_type: "finding.submitted";
    payload: Record<string, unknown>;
  };
} {
  const finding = deliveries.find(
    (delivery) => delivery.event.event_type === "finding.submitted",
  );
  if (!finding || finding.event.event_type !== "finding.submitted")
    throw new Error("finding_delivery_missing");
  return finding as {
    event: {
      event_type: "finding.submitted";
      payload: Record<string, unknown>;
    };
  };
}

async function initializeCatalogue(): Promise<CatalogueState> {
  const [candidateValue, coverageValue, bundleValue] = await Promise.all([
    readFixture(CANDIDATE_FIXTURE),
    readFixture(COVERAGE_FIXTURE),
    readFixture(RUN_BUNDLE_FIXTURE),
  ]);

  // The importer validates and snapshots the checked-in Agent Feed run bundle
  // before any finding is mapped.  The demo sink is deliberately process
  // local; production persistence belongs to an injected app port.
  const imported = await importRunBundle(bundleValue, {
    imported_at: IMPORTED_AT,
    batch_sink: () => undefined,
  });
  if (!imported.accepted || imported.status !== "completed")
    throw new Error("run_bundle_import_rejected");

  const delivery = findingDelivery(imported.deliveries);
  const payload = delivery.event.payload;
  const finding = requiredRecord(
    payload.finding,
    "finding",
  ) as unknown as AgentFeedFinding;
  const submittedEvidence = Array.isArray(payload.submitted_evidence)
    ? (payload.submitted_evidence as unknown as SubmittedEvidence[])
    : [];
  const mapped = mapFindingToObservation({
    event: delivery.event as never,
    finding,
    submitted_evidence: submittedEvidence,
    received_at: IMPORTED_AT,
  });
  if (!mapped) throw new Error("finding_mapping_rejected");

  const candidateSet = requiredRecord(
    candidateValue,
    "provisional_candidate_set",
  );
  if (!Array.isArray(candidateSet.candidates))
    throw new Error("provisional_candidate_set_invalid");
  const candidates = candidateSet.candidates.map((value, index) => {
    const item = requiredRecord(value, `provisional_candidate_${index}`);
    const candidate = requiredRecord(
      item.candidate,
      `provisional_candidate_${index}_payload`,
    );
    if (
      typeof item.payment_family !== "string" ||
      typeof item.display_name_ja !== "string"
    )
      throw new Error("provisional_candidate_metadata_invalid");
    return {
      payment_family: item.payment_family,
      display_name_ja: item.display_name_ja,
      candidate,
    };
  });
  const coverage = freezeP0CoverageIndex(coverageValue);
  const store = createProvisionalRuleStore();
  const published = store.publishBatch({
    version: PROVISIONAL_PUBLICATION_BATCH_VERSION,
    batch_id: "batch_p0_seveneleven_payment_families_20260821",
    plan_sha256: P0_SOURCE_ROLE_PLAN_SHA256,
    published_at: ACTIVATED_AT,
    members: candidates.map((item) => ({
      member_id: `p0_seveneleven_${item.payment_family}`,
      admission_request: {
        candidate: item.candidate,
        observation: mapped.observation,
        p0_coverage_index: coverage,
      },
    })),
  });
  if (!published.ok || published.batch.published.length !== candidates.length)
    throw new Error("provisional_publication_batch_rejected");
  const metadata = new Map(
    candidates.map((item) => [item.candidate.candidate_id, item]),
  );
  const entries = published.batch.published.map((member) => {
    if (member.envelope.status !== "active_experimental")
      throw new Error("provisional_candidate_activation_rejected");
    const publicationId = member.envelope.candidate.candidate_id;
    if (typeof publicationId !== "string" || publicationId.length === 0)
      throw new Error("provisional_candidate_id_missing");
    const item = metadata.get(publicationId);
    if (!item) throw new Error("provisional_candidate_metadata_missing");
    const checkedAt = member.envelope.candidate.machine_check.checked_at;
    const validFrom = member.envelope.rule.validity.valid_from;
    const card = makeDemoCard(item.display_name_ja, checkedAt, validFrom);
    return Object.freeze({
      publication_id: publicationId,
      candidate_hash: member.candidate_hash,
      card,
    });
  });
  return Object.freeze({
    store,
    entries: Object.freeze(entries),
    updated_at: ACTIVATED_AT,
  });
}

function makeDemoCard(
  displayName: string,
  checkedAt: string,
  validFrom: string,
): ExperimentalCatalogueCard {
  return Object.freeze({
    // The publication identity is assigned by the host below.  This
    // placeholder is replaced before the card reaches the port boundary.
    publication_id: "pending",
    kind: "payment_acceptance",
    title: "セブン‐イレブンの支払い方法",
    summary: `セブン‐イレブンで「${displayName}」を利用できるという先行公開情報です。`,
    display_status: "experimental_unverified",
    confidence: "high",
    source_label: "セブン‐イレブン公式情報",
    checked_at: checkedAt,
    valid_from: validFrom,
  });
}

function cardWithPublicationId(
  card: ExperimentalCatalogueCard,
  publicationId: string,
): ExperimentalCatalogueCard {
  return Object.freeze({ ...card, publication_id: publicationId });
}

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x1f || codePoint === 0x7f) return true;
  }
  return false;
}

function validIsoDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 64 &&
    !hasControlCharacters(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function safeDisplayText(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    !hasControlCharacters(value) &&
    !/https?:\/\//iu.test(value) &&
    !/sha256:[0-9a-f]{16,}/iu.test(value)
  );
}

function exactKeys(value: JsonRecord, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  return (
    keys.length === expected.length &&
    keys.every((key, index) => key === [...expected].sort()[index])
  );
}

function normalizeCard(value: unknown): ExperimentalCatalogueCard {
  if (!isPlainRecord(value)) throw new Error("catalogue_card_invalid");
  const cardKeys = [
    "publication_id",
    "kind",
    "title",
    "summary",
    "display_status",
    "confidence",
    "source_label",
    "checked_at",
    "valid_from",
  ] as const;
  if (!exactKeys(value, cardKeys))
    throw new Error("catalogue_card_shape_invalid");
  if (
    typeof value.publication_id !== "string" ||
    value.publication_id.length === 0 ||
    value.publication_id.length > 128 ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value.publication_id)
  )
    throw new Error("catalogue_publication_id_invalid");
  if (
    !EXPERIMENTAL_CATALOGUE_KINDS.includes(
      value.kind as (typeof EXPERIMENTAL_CATALOGUE_KINDS)[number],
    )
  )
    throw new Error("catalogue_kind_invalid");
  if (!safeDisplayText(value.title, MAX_EXPERIMENTAL_TITLE_LENGTH))
    throw new Error("catalogue_title_invalid");
  if (!safeDisplayText(value.summary, MAX_EXPERIMENTAL_SUMMARY_LENGTH))
    throw new Error("catalogue_summary_invalid");
  if (!EXPERIMENTAL_DISPLAY_STATUSES.includes(value.display_status as never))
    throw new Error("catalogue_display_status_invalid");
  if (!EXPERIMENTAL_CONFIDENCE_LEVELS.includes(value.confidence as never))
    throw new Error("catalogue_confidence_invalid");
  if (
    !safeDisplayText(value.source_label, MAX_EXPERIMENTAL_SOURCE_LABEL_LENGTH)
  )
    throw new Error("catalogue_source_label_invalid");
  if (!validIsoDate(value.checked_at))
    throw new Error("catalogue_checked_at_invalid");
  if (!validIsoDate(value.valid_from))
    throw new Error("catalogue_valid_from_invalid");
  return Object.freeze({
    publication_id: value.publication_id,
    kind: value.kind as ExperimentalCatalogueCard["kind"],
    title: value.title,
    summary: value.summary,
    display_status:
      value.display_status as ExperimentalCatalogueCard["display_status"],
    confidence: value.confidence as ExperimentalCatalogueCard["confidence"],
    source_label: value.source_label,
    checked_at: value.checked_at,
    valid_from: value.valid_from,
  });
}

/**
 * Validate and reduce an adapter result before it is serialized.  This is
 * deliberately strict: one malformed row fails the complete read rather than
 * risking a partial response that accidentally carries a private field.
 */
export function normalizeExperimentalCatalogueSnapshot(
  value: unknown,
): ExperimentalCatalogueSnapshot {
  if (!isPlainRecord(value)) throw new Error("catalogue_snapshot_invalid");
  const snapshotKeys = ["status", "updated_at", "rules"] as const;
  if (!exactKeys(value, snapshotKeys))
    throw new Error("catalogue_snapshot_shape_invalid");
  if (
    !EXPERIMENTAL_CATALOGUE_STATUSES.includes(
      value.status as (typeof EXPERIMENTAL_CATALOGUE_STATUSES)[number],
    )
  )
    throw new Error("catalogue_status_invalid");
  if (value.updated_at !== null && !validIsoDate(value.updated_at))
    throw new Error("catalogue_updated_at_invalid");
  if (
    !Array.isArray(value.rules) ||
    value.rules.length > MAX_EXPERIMENTAL_CATALOGUE_CARDS
  )
    throw new Error("catalogue_rules_invalid");
  const seen = new Set<string>();
  const rules = value.rules.map((item) => {
    const card = normalizeCard(item);
    if (seen.has(card.publication_id))
      throw new Error("catalogue_publication_duplicate");
    seen.add(card.publication_id);
    return card;
  });
  return Object.freeze({
    status: value.status as ExperimentalCatalogueSnapshot["status"],
    updated_at: value.updated_at,
    rules: Object.freeze(rules),
  });
}

function stateToSnapshot(
  current: CatalogueState,
): ExperimentalCatalogueSnapshot {
  const selected = current.store.select();
  const byHash = new Map(
    selected.map((envelope) => [envelope.candidate_hash, envelope]),
  );
  const rules = current.entries
    .map((entry) => {
      const envelope = byHash.get(entry.candidate_hash);
      return envelope === undefined
        ? null
        : cardWithPublicationId(entry.card, entry.publication_id);
    })
    .filter((entry): entry is ExperimentalCatalogueCard => entry !== null);
  return normalizeExperimentalCatalogueSnapshot({
    status: "ready",
    updated_at: current.updated_at,
    rules,
  });
}

function correctionTimestamp(envelope: ProvisionalRuleEnvelope): string {
  const history = envelope.history.map((item) => Date.parse(item.occurred_at));
  const corrections = envelope.corrections.map((item) =>
    Date.parse(item.reported_at),
  );
  const floor = Math.max(...history, ...corrections, 0);
  const now = Date.now();
  return new Date(
    Math.max(Number.isFinite(now) ? now : floor, floor),
  ).toISOString();
}

function signalId(entry: CatalogueEntry, reportedAt: string): string {
  const time = Date.parse(reportedAt).toString(36);
  // The package bounds signal IDs to 128 characters.  This private ID binds
  // the host publication and timestamp; it never crosses the HTTP boundary.
  return `ui_${entry.publication_id.slice(0, 80)}_${time}`.slice(0, 128);
}

function makeDemoPort(): ExperimentalCataloguePort {
  let cataloguePromise: Promise<CatalogueState> | undefined;

  const currentState = (): Promise<CatalogueState> => {
    if (cataloguePromise === undefined)
      cataloguePromise = initializeCatalogue();
    return cataloguePromise;
  };

  return Object.freeze({
    async list(): Promise<ExperimentalCatalogueSnapshot> {
      return stateToSnapshot(await currentState());
    },

    async reportCorrection(
      input: ExperimentalCorrectionInput,
    ): Promise<ExperimentalCorrectionResult> {
      const current = await currentState();
      const entry = current.entries.find(
        (candidate) => candidate.publication_id === input.publication_id,
      );
      if (!entry)
        return Object.freeze({ ok: false, code: "publication_not_found" });

      const envelope = current.store.get(entry.candidate_hash);
      if (!envelope || envelope.status !== "active_experimental")
        return Object.freeze({ ok: false, code: "publication_not_active" });

      const reportedAt = correctionTimestamp(envelope);
      const result = current.store.reportCorrection({
        version: "provisional-correction.v1",
        signal_id: signalId(entry, reportedAt),
        candidate_hash: entry.candidate_hash,
        category: input.category as CorrectionCategory,
        credible: true,
        reported_at: reportedAt,
        severity: "normal",
      });
      if (!result.ok || result.disposition !== "disputed")
        return Object.freeze({ ok: false, code: "correction_not_applied" });
      return Object.freeze({
        ok: true,
        publication_id: entry.publication_id,
        category: input.category,
        accepted: true,
      });
    },
  });
}

// The fixture is reachable only through this named demo/test port.  A
// production composition should pass a database-backed implementation to the
// server instead of importing fixture state as an implicit truth source.
let defaultDemoPort: ExperimentalCataloguePort = makeDemoPort();

export function createDemoExperimentalCataloguePort(): ExperimentalCataloguePort {
  return makeDemoPort();
}

export function getDefaultExperimentalCataloguePort(): ExperimentalCataloguePort {
  return defaultDemoPort;
}

export async function listExperimentalCatalogue(
  port: ExperimentalCataloguePort,
): Promise<ExperimentalCatalogueSnapshot> {
  return normalizeExperimentalCatalogueSnapshot(await port.list());
}

export async function reportExperimentalCorrection(
  port: ExperimentalCataloguePort,
  input: ExperimentalCorrectionInput,
): Promise<unknown> {
  return port.reportCorrection(input);
}

/** Compatibility helpers for callers that explicitly choose the demo port. */
export async function getExperimentalRules(): Promise<
  readonly ExperimentalCatalogueCard[]
> {
  return (
    await listExperimentalCatalogue(getDefaultExperimentalCataloguePort())
  ).rules;
}

export async function correctExperimentalRule(
  input: ExperimentalCorrectionInput,
): Promise<ExperimentalCorrectionResult | unknown> {
  return reportExperimentalCorrection(
    getDefaultExperimentalCataloguePort(),
    input,
  );
}

/** Reset only the explicit local demo port; no data is persisted. */
export function resetExperimentalCatalogue(): void {
  defaultDemoPort = makeDemoPort();
}

export const listExperimentalRules = getExperimentalRules;
