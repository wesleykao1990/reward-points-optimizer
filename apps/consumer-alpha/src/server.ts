import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { extname, join, normalize, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { types as nodeTypes } from "node:util";
import {
  DEFAULT_SESSION_PURCHASE_PREFERENCES,
  normalizeSessionPurchasePreferences,
  type PurchaseContext,
  RewardCapabilities,
  type RewardCapabilitySnapshot,
  type RouteComparison,
  type SessionPurchasePreferences,
  type SessionPurchasePreferenceUpdate,
} from "@jro/reward-capabilities";
import {
  type RewardsAgentRunResult,
  runRewardsAgent,
} from "@jro/rewards-agent";
import { SYNTHETIC_REPLAY_KNOWLEDGE_TIME } from "@jro/test-fixtures";
import type { ActiveRewardCalculationPort } from "./active-reward-calculation.js";
import {
  AGENT_FEED_INTERNAL_EVENT_PATH,
  AGENT_FEED_INTERNAL_MAX_BODY_BYTES,
  type AgentFeedIngressPort,
} from "./agent-feed-ingress.js";
import { projectConsumerReference } from "./consumer-reference.js";
import type {
  ExperimentalCataloguePort,
  ExperimentalCorrectionInput,
  ExperimentalRecommendationInput,
  ExperimentalRecommendationPort,
  ExperimentalRecommendationResult,
  ImplementationFactCataloguePort,
  ImplementationFactCorrectionInput,
  MerchantAcceptancePort,
  NanacoCreditChargeRecommendationInput,
  NanacoCreditChargeRecommendationPort,
  NanacoCreditChargeRecommendationResult,
} from "./contracts.js";
import {
  InputContractError,
  isCanonicalProductFamilyId,
  isCanonicalRecommendationId,
  MAX_CORRECTION_BODY_BYTES,
  MAX_EVALUATE_BODY_BYTES,
  MAX_EXPERIMENTAL_RECOMMENDATION_BODY_BYTES,
  MAX_UNIFIED_RECOMMENDATION_BODY_BYTES,
  parseCorrectionDraft,
  parseExperimentalCorrection,
  parseExperimentalRecommendation,
  parseImplementationFactCorrection,
  parseManualAlphaState,
  parseNanacoCreditChargeRecommendation,
  parseUnifiedRecommendation,
  SYNTHETIC_MERCHANT_ID,
  type UnifiedRecommendationInput,
} from "./contracts.js";
import {
  FACT_INFLUENCE_VERIFIED_APPLIED_PARENT_CLAIMS,
  type FactInfluenceBrowserFactor,
  type FactInfluenceBrowserView,
  type FactInfluenceGraphContext,
  type FactInfluenceGraphPort,
  getDefaultFactInfluenceGraphPort,
  projectFactInfluenceForRecommendation,
} from "./fact-influence-graph.js";
import {
  adaptImplementationFactBackend,
  getDefaultImplementationFactCataloguePort,
  type ImplementationFactBackend,
  normalizeImplementationFactSnapshot,
} from "./implementation-catalog.js";
import {
  createUnavailableNanacoCreditChargeRecommendationPort,
  NANACO_CREDIT_CHARGE_PLAN_ID,
  NANACO_CREDIT_CHARGE_PUBLIC_ASSUMPTIONS,
  NANACO_CREDIT_CHARGE_PUBLIC_BLOCKERS,
  NANACO_CREDIT_CHARGE_REWARD_QUANTUM_JPY,
  NanacoCreditChargeRecommendationError,
} from "./nanaco-credit-charge-recommendation.js";
import {
  MAX_PAYMENT_STACK_BODY_BYTES,
  parsePaymentStackBrowserInput,
  recommendPaymentStack,
} from "./payment-stack-recommendation.js";
import {
  calculateSelectedProductPurchases,
  createBundledFixtureRouteGraphSource,
  listP0LotteryBrowserLinks,
  listPointSpendBrowserOptions,
  MAX_POINT_SPEND_BODY_BYTES,
  p0ProductFamilyDefinition,
  parsePointSpendBrowserInput,
  type RouteGraphSourcePort,
} from "./point-spend-recommendation.js";
import { recommendUnifiedParsedPointSpend } from "./point-spend-unified.js";
import {
  mapCorrectionDraftForBrowser,
  mapRecommendationForBrowser,
  resolveOfficialLink,
} from "./presentation-adapter.js";
import {
  getDefaultExperimentalCataloguePort,
  listExperimentalCatalogue,
  reportExperimentalCorrection,
} from "./provisional-catalog.js";
import {
  createUnavailableNanacoExperimentalRecommendationPort,
  ExperimentalRecommendationError,
} from "./real-experimental-recommendation.js";
import {
  defaultPointValuation,
  type RankingCandidate,
  rankUnifiedRoutes,
  type UnifiedComparisonSummary,
} from "./recommendation-ranking.js";
import { createPostgresAppRuntime } from "./runtime.js";
import { evaluateSynthetic, SYNTHETIC_ALPHA_CONFIG } from "./synthetic.js";

export {
  MAX_CORRECTION_BODY_BYTES,
  MAX_EVALUATE_BODY_BYTES,
  MAX_EXPERIMENTAL_RECOMMENDATION_BODY_BYTES,
  MAX_UNIFIED_RECOMMENDATION_BODY_BYTES,
} from "./contracts.js";

export const MAX_CAPABILITY_BODY_BYTES = 48 * 1024;
export const MAX_AGENT_BODY_BYTES = 48 * 1024;

export const LOCALHOST_BIND_HOST = "127.0.0.1" as const;
export const CSP_HEADER =
  "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const PUBLIC_ROOT = fileURLToPath(new URL("../public/", import.meta.url));
const STATIC_FILES: Readonly<Record<string, string>> = Object.freeze({
  "/": "index.html",
  "/index.html": "index.html",
  "/app.js": "app.js",
  "/webmcp.js": "webmcp.js",
  "/styles.css": "styles.css",
});
const CONTENT_TYPES: Readonly<Record<string, string>> = Object.freeze({
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
});
const PAYMENT_LOGO_FILES = new Set([
  "dpoint.png",
  "dbarai.png",
  "dcard.png",
  "jrepoint.webp",
  "viewcard.gif",
  "nanaco.png",
  "paypay.svg",
  "paypaycard.png",
  "ponta.png",
  "rakutenpoint.svg",
  "rakutenpay.svg",
  "rakutencard.svg",
  "vpoint.svg",
  "waon.png",
  "aeonpay.png",
  "aeoncard.png",
  "aupay.png",
  "aupaycard.png",
  "famipay.svg",
  "smbccard.png",
]);
const FONT_FILES = new Set(["archivo-var.woff2", "jetbrainsmono-var.woff2"]);
const PAYMENT_LOGO_CONTENT_TYPES: Readonly<Record<string, string>> =
  Object.freeze({
    ".gif": "image/gif",
    ".jpg": "image/jpeg",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
  });

const MAX_ISSUED_RECOMMENDATIONS = 128;
const issuedRecommendationIds = new Set<string>();
const NANACO_PURCHASE_APPLIED_PARENT_CLAIM_ID =
  FACT_INFLUENCE_VERIFIED_APPLIED_PARENT_CLAIMS.nanaco_purchase;
const NANACO_CREDIT_CHARGE_APPLIED_PARENT_CLAIM_ID =
  FACT_INFLUENCE_VERIFIED_APPLIED_PARENT_CLAIMS.nanaco_credit_charge;

/** Descriptor-first admission for trusted-port output; never invokes accessors. */
function isPlainDataOutput(
  value: unknown,
  seen: WeakSet<object> = new WeakSet(),
  depth = 0,
): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || depth > 24 || nodeTypes.isProxy(value))
    return false;
  if (seen.has(value)) return false;
  seen.add(value);

  const keys = Reflect.ownKeys(value);
  if (keys.length > 256) return false;
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) return false;
    if (keys.length !== value.length + 1 || !keys.includes("length"))
      return false;
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (
        descriptor === undefined ||
        descriptor.enumerable !== true ||
        !("value" in descriptor) ||
        !isPlainDataOutput(descriptor.value, seen, depth + 1)
      )
        return false;
    }
    seen.delete(value);
    return true;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  for (const key of keys) {
    if (typeof key !== "string") return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      descriptor.enumerable !== true ||
      !("value" in descriptor) ||
      !isPlainDataOutput(descriptor.value, seen, depth + 1)
    )
      return false;
  }
  seen.delete(value);
  return true;
}

/** Reset only volatile test/session state; nothing is persisted. */
export function resetIssuedRecommendationIds(): void {
  issuedRecommendationIds.clear();
}

function rememberRecommendationId(value: string): void {
  if (!isCanonicalRecommendationId(value)) return;
  issuedRecommendationIds.delete(value);
  issuedRecommendationIds.add(value);
  while (issuedRecommendationIds.size > MAX_ISSUED_RECOMMENDATIONS) {
    const oldest = issuedRecommendationIds.values().next().value;
    if (typeof oldest !== "string") break;
    issuedRecommendationIds.delete(oldest);
  }
}

interface RequestError {
  readonly status: number;
  readonly code: string;
}

export interface AppRequest {
  readonly method: string;
  readonly pathname: string;
  readonly headers?: Readonly<Record<string, string | undefined>>;
  readonly body?: string | Uint8Array;
}

export interface AppResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

/**
 * The localhost alpha uses the explicit fixture port by default.  A
 * production/server composition can pass either the port directly or a
 * dependency object, without importing a database package into this shell.
 */
export interface AppDependencies {
  readonly experimentalCatalogue?: ExperimentalCataloguePort;
  readonly experimentalRecommendation?: ExperimentalRecommendationPort;
  readonly experimentalNanacoCreditChargeRecommendation?: NanacoCreditChargeRecommendationPort;
  readonly implementationFacts?: ImplementationFactBackend;
  /** Descriptive alias accepted for the implementation-fact port. */
  readonly implementationCatalogue?: ImplementationFactBackend;
  /** Explicit alias for callers that prefer the full feature name. */
  readonly implementationFactCatalogue?: ImplementationFactBackend;
  /** Server-only complete P0 fact graph used for bounded result explanations. */
  readonly factInfluenceGraph?: FactInfluenceGraphPort;
  /** Descriptive aliases accepted for host composition. */
  readonly implementationFactInfluenceGraph?: FactInfluenceGraphPort;
  readonly factInfluence?: FactInfluenceGraphPort;
  /** Server-only signed Agent Feed delivery ingress. */
  readonly agentFeedIngress?: AgentFeedIngressPort;
  /** Active machine-validated Agent Feed rules used directly by arithmetic. */
  readonly activeRewardCalculations?: ActiveRewardCalculationPort;
  /** Direct merchant acceptance rows for the selected product families. */
  readonly merchantAcceptance?: MerchantAcceptancePort;
  /** Current research claims for the routing graph and payment layers. */
  readonly routeGraphSource?: RouteGraphSourcePort;
  /** Test/host seam for the server-only OpenAI Agents SDK runner. */
  readonly rewardsAgentRunner?: RewardsAgentRunnerPort;
}

export interface RewardsAgentRunnerPort {
  run(
    capabilities: RewardCapabilities,
    message: string,
  ): Promise<RewardsAgentRunResult>;
}

export type AppCatalogueDependency =
  | ExperimentalCataloguePort
  | ExperimentalRecommendationPort
  | NanacoCreditChargeRecommendationPort
  | ImplementationFactBackend
  | FactInfluenceGraphPort
  | AgentFeedIngressPort
  | ActiveRewardCalculationPort
  | MerchantAcceptancePort
  | RewardsAgentRunnerPort
  | AppDependencies;

/** Complete, explicitly synthetic composition for local browser testing. */
export function createLocalDemoDependencies(): AppDependencies {
  return Object.freeze({
    experimentalCatalogue: getDefaultExperimentalCataloguePort(),
    experimentalRecommendation:
      createUnavailableNanacoExperimentalRecommendationPort(),
    experimentalNanacoCreditChargeRecommendation:
      createUnavailableNanacoCreditChargeRecommendationPort(),
    implementationFacts: getDefaultImplementationFactCataloguePort(),
    factInfluenceGraph: getDefaultFactInfluenceGraphPort(),
    routeGraphSource: createBundledFixtureRouteGraphSource(),
  });
}

function resolveActiveRewardCalculations(
  dependency: AppCatalogueDependency | undefined,
): ActiveRewardCalculationPort | undefined {
  if (
    dependency !== null &&
    typeof dependency === "object" &&
    "activeRewardCalculations" in dependency
  )
    return dependency.activeRewardCalculations;
  return undefined;
}

