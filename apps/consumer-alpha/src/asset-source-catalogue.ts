import { Pool } from "pg";
import {
  createPostgresPoolConfig,
  createRoleScopedQueryPool,
} from "./runtime.js";

export interface AssetSourceCatalogueRow {
  readonly asset_id: string;
  readonly display_name: string;
  readonly entity_type: string;
  readonly metadata: unknown;
  readonly source_page_url: string | null;
  readonly source_image_url: string | null;
  readonly source_origin: string | null;
  readonly checked_at: string | null;
}

export interface AssetSourceCatalogueReader {
  readonly query: () => Promise<readonly AssetSourceCatalogueRow[]>;
  readonly close: () => Promise<void>;
}

export interface ConsumerCatalogueUiRow {
  readonly item_id: string;
  readonly display_name: string;
  readonly item_kind: string;
  readonly provider_name: string | null;
  readonly official_product_url: string | null;
  readonly source_image_url: string | null;
  readonly validation_status: string | null;
  readonly updated_at: string | null;
}

export interface ConsumerCatalogueUiReader {
  readonly query: () => Promise<readonly ConsumerCatalogueUiRow[]>;
  readonly close: () => Promise<void>;
}

function createRuntimePool(
  connectionString: string,
  sslRootCertificate: string,
): Pool {
  return new Pool(
    createPostgresPoolConfig(connectionString, {
      databaseRole: "jro_runtime",
      poolMax: 1,
      sslRootCertificate,
    }),
  );
}

export function createAssetSourceCatalogueReader(
  connectionString: string,
  sslRootCertificate: string,
): AssetSourceCatalogueReader {
  const pool = createRuntimePool(connectionString, sslRootCertificate);
  const target = createRoleScopedQueryPool(pool, "jro_runtime");
  let closed = false;

  return Object.freeze({
    async query(): Promise<readonly AssetSourceCatalogueRow[]> {
      const result = await target.query<AssetSourceCatalogueRow>(
        "select asset_id, display_name, entity_type, metadata, source_page_url, source_image_url, source_origin, checked_at from app_api.asset_source_catalogue order by entity_type, asset_id",
      );
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

export function createConsumerCatalogueUiReader(
  connectionString: string,
  sslRootCertificate: string,
): ConsumerCatalogueUiReader {
  const pool = createRuntimePool(connectionString, sslRootCertificate);
  const target = createRoleScopedQueryPool(pool, "jro_runtime");
  let closed = false;

  return Object.freeze({
    async query(): Promise<readonly ConsumerCatalogueUiRow[]> {
      const result = await target.query<{
        item_id: unknown;
        display_name: unknown;
        item_kind: unknown;
        provider_name: unknown;
        official_product_url: unknown;
        source_image_url: unknown;
        validation_status: unknown;
        updated_at: unknown;
      }>(
        `select item_id, display_name, item_kind, provider_name,
                official_product_url, source_image_url, validation_status,
                updated_at
           from app_api.consumer_catalogue_ui
          order by item_kind, provider_name nulls last, display_name, item_id`,
      );
      return Object.freeze(
        result.rows.map((row) =>
          Object.freeze({
            item_id: String(row.item_id),
            display_name: String(row.display_name),
            item_kind: String(row.item_kind),
            provider_name:
              typeof row.provider_name === "string" ? row.provider_name : null,
            official_product_url:
              typeof row.official_product_url === "string"
                ? row.official_product_url
                : null,
            source_image_url:
              typeof row.source_image_url === "string"
                ? row.source_image_url
                : null,
            validation_status:
              typeof row.validation_status === "string"
                ? row.validation_status
                : null,
            updated_at:
              row.updated_at instanceof Date
                ? row.updated_at.toISOString()
                : typeof row.updated_at === "string"
                  ? row.updated_at
                  : null,
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
