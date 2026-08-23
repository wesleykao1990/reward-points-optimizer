import { createHash } from "node:crypto";
import type { QueryPool } from "@jro/agent-feed-postgres";
import { Pool } from "pg";
import {
  createPostgresPoolConfig,
  createRoleScopedQueryPool,
} from "./runtime.js";
import { SUPABASE_PROD_CA_2021 } from "./supabase-ca.js";
import { deploymentHosts } from "./vercel-adapter.js";

const DEFAULT_RADIUS_M = 600;
const MAX_RADIUS_M = 1500;
const MAX_LIMIT = 25;
const MAX_BODY_BYTES = 2048;
const MAX_OVERPASS_BYTES = 1_000_000;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_OVERPASS_URL = "https://overpass-api.de/api/interpreter";

const KNOWN_MERCHANT_PATTERNS = Object.freeze([
  {
    merchantKey: "merchant.familymart",
    patterns: [/familymart/iu, /ファミリーマート/u],
  },
  {
    merchantKey: "merchant.lawson",
    patterns: [/lawson/iu, /ローソン/u],
  },
  {
    merchantKey: "merchant.mcdonalds",
    patterns: [/mcdonald/iu, /マクドナルド/u],
  },
  {
    merchantKey: "merchant.newdays",
    patterns: [/newdays/iu, /ニューデイズ/u],
  },
  {
    merchantKey: "merchant.seveneleven",
    patterns: [
      /7[\s\-‐‑–—]?eleven/iu,
      /セブン[\s\-‐‑–—]?イレブン/u,
      /セブンイレブン/u,
    ],
  },
] as const);

const PAYMENT_TAGS: ReadonlyArray<
  Readonly<{
    instrumentKey: string;
    tags: readonly string[];
  }>
> = Object.freeze([
  {
    instrumentKey: "instrument.payment.credit_card_general",
    tags: [
      "payment:credit_cards",
      "payment:visa",
      "payment:mastercard",
      "payment:jcb",
      "payment:american_express",
    ],
  },
  { instrumentKey: "instrument.wallet.paypay", tags: ["payment:paypay"] },
  {
    instrumentKey: "instrument.wallet.rakutenpay",
    tags: ["payment:rakuten_pay"],
  },
  {
    instrumentKey: "instrument.wallet.dbarai",
    tags: ["payment:d_barai", "payment:dbarai"],
  },
  { instrumentKey: "instrument.wallet.aupay", tags: ["payment:au_pay"] },
  { instrumentKey: "instrument.wallet.famipay", tags: ["payment:famipay"] },
  {
    instrumentKey: "instrument.wallet.aeonpay",
    tags: ["payment:aeon_pay"],
  },
  { instrumentKey: "instrument.wallet.merpay", tags: ["payment:merpay"] },
  {
    instrumentKey: "instrument.wallet.jcoinpay",
    tags: ["payment:j_coin_pay", "payment:jcoin_pay"],
  },
  { instrumentKey: "instrument.wallet.alipay", tags: ["payment:alipay"] },
  {
    instrumentKey: "instrument.wallet.wechatpay",
    tags: ["payment:wechat_pay", "payment:wechat"],
  },
  {
    instrumentKey: "instrument.emoney.transit_ic",
    tags: [
      "payment:suica",
      "payment:pasmo",
      "payment:icsf",
      "payment:transit_ic",
    ],
  },
  { instrumentKey: "instrument.emoney.id", tags: ["payment:iD", "payment:id"] },
  {
    instrumentKey: "instrument.emoney.quicpay",
    tags: ["payment:quicpay"],
  },
  {
    instrumentKey: "instrument.emoney.rakuten_edy",
    tags: ["payment:rakuten_edy", "payment:edy"],
  },
  { instrumentKey: "instrument.emoney.waon", tags: ["payment:waon"] },
  { instrumentKey: "instrument.jp.nanaco", tags: ["payment:nanaco"] },
]);

type HeaderValue = string | readonly string[] | undefined;
type DeploymentEnvironment = Readonly<Record<string, string | undefined>>;

