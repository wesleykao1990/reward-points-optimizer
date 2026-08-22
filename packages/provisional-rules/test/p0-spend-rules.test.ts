import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { compileP0SpendRuleSet } from "../src/index.js";

const FILES = [
  "p0-point-rules-a.research.v0.1.json",
  "p0-point-rules-b.research.v0.1.json",
  "p0-wallet-card-rules.research.v0.1.json",
  "p0-merchant-transit-regulatory-rules.research.v0.1.json",
] as const;

function artifacts(): unknown[] {
  return FILES.map((name) =>
    JSON.parse(
      readFileSync(
        new URL(`../../../fixtures/m3/agent-feed/${name}`, import.meta.url),
        "utf8",
      ),
    ),
  );
}

describe("P0 spend rule-shape compiler", () => {
  it("compiles an explicit fixed-ratio subset and classifies every P0 claim", () => {
    const result = compileP0SpendRuleSet(artifacts());

    expect(result.rules).toHaveLength(23);
    expect(result.dispositions).toHaveLength(364);
    expect(
      result.rules.find((rule) => rule.rule_id === "p0.transfer.rakuten.ana"),
    ).toMatchObject({
      source_units: "2",
      destination_units: "1",
      minimum_source_units: "50",
      source_asset: { asset_id: "asset.point.rakuten" },
      destination_asset: { asset_id: "asset.mile.ana" },
    });
    expect(
      result.rules.find((rule) => rule.rule_id === "p0.transfer.nanaco.ana"),
    ).toMatchObject({
      source_units: "500",
      destination_units: "250",
      increment_source_units: "500",
      processing_time_days_min: 2,
      processing_time_days_max: 7,
    });
    expect(
      result.rules.find((rule) => rule.rule_id === "p0.transfer.ponta.jal"),
    ).toMatchObject({
      source_units: "2",
      destination_units: "1",
      minimum_source_units: "2",
      increment_source_units: "2",
      source_claim_ids: [
        "claim.point.ponta.transfer.jal-rate.001",
        "claim.point.ponta.transfer.jal-unit-timing.001",
      ],
    });
    expect(
      result.dispositions.find(
        (item) => item.claim_id === "claim.point.ponta.use.example-value.001",
      ),
    ).toMatchObject({ status: "information_only" });
    expect(
      result.dispositions.find(
        (item) =>
          item.claim_id ===
          "claim.point.rakuten.transfer.ana-to-rakuten-third.001",
      ),
    ).toMatchObject({ status: "state_required" });
    expect(
      result.dispositions.find(
        (item) =>
          item.claim_id === "claim.point.ponta.transfer.jal-unit-timing.001",
      ),
    ).toMatchObject({
      status: "companion_constraint",
      derived_rule_ids: ["p0.transfer.ponta.jal"],
    });
    expect(result.rule_set_hash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("is order-independent and rejects hostile public values", () => {
    const left = compileP0SpendRuleSet(artifacts());
    const right = compileP0SpendRuleSet([...artifacts()].reverse());
    expect(right.rule_set_hash).toBe(left.rule_set_hash);

    let reads = 0;
    const hostile = artifacts();
    Object.defineProperty(hostile, "0", {
      enumerable: true,
      get() {
        reads += 1;
        return artifacts()[0];
      },
    });
    expect(() => compileP0SpendRuleSet(hostile)).toThrow(
      "p0_spend_artifacts_invalid",
    );
    expect(reads).toBe(0);
  });
});
