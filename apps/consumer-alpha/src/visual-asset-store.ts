import { Pool } from "pg";
import {
  createPostgresPoolConfig,
  createRoleScopedQueryPool,
} from "./runtime.js";

export interface StoredVisualAsset {
  readonly asset_id: string;
  readonly entity_id: string | null;
  readonly alias_of: string | null;
  readonly display_name: string;
  readonly entity_type: string;
  readonly asset_variant: string;
  readonly format: string;
  readonly mime_type: string;
  readonly width: number;
  readonly height: number;
  readonly aspect_ratio: string;
  readonly svg_text: string;
  readonly svg_sha256: string;
  readonly generation_run_id: string;
  readonly source_kind: string | null;
  readonly source_page_url: string | null;
  readonly source_image_url: string | null;
  readonly source_sha256: string | null;
  readonly source_asset_path: string | null;
  readonly source_mime: string | null;
  readonly source_dimensions: unknown;
  readonly validation_status:
    | "generated"
    | "valid"
    | "invalid"
    | "deployed"
    | "retired";
  readonly validation_errors: readonly string[];
  readonly generated_at: string;
  readonly validated_at: string | null;
  readonly deployed_at: string | null;
}

export interface StoredVisualSource {
  readonly asset_id: string;
  readonly alias_of: string | null;
  readonly source_sha256: string;
  readonly source_kind: string;
  readonly mime_type: string;
  readonly byte_size: number;
  readonly width: number | null;
  readonly height: number | null;
  readonly official_page_url: string | null;
  readonly official_image_url: string | null;
  readonly content_base64: string;
}

export interface VisualSourceUpsert {
  readonly assetId: string;
  readonly aliasOf: string | null;
  readonly sourceSha256: string;
  readonly sourceKind: string;
  readonly mimeType: string;
  readonly contentBase64: string;
  readonly width: number | null;
  readonly height: number | null;
  readonly officialPageUrl: string | null;
  readonly officialImageUrl: string | null;
}

export interface VisualAssetUpsert {
  readonly assetId: string;
  readonly aliasOf: string | null;
  readonly displayName: string;
  readonly entityType: string;
  readonly svgText: string;
  readonly svgSha256: string;
  readonly generationRunId: string;
  readonly sourceKind: string | null;
  readonly sourcePageUrl: string | null;
  readonly sourceImageUrl: string | null;
  readonly sourceSha256: string | null;
  readonly sourceAssetPath: string | null;
  readonly sourceMime: string | null;
  readonly sourceDimensions: unknown;
}

export interface VisualAssetStore {
  readonly upsertSource: (source: VisualSourceUpsert) => Promise<void>;
  readonly upsertGenerated: (asset: VisualAssetUpsert) => Promise<void>;
  readonly markValidation: (
    assetId: string,
    status: "valid" | "invalid",
    errors: readonly string[],
  ) => Promise<void>;
  readonly markDeployed: (assetIds: readonly string[]) => Promise<void>;
  readonly getReusable: (
    assetIds: readonly string[],
  ) => Promise<ReadonlyMap<string, StoredVisualAsset>>;
  readonly getSources: (
    assetIds: readonly string[],
  ) => Promise<ReadonlyMap<string, StoredVisualSource>>;
  readonly close: () => Promise<void>;
}

