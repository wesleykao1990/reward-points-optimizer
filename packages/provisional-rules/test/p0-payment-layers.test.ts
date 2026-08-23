import { promises as fs } from "node:fs";

import { beforeAll, describe, expect, it } from "vitest";

import {
  compileP0PaymentLayerSet,
  type P0PaymentLayerSet,
} from "../src/index.js";

const RESEARCH_FILES = [
  "p0-point-rules-a.research.v0.1.json",
  "p0-point-rules-b.research.v0.1.json",
  "p0-wallet-card-rules.research.v0.1.json",
  "p0-merchant-transit-regulatory-rules.research.v0.1.json",
] as const;

async function artifacts(): Promise<unknown[]> {
  return Promise.all(
    RESEARCH_FILES.map(async (name) =>
      JSON.parse(
        await fs.readFile(
          new URL(`../../../fixtures/m3/agent-feed/${name}`, import.meta.url),
          "utf8",
        ),
      ),
    ),
  );
}

describe("P0 payment layer compiler", () => {
  let set: P0PaymentLayerSet;

  beforeAll(async () => {
    set = compileP0PaymentLayerSet(await artifacts());
  });

  it("compiles a charge reward with its cap and its required pairing", () => {
    const charge = set.options.find(
      (option) => option.option_id === "p0.pay.charge.card.aupay",
    );
    expect(charge?.layer).toBe("charge");
    expect(charge?.reward_units_per_basis).toBe("3");
    expect(charge?.basis_unit_jpy).toBe(200);
    expect(charge?.cap_reward_units_per_period).toBe("500");
    expect(charge?.cap_period).toBe("month");
    // The charge only earns when that card funds it and the purchase is paid
    // from the balance it filled.
    expect(charge?.requires_option_ids).toEqual([
      "p0.pay.funding.card.aupay",
      "p0.pay.payment.wallet.aupay",
    ]);
  });

  it("compiles base payment rates for cards and wallets", () => {
    const byId = new Map(
      set.options.map((option) => [option.option_id, option]),
    );
    expect(byId.get("p0.pay.payment.card.d")?.reward_units_per_basis).toBe("1");
    expect(byId.get("p0.pay.payment.card.d")?.basis_unit_jpy).toBe(100);
    expect(byId.get("p0.pay.payment.card.view")?.reward_units_per_basis).toBe(
      "5",
    );
    expect(byId.get("p0.pay.payment.card.view")?.basis_unit_jpy).toBe(1000);
    expect(
      byId.get("p0.pay.payment.wallet.paypay")?.reward_asset.asset_id,
    ).toBe("asset.point.paypay");
  });

  it("refuses a claim that only states a maximum or conditional rate", () => {
    // The PayPay card publishes a step ceiling rather than an ordinary rate,
    // so no payment option is compiled for it.
    expect(
      set.options.some(
        (option) => option.option_id === "p0.pay.payment.card.paypay",
      ),
    ).toBe(false);
    expect(
      set.dispositions.some(
        (disposition) =>
          disposition.status === "maximum_or_conditional_only" &&
          disposition.claim_id === "claim.card.paypay.base.max-step.001",
      ),
    ).toBe(true);
  });

  it("compiles a merchant presentment rate scoped to that merchant", () => {
    const loyalty = set.options.find(
      (option) => option.option_id === "p0.pay.loyalty.merchant.newdays",
    );
    expect(loyalty?.layer).toBe("loyalty");
    // 200 yen including tax earns 1 JRE POINT when a registered Suica is shown.
    expect(loyalty?.reward_units_per_basis).toBe("1");
    expect(loyalty?.basis_unit_jpy).toBe(200);
    expect(loyalty?.reward_asset.asset_id).toBe("asset.point.jre");
    expect(loyalty?.merchant_scope).toBe("merchant.newdays");
    expect(loyalty?.required_conditions_ja).toEqual([
      "登録済みSuicaの提示が必要です",
    ]);
  });

  it("reads a presentment rate published as a percentage", () => {
    const loyalty = set.options.find(
      (option) => option.option_id === "p0.pay.loyalty.merchant.biccamera",
    );
    expect(loyalty?.reward_units_per_basis).toBe("10");
    expect(loyalty?.basis_unit_jpy).toBe(100);
    expect(loyalty?.reward_asset.asset_id).toBe("asset.point.bic");
  });

  it("refuses a presentment rate that depends on tender or time of day", () => {
    // The AEON rate applies only to named tenders, so it is a bonus on those
    // tenders rather than a presentment anyone can earn.
    expect(
      set.dispositions.find(
        (item) => item.claim_id === "claim.merchant.aeon-group.loyalty.001",
      )?.status,
    ).toBe("maximum_or_conditional_only");
    // The Lawson rate changes at 16:00 and pays one of two programmes.
    expect(
      set.options.some((option) => option.family_id === "merchant.lawson"),
    ).toBe(false);
    expect(
      set.options.some((option) => option.family_id === "merchant.mcdonalds"),
    ).toBe(false);
  });

  it("compiles issuer statements that charging earns nothing", () => {
    expect(set.charge_exclusions.map((item) => item.family_id)).toContain(
      "card.d",
    );
    const excluded = set.charge_exclusions.find(
      (item) => item.family_id === "card.d",
    );
    expect(excluded?.excluded_examples.length).toBeGreaterThan(0);
    expect(excluded?.source_claim_ids).toEqual([
      "claim.card.d.exclusions.wallet.001",
    ]);
  });

  it("compiles published redemption values as exits", () => {
    const byAsset = new Map(
      set.exit_options.map((exit) => [exit.asset_id, exit]),
    );
    expect(byAsset.get("asset.point.d")?.jpy_per_unit).toBe("1");
    expect(byAsset.get("asset.point.jre")?.jpy_per_unit).toBe("1");
  });

  it("gives every claim a disposition and never invents an option", async () => {
    const claimCount = await artifactClaimCount();
    expect(set.dispositions).toHaveLength(claimCount);
    for (const option of set.options)
      expect(option.source_claim_ids.length).toBeGreaterThan(0);
  });

  it("is deterministic", async () => {
    const again = compileP0PaymentLayerSet(await artifacts());
    expect(again.set_hash).toBe(set.set_hash);
    expect(again.set_hash).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });

  it("rejects a malformed artifact", () => {
    expect(() => compileP0PaymentLayerSet({} as unknown)).toThrow(
      "p0_payment_artifacts_invalid",
    );
    expect(() => compileP0PaymentLayerSet([{ claims: [] }])).toThrow(
      "p0_payment_artifact_invalid",
    );
  });
});

async function artifactClaimCount(): Promise<number> {
  const loaded = (await artifacts()) as { claims: unknown[] }[];
  return loaded.reduce((total, artifact) => total + artifact.claims.length, 0);
}
