import { exactKeys, type PlainRecord, plainInput } from "./input-guard.js";
import { canonicalDecimal, canonicalHash, decimalString } from "./math.js";

/**
 * Explicit per-asset valuation used to compare routes that end in different
 * assets.
 *
 * Comparing 10,000 airline miles against 15,000 ordinary points is only
 * meaningful against a declared valuation, so this module never invents one.
 * An asset with no entry is reported as unvalued and is excluded from value
 * ranking rather than silently defaulted to face value.
 */

export const POINT_VALUATION_VERSION = "point-valuation-profile.v1" as const;

export type ValuationSource =
  /** One unit is assumed to be worth JPY 1.  A stated assumption, not evidence. */
  | "face_value_default"
  /** The user told us what a unit is worth to them. */
  | "user_profile"
  /** Derived from a redemption the user actually made. */
  | "observed_redemption"
  /** The provider publishes the redemption value. */
  | "official_disclosed"
  /** Derived by `deriveBestExitValuations` from the best available exit. */
  | "best_exit_derived";

export interface AssetValuation {
  readonly asset_id: string;
  /**
   * Reward class this entry values.  A campaign uplift paid as
   * `limited_period` units is worth less than the ordinary class, so the two
   * are valued separately.  `null` matches an asset whose class is unset.
   */
  readonly reward_class: string | null;
  readonly jpy_per_unit_min: string;
  readonly jpy_per_unit_expected: string;
  readonly jpy_per_unit_max: string;
  readonly source: ValuationSource;
  readonly note: string;
}

export interface ValuationProfile {
  readonly version: typeof POINT_VALUATION_VERSION;
  readonly profile_id: string;
  readonly entries: readonly AssetValuation[];
  readonly profile_hash: `sha256:${string}`;
}

export interface JpyValuation {
  readonly minimum_jpy: string;
  readonly expected_jpy: string;
  readonly maximum_jpy: string;
  readonly valuation: AssetValuation;
}

/** A one-step way to turn an asset into value, used to derive terminal worth. */
export interface ExitOption {
  readonly exit_id: string;
  readonly asset_id: string;
  readonly reward_class: string | null;
  readonly label_ja: string;
  readonly jpy_per_unit: string;
  readonly source: Exclude<ValuationSource, "best_exit_derived">;
  readonly source_claim_ids: readonly string[];
}

const VALUATION_KEYS = [
  "asset_id",
  "reward_class",
  "jpy_per_unit_min",
  "jpy_per_unit_expected",
  "jpy_per_unit_max",
  "source",
  "note",
] as const;

const EXIT_KEYS = [
  "exit_id",
  "asset_id",
  "reward_class",
  "label_ja",
  "jpy_per_unit",
  "source",
  "source_claim_ids",
] as const;

const VALUATION_SOURCES: readonly ValuationSource[] = [
  "face_value_default",
  "user_profile",
  "observed_redemption",
  "official_disclosed",
  "best_exit_derived",
];

const ASSET_ID_PATTERN = /^asset\.[a-z0-9.-]{2,80}$/u;

function assertValuation(value: unknown): asserts value is AssetValuation {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("valuation_entry_invalid");
  const record = value as PlainRecord;
  exactKeys(record, VALUATION_KEYS, "valuation_entry_shape_invalid");
  if (
    typeof record.asset_id !== "string" ||
    !ASSET_ID_PATTERN.test(record.asset_id) ||
    (record.reward_class !== null && typeof record.reward_class !== "string") ||
    typeof record.source !== "string" ||
    !VALUATION_SOURCES.includes(record.source as ValuationSource) ||
    typeof record.note !== "string" ||
    record.note.length > 200 ||
    typeof record.jpy_per_unit_min !== "string" ||
    typeof record.jpy_per_unit_expected !== "string" ||
    typeof record.jpy_per_unit_max !== "string"
  )
    throw new TypeError("valuation_entry_invalid");
  const minimum = decimalString(record.jpy_per_unit_min);
  const expected = decimalString(record.jpy_per_unit_expected);
  const maximum = decimalString(record.jpy_per_unit_max);
  if (minimum.gt(expected) || expected.gt(maximum))
    throw new TypeError("valuation_range_not_ordered");
}