function resolveMerchantAcceptance(
  dependency: AppCatalogueDependency | undefined,
): MerchantAcceptancePort | undefined {
  if (
    dependency === null ||
    typeof dependency !== "object" ||
    (!Object.hasOwn(dependency, "merchantAcceptance") &&
      !Object.hasOwn(dependency, "listAcceptedFamilies"))
  )
    return undefined;
  if (Object.hasOwn(dependency, "listAcceptedFamilies")) {
    const direct = dependency as Partial<MerchantAcceptancePort>;
    if (typeof direct.listAcceptedFamilies !== "function")
      throw requestError(500, "merchant_acceptance_dependency_invalid");
    return direct as MerchantAcceptancePort;
  }
  const port = (dependency as AppDependencies).merchantAcceptance;
  if (port === undefined) return undefined;
  if (
    port !== null &&
    typeof port === "object" &&
    typeof port.listAcceptedFamilies === "function"
  )
    return port;
  throw requestError(500, "merchant_acceptance_dependency_invalid");
}

function resolveAgentFeedIngress(
  dependency: AppCatalogueDependency | undefined,
): AgentFeedIngressPort | undefined {
  if (
    dependency !== null &&
    typeof dependency === "object" &&
    "handle" in dependency &&
    typeof dependency.handle === "function"
  )
    return dependency as AgentFeedIngressPort;
  if (
    dependency !== null &&
    typeof dependency === "object" &&
    "agentFeedIngress" in dependency
  ) {
    const ingress = dependency.agentFeedIngress;
    if (ingress === undefined) return undefined;
    if (typeof ingress.handle === "function") return ingress;
    throw requestError(500, "agent_feed_ingress_dependency_invalid");
  }
  return undefined;
}

function resolveExperimentalRecommendation(
  dependency: AppCatalogueDependency | undefined,
): ExperimentalRecommendationPort {
  if (dependency === undefined)
    return createUnavailableNanacoExperimentalRecommendationPort();
  if (
    typeof dependency === "object" &&
    dependency !== null &&
    "evaluate" in dependency &&
    typeof dependency.evaluate === "function"
  )
    return dependency as ExperimentalRecommendationPort;
  if (
    typeof dependency === "object" &&
    dependency !== null &&
    "experimentalRecommendation" in dependency
  ) {
    const port = dependency.experimentalRecommendation;
    if (port && typeof port.evaluate === "function") return port;
  }
  throw requestError(500, "experimental_recommendation_dependency_invalid");
}

function resolveNanacoCreditChargeRecommendation(
  dependency: AppCatalogueDependency | undefined,
): NanacoCreditChargeRecommendationPort {
  if (dependency === undefined)
    return createUnavailableNanacoCreditChargeRecommendationPort();
  if (
    typeof dependency === "object" &&
    dependency !== null &&
    "evaluate" in dependency &&
    typeof dependency.evaluate === "function" &&
    !("experimentalRecommendation" in dependency)
  )
    return dependency as NanacoCreditChargeRecommendationPort;
  if (
    typeof dependency === "object" &&
    dependency !== null &&
    "experimentalNanacoCreditChargeRecommendation" in dependency
  ) {
    const port = dependency.experimentalNanacoCreditChargeRecommendation;
    if (port && typeof port.evaluate === "function") return port;
  }
  throw requestError(
    500,
    "nanaco_credit_charge_recommendation_dependency_invalid",
  );
}

function resolveExperimentalCatalogue(
  dependency: AppCatalogueDependency | undefined,
): ExperimentalCataloguePort {
  if (dependency === undefined) return getDefaultExperimentalCataloguePort();
  if (
    typeof dependency === "object" &&
    dependency !== null &&
    "list" in dependency &&
    typeof dependency.list === "function" &&
    "reportCorrection" in dependency &&
    typeof dependency.reportCorrection === "function"
  )
    return dependency as ExperimentalCataloguePort;
  if (
    typeof dependency === "object" &&
    dependency !== null &&
    "experimentalCatalogue" in dependency
  ) {
    const port = dependency.experimentalCatalogue;
    if (
      port !== null &&
      typeof port === "object" &&
      typeof port.list === "function" &&
      typeof port.reportCorrection === "function"
    )
      return port;
  }
  throw requestError(500, "experimental_catalogue_dependency_invalid");
}

/**
 * Resolve the current-claims source, when the host composed one.
 *
 * An absent source is permitted only for code paths that do not perform a
 * live graph calculation. Browser recommendation endpoints call the strict
 * resolver below and fail closed instead of substituting fixtures.
 */
function routeGraphSourceOf(
  dependency: AppCatalogueDependency | undefined,
): RouteGraphSourcePort | undefined {
  if (
    typeof dependency !== "object" ||
    dependency === null ||
    !("routeGraphSource" in dependency)
  )
    return undefined;
  const source = dependency.routeGraphSource;
  return source === null ? undefined : source;
}

function requiredRouteGraphSourceOf(
  dependency: AppCatalogueDependency | undefined,
): RouteGraphSourcePort {
  const source = routeGraphSourceOf(dependency);
  if (source === undefined)
    throw requestError(503, "route_graph_source_unavailable");
  return source;
}

function resolveImplementationCatalogue(
  dependency: AppCatalogueDependency | undefined,
): ImplementationFactCataloguePort {
  if (dependency === undefined)
    return getDefaultImplementationFactCataloguePort();
  if (
    typeof dependency === "object" &&
    dependency !== null &&
    "implementationFacts" in dependency
  ) {
    const backend = dependency.implementationFacts;
    if (backend !== undefined && backend !== null)
      return adaptImplementationFactBackend(backend);
  }
  if (
    typeof dependency === "object" &&
    dependency !== null &&
    "implementationCatalogue" in dependency
  ) {
    const backend = dependency.implementationCatalogue;
    if (backend !== undefined && backend !== null)
      return adaptImplementationFactBackend(backend);
  }
  if (
    typeof dependency === "object" &&
    dependency !== null &&
    "implementationFactCatalogue" in dependency
  ) {
    const backend = dependency.implementationFactCatalogue;
    if (backend !== undefined && backend !== null)
      return adaptImplementationFactBackend(backend);
  }
  // A direct generic PostgreSQL store is unambiguous because it exposes the
  // bounded `search` method. Browser ports should use AppDependencies so
  // they cannot be confused with the existing experimental rules port.
  if (
    typeof dependency === "object" &&
    dependency !== null &&
    "search" in dependency &&
    typeof dependency.search === "function" &&
    "list" in dependency &&
    typeof dependency.list === "function" &&
    "reportCorrection" in dependency &&
    typeof dependency.reportCorrection === "function"
  )
    return adaptImplementationFactBackend(
      dependency as ImplementationFactBackend,
    );
  throw requestError(500, "implementation_fact_catalogue_dependency_invalid");
}

function resolveFactInfluenceGraph(
  dependency: AppCatalogueDependency | undefined,
): FactInfluenceGraphPort {
  if (dependency === undefined) return getDefaultFactInfluenceGraphPort();
  if (
    typeof dependency === "object" &&
    dependency !== null &&
    "factInfluenceGraph" in dependency
  ) {
    const port = dependency.factInfluenceGraph;
    if (port !== undefined && port !== null && typeof port.load === "function")
      return port;
    throw requestError(500, "fact_influence_graph_dependency_invalid");
  }
  if (
    typeof dependency === "object" &&
    dependency !== null &&
    "implementationFactInfluenceGraph" in dependency
  ) {
    const port = dependency.implementationFactInfluenceGraph;
    if (port !== undefined && port !== null && typeof port.load === "function")
      return port;
    throw requestError(500, "fact_influence_graph_dependency_invalid");
  }
  if (
    typeof dependency === "object" &&
    dependency !== null &&
    "factInfluence" in dependency
  ) {
    const port = dependency.factInfluence;
    if (port !== undefined && port !== null && typeof port.load === "function")
      return port;
    throw requestError(500, "fact_influence_graph_dependency_invalid");
  }
  if (
    typeof dependency === "object" &&
    dependency !== null &&
    "load" in dependency &&
    typeof dependency.load === "function"
  )
    return dependency as FactInfluenceGraphPort;
  throw requestError(500, "fact_influence_graph_dependency_invalid");
}

async function factInfluenceForRecommendation(
  dependency: AppCatalogueDependency | undefined,
  effectiveAt: string,
  context: FactInfluenceGraphContext,
  appliedParentClaimIds: readonly string[],
): Promise<FactInfluenceBrowserView> {
  try {
    const graph = await resolveFactInfluenceGraph(dependency).load(effectiveAt);
    if (
      graph.fact_count < 1 ||
      graph.nodes.length !== graph.fact_count ||
      graph.version !== "p0-fact-influence-graph.v1"
    )
      throw new Error("fact_influence_graph_incomplete");
    return projectFactInfluenceForRecommendation(
      graph,
      context,
      appliedParentClaimIds,
    );
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "status" in error &&
      "code" in error
    )
      throw error;
    throw requestError(503, "fact_influence_graph_unavailable");
  }
}

function requestError(status: number, code: string): RequestError {
  return { status, code };
}

function securityHeaders(): Record<string, string> {
  return {
    "Content-Security-Policy": CSP_HEADER,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Cache-Control": "no-store",
  };
}

