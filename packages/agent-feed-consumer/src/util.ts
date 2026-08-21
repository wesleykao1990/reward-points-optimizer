import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | { [key: string]: JsonValue }
  | JsonValue[];

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isPlainRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}

/** Canonical JSON used for semantic identity. Arrays preserve order. */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value))
        throw new TypeError("json_non_finite_number");
      return JSON.stringify(value);
    case "undefined":
      throw new TypeError("json_undefined");
    case "bigint":
      throw new TypeError("json_bigint");
    case "function":
    case "symbol":
      throw new TypeError("json_unsupported_value");
    default:
      break;
  }
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (!isPlainRecord(value)) throw new TypeError("json_non_plain_object");
  return `{${Object.entries(value)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
    .join(",")}}`;
}

export function sha256Hex(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function prefixedSha256(value: string | Uint8Array): string {
  return `sha256:${sha256Hex(value)}`;
}

export function hmacSha256(
  value: Uint8Array,
  secret: string | Uint8Array,
): Uint8Array {
  return createHmac("sha256", secret).update(value).digest();
}

export function constantTimeHexEquals(
  expected: Uint8Array,
  presentedHex: string,
): boolean {
  const candidate = /^[0-9a-f]{64}$/iu.test(presentedHex)
    ? Buffer.from(presentedHex, "hex")
    : Buffer.alloc(expected.byteLength);
  const sameLength = expected.byteLength === candidate.byteLength;
  const equal = timingSafeEqual(Buffer.from(expected), Buffer.from(candidate));
  return sameLength && equal && /^[0-9a-f]{64}$/iu.test(presentedHex);
}

export function utf8(value: string | Uint8Array): Uint8Array {
  return typeof value === "string"
    ? Buffer.from(value, "utf8")
    : new Uint8Array(value);
}

export function trimCollapse(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ");
}

export function normalizeText(value: string): string {
  return trimCollapse(value).toLocaleLowerCase("en-US");
}

export function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
}

export function isoDate(value: Date | string | number): string {
  const date =
    value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime()))
    throw new TypeError("invalid_received_at");
  return date.toISOString();
}

export function unixSeconds(value: Date | string | number): number {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime()))
    throw new TypeError("invalid_received_at");
  return Math.floor(date.getTime() / 1000);
}

export function parseJsonObject(raw: Uint8Array): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw).toString("utf8")) as unknown;
  } catch {
    throw new TypeError("invalid_event_json");
  }
  if (!isRecord(parsed)) throw new TypeError("invalid_event_body");
  return parsed;
}

export function headerValue(
  headers: import("./types.js").HeadersLike,
  name: string,
): string | undefined {
  const target = name.toLowerCase();
  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    return headers.get(name) ?? undefined;
  }
  if (
    isRecord(headers) &&
    typeof (headers as { get?: unknown }).get === "function"
  ) {
    const value = (
      headers as unknown as { get(name: string): string | null }
    ).get(name);
    return value === null ? undefined : value;
  }
  if (isRecord(headers)) {
    const found = Object.entries(headers).find(
      ([key]) => key.toLowerCase() === target,
    )?.[1];
    if (Array.isArray(found)) return found[0];
    return typeof found === "string" ? found : undefined;
  }
  for (const [key, value] of headers) {
    if (key.toLowerCase() === target) return value;
  }
  return undefined;
}

export function hasExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(value);
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    keys.every((key) => allowed.has(key))
  );
}

export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const REDACT_KEY =
  /(authorization|cookie|password|passwd|secret|token|credential|api[_-]?key|private[_-]?key|pan|cvv|cvc|pin)/iu;
const MAX_REDACTED_STRING = 2000;
const MAX_REDACTED_ARRAY = 100;

/** Redacts sensitive diagnostics without retaining producer secrets. */
export function redactForDiagnostics(value: unknown, depth = 0): unknown {
  if (depth > 12) return "[REDACTED_DEPTH]";
  if (typeof value === "string") {
    return value.length > MAX_REDACTED_STRING
      ? `${value.slice(0, MAX_REDACTED_STRING)}…[TRUNCATED]`
      : value;
  }
  if (value === null || typeof value === "number" || typeof value === "boolean")
    return value;
  if (Array.isArray(value))
    return value
      .slice(0, MAX_REDACTED_ARRAY)
      .map((item) => redactForDiagnostics(item, depth + 1));
  if (!isRecord(value)) return "[REDACTED_VALUE]";
  const result: Record<string, unknown> = Object.create(null) as Record<
    string,
    unknown
  >;
  for (const [key, child] of Object.entries(value)) {
    result[key] = REDACT_KEY.test(key)
      ? "[REDACTED]"
      : redactForDiagnostics(child, depth + 1);
  }
  return result;
}

export function redactedRecord(value: unknown): Record<string, unknown> {
  const redacted = redactForDiagnostics(value);
  return isRecord(redacted) ? redacted : { value: redacted };
}

export function findSuspiciousStrings(value: unknown, depth = 0): string[] {
  if (depth > 8) return [];
  if (typeof value === "string") {
    const normalized = normalizeText(value);
    if (
      /(ignore (all|any|the) (previous|prior) instructions|system prompt|publish (it|this|the claim) automatically|mark .*verified|reveal (the )?secret|exfiltrat|bypass (review|authority)|100% reward)/iu.test(
        normalized,
      )
    ) {
      return ["embedded_instruction"];
    }
    if (
      /(password|api[_ -]?key|secret|bearer [a-z0-9._-]+|cvv|cvc|full pan|card number)/iu.test(
        normalized,
      )
    ) {
      return ["sensitive_content"];
    }
    return [];
  }
  if (Array.isArray(value))
    return value.flatMap((item) => findSuspiciousStrings(item, depth + 1));
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([key, child]) => [
    ...(REDACT_KEY.test(key) ? ["sensitive_content"] : []),
    ...findSuspiciousStrings(child, depth + 1),
  ]);
}