export interface NearbyVercelRequest {
  readonly method?: string;
  readonly url?: string;
  readonly headers: Readonly<Record<string, HeaderValue>>;
  readonly body?: unknown;
}

export interface NearbyVercelResponse {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body?: string): void;
}

export interface NearbyVercelAdapterOptions {
  readonly environment?: DeploymentEnvironment;
  readonly fetchFn?: typeof fetch;
}

interface NearbyInput {
  readonly latitude: number;
  readonly longitude: number;
  readonly radiusM: number;
  readonly limit: number;
}

interface NearbyLocationRow {
  readonly location_key: string;
  readonly merchant_key: string;
  readonly merchant_name: string;
  readonly location_name: string;
  readonly address: unknown;
  readonly latitude: string | number | null;
  readonly longitude: string | number | null;
  readonly external_place_ids: unknown;
  readonly confidence: string;
}

interface PrewarmCandidateRow {
  readonly location_key: string;
  readonly merchant_key: string;
  readonly location_name: string;
  readonly address: unknown;
}

interface AcceptanceRow {
  readonly location_key: string;
  readonly instrument_key: string;
  readonly instrument_name: string;
  readonly action: string;
  readonly acceptance_state: string;
  readonly confidence: string | number;
  readonly inherited_from_chain: boolean;
  readonly source_checked_at: string | Date;
}

interface OverpassElement {
  readonly type?: unknown;
  readonly id?: unknown;
  readonly lat?: unknown;
  readonly lon?: unknown;
  readonly center?: unknown;
  readonly tags?: unknown;
}

interface NormalizedPayment {
  readonly instrument_key: string;
  readonly state: "yes" | "no";
}

export interface NormalizedOsmPlace {
  readonly osm_id: string;
  readonly name: string;
  readonly merchant_key?: string;
  readonly location_key?: string;
  readonly lat: number;
  readonly lon: number;
  readonly address: Readonly<Record<string, string>>;
  readonly payments: readonly NormalizedPayment[];
}

interface BrowserAcceptance {
  readonly instrument_key: string;
  readonly instrument_name: string;
  readonly action: "pay" | "earn" | "redeem";
  readonly state: "yes" | "no" | "unknown" | "conflicting";
  readonly confidence: number;
  readonly inherited_from_chain: boolean;
  readonly checked_at: string;
}

interface BrowserLocation {
  readonly location_key: string;
  readonly merchant_key: string;
  readonly merchant_name: string;
  readonly location_name: string;
  readonly address: Readonly<Record<string, string>>;
  readonly latitude: number;
  readonly longitude: number;
  readonly distance_m: number;
  readonly location_confidence: string;
  readonly accepted: readonly BrowserAcceptance[];
}

class NearbyRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

function singleHeader(value: HeaderValue): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string")
    throw new NearbyRequestError(400, "header_ambiguous");
  return value;
}

function validDeploymentHost(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 253 &&
    /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/u.test(value) &&
    !value.includes("..")
  );
}

function validateAuthority(
  request: NearbyVercelRequest,
  allowedHosts: ReadonlySet<string>,
): void {
  const host = (
    singleHeader(request.headers["x-forwarded-host"]) ??
    singleHeader(request.headers.host) ??
    ""
  ).toLocaleLowerCase("en-US");
  const protocol = (
    singleHeader(request.headers["x-forwarded-proto"]) ?? ""
  ).toLocaleLowerCase("en-US");
  if (!validDeploymentHost(host) || !allowedHosts.has(host))
    throw new NearbyRequestError(400, "host_invalid");
  if (protocol !== "https")
    throw new NearbyRequestError(400, "protocol_invalid");
  const origin = singleHeader(request.headers.origin);
  if (origin === undefined) return;
  try {
    const parsed = new URL(origin);
    if (parsed.origin !== `https://${host}`) throw new Error("origin_mismatch");
  } catch {
    throw new NearbyRequestError(403, "origin_invalid");
  }
}

function responseHeaders(): Readonly<Record<string, string>> {
  return Object.freeze({
    "Content-Type": "application/json; charset=utf-8",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(self)",
    "Cache-Control": "no-store",
  });
}