function jsonResponse(
  status: number,
  value: Readonly<Record<string, unknown>>,
  extraHeaders: Readonly<Record<string, string>> = {},
): AppResponse {
  return {
    status,
    headers: {
      ...securityHeaders(),
      "Content-Type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
    body: JSON.stringify(value),
  };
}

function errorResponse(error: RequestError): AppResponse {
  return jsonResponse(error.status, {
    error: {
      code: error.code,
      message: "Request could not be processed.",
    },
  });
}

function boundedDiagnosticLabel(value: unknown): string {
  return typeof value === "string" && /^[a-zA-Z0-9_.:-]{1,80}$/u.test(value)
    ? value
    : "unclassified";
}

/** Log only bounded error metadata in Vercel; never SQL, inputs, or messages. */
function reportDeploymentFailure(scope: string, error: unknown): void {
  if (process.env.VERCEL !== "1") return;
  const record =
    error !== null && typeof error === "object"
      ? (error as { readonly code?: unknown; readonly name?: unknown })
      : undefined;
  console.error(
    JSON.stringify({
      event: "jro_runtime_failure",
      scope,
      code: boundedDiagnosticLabel(record?.code),
      name: boundedDiagnosticLabel(record?.name),
    }),
  );
}

const EXPERIMENTAL_CORRECTION_FAILURE_CODES = new Set<
  "publication_not_found" | "publication_not_active" | "correction_not_applied"
>([
  "publication_not_found",
  "publication_not_active",
  "correction_not_applied",
]);

const IMPLEMENTATION_FACT_CORRECTION_FAILURE_CODES = new Set<
  "fact_not_found" | "fact_not_active" | "correction_not_applied"
>(["fact_not_found", "fact_not_active", "correction_not_applied"]);

type SafeExperimentalCorrection = Readonly<{
  readonly publication_id: string;
  readonly category: ExperimentalCorrectionInput["category"];
  readonly accepted: true;
}>;

function safeExperimentalCorrection(
  value: unknown,
  input: ExperimentalCorrectionInput,
): SafeExperimentalCorrection {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw requestError(503, "experimental_catalogue_unavailable");
  const result = value as Record<string, unknown>;
  if (result.ok !== true)
    throw requestError(503, "experimental_catalogue_unavailable");
  // Adapters may return private fields (hashes, signal details, and
  // lifecycle status) for their own bookkeeping.  Never copy them into the
  // HTTP response; only verify optional identity echoes before reducing.
  if (
    result.publication_id !== undefined &&
    result.publication_id !== input.publication_id
  )
    throw requestError(503, "experimental_catalogue_unavailable");
  if (result.category !== undefined && result.category !== input.category)
    throw requestError(503, "experimental_catalogue_unavailable");
  return Object.freeze({
    publication_id: input.publication_id,
    category: input.category,
    accepted: true,
  });
}

function experimentalCorrectionError(value: unknown): RequestError {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return requestError(503, "experimental_catalogue_unavailable");
  const result = value as Record<string, unknown>;
  if (
    result.ok !== false ||
    typeof result.code !== "string" ||
    !EXPERIMENTAL_CORRECTION_FAILURE_CODES.has(
      result.code as
        | "publication_not_found"
        | "publication_not_active"
        | "correction_not_applied",
    )
  )
    return requestError(503, "experimental_catalogue_unavailable");
  return requestError(
    result.code === "publication_not_found" ? 404 : 409,
    result.code,
  );
}

function implementationFactCorrectionError(value: unknown): RequestError {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return requestError(503, "implementation_fact_catalogue_unavailable");
  const result = value as Record<string, unknown>;
  if (
    result.ok !== false ||
    typeof result.code !== "string" ||
    !IMPLEMENTATION_FACT_CORRECTION_FAILURE_CODES.has(
      result.code as
        | "fact_not_found"
        | "fact_not_active"
        | "correction_not_applied",
    )
  )
    return requestError(503, "implementation_fact_catalogue_unavailable");
  return requestError(
    result.code === "fact_not_found" ? 404 : 409,
    result.code,
  );
}

function safeExperimentalRecommendation(
  value: unknown,
  input: ExperimentalRecommendationInput,
): ExperimentalRecommendationResult {
  if (!isPlainDataOutput(value))
    throw requestError(503, "experimental_recommendation_unavailable");
  const result = value as Record<string, unknown>;
  const expected = [
    "version",
    "request_id",
    "mode",
    "verification_status",
    "outcome",
    "selection_id",
    "payment_method",
    "merchant_id",
    "branch_id",
    "amount_jpy",
    "tax_exclusive_amount_jpy",
    "effective_at",
    "winner_plan_id",
    "winner",
    "plans",
    "assumptions",
    "blockers",
  ].sort();
  if (
    Object.keys(result).sort().length !== expected.length ||
    Object.keys(result)
      .sort()
      .some((key, index) => key !== expected[index])
  )
    throw requestError(503, "experimental_recommendation_unavailable");
  if (
    result.version !== "real-experimental-recommendation.v1" ||
    result.mode !== "experimental_real_data" ||
    result.verification_status !== "experimental_unverified" ||
    result.selection_id !== input.selection_id ||
    result.payment_method !== "nanaco" ||
    result.merchant_id !== "merchant.seveneleven" ||
    result.amount_jpy !== input.amount_jpy ||
    result.tax_exclusive_amount_jpy !== input.tax_exclusive_amount_jpy ||
    result.effective_at !== input.effective_at ||
    (result.outcome !== "definite" && result.outcome !== "no_valid_plan")
  )
    throw requestError(503, "experimental_recommendation_unavailable");
  if (
    typeof result.request_id !== "string" ||
    result.request_id.length === 0 ||
    result.request_id.length > 120 ||
    typeof result.branch_id !== "string" ||
    result.branch_id !== "location.seveneleven.representative"
  )
    throw requestError(503, "experimental_recommendation_unavailable");
  if (
    !Number.isSafeInteger(result.amount_jpy) ||
    !Number.isSafeInteger(result.tax_exclusive_amount_jpy) ||
    (result.tax_exclusive_amount_jpy as number) < 0 ||
    (result.tax_exclusive_amount_jpy as number) > (result.amount_jpy as number)
  )
    throw requestError(503, "experimental_recommendation_unavailable");
  // Validate dependency array shape without copying dependency text into the
  // browser DTO. Hostile strings may contain rule/evidence IDs or predicates.
  const safeStringArrayLength = (value: unknown): number => {
    if (
      !Array.isArray(value) ||
      value.length > 16 ||
      value.some(
        (item) =>
          typeof item !== "string" || item.length === 0 || item.length > 240,
      )
    )
      throw requestError(503, "experimental_recommendation_unavailable");
    return value.length;
  };
  const safePlan = (
    value: unknown,
  ): ExperimentalRecommendationResult["winner"] => {
    if (value === null) return null;
    if (typeof value !== "object" || Array.isArray(value))
      throw requestError(503, "experimental_recommendation_unavailable");
    const plan = value as Record<string, unknown>;
    const keys = Object.keys(plan).sort();
    if (
      keys.join(",") !==
      [
        "conditions",
        "eligible",
        "objective_score_jpy",
        "operation_count",
        "plan_id",
        "reward_points",
      ]
        .sort()
        .join(",")
    )
      throw requestError(503, "experimental_recommendation_unavailable");
    if (
      typeof plan.plan_id !== "string" ||
      !EXPERIMENTAL_PUBLIC_PLAN_ID_PATTERN.test(plan.plan_id) ||
      typeof plan.eligible !== "boolean" ||
      typeof plan.reward_points !== "string" ||
      !/^\d{1,32}$/u.test(plan.reward_points) ||
      (plan.objective_score_jpy !== null &&
        (typeof plan.objective_score_jpy !== "string" ||
          !/^-?\d{1,32}(?:\.\d{1,4})?$/u.test(plan.objective_score_jpy))) ||
      !Number.isSafeInteger(plan.operation_count) ||
      (plan.operation_count as number) < 0
    )
      throw requestError(503, "experimental_recommendation_unavailable");
    const conditionCount = safeStringArrayLength(plan.conditions);
    return Object.freeze({
      plan_id: plan.plan_id,
      eligible: plan.eligible,
      reward_points: plan.reward_points,
      objective_score_jpy: plan.objective_score_jpy,
      operation_count: plan.operation_count as number,
      conditions: Object.freeze(
        conditionCount === 0 ? [] : ["利用条件を確認してください。"],
      ),
    });
  };
  if (!Array.isArray(result.plans) || result.plans.length > 16)
    throw requestError(503, "experimental_recommendation_unavailable");
  const plans = Object.freeze(
    result.plans.map((item) => {
      const parsed = safePlan(item);
      if (parsed === null)
        throw requestError(503, "experimental_recommendation_unavailable");
      return parsed;
    }),
  );
  const winner = safePlan(result.winner);
  if (
    result.winner_plan_id !== (winner?.plan_id ?? null) ||
    (result.outcome === "definite" &&
      (winner === null ||
        !winner.eligible ||
        plans.length === 0 ||
        plans.some((plan) => !plan.eligible))) ||
    (result.outcome === "no_valid_plan" &&
      (winner !== null || plans.some((plan) => plan.eligible))) ||
    new Set(plans.map((plan) => plan.plan_id)).size !== plans.length
  )
    throw requestError(503, "experimental_recommendation_unavailable");
  if (result.outcome === "definite" && winner !== null) {
    const winnerMatches = plans.filter(
      (plan) => plan.plan_id === winner.plan_id,
    );
    if (
      winnerMatches.length !== 1 ||
      JSON.stringify(winnerMatches[0]) !== JSON.stringify(winner)
    )
      throw requestError(503, "experimental_recommendation_unavailable");
  }
  const assumptionCount = safeStringArrayLength(result.assumptions);
  const blockerCount = safeStringArrayLength(result.blockers);
  return Object.freeze({
    version: "real-experimental-recommendation.v1",
    // Host-owned opaque route identifier; never expose a dependency request
    // key that could carry internal rule or evidence identity.
    request_id: "experimental_nanaco_seveneleven",
    mode: "experimental_real_data",
    verification_status: "experimental_unverified",
    outcome: result.outcome,
    selection_id: result.selection_id,
    payment_method: "nanaco",
    merchant_id: "merchant.seveneleven",
    branch_id: result.branch_id,
    amount_jpy: result.amount_jpy,
    tax_exclusive_amount_jpy: result.tax_exclusive_amount_jpy,
    effective_at: result.effective_at,
    winner_plan_id: result.winner_plan_id as string | null,
    winner,
    plans,
    assumptions: Object.freeze(
      assumptionCount === 0 ? [] : [...EXPERIMENTAL_PUBLIC_ASSUMPTIONS],
    ),
    blockers: Object.freeze(
      blockerCount === 0 ? [] : [EXPERIMENTAL_PUBLIC_BLOCKER],
    ),
  });
}

function safeNanacoCreditChargeRecommendation(
  value: unknown,
  input: NanacoCreditChargeRecommendationInput,
): NanacoCreditChargeRecommendationResult {
  if (!isPlainDataOutput(value))
    throw requestError(503, "nanaco_credit_charge_recommendation_unavailable");
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw requestError(503, "nanaco_credit_charge_recommendation_unavailable");
  const result = value as Record<string, unknown>;
  const expected = [
    "version",
    "request_id",
    "mode",
    "verification_status",
    "outcome",
    "selection_id",
    "payment_method",
    "destination",
    "charge_amount_jpy",
    "nanaco_balance_before_jpy",
    "nanaco_balance_after_jpy",
    "effective_at",
    "winner_plan_id",
    "winner",
    "plans",
    "assumptions",
    "blockers",
  ].sort();
  if (
    Object.keys(result).sort().length !== expected.length ||
    Object.keys(result)
      .sort()
      .some((key, index) => key !== expected[index])
  )
    throw requestError(503, "nanaco_credit_charge_recommendation_unavailable");
  if (
    result.version !==
      "real-experimental-nanaco-credit-charge-recommendation.v1" ||
    result.mode !== "experimental_real_data" ||
    result.verification_status !== "experimental_unverified" ||
    result.selection_id !== input.selection_id ||
    result.payment_method !== "seven_card_plus" ||
    result.destination !== "nanaco" ||
    result.charge_amount_jpy !== input.charge_amount_jpy ||
    result.nanaco_balance_before_jpy !== input.nanaco_balance_jpy ||
    result.nanaco_balance_after_jpy !==
      input.nanaco_balance_jpy + input.charge_amount_jpy ||
    result.effective_at !== input.effective_at ||
    result.outcome !== "definite"
  )
    throw requestError(503, "nanaco_credit_charge_recommendation_unavailable");
  if (
    typeof result.request_id !== "string" ||
    !/^experimental_nanaco_credit_charge_[0-9a-f]{64}$/u.test(result.request_id)
  )
    throw requestError(503, "nanaco_credit_charge_recommendation_unavailable");
  const safeStrings = (value: unknown): readonly string[] => {
    if (
      !Array.isArray(value) ||
      value.length > 16 ||
      value.some(
        (item) =>
          typeof item !== "string" ||
          item.length === 0 ||
          item.length > 240 ||
          /https?:\/\//iu.test(item) ||
          /sha256:[0-9a-f]{16,}/iu.test(item),
      )
    )
      throw requestError(
        503,
        "nanaco_credit_charge_recommendation_unavailable",
      );
    return Object.freeze([...value]);
  };
  const safePlan = (
    value: unknown,
  ): NanacoCreditChargeRecommendationResult["winner"] => {
    if (value === null) return null;
    if (typeof value !== "object" || Array.isArray(value))
      throw requestError(
        503,
        "nanaco_credit_charge_recommendation_unavailable",
      );
    const plan = value as Record<string, unknown>;
    const keys = Object.keys(plan).sort();
    if (
      keys.join(",") !==
      [
        "conditions",
        "eligible",
        "objective_score_jpy",
        "operation_count",
        "plan_id",
        "reward_points",
      ]
        .sort()
        .join(",")
    )
      throw requestError(
        503,
        "nanaco_credit_charge_recommendation_unavailable",
      );
    if (
      typeof plan.plan_id !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(plan.plan_id) ||
      typeof plan.eligible !== "boolean" ||
      typeof plan.reward_points !== "string" ||
      !/^\d{1,32}$/u.test(plan.reward_points) ||
      (plan.objective_score_jpy !== null &&
        typeof plan.objective_score_jpy !== "string") ||
      !Number.isSafeInteger(plan.operation_count) ||
      (plan.operation_count as number) < 0
    )
      throw requestError(
        503,
        "nanaco_credit_charge_recommendation_unavailable",
      );
    return Object.freeze({
      plan_id: plan.plan_id,
      eligible: plan.eligible,
      reward_points: plan.reward_points,
      objective_score_jpy: plan.objective_score_jpy,
      operation_count: plan.operation_count as number,
      conditions: safeStrings(plan.conditions),
    });
  };
  if (!Array.isArray(result.plans) || result.plans.length !== 1)
    throw requestError(503, "nanaco_credit_charge_recommendation_unavailable");
  const plans = Object.freeze(
    result.plans.map((item) => {
      const plan = safePlan(item);
      if (plan === null)
        throw requestError(
          503,
          "nanaco_credit_charge_recommendation_unavailable",
        );
      return plan;
    }),
  );
  const winner = safePlan(result.winner);
  const onlyPlan = plans[0];
  const expectedRewardPoints = String(
    Math.floor(
      input.charge_amount_jpy / NANACO_CREDIT_CHARGE_REWARD_QUANTUM_JPY,
    ),
  );
  if (
    onlyPlan === undefined ||
    onlyPlan.plan_id !== NANACO_CREDIT_CHARGE_PLAN_ID ||
    onlyPlan.eligible !== true ||
    onlyPlan.reward_points !== expectedRewardPoints ||
    onlyPlan.objective_score_jpy !== null ||
    onlyPlan.operation_count !== 1 ||
    onlyPlan.conditions.length !== 0 ||
    winner === null ||
    JSON.stringify(winner) !== JSON.stringify(onlyPlan) ||
    result.winner_plan_id !== (winner?.plan_id ?? null) ||
    result.winner_plan_id !== NANACO_CREDIT_CHARGE_PLAN_ID ||
    JSON.stringify(result.assumptions) !==
      JSON.stringify(NANACO_CREDIT_CHARGE_PUBLIC_ASSUMPTIONS) ||
    JSON.stringify(result.blockers) !==
      JSON.stringify(NANACO_CREDIT_CHARGE_PUBLIC_BLOCKERS)
  )
    throw requestError(503, "nanaco_credit_charge_recommendation_unavailable");
  return Object.freeze({
    version: "real-experimental-nanaco-credit-charge-recommendation.v1",
    request_id: result.request_id,
    mode: "experimental_real_data",
    verification_status: "experimental_unverified",
    outcome: result.outcome,
    selection_id: result.selection_id,
    payment_method: "seven_card_plus",
    destination: "nanaco",
    charge_amount_jpy: result.charge_amount_jpy,
    nanaco_balance_before_jpy: result.nanaco_balance_before_jpy,
    nanaco_balance_after_jpy: result.nanaco_balance_after_jpy,
    effective_at: result.effective_at,
    winner_plan_id: result.winner_plan_id as string | null,
    winner,
    plans,
    assumptions: safeStrings(result.assumptions),
    blockers: safeStrings(result.blockers),
  });
}

type SafeImplementationFactCorrection = Readonly<{
  readonly fact_key: string;
  readonly category: ImplementationFactCorrectionInput["category"];
  readonly accepted: true;
}>;

function safeImplementationFactCorrection(
  value: unknown,
  input: ImplementationFactCorrectionInput,
): SafeImplementationFactCorrection {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw requestError(503, "implementation_fact_catalogue_unavailable");
  const result = value as Record<string, unknown>;
  if (
    result.ok !== true ||
    (result.fact_key !== undefined && result.fact_key !== input.fact_key) ||
    (result.category !== undefined && result.category !== input.category) ||
    (result.outcome !== undefined &&
      result.outcome !== "recorded" &&
      result.outcome !== "duplicate")
  )
    throw requestError(503, "implementation_fact_catalogue_unavailable");
  return Object.freeze({
    fact_key: input.fact_key,
    category: input.category,
    accepted: true,
  });
}

type UnifiedValidityState = "active" | "scheduled" | "expired" | "unknown";
type UnifiedRouteStatus =
  | "eligible"
  | "conditional"
  | "no_valid_plan"
  | "blocked"
  | "unavailable";
type UnifiedRouteIssue =
  | "facts_unavailable"
  | "fact_binding_required"
  | "catalogue_unavailable"
  | "route_unavailable"
  | "route_input_invalid"
  | "rule_not_current"
  | "no_valid_plan"
  | "recommendation_malformed";

interface UnifiedRouteRecord {
  readonly route_id: string;
  readonly label: string;
  readonly kind: "calculation" | "information_only";
  readonly status: UnifiedRouteStatus;
  readonly validity_state: UnifiedValidityState;
  readonly issues: readonly UnifiedRouteIssue[];
  /** Comparable value only; native reward quantities remain in the plan. */
  readonly objective_score_jpy?: string | null;
  /** Purchase routes can compete for the merchant transaction; funding routes
   * are exposed separately and never win that comparison. */
  readonly comparison_role?: "purchase" | "funding";
  readonly reward_units?: string | null;
  readonly reward_asset_id?: string | null;
  readonly reward_label?: string | null;
  readonly valuation?: ReturnType<typeof defaultPointValuation>;
  readonly recommendation_id?: `sha256:${string}`;
  readonly recommendation?: Readonly<Record<string, unknown>>;
  readonly fact_influence?: FactInfluenceBrowserView;
  /** Official provenance for structured Agent Feed claims used in arithmetic. */
  readonly source_url?: string;
  readonly checked_at?: string;
  readonly automatic_application?: true;
  readonly calculation_source?: "agent_feed_structured";
}

/**
 * The unified endpoint keeps the complete graph projection host-side while
 * building the route result.  Only this bounded shared projection crosses
 * the browser boundary; route records carry references into it below.
 */
interface UnifiedFactInfluenceShared {
  readonly version: FactInfluenceBrowserView["version"];
  readonly fact_count: number;
  readonly active_count: number;
  readonly relevant_count: number;
  readonly relevant_factor_ids: readonly string[];
  readonly applied_count: number;
  readonly applied_factor_ids: readonly string[];
  readonly factors: readonly FactInfluenceBrowserFactor[];
  readonly deferred_factor_ids: readonly string[];
}

interface UnifiedFactInfluenceRef {
  readonly applied_factor_ids: readonly string[];
  readonly relevant_factor_ids: readonly string[];
  readonly deferred_factor_ids: readonly string[];
}

interface UnifiedCompactRouteRecord
  extends Omit<UnifiedRouteRecord, "fact_influence"> {
  readonly fact_influence_ref?: UnifiedFactInfluenceRef;
}

interface UnifiedRecommendationsResult {
  readonly routes: readonly UnifiedCompactRouteRecord[];
  readonly supplemental_routes: readonly UnifiedCompactRouteRecord[];
  readonly comparison: UnifiedComparisonSummary;
  readonly fact_influence_shared: UnifiedFactInfluenceShared | null;
  readonly questions: readonly string[];
}

function unifiedRecommendationId(
  routeId: string,
  input: UnifiedRecommendationInput,
): `sha256:${string}` {
  const payload = JSON.stringify({
    route_id: routeId,
    merchant_id: input.merchant_id,
    branch_id: input.branch_id,
    amount_jpy: input.amount_jpy,
    tax_exclusive_amount_jpy: input.tax_exclusive_amount_jpy,
    nanaco_balance_jpy: input.nanaco_balance_jpy,
    nanaco_credit_charge_balance_jpy: input.nanaco_credit_charge_balance_jpy,
    charge_amount_jpy: input.charge_amount_jpy,
    seven_card_plus_owned: input.seven_card_plus_owned,
    nanaco_credit_charge_preregistered:
      input.nanaco_credit_charge_preregistered,
    effective_at: input.effective_at,
    owned_instruments: input.owned_instruments,
    selected_p0_products: input.selected_p0_products,
    stored_value_use: input.stored_value_use,
    stored_value_usage: input.stored_value_usage ?? null,
    stored_value_value_jpy_per_unit:
      input.stored_value_value_jpy_per_unit ?? null,
    facts: input.facts,
    caps: input.caps,
  });
  return `sha256:${createHash("sha256").update(payload, "utf8").digest("hex")}`;
}

const EXPERIMENTAL_PUBLIC_ASSUMPTIONS = Object.freeze([
  "セブン‐イレブンでのnanaco利用に限定した先行実験です。",
  "入力された総額と税抜対象額をそのまま扱います。税額変換は推測しません。",
  "本結果は本番のおすすめではなく、nanaco実験ルートの確認用です。",
]);
const EXPERIMENTAL_PUBLIC_BLOCKER =
  "本番公開の認可情報がないため、情報表示として扱います。";
const EXPERIMENTAL_PUBLIC_PLAN_ID_PATTERN = /^plan_direct_[0-9a-f]{16}$/u;
const REWARD_ASSET_BY_LABEL: Readonly<Record<string, string>> = Object.freeze({
  dポイント: "point.d",
  "JRE POINT": "point.jre",
  nanacoポイント: "point.nanaco",
  PayPayポイント: "point.paypay",
  Pontaポイント: "point.ponta",
  楽天ポイント: "point.rakuten",
  Vポイント: "point.v",
  "WAON POINT": "point.waon",
});

function recordValue(value: unknown, key: string): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return undefined;
  return (value as Record<string, unknown>)[key];
}

