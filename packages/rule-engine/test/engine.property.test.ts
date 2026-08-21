import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  makeBitemporalRuleVersions,
  makeDirectPurchasePlan,
  makeEngineContext,
  makeTopupPurchasePlan,
  makeTopupRewardRule,
  makeValuationFlipFixture,
} from "../../test-fixtures/src/index.ts";
import { selectApprovedRule } from "../src/bitemporal.js";
import {
  evaluateCandidates,
  evaluateNativePlan,
  validateConservation,
} from "../src/index.js";

describe("Milestone 1a properties", () => {
  it("conserves every generated top-up residual", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10_000 }),
        fc.integer({ min: 1, max: 10_000 }),
        (acquisition, purchase) => {
          const result = evaluateNativePlan(
            makeTopupPurchasePlan(acquisition, purchase),
            makeEngineContext("1", { rules: [] }),
          );
          if (acquisition < purchase) {
            expect(result.eligible).toBe(false);
            return;
          }
          expect(result.eligible).toBe(true);
          const residual = BigInt(
            result.ending_asset_lots[0]?.quantity.amount ?? "0",
          );
          expect(residual).toBe(BigInt(acquisition - purchase));
          expect(residual >= 0n).toBe(true);
          validateConservation(
            [],
            result.asset_movements,
            result.ending_asset_lots,
          );
        },
      ),
      { numRuns: 80 },
    );
  });

  it("reconciles generated top-up economics exactly", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10_000 }),
        fc.integer({ min: 1, max: 10_000 }),
        (acquisition, purchase) => {
          fc.pre(acquisition >= purchase);
          const recommendation = evaluateCandidates(
            [makeTopupPurchasePlan(acquisition, purchase)],
            makeEngineContext("1", { rules: [] }),
          );
          const result = recommendation.plans[0];
          expect(
            result?.economics.guaranteed_net_value_change_jpy.expected_jpy,
          ).toBe("0");
          expect(
            result?.economics.expected_net_value_change_jpy.expected_jpy,
          ).toBe("0");
        },
      ),
      { numRuns: 80 },
    );
  });

  it("has byte-stable native replay for arbitrary purchase amounts", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100_000 }), (amount) => {
        const plan = makeDirectPurchasePlan(amount);
        const first = evaluateNativePlan(
          plan,
          makeEngineContext("1", { rules: [] }),
        );
        const second = evaluateNativePlan(
          structuredClone(plan),
          makeEngineContext("1", { rules: [] }),
        );
        expect(first.native_snapshot).toBe(second.native_snapshot);
      }),
      { numRuns: 80 },
    );
  });

  it("never changes native snapshots when only residual valuation changes", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 99 }), (cents) => {
        const value = `0.${cents.toString().padStart(2, "0")}`;
        const low = makeValuationFlipFixture(value);
        const high = makeValuationFlipFixture("1.00");
        const lowResult = evaluateCandidates(low.plans, low.context);
        const highResult = evaluateCandidates(high.plans, high.context);
        const lowSnapshots = new Map(
          lowResult.plans.map((plan) => [plan.plan_id, plan.native_snapshot]),
        );
        for (const plan of highResult.plans)
          expect(lowSnapshots.get(plan.plan_id)).toBe(plan.native_snapshot);
      }),
      { numRuns: 50 },
    );
  });

  it("does not duplicate an acquisition reward during spend", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10_000 }),
        fc.integer({ min: 1, max: 10_000 }),
        (acquisition, purchase) => {
          fc.pre(acquisition >= purchase && acquisition >= 100);
          const result = evaluateNativePlan(
            makeTopupPurchasePlan(acquisition, purchase),
            makeEngineContext("1", { rules: [makeTopupRewardRule()] }),
          );
          expect(
            result.reward_components.filter(
              (reward) => reward.rule_id === "rr_synthetic_topup",
            ),
          ).toHaveLength(1);
        },
      ),
      { numRuns: 80 },
    );
  });

  it("selects at most one approved version at every generated replay boundary", () => {
    const versions = makeBitemporalRuleVersions();
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 3_000 }), (days) => {
        const transaction = new Date(
          Date.parse("2026-01-01T00:00:00Z") + days * 86_400_000,
        ).toISOString();
        const selected = selectApprovedRule(
          versions,
          "rr_synthetic_bitemporal",
          transaction,
          transaction,
        );
        expect(
          selected === null || selected.version === 1 || selected.version === 2,
        ).toBe(true);
      }),
      { numRuns: 80 },
    );
  });
});
