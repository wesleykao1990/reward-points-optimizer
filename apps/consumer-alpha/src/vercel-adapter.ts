import {
  createPostgresAppRuntime,
  type PostgresAppRuntime,
} from "./runtime.js";
import type { AppCatalogueDependency, AppResponse } from "./server.js";
import { handleRequest } from "./server.js";

type HeaderValue = string | readonly string[] | undefined;
type DeploymentEnvironment = Readonly<Record<string, string | undefined>>;

export interface VercelLikeRequest {
  readonly method?: string;
  readonly url?: string;
  readonly headers: Readonly<Record<string, HeaderValue>>;
  readonly body?: unknown;
}

export interface VercelLikeResponse {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body?: string): void;
}

export interface VercelAdapterOptions {
  readonly environment?: DeploymentEnvironment;
  readonly dependency?: AppCatalogueDependency;
  readonly requireDatabase?: boolean;
  readonly runtimeFactory?: typeof createPostgresAppRuntime;
}

class DeploymentConfigurationError extends Error {}

const DEPLOYMENT_SECURITY_HEADERS = Object.freeze({
  "Content-Security-Policy":
    "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Cache-Control": "no-store",
});

function deploymentError(status: number, code: string): AppResponse {
  return {
    status,
    headers: {
      ...DEPLOYMENT_SECURITY_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      error: { code, message: "Request could not be processed." },
    }),
  };
}

function send(response: VercelLikeResponse, result: AppResponse): void {
  response.statusCode = result.status;
  for (const [name, value] of Object.entries(result.headers))
    response.setHeader(name, value);
  response.end(result.body);
}

function singleHeader(value: HeaderValue): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error("header_ambiguous");
  return value;
}

function validDeploymentHost(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 253 &&
    /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/u.test(value) &&
    !value.includes("..")
  );
}

function configuredOriginHost(value: string): string {
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:" ||
      parsed.username !== "" ||
      parsed.password !== "" ||
      parsed.port !== "" ||
      parsed.pathname !== "/" ||
      parsed.search !== "" ||
      parsed.hash !== "" ||
      !validDeploymentHost(parsed.hostname)
    )
      throw new Error("origin_invalid");
    return parsed.hostname.toLocaleLowerCase("en-US");
  } catch {
    throw new DeploymentConfigurationError("jro_public_origin_invalid");
  }
}

export function deploymentHosts(
  environment: DeploymentEnvironment,
): ReadonlySet<string> {
  const hosts = new Set<string>();
  const publicOrigin = environment.JRO_PUBLIC_ORIGIN;
  if (publicOrigin !== undefined) hosts.add(configuredOriginHost(publicOrigin));
  for (const name of [
    "VERCEL_URL",
    "VERCEL_BRANCH_URL",
    "VERCEL_PROJECT_PRODUCTION_URL",
  ] as const) {
    const value = environment[name];
    if (value === undefined) continue;
    const normalized = value.toLocaleLowerCase("en-US");
    if (!validDeploymentHost(normalized))
      throw new DeploymentConfigurationError(
        `jro_deployment_host_invalid:${name}`,
      );
    hosts.add(normalized);
  }
  if (hosts.size === 0)
    throw new DeploymentConfigurationError("jro_public_origin_required");
  return hosts;
}

function validateAuthority(
  request: VercelLikeRequest,
  allowedHosts: ReadonlySet<string>,
): string {
  let host: string;
  let protocol: string;
  try {
    host = (
      singleHeader(request.headers["x-forwarded-host"]) ??
      singleHeader(request.headers.host) ??
      ""
    ).toLocaleLowerCase("en-US");
    protocol = (
      singleHeader(request.headers["x-forwarded-proto"]) ?? ""
    ).toLocaleLowerCase("en-US");
  } catch {
    throw deploymentError(400, "host_invalid");
  }
  if (!validDeploymentHost(host) || !allowedHosts.has(host))
    throw deploymentError(400, "host_invalid");
  if (protocol !== "https") throw deploymentError(400, "protocol_invalid");

  let origin: string | undefined;
  try {
    origin = singleHeader(request.headers.origin);
  } catch {
    throw deploymentError(403, "origin_invalid");
  }
  if (origin === undefined) return host;
  try {
    const parsed = new URL(origin);
    if (
      parsed.origin !== `https://${host}` ||
      parsed.pathname !== "/" ||
      parsed.search !== "" ||
      parsed.hash !== ""
    )
      throw new Error("origin_mismatch");
  } catch {
    throw deploymentError(403, "origin_invalid");
  }
  return host;
}

