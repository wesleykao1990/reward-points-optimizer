import { Pool } from "pg";
import {
  createNearbyVercelRequestHandler,
} from "../apps/consumer-alpha/dist/nearby-vercel-adapter.js";
import {
  buildNearbyPurchaseAdvice,
  parseNearbyPurchasePreferences,
} from "../apps/consumer-alpha/dist/nearby-purchase-advice.js";
import {
  createPostgresPoolConfig,
  createRoleScopedQueryPool,
} from "../apps/consumer-alpha/dist/runtime.js";
import { SUPABASE_PROD_CA_2021 } from "../apps/consumer-alpha/dist/supabase-ca.js";

const nearbyHandler = createNearbyVercelRequestHandler({
  environment: process.env,
});

function databaseUrl() {
  return (
    process.env.JRO_DATABASE_URL ??
    process.env.POSTGRES_URL ??
    process.env.POSTGRES_URL_NON_POOLING
  );
}

function requestRecord(request) {
  const value = request.body;
  if (value !== null && typeof value === "object" && !Buffer.isBuffer(value))
    return value;
  const text =
    typeof value === "string"
      ? value
      : Buffer.isBuffer(value)
        ? value.toString("utf8")
        : "{}";
  try {
    const parsed = JSON.parse(text);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

function send(response, status, headers, body) {
  response.statusCode = status;
  for (const [name, value] of Object.entries(headers))
    response.setHeader(name, value);
  response.end(body);
}

export default async function handler(request, response) {
  let capturedStatus = 500;
  const capturedHeaders = {};
  let capturedBody = "";
  const capture = {
    get statusCode() {
      return capturedStatus;
    },
    set statusCode(value) {
      capturedStatus = value;
    },
    setHeader(name, value) {
      capturedHeaders[String(name)] = String(value);
    },
    end(body) {
      capturedBody = body == null ? "" : String(body);
    },
  };

  await nearbyHandler(request, capture);
  if (capturedStatus !== 200) {
    send(response, capturedStatus, capturedHeaders, capturedBody);
    return;
  }

  let payload;
  try {
    payload = JSON.parse(capturedBody);
  } catch {
    send(response, 503, capturedHeaders, JSON.stringify({
      error: { code: "nearby_composition_invalid", message: "Request could not be processed." },
    }));
    return;
  }

  let preferences;
  try {
    preferences = parseNearbyPurchasePreferences(requestRecord(request));
  } catch (error) {
    send(response, 400, capturedHeaders, JSON.stringify({
      error: {
        code: error instanceof Error ? error.message : "nearby_purchase_preferences_invalid",
        message: "Request could not be processed.",
      },
    }));
    return;
  }

  const locations = Array.isArray(payload.locations) ? payload.locations : [];
  const connectionString = databaseUrl();
  if (!connectionString) {
    send(response, 503, capturedHeaders, JSON.stringify({
      error: { code: "database_not_configured", message: "Request could not be processed." },
    }));
    return;
  }

  const pool = new Pool(
    createPostgresPoolConfig(connectionString, {
      databaseRole: "jro_runtime",
      poolMax: 1,
      sslRootCertificate: SUPABASE_PROD_CA_2021,
    }),
  );
  try {
    const target = createRoleScopedQueryPool(pool, "jro_runtime");
    const advice = await buildNearbyPurchaseAdvice(target, preferences, locations);
    payload.locations = locations.map((location) => ({
      ...location,
      purchase_advice: advice.get(location.location_key) ?? null,
    }));
    payload.purchase_advice = {
      wallet_family_count: preferences.walletFamilyIds.length,
      amount_jpy: preferences.amountJpy,
      acceptance_filter_applied: true,
      reward_scope: "chain_economics_with_branch_acceptance_overrides",
    };
    send(response, 200, capturedHeaders, JSON.stringify(payload));
  } catch {
    send(response, 503, capturedHeaders, JSON.stringify({
      error: { code: "nearby_purchase_advice_unavailable", message: "Request could not be processed." },
    }));
  } finally {
    await pool.end();
  }
}
