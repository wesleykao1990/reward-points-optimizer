import {
  createPostgresActiveRewardClaimStore,
  createPostgresAgentFeedTypedRuleRecordStore,
  createPostgresP0FactInfluenceGraphStore,
  createPostgresP0ImplementationCatalogueStore,
  type P0ImplementationCatalogueOptions,
  type PoolClient,
  type QueryPool,
  type QueryResult,
  type QueryTarget,
} from "@jro/agent-feed-postgres";
import { Pool, type PoolConfig } from "pg";
import { createActiveRewardCalculationPort } from "./active-reward-calculation.js";
import {
  createP0AgentFeedIngress,
  loadP0AgentFeedIngressFromEnvironment,
  type P0AgentFeedIngressOptions,
} from "./agent-feed-ingress.js";
import {
  isCanonicalProductFamilyId,
  type MerchantAcceptanceQuery,
} from "./contracts.js";
import { createFactInfluenceGraphPort } from "./fact-influence-graph.js";
import { createPostgresImplementationFactCataloguePort } from "./implementation-catalog.js";
import {
  createPostgresExperimentalCataloguePort,
  createPostgresNanacoCreditChargeRecommendationPort,
  createPostgresNanacoExperimentalRecommendationPort,
  createPostgresRouteGraphSourcePort,
} from "./postgres-catalogue.js";
import type { AppDependencies } from "./server.js";

export interface PostgresAppRuntime {
  readonly dependencies: AppDependencies;
  readonly close: () => Promise<void>;
}

/** Host-owned time source for all effective-at current catalogue reads. */
export interface PostgresAppRuntimeOptions
  extends P0ImplementationCatalogueOptions {
  /** Bound application role selected inside each checked-out transaction. */
  readonly databaseRole?: string;
  /** Keep serverless instances to one client connection by default. */
  readonly poolMax?: number;
  /** Optional trusted root used for hostname-verified PostgreSQL TLS. */
  readonly sslRootCertificate?: string;
  /**
   * Optional host-owned Agent Feed delivery composition. The runtime supplies
   * its own PostgreSQL pool as `target`; the manifest and exact reconciliation
   * mapping remain deployment inputs.
   */
  readonly agentFeedIngress?: Omit<P0AgentFeedIngressOptions, "target">;
}

type CloseableQueryPool = QueryPool & {
  readonly end: () => Promise<void>;
};

function requireDatabaseUrl(value: string): string {
  if (value.length === 0 || value.trim() !== value)
    throw new TypeError("jro_database_url_invalid");
  return value;
}

function optionalDatabaseRole(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (!/^[a-z][a-z0-9_]{0,62}$/u.test(value))
    throw new TypeError("jro_database_role_invalid");
  return value;
}

function poolMaximum(value: number | undefined): number {
  if (value === undefined) return 4;
  if (!Number.isSafeInteger(value) || value < 1 || value > 4)
    throw new TypeError("jro_database_pool_max_invalid");
  return value;
}

function tlsConnectionString(connectionString: string): string {
  const parsed = new URL(connectionString);
  for (const parameter of ["sslcert", "sslkey", "sslrootcert", "sslmode"])
    parsed.searchParams.delete(parameter);
  return parsed.toString();
}

function transactionCommand(
  text: string,
): "begin" | "commit" | "rollback" | null {
  const command = text
    .trim()
    .replaceAll(/\s+/gu, " ")
    .toLocaleUpperCase("en-US");
  if (command === "BEGIN" || command === "START TRANSACTION") return "begin";
  if (command === "COMMIT") return "commit";
  if (command === "ROLLBACK") return "rollback";
  return null;
}

function roleScopedClient(client: PoolClient, role: string): PoolClient {
  const setRole = `SET LOCAL ROLE ${role}`;
  let transactionActive = false;

  const oneQueryTransaction = async <Row>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<Row>> => {
    await client.query("BEGIN");
    try {
      await client.query(setRole);
      const result = await client.query<Row>(text, values);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the original role or application query failure.
      }
      throw error;
    }
  };

  return {
    async query<Row = unknown>(
      text: string,
      values?: readonly unknown[],
    ): Promise<QueryResult<Row>> {
      const command = transactionCommand(text);
      if (command === "begin") {
        const result = await client.query<Row>(text, values);
        try {
          await client.query(setRole);
          transactionActive = true;
          return result;
        } catch (error) {
          try {
            await client.query("ROLLBACK");
          } catch {
            // Preserve the role-selection failure.
          }
          throw error;
        }
      }
      if (command === "commit" || command === "rollback") {
        try {
          return await client.query<Row>(text, values);
        } finally {
          transactionActive = false;
        }
      }
      if (transactionActive) return client.query<Row>(text, values);
      return oneQueryTransaction<Row>(text, values);
    },
    release(error?: Error) {
      const releaseError =
        error ??
        (transactionActive
          ? new Error("jro_database_role_transaction_unfinished")
          : undefined);
      client.release?.(releaseError);
    },
  };
}

