import { Pool } from "pg";
import {
  createPostgresPoolConfig,
  createRoleScopedQueryPool,
} from "../apps/consumer-alpha/dist/runtime.js";
import { SUPABASE_PROD_CA_2021 } from "../apps/consumer-alpha/dist/supabase-ca.js";

let pool;
let queryPool;

function databaseUrl() {
  return (
    process.env.JRO_DATABASE_URL ??
    process.env.POSTGRES_URL ??
    process.env.POSTGRES_URL_NON_POOLING
  );
}

function cataloguePool() {
  if (queryPool) return queryPool;
  const connectionString = databaseUrl();
  if (!connectionString) throw new Error("jro_database_url_required");
  pool = new Pool(
    createPostgresPoolConfig(connectionString, {
      databaseRole: "jro_runtime",
      poolMax: 1,
      sslRootCertificate: SUPABASE_PROD_CA_2021,
    }),
  );
  queryPool = createRoleScopedQueryPool(pool, "jro_runtime");
  return queryPool;
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
    const result = await cataloguePool().query(
      `select item_id, display_name, item_kind, provider_name,
              official_product_url, source_image_url, validation_status,
              updated_at
         from app_api.consumer_catalogue_ui
        order by item_kind, provider_name nulls last, display_name, item_id`,
    );
    sendJson(response, 200, {
      version: "consumer-catalogue-ui.v1",
      deployment_commit_sha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      items: result.rows,
    });
  } catch (error) {
    console.error("consumer_catalogue_ui_error", String(error?.message ?? error));
    sendJson(response, 503, { error: { code: "catalogue_ui_unavailable" } });
  }
}
