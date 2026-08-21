import { describe, expect, it } from "vitest";
import {
  ATOMIC_FUNCTION_QUERY,
  type AtomicPersistenceInput,
  createPostgresAtomicPersistence,
  type QueryClient,
  type QueryPool,
} from "../src/index.js";

const input = {
  receipt: { event_id: "event_test_001" },
  observation: null,
  submitted_evidence: [],
  run_lifecycle: null,
} as unknown as AtomicPersistenceInput;

function result(status: string) {
  return {
    rows: [
      {
        receipt_id: "00000000-0000-0000-0000-000000000001",
        status,
        observation: null,
        duplicate_kind: null,
        duplicate_of_receipt_id: null,
        reason_code: null,
      },
    ],
  };
}

describe("createPostgresAtomicPersistence", () => {
  it("runs one transaction and maps the wrapper result", async () => {
    const calls: Array<{ text: string; values?: readonly unknown[] }> = [];
    const client: QueryClient = {
      async query(text, values) {
        calls.push({ text, values });
        return text === "BEGIN" || text === "COMMIT"
          ? { rows: [] }
          : result("inserted");
      },
    };

    const outcome =
      await createPostgresAtomicPersistence(client).persist(input);

    expect(outcome).toEqual({
      status: "inserted",
      receipt_id: "00000000-0000-0000-0000-000000000001",
      observation: null,
      duplicate_of_receipt_id: null,
    });
    expect(calls.map((call) => call.text)).toEqual([
      "BEGIN",
      ATOMIC_FUNCTION_QUERY,
      "COMMIT",
    ]);
    expect(calls[1]?.values).toEqual([JSON.stringify(input)]);
  });

  it("uses one checked-out pool client and releases it", async () => {
    const calls: string[] = [];
    let released = false;
    let releaseError: Error | undefined;
    const pool: QueryPool = {
      async query() {
        throw new Error("pool.query must not be used for a transaction");
      },
      async connect() {
        return {
          async query(text) {
            calls.push(text);
            return text === "BEGIN" || text === "COMMIT"
              ? { rows: [] }
              : result("mapped");
          },
          release(error?: Error) {
            released = true;
            releaseError = error;
          },
        };
      },
    };

    await expect(
      createPostgresAtomicPersistence(pool).persist(input),
    ).resolves.toMatchObject({
      status: "mapped",
    });
    expect(calls).toHaveLength(3);
    expect(released).toBe(true);
    expect(releaseError).toBeUndefined();
  });

  it("rolls back and preserves the original error", async () => {
    const calls: string[] = [];
    const failure = new Error("db failure");
    const client: QueryClient = {
      async query(text) {
        calls.push(text);
        if (text === ATOMIC_FUNCTION_QUERY) throw failure;
        return { rows: [] };
      },
    };

    await expect(
      createPostgresAtomicPersistence(client).persist(input),
    ).rejects.toBe(failure);
    expect(calls).toEqual(["BEGIN", ATOMIC_FUNCTION_QUERY, "ROLLBACK"]);
  });

  it("passes the original query error to release after rollback", async () => {
    const calls: string[] = [];
    const failure = new Error("query failure");
    let releaseError: Error | undefined;
    const pool: QueryPool = {
      async query() {
        throw new Error("pool.query must not be used for a transaction");
      },
      async connect() {
        return {
          async query(text) {
            calls.push(text);
            if (text === ATOMIC_FUNCTION_QUERY) throw failure;
            return { rows: [] };
          },
          release(error?: Error) {
            releaseError = error;
          },
        };
      },
    };

    await expect(
      createPostgresAtomicPersistence(pool).persist(input),
    ).rejects.toBe(failure);
    expect(calls).toEqual(["BEGIN", ATOMIC_FUNCTION_QUERY, "ROLLBACK"]);
    expect(releaseError).toBe(failure);
  });

  it("passes the original transaction error to release after rollback", async () => {
    const calls: string[] = [];
    const failure = new Error("begin failure");
    let releaseError: Error | undefined;
    const pool: QueryPool = {
      async query() {
        throw new Error("pool.query must not be used for a transaction");
      },
      async connect() {
        return {
          async query(text) {
            calls.push(text);
            if (text === "BEGIN") throw failure;
            return { rows: [] };
          },
          release(error?: Error) {
            releaseError = error;
          },
        };
      },
    };

    await expect(
      createPostgresAtomicPersistence(pool).persist(input),
    ).rejects.toBe(failure);
    expect(calls).toEqual(["BEGIN", "ROLLBACK"]);
    expect(releaseError).toBe(failure);
  });

  it("passes the original commit error to release after rollback", async () => {
    const calls: string[] = [];
    const failure = new Error("commit failure");
    let releaseError: Error | undefined;
    const pool: QueryPool = {
      async query() {
        throw new Error("pool.query must not be used for a transaction");
      },
      async connect() {
        return {
          async query(text) {
            calls.push(text);
            if (text === "COMMIT") throw failure;
            return text === ATOMIC_FUNCTION_QUERY
              ? result("inserted")
              : { rows: [] };
          },
          release(error?: Error) {
            releaseError = error;
          },
        };
      },
    };

    await expect(
      createPostgresAtomicPersistence(pool).persist(input),
    ).rejects.toBe(failure);
    expect(calls).toEqual([
      "BEGIN",
      ATOMIC_FUNCTION_QUERY,
      "COMMIT",
      "ROLLBACK",
    ]);
    expect(releaseError).toBe(failure);
  });
});