function valuationKey(assetId: string, rewardClass: string | null): string {
  return `${assetId} ${rewardClass ?? ""}`;
}

/** Validate and hash-bind a set of valuation entries. */
export function buildValuationProfile(
  profileId: string,
  rawEntries: readonly AssetValuation[],
): ValuationProfile {
  if (
    typeof profileId !== "string" ||
    !/^[a-z0-9][a-z0-9._-]{1,63}$/u.test(profileId)
  )
    throw new TypeError("valuation_profile_id_invalid");
  const entries = plainInput(
    rawEntries,
    "valuation_profile_invalid",
  ) as readonly AssetValuation[];
  if (!Array.isArray(entries) || entries.length > 256)
    throw new TypeError("valuation_profile_invalid");
  entries.forEach(assertValuation);
  const seen = new Set<string>();
  for (const entry of entries) {
    const key = valuationKey(entry.asset_id, entry.reward_class);
    if (seen.has(key)) throw new TypeError("valuation_entry_duplicate");
    seen.add(key);
  }
  const sorted = [...entries].sort(
    (left, right) =>
      left.asset_id.localeCompare(right.asset_id) ||
      (left.reward_class ?? "").localeCompare(right.reward_class ?? ""),
  );
  const projection = {
    version: POINT_VALUATION_VERSION,
    profile_id: profileId,
    entries: sorted,
  };
  return {
    ...projection,
    profile_hash: canonicalHash(projection) as `sha256:${string}`,
  };
}

/**
 * Resolve the entry for an asset.
 *
 * An exact `(asset_id, reward_class)` entry wins.  A declared `null`-class
 * entry is used only as an explicit fallback; absence of both is reported as
 * unvalued rather than defaulted.
 */
export function lookupValuation(
  profile: ValuationProfile,
  assetId: string,
  rewardClass: string | null,
): AssetValuation | null {
  const exact = profile.entries.find(
    (entry) => entry.asset_id === assetId && entry.reward_class === rewardClass,
  );
  if (exact) return exact;
  return (
    profile.entries.find(
      (entry) => entry.asset_id === assetId && entry.reward_class === null,
    ) ?? null
  );
}

/** Project a native quantity into a JPY range, or null when unvalued. */
export function valueQuantity(
  profile: ValuationProfile,
  assetId: string,
  rewardClass: string | null,
  amount: string,
): JpyValuation | null {
  const valuation = lookupValuation(profile, assetId, rewardClass);
  if (!valuation) return null;
  const units = decimalString(amount);
  return {
    minimum_jpy: canonicalDecimal(
      units.mul(decimalString(valuation.jpy_per_unit_min)),
    ),
    expected_jpy: canonicalDecimal(
      units.mul(decimalString(valuation.jpy_per_unit_expected)),
    ),
    maximum_jpy: canonicalDecimal(
      units.mul(decimalString(valuation.jpy_per_unit_max)),
    ),
    valuation,
  };
}

export interface SelectedExit {
  readonly asset_id: string;
  readonly reward_class: string | null;
  readonly exit_id: string;
  readonly label_ja: string;
  readonly jpy_per_unit: string;
  readonly source_claim_ids: readonly string[];
}

export interface BestExitDerivation {
  readonly profile: ValuationProfile;
  /** The exit that set each derived entry, for display and audit. */
  readonly selected_exits: readonly SelectedExit[];
}