function rewardPlanForRoute(
  route: UnifiedRouteRecord,
): Record<string, unknown> | null {
  const recommendation = route.recommendation;
  const winner = recordValue(recommendation, "winner");
  if (winner !== undefined && winner !== null && typeof winner === "object")
    return winner as Record<string, unknown>;
  const primary = recordValue(recommendation, "primary");
  if (primary !== undefined && primary !== null && typeof primary === "object")
    return primary as Record<string, unknown>;
  return null;
}

function scoreText(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{1,32}(?:\.\d{1,4})?$/u.test(value))
    return null;
  const [integer, fraction = ""] = value.split(".");
  const normalizedInteger = integer.replace(/^0+(?=\d)/u, "");
  const normalizedFraction = fraction.replace(/0+$/u, "");
  return normalizedFraction
    ? `${normalizedInteger}.${normalizedFraction}`
    : normalizedInteger;
}

function routeRewardAssetId(
  route: UnifiedRouteRecord,
  rewardLabel: string | null,
): string | null {
  if (
    route.route_id === "nanaco_purchase" ||
    route.route_id === "nanaco_credit_charge"
  )
    return "point.nanaco";
  return rewardLabel === null
    ? null
    : (REWARD_ASSET_BY_LABEL[rewardLabel] ?? null);
}

function withPlanObjectiveScore(
  route: UnifiedRouteRecord,
  score: string,
): Readonly<Record<string, unknown>> | undefined {
  if (route.recommendation === undefined) return undefined;
  const recommendation = route.recommendation;
  const winner = recordValue(recommendation, "winner");
  if (winner !== undefined && winner !== null && typeof winner === "object")
    return {
      ...recommendation,
      winner: {
        ...(winner as Record<string, unknown>),
        objective_score_jpy: score,
      },
    };
  const primary = recordValue(recommendation, "primary");
  if (primary !== undefined && primary !== null && typeof primary === "object")
    return {
      ...recommendation,
      primary: {
        ...(primary as Record<string, unknown>),
        objective_score_jpy: score,
      },
    };
  return undefined;
}

function enrichUnifiedRoute(route: UnifiedRouteRecord): {
  readonly route: UnifiedRouteRecord;
  readonly candidate: RankingCandidate | null;
} {
  const plan = rewardPlanForRoute(route);
  const rewardUnits = scoreText(plan?.reward_points);
  const rewardLabel =
    typeof plan?.reward_label === "string" ? plan.reward_label : null;
  const existingScore = scoreText(plan?.objective_score_jpy);
  const score = existingScore ?? rewardUnits;
  const role =
    route.route_id === "nanaco_credit_charge"
      ? ("funding" as const)
      : ("purchase" as const);
  const rewardAssetId = routeRewardAssetId(route, rewardLabel);
  if (role === "funding") {
    return {
      route: Object.freeze({
        ...route,
        // A top-up reward is not a reward for the merchant purchase.  Keep
        // the native reward_points inside the supplemental plan, but never
        // project it into the purchase comparison's JPY objective.
        comparison_role: role,
        reward_units: rewardUnits,
        reward_asset_id: rewardAssetId,
        reward_label: rewardLabel,
      }),
      candidate: null,
    };
  }
  if (route.status !== "eligible" || score === null) {
    return {
      route: Object.freeze({
        ...route,
        objective_score_jpy: existingScore,
        comparison_role: role,
        reward_units: rewardUnits,
        reward_asset_id: rewardAssetId,
        reward_label: rewardLabel,
      }),
      candidate: null,
    };
  }
  const valuation =
    existingScore !== null
      ? Object.freeze({
          ...defaultPointValuation(rewardAssetId),
          source: "engine_profile" as const,
          note: "エンジンが計算したユーザー評価を採用",
        })
      : defaultPointValuation(rewardAssetId);
  const enrichedRoute = Object.freeze({
    ...route,
    objective_score_jpy: score,
    comparison_role: role,
    reward_units: rewardUnits,
    reward_asset_id: rewardAssetId,
    reward_label: rewardLabel,
    valuation,
    ...(withPlanObjectiveScore(route, score)
      ? { recommendation: withPlanObjectiveScore(route, score) }
      : {}),
  });
  return {
    route: enrichedRoute,
    candidate: Object.freeze({
      route_id: route.route_id,
      label: route.label,
      objective_score_jpy: score,
      reward_units: rewardUnits,
      reward_asset_id: rewardAssetId,
      reward_label: rewardLabel,
      valuation,
      comparison_role: role,
    }),
  };
}

function rankRouteOrder(
  routes: readonly UnifiedRouteRecord[],
  comparison: UnifiedComparisonSummary,
): readonly UnifiedRouteRecord[] {
  const rankByRouteId = new Map(
    comparison.ranked_routes.map((item) => [item.route_id, item.rank]),
  );
  return Object.freeze(
    routes
      .map((route, index) => ({ route, index }))
      .sort((left, right) => {
        const leftRank = rankByRouteId.get(left.route.route_id);
        const rightRank = rankByRouteId.get(right.route.route_id);
        if (leftRank !== undefined && rightRank !== undefined)
          return leftRank - rightRank;
        if (leftRank !== undefined) return -1;
        if (rightRank !== undefined) return 1;
        return left.index - right.index;
      })
      .map((item) => item.route),
  );
}

const MAX_UNIFIED_INLINE_FACTORS = 3 as const;

