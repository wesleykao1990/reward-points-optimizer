export const MICROS_PER_JPY = 1_000_000n;

export function parseJpyPerUnitToMicros(value: string): bigint {
  if (!/^\d+(\.\d{1,6})?$/.test(value)) throw new Error("invalid_valuation");
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * MICROS_PER_JPY + BigInt(fraction.padEnd(6, "0"));
}

export function formatMicros(micros: bigint, decimals = 2): string {
  const sign = micros < 0n ? "-" : ""; const abs = micros < 0n ? -micros : micros;
  const whole = abs / MICROS_PER_JPY; const fraction = (abs % MICROS_PER_JPY).toString().padStart(6, "0").slice(0, decimals);
  return `${sign}${whole}.${fraction}`;
}

export function ceilToIncrement(value: bigint, increment: bigint): bigint {
  return ((value + increment - 1n) / increment) * increment;
}

export function rewardUnitsFromBps(spendJpy: bigint, rateBps: bigint): bigint {
  return (spendJpy * rateBps) / 10_000n;
}

export function pointsPerUnit(spendJpy: bigint, spendUnitJpy: bigint, points: bigint): bigint {
  return (spendJpy / spendUnitJpy) * points;
}

/** Formats a non-negative rational without binary floating point. */
export function formatRatio(
  numerator: bigint,
  denominator: bigint,
  decimals = 12,
): string {
  if (denominator <= 0n) throw new Error("invalid_ratio_denominator");
  if (numerator < 0n) return `-${formatRatio(-numerator, denominator, decimals)}`;
  const whole = numerator / denominator;
  let remainder = numerator % denominator;
  if (decimals <= 0) return whole.toString();
  let fraction = "";
  for (let index = 0; index < decimals; index += 1) {
    remainder *= 10n;
    fraction += (remainder / denominator).toString();
    remainder %= denominator;
  }
  return `${whole}.${fraction}`;
}
