import { describe, expect, it } from "vitest";

import {
  buildValuationProfile,
  type PaymentLayerOption,
  type PaymentStackRequest,
  synthesizePaymentStacks,
} from "../src/index.js";
import type { AssetRef } from "../src/types.js";

const POINT: AssetRef = {
  asset_id: "asset.point.wallet",
  asset_kind: "reward_point",
  program_id: "program.wallet",
  reward_class: "normal",
  scale: 0,
};

function option(
  optionId: string,
  layer: PaymentLayerOption["layer"],
  unitsPerBasis: string,
  overrides: Partial<PaymentLayerOption> = {},
): PaymentLayerOption {
  return {
    option_id: optionId,
    layer,
    label_ja: optionId,
    reward_asset: POINT,
    reward_units_per_basis: unitsPerBasis,
    basis_unit_jpy: 100,
    reward_rounding: "floor",
    cap_reward_units_per_period: null,
    cap_reward_units_used: null,
    requires_option_ids: [],
    conflicts_with_option_ids: [],
    merchant_ids: [],
    stack_group: layer,
    stacking_mode: "additive",
    valid_from: null,
    valid_to: null,
    required_conditions_ja: [],
    source_claim_ids: [`claim.${optionId}`],
    ...overrides,
  };
}

/** Holding the card earns nothing by itself; the charge step is what pays. */
const FUNDING = option("funding.card-a", "funding", "0");
/**
 * The charge only earns when the card funds it *and* the purchase is paid from
 * the wallet it filled, so both are declared prerequisites.
 */
const CHARGE = option("charge.wallet-from-card-a", "charge", "0.5", {
  requires_option_ids: ["funding.card-a", "payment.wallet"],
});
const WALLET = option("payment.wallet", "payment", "1");
const CARD_DIRECT = option("payment.card-a-direct", "payment", "1");
const LOYALTY = option("loyalty.point-card", "loyalty", "1");

function profile() {
  return buildValuationProfile("payment-profile", [
    {
      asset_id: POINT.asset_id,
      reward_class: "normal",
      jpy_per_unit_min: "1",
      jpy_per_unit_expected: "1",
      jpy_per_unit_max: "1",
      source: "face_value_default",
      note: "face value",
    },
  ]);
}

function request(
  overrides: Partial<PaymentStackRequest> = {},
): PaymentStackRequest {
  return {
    effective_at: "2026-08-23T00:00:00Z",
    merchant_id: "merchant.store",
    amount_jpy: 10_000,
    options: [FUNDING, CHARGE, WALLET, CARD_DIRECT, LOYALTY],
    confirmed_option_ids: [],
    max_bonus_options: 2,
    valuation: profile(),
    ...overrides,
  };
}