function sendJson(
  response: NearbyVercelResponse,
  status: number,
  body: Readonly<Record<string, unknown>>,
): void {
  response.statusCode = status;
  for (const [name, value] of Object.entries(responseHeaders()))
    response.setHeader(name, value);
  response.end(JSON.stringify(body));
}

function sendError(
  response: NearbyVercelResponse,
  error: NearbyRequestError,
): void {
  sendJson(response, error.status, {
    error: {
      code: error.code,
      message: "Request could not be processed.",
    },
  });
}

function parseBody(request: NearbyVercelRequest): NearbyInput {
  if ((request.method ?? "").toUpperCase() !== "POST")
    throw new NearbyRequestError(405, "method_not_allowed");
  const contentType = singleHeader(request.headers["content-type"]);
  if (!contentType || !/^application\/json(?:\s*;|$)/iu.test(contentType))
    throw new NearbyRequestError(415, "json_content_type_required");
  const raw =
    typeof request.body === "string"
      ? request.body
      : Buffer.isBuffer(request.body)
        ? request.body.toString("utf8")
        : JSON.stringify(request.body ?? null);
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES)
    throw new NearbyRequestError(413, "request_body_too_large");
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new NearbyRequestError(400, "json_invalid");
  }
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new NearbyRequestError(400, "nearby_input_invalid");
  const record = value as Record<string, unknown>;
  const latitude = record.latitude;
  const longitude = record.longitude;
  const radius = record.radius_m ?? DEFAULT_RADIUS_M;
  const limit = record.limit ?? 15;
  if (
    typeof latitude !== "number" ||
    !Number.isFinite(latitude) ||
    latitude < 20 ||
    latitude > 46 ||
    typeof longitude !== "number" ||
    !Number.isFinite(longitude) ||
    longitude < 122 ||
    longitude > 154
  )
    throw new NearbyRequestError(400, "nearby_coordinate_invalid");
  if (
    !Number.isSafeInteger(radius) ||
    (radius as number) < 100 ||
    (radius as number) > MAX_RADIUS_M
  )
    throw new NearbyRequestError(400, "nearby_radius_invalid");
  if (
    !Number.isSafeInteger(limit) ||
    (limit as number) < 1 ||
    (limit as number) > MAX_LIMIT
  )
    throw new NearbyRequestError(400, "nearby_limit_invalid");
  return Object.freeze({
    latitude,
    longitude,
    radiusM: radius as number,
    limit: limit as number,
  });
}

function cleanText(value: unknown, maximum = 160): string {
  if (typeof value !== "string") return "";
  return [...value]
    .filter((character) => {
      const code = character.codePointAt(0);
      return code !== undefined && code >= 0x20 && code !== 0x7f;
    })
    .join("")
    .trim()
    .slice(0, maximum);
}

function finiteNumber(value: unknown): number | null {
  const number =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : NaN;
  return Number.isFinite(number) ? number : null;
}

function cleanRecord(value: unknown): Readonly<Record<string, string>> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return Object.freeze({});
  const output: Record<string, string> = {};
  for (const key of [
    "postal_code",
    "prefecture",
    "city",
    "ward",
    "street",
    "site_detail",
    "station",
    "country_code",
  ]) {
    const item = cleanText((value as Record<string, unknown>)[key], 120);
    if (item) output[key] = item;
  }
  return Object.freeze(output);
}

