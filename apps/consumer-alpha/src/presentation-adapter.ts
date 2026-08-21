import {
  admitCorrection,
  type ConsumerPresentation,
  type PresentationRoute,
  presentRecommendation,
  resolveDeepLink,
} from "@jro/consumer-alpha";
import type {
  RecommendationResponse,
  VerificationStatus,
} from "@jro/recommendation-api";
import type { CorrectionDraftInput } from "./contracts.js";

type JsonRecord = Record<string, unknown>;

/** The deliberately small summary that is allowed to cross into the browser. */
export interface BrowserPlanSummary {
  readonly plan_id: string;
  readonly label: string;
  readonly objective_score_jpy: string | null;
  readonly operation_count: number;
  readonly reward_count: number;
  readonly ending_asset_count: number;
  readonly eligible: true;
  readonly conditions: readonly string[];
}

export type BrowserFreshnessStatus =
  | "synthetic_fixture"
  | "blocked"
  | "unavailable";

export interface BrowserRecommendationView {
  readonly version: "m6-alpha-v1";
  readonly request_id: string;
  /** True only for a validated synthetic/internal response. */
  readonly synthetic_only: boolean;
  readonly not_current_advice: true;
  readonly outcome: RecommendationResponse["outcome"];
  readonly verification_status: VerificationStatus;
  readonly primary: BrowserPlanSummary | null;
  readonly fallback: BrowserPlanSummary | null;
  readonly conditional: boolean;
  readonly conditional_alternatives: readonly BrowserPlanSummary[];
  readonly questions: readonly string[];
  readonly assumptions: readonly string[];
  readonly sensitivities: readonly Record<string, string>[];
  /** Only a generic status crosses the browser boundary. */
  readonly freshness: {
    readonly status: BrowserFreshnessStatus;
  };
  /** Evidence/source identifiers and raw freshness notes are host-only. */
  readonly deep_link_ids: readonly string[];
}

export interface BrowserCorrectionDraft {
  readonly version: "m6-alpha-v1";
  readonly status: "not_submitted";
  readonly correction_id: string;
  readonly category: CorrectionDraftInput["category"];
  readonly note_code: CorrectionDraftInput["note_code"];
  /** A correction is never anonymous: this is the host-bound request id. */
  readonly recommendation_id: string;
}

export class CorrectionAdapterError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "CorrectionAdapterError";
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safeString(value: unknown, fallback = "unavailable"): string {
  return typeof value === "string" && value.length > 0 && value.length <= 240
    ? value
    : fallback;
}

function boundedStrings(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return Object.freeze([]);
  return Object.freeze(
    value
      .filter((item): item is string => typeof item === "string")
      .filter((item) => item.length > 0 && item.length <= 240)
      .slice(0, 20),
  );
}

function hasStoredValueUnknownMarker(
  presentation: ConsumerPresentation,
): boolean {
  return [...presentation.questions, ...presentation.assumptions].some((item) =>
    /stored[ -]?value.*(?:unknown|unresolved)|(?:unknown|unresolved).*stored[ -]?value/iu.test(
      item,
    ),
  );
}

function summary(
  route: PresentationRoute | null,
  label: string,
): BrowserPlanSummary | null {
  if (!route) return null;
  return Object.freeze({
    plan_id: route.plan_id,
    label,
    objective_score_jpy: route.objective_score_jpy,
    operation_count: route.steps.filter((step) => step.kind === "operation")
      .length,
    reward_count: route.rewards.length,
    ending_asset_count: route.ending_assets.length,
    eligible: true as const,
    conditions: Object.freeze([...route.conditions]),
  });
}

