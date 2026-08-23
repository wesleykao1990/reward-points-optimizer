/**
 * Small, deterministic ranking layer for the unified consumer response.
 *
 * The provisional payment-rate routes expose native reward quantities but do
 * not yet have a user valuation profile.  The alpha therefore uses an
 * explicitly named face-value default (one ordinary point = JPY 1) and keeps
 * that assumption in the response.  This module never changes a native
 * reward quantity; it only projects a comparable JPY score.
 */

export const DEFAULT_POINT_VALUATION_VERSION =
  "point-face-value-default.v1" as const;

export type DefaultValuationSource = "face_value_default" | "engine_profile";

export interface DefaultAssetValuation {
  readonly asset_id: string;
  readonly jpy_per_unit: string;
  readonly source: DefaultValuationSource;
  readonly note: string;
}

const POINT_ASSET_IDS = Object.freeze([
  "point.d",
  "point.jre",
  "point.nanaco",
  "point.paypay",
  "point.ponta",
  "point.rakuten",
  "point.v",
  "point.waon",
] as const);

/** Per-asset entries are intentionally explicit so adding a new point family
 * cannot silently inherit a global discount. */
export const DEFAULT_POINT_VALUATIONS: readonly DefaultAssetValuation[] =
  Object.freeze(
    POINT_ASSET_IDS.map((asset_id) =>
      Object.freeze({
        asset_id,
        jpy_per_unit: "1",
        source: "face_value_default" as const,
        note: "通常ポイントを1ポイント=1円として暫定評価",
      }),
    ),
  );

export interface RankingCandidate {
  readonly route_id: string;
  readonly label: string;
  readonly objective_score_jpy: string;
  readonly reward_units: string | null;
  readonly reward_asset_id: string | null;
  readonly reward_label: string | null;
  readonly valuation: DefaultAssetValuation;
  readonly comparison_role: "purchase" | "funding";
}

export interface RankedRouteSummary {
  readonly rank: number;
  readonly route_id: string;
  readonly label: string;
  readonly objective_score_jpy: string;
  readonly reward_units: string | null;
  readonly reward_asset_id: string | null;
  readonly reward_label: string | null;
}

export interface BreakEvenSummary {
  readonly asset_id: string;
  readonly current_jpy_per_unit: string;
  readonly break_even_jpy_per_unit: string;
  readonly winner_at_or_below_threshold_route_id: string;
  readonly winner_above_threshold_route_id: string;
}

export interface UnifiedComparisonSummary {
  readonly valuation_policy: {
    readonly version: typeof DEFAULT_POINT_VALUATION_VERSION;
    readonly default_jpy_per_unit: "1";
    readonly source: "face_value_default";
    readonly note: string;
    readonly assets: readonly DefaultAssetValuation[];
  };
  readonly winner_route_id: string | null;
  readonly runner_up_route_id: string | null;
  readonly winner: RankedRouteSummary | null;
  readonly runner_up: RankedRouteSummary | null;
  readonly delta_jpy: string | null;
  readonly ranked_routes: readonly RankedRouteSummary[];
  readonly break_even: BreakEvenSummary | null;
}

interface Decimal {
  readonly coefficient: bigint;
  readonly scale: number;
}

function parseDecimal(value: string): Decimal {
  if (!/^-?\d+(?:\.\d+)?$/u.test(value))
    throw new TypeError("ranking_decimal_invalid");
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [integer, fraction = ""] = unsigned.split(".");
  const coefficient = BigInt(`${integer}${fraction}`);
  return {
    coefficient: negative ? -coefficient : coefficient,
    scale: fraction.length,
  };
}

function canonicalDecimal(value: Decimal): string {
  const negative = value.coefficient < 0n;
  const absolute = (
    negative ? -value.coefficient : value.coefficient
  ).toString();
  if (value.scale === 0)
    return `${negative && absolute !== "0" ? "-" : ""}${absolute}`;
  const padded = absolute.padStart(value.scale + 1, "0");
  const split = padded.length - value.scale;
  const integer = padded.slice(0, split);
  const fraction = padded.slice(split).replace(/0+$/u, "");
  const body = fraction ? `${integer}.${fraction}` : integer;
  return `${negative && body !== "0" ? "-" : ""}${body}`;
}

function align(left: Decimal, right: Decimal): [bigint, bigint, number] {
  const scale = Math.max(left.scale, right.scale);
  return [
    left.coefficient * 10n ** BigInt(scale - left.scale),
    right.coefficient * 10n ** BigInt(scale - right.scale),
    scale,
  ];
}

function subtract(left: string, right: string): string {
  const a = parseDecimal(left);
  const b = parseDecimal(right);
  const [leftCoefficient, rightCoefficient, scale] = align(a, b);
  return canonicalDecimal({
    coefficient: leftCoefficient - rightCoefficient,
    scale,
  });
}

