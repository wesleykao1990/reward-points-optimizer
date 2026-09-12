import assert from "node:assert/strict";
import test from "node:test";
import { recoverSupabaseProject } from "./recover_supabase_project.mjs";
import {
  positiveInteger,
  smokeProduction,
} from "./verify_consumer_production.mjs";

const factsPayload = { facts: [{ fact_key: "fact" }] };
const optionsPayload = {
  data_origin: "database",
  rule_count: 1,
  assets: [{ id: "point" }],
  wallet_catalogue: [
    { kind: "credit_card" },
    { kind: "mobile_pay" },
    { kind: "point" },
  ],
};

test("the smoke retries only the failing path and keeps requests sequential", async () => {
  const calls = [];
  let factAttempts = 0;
  const result = await smokeProduction({
    baseUrl: "https://example.invalid/",
    maxAttempts: 3,
    retryDelayMs: 1,
    sleep: async () => undefined,
    logError: () => undefined,
    request: async (_baseUrl, pathname) => {
      calls.push(pathname);
      if (pathname.endsWith("/facts")) {
        factAttempts += 1;
        if (factAttempts < 3) throw new Error("temporary_failure");
        return factsPayload;
      }
      return optionsPayload;
    },
  });

  assert.deepEqual(calls, [
    "/api/experimental/facts",
    "/api/experimental/facts",
    "/api/experimental/facts",
    "/api/experimental/point-spend/options",
  ]);
  assert.deepEqual(result, {
    ruleCount: 1,
    assetCount: 1,
    walletCount: 3,
    factCount: 1,
  });
});

test("integer configuration remains positive and explicit", () => {
  assert.equal(positiveInteger(undefined, 6), 6);
  assert.equal(positiveInteger("3", 6), 3);
  assert.throws(() => positiveInteger("0", 6), /integer_invalid/u);
});

test("recovery restores an inactive project and waits for health", async () => {
  const calls = [];
  const statuses = ["INACTIVE", "COMING_UP", "ACTIVE_HEALTHY"];
  const result = await recoverSupabaseProject({
    projectRef: "abcdefghijklmnopqrst",
    accessToken: "secret",
    pollAttempts: 2,
    pollDelayMs: 1,
    sleep: async () => undefined,
    request: async (url, init = {}) => {
      calls.push({ url, method: init.method ?? "GET" });
      if (init.method === "POST") return new Response(null, { status: 200 });
      return Response.json({ status: statuses.shift() });
    },
  });

  assert.equal(result.action, "restore");
  assert.equal(result.status, "ACTIVE_HEALTHY");
  assert.equal(calls[1]?.url.endsWith("/restore"), true);
});

test("recovery restarts a project whose control plane still reports healthy", async () => {
  const calls = [];
  const result = await recoverSupabaseProject({
    projectRef: "abcdefghijklmnopqrst",
    accessToken: "secret",
    pollAttempts: 1,
    pollDelayMs: 1,
    sleep: async () => undefined,
    request: async (url, init = {}) => {
      calls.push({ url, method: init.method ?? "GET" });
      if (init.method === "POST") return new Response(null, { status: 200 });
      return Response.json({ status: "ACTIVE_HEALTHY" });
    },
  });

  assert.equal(result.action, "restart");
  assert.equal(calls[1]?.url.endsWith("/restart"), true);
});

test("recovery waits instead of duplicating a transition already underway", async () => {
  const calls = [];
  const statuses = ["COMING_UP", "ACTIVE_HEALTHY"];
  const result = await recoverSupabaseProject({
    projectRef: "abcdefghijklmnopqrst",
    accessToken: "secret",
    pollAttempts: 1,
    pollDelayMs: 1,
    sleep: async () => undefined,
    request: async (url, init = {}) => {
      calls.push({ url, method: init.method ?? "GET" });
      return Response.json({ status: statuses.shift() });
    },
  });

  assert.equal(result.action, "wait");
  assert.equal(calls.some((call) => call.method === "POST"), false);
});