function compactUnifiedFactInfluence(routes: readonly UnifiedRouteRecord[]): {
  readonly routes: readonly UnifiedCompactRouteRecord[];
  readonly shared: UnifiedFactInfluenceShared | null;
} {
  const views = routes.flatMap((route) =>
    route.fact_influence === undefined
      ? []
      : [{ route_id: route.route_id, view: route.fact_influence }],
  );
  if (views.length === 0)
    return Object.freeze({
      routes: Object.freeze(
        routes.map(({ fact_influence: _factInfluence, ...route }) =>
          Object.freeze(route),
        ),
      ),
      shared: null,
    });

  const relevantFactorIds: string[] = [];
  const relevantFactorIdSet = new Set<string>();
  const appliedFactorIds: string[] = [];
  const appliedFactorIdSet = new Set<string>();
  const factorsById = new Map<string, FactInfluenceBrowserFactor>();
  for (const { view } of views) {
    for (const factorId of view.relevant_factor_ids) {
      if (relevantFactorIdSet.has(factorId)) continue;
      relevantFactorIdSet.add(factorId);
      relevantFactorIds.push(factorId);
    }
    for (const factorId of view.applied_factor_ids) {
      if (appliedFactorIdSet.has(factorId)) continue;
      appliedFactorIdSet.add(factorId);
      appliedFactorIds.push(factorId);
    }
    for (const factor of view.factors) {
      const previous = factorsById.get(factor.factor_id);
      // If one route applied a factor and another route only related to it,
      // retain the applied projection in the shared detail.
      if (previous === undefined || (!previous.applied && factor.applied))
        factorsById.set(factor.factor_id, factor);
    }
  }

  const inlineFactors = Object.freeze(
    [...factorsById.values()]
      .sort((left, right) => {
        const leftPriority = left.applied
          ? 0
          : left.graph_role === "constraint"
            ? 1
            : left.graph_role === "warning"
              ? 2
              : 3;
        const rightPriority = right.applied
          ? 0
          : right.graph_role === "constraint"
            ? 1
            : right.graph_role === "warning"
              ? 2
              : 3;
        return leftPriority - rightPriority;
      })
      .slice(0, MAX_UNIFIED_INLINE_FACTORS),
  );
  const inlineFactorIds = new Set(
    inlineFactors.map((factor) => factor.factor_id),
  );
  const shared = Object.freeze({
    version: views[0].view.version,
    fact_count: views[0].view.fact_count,
    active_count: views[0].view.active_count,
    relevant_count: relevantFactorIds.length,
    applied_count: appliedFactorIds.length,
    relevant_factor_ids: Object.freeze(relevantFactorIds),
    applied_factor_ids: Object.freeze(appliedFactorIds),
    factors: inlineFactors,
    deferred_factor_ids: Object.freeze(
      relevantFactorIds.filter((factorId) => !inlineFactorIds.has(factorId)),
    ),
  });
  const compactRoutes = Object.freeze(
    routes.map((route) => {
      const view = route.fact_influence;
      const { fact_influence: _factInfluence, ...withoutFullView } = route;
      if (view === undefined) return Object.freeze(withoutFullView);
      return Object.freeze({
        ...withoutFullView,
        fact_influence_ref: Object.freeze({
          applied_factor_ids: view.applied_factor_ids,
          relevant_factor_ids: view.relevant_factor_ids,
          deferred_factor_ids: Object.freeze(
            view.relevant_factor_ids.filter(
              (factorId) => !inlineFactorIds.has(factorId),
            ),
          ),
        }),
      });
    }),
  );
  return Object.freeze({ routes: compactRoutes, shared });
}

async function unifiedRecommendations(
  input: UnifiedRecommendationInput,
  dependency: AppCatalogueDependency | undefined,
  preferences: SessionPurchasePreferences = DEFAULT_SESSION_PURCHASE_PREFERENCES,
): Promise<UnifiedRecommendationsResult> {
  const selected = Object.freeze(
    input.selected_p0_products.filter(
      (familyId) => !preferences.excluded_family_ids.includes(familyId),
    ),
  );
  const activePort = resolveActiveRewardCalculations(dependency);
  const acceptancePort = resolveMerchantAcceptance(dependency);

  const unavailableRoute = (
    routeId: string,
    label: string,
    issue: UnifiedRouteIssue = "route_unavailable",
  ): UnifiedRouteRecord =>
    Object.freeze({
      route_id: routeId,
      label,
      kind: "calculation" as const,
      status: "unavailable" as const,
      validity_state: "unknown" as const,
      issues: Object.freeze([issue]),
    });

  const noValidRoute = (routeId: string, label: string): UnifiedRouteRecord =>
    Object.freeze({
      route_id: routeId,
      label,
      kind: "calculation" as const,
      status: "no_valid_plan" as const,
      validity_state: "active" as const,
      issues: Object.freeze(["no_valid_plan" as const]),
    });

  const emptyRoutes = (
    status: "unavailable" | "no_valid_plan",
    issue: UnifiedRouteIssue,
  ): readonly UnifiedRouteRecord[] => {
    if (selected.length === 0)
      return Object.freeze([
        status === "unavailable"
          ? unavailableRoute(
              "active_reward_calculations",
              "現在の支払いルート",
              issue,
            )
          : noValidRoute("active_reward_calculations", "現在の支払いルート"),
      ]);
    return Object.freeze(
      selected.map((familyId) => {
        const definition = p0ProductFamilyDefinition(familyId);
        const label = definition?.label ?? familyId;
        return status === "unavailable"
          ? unavailableRoute(`selected_product_${familyId}`, label, issue)
          : noValidRoute(`selected_product_${familyId}`, label);
      }),
    );
  };

  const routeResult = async (
    routes: readonly UnifiedRouteRecord[],
  ): Promise<UnifiedRecommendationsResult> => {
    const enriched = routes.map(enrichUnifiedRoute);
    const comparison = rankUnifiedRoutes(
      enriched.flatMap((item) => (item.candidate ? [item.candidate] : [])),
      preferences,
    );
    const purchaseRoutes = enriched
      .filter((item) => item.route.comparison_role !== "funding")
      .map((item) => item.route);
    const supplementalRoutes = enriched
      .filter((item) => item.route.comparison_role === "funding")
      .map((item) => item.route);
    const compacted = compactUnifiedFactInfluence([
      ...purchaseRoutes,
      ...supplementalRoutes,
    ]);
    const compactByRouteId = new Map(
      compacted.routes.map((route) => [route.route_id, route]),
    );
    return Object.freeze({
      routes: Object.freeze(
        rankRouteOrder(purchaseRoutes, comparison).map(
          (route) => compactByRouteId.get(route.route_id) ?? route,
        ) as readonly UnifiedCompactRouteRecord[],
      ),
      supplemental_routes: Object.freeze(
        supplementalRoutes.map(
          (route) => compactByRouteId.get(route.route_id) ?? route,
        ) as readonly UnifiedCompactRouteRecord[],
      ),
      comparison,
      fact_influence_shared: compacted.shared,
      questions: Object.freeze([]) as readonly string[],
    });
  };

  // A real merchant must have a host-composed acceptance view. Synthetic is
  // retained only as a development merchant; it never supplies economics.
  if (input.merchant_id !== SYNTHETIC_MERCHANT_ID && !acceptancePort)
    return routeResult(emptyRoutes("unavailable", "catalogue_unavailable"));

  let accepted: ReadonlySet<string> | null = null;
  if (acceptancePort) {
    try {
      const acceptedIds = await acceptancePort.listAcceptedFamilies({
        merchant_id: input.merchant_id,
        branch_id: input.branch_id,
        family_ids: selected,
        effective_at: input.effective_at,
      });
      if (
        !Array.isArray(acceptedIds) ||
        acceptedIds.length > 128 ||
        !acceptedIds.every((familyId) => isCanonicalProductFamilyId(familyId))
      )
        throw new Error("merchant_acceptance_result_invalid");
      accepted = new Set(
        acceptedIds.filter((familyId) => selected.includes(familyId)),
      );
    } catch (error) {
      reportDeploymentFailure("merchant_acceptance", error);
      return routeResult(emptyRoutes("unavailable", "catalogue_unavailable"));
    }
  }

  if (!activePort)
    reportDeploymentFailure(
      "active_reward_calculation",
      new Error("active_reward_calculation_unavailable"),
    );

  let activeCalculations: Awaited<
    ReturnType<ActiveRewardCalculationPort["calculate"]>
  > = [];
  if (activePort) {
    try {
      activeCalculations = await activePort.calculate({
        selected_p0_products: selected,
        merchant_id: input.merchant_id,
        branch_id: input.branch_id,
        amount_jpy: input.amount_jpy,
        tax_exclusive_amount_jpy: input.tax_exclusive_amount_jpy,
        effective_at: input.effective_at,
      });
      if (!Array.isArray(activeCalculations))
        throw new Error("active_reward_calculation_result_invalid");
    } catch (error) {
      reportDeploymentFailure("active_reward_calculation", error);
      return routeResult(emptyRoutes("unavailable", "route_unavailable"));
    }
  }

  const byFamily = new Map(
    activeCalculations.map((calculation) => [
      calculation.family_id,
      calculation,
    ]),
  );
  const uncovered = selected.filter((familyId) => !byFamily.has(familyId));
  if (uncovered.length > 0) {
    let databaseCalculations: Awaited<
      ReturnType<ActiveRewardCalculationPort["calculate"]>
    >;
    try {
      databaseCalculations = await calculateSelectedProductPurchases(
        uncovered,
        input.amount_jpy,
        requiredRouteGraphSourceOf(dependency),
        input.effective_at,
      );
    } catch (error) {
      reportDeploymentFailure("route_graph_calculation", error);
      return routeResult(emptyRoutes("unavailable", "route_unavailable"));
    }
    for (const calculation of databaseCalculations)
      byFamily.set(calculation.family_id, calculation);
  }

  const calculations = [...byFamily.values()].filter(
    (calculation) =>
      isCanonicalProductFamilyId(calculation.family_id) &&
      selected.includes(calculation.family_id) &&
      (accepted === null || accepted.has(calculation.family_id)),
  );
  if (calculations.length === 0)
    return routeResult(emptyRoutes("no_valid_plan", "no_valid_plan"));

  const selectedRoutes = calculations.map((calculation) => {
    const routeId = `selected_product_${calculation.family_id}`;
    const recommendationId = unifiedRecommendationId(routeId, input);
    rememberRecommendationId(recommendationId);
    return Object.freeze({
      route_id: routeId,
      label: calculation.label,
      kind: "calculation" as const,
      status: "eligible" as const,
      validity_state: "active" as const,
      issues: Object.freeze([]),
      ...(calculation.source_url ? { source_url: calculation.source_url } : {}),
      checked_at: calculation.checked_at,
      automatic_application: true as const,
      calculation_source: calculation.calculation_source,
      recommendation_id: recommendationId,
      recommendation: Object.freeze({
        outcome: "definite",
        winner: Object.freeze({
          plan_id: `plan_${calculation.family_id.replaceAll(".", "_")}`,
          display_name: `${calculation.label}で支払う`,
          reward_points: calculation.reward_points,
          reward_label: calculation.reward_label,
          reward_rate_percent: calculation.rate_percent,
          objective_score_jpy: null,
          source_claim_id: calculation.source_claim_id,
          conditions: Object.freeze([calculation.calculation_note]),
        }),
      }),
    });
  });
  return routeResult(selectedRoutes);
}

const CAPABILITY_TOOL_NAMES = Object.freeze([
  "get_rewards_passport_summary",
  "get_expiring_rewards",
  "get_current_purchase_context",
  "compare_purchase_routes",
  "set_session_purchase_preferences",
  "explain_purchase_route",
] as const);
type CapabilityToolName = (typeof CAPABILITY_TOOL_NAMES)[number];

interface ParsedCapabilityInvocation {
  readonly tool: CapabilityToolName;
  readonly purchaseContext: UnifiedRecommendationInput | null;
  readonly preferences: SessionPurchasePreferences;
  readonly arguments: Readonly<Record<string, unknown>>;
}

interface ParsedAgentRequest {
  readonly message: string;
  readonly purchaseContext: UnifiedRecommendationInput;
  readonly preferences: SessionPurchasePreferences;
}

function boundedPlainRecord(
  value: unknown,
  code: string,
): Readonly<Record<string, unknown>> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    nodeTypes.isProxy(value) ||
    !isPlainDataOutput(value)
  )
    throw requestError(400, code);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    throw requestError(400, code);
  return value as Readonly<Record<string, unknown>>;
}

function exactRecordKeys(
  record: Readonly<Record<string, unknown>>,
  allowed: ReadonlySet<string>,
  required: ReadonlySet<string>,
  code: string,
): void {
  const keys = Object.keys(record);
  if (
    keys.some((key) => !allowed.has(key)) ||
    [...required].some((key) => !Object.hasOwn(record, key))
  )
    throw requestError(400, code);
}

