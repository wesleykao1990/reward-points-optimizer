import { promises as fs } from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { extname, join, normalize, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ExperimentalCataloguePort,
  ExperimentalCorrectionInput,
  ImplementationFactCataloguePort,
  ImplementationFactCorrectionInput,
} from "./contracts.js";
import {
  InputContractError,
  isCanonicalRecommendationId,
  MAX_CORRECTION_BODY_BYTES,
  MAX_EVALUATE_BODY_BYTES,
  parseCorrectionDraft,
  parseExperimentalCorrection,
  parseImplementationFactCorrection,
  parseManualAlphaState,
} from "./contracts.js";
import {
  adaptImplementationFactBackend,
  getDefaultImplementationFactCataloguePort,
  type ImplementationFactBackend,
  normalizeImplementationFactSnapshot,
} from "./implementation-catalog.js";
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
import { evaluateSynthetic, SYNTHETIC_ALPHA_CONFIG } from "./synthetic.js";

export {
  MAX_CORRECTION_BODY_BYTES,
  MAX_EVALUATE_BODY_BYTES,
} from "./contracts.js";

export const LOCALHOST_BIND_HOST = "127.0.0.1" as const;
export const CSP_HEADER =
  "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const PUBLIC_ROOT = fileURLToPath(new URL("../public/", import.meta.url));
const STATIC_FILES: Readonly<Record<string, string>> = Object.freeze({
  "/": "index.html",
  "/index.html": "index.html",
  "/app.js": "app.js",
  "/styles.css": "styles.css",
});
const CONTENT_TYPES: Readonly<Record<string, string>> = Object.freeze({
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
});

const MAX_ISSUED_RECOMMENDATIONS = 128;
const issuedRecommendationIds = new Set<string>();

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
  readonly implementationFacts?: ImplementationFactBackend;
  /** Descriptive alias accepted for the implementation-fact port. */
  readonly implementationCatalogue?: ImplementationFactBackend;
  /** Explicit alias for callers that prefer the full feature name. */
  readonly implementationFactCatalogue?: ImplementationFactBackend;
}

export type AppCatalogueDependency =
  | ExperimentalCataloguePort
  | ImplementationFactBackend
  | AppDependencies;

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
        parsed.pathname.startsWith("/api/"))
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
    if (method === "GET" && pathname === "/health") {
      return jsonResponse(200, {
        status: "ok",
        service: "consumer-alpha",
        bind_host: LOCALHOST_BIND_HOST,
        synthetic_recommendations_only: true,
        experimental_catalogue: true,
      });
    }
    if (method === "GET" && pathname === "/config") {
      return jsonResponse(200, configResponse());
    }
    if (
      method !== "POST" &&
      (pathname === "/api/synthetic/evaluate" ||
        pathname === "/api/corrections/draft" ||
        pathname === "/api/experimental/corrections" ||
        pathname === "/api/experimental/fact-corrections")
    ) {
      return errorResponseWithHeaders(requestError(405, "method_not_allowed"), {
        Allow: "POST",
      });
    }
    if (method !== "GET" && pathname === "/api/experimental/facts") {
      return errorResponseWithHeaders(requestError(405, "method_not_allowed"), {
        Allow: "GET",
      });
    }
    if (method === "GET") {
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
      const result = mapRecommendationForBrowser(evaluateSynthetic(input));
      if (
        result.synthetic_only &&
        result.primary !== null &&
        (result.outcome === "definite" || result.outcome === "conditional")
      )
        rememberRecommendationId(result.request_id);
      return jsonResponse(200, { recommendation: result });
    }
    if (pathname === "/api/corrections/draft") {
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
    const headers: Record<string, string | undefined> = {};
    const contentType = request.headers["content-type"];
    const contentLength = request.headers["content-length"];
    const host = request.headers.host;
    const origin = request.headers.origin;
    if (contentType !== undefined) headers["content-type"] = contentType;
    if (contentLength !== undefined) headers["content-length"] = contentLength;
    if (host !== undefined) headers.host = host;
    if (origin !== undefined) headers.origin = origin;
    // Reject a hostile authority before consuming a request body.  This is
    // especially important for a loopback service that accepts no cross-site
    // calls and has no reason to read an unauthorised payload.
    try {
      validateRequestAuthority({ method, pathname, headers });
    } catch (error) {
      sendAppResponse(response, errorResponse(error as RequestError));
      return;
    }
    const body =
      method === "POST" &&
      (pathname === "/api/synthetic/evaluate" ||
        pathname === "/api/corrections/draft" ||
        pathname === "/api/experimental/corrections" ||
        pathname === "/api/experimental/fact-corrections")
        ? await readBodyBytes(
            request,
            pathname === "/api/synthetic/evaluate"
              ? MAX_EVALUATE_BODY_BYTES
              : MAX_CORRECTION_BODY_BYTES,
          )
        : undefined;
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
  void startServer(Number(process.env.PORT ?? 3000));
}