function serializedBody(request: VercelLikeRequest): Uint8Array | undefined {
  const value = request.body;
  if (value === undefined) return undefined;
  if (value === null && request.headers["content-type"] === undefined)
    return undefined;
  if (typeof value === "string") return Buffer.from(value, "utf8");
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return value;
  return Buffer.from(JSON.stringify(value), "utf8");
}

function requestHeaders(
  request: VercelLikeRequest,
  body: Uint8Array | undefined,
): Readonly<Record<string, string | undefined>> {
  let contentType: string | undefined;
  try {
    contentType = singleHeader(request.headers["content-type"]);
  } catch {
    throw deploymentError(415, "json_content_type_required");
  }
  return {
    ...(contentType === undefined ? {} : { "content-type": contentType }),
    ...(body === undefined
      ? {}
      : { "content-length": String(body.byteLength) }),
  };
}

function isAppResponse(value: unknown): value is AppResponse {
  return (
    value !== null &&
    typeof value === "object" &&
    "status" in value &&
    "headers" in value &&
    "body" in value
  );
}

function deploymentPathname(parsed: URL): string {
  if (parsed.hash !== "") throw deploymentError(400, "query_not_allowed");
  if (parsed.pathname !== "/api/handler") {
    if (parsed.search !== "") throw deploymentError(400, "query_not_allowed");
    return parsed.pathname;
  }

  const entries = [...parsed.searchParams.entries()];
  if (entries.length !== 1 || entries[0]?.[0] !== "path")
    throw deploymentError(400, "query_not_allowed");
  const path = entries[0][1];
  if (
    path.length === 0 ||
    path.length > 256 ||
    !/^[a-z0-9](?:[a-z0-9._/-]*[a-z0-9])?$/u.test(path) ||
    path.includes("..") ||
    path.includes("//")
  )
    throw deploymentError(400, "query_not_allowed");
  return `/api/${path}`;
}

/**
 * Adapt the bounded application request contract to a Vercel Node function.
 * Vercel terminates TLS; this boundary rechecks the forwarded authority and
 * never forwards host/origin values into the legacy loopback validator.
 */
export function createVercelRequestHandler(
  options: VercelAdapterOptions = {},
): (request: VercelLikeRequest, response: VercelLikeResponse) => Promise<void> {
  const environment = options.environment ?? process.env;
  const runtimeFactory = options.runtimeFactory ?? createPostgresAppRuntime;
  let runtime: PostgresAppRuntime | undefined;
  let allowedHosts: ReadonlySet<string> | undefined;

  const dependency = (): AppCatalogueDependency | undefined => {
    if (options.dependency !== undefined) return options.dependency;
    if (runtime !== undefined) return runtime.dependencies;
    const connectionString =
      environment.JRO_DATABASE_URL ?? environment.POSTGRES_URL;
    if (connectionString === undefined) {
      if (options.requireDatabase === true)
        throw new DeploymentConfigurationError("jro_database_url_required");
      return undefined;
    }
    runtime = runtimeFactory(connectionString, {
      databaseRole: "jro_runtime",
      poolMax: 1,
    });
    return runtime.dependencies;
  };

  return async (request, response) => {
    try {
      allowedHosts ??= deploymentHosts(environment);
      const host = validateAuthority(request, allowedHosts);
      const parsed = new URL(request.url ?? "/", `https://${host}`);
      const pathname = deploymentPathname(parsed);
      if (!pathname.startsWith("/api/")) {
        send(response, deploymentError(404, "not_found"));
        return;
      }
      let body: Uint8Array | undefined;
      try {
        body = serializedBody(request);
      } catch {
        send(response, deploymentError(400, "json_invalid"));
        return;
      }
      const headers = requestHeaders(request, body);
      const result = await handleRequest(
        {
          method: request.method ?? "",
          pathname,
          headers,
          body,
        },
        dependency(),
      );
      send(response, result);
    } catch (error) {
      if (isAppResponse(error)) {
        send(response, error);
        return;
      }
      const code =
        error instanceof DeploymentConfigurationError
          ? "deployment_not_configured"
          : "deployment_adapter_unavailable";
      send(response, deploymentError(503, code));
    }
  };
}
