import { describe, expect, it } from "vitest";

import {
  parsePaymentStackBrowserInput,
  recommendPaymentStack,
} from "../src/payment-stack-recommendation.js";
import { handleRequest } from "../src/server.js";

const input = {
  merchant_id: "merchant.any",
  amount_jpy: 10_000,
  owned_family_ids: ["card.aupay", "wallet.aupay"],
  effective_at: "2026-08-23T12:00:00+09:00",
  confirmed_option_ids: [] as string[],
};

describe("P0 payment stack browser route", () => {
  it("compounds a charge and a payment into one recommendation", async () => {
    const result = await recommendPaymentStack(input);
    expect(result.status).toBe("ready");
    const winner = result.winner;
    expect(winner?.layers.map((layer) => layer.layer)).toEqual([
      "funding",
      "charge",
      "payment",
    ]);
    // 3 points per 200 yen charging, plus 1 per 200 paying, on 10,000 yen.
    expect(
      winner?.layers.map((layer) => [layer.layer, layer.reward_points]),
    ).toEqual([
      ["funding", "0"],
      ["charge", "150"],
      ["payment", "50"],
    ]);
    expect(winner?.native_reward_points).toBe("200");
    expect(winner?.native_reward_label).toBe("Pontaポイント");
    expect(winner?.channel_count).toBe(3);
  });

  it("beats paying with the same card directly", async () => {
    const result = await recommendPaymentStack(input);
    const direct = result.alternatives.find(
      (plan) => plan.channel_count === 1 && plan.layers[0]?.layer === "payment",
    );
    expect(direct?.native_reward_points).toBe("100");
    expect(Number(result.winner?.native_reward_points)).toBeGreaterThan(
      Number(direct?.native_reward_points),
    );
  });

  it("surfaces the issuer statement that charging earns nothing", async () => {
    const result = await recommendPaymentStack(input);
    expect(result.charge_warnings.map((item) => item.label)).toContain(
      "au PAYカード",
    );
  });

  it("only considers what the buyer holds", async () => {
    const narrowed = await recommendPaymentStack({
      ...input,
      owned_family_ids: ["card.d"],
    });
    expect(
      narrowed.winner?.layers.every((layer) => layer.label === "dカード"),
    ).toBe(true);
    expect(narrowed.option_count).toBeLessThan(
      (await recommendPaymentStack({ ...input, owned_family_ids: [] }))
        .option_count,
    );
  });

  it("states a yen total only when every channel is priced", async () => {
    // Ponta has no published redemption in this wave, so the au PAY stack is
    // reported in native points rather than given a yen total.
    const ponta = await recommendPaymentStack(input);
    expect(ponta.winner?.total_value_jpy).toBeNull();
    expect(ponta.winner?.native_reward_points).toBe("200");

    const priced = await recommendPaymentStack({
      ...input,
      owned_family_ids: ["card.d"],
    });
    expect(priced.winner?.total_value_jpy).toBe("100");
    expect(priced.winner?.total_rate_percent).toBe("1");
  });

  it("stacks a merchant presentment on top of the card payment", async () => {
    const base = {
      ...input,
      merchant_id: "merchant.newdays",
      owned_family_ids: ["card.view"],
    };
    const withheld = await recommendPaymentStack(base);
    // The presentment needs a registered Suica, so it is held back until the
    // buyer confirms that condition.
    expect(withheld.winner?.total_rate_percent).toBe("0.5");

    const confirmed = await recommendPaymentStack({
      ...base,
      confirmed_option_ids: ["p0.pay.loyalty.merchant.newdays"],
    });
    expect(
      confirmed.winner?.layers.map((layer) => [
        layer.layer,
        layer.reward_points,
      ]),
    ).toEqual([
      ["payment", "50"],
      ["loyalty", "50"],
    ]);
    expect(confirmed.winner?.total_rate_percent).toBe("1");
    expect(confirmed.winner?.conditions).toEqual([
      "登録済みSuicaの提示が必要です",
    ]);
  });

  it("never offers one merchant's presentment rate at another", async () => {
    const elsewhere = await recommendPaymentStack({
      ...input,
      merchant_id: "merchant.any",
      owned_family_ids: ["card.view"],
      confirmed_option_ids: ["p0.pay.loyalty.merchant.newdays"],
    });
    expect(
      elsewhere.winner?.layers.some((layer) => layer.layer === "loyalty"),
    ).toBe(false);
    expect(elsewhere.winner?.total_rate_percent).toBe("0.5");
  });

  it("lists the merchants whose presentment programme it knows", async () => {
    const result = await recommendPaymentStack(input);
    expect(result.merchants.map((item) => item.merchant_id)).toContain(
      "merchant.newdays",
    );
    expect(
      result.merchants.find((item) => item.merchant_id === "merchant.newdays")
        ?.label,
    ).toBe("NewDays");
  });

  it("rejects unknown fields, accessors, and out-of-range amounts", async () => {
    expect(() =>
      parsePaymentStackBrowserInput({ ...input, extra: true }),
    ).toThrow("payment_stack_request_invalid");
    expect(() =>
      parsePaymentStackBrowserInput({ ...input, amount_jpy: 0 }),
    ).toThrow("payment_stack_request_invalid");
    let reads = 0;
    const hostile = { ...input } as Record<string, unknown>;
    Object.defineProperty(hostile, "amount_jpy", {
      enumerable: true,
      get() {
        reads += 1;
        return 1000;
      },
    });
    expect(() => parsePaymentStackBrowserInput(hostile)).toThrow(
      "payment_stack_request_invalid",
    );
    expect(reads).toBe(0);
  });

  it("never exposes evidence internals to the browser", async () => {
    const result = await recommendPaymentStack(input);
    expect(JSON.stringify(result)).not.toMatch(/claim\.|source_ids|evidence/u);
  });

  it("requires the database graph at the localhost API boundary", async () => {
    const response = await handleRequest({
      method: "POST",
      pathname: "/api/experimental/payment-stack/recommendation",
      headers: {
        host: "127.0.0.1:3010",
        origin: "http://127.0.0.1:3010",
        "content-type": "application/json",
      },
      body: JSON.stringify(input),
    });
    expect(response.status).toBe(503);
    expect(JSON.parse(response.body)).toMatchObject({
      error: { code: "payment_stack_recommendation_unavailable" },
    });

    const invalid = await handleRequest({
      method: "POST",
      pathname: "/api/experimental/payment-stack/recommendation",
      headers: {
        host: "127.0.0.1:3010",
        origin: "http://127.0.0.1:3010",
        "content-type": "application/json",
      },
      body: JSON.stringify({ ...input, extra: true }),
    });
    expect(invalid.status).toBe(400);

    const wrongMethod = await handleRequest({
      method: "GET",
      pathname: "/api/experimental/payment-stack/recommendation",
      headers: { host: "127.0.0.1:3010" },
    });
    expect(wrongMethod.status).toBe(405);
  });
});
