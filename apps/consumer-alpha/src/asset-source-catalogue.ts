import { Pool } from "pg";
import {
  createPostgresPoolConfig,
  createRoleScopedQueryPool,
} from "./runtime.js";

export interface AssetSourceCatalogueRow {
  readonly asset_id: string;
  readonly display_name: string;
  readonly entity_type: string;
  readonly source_page_url: string | null;
  readonly merchant_key: string | null;
  readonly brand_scope: string | null;
  readonly merchant_group: string | null;
}

export interface AssetSourceCatalogueReader {
  readonly query: () => Promise<readonly AssetSourceCatalogueRow[]>;
  readonly close: () => Promise<void>;
}

/**
 * Read the bounded, public-artwork source projection used only by the
 * build-time Liquid Glass asset job. Private metadata and economic facts do
 * not cross this boundary.
 */
export function createAssetSourceCatalogueReader(
  connectionString: string,
  sslRootCertificate: string,
): AssetSourceCatalogueReader {
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
    async query(): Promise<readonly AssetSourceCatalogueRow[]> {
      const result = await target.query<AssetSourceCatalogueRow>(`
        select
          asset_id,
          display_name,
          entity_type,
          source_page_url,
          merchant_key,
          brand_scope,
          merchant_group
        from app_api.asset_source_catalogue
        order by asset_id
      `);
      return Object.freeze(
        result.rows.map((row) =>
          Object.freeze({
            asset_id: String(row.asset_id),
            display_name: String(row.display_name),
            entity_type: String(row.entity_type),
            source_page_url:
              row.source_page_url === null
                ? null
                : String(row.source_page_url),
            merchant_key:
              row.merchant_key === null ? null : String(row.merchant_key),
            brand_scope:
              row.brand_scope === null ? null : String(row.brand_scope),
            merchant_group:
              row.merchant_group === null ? null : String(row.merchant_group),
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
