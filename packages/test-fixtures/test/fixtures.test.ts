import { describe, expect, it } from "vitest";
import {
  evaluateCandidates,
  evaluateNativePlan,
  validatePurchasePlan,
} from "../../rule-engine/src/index.ts";
import {
  makeDirectPurchasePlan,
  makeSyntheticRules,
  makeTenThousandFundingPlan,
  makeTopupPurchasePlan,
  makeValuationFlipFixture,
  syntheticFixtureManifest,
} from "../src/index.ts";

describe("synthetic fixture package", () => {
  it("contains only candidate input in plans", () => {
    for (const plan of [
      makeDirectPurchasePlan(),
      makeTopupPurchasePlan(),
      makeTenThousandFundingPlan(),
    ]) {
      expect(() => validatePurchasePlan(plan)).not.toThrow();
      expect(plan).not.toHaveProperty("asset_movements");
      expect(plan).not.toHaveProperty("reward_components");
      expect(plan).not.toHaveProperty("economics");
    }
  });

  it("exercises the required residual and valuation-flip proofs", () => {
    const context = makeValuationFlipFixture("0.95").context;
    const residual = evaluateNativePlan(makeTenThousandFundingPlan(), context);
    expect(residual.ending_asset_lots[0]?.quantity.amount).toBe("9360");
    const lowFixture = makeValuationFlipFixture("0.95");
    const highFixture = makeValuationFlipFixture("1.00");
    expect(
      evaluateCandidates(lowFixture.plans, lowFixture.context).winner?.plan_id,
    ).toBe("plan_synthetic_direct_card");
    expect(
      evaluateCandidates(highFixture.plans, highFixture.context).winner
        ?.plan_id,
    ).toBe("plan_synthetic_topup_then_pay");
  });

  it("keeps the manifest synthetic and deterministic", () => {
    expect(syntheticFixtureManifest.version).toBe("0.4.1");
    expect(
      makeSyntheticRules().every((rule) =>
        rule.provenance.evidence_ids.every((id) => id.startsWith("ev_")),
      ),
    ).toBe(true);
  });
});
