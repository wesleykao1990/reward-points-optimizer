import { createHash } from "node:crypto";

/** A JSON value accepted by the canonical serializer. */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

function normalize(value: unknown, path: string): JsonValue {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new TypeError(
        `Cannot canonicalize non-finite number at ${path || "<root>"}`,
      );
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value === "bigint") {
    throw new TypeError(
      `Cannot canonicalize bigint at ${path || "<root>"}; encode it as a decimal string`,
    );
  }
  if (Array.isArray(value))
    return value.map((item, index) => normalize(item, `${path}/${index}`));
  if (typeof value === "object") {
    const output: { [key: string]: JsonValue } = {};
    for (const key of Object.keys(value).sort()) {
      const item = (value as Record<string, unknown>)[key];
      // JSON.stringify omits undefined object properties. Omitting them here
      // keeps canonical output compatible with ordinary JSON while still
      // rejecting undefined array entries below.
      if (item !== undefined) output[key] = normalize(item, `${path}/${key}`);
    }
    return output;
  }
  if (value === undefined)
    throw new TypeError(`Cannot canonicalize undefined at ${path || "<root>"}`);
  throw new TypeError(`Cannot canonicalize value at ${path || "<root>"}`);
}

/**
 * Serialize a JSON-compatible value with lexicographically sorted object keys.
 * Array order is meaningful and is therefore retained. The result is compact,
 * UTF-8-safe JSON suitable for hashes, replay records, and byte comparisons.
 */
export function canonicalize(value: unknown): string {
  const result = JSON.stringify(normalize(value, ""));
  if (result === undefined) throw new TypeError("Unable to canonicalize value");
  return result;
}

export const canonicalJson = canonicalize;
export const serializeCanonical = canonicalize;

export function canonicalSha256(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalize(value), "utf8").digest("hex")}`;
}

/**
 * Hash economic definition content without treating a historical wrapper
 * (`version`, audit, or bitemporal validity) as part of its identity. Callers
 * may provide an explicit projection; the default removes the known wrapper
 * fields used by the RewardRule document.
 */
export function definitionHash(definition: unknown): string {
  if (
    !definition ||
    typeof definition !== "object" ||
    Array.isArray(definition)
  ) {
    return canonicalSha256(definition);
  }
  const copy = { ...(definition as Record<string, unknown>) };
  for (const key of [
    "version",
    "status",
    "validity",
    "provenance",
    "audit",
    "definition_hash",
  ])
    delete copy[key];
  return canonicalSha256(copy);
}
