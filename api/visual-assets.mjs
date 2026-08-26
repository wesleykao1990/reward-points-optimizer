import { createPublicKey, verify as verifySignature } from "node:crypto";
import { createVisualAssetStore } from "../apps/consumer-alpha/dist/visual-asset-store.js";
import { SUPABASE_PROD_CA_2021 } from "../apps/consumer-alpha/dist/supabase-ca.js";

const EXPECTED_ISSUER = "https://token.actions.githubusercontent.com";
const EXPECTED_AUDIENCE = "poimichi-visual-assets";
const EXPECTED_REPOSITORY = "wesleykao1990/reward-points-optimizer";
const EXPECTED_REF = "refs/heads/main";
const MAX_BODY_BYTES = 5_500_000;

let store;
let oidcConfiguration;
let jwks;
let jwksFetchedAt = 0;

function databaseUrl() {
  return (
    process.env.JRO_DATABASE_URL ??
    process.env.POSTGRES_URL ??
    process.env.POSTGRES_URL_NON_POOLING
  );
}

function visualStore() {
  if (store !== undefined) return store;
  const connectionString = databaseUrl();
  if (!connectionString) throw new Error("jro_database_url_required");
  store = createVisualAssetStore(connectionString, SUPABASE_PROD_CA_2021);
  return store;
}

function sendJson(response, status, value) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.end(JSON.stringify(value));
}

function decodeJsonSegment(value) {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
}

async function oidcConfig() {
  if (oidcConfiguration) return oidcConfiguration;
  const response = await fetch(`${EXPECTED_ISSUER}/.well-known/openid-configuration`, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`oidc_config_http_${response.status}`);
  oidcConfiguration = await response.json();
  return oidcConfiguration;
}

async function githubJwks() {
  if (jwks && Date.now() - jwksFetchedAt < 30 * 60_000) return jwks;
  const configuration = await oidcConfig();
  const response = await fetch(configuration.jwks_uri, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`oidc_jwks_http_${response.status}`);
  jwks = await response.json();
  jwksFetchedAt = Date.now();
  return jwks;
}

function audienceIncludes(payload, expected) {
  return Array.isArray(payload.aud)
    ? payload.aud.includes(expected)
    : payload.aud === expected;
}

async function verifyGithubOidc(request) {
  const authorization = request.headers.authorization ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/iu);
  if (!match) throw new Error("authorization_required");
  const token = match[1];
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("token_invalid");
  const [protectedHeader, payloadSegment, signatureSegment] = parts;
  const header = decodeJsonSegment(protectedHeader);
  const payload = decodeJsonSegment(payloadSegment);
  if (header.alg !== "RS256" || typeof header.kid !== "string")
    throw new Error("token_algorithm_invalid");

  const keys = await githubJwks();
  const jwk = keys.keys?.find((candidate) => candidate.kid === header.kid);
  if (!jwk) throw new Error("token_key_not_found");
  const key = createPublicKey({ key: jwk, format: "jwk" });
  const verified = verifySignature(
    "RSA-SHA256",
    Buffer.from(`${protectedHeader}.${payloadSegment}`),
    key,
    Buffer.from(signatureSegment, "base64url"),
  );
  if (!verified) throw new Error("token_signature_invalid");

  const now = Math.floor(Date.now() / 1000);
  if (payload.iss !== EXPECTED_ISSUER) throw new Error("token_issuer_invalid");
  if (!audienceIncludes(payload, EXPECTED_AUDIENCE))
    throw new Error("token_audience_invalid");
  if (payload.repository !== EXPECTED_REPOSITORY)
    throw new Error("token_repository_invalid");
  if (payload.ref !== EXPECTED_REF) throw new Error("token_ref_invalid");
  if (typeof payload.exp !== "number" || payload.exp < now - 30)
    throw new Error("token_expired");
  if (typeof payload.nbf === "number" && payload.nbf > now + 30)
    throw new Error("token_not_yet_valid");
  return payload;
}

async function readJson(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_BODY_BYTES) throw new Error("request_too_large");
    chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function optionalString(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function requiredString(value, field) {
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`field_required:${field}`);
  return value;
}

function optionalDimension(value) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : null;
}

