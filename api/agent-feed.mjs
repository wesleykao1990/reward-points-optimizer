import { createPostgresAppRuntime } from "../apps/consumer-alpha/dist/runtime.js";
import { handleRequest } from "../apps/consumer-alpha/dist/server.js";
import { AGENT_FEED_INTERNAL_EVENT_PATH } from "../apps/consumer-alpha/dist/agent-feed-ingress.js";
import { SUPABASE_PROD_CA_2021 } from "../apps/consumer-alpha/dist/supabase-ca.js";

const DELIVERY_HEADERS = Object.freeze([
  "x-agent-feed-event-id",
  "x-agent-feed-delivery-id",
  "x-agent-feed-protocol-version",
  "x-agent-feed-attempt",
  "x-agent-feed-timestamp",
  "x-agent-feed-key-id",
  "x-agent-feed-signature",
]);

let runtime;

function jsonError(status, code) {
  return new Response(
    JSON.stringify({ error: { code, message: "Request could not be processed." } }),
    {
      status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
      },
    },
  );
}

function databaseUrl() {
  return (
    process.env.JRO_DATABASE_URL ??
    process.env.POSTGRES_URL ??
    process.env.POSTGRES_URL_NON_POOLING
  );
}

function dependencies() {
  if (runtime !== undefined) return runtime.dependencies;
  const connectionString = databaseUrl();
  if (connectionString === undefined || connectionString.length === 0)
    throw new Error("jro_database_url_required");
  runtime = createPostgresAppRuntime(connectionString, {
    databaseRole: "jro_runtime",
    poolMax: 1,
    sslRootCertificate: SUPABASE_PROD_CA_2021,
  });
  return runtime.dependencies;
}

function deliveryHeaders(request, bodyLength) {
  const headers = {
    "content-length": String(bodyLength),
  };
  const contentType = request.headers.get("content-type");
  if (contentType !== null) headers["content-type"] = contentType;
  for (const name of DELIVERY_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) headers[name] = value;
  }
  return headers;
}

async function dispatch(request) {
  if (request.method !== "POST") {
    return new Response(
      JSON.stringify({ error: { code: "method_not_allowed", message: "Request could not be processed." } }),
      {
        status: 405,
        headers: {
          allow: "POST",
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        },
      },
    );
  }

  let rawBody;
  try {
    rawBody = new Uint8Array(await request.arrayBuffer());
  } catch {
    return jsonError(400, "request_body_invalid");
  }

  try {
    const result = await handleRequest(
      {
        method: "POST",
        pathname: AGENT_FEED_INTERNAL_EVENT_PATH,
        headers: deliveryHeaders(request, rawBody.byteLength),
        body: rawBody,
      },
      dependencies(),
    );
    return new Response(result.body, {
      status: result.status,
      headers: result.headers,
    });
  } catch {
    return jsonError(503, "agent_feed_ingress_unavailable");
  }
}

export default {
  fetch: dispatch,
};
