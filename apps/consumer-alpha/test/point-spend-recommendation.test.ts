import { describe, expect, it } from "vitest";

import {
  calculateSelectedProductPurchases,
  listP0LotteryBrowserLinks,
  listPointSpendBrowserOptions,
  parsePointSpendBrowserInput,
  recommendPointSpend,
} from "../src/point-spend-recommendation.js";
import { handleRequest } from "../src/server.js";

const input = {
  source_asset_id: "asset.point.rakuten",
  target_asset_id: "asset.mile.ana",
  balance: 1000,
  objective: "maximize_target" as const,
  effective_at: "2026-08-23T12:00:00+09:00",
  confirmed_rule_ids: ["p0.transfer.rakuten.ana"],
  unit_value_jpy: null,
};

describe("P0 point spending browser route", () => {
  it("calculates every selected card and mobile-payment route from structured rates", async () => {
    const result = await calculateSelectedProductPurchases(
      [
        "card.rakuten",
        "card.d",
        "wallet.dbarai",
        "wallet.paypay",
        "point.rakuten",
      ],
      640,
    );
    expect(result).toHaveLength(4);
    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          family_id: "wallet.dbarai",
          label: "d払い",
          reward_label: "dポイント",
          reward_points: "6",
          rate_percent: "1",
          calculation_note: "200円ごとに2ポイントで計算（dカード設定を含む）",
        }),
        expect.objectContaining({
          family_id: "card.rakuten",
          label: "楽天カード",
          reward_label: "楽天ポイント",
          reward_points: "6",
          rate_percent: "1",
          calculation_note: "100円ごとに1ポイントで計算",
        }),
        expect.objectContaining({
          family_id: "card.d",
          label: "dカード",
          reward_label: "dポイント",
          reward_points: "6",
          rate_percent: "1",
          calculation_note: "100円ごとに1ポイントで計算",
        }),
        expect.objectContaining({
          family_id: "wallet.paypay",
          label: "PayPay",
          reward_label: "PayPayポイント",
          reward_points: "3",
          rate_percent: "0.5",
          calculation_note: "200円単位・残高払いの基本還元率0.5%で計算",
        }),
      ]),
    );
    for (const calculation of result) {
      expect(calculation.source_claim_id).toMatch(/^claim\./u);
      expect(calculation.source_url).toMatch(/^https:\/\//u);
      expect(calculation.checked_at).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/u,
      );
      expect(calculation.calculation_source).toBe("agent_feed_structured");
    }
  });

  it("discovers reordered base claims by family and keeps provenance attached", async () => {
    const result = await calculateSelectedProductPurchases(
      ["wallet.aeonpay", "wallet.dbarai"],
      640,
    );
    expect(result).toContainEqual(
      expect.objectContaining({
        family_id: "wallet.aeonpay",
        source_claim_id: "claim.wallet.aeonpay.base.general-200.001",
        source_url: "https://www.aeon.co.jp/service/lp/aeonpay",
        checked_at: "2026-08-22T00:20:17+09:00",
        calculation_source: "agent_feed_structured",
      }),
    );
    expect(result).toContainEqual(
      expect.objectContaining({
        family_id: "wallet.dbarai",
        source_claim_id: "claim.wallet.dbarai.base.general-200.001",
        source_url:
          "https://service.smt.docomo.ne.jp/keitai_payment/guide/wallet/payment.html",
        checked_at: "2026-08-22T00:20:17+09:00",
        calculation_source: "agent_feed_structured",
      }),
    );
  });

  it("lists the bounded P0 asset graph without evidence internals", async () => {
    const result = await listPointSpendBrowserOptions();
    expect(result.rule_count).toBe(28);
    expect(result.coverage).toMatchObject({
      rule_count: 28,
      asset_count: 22,
      direct_pair_count: 25,
      reachable_pair_count: 49,
      conditional_rule_count: 13,
    });
    const rakutenCoverage = result.coverage.targets_by_source.find(
      (source) => source.asset_id === "asset.point.rakuten",
    );
    expect(rakutenCoverage?.targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          asset_id: "asset.mile.ana",
          label: "ANAマイル",
        }),
        expect.objectContaining({
          asset_id: "asset.value.jpy-redemption",
          label: "支払い充当価値",
        }),
      ]),
    );
    expect(rakutenCoverage?.targets).not.toContainEqual({
      asset_id: "asset.mile.jal",
      label: "JALマイル",
    });
    expect(result.assets).toContainEqual({
      asset_id: "asset.point.rakuten",
      label: "楽天ポイント",
      kind: "reward_point",
    });
    expect(result.wallet_catalogue).toHaveLength(28);
    expect(
      result.wallet_catalogue.filter((item) => item.kind === "point"),
    ).toHaveLength(10);
    expect(
      result.wallet_catalogue.filter((item) => item.kind === "mobile_pay"),
    ).toHaveLength(9);
    expect(
      result.wallet_catalogue.filter((item) => item.kind === "credit_card"),
    ).toHaveLength(7);
    expect(result.wallet_catalogue).toContainEqual({
      family_id: "wallet.rakutenpay",
      label: "楽天ペイ",
      kind: "mobile_pay",
      fact_count: 9,
      calculation_status: "information_only",
    });
    expect(JSON.stringify(result)).not.toMatch(/claim\.|source_ids|evidence/u);
    const vToAna = result.coverage.targets_by_source
      .find((source) => source.asset_id === "asset.point.v")
      ?.targets.find((target) => target.asset_id === "asset.mile.ana");
    expect(vToAna?.conditional_rule_ids).toEqual(
      expect.arrayContaining([
        "p0.transfer.jr-kyupo-to-saison-permanent",
        "p0.transfer.saison-permanent-to-ana-mizuho",
        "p0.transfer.v-to-ana-ana-card",
        "p0.transfer.v.ana",
      ]),
    );
  });

  it("keeps lotteries informational and exposes only bounded official links", async () => {
    const result = await listP0LotteryBrowserLinks("2026-08-23");
    expect(result.calculation_use).toBe(false);
    expect(result.links).toHaveLength(9);
    expect(result.links).toContainEqual({
      title: "楽天ペイ デイリースクラッチ",
      family: "楽天ペイ",
      status: "official_announcement",
      period_label: "終了したキャンペーン",
      official_url: "https://pay.rakuten.co.jp/campaign/pay-scratch/",
    });
    expect(result.links).toContainEqual({
      title: "nanaco夏祭り",
      family: "nanacoポイント",
      status: "application_or_details",
      period_label: "2026/06/15〜2026/08/31",
      official_url: "https://www.nanaco-net.jp/cp/index.html",
    });
    expect(
      result.links.every((item) => item.official_url.startsWith("https://")),
    ).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/claim\.|source_ids|evidence/u);
  });

  it("recommends Rakuten points to ANA miles using exact engine math", async () => {
    const result = await recommendPointSpend(input);
    expect(result).toMatchObject({
      status: "ready",
      experimental: true,
      current_advice: false,
      no_route_reason: null,
      no_route_details: null,
      winner: {
        target_amount: "500",
        target_label: "ANAマイル",
        residual_source_amount: "0",
      },
    });
    expect(result.winner?.steps).toHaveLength(1);
    expect(JSON.stringify(result)).not.toMatch(/claim\.|source_ids|evidence/u);
  });

  it("keeps the V→JR Kyupo→Saison→ANA chain explicit", async () => {
    const result = await recommendPointSpend({
      source_asset_id: "asset.point.v",
      target_asset_id: "asset.mile.ana",
      balance: 10_000,
      objective: "maximize_target",
      effective_at: "2026-08-24T12:00:00+09:00",
      confirmed_rule_ids: [],
      confirmed_prerequisite_ids: [
        "prereq.jq-card-saison",
        "prereq.mizuho-ana-existing-holder",
      ],
      period_source_used_by_rule: {},
      unit_value_jpy: null,
    });
    expect(result.status).toBe("ready");
    expect(result.winner?.target_amount).toBe("7000");
    expect(result.winner?.steps.map((step) => step.destination_label)).toEqual([
      "JRキューポ",
      "セゾン永久不滅ポイント",
      "ANAマイル",
    ]);
    expect(result.winner?.steps.map((step) => step.destination_amount)).toEqual(
      ["10000", "2000", "7000"],
    );
    expect(
      result.winner?.steps.map((step) => [
        step.source_node_id,
        step.destination_node_id,
      ]),
    ).toEqual([
      ["asset.point.v", "asset.point.jr-kyupo"],
      ["asset.point.jr-kyupo", "asset.point.saison-permanent"],
      ["asset.point.saison-permanent", "asset.mile.ana"],
    ]);
  });

  it("uses the ANA-card V-point rate only after explicit confirmation", async () => {
    const base = {
      source_asset_id: "asset.point.v",
      target_asset_id: "asset.mile.ana",
      balance: 10_000,
      objective: "maximize_target" as const,
      effective_at: "2026-08-24T12:00:00+09:00",
      confirmed_rule_ids: [] as string[],
      period_source_used_by_rule: {},
      unit_value_jpy: null,
    };
    const blocked = await recommendPointSpend(base);
    expect(blocked.status).toBe("no_route");
    expect(blocked.no_route_reason).toBe("condition_confirmation_required");
    const eligible = await recommendPointSpend({
      ...base,
      confirmed_prerequisite_ids: ["prereq.ana-smbc-card"],
    });
    expect(eligible.winner?.target_amount).toBe("6000");
  });

  it("accepts browser numeric cap usage for a capped transfer", async () => {
    const result = await recommendPointSpend({
      source_asset_id: "asset.point.v",
      target_asset_id: "asset.mile.ana",
      balance: 10_000,
      objective: "maximize_target",
      effective_at: "2026-08-24T12:00:00+09:00",
      confirmed_rule_ids: ["p0.transfer.v.ana"],
      confirmed_prerequisite_ids: [],
      period_source_used_by_rule: { "p0.transfer.v.ana": 0 },
      unit_value_jpy: null,
    });
    expect(result.status).toBe("ready");
    expect(result.winner?.target_amount).toBe("5000");
  });

  it("explains uncovered, conditional, and minimum-balance no-route states", async () => {
    const uncovered = await recommendPointSpend({
      ...input,
      target_asset_id: "asset.mile.jal",
    });
    expect(uncovered).toMatchObject({
      status: "no_route",
      no_route_reason: "source_target_not_covered",
      no_route_details: {
        minimum_source_amount: null,
        conditions: [],
      },
    });
    expect(uncovered.message).toContain("楽天ポイントからJALマイル");

    const conditionRequired = await recommendPointSpend({
      ...input,
      confirmed_rule_ids: [],
    });
    expect(conditionRequired).toMatchObject({
      status: "no_route",
      no_route_reason: "condition_confirmation_required",
    });
    expect(conditionRequired.no_route_details?.conditions).toContain(
      "ANAマイレージクラブへの登録が必要です",
    );

    const belowMinimum = await recommendPointSpend({
      source_asset_id: "asset.point.nanaco",
      target_asset_id: "asset.mile.ana",
      balance: 499,
      objective: "maximize_target",
      effective_at: input.effective_at,
      confirmed_rule_ids: [],
      unit_value_jpy: null,
    });
    expect(belowMinimum).toMatchObject({
      status: "no_route",
      no_route_reason: "balance_below_minimum",
      no_route_details: {
        minimum_source_amount: "500",
        conditions: [],
      },
    });
    expect(belowMinimum.message).toContain("最低500単位");
  });

  it("ranks every exit by value when no destination is chosen", async () => {
    const result = await recommendPointSpend({
      source_asset_id: "asset.point.nanaco",
      target_asset_id: null,
      balance: 10_000,
      objective: "maximize_value",
      effective_at: input.effective_at,
      confirmed_rule_ids: [],
      unit_value_jpy: null,
    });
    expect(result.status).toBe("ready");
    // Yen-denominated destinations are priced from their own definition, so
    // the best exit is stated in yen rather than in units of one chosen target.
    expect(result.winner?.value_jpy).toBe("10000");
    expect(result.winner?.effective_rate_percent).toBe("100");
    // Miles have no published redemption in this wave, so they are named as
    // unpriced instead of being ranked at an invented value.
    expect(result.unvalued_asset_labels).toContain("ANAマイル");
  });

  it("uses the value the buyer supplies for the destination", async () => {
    const supplied = await recommendPointSpend({ ...input, unit_value_jpy: 2 });
    expect(supplied.winner?.target_amount).toBe("500");
    expect(supplied.winner?.value_jpy).toBe("1000");
    expect(supplied.winner?.value_note).toContain("入力した1単位の価値");

    const withoutValue = await recommendPointSpend(input);
    expect(withoutValue.winner?.value_jpy).toBeNull();
  });

  it("reports each hop's start date, limit, and stranded remainder", async () => {
    const result = await recommendPointSpend(input);
    const step = result.winner?.steps[0];
    expect(step?.stranded_amount).toBe("0");
    expect(step?.start_date).toBe("2026-08-23");
    expect(result.winner?.legs).toHaveLength(1);
    expect(result.winner?.split_note).toBeNull();
    expect(result.winner?.stranded_note).toBeNull();
    expect(result.winner?.source_amount_used).toBe("1000");
  });

  it("rejects unknown fields, accessors, and unknown assets", async () => {
    expect(() =>
      parsePointSpendBrowserInput({ ...input, extra: true }),
    ).toThrow("point_spend_request_invalid");
    expect(() =>
      parsePointSpendBrowserInput({
        ...input,
        effective_at: "2026-09-31T00:00:00+09:00",
      }),
    ).toThrow("point_spend_request_invalid");
    let reads = 0;
    const hostile = { ...input } as Record<string, unknown>;
    Object.defineProperty(hostile, "balance", {
      enumerable: true,
      get() {
        reads += 1;
        return 1000;
      },
    });
    expect(() => parsePointSpendBrowserInput(hostile)).toThrow(
      "point_spend_request_invalid",
    );
    expect(reads).toBe(0);
    expect(() =>
      parsePointSpendBrowserInput({
        ...input,
        confirmed_prerequisite_ids: ["x".repeat(1_000_000)],
      }),
    ).toThrow("point_spend_request_invalid");
    await expect(
      recommendPointSpend({ ...input, source_asset_id: "asset.point.unknown" }),
    ).rejects.toThrow("point_spend_asset_unknown");
  });

  it("requires the database graph for localhost economic endpoints", async () => {
    const options = await handleRequest({
      method: "GET",
      pathname: "/api/experimental/point-spend/options",
      headers: { host: "127.0.0.1:3010" },
    });
    expect(options.status).toBe(503);
    expect(JSON.parse(options.body)).toMatchObject({
      error: { code: "point_spend_options_unavailable" },
    });

    const lotteries = await handleRequest({
      method: "GET",
      pathname: "/api/experimental/lotteries",
      headers: { host: "127.0.0.1:3010" },
    });
    expect(lotteries.status).toBe(200);
    expect(JSON.parse(lotteries.body)).toMatchObject({
      calculation_use: false,
      links: expect.any(Array),
    });

    const recommendation = await handleRequest({
      method: "POST",
      pathname: "/api/experimental/point-spend/recommendation",
      headers: {
        host: "127.0.0.1:3010",
        origin: "http://127.0.0.1:3010",
        "content-type": "application/json",
      },
      body: JSON.stringify(input),
    });
    expect(recommendation.status).toBe(503);
    expect(JSON.parse(recommendation.body)).toMatchObject({
      error: { code: "point_spend_recommendation_unavailable" },
    });

    const invalid = await handleRequest({
      method: "POST",
      pathname: "/api/experimental/point-spend/recommendation",
      headers: {
        host: "127.0.0.1:3010",
        origin: "http://127.0.0.1:3010",
        "content-type": "application/json",
      },
      body: JSON.stringify({ ...input, extra: true }),
    });
    expect(invalid.status).toBe(400);
  });
});