function normalizeLabel(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ja-JP")
    .replace(/familymart|ファミリーマート/giu, "")
    .replace(/lawson|ローソン/giu, "")
    .replace(/mcdonald'?s?|マクドナルド/giu, "")
    .replace(/newdays|ニューデイズ/giu, "")
    .replace(
      /7[\s\-‐‑–—]?eleven|セブン[\s\-‐‑–—]?イレブン|セブンイレブン/giu,
      "",
    )
    .replace(/[\s\-‐‑–—・･_()（）]/gu, "")
    .replace(/店$/u, "");
}

function merchantKeyFor(
  tags: Readonly<Record<string, string>>,
  name: string,
): string | undefined {
  const identity = [name, tags.brand ?? "", tags.operator ?? ""].join(" ");
  for (const item of KNOWN_MERCHANT_PATTERNS) {
    if (item.patterns.some((pattern) => pattern.test(identity)))
      return item.merchantKey;
  }
  return undefined;
}

function normalizedPaymentState(
  values: readonly string[],
): "yes" | "no" | undefined {
  const normalized = values.map((value) => value.toLocaleLowerCase("en-US"));
  if (normalized.some((value) => value === "yes" || value === "only"))
    return "yes";
  if (normalized.length > 0 && normalized.every((value) => value === "no"))
    return "no";
  return undefined;
}

function paymentsFor(
  tags: Readonly<Record<string, string>>,
): readonly NormalizedPayment[] {
  const output: NormalizedPayment[] = [];
  for (const mapping of PAYMENT_TAGS) {
    const values = mapping.tags.flatMap((tag) => {
      const value = tags[tag];
      return value === undefined ? [] : [value];
    });
    const state = normalizedPaymentState(values);
    if (state)
      output.push(
        Object.freeze({ instrument_key: mapping.instrumentKey, state }),
      );
  }
  return Object.freeze(output);
}

function coordinatesFor(
  element: OverpassElement,
): { latitude: number; longitude: number } | null {
  const directLatitude = finiteNumber(element.lat);
  const directLongitude = finiteNumber(element.lon);
  if (directLatitude !== null && directLongitude !== null)
    return { latitude: directLatitude, longitude: directLongitude };
  if (
    element.center &&
    typeof element.center === "object" &&
    !Array.isArray(element.center)
  ) {
    const center = element.center as Record<string, unknown>;
    const latitude = finiteNumber(center.lat);
    const longitude = finiteNumber(center.lon);
    if (latitude !== null && longitude !== null) return { latitude, longitude };
  }
  return null;
}

function tagsFor(value: unknown): Readonly<Record<string, string>> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return Object.freeze({});
  const tags: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === "string" && key.length <= 80 && raw.length <= 500)
      tags[key] = raw;
  }
  return Object.freeze(tags);
}

function addressFor(
  tags: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  const address: Record<string, string> = {};
  const assign = (key: string, value: string | undefined) => {
    const cleaned = cleanText(value, 120);
    if (cleaned) address[key] = cleaned;
  };
  assign("postal_code", tags["addr:postcode"]);
  assign("prefecture", tags["addr:province"] ?? tags["addr:state"]);
  assign("city", tags["addr:city"]);
  assign("ward", tags["addr:ward"]);
  const street = [tags["addr:street"], tags["addr:housenumber"]]
    .filter(
      (item): item is string => typeof item === "string" && item.length > 0,
    )
    .join(" ");
  assign("street", street);
  if (Object.keys(address).length > 0) address.country_code = "JP";
  return Object.freeze(address);
}

function matchPrewarmLocation(
  merchantKey: string | undefined,
  name: string,
  candidates: readonly PrewarmCandidateRow[],
): string | undefined {
  if (!merchantKey) return undefined;
  const normalized = normalizeLabel(name);
  if (normalized.length < 2) return undefined;
  const exact = candidates.filter(
    (candidate) =>
      candidate.merchant_key === merchantKey &&
      normalizeLabel(candidate.location_name) === normalized,
  );
  return exact.length === 1 ? exact[0]?.location_key : undefined;
}