function sensitivitySummary(
  presentation: ConsumerPresentation,
): readonly Record<string, string>[] {
  // Keep the small sensitivity explanation but do not pass through any raw
  // evidence, source, locator, freshness, or canonical fields.
  return Object.freeze(
    presentation.sensitivities
      .map((item) => {
        const output: Record<string, string> = {
          asset_id: item.asset_id,
          current_jpy_per_unit: item.current_jpy_per_unit,
          break_even_jpy_per_unit: item.break_even_jpy_per_unit,
        };
        if (item.reward_class) output.reward_class = item.reward_class;
        if (item.winner_at_or_below_threshold_plan_id) {
          output.winner_at_or_below_threshold_plan_id =
            item.winner_at_or_below_threshold_plan_id;
        }
        if (item.winner_above_threshold_plan_id) {
          output.winner_above_threshold_plan_id =
            item.winner_above_threshold_plan_id;
        }
        return Object.freeze(output);
      })
      .slice(0, 20),
  );
}

/**
 * Synthetic links are selected only from this host-owned plan mapping.  A
 * plan id is never interpreted as a URL or used to invent a new link.
 */
const SYNTHETIC_PLAN_LINKS: Readonly<Record<string, string>> = Object.freeze({
  plan_synthetic_direct_card: "synthetic_loyalty_app",
  plan_synthetic_topup_then_pay: "synthetic_wallet_app",
});

function deepLinkIdsForRoutes(
  routes: readonly (PresentationRoute | null)[],
): readonly string[] {
  const linkIds = new Set<string>();
  for (const route of routes) {
    if (!route) continue;
    const linkId = SYNTHETIC_PLAN_LINKS[route.plan_id];
    if (linkId) linkIds.add(linkId);
  }
  return Object.freeze([...linkIds]);
}

function safeVerificationStatus(value: unknown): VerificationStatus {
  if (value === "verified" || value === "synthetic_only" || value === "blocked")
    return value;
  return "blocked";
}

function safeRequestId(response: unknown): string {
  if (!isRecord(response)) return "unavailable";
  return safeString(response.request_id);
}

function blockedView(
  response: unknown,
  verificationStatus: VerificationStatus = "blocked",
): BrowserRecommendationView {
  return Object.freeze({
    version: "m6-alpha-v1",
    request_id: safeRequestId(response),
    synthetic_only: false,
    not_current_advice: true,
    outcome: "blocked",
    verification_status: verificationStatus,
    primary: null,
    fallback: null,
    conditional: false,
    conditional_alternatives: Object.freeze([]),
    questions: Object.freeze([]),
    assumptions: Object.freeze([]),
    sensitivities: Object.freeze([]),
    freshness: Object.freeze({ status: "blocked" }),
    deep_link_ids: Object.freeze([]),
  });
}

function presentationToBrowser(
  response: RecommendationResponse,
  presentation: ConsumerPresentation,
): BrowserRecommendationView {
  const questions = boundedStrings(presentation.questions);
  // The synthetic evaluator historically returned a definite direct-card
  // route together with the unresolved stored-value question.  That is not a
  // definite recommendation.  Keep only the explicitly conservative direct
  // card route and mark the result conditional until the question is answered.
  const forcedConditional =
    presentation.state === "definite" &&
    (questions.length > 0 || hasStoredValueUnknownMarker(presentation));
  const safePrimary = forcedConditional
    ? presentation.primary?.plan_id === "plan_synthetic_direct_card"
      ? presentation.primary
      : null
    : presentation.primary;
  const primaryLabel = forcedConditional
    ? "Safe synthetic option while questions remain"
    : "Primary synthetic option";
  const alternatives = Object.freeze(
    presentation.conditional_alternatives
      .map((route) => summary(route, "Conditional synthetic option"))
      .filter((item): item is BrowserPlanSummary => item !== null),
  );
  const primary = summary(safePrimary, primaryLabel);
  const fallback = forcedConditional
    ? null
    : summary(presentation.fallback, "Fallback synthetic option");
  const deepLinkRoutes = [
    forcedConditional ? safePrimary : presentation.primary,
    fallback ? presentation.fallback : null,
    ...presentation.conditional_alternatives,
  ];
  return Object.freeze({
    version: "m6-alpha-v1",
    request_id: safeRequestId(response),
    synthetic_only: true,
    not_current_advice: true,
    outcome: forcedConditional ? "conditional" : presentation.state,
    verification_status: "synthetic_only",
    primary,
    fallback,
    conditional: forcedConditional || presentation.state === "conditional",
    conditional_alternatives: alternatives,
    questions,
    assumptions: boundedStrings(presentation.assumptions),
    sensitivities: sensitivitySummary(presentation),
    // Do not expose checked_at, source_ids, rule validity, or raw notes.  The
    // browser gets a label that cannot be mistaken for current freshness.
    freshness: Object.freeze({ status: "synthetic_fixture" }),
    deep_link_ids: deepLinkIdsForRoutes(deepLinkRoutes),
  });
}

