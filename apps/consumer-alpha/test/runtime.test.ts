import { describe, expect, it } from "vitest";
import { createPostgresPoolConfig } from "../src/runtime.js";

describe("consumer-alpha PostgreSQL runtime configuration", () => {
  it("uses one bounded connection and the restricted role for serverless hosts", () => {
    const config = createPostgresPoolConfig(
      "postgresql://postgres.example:secret@pooler.example:6543/postgres?sslmode=require",
      { databaseRole: "jro_runtime", poolMax: 1 },
    );
    expect(config).toMatchObject({
      max: 1,
      options: "-c role=jro_runtime",
      allowExitOnIdle: true,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
    });
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
