import {
  createPostgresP0ImplementationCatalogueStore,
  type P0ImplementationCatalogueOptions,
  type QueryTarget,
} from "@jro/agent-feed-postgres";
import { Pool } from "pg";
import { createPostgresImplementationFactCataloguePort } from "./implementation-catalog.js";
import {
  createPostgresExperimentalCataloguePort,
  createPostgresNanacoCreditChargeRecommendationPort,
  createPostgresNanacoExperimentalRecommendationPort,
} from "./postgres-catalogue.js";
import type { AppDependencies } from "./server.js";

export interface PostgresAppRuntime {
  readonly dependencies: AppDependencies;
  readonly close: () => Promise<void>;
}

/** Host-owned time source for all effective-at current catalogue reads. */
export type PostgresAppRuntimeOptions = P0ImplementationCatalogueOptions;

type CloseableQueryTarget = QueryTarget & {
  readonly end: () => Promise<void>;
};

function requireDatabaseUrl(value: string): string {
  if (value.length === 0 || value.trim() !== value)
    throw new TypeError("jro_database_url_invalid");
  return value;
}

/**
 * Compose all database-backed browser ports from one server-owned query
 * target. The browser receives only bounded DTOs; it never receives a
 * connection string, database client, evidence document, or rule payload.
 */
export function createPostgresAppDependencies(
  target: QueryTarget,
  options: PostgresAppRuntimeOptions = {},
): AppDependencies {
  const implementationStore = createPostgresP0ImplementationCatalogueStore(
    target,
    options,
  );
  return Object.freeze({
    experimentalCatalogue: createPostgresExperimentalCataloguePort(target),
    experimentalRecommendation:
      createPostgresNanacoExperimentalRecommendationPort(target),
    experimentalNanacoCreditChargeRecommendation:
      createPostgresNanacoCreditChargeRecommendationPort(target),
    implementationFacts: createPostgresImplementationFactCataloguePort(
      implementationStore,
      options,
    ),
  });
}

/** Create the normal CLI runtime when JRO_DATABASE_URL is explicitly set. */
export function createPostgresAppRuntime(
  connectionString: string,
  options: PostgresAppRuntimeOptions = {},
): PostgresAppRuntime {
  const pool = new Pool({
    connectionString: requireDatabaseUrl(connectionString),
    max: 4,
  }) as unknown as CloseableQueryTarget;
  let closed = false;
  return Object.freeze({
    dependencies: createPostgresAppDependencies(pool, options),
    async close() {
      if (closed) return;
      closed = true;
      await pool.end();
    },
  });
}
