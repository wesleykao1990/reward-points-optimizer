#!/usr/bin/env node

const DEFAULT_BASE_URL =
  "https://reward-points-optimizer-consumer-al.vercel.app";
const baseUrl = (process.env.JRO_CONSUMER_BASE_URL ?? DEFAULT_BASE_URL).replace(
  /\/+$/u,
  "",
);
const maxAttempts = positiveInteger(
  process.env.JRO_PRODUCTION_SMOKE_ATTEMPTS,
  12,
);
const retryDelayMs = positiveInteger(
  process.env.JRO_PRODUCTION_SMOKE_RETRY_MS,
  10_000,
);

await main();

function positiveInteger(value, fallback) {
  if (value === undefined) return fallback;
  if (!/^[1-9][0-9]*$/u.test(value))
    throw new Error("production_smoke_integer_invalid");
  return Number(value);
}

function record(value, code) {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error(code);
  return value;
}

function nonEmptyArray(value, code) {
  if (!Array.isArray(value) || value.length === 0) throw new Error(code);
  return value;
}

async function fetchJson(pathname) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok)
    throw new Error(`production_smoke_http_${response.status}:${pathname}`);
  return record(await response.json(), "production_smoke_json_invalid");
}

function verifyOptions(payload) {
  if (payload.data_origin !== "database")
    throw new Error("production_smoke_options_not_database");
  if (!Number.isInteger(payload.rule_count) || payload.rule_count < 1)
    throw new Error("production_smoke_rules_empty");
  nonEmptyArray(payload.assets, "production_smoke_assets_empty");
  const catalogue = nonEmptyArray(
    payload.wallet_catalogue,
    "production_smoke_wallet_catalogue_empty",
  );
  const kinds = new Set(
    catalogue
      .map((item) => record(item, "production_smoke_wallet_item_invalid").kind)
      .filter((kind) => typeof kind === "string"),
  );
  for (const required of ["credit_card", "mobile_pay", "point"])
    if (!kinds.has(required))
      throw new Error(`production_smoke_wallet_kind_missing:${required}`);
  return {
    ruleCount: payload.rule_count,
    assetCount: payload.assets.length,
    walletCount: catalogue.length,
  };
}

function verifyFacts(payload) {
  const facts = nonEmptyArray(payload.facts, "production_smoke_facts_empty");
  return { factCount: facts.length };
}

async function once() {
  const [options, facts] = await Promise.all([
    fetchJson("/api/experimental/point-spend/options"),
    fetchJson("/api/experimental/facts"),
  ]);
  return { ...verifyOptions(options), ...verifyFacts(facts) };
}

async function main() {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await once();
      console.log(
        `Production consumer smoke passed: ${result.ruleCount} rules, ${result.assetCount} assets, ${result.walletCount} wallet choices, ${result.factCount} facts.`,
      );
      return;
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) break;
      console.error(
        `Production consumer smoke attempt ${attempt}/${maxAttempts} failed: ${error instanceof Error ? error.message : "unknown_error"}`,
      );
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
  throw lastError;
}