/** Bind every pool checkout to the restricted role within a transaction. */
export function createRoleScopedQueryPool(
  pool: QueryPool,
  databaseRole: string,
): QueryPool {
  const role = optionalDatabaseRole(databaseRole);
  if (role === undefined) throw new TypeError("jro_database_role_required");
  return {
    async query<Row = unknown>(
      text: string,
      values?: readonly unknown[],
    ): Promise<QueryResult<Row>> {
      const client = roleScopedClient(await pool.connect(), role);
      let failure: Error | undefined;
      try {
        return await client.query<Row>(text, values);
      } catch (error) {
        failure =
          error instanceof Error
            ? error
            : new Error("jro_database_query_failed");
        throw error;
      } finally {
        client.release?.(failure);
      }
    },
    async connect(): Promise<PoolClient> {
      return roleScopedClient(await pool.connect(), role);
    },
  };
}

/** Build a bounded pool config without exposing or logging the URL. */
export function createPostgresPoolConfig(
  connectionString: string,
  options: Pick<
    PostgresAppRuntimeOptions,
    "databaseRole" | "poolMax" | "sslRootCertificate"
  > = {},
): PoolConfig {
  optionalDatabaseRole(options.databaseRole);
  const requiredConnectionString = requireDatabaseUrl(connectionString);
  return {
    connectionString:
      options.sslRootCertificate === undefined
        ? requiredConnectionString
        : tlsConnectionString(requiredConnectionString),
    max: poolMaximum(options.poolMax),
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    allowExitOnIdle: true,
    ...(options.sslRootCertificate === undefined
      ? {}
      : {
          ssl: {
            ca: options.sslRootCertificate,
            rejectUnauthorized: true,
          },
        }),
  };
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
  const typedRuleStore = createPostgresAgentFeedTypedRuleRecordStore(target);
  return Object.freeze({
    activeRewardCalculations: createActiveRewardCalculationPort(
      createPostgresActiveRewardClaimStore(target),
    ),
    merchantAcceptance: Object.freeze({
      async listAcceptedFamilies(input: MerchantAcceptanceQuery) {
        const requested = new Set(input.family_ids);
        const rows = await typedRuleStore.listMerchantPaymentAcceptance(
          input.effective_at,
        );
        const matches = (paymentFamily: string, familyId: string): boolean =>
          paymentFamily === familyId ||
          (paymentFamily === "category.credit_card" &&
            familyId.startsWith("card.")) ||
          (paymentFamily === "category.mobile_pay" &&
            familyId.startsWith("wallet.")) ||
          (paymentFamily === "category.point" &&
            familyId.startsWith("point.")) ||
          (paymentFamily === "category.stored_value" &&
            (familyId.startsWith("emoney.") ||
              familyId.startsWith("storedvalue.")));
        return Object.freeze(
          input.family_ids
            .filter(
              (familyId) =>
                isCanonicalProductFamilyId(familyId) &&
                rows.some(
                  (row) =>
                    row.merchant_id === input.merchant_id &&
                    row.accepted &&
                    matches(row.payment_family, familyId),
                ),
            )
            .filter((familyId) => requested.has(familyId))
            .sort(),
        );
      },
    }),
    experimentalCatalogue: createPostgresExperimentalCataloguePort(target),
    routeGraphSource: createPostgresRouteGraphSourcePort(target),
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
  const pool = new Pool(
    createPostgresPoolConfig(connectionString, options),
  ) as unknown as CloseableQueryPool;
  const role = optionalDatabaseRole(options.databaseRole);
  const target =
    role === undefined ? pool : createRoleScopedQueryPool(pool, role);
  let closed = false;
  return Object.freeze({
    dependencies: createPostgresAppDependencies(target, runtimeOptions),
    async close() {
      if (closed) return;
      closed = true;
      await pool.end();
    },
  });
}
