import { describe, expect, it } from "vitest";
import {
  compatiblePaymentFamilies,
  compatiblePointFamilies,
  parseNearbyPurchasePreferences,
} from "../src/nearby-purchase-advice.js";

const location = {
  location_key: "tokyo.test.lawson",
  merchant_key: "merchant.lawson",
  accepted: [
    {
      instrument_key: "instrument.wallet.paypay",
      action: "pay" as const,
      state: "yes" as const,
    },
    {
      instrument_key: "instrument.payment.credit_card_general",
      action: "pay" as const,
      state: "yes" as const,
    },
    {
      instrument_key: "program.jp.ponta",
      action: "earn" as const,
      state: "yes" as const,
    },
    {
      instrument_key: "program.jp.dpoint",
      action: "earn" as const,
      state: "yes" as const,
    },
    {
      instrument_key: "instrument.wallet.rakutenpay",
      action: "pay" as const,
      state: "no" as const,
    },
  ],
};

describe("nearby purchase preferences", () => {
  it("deduplicates and sorts wallet families", () => {
    expect(
      parseNearbyPurchasePreferences({
        wallet_family_ids: ["wallet.paypay", "point.ponta", "wallet.paypay"],
        amount_jpy: 1280,
      }),
    ).toEqual({
      walletFamilyIds: ["point.ponta", "wallet.paypay"],
      amountJpy: 1280,
    });
  });

  it("rejects unknown wallet identifiers", () => {
    expect(() =>
      parseNearbyPurchasePreferences({ wallet_family_ids: ["wallet.unknown"] }),
    ).toThrow("nearby_wallet_invalid");
  });

  it("rejects unreasonable purchase amounts", () => {
    expect(() =>
      parseNearbyPurchasePreferences({
        wallet_family_ids: [],
        amount_jpy: 1_000_001,
      }),
    ).toThrow("nearby_amount_invalid");
  });
});

describe("branch-aware wallet compatibility", () => {
  const preferences = parseNearbyPurchasePreferences({
    wallet_family_ids: [
      "wallet.paypay",
      "wallet.rakutenpay",
      "card.smbc",
      "point.ponta",
      "point.d",
      "point.rakuten",
    ],
    amount_jpy: 1000,
  });

  it("only admits payment families accepted at the resolved branch", () => {
    expect(compatiblePaymentFamilies(preferences, location)).toEqual([
      "card.smbc",
      "wallet.paypay",
    ]);
  });

  it("returns only owned point programs that can earn at the store", () => {
    expect(compatiblePointFamilies(preferences, location)).toEqual([
      "point.d",
      "point.ponta",
    ]);
  });
});