function parsePreferenceUpdate(
  value: unknown,
): SessionPurchasePreferenceUpdate {
  if (value === undefined) return Object.freeze({});
  const record = boundedPlainRecord(value, "preferences_invalid");
  const keys = new Set([
    "preferred_reward_class",
    "preferred_assets",
    "excluded_family_ids",
    "max_extra_steps",
    "minimum_incremental_value_jpy",
  ]);
  exactRecordKeys(record, keys, new Set(), "preferences_invalid");
  const rewardClass = record.preferred_reward_class;
  if (
    rewardClass !== undefined &&
    rewardClass !== null &&
    ![
      "cash_equivalent",
      "airline_miles",
      "hotel_points",
      "merchant_points",
    ].includes(String(rewardClass))
  )
    throw requestError(400, "preferences_invalid");
  for (const key of ["preferred_assets", "excluded_family_ids"] as const) {
    const item = record[key];
    if (
      item !== undefined &&
      (!Array.isArray(item) ||
        !item.every((entry) => typeof entry === "string"))
    )
      throw requestError(400, "preferences_invalid");
  }
  for (const key of [
    "max_extra_steps",
    "minimum_incremental_value_jpy",
  ] as const) {
    const item = record[key];
    if (item !== undefined && item !== null && typeof item !== "number")
      throw requestError(400, "preferences_invalid");
  }
  try {
    return Object.freeze({
      ...(rewardClass === undefined
        ? {}
        : {
            preferred_reward_class: rewardClass as
              | SessionPurchasePreferences["preferred_reward_class"]
              | undefined,
          }),
      ...(record.preferred_assets === undefined
        ? {}
        : { preferred_assets: record.preferred_assets as readonly string[] }),
      ...(record.excluded_family_ids === undefined
        ? {}
        : {
            excluded_family_ids:
              record.excluded_family_ids as readonly string[],
          }),
      ...(record.max_extra_steps === undefined
        ? {}
        : { max_extra_steps: record.max_extra_steps as number | null }),
      ...(record.minimum_incremental_value_jpy === undefined
        ? {}
        : {
            minimum_incremental_value_jpy:
              record.minimum_incremental_value_jpy as number | null,
          }),
    });
  } catch {
    throw requestError(400, "preferences_invalid");
  }
}

function parsePreferences(value: unknown): SessionPurchasePreferences {
  try {
    return normalizeSessionPurchasePreferences(parsePreferenceUpdate(value));
  } catch (error) {
    if (error && typeof error === "object" && "status" in error) throw error;
    throw requestError(400, "preferences_invalid");
  }
}

function parseCapabilityInvocation(value: unknown): ParsedCapabilityInvocation {
  const record = boundedPlainRecord(value, "capability_request_invalid");
  exactRecordKeys(
    record,
    new Set(["tool", "purchase_context", "preferences", "arguments"]),
    new Set(["tool", "arguments"]),
    "capability_request_invalid",
  );
  if (
    typeof record.tool !== "string" ||
    !(CAPABILITY_TOOL_NAMES as readonly string[]).includes(record.tool)
  )
    throw requestError(400, "capability_tool_invalid");
  return Object.freeze({
    tool: record.tool as CapabilityToolName,
    purchaseContext:
      record.purchase_context === undefined || record.purchase_context === null
        ? null
        : parseUnifiedRecommendation(record.purchase_context),
    preferences: parsePreferences(record.preferences),
    arguments: boundedPlainRecord(
      record.arguments,
      "capability_arguments_invalid",
    ),
  });
}

function parseAgentRequest(value: unknown): ParsedAgentRequest {
  const record = boundedPlainRecord(value, "agent_request_invalid");
  exactRecordKeys(
    record,
    new Set(["message", "purchase_context", "preferences"]),
    new Set(["message", "purchase_context"]),
    "agent_request_invalid",
  );
  if (
    typeof record.message !== "string" ||
    record.message.trim().length < 1 ||
    record.message.length > 2_000
  )
    throw requestError(400, "agent_message_invalid");
  return Object.freeze({
    message: record.message.trim(),
    purchaseContext: parseUnifiedRecommendation(record.purchase_context),
    preferences: parsePreferences(record.preferences),
  });
}

function createRequestRewardCapabilities(
  input: UnifiedRecommendationInput | null,
  dependency: AppCatalogueDependency | undefined,
  preferences: SessionPurchasePreferences = DEFAULT_SESSION_PURCHASE_PREFERENCES,
): RewardCapabilities {
  return new RewardCapabilities({
    purchaseContext: input as unknown as PurchaseContext | null,
    preferences,
    calculator: {
      async comparePurchaseRoutes(context, activePreferences) {
        return (await unifiedRecommendations(
          context as unknown as UnifiedRecommendationInput,
          dependency,
          activePreferences,
        )) as unknown as RouteComparison;
      },
    },
  });
}

function rewardsAgentRunnerOf(
  dependency: AppCatalogueDependency | undefined,
): RewardsAgentRunnerPort {
  if (
    dependency &&
    typeof dependency === "object" &&
    "rewardsAgentRunner" in dependency &&
    dependency.rewardsAgentRunner
  )
    return dependency.rewardsAgentRunner;
  if (
    dependency &&
    typeof dependency === "object" &&
    "run" in dependency &&
    typeof dependency.run === "function"
  )
    return dependency as RewardsAgentRunnerPort;
  return {
    async run(capabilities, message) {
      return runRewardsAgent(capabilities, message, {
        model: process.env.JRO_OPENAI_MODEL,
        tracing: "disabled",
      });
    },
  };
}

async function invokeCapability(
  invocation: ParsedCapabilityInvocation,
  dependency: AppCatalogueDependency | undefined,
): Promise<{
  readonly result: unknown;
  readonly state: RewardCapabilitySnapshot;
}> {
  const capabilities = createRequestRewardCapabilities(
    invocation.purchaseContext,
    dependency,
    invocation.preferences,
  );
  const args = invocation.arguments;
  let result: unknown;
  if (invocation.tool === "get_rewards_passport_summary") {
    exactRecordKeys(args, new Set(), new Set(), "capability_arguments_invalid");
    result = capabilities.getRewardsPassportSummary();
  } else if (invocation.tool === "get_expiring_rewards") {
    exactRecordKeys(
      args,
      new Set(["within_days"]),
      new Set(["within_days"]),
      "capability_arguments_invalid",
    );
    result = capabilities.getExpiringRewards(args.within_days as number);
  } else if (invocation.tool === "get_current_purchase_context") {
    exactRecordKeys(args, new Set(), new Set(), "capability_arguments_invalid");
    result = capabilities.getCurrentPurchaseContext();
  } else if (invocation.tool === "set_session_purchase_preferences") {
    result = capabilities.setSessionPurchasePreferences(
      parsePreferenceUpdate(args),
    );
  } else if (invocation.tool === "compare_purchase_routes") {
    exactRecordKeys(args, new Set(), new Set(), "capability_arguments_invalid");
    result = await capabilities.comparePurchaseRoutes();
  } else {
    exactRecordKeys(
      args,
      new Set(["route_id"]),
      new Set(),
      "capability_arguments_invalid",
    );
    if (args.route_id !== undefined && typeof args.route_id !== "string")
      throw requestError(400, "capability_arguments_invalid");
    await capabilities.comparePurchaseRoutes();
    result = capabilities.explainPurchaseRoute(
      args.route_id as string | undefined,
    );
  }
  return Object.freeze({ result, state: capabilities.snapshot() });
}

function contentTypeIsJson(
  headers: Readonly<Record<string, string | undefined>> | undefined,
): boolean {
  const value = headers?.["content-type"];
  if (typeof value !== "string") return false;
  return /^application\/json(?:\s*;|$)/iu.test(value);
}

function validLocalHost(value: string): boolean {
  if (value.length > 255 || /[\s/\\]/u.test(value)) return false;
  const match = /^(127\.0\.0\.1|localhost)(?::(\d{1,5}))?$/iu.exec(value);
  if (!match) return false;
  const port = match[2];
  return port === undefined || (Number(port) > 0 && Number(port) <= 65_535);
}

function validateRequestAuthority(request: AppRequest): void {
  const host = request.headers?.host;
  if (host !== undefined && !validLocalHost(host))
    throw requestError(400, "host_invalid");
  const origin = request.headers?.origin;
  if (origin === undefined) return;
  if (!host || origin === "null") throw requestError(403, "origin_invalid");
  const normalizedHost = host.toLocaleLowerCase("en-US");
  try {
    const parsed = new URL(origin);
    if (
      parsed.protocol !== "http:" ||
      parsed.username !== "" ||
      parsed.password !== "" ||
      parsed.pathname !== "/" ||
      parsed.search !== "" ||
      parsed.hash !== "" ||
      !validLocalHost(parsed.host) ||
      parsed.host.toLocaleLowerCase("en-US") !== normalizedHost
    )
      throw new Error("origin_mismatch");
  } catch {
    throw requestError(403, "origin_invalid");
  }
}

async function readBodyBytes(
  request: IncomingMessage,
  maxBytes: number,
): Promise<Buffer> {
  const declared = request.headers["content-length"];
  if (typeof declared === "string") {
    const length = Number(declared);
    if (!Number.isSafeInteger(length) || length < 0 || length > maxBytes)
      throw requestError(413, "request_body_too_large");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > maxBytes) throw requestError(413, "request_body_too_large");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function parsePath(request: IncomingMessage): string {
  const raw = request.url ?? "/";
  try {
    const parsed = new URL(raw, "http://127.0.0.1");
    if (
      (parsed.search !== "" || parsed.hash !== "") &&
      (parsed.pathname.startsWith("/go/") ||
        parsed.pathname.startsWith("/api/") ||
        parsed.pathname === AGENT_FEED_INTERNAL_EVENT_PATH)
    )
      throw requestError(400, "query_not_allowed");
    return parsed.pathname;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "status" in error &&
      "code" in error
    )
      throw error as RequestError;
    throw requestError(400, "path_invalid");
  }
}

async function staticResponse(pathname: string): Promise<AppResponse> {
  const fileName = STATIC_FILES[pathname];
  if (!fileName) throw requestError(404, "not_found");
  const filePath = normalize(join(PUBLIC_ROOT, fileName));
  const root = normalize(PUBLIC_ROOT + sep);
  if (!filePath.startsWith(root)) throw requestError(404, "not_found");
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile() || stat.size > 256 * 1024)
      throw new Error("static_file_invalid");
  } catch {
    throw requestError(500, "static_asset_unavailable");
  }
  try {
    const body = await fs.readFile(filePath, "utf8");
    return {
      status: 200,
      headers: {
        ...securityHeaders(),
        "Content-Type":
          CONTENT_TYPES[extname(filePath)] ?? "application/octet-stream",
      },
      body,
    };
  } catch {
    throw requestError(500, "static_asset_unavailable");
  }
}

function bodyText(body: string | Uint8Array | undefined): string {
  if (body === undefined) return "";
  return typeof body === "string" ? body : Buffer.from(body).toString("utf8");
}

function parseJsonBody(request: AppRequest, maxBytes: number): unknown {
  if (!contentTypeIsJson(request.headers))
    throw requestError(415, "json_content_type_required");
  const body = bodyText(request.body);
  const declared = request.headers?.["content-length"];
  if (declared !== undefined) {
    const length = Number(declared);
    if (!Number.isSafeInteger(length) || length < 0 || length > maxBytes)
      throw requestError(413, "request_body_too_large");
  }
  if (Buffer.byteLength(body, "utf8") > maxBytes)
    throw requestError(413, "request_body_too_large");
  try {
    return JSON.parse(body);
  } catch {
    throw requestError(400, "json_invalid");
  }
}

function configResponse(): Readonly<Record<string, unknown>> {
  return {
    ...SYNTHETIC_ALPHA_CONFIG,
    not_current_advice: true,
    correction_categories: [
      "wrong_merchant",
      "wrong_branch",
      "wrong_plan",
      "missing_reward",
      "unexpected_reward",
      "wrong_reward_amount",
    ],
    correction_note_codes: [
      "merchant_not_recognized",
      "branch_not_recognized",
      "plan_not_available",
      "reward_not_posted",
      "reward_reversed",
      "amount_disagrees",
    ],
  };
}

function linkIdFromPath(pathname: string): string | null {
  const match = /^\/go\/([a-z0-9_-]{1,80})$/u.exec(pathname);
  return match?.[1] ?? null;
}

