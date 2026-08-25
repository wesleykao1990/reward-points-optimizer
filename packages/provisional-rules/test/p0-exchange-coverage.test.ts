import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  auditProductionExchangeRouteCoverage,
  compileP0SpendRuleSet,
  PRODUCTION_EXCHANGE_DIRECTORY_COVERAGE,
  PRODUCTION_EXCHANGE_DIRECTORY_ENUMERATION_TASKS,
} from "../src/index.js";

const FILES = [
  "p0-point-rules-a.research.v0.1.json",
  "p0-point-rules-b.research.v0.1.json",
  "p0-wallet-card-rules.research.v0.1.json",
  "p0-merchant-transit-regulatory-rules.research.v0.1.json",
  "p0-complex-route-benchmark.research.v0.1.json",
  "p0-moppy-jal-standard.research.v0.1.json",
  "p0-exchange-route-completeness.research.v0.1.json",
] as const;

const artifacts = () =>
  FILES.map((name) =>
    JSON.parse(
      readFileSync(
        new URL(`../../../fixtures/m3/agent-feed/${name}`, import.meta.url),
        "utf8",
      ),
    ),
  );

describe("production official exchange-directory coverage", () => {
  it("binds every executable observed row to the expected graph edge", () => {
    const compiled = compileP0SpendRuleSet(artifacts());
    const audit = auditProductionExchangeRouteCoverage(compiled.rules);
    expect(
      audit.issues.filter(
        (issue) => issue.code !== "programme_directory_missing",
      ),
    ).toEqual([]);
    expect(audit.executable_route_count).toBe(22);
    expect(audit.research_required_route_count).toBe(2);
    expect(audit.complete).toBe(false);
  });

  it("reports a missing route rather than silently shrinking the graph", () => {
    const compiled = compileP0SpendRuleSet(artifacts());
    const omitted = compiled.rules.filter(
      (rule) => rule.rule_id !== "p0.transfer.recruit-to-d",
    );
    expect(auditProductionExchangeRouteCoverage(omitted).issues).toContainEqual(
      {
        code: "executable_rule_missing",
        route_key: "recruit:d",
        message:
          "expected executable rule is missing: p0.transfer.recruit-to-d",
      },
    );
  });

  it("keeps only unresolved public-detail rows visible as research work", () => {
    expect(
      PRODUCTION_EXCHANGE_DIRECTORY_COVERAGE.filter(
        (entry) => entry.disposition === "research_required",
      ).map((entry) => entry.route_key),
    ).toEqual(["moppy:ponta", "moppy:paypay"]);
  });

  it("emits one bounded Agent Feed enumeration task for each missing programme directory", () => {
    expect(PRODUCTION_EXCHANGE_DIRECTORY_ENUMERATION_TASKS).toHaveLength(12);
    expect(
      new Set(
        PRODUCTION_EXCHANGE_DIRECTORY_ENUMERATION_TASKS.map(
          (task) => task.asset_id,
        ),
      ).size,
    ).toBe(12);
    expect(PRODUCTION_EXCHANGE_DIRECTORY_ENUMERATION_TASKS).toContainEqual({
      task_id: "exchange-directory-enumeration:asset.point.paypay",
      run_group: "production-exchange-directory-enumeration",
      preferred_batch_size: 4,
      snapshot_granularity: "one_per_directory",
      asset_id: "asset.point.paypay",
      source_role_id: "transfer_partner_directory",
      finding_type: "rewards.transfer_change",
      required_attribute: "exchange_directory_snapshot",
      objective:
        "Enumerate every current outbound row in the programme-owned official exchange directory and emit exactly one disposition per row.",
    });
  });

  it("retains exact fee, discrete-amount, and fiscal-tier semantics", () => {
    const rules = compileP0SpendRuleSet(artifacts()).rules;
    const byId = new Map(rules.map((rule) => [rule.rule_id, rule]));
    expect(byId.get("p0.transfer.moppy-to-v")?.fee_schedule).toEqual({
      model: "percentage_of_source",
      numerator: "7",
      denominator: "100",
      rounding: "ceil",
    });
    expect(
      byId.get("p0.transfer.moppy-to-waon")?.allowed_source_amounts,
    ).toEqual(["500", "1000", "3000", "5000", "10000"]);
    expect(byId.get("p0.transfer.moppy-to-ana")).toMatchObject({
      source_units: "1750",
      destination_units: "500",
      minimum_source_units: "1750",
      increment_source_units: "1750",
      processing_time_days_min: 1,
      processing_time_days_max: 3,
    });
    expect(byId.get("p0.transfer.moppy-to-ponta-minimum")).toMatchObject({
      source_units: "1",
      destination_units: "1",
      minimum_source_units: "300",
      allowed_source_amounts: ["300"],
      fee_source_units: "15",
    });
    expect(byId.get("p0.transfer.moppy-to-paypay-minimum")).toMatchObject({
      source_units: "1",
      destination_units: "1",
      minimum_source_units: "500",
      allowed_source_amounts: ["500"],
      fee_source_units: "50",
    });
    expect(
      byId.get("p0.transfer.ana-to-jr-kyupo-full-tier")
        ?.period_usage_max_source_units_exclusive,
    ).toBe("20000");
    expect(
      byId.get("p0.transfer.ana-to-jr-kyupo-reduced-tier")
        ?.period_usage_min_source_units,
    ).toBe("20000");
  });
});
