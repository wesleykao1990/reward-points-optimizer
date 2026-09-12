#!/usr/bin/env node

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_BASE_URL =
  "https://reward-points-optimizer-consumer-al.vercel.app";

export function positiveInteger(value, fallback) {
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

export async function fetchJson(baseUrl, pathname, fetchImplementation = fetch) {
  const response = await fetchImplementation(`${baseUrl}${pathname}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok)
    throw new Error(`production_smoke_http_${response.status}:${pathname}`);
  return record(await response.json(), "production_smoke_json_invalid");
}

export function verifyOptions(payload) {
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

export function verifyFacts(payload) {
  const facts = nonEmptyArray(payload.facts, "production_smoke_facts_empty");
  return { factCount: facts.length };
}

async function retryTarget(target, options) {
  let lastError;
  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    try {
      return target.verify(
        await options.request(options.baseUrl, target.pathname),
      );
    } catch (error) {
      lastError = error;
      if (attempt === options.maxAttempts) break;
      options.logError(
        `Production consumer smoke ${target.label} attempt ${attempt}/${options.maxAttempts} failed: ${error instanceof Error ? error.message : "unknown_error"}`,
      );
      await options.sleep(options.retryDelayMs);
    }
  }
  throw lastError;
}

export async function smokeProduction(options = {}) {
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/u, "");
  const maxAttempts = options.maxAttempts ?? 6;
  const retryDelayMs = options.retryDelayMs ?? 15_000;
  const request = options.request ?? fetchJson;
  const sleep = options.sleep ?? ((milliseconds) =>
    new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds)));
  const logError = options.logError ?? console.error;
  const retryOptions = {
    baseUrl,
    maxAttempts,
    retryDelayMs,
    request,
    sleep,
    logError,
  };

  // Keep the heavier paths sequential and retain a successful result instead
  // of rerunning it when the other path is temporarily unavailable.
  const facts = await retryTarget(
    {
      label: "facts",
      pathname: "/api/experimental/facts",
      verify: verifyFacts,
    },
    retryOptions,
  );
  const optionsResult = await retryTarget(
    {
      label: "options",
      pathname: "/api/experimental/point-spend/options",
      verify: verifyOptions,
    },
    retryOptions,
  );
  return { ...optionsResult, ...facts };
}

async function main() {
  const result = await smokeProduction({
    baseUrl: process.env.JRO_CONSUMER_BASE_URL ?? DEFAULT_BASE_URL,
    maxAttempts: positiveInteger(
      process.env.JRO_PRODUCTION_SMOKE_ATTEMPTS,
      6,
    ),
    retryDelayMs: positiveInteger(
      process.env.JRO_PRODUCTION_SMOKE_RETRY_MS,
      15_000,
    ),
  });
  console.log(
    `Production consumer smoke passed: ${result.ruleCount} rules, ${result.assetCount} assets, ${result.walletCount} wallet choices, ${result.factCount} facts.`,
  );
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await main();