export async function handleRequest(
  request: AppRequest,
  dependency?: AppCatalogueDependency,
): Promise<AppResponse> {
  try {
    const method = request.method.toUpperCase();
    const pathname = request.pathname;
    validateRequestAuthority(request);
    if (
      (pathname.startsWith("/go/") || pathname.startsWith("/api/")) &&
      (pathname.includes("?") || pathname.includes("#"))
    )
      return errorResponse(requestError(400, "query_not_allowed"));
    if (pathname === AGENT_FEED_INTERNAL_EVENT_PATH) {
      if (method !== "POST") {
        return errorResponseWithHeaders(
          requestError(405, "method_not_allowed"),
          { Allow: "POST" },
        );
      }
      const ingress = resolveAgentFeedIngress(dependency);
      if (ingress === undefined)
        return errorResponse(requestError(404, "not_found"));
      if (request.body === undefined)
        return errorResponse(requestError(400, "request_body_required"));
      const result = await ingress.handle({
        raw_body: request.body,
        headers: request.headers ?? {},
      });
      const outcome = result.outcome;
      return jsonResponse(result.status_code, {
        acknowledged: result.acknowledged,
        ...(outcome === undefined
          ? {}
          : {
              outcome: {
                status: outcome.status,
                receipt_id: outcome.receipt_id,
                ...(outcome.duplicate_kind === undefined
                  ? {}
                  : { duplicate_kind: outcome.duplicate_kind }),
              },
            }),
        ...(result.error_code === undefined
          ? {}
          : { error_code: result.error_code }),
      });
    }
    if (method === "GET" && pathname === "/health") {
      return jsonResponse(200, {
        status: "ok",
        service: "consumer-alpha",
        bind_host: LOCALHOST_BIND_HOST,
        synthetic_recommendations_only: false,
        recommendation_routes: [
          "synthetic",
          "nanaco_purchase",
          "nanaco_credit_charge",
          "p0_point_spend",
        ],
        experimental_catalogue: true,
      });
    }
    if (method === "GET" && pathname === "/config") {
      return jsonResponse(200, configResponse());
    }
    if (
      method !== "POST" &&
      (pathname === "/api/synthetic/evaluate" ||
        pathname === "/api/recommendations" ||
        pathname === "/api/corrections/draft" ||
        pathname === "/api/recommendations/corrections" ||
        pathname === "/api/experimental/recommendation" ||
        pathname === "/api/experimental/nanaco-credit-charge" ||
        pathname === "/api/experimental/point-spend/recommendation" ||
        pathname === "/api/experimental/payment-stack/recommendation" ||
        pathname === "/api/capabilities/invoke" ||
        pathname === "/api/agent" ||
        pathname === "/api/experimental/corrections" ||
        pathname === "/api/experimental/fact-corrections")
    ) {
      return errorResponseWithHeaders(requestError(405, "method_not_allowed"), {
        Allow: "POST",
      });
    }
    if (
      method !== "GET" &&
      (pathname === "/api/experimental/facts" ||
        pathname === "/api/consumer/reference")
    ) {
      return errorResponseWithHeaders(requestError(405, "method_not_allowed"), {
        Allow: "GET",
      });
    }
    if (
      method !== "GET" &&
      (pathname === "/api/experimental/point-spend/options" ||
        pathname === "/api/experimental/lotteries")
    ) {
      return errorResponseWithHeaders(requestError(405, "method_not_allowed"), {
        Allow: "GET",
      });
    }
    if (method === "GET") {
      if (pathname === "/api/consumer/reference") {
        try {
          const snapshot = normalizeImplementationFactSnapshot(
            await resolveImplementationCatalogue(dependency).list(),
          );
          return jsonResponse(
            200,
            projectConsumerReference(snapshot) as unknown as Readonly<
              Record<string, unknown>
            >,
          );
        } catch (error) {
          reportDeploymentFailure("consumer_reference_list", error);
          if (
            error &&
            typeof error === "object" &&
            "status" in error &&
            "code" in error
          )
            throw error;
          throw requestError(503, "consumer_reference_unavailable");
        }
      }
      if (pathname === "/api/experimental/lotteries") {
        try {
          return jsonResponse(
            200,
            (await listP0LotteryBrowserLinks()) as unknown as Readonly<
              Record<string, unknown>
            >,
          );
        } catch {
          throw requestError(503, "p0_lottery_links_unavailable");
        }
      }
      if (pathname === "/api/experimental/point-spend/options") {
        try {
          return jsonResponse(
            200,
            (await listPointSpendBrowserOptions(
              requiredRouteGraphSourceOf(dependency),
            )) as unknown as Readonly<Record<string, unknown>>,
          );
        } catch {
          throw requestError(503, "point_spend_options_unavailable");
        }
      }
      if (pathname === "/api/experimental/facts") {
        try {
          const snapshot =
            await resolveImplementationCatalogue(dependency).list();
          return jsonResponse(
            200,
            normalizeImplementationFactSnapshot(
              snapshot,
            ) as unknown as Readonly<Record<string, unknown>>,
          );
        } catch (error) {
          reportDeploymentFailure("implementation_facts_list", error);
          if (
            error &&
            typeof error === "object" &&
            "status" in error &&
            "code" in error
          )
            throw error;
          throw requestError(503, "implementation_fact_catalogue_unavailable");
        }
      }
      if (pathname === "/api/experimental/rules") {
        try {
          const snapshot = await listExperimentalCatalogue(
            resolveExperimentalCatalogue(dependency),
          );
          // The catalogue snapshot is already a strict, browser-safe DTO;
          // preserve its exact top-level shape for the API contract.
          return jsonResponse(
            200,
            snapshot as unknown as Readonly<Record<string, unknown>>,
          );
        } catch (error) {
          reportDeploymentFailure("experimental_rules_list", error);
          if (
            error &&
            typeof error === "object" &&
            "status" in error &&
            "code" in error
          )
            throw error;
          throw requestError(503, "experimental_catalogue_unavailable");
        }
      }
      const linkId = linkIdFromPath(pathname);
      if (linkId) {
        const target = resolveOfficialLink(linkId);
        if (!target) {
          return errorResponse(requestError(404, "deep_link_not_found"));
        }
        return {
          status: 302,
          headers: { ...securityHeaders(), Location: target },
          body: "",
        };
      }
      if (STATIC_FILES[pathname]) {
        return await staticResponse(pathname);
      }
      return errorResponse(requestError(404, "not_found"));
    }
    if (pathname === "/api/synthetic/evaluate") {
      if (method !== "POST") {
        return errorResponseWithHeaders(
          requestError(405, "method_not_allowed"),
          { Allow: "POST" },
        );
      }
      const input = parseManualAlphaState(
        parseJsonBody(request, MAX_EVALUATE_BODY_BYTES),
      );
      const factInfluence = await factInfluenceForRecommendation(
        dependency,
        SYNTHETIC_REPLAY_KNOWLEDGE_TIME,
        {
          merchant_id: input.merchant_id,
          payment_method: "synthetic_card",
          family_ids: ["merchant.synthetic"],
        },
        [],
      );
      const result = mapRecommendationForBrowser(
        evaluateSynthetic(input),
        factInfluence,
      );
      if (
        result.synthetic_only &&
        result.primary !== null &&
        (result.outcome === "definite" || result.outcome === "conditional")
      )
        rememberRecommendationId(result.request_id);
      return jsonResponse(200, { recommendation: result });
    }
    if (pathname === "/api/capabilities/invoke") {
      const invocation = parseCapabilityInvocation(
        parseJsonBody(request, MAX_CAPABILITY_BODY_BYTES),
      );
      try {
        const result = await invokeCapability(invocation, dependency);
        return jsonResponse(
          200,
          result as unknown as Readonly<Record<string, unknown>>,
        );
      } catch (error) {
        if (error instanceof TypeError) throw requestError(400, error.message);
        throw error;
      }
    }
    if (pathname === "/api/agent") {
      const input = parseAgentRequest(
        parseJsonBody(request, MAX_AGENT_BODY_BYTES),
      );
      const capabilities = createRequestRewardCapabilities(
        input.purchaseContext,
        dependency,
        input.preferences,
      );
      try {
        const result = await rewardsAgentRunnerOf(dependency).run(
          capabilities,
          input.message,
        );
        if (
          !isPlainDataOutput(result) ||
          typeof result.answer !== "string" ||
          result.answer.length > 20_000
        )
          throw new Error("agent_result_invalid");
        return jsonResponse(200, {
          answer: result.answer,
          state: result.state,
        });
      } catch (error) {
        reportDeploymentFailure("rewards_agent", error);
        throw requestError(503, "rewards_agent_unavailable");
      }
    }
    if (pathname === "/api/experimental/point-spend/recommendation") {
      if (method !== "POST") {
        return errorResponseWithHeaders(
          requestError(405, "method_not_allowed"),
          { Allow: "POST" },
        );
      }
      try {
        const input = parsePointSpendBrowserInput(
          parseJsonBody(request, MAX_POINT_SPEND_BODY_BYTES),
        );
        return jsonResponse(
          200,
          (await recommendUnifiedParsedPointSpend(
            input,
            requiredRouteGraphSourceOf(dependency),
          )) as unknown as Readonly<Record<string, unknown>>,
        );
      } catch (error) {
        if (error instanceof TypeError)
          return errorResponse(requestError(400, error.message));
        throw requestError(503, "point_spend_recommendation_unavailable");
      }
    }
    if (pathname === "/api/experimental/payment-stack/recommendation") {
      if (method !== "POST") {
        return errorResponseWithHeaders(
          requestError(405, "method_not_allowed"),
          { Allow: "POST" },
        );
      }
      try {
        const input = parsePaymentStackBrowserInput(
          parseJsonBody(request, MAX_PAYMENT_STACK_BODY_BYTES),
        );
        return jsonResponse(
          200,
          (await recommendPaymentStack(
            input,
            requiredRouteGraphSourceOf(dependency),
          )) as unknown as Readonly<Record<string, unknown>>,
        );
      } catch (error) {
        if (error instanceof TypeError)
          return errorResponse(requestError(400, error.message));
        throw requestError(503, "payment_stack_recommendation_unavailable");
      }
    }
    if (pathname === "/api/recommendations") {
      if (method !== "POST") {
        return errorResponseWithHeaders(
          requestError(405, "method_not_allowed"),
          { Allow: "POST" },
        );
      }
      const input = parseUnifiedRecommendation(
        parseJsonBody(request, MAX_UNIFIED_RECOMMENDATION_BODY_BYTES),
      );
      const capabilities = createRequestRewardCapabilities(input, dependency);
      const recommendation = await capabilities.comparePurchaseRoutes();
      return jsonResponse(200, {
        version: "unified-recommendations.v2",
        merchant_id: input.merchant_id,
        branch_id: input.branch_id,
        amount_jpy: input.amount_jpy,
        effective_at: input.effective_at,
        selected_p0_products: input.selected_p0_products,
        routes: recommendation.routes,
        supplemental_routes: recommendation.supplemental_routes,
        comparison: recommendation.comparison,
        fact_influence_shared: recommendation.fact_influence_shared,
        questions: recommendation.questions,
        capability_state: capabilities.snapshot(),
      });
    }
    if (pathname === "/api/experimental/recommendation") {
      if (method !== "POST") {
        return errorResponseWithHeaders(
          requestError(405, "method_not_allowed"),
          { Allow: "POST" },
        );
      }
      const input = parseExperimentalRecommendation(
        parseJsonBody(request, MAX_EXPERIMENTAL_RECOMMENDATION_BODY_BYTES),
      );
      let result: ExperimentalRecommendationResult;
      try {
        result =
          await resolveExperimentalRecommendation(dependency).evaluate(input);
      } catch (error) {
        if (error instanceof ExperimentalRecommendationError) {
          const status =
            error.code === "selection_not_supported" ||
            error.code === "amount_invalid" ||
            error.code === "tax_exclusive_amount_invalid" ||
            error.code === "balance_invalid" ||
            error.code === "effective_at_invalid"
              ? 400
              : error.code === "rule_not_current"
                ? 409
                : 503;
          throw requestError(status, `experimental_${error.code}`);
        }
        throw requestError(503, "experimental_recommendation_unavailable");
      }
      const recommendation = safeExperimentalRecommendation(result, input);
      const factInfluence = await factInfluenceForRecommendation(
        dependency,
        input.effective_at,
        {
          merchant_id: "merchant.seveneleven",
          payment_method: "nanaco",
          family_ids: ["point.nanaco", "emoney.nanaco", "merchant.7eleven"],
        },
        [NANACO_PURCHASE_APPLIED_PARENT_CLAIM_ID],
      );
      return jsonResponse(200, {
        recommendation: { ...recommendation, fact_influence: factInfluence },
      });
    }
    if (pathname === "/api/experimental/nanaco-credit-charge") {
      if (method !== "POST") {
        return errorResponseWithHeaders(
          requestError(405, "method_not_allowed"),
          { Allow: "POST" },
        );
      }
      const input = parseNanacoCreditChargeRecommendation(
        parseJsonBody(request, MAX_EXPERIMENTAL_RECOMMENDATION_BODY_BYTES),
      );
      let result: NanacoCreditChargeRecommendationResult;
      try {
        result =
          await resolveNanacoCreditChargeRecommendation(dependency).evaluate(
            input,
          );
      } catch (error) {
        if (error instanceof NanacoCreditChargeRecommendationError) {
          const status =
            error.code === "selection_not_supported" ||
            error.code === "charge_below_minimum" ||
            error.code === "charge_not_increment" ||
            error.code === "charge_above_maximum" ||
            error.code === "balance_limit_exceeded" ||
            error.code === "balance_invalid" ||
            error.code === "ownership_required" ||
            error.code === "preregistration_required" ||
            error.code === "effective_at_invalid"
              ? 400
              : error.code === "rule_not_current"
                ? 409
                : 503;
          throw requestError(status, `nanaco_credit_charge_${error.code}`);
        }
        throw requestError(
          503,
          "nanaco_credit_charge_recommendation_unavailable",
        );
      }
      const recommendation = safeNanacoCreditChargeRecommendation(
        result,
        input,
      );
      const factInfluence = await factInfluenceForRecommendation(
        dependency,
        input.effective_at,
        {
          merchant_id: "merchant.seveneleven",
          payment_method: "seven_card_plus",
          family_ids: ["point.nanaco", "emoney.nanaco", "merchant.7eleven"],
        },
        [NANACO_CREDIT_CHARGE_APPLIED_PARENT_CLAIM_ID],
      );
      return jsonResponse(200, {
        recommendation: { ...recommendation, fact_influence: factInfluence },
      });
    }
    if (
      pathname === "/api/corrections/draft" ||
      pathname === "/api/recommendations/corrections"
    ) {
      if (method !== "POST") {
        return errorResponseWithHeaders(
          requestError(405, "method_not_allowed"),
          { Allow: "POST" },
        );
      }
      const input = parseCorrectionDraft(
        parseJsonBody(request, MAX_CORRECTION_BODY_BYTES),
      );
      if (!issuedRecommendationIds.has(input.recommendation_id))
        throw requestError(409, "recommendation_not_issued");
      return jsonResponse(200, {
        correction: mapCorrectionDraftForBrowser(
          input,
          input.recommendation_id,
        ),
      });
    }
    if (pathname === "/api/experimental/corrections") {
      if (method !== "POST") {
        return errorResponseWithHeaders(
          requestError(405, "method_not_allowed"),
          { Allow: "POST" },
        );
      }
      const input = parseExperimentalCorrection(
        parseJsonBody(request, MAX_CORRECTION_BODY_BYTES),
      );
      let result: unknown;
      try {
        result = await reportExperimentalCorrection(
          resolveExperimentalCatalogue(dependency),
          input,
        );
      } catch (error) {
        if (
          error &&
          typeof error === "object" &&
          "status" in error &&
          "code" in error
        )
          throw error;
        throw requestError(503, "experimental_catalogue_unavailable");
      }
      if (
        result === null ||
        typeof result !== "object" ||
        Array.isArray(result) ||
        (result as Record<string, unknown>).ok !== true
      ) {
        const error = experimentalCorrectionError(result);
        return errorResponse(error);
      }
      return jsonResponse(200, {
        correction: safeExperimentalCorrection(result, input),
      });
    }
    if (pathname === "/api/experimental/fact-corrections") {
      if (method !== "POST") {
        return errorResponseWithHeaders(
          requestError(405, "method_not_allowed"),
          { Allow: "POST" },
        );
      }
      const input = parseImplementationFactCorrection(
        parseJsonBody(request, MAX_CORRECTION_BODY_BYTES),
      );
      let result: unknown;
      try {
        result =
          await resolveImplementationCatalogue(dependency).reportCorrection(
            input,
          );
      } catch (error) {
        if (
          error &&
          typeof error === "object" &&
          "status" in error &&
          "code" in error
        )
          throw error;
        throw requestError(503, "implementation_fact_catalogue_unavailable");
      }
      if (
        result === null ||
        typeof result !== "object" ||
        Array.isArray(result) ||
        (result as Record<string, unknown>).ok !== true
      ) {
        return errorResponse(implementationFactCorrectionError(result));
      }
      return jsonResponse(200, {
        correction: safeImplementationFactCorrection(result, input),
      });
    }
    return errorResponse(requestError(404, "not_found"));
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "status" in error &&
      "code" in error &&
      typeof (error as { status?: unknown }).status === "number" &&
      typeof (error as { code?: unknown }).code === "string"
    ) {
      return errorResponse(error as RequestError);
    }
    if (error instanceof InputContractError) {
      return errorResponse(requestError(400, error.code));
    }
    // Never serialize evaluator errors or request contents to the browser.
    return errorResponse(requestError(422, "synthetic_evaluation_unavailable"));
  }
}