describe("payment stack synthesizer", () => {
  it("compounds charge, payment, and loyalty into one plan", () => {
    const result = synthesizePaymentStacks(request());
    const winner = result.winner;
    expect(winner?.option_ids).toEqual([
      "charge.wallet-from-card-a",
      "funding.card-a",
      "loyalty.point-card",
      "payment.wallet",
    ]);
    // 0.5% charging + 1.0% paying + 1.0% presenting the loyalty card.
    expect(winner?.total_rate_percent).toBe("2.5");
    expect(winner?.total_value_jpy).toBe("250");
    expect(
      winner?.layers.map((layer) => [layer.layer, layer.reward_units]),
    ).toEqual([
      ["funding", "0"],
      ["charge", "50"],
      ["payment", "100"],
      ["loyalty", "100"],
    ]);
  });

  it("beats paying with the card directly", () => {
    const result = synthesizePaymentStacks(request());
    const direct = result.plans.find((plan) =>
      plan.option_ids.includes("payment.card-a-direct"),
    );
    expect(direct?.total_rate_percent).toBe("2");
    expect(Number(result.winner?.total_rate_percent)).toBeGreaterThan(
      Number(direct?.total_rate_percent),
    );
  });

  it("will not count a charge reward without the card that earns it", () => {
    const result = synthesizePaymentStacks(
      request({ options: [CHARGE, WALLET, CARD_DIRECT, LOYALTY] }),
    );
    expect(
      result.plans.some((plan) =>
        plan.option_ids.includes("charge.wallet-from-card-a"),
      ),
    ).toBe(false);
    expect(result.skipped).toContainEqual({
      option_id: "charge.wallet-from-card-a",
      reason_code: "prerequisite_unavailable",
    });
    expect(result.winner?.total_rate_percent).toBe("2");
  });

  it("drops a charge reward the issuer has withdrawn", () => {
    const withdrawn = option("charge.wallet-from-card-a", "charge", "0.5", {
      requires_option_ids: ["funding.card-a", "payment.wallet"],
      valid_to: "2026-06-30",
    });
    const result = synthesizePaymentStacks(
      request({ options: [FUNDING, withdrawn, WALLET, CARD_DIRECT, LOYALTY] }),
    );
    expect(result.skipped).toContainEqual({
      option_id: "charge.wallet-from-card-a",
      reason_code: "reward_withdrawn_or_expired",
    });
    expect(result.winner?.total_rate_percent).toBe("2");
  });

  it("reports the cap that limited a layer rather than the headline rate", () => {
    const capped = option("loyalty.point-card", "loyalty", "1", {
      cap_reward_units_per_period: "60",
      cap_reward_units_used: "20",
    });
    const result = synthesizePaymentStacks(
      request({ options: [FUNDING, CHARGE, WALLET, CARD_DIRECT, capped] }),
    );
    const loyalty = result.winner?.layers.find(
      (layer) => layer.layer === "loyalty",
    );
    expect(loyalty?.uncapped_reward_units).toBe("100");
    expect(loyalty?.reward_units).toBe("40");
    expect(loyalty?.cap_limited).toBe(true);
    expect(result.winner?.total_rate_percent).toBe("1.9");
  });

  it("excludes an option the merchant does not accept", () => {
    const elsewhere = option("payment.wallet", "payment", "1", {
      merchant_ids: ["merchant.other"],
    });
    const result = synthesizePaymentStacks(
      request({ options: [FUNDING, CHARGE, elsewhere, CARD_DIRECT, LOYALTY] }),
    );
    expect(result.skipped).toContainEqual({
      option_id: "payment.wallet",
      reason_code: "merchant_not_accepted",
    });
    expect(result.winner?.option_ids).not.toContain("payment.wallet");
  });

  it("holds back an option whose conditions are unconfirmed", () => {
    const conditional = option("loyalty.point-card", "loyalty", "1", {
      required_conditions_ja: ["member registration required"],
    });
    const options = [FUNDING, CHARGE, WALLET, CARD_DIRECT, conditional];
    const withheld = synthesizePaymentStacks(request({ options }));
    expect(withheld.skipped).toContainEqual({
      option_id: "loyalty.point-card",
      reason_code: "condition_confirmation_required",
    });
    expect(withheld.winner?.total_rate_percent).toBe("1.5");

    const confirmed = synthesizePaymentStacks(
      request({ options, confirmed_option_ids: ["loyalty.point-card"] }),
    );
    expect(confirmed.winner?.total_rate_percent).toBe("2.5");
    expect(confirmed.winner?.required_conditions_ja).toEqual([
      "member registration required",
    ]);
  });

  it("reports a plan without a total when a layer is unpriced", () => {
    const unpriced = synthesizePaymentStacks(
      request({ valuation: buildValuationProfile("empty-profile", []) }),
    );
    expect(unpriced.winner?.value_status).toBe("unvalued");
    expect(unpriced.winner?.total_value_jpy).toBeNull();
    expect(unpriced.winner?.total_rate_percent).toBeNull();
  });

  it("is deterministic and rejects hostile input", () => {
    const left = synthesizePaymentStacks(request());
    const right = synthesizePaymentStacks(request());
    expect(right.result_hash).toBe(left.result_hash);
    expect(() =>
      synthesizePaymentStacks(new Proxy(request(), {}) as PaymentStackRequest),
    ).toThrow("payment_stack_input_invalid");
    expect(() =>
      synthesizePaymentStacks({
        ...request(),
        amount_jpy: 0,
      }),
    ).toThrow("payment_stack_amount_invalid");
  });
});