function assertExit(value: unknown): asserts value is ExitOption {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("exit_option_invalid");
  const record = value as PlainRecord;
  exactKeys(record, EXIT_KEYS, "exit_option_shape_invalid");
  if (
    typeof record.exit_id !== "string" ||
    !/^[a-z0-9][a-z0-9._-]{1,119}$/u.test(record.exit_id) ||
    typeof record.asset_id !== "string" ||
    !ASSET_ID_PATTERN.test(record.asset_id) ||
    (record.reward_class !== null && typeof record.reward_class !== "string") ||
    typeof record.label_ja !== "string" ||
    record.label_ja.length < 1 ||
    record.label_ja.length > 120 ||
    typeof record.source !== "string" ||
    record.source === "best_exit_derived" ||
    !VALUATION_SOURCES.includes(record.source as ValuationSource) ||
    !Array.isArray(record.source_claim_ids) ||
    record.source_claim_ids.length > 16 ||
    !record.source_claim_ids.every((item) => typeof item === "string") ||
    typeof record.jpy_per_unit !== "string"
  )
    throw new TypeError("exit_option_invalid");
  decimalString(record.jpy_per_unit);
}

/**
 * Fold the best available exit into each asset's valuation.
 *
 * What a point is worth is the best thing you can do with it, so a redemption
 * that beats face value (for example a 1.5x in-store redemption day) raises
 * the asset's terminal worth for every route that ends there.  A declared
 * entry that already values the asset at least as highly is kept.
 */
export function deriveBestExitValuations(
  base: ValuationProfile,
  rawExits: readonly ExitOption[],
): BestExitDerivation {
  const exits = plainInput(
    rawExits,
    "exit_options_invalid",
  ) as readonly ExitOption[];
  if (!Array.isArray(exits) || exits.length > 256)
    throw new TypeError("exit_options_invalid");
  exits.forEach(assertExit);
  if (new Set(exits.map((exit) => exit.exit_id)).size !== exits.length)
    throw new TypeError("exit_option_duplicate");

  const best = new Map<string, ExitOption>();
  for (const exit of [...exits].sort((left, right) =>
    left.exit_id.localeCompare(right.exit_id),
  )) {
    const key = valuationKey(exit.asset_id, exit.reward_class);
    const current = best.get(key);
    if (
      !current ||
      decimalString(exit.jpy_per_unit).gt(decimalString(current.jpy_per_unit))
    )
      best.set(key, exit);
  }

  const entries = new Map<string, AssetValuation>(
    base.entries.map((entry) => [
      valuationKey(entry.asset_id, entry.reward_class),
      entry,
    ]),
  );
  const selected: SelectedExit[] = [];
  for (const [key, exit] of best) {
    const existing = entries.get(key);
    const rate = decimalString(exit.jpy_per_unit);
    if (existing && decimalString(existing.jpy_per_unit_expected).gte(rate))
      continue;
    entries.set(key, {
      asset_id: exit.asset_id,
      reward_class: exit.reward_class,
      jpy_per_unit_min: existing?.jpy_per_unit_min ?? canonicalDecimal(rate),
      jpy_per_unit_expected: canonicalDecimal(rate),
      jpy_per_unit_max: canonicalDecimal(
        existing && decimalString(existing.jpy_per_unit_max).gt(rate)
          ? decimalString(existing.jpy_per_unit_max)
          : rate,
      ),
      source: "best_exit_derived",
      note: `best exit: ${exit.label_ja}`,
    });
    selected.push({
      asset_id: exit.asset_id,
      reward_class: exit.reward_class,
      exit_id: exit.exit_id,
      label_ja: exit.label_ja,
      jpy_per_unit: canonicalDecimal(rate),
      source_claim_ids: exit.source_claim_ids,
    });
  }

  return {
    profile: buildValuationProfile(base.profile_id, [...entries.values()]),
    selected_exits: selected.sort(
      (left, right) =>
        left.asset_id.localeCompare(right.asset_id) ||
        (left.reward_class ?? "").localeCompare(right.reward_class ?? ""),
    ),
  };
}
