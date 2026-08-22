import {
  createPostgresP0FactInfluenceGraphStore,
  createPostgresP0ImplementationCatalogueStore,
  type P0ImplementationCatalogueOptions,
  type QueryTarget,
} from "@jro/agent-feed-postgres";
import { Pool } from "pg";
import {
  createP0AgentFeedIngress,
  loadP0AgentFeedIngressFromEnvironment,
  type P0AgentFeedIngressOptions,
} from "./agent-feed-ingress.js";
import { createFactInfluenceGraphPort } from "./fact-influence-graph.js";
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
export interface PostgresAppRuntimeOptions
  extends P0ImplementationCatalogueOptions {
  /**
   * Optional host-owned Agent Feed delivery composition. The runtime supplies
   * its own PostgreSQL pool as `target`; the manifest and exact reconciliation
   * mapping remain deployment inputs.
   */
  readonly agentFeedIngress?: Omit<P0AgentFeedIngressOptions, "target">;
}

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
    factInfluenceGraph: createFactInfluenceGraphPort(
      createPostgresP0FactInfluenceGraphStore(target, options),
    ),
    ...(options.agentFeedIngress === undefined
      ? {}
      : {
          agentFeedIngress: createP0AgentFeedIngress({
            target,
            ...options.agentFeedIngress,
          }),
        }),
  });
}

/** Create the normal CLI runtime when JRO_DATABASE_URL is explicitly set. */
export function createPostgresAppRuntime(
  connectionString: string,
  options: PostgresAppRuntimeOptions = {},
): PostgresAppRuntime {
  const environmentIngress =
    options.agentFeedIngress === undefined
      ? loadP0AgentFeedIngressFromEnvironment()
      : undefined;
  const runtimeOptions =
    options.agentFeedIngress !== undefined || environmentIngress === undefined
      ? options
      : { ...options, agentFeedIngress: environmentIngress };
  const pool = new Pool({
    connectionString: requireDatabaseUrl(connectionString),
    max: 4,
  }) as unknown as CloseableQueryTarget;
  let closed = false;
  return Object.freeze({
    dependencies: createPostgresAppDependencies(pool, runtimeOptions),
    async close() {
      if (closed) return;
      closed = true;
      await pool.end();
    },
  });
}