function divide(
  numerator: string,
  denominator: string,
  precision = 10,
): string {
  const top = parseDecimal(numerator);
  const bottom = parseDecimal(denominator);
  if (bottom.coefficient <= 0n) throw new TypeError("ranking_divisor_invalid");
  const sign = top.coefficient < 0n ? -1n : 1n;
  const topAbsolute = top.coefficient < 0n ? -top.coefficient : top.coefficient;
  const scaleDelta = bottom.scale - top.scale;
  const scaleFactor = 10n ** BigInt(precision + Math.max(scaleDelta, 0));
  const scaledNumerator =
    scaleDelta >= 0
      ? topAbsolute * scaleFactor
      : topAbsolute * 10n ** BigInt(precision);
  const scaledDenominator =
    scaleDelta < 0
      ? bottom.coefficient * 10n ** BigInt(-scaleDelta)
      : bottom.coefficient;
  const quotient = scaledNumerator / scaledDenominator;
  const remainder = scaledNumerator % scaledDenominator;
  const rounded =
    remainder * 2n >= scaledDenominator ? quotient + 1n : quotient;
  return canonicalDecimal({ coefficient: sign * rounded, scale: precision });
}

function valuationFor(assetId: string | null): DefaultAssetValuation {
  const known = DEFAULT_POINT_VALUATIONS.find(
    (item) => item.asset_id === assetId,
  );
  if (known) return known;
  return Object.freeze({
    asset_id: assetId ?? "unknown",
    jpy_per_unit: "1",
    source: "face_value_default" as const,
    note: "ポイント種別が特定できないため、暫定的に1単位=1円として評価",
  });
}

function rankOrder(left: RankingCandidate, right: RankingCandidate): number {
  const score = subtract(right.objective_score_jpy, left.objective_score_jpy);
  if (score !== "0") return Number.parseFloat(score);
  return left.route_id.localeCompare(right.route_id);
}

function summary(
  candidate: RankingCandidate,
  rank: number,
): RankedRouteSummary {
  return Object.freeze({
    rank,
    route_id: candidate.route_id,
    label: candidate.label,
    objective_score_jpy: candidate.objective_score_jpy,
    reward_units: candidate.reward_units,
    reward_asset_id: candidate.reward_asset_id,
    reward_label: candidate.reward_label,
  });
}

function breakEven(
  winner: RankingCandidate | undefined,
  runnerUp: RankingCandidate | undefined,
): BreakEvenSummary | null {
  if (
    !winner ||
    !runnerUp ||
    winner.reward_units === null ||
    runnerUp.reward_units === null ||
    winner.reward_asset_id === null ||
    runnerUp.reward_asset_id === null ||
    winner.reward_asset_id === runnerUp.reward_asset_id
  )
    return null;
  const units = parseDecimal(runnerUp.reward_units);
  if (units.coefficient <= 0n) return null;
  return Object.freeze({
    asset_id: runnerUp.reward_asset_id,
    current_jpy_per_unit: valuationFor(runnerUp.reward_asset_id).jpy_per_unit,
    break_even_jpy_per_unit: divide(
      winner.objective_score_jpy,
      runnerUp.reward_units,
    ),
    winner_at_or_below_threshold_route_id: winner.route_id,
    winner_above_threshold_route_id: runnerUp.route_id,
  });
}

/** Build a stable cross-route ranking. Funding routes are returned as route
 * metadata by the caller but deliberately cannot win a merchant-purchase
 * comparison. */
export function rankUnifiedRoutes(
  candidates: readonly RankingCandidate[],
): UnifiedComparisonSummary {
  const eligible = candidates
    .filter((candidate) => candidate.comparison_role === "purchase")
    .slice()
    .sort(rankOrder);
  const rankedRoutes = Object.freeze(
    eligible.map((candidate, index) => summary(candidate, index + 1)),
  );
  const winnerCandidate = eligible[0];
  const runnerUpCandidate = eligible[1];
  const winner = winnerCandidate ? (rankedRoutes[0] ?? null) : null;
  const runnerUp = runnerUpCandidate ? (rankedRoutes[1] ?? null) : null;
  return Object.freeze({
    valuation_policy: Object.freeze({
      version: DEFAULT_POINT_VALUATION_VERSION,
      default_jpy_per_unit: "1" as const,
      source: "face_value_default" as const,
      note: "通常ポイントを1ポイント=1円として暫定評価。期間限定・用途限定の区分は未反映です。",
      assets: DEFAULT_POINT_VALUATIONS,
    }),
    winner_route_id: winner?.route_id ?? null,
    runner_up_route_id: runnerUp?.route_id ?? null,
    winner,
    runner_up: runnerUp,
    delta_jpy:
      winnerCandidate && runnerUpCandidate
        ? subtract(
            winnerCandidate.objective_score_jpy,
            runnerUpCandidate.objective_score_jpy,
          )
        : null,
    ranked_routes: rankedRoutes,
    break_even: breakEven(winnerCandidate, runnerUpCandidate),
  });
}

export function defaultPointValuation(
  assetId: string | null,
): DefaultAssetValuation {
  return valuationFor(assetId);
}