export function normalizeOverpassResponse(
  value: unknown,
  candidates: readonly PrewarmCandidateRow[] = [],
): readonly NormalizedOsmPlace[] {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new NearbyRequestError(502, "osm_response_invalid");
  const elements = (value as Record<string, unknown>).elements;
  if (!Array.isArray(elements) || elements.length > 1000)
    throw new NearbyRequestError(502, "osm_response_invalid");
  const output: NormalizedOsmPlace[] = [];
  const seen = new Set<string>();
  for (const raw of elements) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) continue;
    const element = raw as OverpassElement;
    const type = element.type;
    const id = element.id;
    if (
      (type !== "node" && type !== "way" && type !== "relation") ||
      !Number.isSafeInteger(id)
    )
      continue;
    const coordinates = coordinatesFor(element);
    if (
      !coordinates ||
      coordinates.latitude < 20 ||
      coordinates.latitude > 46 ||
      coordinates.longitude < 122 ||
      coordinates.longitude > 154
    )
      continue;
    const tags = tagsFor(element.tags);
    const name = cleanText(
      tags["name:ja"] ?? tags.name ?? tags.brand ?? tags.operator,
      160,
    );
    if (!name) continue;
    const osmId = `${type}/${String(id)}`;
    if (seen.has(osmId)) continue;
    seen.add(osmId);
    const merchantKey = merchantKeyFor(tags, name);
    const matchedLocation = matchPrewarmLocation(merchantKey, name, candidates);
    output.push(
      Object.freeze({
        osm_id: osmId,
        name,
        ...(merchantKey ? { merchant_key: merchantKey } : {}),
        ...(matchedLocation ? { location_key: matchedLocation } : {}),
        lat: coordinates.latitude,
        lon: coordinates.longitude,
        address: addressFor(tags),
        payments: paymentsFor(tags),
      }),
    );
    if (output.length >= 80) break;
  }
  return Object.freeze(output);
}

export function buildOverpassQuery(input: NearbyInput): string {
  const latitude = input.latitude.toFixed(6);
  const longitude = input.longitude.toFixed(6);
  return `[out:json][timeout:8][maxsize:8388608];\n(\n  nwr(around:${input.radiusM},${latitude},${longitude})["name"]["shop"];\n  nwr(around:${input.radiusM},${latitude},${longitude})["name"]["amenity"~"^(restaurant|cafe|fast_food|fuel|pharmacy|bar|pub)$"];\n);\nout center tags 80;`;
}

function geoCell(input: NearbyInput): string {
  const source = `${input.latitude.toFixed(3)},${input.longitude.toFixed(3)}`;
  return `g3_${createHash("sha256").update(source, "utf8").digest("hex").slice(0, 16)}`;
}

function haversineMeters(
  latitude1: number,
  longitude1: number,
  latitude2: number,
  longitude2: number,
): number {
  const radius = 6_371_000;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRadians(latitude2 - latitude1);
  const dLon = toRadians(longitude2 - longitude1);
  const lat1 = toRadians(latitude1);
  const lat2 = toRadians(latitude2);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function loadPrewarmCandidates(
  target: QueryPool,
): Promise<readonly PrewarmCandidateRow[]> {
  const result = await target.query<PrewarmCandidateRow>(
    `select location_key, merchant_key, location_name, address\n       from app_api.merchant_nearby_locations\n      where latitude is null\n        and metadata ? 'launch_area'\n      order by location_key\n      limit 100`,
  );
  return Object.freeze(result.rows);
}

async function cacheIsCurrent(
  target: QueryPool,
  cell: string,
  radiusM: number,
): Promise<boolean> {
  const result = await target.query<{ readonly cache_key: string }>(
    `select cache_key\n       from app_api.geo_query_cache_current\n      where provider = 'osm_overpass'\n        and geo_cell = $1\n        and query_radius_m = $2\n      limit 1`,
    [cell, radiusM],
  );
  return result.rows.length === 1;
}

async function discoverFromOverpass(
  input: NearbyInput,
  candidates: readonly PrewarmCandidateRow[],
  environment: DeploymentEnvironment,
  fetchFn: typeof fetch,
): Promise<readonly NormalizedOsmPlace[]> {
  if (environment.JRO_ENABLE_OSM_DISCOVERY !== "true") return Object.freeze([]);
  const configured = environment.JRO_OSM_OVERPASS_URL ?? DEFAULT_OVERPASS_URL;
  let endpoint: URL;
  try {
    endpoint = new URL(configured);
    if (
      endpoint.protocol !== "https:" ||
      endpoint.username !== "" ||
      endpoint.password !== "" ||
      endpoint.search !== "" ||
      endpoint.hash !== ""
    )
      throw new Error("endpoint_invalid");
  } catch {
    throw new NearbyRequestError(503, "osm_endpoint_invalid");
  }
  const query = buildOverpassQuery(input);
  let response: Response;
  try {
    response = await fetchFn(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "User-Agent": "reward-points-optimizer/0.4.1 nearby-discovery",
      },
      body: `data=${encodeURIComponent(query)}`,
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    throw new NearbyRequestError(503, "osm_unavailable");
  }
  if (response.status === 429)
    throw new NearbyRequestError(503, "osm_rate_limited");
  if (!response.ok) throw new NearbyRequestError(503, "osm_unavailable");
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_OVERPASS_BYTES)
    throw new NearbyRequestError(502, "osm_response_too_large");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new NearbyRequestError(502, "osm_response_invalid");
  }
  return normalizeOverpassResponse(value, candidates);
}

