import { types as nodeTypes } from "node:util";

/**
 * Hostile-input guards shared by the point routing optimizers.
 *
 * Both optimizers accept caller-supplied graphs.  A graph is therefore never
 * read directly: it is first projected into null-prototype plain data so that
 * getters, proxies, symbol keys, and prototype pollution cannot influence a
 * calculation or the canonical hash derived from it.
 */

export type PlainRecord = Record<string, unknown>;

const MAX_DEPTH = 24;
const MAX_ARRAY_LENGTH = 512;

/**
 * Project an untrusted value into inert plain data.
 *
 * `code` is the TypeError message raised on rejection so each caller keeps its
 * own stable, documented reason code.
 */
export function plainInput(
  value: unknown,
  code: string,
  active: WeakSet<object> = new WeakSet(),
  depth = 0,
): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  )
    return value;
  if (
    typeof value !== "object" ||
    depth > MAX_DEPTH ||
    nodeTypes.isProxy(value)
  )
    throw new TypeError(code);
  if (active.has(value)) throw new TypeError(code);
  active.add(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.getOwnPropertySymbols(value).length > 0) throw new TypeError(code);
  if (Array.isArray(value)) {
    if (
      Reflect.ownKeys(descriptors).length !== value.length + 1 ||
      value.length > MAX_ARRAY_LENGTH
    )
      throw new TypeError(code);
    const output: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (
        !descriptor ||
        descriptor.enumerable !== true ||
        !("value" in descriptor)
      )
        throw new TypeError(code);
      output.push(plainInput(descriptor.value, code, active, depth + 1));
    }
    active.delete(value);
    return output;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    throw new TypeError(code);
  const output = Object.create(null) as PlainRecord;
  for (const key of Object.keys(descriptors)) {
    const descriptor = descriptors[key];
    if (
      !descriptor ||
      descriptor.enumerable !== true ||
      !("value" in descriptor) ||
      key === "__proto__" ||
      key === "constructor" ||
      key === "prototype"
    )
      throw new TypeError(code);
    output[key] = plainInput(descriptor.value, code, active, depth + 1);
  }
  active.delete(value);
  return output;
}

/** Reject a record whose key set is not exactly `keys`. */
export function exactKeys(
  record: PlainRecord,
  keys: readonly string[],
  code: string,
): void {
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  )
    throw new TypeError(code);
}

/**
 * Accept only an explicit calendar-correct RFC3339 instant.
 *
 * `Date.parse` alone accepts values such as `2026-02-30T00:00:00Z`, so the
 * calendar is checked before the parse rather than after it.
 */
export function validDateTime(value: string): boolean {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{3})?(?:Z|[+-](\d{2}):(\d{2}))$/u.exec(
      value,
    );
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[7] === undefined ? 0 : Number(match[7]);
  const offsetMinute = match[8] === undefined ? 0 : Number(match[8]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return (
    year >= 1970 &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= (days[month - 1] ?? 0) &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59 &&
    offsetHour <= 23 &&
    offsetMinute <= 59 &&
    Number.isFinite(Date.parse(value))
  );
}

/** Accept only an explicit calendar-correct `YYYY-MM-DD` date. */
export function validDate(value: string): boolean {
  return validDateTime(`${value}T00:00:00Z`);
}

/** Add whole days to a `YYYY-MM-DD` date without leaving UTC. */
export function addCalendarDays(date: string, days: number): string {
  if (!validDate(date)) throw new TypeError("invalid_calendar_date");
  if (!Number.isInteger(days) || days < 0 || days > 36_500)
    throw new TypeError("invalid_calendar_offset");
  const base = Date.parse(`${date}T00:00:00Z`);
  return new Date(base + days * 86_400_000).toISOString().slice(0, 10);
}
