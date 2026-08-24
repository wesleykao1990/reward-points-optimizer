import { Pool } from "pg";
import {
  createPostgresPoolConfig,
  createRoleScopedQueryPool,
} from "../apps/consumer-alpha/dist/runtime.js";
import { SUPABASE_PROD_CA_2021 } from "../apps/consumer-alpha/dist/supabase-ca.js";

let pool;
let target;

function databaseUrl() {
  return (
    process.env.JRO_DATABASE_URL ??
    process.env.POSTGRES_URL ??
    process.env.POSTGRES_URL_NON_POOLING
  );
}

function queryTarget() {
  if (target !== undefined) return target;
  const connectionString = databaseUrl();
  if (connectionString === undefined || connectionString.length === 0)
    throw new Error("jro_database_url_required");
  pool = new Pool(
    createPostgresPoolConfig(connectionString, {
      databaseRole: "jro_runtime",
      poolMax: 1,
      sslRootCertificate: SUPABASE_PROD_CA_2021,
    }),
  );
  target = createRoleScopedQueryPool(pool, "jro_runtime");
  return target;
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
    const result = await queryTarget().query(`
      select
        coverage_tier,
        count(*)::integer as catalogue_count,
        count(*) filter (where optimization_covered)::integer as optimization_count
      from app_api.credit_card_coverage
      group by coverage_tier
      order by case coverage_tier when 'P0' then 0 when 'P1' then 1 when 'P2' then 2 else 9 end,
               coverage_tier
    `);
    const tiers = result.rows.map((row) => ({
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
