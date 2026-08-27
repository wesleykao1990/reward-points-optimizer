import type {
  PoolClient,
  QueryPool,
  QueryResult,
} from "@jro/agent-feed-postgres";
import { describe, expect, it } from "vitest";
import {
  createPostgresAppDependencies,
  createPostgresPoolConfig,
  createRoleScopedQueryPool,
} from "../src/runtime.js";

describe("consumer-alpha PostgreSQL runtime configuration", () => {
  it("wires merchant acceptance from the live Supabase merchant projection", async () => {
    const target = {
      async query<Row = unknown>(text: string, values?: readonly unknown[]) {
        expect(text).toContain("app_api.merchant_acceptance_current");
        expect(values).toEqual([
          "merchant.lawson",
          "location.lawson.representative",
        ]);
        return {
          rows: [
            {
              instrument_key: "instrument.payment.credit_card_general",
              action: "pay",
              acceptance_state: "yes",
              scope: "chain_default",
              location_key: null,
            },
          ] as Row[],
        };
      },
    };
    const port = createPostgresAppDependencies(target).merchantAcceptance;
    await expect(
      port?.listAcceptedFamilies({
        merchant_id: "merchant.lawson",
        branch_id: "location.lawson.representative",
        family_ids: ["card.rakuten", "wallet.paypay"],
        effective_at: "2026-08-24T12:00:00+09:00",
      }),
    ).resolves.toEqual(["card.rakuten"]);
  });

  it("lets a Supabase branch fact override a chain default", async () => {
    const target = {
      async query<Row = unknown>() {
        return {
          rows: [
            {
              instrument_key: "instrument.wallet.paypay",
              action: "pay",
              acceptance_state: "no",
              scope: "branch",
              location_key: "location.lawson.representative",
            },
            {
              instrument_key: "instrument.wallet.paypay",
              action: "pay",
              acceptance_state: "yes",
              scope: "chain_default",
              location_key: null,
            },
          ] as Row[],
        };
      },
    };
    const port = createPostgresAppDependencies(target).merchantAcceptance;
    await expect(
      port?.listAcceptedFamilies({
        merchant_id: "merchant.lawson",
        branch_id: "location.lawson.representative",
        family_ids: ["wallet.paypay"],
        effective_at: "2026-08-24T12:00:00+09:00",
      }),
    ).resolves.toEqual([]);
  });

  it("uses one bounded connection without unsafe pooler session options", () => {
    const config = createPostgresPoolConfig(
      "postgresql://postgres.example:secret@pooler.example:6543/postgres?sslmode=require",
      { databaseRole: "jro_runtime", poolMax: 1 },
    );
    expect(config).toMatchObject({
      max: 1,
      allowExitOnIdle: true,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
    });
    expect(config).not.toHaveProperty("options");
  });

  it("verifies TLS with an explicit root without allowing URL SSL options to replace it", () => {
    const config = createPostgresPoolConfig(
      "postgresql://postgres.example:secret@pooler.example:6543/postgres?sslmode=require&supa=base-pooler.example",
      { sslRootCertificate: "trusted-root" },
    );
    expect(config.connectionString).toBe(
      "postgresql://postgres.example:secret@pooler.example:6543/postgres?supa=base-pooler.example",
    );
    expect(config.ssl).toEqual({
      ca: "trusted-root",
      rejectUnauthorized: true,
    });
  });

  it("selects the restricted role inside standalone and caller-owned transactions", async () => {
    const traces: string[][] = [];
    const releases: (Error | undefined)[] = [];
    const pool: QueryPool = {
      async query<Row = unknown>(): Promise<QueryResult<Row>> {
        throw new Error("direct_pool_query_not_expected");
      },
      async connect(): Promise<PoolClient> {
        const trace: string[] = [];
        traces.push(trace);
        return {
          async query<Row = unknown>(text: string): Promise<QueryResult<Row>> {
            trace.push(text);
            return {
              rows: (text.startsWith("select") ? [{ ok: true }] : []) as Row[],
            };
          },
          release(error?: Error) {
            releases.push(error);
          },
        };
      },
    };
    const scoped = createRoleScopedQueryPool(pool, "jro_runtime");

    await expect(scoped.query("select 1")).resolves.toEqual({
      rows: [{ ok: true }],
    });
    const client = await scoped.connect();
    await client.query("BEGIN");
    await client.query("select 2");
    await client.query("COMMIT");
    client.release?.();

    expect(traces).toEqual([
      ["BEGIN", "SET LOCAL ROLE jro_runtime", "select 1", "COMMIT"],
      ["BEGIN", "SET LOCAL ROLE jro_runtime", "select 2", "COMMIT"],
    ]);
    expect(releases).toEqual([undefined, undefined]);
  });

  it("rolls back and discards a failed role-scoped checkout", async () => {
    const trace: string[] = [];
    let releaseError: Error | undefined;
    const pool: QueryPool = {
      async query<Row = unknown>(): Promise<QueryResult<Row>> {
        throw new Error("direct_pool_query_not_expected");
      },
      async connect(): Promise<PoolClient> {
        return {
          async query<Row = unknown>(text: string): Promise<QueryResult<Row>> {
            trace.push(text);
            if (text === "select fail") throw new Error("query_failed");
            return { rows: [] } as QueryResult<Row>;
          },
          release(error?: Error) {
            releaseError = error;
          },
        };
      },
    };

    await expect(
      createRoleScopedQueryPool(pool, "jro_runtime").query("select fail"),
    ).rejects.toThrow("query_failed");
    expect(trace).toEqual([
      "BEGIN",
      "SET LOCAL ROLE jro_runtime",
      "select fail",
      "ROLLBACK",
    ]);
    expect(releaseError?.message).toBe("query_failed");
  });

  it("rejects unsafe role names and unbounded pools", () => {
    expect(() =>
      createPostgresPoolConfig("postgresql://example.invalid/postgres", {
        databaseRole: "jro_runtime; reset role",
      }),
    ).toThrow("jro_database_role_invalid");
    expect(() =>
      createPostgresPoolConfig("postgresql://example.invalid/postgres", {
        poolMax: 5,
      }),
    ).toThrow("jro_database_pool_max_invalid");
  });
});
