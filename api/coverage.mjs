import { createCreditCardCoverageReader } from "../apps/consumer-alpha/dist/credit-card-coverage.js";
import { SUPABASE_PROD_CA_2021 } from "../apps/consumer-alpha/dist/supabase-ca.js";

let reader;

function databaseUrl() {
  return (
    process.env.JRO_DATABASE_URL ??
    process.env.POSTGRES_URL ??
    process.env.POSTGRES_URL_NON_POOLING
  );
}

function coverageReader() {
  if (reader !== undefined) return reader;
  const connectionString = databaseUrl();
  if (connectionString === undefined || connectionString.length === 0)
    throw new Error("jro_database_url_required");
  reader = createCreditCardCoverageReader(
    connectionString,
    SUPABASE_PROD_CA_2021,
  );
  return reader;
}

function sendJson(res, status, value) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.end(JSON.stringify(value));
}

export default async function handler(req, res) {
  if ((req.method ?? "").toUpperCase() !== "GET") {
    res.setHeader("Allow", "GET");
    sendJson(res, 405, {
      error: { code: "method_not_allowed", message: "Request could not be processed." },
    });
    return;
  }

  try {
    const rows = await coverageReader().query();
    const tiers = rows.map((row) => ({
      tier: String(row.coverage_tier),
      catalogue_count: Number(row.catalogue_count),
      optimization_count: Number(row.optimization_count),
    }));
    const catalogueTotal = tiers.reduce((sum, row) => sum + row.catalogue_count, 0);
    const optimizationTotal = tiers.reduce((sum, row) => sum + row.optimization_count, 0);
    sendJson(res, 200, {
      version: "credit-card-coverage.v1",
      catalogue: {
        total: catalogueTotal,
        tiers: tiers.map((row) => ({ tier: row.tier, count: row.catalogue_count })),
      },
      optimization: {
        covered: optimizationTotal,
        total: catalogueTotal,
        tiers: tiers.map((row) => ({
          tier: row.tier,
          covered: row.optimization_count,
          total: row.catalogue_count,
        })),
      },
    });
  } catch {
    sendJson(res, 503, {
      error: { code: "coverage_unavailable", message: "Request could not be processed." },
    });
  }
}
