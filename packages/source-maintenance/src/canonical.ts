import { createHash } from "node:crypto";

/** JSON values accepted by the deterministic hash helpers. */
export type CanonicalJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalJsonValue[]
  | { readonly [key: string]: CanonicalJsonValue };

/**
 * Serialize a value with object keys sorted recursively.  Arrays intentionally
 * retain their order: cohort order and append order are part of the contract.
 */
export function canonicalJson(value: CanonicalJsonValue): string {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new TypeError("Canonical JSON cannot contain a non-finite number");
    }
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }

  const entries = Object.entries(value).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`;
}

export function canonicalSha256(value: CanonicalJsonValue): string {
  return createHash("sha256")
    .update(canonicalJson(value), "utf8")
    .digest("hex");
}

/**
 * Accept only an ISO-8601 date-time with an explicit timezone.  Date.parse is
 * deliberately not sufficient here because it accepts date-only values and
 * normalizes some invalid calendar dates.
 */
export function isValidIsoDateTime(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/.exec(
      value,
    );
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > new Date(Date.UTC(year, month, 0)).getUTCDate() ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return false;
  }
  return Number.isFinite(Date.parse(value));
}

/** Freeze nested arrays and objects so an artifact cannot be edited in place. */
export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Object.isFrozen(value)) return value;

  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}

export function cloneWithoutHash<T extends Record<string, unknown>>(
  value: T,
  hashKeys: readonly string[],
): Record<string, unknown> {
  const clone: Record<string, unknown> = { ...value };
  for (const key of hashKeys) delete clone[key];
  return clone;
}

export function verifyCanonicalHash<T extends Record<string, unknown>>(
  value: T,
  hashKey: string,
  hashKeys: readonly string[] = [hashKey],
): boolean {
  const expected = value[hashKey];
  if (typeof expected !== "string" || expected.length === 0) return false;
  const content = cloneWithoutHash(value, hashKeys);
  return canonicalSha256(content as CanonicalJsonValue) === expected;
}
