import { createHash } from "node:crypto";
import { Decimal } from "decimal.js";

/** Decimal clone used for every non-integer calculation in the engine. */
export const D = Decimal.clone({
  precision: 120,
  rounding: Decimal.ROUND_HALF_UP,
});

export type RoundingMode = "floor" | "ceil" | "half_up" | "exact";

export function decimal(value: string | number | bigint | Decimal): Decimal {
  if (value instanceof Decimal) return new D(value.toString());
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value))
      throw new Error("binary_number_not_allowed");
    return new D(value.toString());
  }
  return new D(value.toString());
}

export function decimalString(value: string): Decimal {
  if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value)) {
    throw new Error(`invalid_decimal:${value}`);
  }
  return new D(value);
}

export function nonNegativeDecimalString(value: string): Decimal {
  const parsed = decimalString(value);
  if (parsed.isNegative()) throw new Error(`negative_decimal:${value}`);
  return parsed;
}

export function integer(value: string | number | bigint): bigint {
  if (
    typeof value === "number" &&
    (!Number.isSafeInteger(value) || value < 0)
  ) {
    throw new Error("invalid_nonnegative_integer");
  }
  const text = value.toString();
  if (!/^(?:0|[1-9][0-9]*)$/.test(text))
    throw new Error(`invalid_integer:${text}`);
  return BigInt(text);
}

export function power10(scale: number): bigint {
  if (!Number.isInteger(scale) || scale < 0 || scale > 18)
    throw new Error(`invalid_scale:${scale}`);
  return 10n ** BigInt(scale);
}

export function unitsFromAmount(
  amount: string,
  scale: number,
  mode: RoundingMode = "exact",
): bigint {
  const scaled = nonNegativeDecimalString(amount).mul(
    power10(scale).toString(),
  );
  return decimalToBigInt(scaled, mode);
}

export function amountFromUnits(units: bigint, scale: number): string {
  if (units < 0n) throw new Error("negative_units");
  const value = new D(units.toString()).div(power10(scale).toString());
  return trimDecimal(value.toFixed(Math.max(0, scale)));
}

export function decimalToBigInt(value: Decimal, mode: RoundingMode): bigint {
  const integral = (() => {
    switch (mode) {
      case "floor":
        return value.floor();
      case "ceil":
        return value.ceil();
      case "half_up":
        return value.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
      case "exact":
        if (!value.isInteger())
          throw new Error("fractional_reward_exact_rounding");
        return value;
    }
  })();
  return BigInt(integral.toFixed(0));
}

export function roundDecimal(value: Decimal, mode: RoundingMode): Decimal {
  switch (mode) {
    case "floor":
      return value.floor();
    case "ceil":
      return value.ceil();
    case "half_up":
      return value.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
    case "exact":
      if (!value.isInteger())
        throw new Error("fractional_reward_exact_rounding");
      return value;
  }
}

export function trimDecimal(value: string): string {
  if (!value.includes(".")) return value;
  const trimmed = value.replace(/0+$/, "").replace(/\.$/, "");
  return trimmed === "" || trimmed === "-0" ? "0" : trimmed;
}

export function canonicalDecimal(
  value: Decimal | string | number | bigint,
): string {
  const parsed = typeof value === "string" ? new D(value) : decimal(value);
  return trimDecimal(parsed.toFixed(Math.max(0, parsed.decimalPlaces())));
}

export function calculatePercentage(
  spendJpy: bigint,
  rateBasisPoints: number,
  scale: number,
  mode: RoundingMode,
): bigint {
  if (
    spendJpy < 0n ||
    !Number.isInteger(rateBasisPoints) ||
    rateBasisPoints < 0
  ) {
    throw new Error("invalid_percentage_inputs");
  }
  const raw = new D(spendJpy.toString())
    .mul(rateBasisPoints.toString())
    .div("10000")
    .mul(power10(scale).toString());
  return decimalToBigInt(raw, mode);
}

export function calculatePointsPerUnit(
  spendJpy: bigint,
  rewardUnits: string,
  spendUnitJpy: number,
  scale: number,
  mode: RoundingMode,
): bigint {
  if (spendJpy < 0n || !Number.isInteger(spendUnitJpy) || spendUnitJpy < 1) {
    throw new Error("invalid_points_per_unit_inputs");
  }
  const raw = new D((spendJpy / BigInt(spendUnitJpy)).toString())
    .mul(nonNegativeDecimalString(rewardUnits))
    .mul(power10(scale).toString());
  return decimalToBigInt(raw, mode);
}

export function valueOfUnits(
  units: bigint,
  scale: number,
  jpyPerUnit: string | number,
): Decimal {
  if (units < 0n) throw new Error("negative_units");
  return new D(units.toString())
    .div(power10(scale).toString())
    .mul(typeof jpyPerUnit === "number" ? jpyPerUnit.toString() : jpyPerUnit);
}

export function formatRatio(
  numerator: Decimal,
  denominator: Decimal,
  decimals = 12,
): string {
  if (denominator.lte(0)) throw new Error("invalid_ratio_denominator");
  return trimDecimal(
    numerator
      .div(denominator)
      .toDecimalPlaces(decimals, Decimal.ROUND_HALF_UP)
      .toFixed(decimals),
  );
}

/** Stable JSON-like canonical form used for replay and content identity. */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("non_finite_number");
    return JSON.stringify(value);
  }
  if (value instanceof Decimal) return JSON.stringify(canonicalDecimal(value));
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .filter((key) => object[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(object[key])}`)
      .join(",")}}`;
  }
  throw new Error(`unsupported_canonical_type:${typeof value}`);
}

export function canonicalHash(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalize(value)).digest("hex")}`;
}

export function parseTime(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`invalid_timestamp:${value}`);
  return parsed;
}

export function trimRange(range: {
  minimum_jpy: Decimal;
  maximum_jpy: Decimal;
  expected_jpy: Decimal | null;
}): { minimum_jpy: string; maximum_jpy: string; expected_jpy: string | null } {
  return {
    minimum_jpy: canonicalDecimal(range.minimum_jpy),
    maximum_jpy: canonicalDecimal(range.maximum_jpy),
    expected_jpy:
      range.expected_jpy === null ? null : canonicalDecimal(range.expected_jpy),
  };
}
