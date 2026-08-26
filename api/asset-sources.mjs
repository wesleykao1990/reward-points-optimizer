import { createAssetSourceCatalogueReader } from "../apps/consumer-alpha/dist/asset-source-catalogue.js";
import { SUPABASE_PROD_CA_2021 } from "../apps/consumer-alpha/dist/supabase-ca.js";

let reader;

function databaseUrl() {
  return (
    process.env.JRO_DATABASE_URL ??
    process.env.POSTGRES_URL ??
    process.env.POSTGRES_URL_NON_POOLING
  );
}

function catalogueReader() {
  if (reader !== undefined) return reader;
  const connectionString = databaseUrl();
  if (connectionString === undefined || connectionString.length === 0)
    throw new Error("jro_database_url_required");
  reader = createAssetSourceCatalogueReader(
    connectionString,
    SUPABASE_PROD_CA_2021,
  );
  return reader;
}

function sendJson(response, status, value) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.end(JSON.stringify(value));
}

export default async function handler(request, response) {
  if ((request.method ?? "").toUpperCase() !== "GET") {
    response.setHeader("Allow", "GET");
    sendJson(response, 405, {
      error: { code: "method_not_allowed", message: "Request could not be processed." },
    });
    return;
  }
  try {
    const assets = await catalogueReader().query();
    sendJson(response, 200, {
      version: "asset-source-catalogue.v1",
      deployment_commit_sha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      assets,
    });
  } catch {
    sendJson(response, 503, {
      error: { code: "asset_sources_unavailable", message: "Request could not be processed." },
    });
  }
}