export function createVisualAssetStore(
  connectionString: string,
  sslRootCertificate: string,
): VisualAssetStore {
  const pool = new Pool(
    createPostgresPoolConfig(connectionString, {
      databaseRole: "jro_runtime",
      poolMax: 3,
      sslRootCertificate,
    }),
  );
  const target = createRoleScopedQueryPool(pool, "jro_runtime");
  let closed = false;

  return Object.freeze({
    async upsertSource(source: VisualSourceUpsert): Promise<void> {
      const bytes = Buffer.from(source.contentBase64, "base64");
      await target.query("begin");
      try {
        await target.query(
          `insert into app_private.visual_source_artifacts (
             source_sha256, source_kind, mime_type, byte_size, width, height,
             official_page_url, official_image_url, content, last_verified_at
           )
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
           on conflict (source_sha256) do update set
             source_kind = excluded.source_kind,
             mime_type = excluded.mime_type,
             byte_size = excluded.byte_size,
             width = coalesce(excluded.width, app_private.visual_source_artifacts.width),
             height = coalesce(excluded.height, app_private.visual_source_artifacts.height),
             official_page_url = coalesce(excluded.official_page_url, app_private.visual_source_artifacts.official_page_url),
             official_image_url = coalesce(excluded.official_image_url, app_private.visual_source_artifacts.official_image_url),
             content = excluded.content,
             last_verified_at = now()`,
          [
            source.sourceSha256,
            source.sourceKind,
            source.mimeType,
            bytes.length,
            source.width,
            source.height,
            source.officialPageUrl,
            source.officialImageUrl,
            bytes,
          ],
        );
        await target.query(
          `insert into app_private.entity_visual_source_links (
             asset_id, entity_id, alias_of, source_sha256, source_role, selected_at
           )
           values (
             $1,
             (select id from app_private.entities where entity_key = $1 limit 1),
             $2, $3, 'primary', now()
           )
           on conflict (asset_id) do update set
             entity_id = excluded.entity_id,
             alias_of = excluded.alias_of,
             source_sha256 = excluded.source_sha256,
             source_role = 'primary',
             selected_at = now()`,
          [source.assetId, source.aliasOf, source.sourceSha256],
        );
        await target.query("commit");
      } catch (error) {
        await target.query("rollback");
        throw error;
      }
    },

    async upsertGenerated(asset: VisualAssetUpsert): Promise<void> {
      await target.query(
        `insert into app_private.entity_visual_assets (
           asset_id, entity_id, alias_of, display_name, entity_type,
           asset_variant, format, mime_type, width, height, aspect_ratio,
           svg_text, svg_sha256, generation_run_id,
           source_kind, source_page_url, source_image_url, source_sha256,
           source_asset_path, source_mime, source_dimensions,
           validation_status, validation_errors, generated_at,
           validated_at, deployed_at
         )
         values (
           $1,
           (select id from app_private.entities where entity_key = $1 limit 1),
           $2, $3, $4,
           'liquid_glass', 'svg', 'image/svg+xml', 856, 539.8, '85.60:53.98',
           $5, $6, $7,
           $8, $9, $10, $11,
           $12, $13, $14::jsonb,
           'generated', '[]'::jsonb, now(), null, null
         )
         on conflict (asset_id) do update set
           entity_id = excluded.entity_id,
           alias_of = excluded.alias_of,
           display_name = excluded.display_name,
           entity_type = excluded.entity_type,
           svg_text = excluded.svg_text,
           svg_sha256 = excluded.svg_sha256,
           generation_run_id = excluded.generation_run_id,
           source_kind = excluded.source_kind,
           source_page_url = excluded.source_page_url,
           source_image_url = excluded.source_image_url,
           source_sha256 = excluded.source_sha256,
           source_asset_path = excluded.source_asset_path,
           source_mime = excluded.source_mime,
           source_dimensions = excluded.source_dimensions,
           validation_status = 'generated',
           validation_errors = '[]'::jsonb,
           generated_at = now(),
           validated_at = null,
           deployed_at = null`,
        [
          asset.assetId,
          asset.aliasOf,
          asset.displayName,
          asset.entityType,
          asset.svgText,
          asset.svgSha256,
          asset.generationRunId,
          asset.sourceKind,
          asset.sourcePageUrl,
          asset.sourceImageUrl,
          asset.sourceSha256,
          asset.sourceAssetPath,
          asset.sourceMime,
          JSON.stringify(asset.sourceDimensions ?? null),
        ],
      );
    },

    async markValidation(assetId, status, errors): Promise<void> {
      await target.query(
        `update app_private.entity_visual_assets
            set validation_status = $2,
                validation_errors = $3::jsonb,
                validated_at = now()
          where asset_id = $1`,
        [assetId, status, JSON.stringify(errors)],
      );
    },

    async markDeployed(assetIds): Promise<void> {
      if (assetIds.length === 0) return;
      await target.query(
        `update app_private.entity_visual_assets
            set validation_status = 'deployed', deployed_at = now()
          where asset_id = any($1::text[])`,
        [assetIds],
      );
    },

    async getReusable(assetIds): Promise<ReadonlyMap<string, StoredVisualAsset>> {
      if (assetIds.length === 0) return new Map();
      const result = await target.query<StoredVisualAsset>(
        `select asset_id, entity_id::text, alias_of, display_name, entity_type,
                asset_variant, format, mime_type, width::float8 as width,
                height::float8 as height, aspect_ratio, svg_text, svg_sha256,
                generation_run_id, source_kind, source_page_url, source_image_url,
                source_sha256, source_asset_path, source_mime, source_dimensions,
                validation_status, validation_errors, generated_at::text,
                validated_at::text, deployed_at::text
           from app_private.entity_visual_assets
          where asset_id = any($1::text[])
            and validation_status in ('valid','deployed')`,
        [assetIds],
      );
      return new Map(result.rows.map((row) => [row.asset_id, Object.freeze(row)]));
    },

    async getSources(assetIds): Promise<ReadonlyMap<string, StoredVisualSource>> {
      if (assetIds.length === 0) return new Map();
      const result = await target.query<StoredVisualSource>(
        `select l.asset_id, l.alias_of, a.source_sha256, a.source_kind,
                a.mime_type, a.byte_size::float8 as byte_size,
                a.width, a.height, a.official_page_url, a.official_image_url,
                encode(a.content, 'base64') as content_base64
           from app_private.entity_visual_source_links l
           join app_private.visual_source_artifacts a
             on a.source_sha256 = l.source_sha256
          where l.asset_id = any($1::text[])`,
        [assetIds],
      );
      return new Map(result.rows.map((row) => [row.asset_id, Object.freeze(row)]));
    },

    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      await pool.end();
    },
  });
}