function errorResponseWithHeaders(
  error: RequestError,
  headers: Readonly<Record<string, string>>,
): AppResponse {
  return jsonResponse(
    error.status,
    {
      error: {
        code: error.code,
        message: "Request could not be processed.",
      },
    },
    headers,
  );
}

function sendAppResponse(response: ServerResponse, result: AppResponse): void {
  response.statusCode = result.status;
  for (const [name, value] of Object.entries(result.headers))
    response.setHeader(name, value);
  response.end(result.body);
}

async function sendFontAsset(
  response: ServerResponse,
  pathname: string,
): Promise<boolean> {
  const prefix = "/assets/fonts/";
  if (!pathname.startsWith(prefix)) return false;
  const filename = pathname.slice(prefix.length);
  if (!FONT_FILES.has(filename)) {
    sendAppResponse(response, errorResponse(requestError(404, "not_found")));
    return true;
  }
  const filePath = normalize(join(PUBLIC_ROOT, "assets/fonts", filename));
  const fontRoot = normalize(join(PUBLIC_ROOT, "assets/fonts") + sep);
  if (!filePath.startsWith(fontRoot)) {
    sendAppResponse(response, errorResponse(requestError(404, "not_found")));
    return true;
  }
  try {
    const body = await fs.readFile(filePath);
    if (body.byteLength > 256 * 1024) throw new Error("static_file_invalid");
    response.statusCode = 200;
    for (const [name, value] of Object.entries(securityHeaders()))
      response.setHeader(name, value);
    response.setHeader("Content-Type", "font/woff2");
    response.end(body);
  } catch {
    sendAppResponse(
      response,
      errorResponse(requestError(500, "static_asset_unavailable")),
    );
  }
  return true;
}

async function sendPaymentLogo(
  response: ServerResponse,
  pathname: string,
): Promise<boolean> {
  const prefix = "/assets/payment-logos/";
  if (!pathname.startsWith(prefix)) return false;
  const filename = pathname.slice(prefix.length);
  if (!PAYMENT_LOGO_FILES.has(filename)) {
    sendAppResponse(response, errorResponse(requestError(404, "not_found")));
    return true;
  }
  const filePath = normalize(
    join(PUBLIC_ROOT, "assets/payment-logos", filename),
  );
  const logoRoot = normalize(join(PUBLIC_ROOT, "assets/payment-logos") + sep);
  if (!filePath.startsWith(logoRoot)) {
    sendAppResponse(response, errorResponse(requestError(404, "not_found")));
    return true;
  }
  try {
    const body = await fs.readFile(filePath);
    if (body.byteLength > 256 * 1024) throw new Error("static_file_invalid");
    response.statusCode = 200;
    for (const [name, value] of Object.entries(securityHeaders()))
      response.setHeader(name, value);
    response.setHeader(
      "Content-Type",
      PAYMENT_LOGO_CONTENT_TYPES[extname(filePath)] ??
        "application/octet-stream",
    );
    response.end(body);
  } catch {
    sendAppResponse(
      response,
      errorResponse(requestError(500, "static_asset_unavailable")),
    );
  }
  return true;
}

async function route(
  request: IncomingMessage,
  response: ServerResponse,
  dependency: AppCatalogueDependency | undefined,
): Promise<void> {
  let pathname: string;
  try {
    pathname = parsePath(request);
  } catch (error) {
    sendAppResponse(response, errorResponse(error as RequestError));
    return;
  }
  try {
    const method = request.method ?? "";
    if (method === "GET" && (await sendPaymentLogo(response, pathname))) return;
    if (method === "GET" && (await sendFontAsset(response, pathname))) return;
    const headers: Record<string, string | undefined> = {};
    const contentType = request.headers["content-type"];
    const contentLength = request.headers["content-length"];
    const host = request.headers.host;
    const origin = request.headers.origin;
    if (contentType !== undefined) headers["content-type"] = contentType;
    if (contentLength !== undefined) headers["content-length"] = contentLength;
    if (host !== undefined) headers.host = host;
    if (origin !== undefined) headers.origin = origin;
    if (pathname === AGENT_FEED_INTERNAL_EVENT_PATH) {
      for (const name of [
        "x-agent-feed-event-id",
        "x-agent-feed-delivery-id",
        "x-agent-feed-attempt",
        "x-agent-feed-protocol-version",
        "x-agent-feed-timestamp",
        "x-agent-feed-key-id",
        "x-agent-feed-signature",
      ] as const) {
        const value = request.headers?.[name];
        // Duplicate header values are rejected by the signed consumer. Do not
        // select one value from an ambiguous transport representation.
        if (typeof value === "string") headers[name] = value;
      }
    }
    // Reject a hostile authority before consuming a request body.  This is
    // especially important for a loopback service that accepts no cross-site
    // calls and has no reason to read an unauthorised payload.
    try {
      validateRequestAuthority({ method, pathname, headers });
    } catch (error) {
      sendAppResponse(response, errorResponse(error as RequestError));
      return;
    }
    const bodyLimit = requestBodyLimit(method, pathname);
    const body =
      bodyLimit === null ? undefined : await readBodyBytes(request, bodyLimit);
    sendAppResponse(
      response,
      await handleRequest({ method, pathname, headers, body }, dependency),
    );
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "status" in error &&
      "code" in error &&
      typeof (error as { status?: unknown }).status === "number" &&
      typeof (error as { code?: unknown }).code === "string"
    ) {
      sendAppResponse(response, errorResponse(error as RequestError));
      return;
    }
    sendAppResponse(
      response,
      errorResponse(requestError(422, "synthetic_evaluation_unavailable")),
    );
  }
}

/** Exact network-body allowlist shared by the live server and regression tests. */
export function requestBodyLimit(
  method: string,
  pathname: string,
): number | null {
  if (method !== "POST") return null;
  if (pathname === AGENT_FEED_INTERNAL_EVENT_PATH)
    return AGENT_FEED_INTERNAL_MAX_BODY_BYTES;
  if (pathname === "/api/synthetic/evaluate") return MAX_EVALUATE_BODY_BYTES;
  if (pathname === "/api/recommendations")
    return MAX_UNIFIED_RECOMMENDATION_BODY_BYTES;
  if (pathname === "/api/capabilities/invoke") return MAX_CAPABILITY_BODY_BYTES;
  if (pathname === "/api/agent") return MAX_AGENT_BODY_BYTES;
  if (
    pathname === "/api/experimental/recommendation" ||
    pathname === "/api/experimental/nanaco-credit-charge"
  )
    return MAX_EXPERIMENTAL_RECOMMENDATION_BODY_BYTES;
  if (pathname === "/api/experimental/point-spend/recommendation")
    return MAX_POINT_SPEND_BODY_BYTES;
  if (pathname === "/api/experimental/payment-stack/recommendation")
    return MAX_PAYMENT_STACK_BODY_BYTES;
  if (
    pathname === "/api/corrections/draft" ||
    pathname === "/api/recommendations/corrections" ||
    pathname === "/api/experimental/corrections" ||
    pathname === "/api/experimental/fact-corrections"
  )
    return MAX_CORRECTION_BODY_BYTES;
  return null;
}

export function createAppServer(dependency?: AppCatalogueDependency): Server {
  return createServer((request, response) => {
    void route(request, response, dependency);
  });
}

export async function startServer(
  port = 0,
  dependency?: AppCatalogueDependency,
): Promise<Server> {
  const server = createAppServer(dependency);
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, LOCALHOST_BIND_HOST);
  });
  return server;
}

if (
  process.argv[1] &&
  relative(process.cwd(), process.argv[1]) === "dist/server.js"
) {
  const databaseUrl = process.env.JRO_DATABASE_URL;
  const demoRewards = process.env.JRO_DEMO_REWARDS === "1";
  if (databaseUrl === undefined) {
    const demoDependencies = demoRewards
      ? createLocalDemoDependencies()
      : undefined;
    void startServer(Number(process.env.PORT ?? 3000), demoDependencies);
  } else {
    const runtime = createPostgresAppRuntime(databaseUrl);
    void startServer(Number(process.env.PORT ?? 3000), runtime.dependencies)
      .then((server) => {
        let closing = false;
        const close = () => {
          if (closing) return;
          closing = true;
          server.close(() => {
            void runtime.close().finally(() => {
              process.exitCode = 0;
            });
          });
        };
        process.once("SIGINT", close);
        process.once("SIGTERM", close);
      })
      .catch(async (error: unknown) => {
        await runtime.close();
        console.error(
          error instanceof Error
            ? error.message
            : "consumer_alpha_start_failed",
        );
        process.exitCode = 1;
      });
  }
}
