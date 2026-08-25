import { Pool } from "pg";
import {
  createPostgresPoolConfig,
  createRoleScopedQueryPool,
} from "./runtime.js";

export interface CreditCardCoverageRow {
  readonly coverage_tier: string;
  readonly catalogue_count: number;
  readonly optimization_count: number;
}

export interface CreditCardCoverageReader {
  readonly query: () => Promise<readonly CreditCardCoverageRow[]>;
  readonly close: () => Promise<void>;
}

/**
 * Keep PostgreSQL ownership inside the consumer-alpha workspace so Vercel's
 * function tracer resolves `pg` from the workspace that declares it.
 */
export function createCreditCardCoverageReader(
  connectionString: string,
  sslRootCertificate: string,
): CreditCardCoverageReader {
  const pool = new Pool(
    createPostgresPoolConfig(connectionString, {
      databaseRole: "jro_runtime",
      poolMax: 1,
      sslRootCertificate,
    }),
  );
  const target = createRoleScopedQueryPool(pool, "jro_runtime");
  let closed = false;

  return Object.freeze({
    async query(): Promise<readonly CreditCardCoverageRow[]> {
      const result = await target.query<CreditCardCoverageRow>(`
        select
          coverage_tier,
          count(*)::integer as catalogue_count,
          count(*) filter (where optimization_covered)::integer as optimization_count
        from app_api.credit_card_coverage
        group by coverage_tier
        order by case coverage_tier when 'P0' then 0 when 'P1' then 1 when 'P2' then 2 else 9 end,
                 coverage_tier
      `);
      return Object.freeze(
        result.rows.map((row) =>
          Object.freeze({
            coverage_tier: String(row.coverage_tier),
            catalogue_count: Number(row.catalogue_count),
            optimization_count: Number(row.optimization_count),
          }),
        ),
      );
    },
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      await pool.end();
    },
  });
}