async function ingestOsm(
  target: QueryPool,
  input: NearbyInput,
  cell: string,
  places: readonly NormalizedOsmPlace[],
): Promise<void> {
  const fetchedAt = new Date();
  const expiresAt = new Date(fetchedAt.getTime() + CACHE_TTL_MS);
  await target.query(
    `select app_private.ingest_osm_nearby_snapshot(\n       $1::text, $2::integer, $3::timestamptz, $4::timestamptz, $5::jsonb\n     ) as result`,
    [
      cell,
      input.radiusM,
      fetchedAt.toISOString(),
      expiresAt.toISOString(),
      JSON.stringify(places),
    ],
  );
}

async function loadNearbyLocations(
  target: QueryPool,
  input: NearbyInput,
): Promise<readonly BrowserLocation[]> {
  const latitudeDelta = input.radiusM / 110_540;
  const longitudeScale = Math.max(
    0.2,
    Math.cos((input.latitude * Math.PI) / 180),
  );
  const longitudeDelta = input.radiusM / (111_320 * longitudeScale);
  const result = await target.query<NearbyLocationRow>(
    `select location_key, merchant_key, merchant_name, location_name, address,\n            latitude, longitude, external_place_ids, confidence\n       from app_api.merchant_nearby_locations\n      where latitude between $1 and $2\n        and longitude between $3 and $4\n      limit 160`,
    [
      input.latitude - latitudeDelta,
      input.latitude + latitudeDelta,
      input.longitude - longitudeDelta,
      input.longitude + longitudeDelta,
    ],
  );
  const candidates = result.rows.flatMap((row) => {
    const latitude = finiteNumber(row.latitude);
    const longitude = finiteNumber(row.longitude);
    if (latitude === null || longitude === null) return [];
    const distance = haversineMeters(
      input.latitude,
      input.longitude,
      latitude,
      longitude,
    );
    if (distance > input.radiusM) return [];
    return [{ row, latitude, longitude, distance }];
  });
  candidates.sort((left, right) => left.distance - right.distance);
  const selected = candidates.slice(0, input.limit);
  if (selected.length === 0) return Object.freeze([]);
  const locationKeys = selected.map((item) => item.row.location_key);
  const acceptanceResult = await target.query<AcceptanceRow>(
    `select location_key, instrument_key, instrument_name, action, acceptance_state,\n            confidence, inherited_from_chain, source_checked_at\n       from app_api.merchant_acceptance_resolved\n      where location_key = any($1::text[])\n      order by location_key, action, instrument_name`,
    [locationKeys],
  );
  const acceptanceByLocation = new Map<string, BrowserAcceptance[]>();
  for (const row of acceptanceResult.rows) {
    if (
      row.action !== "pay" &&
      row.action !== "earn" &&
      row.action !== "redeem"
    )
      continue;
    if (
      row.acceptance_state !== "yes" &&
      row.acceptance_state !== "no" &&
      row.acceptance_state !== "unknown" &&
      row.acceptance_state !== "conflicting"
    )
      continue;
    const confidence = finiteNumber(row.confidence);
    if (confidence === null) continue;
    const checkedAt =
      row.source_checked_at instanceof Date
        ? row.source_checked_at.toISOString()
        : new Date(row.source_checked_at).toISOString();
    const items = acceptanceByLocation.get(row.location_key) ?? [];
    items.push(
      Object.freeze({
        instrument_key: cleanText(row.instrument_key, 120),
        instrument_name: cleanText(row.instrument_name, 120),
        action: row.action,
        state: row.acceptance_state,
        confidence: Math.max(0, Math.min(1, confidence)),
        inherited_from_chain: row.inherited_from_chain === true,
        checked_at: checkedAt,
      }),
    );
    acceptanceByLocation.set(row.location_key, items);
  }
  return Object.freeze(
    selected.map(({ row, latitude, longitude, distance }) =>
      Object.freeze({
        location_key: cleanText(row.location_key, 200),
        merchant_key: cleanText(row.merchant_key, 160),
        merchant_name: cleanText(row.merchant_name, 160),
        location_name: cleanText(row.location_name, 160),
        address: cleanRecord(row.address),
        latitude,
        longitude,
        distance_m: Math.round(distance),
        location_confidence: cleanText(row.confidence, 40),
        accepted: Object.freeze(
          acceptanceByLocation.get(row.location_key) ?? [],
        ),
      }),
    ),
  );
}

