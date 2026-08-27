import { createConsumerCatalogueUiReader } from "../apps/consumer-alpha/dist/asset-source-catalogue.js";
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
  if (!connectionString) throw new Error("jro_database_url_required");
  reader = createConsumerCatalogueUiReader(
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
    sendJson(response, 405, { error: { code: "method_not_allowed" } });
    return;
  }
  try {
    const items = await catalogueReader().query();
    sendJson(response, 200, {
      version: "consumer-catalogue-ui.v1",
      deployment_commit_sha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      items,
    });
  } catch (error) {
    console.error("consumer_catalogue_ui_error", String(error?.message ?? error));
    sendJson(response, 503, { error: { code: "catalogue_ui_unavailable" } });
  }
}
