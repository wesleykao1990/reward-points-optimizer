import { createAssetSourceCatalogueReader } from "../apps/consumer-alpha/dist/asset-source-catalogue.js";
import { SUPABASE_PROD_CA_2021 } from "../apps/consumer-alpha/dist/supabase-ca.js";
import { createVercelRequestHandler } from "../apps/consumer-alpha/dist/vercel-adapter.js";

const appHandler = createVercelRequestHandler({
  environment: process.env,
  requireDatabase: true,
});

let assetReader;

function databaseUrl() {
  return (
    process.env.JRO_DATABASE_URL ??
    process.env.POSTGRES_URL ??
    process.env.POSTGRES_URL_NON_POOLING
  );
}

function sourceReader() {
  if (assetReader !== undefined) return assetReader;
  const connectionString = databaseUrl();
  if (connectionString === undefined || connectionString.length === 0)
    throw new Error("jro_database_url_required");
  assetReader = createAssetSourceCatalogueReader(
    connectionString,
    SUPABASE_PROD_CA_2021,
  );
  return assetReader;
}

function sendJson(res, status, value) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.end(JSON.stringify(value));
}

function isAssetSourceRequest(req) {
  try {
    const parsed = new URL(req.url ?? "/", "https://localhost.invalid");
    return (
      parsed.pathname === "/api/asset-sources" ||
      (parsed.pathname === "/api/handler" &&
        parsed.searchParams.size === 1 &&
        parsed.searchParams.get("path") === "asset-sources")
    );
  } catch {
    return false;
  }
}

async function handleAssetSources(req, res) {
  if ((req.method ?? "").toUpperCase() !== "GET") {
    res.setHeader("Allow", "GET");
    sendJson(res, 405, {
      error: {
        code: "method_not_allowed",
        message: "Request could not be processed.",
      },
    });
    return;
  }

  try {
    const rows = await sourceReader().query();
    sendJson(res, 200, {
      version: "asset-source-catalogue.v1",
      deployment_commit_sha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      assets: rows.map((row) => ({
        id: row.asset_id,
        name: row.display_name,
        type: row.entity_type,
        source_page_url: row.source_page_url,
        merchant_key: row.merchant_key,
        brand_scope: row.brand_scope,
        merchant_group: row.merchant_group,
      })),
    });
  } catch {
    sendJson(res, 503, {
      error: {
        code: "asset_source_catalogue_unavailable",
        message: "Request could not be processed.",
      },
    });
  }
}

export default async function handler(req, res) {
  if (isAssetSourceRequest(req)) {
    await handleAssetSources(req, res);
    return;
  }
  await appHandler(req, res);
}
