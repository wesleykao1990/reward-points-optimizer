import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  admitChallengeCoveragePlan,
  CHALLENGE_COVERAGE_CATEGORY_TOTALS,
  CHALLENGE_COVERAGE_LEVEL_TOTALS,
  CHALLENGE_COVERAGE_SEED_SCENARIO_IDS,
  ChallengeCoverageValidationError,
  parseChallengeCoveragePlan,
  tryAdmitChallengeCoveragePlan,
} from "../src/coverage.js";

const planText = readFileSync(
  resolve(process.cwd(), "../../scenarios/scenario-coverage-plan.v0.3.yaml"),
  "utf8",
);
const parsed = parseChallengeCoveragePlan(planText);

function clonePlan(): Record<string, unknown> {
  return structuredClone(parsed) as Record<string, unknown>;
}

function expectDenied(value: unknown, code?: string): void {
  expect(() => parseChallengeCoveragePlan(value)).toThrow(
    ChallengeCoverageValidationError,
  );
  if (code) {
    try {
      parseChallengeCoveragePlan(value);
    } catch (error) {
      expect(error).toBeInstanceOf(ChallengeCoverageValidationError);
      expect((error as ChallengeCoverageValidationError).issues[0]?.code).toBe(
        code,
      );
    }
  }
}

describe("M7 challenge coverage admission", () => {
  it("admits YAML text and validates the fixed checkpoint distributions", () => {
    expect(parsed.version).toBe("0.3.0");
    expect(parsed.research_cutoff).toBe("2026-08-17");
    expect(parsed.scenarios).toHaveLength(100);
    expect(parsed.distribution.total).toBe(100);
    expect(parsed.distribution.by_level).toEqual(
      CHALLENGE_COVERAGE_LEVEL_TOTALS,
    );
    expect(parsed.distribution.by_category).toEqual(
      CHALLENGE_COVERAGE_CATEGORY_TOTALS,
    );
    expect(
      parsed.scenarios.every((scenario) => scenario.status === "planned"),
    ).toBe(true);
  });

  it("returns the same canonical bytes/hash for YAML and object input", () => {
    const fromText = admitChallengeCoveragePlan(planText);
    const reversed = clonePlan();
    reversed.scenarios = [...(reversed.scenarios as unknown[]).reverse()];
    const fromObject = admitChallengeCoveragePlan(reversed);
    expect(fromObject.canonical_json).toBe(fromText.canonical_json);
    expect(fromObject.sha256).toBe(fromText.sha256);
    expect(fromObject.value.scenarios[0]?.scenario_id).toBe("JP-CMP-001");
  });

  it("deep freezes the admitted copy without freezing caller input", () => {
    const input = clonePlan();
    const snapshot = admitChallengeCoveragePlan(input);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.value)).toBe(true);
    expect(Object.isFrozen(snapshot.value.scenarios)).toBe(true);
    expect(Object.isFrozen(snapshot.value.scenarios[0])).toBe(true);
    expect(Object.isFrozen(input)).toBe(false);
  });

  it("rejects duplicate, missing, substituted, and mismatched IDs", () => {
    const duplicate = clonePlan();
    duplicate.scenarios = [
      ...(duplicate.scenarios as unknown[]).slice(0, 99),
      structuredClone((duplicate.scenarios as unknown[])[0]),
    ];
    expectDenied(duplicate, "duplicate_scenario_id");

    const missing = clonePlan();
    const first = structuredClone(
      (missing.scenarios as unknown[])[0],
    ) as Record<string, unknown>;
    delete first.scenario_id;
    (missing.scenarios as unknown[])[0] = first;
    expectDenied(missing, "missing_field");

    const substituted = clonePlan();
    const replacement = structuredClone(
      (substituted.scenarios as unknown[])[0],
    ) as Record<string, unknown>;
    replacement.scenario_id = "JP-CMP-999";
    (substituted.scenarios as unknown[])[0] = replacement;
    expectDenied(substituted, "distribution_mismatch");

    const mismatch = clonePlan();
    const mismatched = structuredClone(
      (mismatch.scenarios as unknown[])[0],
    ) as Record<string, unknown>;
    mismatched.category = "CVS";
    (mismatch.scenarios as unknown[])[0] = mismatched;
    expectDenied(mismatch, "scenario_category_mismatch");
  });

  it("rejects false distribution declarations and a golden status", () => {
    const falseTotal = clonePlan();
    (falseTotal.distribution as Record<string, unknown>).total = 99;
    expectDenied(falseTotal, "distribution_mismatch");

    const falseLevel = clonePlan();
    const level = falseLevel.distribution as Record<string, unknown>;
    (level.by_level as Record<string, unknown>).L1_SINGLE_RULE = 39;
    expectDenied(falseLevel, "distribution_mismatch");

    const golden = clonePlan();
    const entry = structuredClone((golden.scenarios as unknown[])[0]) as Record<
      string,
      unknown
    >;
    entry.status = "golden";
    (golden.scenarios as unknown[])[0] = entry;
    expectDenied(golden, "golden_status_not_allowed");
  });

  it("rejects accessors, hidden/symbol fields, proxies, and cycles", () => {
    const getter = clonePlan();
    Object.defineProperty(getter, "purpose", {
      enumerable: true,
      configurable: true,
      get: () => {
        throw new Error("must not run");
      },
    });
    expectDenied(getter, "accessor_not_allowed");

    const hidden = clonePlan();
    Object.defineProperty(hidden, "hidden", { value: true, enumerable: false });
    expectDenied(hidden, "non_enumerable_property");

    const symbol = clonePlan();
    Object.defineProperty(symbol, Symbol("hidden"), {
      value: true,
      enumerable: true,
    });
    expectDenied(symbol, "symbol_property");

    const proxied = new Proxy(clonePlan(), {
      get: () => {
        throw new Error("must not run");
      },
    });
    expectDenied(proxied, "proxy_not_allowed");

    const cyclic = clonePlan();
    (cyclic as Record<string, unknown>).cycle = cyclic;
    expectDenied(cyclic, "cyclic_value");
  });

  it("supports optional seed and source resolution", () => {
    const knownSourceIds = new Set(
      parsed.scenarios.flatMap((scenario) => scenario.primary_source_ids),
    );
    expect(
      admitChallengeCoveragePlan(planText, {
        knownSourceIds,
        requireSeedIds: true,
      }).value.scenarios,
    ).toHaveLength(100);
    expect(
      CHALLENGE_COVERAGE_SEED_SCENARIO_IDS.every((id) =>
        parsed.scenarios.some((scenario) => scenario.scenario_id === id),
      ),
    ).toBe(true);
    const unknown = clonePlan();
    const item = structuredClone((unknown.scenarios as unknown[])[0]) as Record<
      string,
      unknown
    >;
    item.primary_source_ids = ["jp.unknown.source"];
    (unknown.scenarios as unknown[])[0] = item;
    expect(() =>
      parseChallengeCoveragePlan(unknown, { knownSourceIds }),
    ).toThrow(ChallengeCoverageValidationError);
    try {
      parseChallengeCoveragePlan(unknown, { knownSourceIds });
    } catch (error) {
      expect((error as ChallengeCoverageValidationError).issues[0]?.code).toBe(
        "unknown_source_id",
      );
    }
    expect(
      tryAdmitChallengeCoveragePlan(unknown, { knownSourceIds }),
    ).toMatchObject({
      ok: false,
    });
  });
});