/**
 * Convert one M5 response through the shared consumer presentation API.
 *
 * The host deliberately requires both the synthetic verification marker and
 * the synthetic execution mode.  Every other response is reduced to an
 * empty blocked view; no raw winner, question, evidence, or freshness data
 * can leak from a verified, blocked, forged, or malformed envelope.
 */
export function mapRecommendationForBrowser(
  response: RecommendationResponse,
): BrowserRecommendationView {
  try {
    if (!isRecord(response)) return blockedView(response);
    const verificationStatus = safeVerificationStatus(
      response.verification_status,
    );
    if (
      verificationStatus !== "synthetic_only" ||
      response.mode !== "synthetic_internal"
    )
      return blockedView(response, verificationStatus);
    const presentation = presentRecommendation(response);
    if (presentation.state === "blocked") return blockedView(response);
    return presentationToBrowser(response, presentation);
  } catch {
    // A malformed synthetic envelope is still untrusted at this boundary.
    return blockedView(response);
  }
}

function identifier(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/u.test(value) ? value : null;
}

function recommendationHash(
  recommendationId: string | null,
): `sha256:${string}` {
  const id = identifier(recommendationId);
  if (!id) throw new CorrectionAdapterError("recommendation_id_required");
  if (!/^sha256:[0-9a-f]{64}$/u.test(id))
    throw new CorrectionAdapterError("recommendation_id_invalid");
  return id as `sha256:${string}`;
}

function correctionField(input: CorrectionDraftInput, key: string): unknown {
  if (!isRecord(input)) return undefined;
  return input[key];
}

/**
 * Build a correction only after the shared admission function accepts it.
 * There is intentionally no local fallback and no "no recommendation"
 * sentinel: missing or denied bindings fail closed to the caller.
 */
export function mapCorrectionDraftForBrowser(
  input: CorrectionDraftInput,
  recommendationId: string | null,
): BrowserCorrectionDraft {
  const hash = recommendationHash(recommendationId);
  const noteCode = correctionField(input, "note_code");
  const eligiblePlanId = identifier(correctionField(input, "eligible_plan_id"));
  const admission = admitCorrection({
    version: "1",
    category: input.category,
    recommendation_hash: hash,
    // These are host-owned synthetic catalogue identifiers, never browser
    // aliases or user-supplied URLs.
    merchant_id: "merchant.synthetic",
    branch_id: "location.synthetic",
    ...(eligiblePlanId ? { eligible_plan_id: eligiblePlanId } : {}),
    ...(typeof noteCode === "string" ? { note_code: noteCode } : {}),
  });
  if (!admission.ok)
    throw new CorrectionAdapterError(
      `correction_admission_denied:${admission.denial.code}`,
    );
  return Object.freeze({
    version: "m6-alpha-v1",
    status: "not_submitted",
    correction_id: admission.report.correction_id,
    category: input.category,
    note_code: input.note_code,
    recommendation_id: recommendationId as string,
  });
}

/** Resolve only an opaque id through the host-owned synthetic catalogue. */
export function resolveOfficialLink(linkId: string): string | null {
  const result = resolveDeepLink({ link_id: linkId });
  if (!result.ok || result.link.synthetic !== true) return null;
  try {
    const parsed = new URL(result.link.href);
    if (
      parsed.protocol !== "https:" ||
      parsed.hostname !== "alpha.rewards-optimizer.test" ||
      parsed.search !== "" ||
      parsed.hash !== ""
    )
      return null;
    return result.link.href;
  } catch {
    return null;
  }
}