function databaseUrl(environment: DeploymentEnvironment): string {
  const value =
    environment.JRO_DATABASE_URL ??
    environment.POSTGRES_URL ??
    environment.POSTGRES_URL_NON_POOLING;
  if (!value) throw new NearbyRequestError(503, "database_not_configured");
  return value;
}

export function createNearbyVercelRequestHandler(
  options: NearbyVercelAdapterOptions = {},
): (
  request: NearbyVercelRequest,
  response: NearbyVercelResponse,
) => Promise<void> {
  const environment = options.environment ?? process.env;
  const fetchFn = options.fetchFn ?? fetch;
  let allowedHosts: ReadonlySet<string> | undefined;
  let pool: Pool | undefined;
  let target: QueryPool | undefined;

  const queryTarget = (): QueryPool => {
    if (target) return target;
    pool = new Pool(
      createPostgresPoolConfig(databaseUrl(environment), {
        databaseRole: "jro_runtime",
        poolMax: 1,
        sslRootCertificate: SUPABASE_PROD_CA_2021,
      }),
    );
    target = createRoleScopedQueryPool(
      pool as unknown as QueryPool,
      "jro_runtime",
    );
    return target;
  };

  return async (request, response) => {
    try {
      allowedHosts ??= deploymentHosts(environment);
      validateAuthority(request, allowedHosts);
      const input = parseBody(request);
      const target = queryTarget();
      const cell = geoCell(input);
      let cacheStatus: "hit" | "miss" | "disabled" | "degraded" =
        environment.JRO_ENABLE_OSM_DISCOVERY === "true" ? "miss" : "disabled";
      let discoveredCount = 0;
      const cacheHit = await cacheIsCurrent(target, cell, input.radiusM);
      if (cacheHit) {
        cacheStatus = "hit";
      } else if (environment.JRO_ENABLE_OSM_DISCOVERY === "true") {
        try {
          const prewarm = await loadPrewarmCandidates(target);
          const places = await discoverFromOverpass(
            input,
            prewarm,
            environment,
            fetchFn,
          );
          discoveredCount = places.length;
          await ingestOsm(target, input, cell, places);
          cacheStatus = "miss";
        } catch (error) {
          cacheStatus = "degraded";
          if (!(error instanceof NearbyRequestError)) throw error;
        }
      }
      const locations = await loadNearbyLocations(target, input);
      sendJson(response, 200, {
        version: "nearby-merchants.v1",
        radius_m: input.radiusM,
        result_count: locations.length,
        locations,
        discovery: {
          provider: "openstreetmap_overpass",
          cache_status: cacheStatus,
          discovered_count: discoveredCount,
          enabled: environment.JRO_ENABLE_OSM_DISCOVERY === "true",
        },
        attribution: {
          text: "© OpenStreetMap contributors",
          license: "ODbL-1.0",
        },
        privacy: {
          request_coordinate_persisted: false,
          user_identity_persisted: false,
        },
      });
    } catch (error) {
      if (error instanceof NearbyRequestError) {
        if (error.status === 405) response.setHeader("Allow", "POST");
        sendError(response, error);
        return;
      }
      sendError(response, new NearbyRequestError(503, "nearby_unavailable"));
    }
  };
}
