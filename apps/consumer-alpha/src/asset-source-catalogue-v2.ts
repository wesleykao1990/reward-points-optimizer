import { Pool } from "pg";
import {
  createPostgresPoolConfig,
  createRoleScopedQueryPool,
} from "./runtime.js";

export interface AssetSourceCatalogueV2Row {
  readonly asset_id: string;
  readonly display_name: string;
  readonly entity_type: string;
  readonly metadata: unknown;
  readonly source_page_url: string | null;
  readonly source_image_url: string | null;
  readonly source_origin: string | null;
  readonly checked_at: string | null;
}

export interface AssetSourceCatalogueV2Reader {
  readonly query: () => Promise<readonly AssetSourceCatalogueV2Row[]>;
  readonly close: () => Promise<void>;
}

export function createAssetSourceCatalogueV2Reader(
  connectionString: string,
  sslRootCertificate: string,
): AssetSourceCatalogueV2Reader {
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
    async query(): Promise<readonly AssetSourceCatalogueV2Row[]> {
      const result = await target.query<AssetSourceCatalogueV2Row>(`
        select
          asset_id,
          display_name,
          entity_type,
          metadata,
          source_page_url,
          source_image_url,
          source_origin,
          checked_at
        from app_api.asset_source_catalogue
        order by entity_type, asset_id
      `);
      return Object.freeze(
        result.rows.map((row) =>
          Object.freeze({
            asset_id: String(row.asset_id),
            display_name: String(row.display_name),
            entity_type: String(row.entity_type),
            metadata:
              row.metadata !== null && typeof row.metadata === "object"
                ? row.metadata
                : {},
            source_page_url:
              typeof row.source_page_url === "string"
                ? row.source_page_url
                : null,
            source_image_url:
              typeof row.source_image_url === "string"
                ? row.source_image_url
                : null,
            source_origin:
              typeof row.source_origin === "string" ? row.source_origin : null,
            checked_at:
              typeof row.checked_at === "string" ? row.checked_at : null,
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