async function handleOperation(body) {
  const operation = requiredString(body?.operation, "operation");
  const target = visualStore();

  if (operation === "upsert_source") {
    const source = body.source ?? {};
    await target.upsertSource({
      assetId: requiredString(source.asset_id, "source.asset_id"),
      aliasOf: optionalString(source.alias_of),
      sourceSha256: requiredString(source.source_sha256, "source.source_sha256"),
      sourceKind: requiredString(source.source_kind, "source.source_kind"),
      mimeType: requiredString(source.mime_type, "source.mime_type"),
      contentBase64: requiredString(source.content_base64, "source.content_base64"),
      width: optionalDimension(source.width),
      height: optionalDimension(source.height),
      officialPageUrl: optionalString(source.official_page_url),
      officialImageUrl: optionalString(source.official_image_url),
    });
    return { status: "stored", asset_id: source.asset_id, kind: "source" };
  }

  if (operation === "upsert_asset") {
    const asset = body.asset ?? {};
    await target.upsertGenerated({
      assetId: requiredString(asset.asset_id, "asset.asset_id"),
      aliasOf: optionalString(asset.alias_of),
      displayName: requiredString(asset.display_name, "asset.display_name"),
      entityType: requiredString(asset.entity_type, "asset.entity_type"),
      svgText: requiredString(asset.svg_text, "asset.svg_text"),
      svgSha256: requiredString(asset.svg_sha256, "asset.svg_sha256"),
      generationRunId: requiredString(asset.generation_run_id, "asset.generation_run_id"),
      sourceKind: optionalString(asset.source_kind),
      sourcePageUrl: optionalString(asset.source_page_url),
      sourceImageUrl: optionalString(asset.source_image_url),
      sourceSha256: optionalString(asset.source_sha256),
      sourceAssetPath: optionalString(asset.source_asset_path),
      sourceMime: optionalString(asset.source_mime),
      sourceDimensions: asset.source_dimensions ?? null,
    });
    return { status: "stored", asset_id: asset.asset_id, kind: "asset" };
  }

  if (operation === "mark_validation") {
    const assetId = requiredString(body.asset_id, "asset_id");
    const status = requiredString(body.status, "status");
    if (!["valid", "invalid"].includes(status)) throw new Error("validation_status_invalid");
    const errors = Array.isArray(body.errors)
      ? body.errors.filter((value) => typeof value === "string")
      : [];
    await target.markValidation(assetId, status, errors);
    return { status: "updated", asset_id: assetId };
  }

  if (operation === "mark_validation_batch") {
    const records = Array.isArray(body.records) ? body.records : [];
    if (records.length > 40) throw new Error("too_many_validation_records");
    for (const record of records) {
      const assetId = requiredString(record?.asset_id, "records.asset_id");
      const status = requiredString(record?.status, "records.status");
      if (!["valid", "invalid"].includes(status))
        throw new Error("validation_status_invalid");
      const errors = Array.isArray(record?.errors)
        ? record.errors.filter((value) => typeof value === "string")
        : [];
      await target.markValidation(assetId, status, errors);
    }
    return { status: "updated", asset_count: records.length };
  }

  if (operation === "mark_deployed") {
    const assetIds = Array.isArray(body.asset_ids)
      ? body.asset_ids.filter((value) => typeof value === "string" && value.length > 0)
      : [];
    await target.markDeployed(assetIds);
    return { status: "updated", asset_count: assetIds.length };
  }

  if (operation === "get_cache") {
    const assetIds = Array.isArray(body.asset_ids)
      ? body.asset_ids.filter((value) => typeof value === "string" && value.length > 0)
      : [];
    if (assetIds.length > 40) throw new Error("too_many_asset_ids");
    const [assets, sources] = await Promise.all([
      target.getReusable(assetIds),
      target.getSources(assetIds),
    ]);
    return {
      status: "ok",
      assets: [...assets.values()],
      sources: [...sources.values()],
    };
  }

  throw new Error("operation_invalid");
}

export default async function handler(request, response) {
  if ((request.method ?? "").toUpperCase() !== "POST") {
    response.setHeader("Allow", "POST");
    sendJson(response, 405, { error: { code: "method_not_allowed" } });
    return;
  }
  try {
    await verifyGithubOidc(request);
    const body = await readJson(request);
    sendJson(response, 200, await handleOperation(body));
  } catch (error) {
    const code = String(error?.message ?? error);
    const status =
      code === "authorization_required" || code.startsWith("token_") ? 401 :
      code === "request_too_large" ? 413 :
      code.startsWith("field_required:") || code.endsWith("_invalid") ? 400 : 500;
    console.error("visual_asset_cache_error", code);
    sendJson(response, status, { error: { code } });
  }
}
