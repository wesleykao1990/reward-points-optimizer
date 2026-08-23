import { describe, expect, it } from "vitest";

import {
  type AssetValuation,
  buildValuationProfile,
  deriveBestExitValuations,
  lookupValuation,
  valueQuantity,
} from "../src/index.js";

function entry(overrides: Partial<AssetValuation> = {}): AssetValuation {
  return {
    asset_id: "asset.point.a",
    reward_class: "normal",
    jpy_per_unit_min: "1",
    jpy_per_unit_expected: "1",
    jpy_per_unit_max: "1",
    source: "face_value_default",
    note: "face value",
    ...overrides,
  };
}

describe("point valuation profile", () => {
  it("values a quantity across the declared range", () => {
    const profile = buildValuationProfile("test-profile", [
      entry({
        jpy_per_unit_min: "1.5",
        jpy_per_unit_expected: "2",
        jpy_per_unit_max: "3",
        source: "user_profile",
      }),
    ]);
    const valued = valueQuantity(profile, "asset.point.a", "normal", "1000");
    expect(valued?.minimum_jpy).toBe("1500");
    expect(valued?.expected_jpy).toBe("2000");
    expect(valued?.maximum_jpy).toBe("3000");
  });

  it("reports an undeclared asset as unvalued instead of assuming face value", () => {
    const profile = buildValuationProfile("test-profile", [entry()]);
    expect(
      valueQuantity(profile, "asset.point.z", "normal", "1000"),
    ).toBeNull();
  });

  it("values a restricted class separately from the ordinary one", () => {
    // A campaign uplift paid as short-dated, usage-limited units is not worth
    // the same as the ordinary class, so it is priced on its own entry.
    const profile = buildValuationProfile("test-profile", [
      entry(),
      entry({
        reward_class: "limited_period",
        jpy_per_unit_min: "0.5",
        jpy_per_unit_expected: "0.7",
        jpy_per_unit_max: "1",
        source: "user_profile",
        note: "short expiry discount",
      }),
    ]);
    expect(
      valueQuantity(profile, "asset.point.a", "limited_period", "1000")
        ?.expected_jpy,
    ).toBe("700");
    expect(
      valueQuantity(profile, "asset.point.a", "normal", "1000")?.expected_jpy,
    ).toBe("1000");
  });

  it("uses a null-class entry only as a declared fallback", () => {
    const profile = buildValuationProfile("test-profile", [
      entry({ reward_class: null, jpy_per_unit_expected: "1" }),
    ]);
    expect(
      lookupValuation(profile, "asset.point.a", "promotional")?.reward_class,
    ).toBeNull();
  });

  it("rejects an inverted range and a duplicate entry", () => {
    expect(() =>
      buildValuationProfile("test-profile", [
        entry({ jpy_per_unit_min: "2", jpy_per_unit_expected: "1" }),
      ]),
    ).toThrow("valuation_range_not_ordered");
    expect(() =>
      buildValuationProfile("test-profile", [entry(), entry()]),
    ).toThrow("valuation_entry_duplicate");
  });

  it("raises a valuation to the best exit but never lowers it", () => {
    const base = buildValuationProfile("test-profile", [
      entry({ jpy_per_unit_expected: "1", jpy_per_unit_max: "1" }),
      entry({ asset_id: "asset.point.b", jpy_per_unit_expected: "1" }),
    ]);
    const derived = deriveBestExitValuations(base, [
      {
        exit_id: "exit.a.better",
        asset_id: "asset.point.a",
        reward_class: "normal",
        label_ja: "1.5x redemption day",
        jpy_per_unit: "1.5",
        source: "official_disclosed",
        source_claim_ids: ["claim.a"],
      },
      {
        exit_id: "exit.b.worse",
        asset_id: "asset.point.b",
        reward_class: "normal",
        label_ja: "discounted redemption",
        jpy_per_unit: "0.8",
        source: "official_disclosed",
        source_claim_ids: ["claim.b"],
      },
    ]);
    expect(
      lookupValuation(derived.profile, "asset.point.a", "normal")
        ?.jpy_per_unit_expected,
    ).toBe("1.5");
    expect(
      lookupValuation(derived.profile, "asset.point.b", "normal")
        ?.jpy_per_unit_expected,
    ).toBe("1");
    expect(derived.selected_exits.map((exit) => exit.exit_id)).toEqual([
      "exit.a.better",
    ]);
  });

  it("hashes a profile independently of entry order", () => {
    const left = buildValuationProfile("test-profile", [
      entry(),
      entry({ asset_id: "asset.point.b" }),
    ]);
    const right = buildValuationProfile("test-profile", [
      entry({ asset_id: "asset.point.b" }),
      entry(),
    ]);
    expect(right.profile_hash).toBe(left.profile_hash);
  });
});
