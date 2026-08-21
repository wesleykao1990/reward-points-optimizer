import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  admitSyntheticChallengeSet,
  assertSyntheticChallengeSet,
  canonicalSyntheticChallengeSet,
  hashSyntheticChallengeSet,
  isAdmittedSyntheticChallengeSet,
} from "../src/cases.js";
import { admitChallengeCoveragePlan } from "../src/coverage.js";

const HASH = `sha256:${"a".repeat(64)}`;
const PLAN_TEXT = readFileSync(
  resolve(process.cwd(), "../../scenarios/scenario-coverage-plan.v0.3.yaml"),
  "utf8",
);
const PLAN = admitChallengeCoveragePlan(PLAN_TEXT);

function runnable(overrides: Record<string, unknown> = {}) {
  return {
    case_id: "SYN-M7-CVS-002-A",
    coverage_target_id: "JP-CVS-002",
    synthetic_only: true,
    trust_class: "synthetic_test",
    does_not_satisfy_evidence_coverage: true,
    capability: "runnable",
    fixture_ref: "fixtures/m7/cvs-002-a.json",
    expected_ref: "fixtures/m7/cvs-002-a.expected.json",
    fixture_sha256: HASH,
    expected_sha256: HASH,
    canonical_input_sha256: HASH,
    canonical_expected_output_sha256: HASH,
    engine_version: "engine-v1",
    rules_version: "rules-v1",
    valuation_version: "valuation-v1",
    ...overrides,
  };
}

function blocked(overrides: Record<string, unknown> = {}) {
  return {
    case_id: "SYN-M7-QR-007-B",
    coverage_target_id: "JP-QR-007",
    synthetic_only: true,
    trust_class: "synthetic_test",
    does_not_satisfy_evidence_coverage: true,
    capability: "blocked",
    blocker_code: "fixture_not_available",
    ...overrides,
  };
}

describe("M7 synthetic case admission", () => {
  it("admits runnable and blocked cases, sorts them, and freezes every level", () => {
    const result = admitSyntheticChallengeSet(
      { version: "1", cases: [blocked(), runnable()] },
      PLAN,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.challenge_set.cases.map((item) => item.case_id)).toEqual([
      "SYN-M7-CVS-002-A",
      "SYN-M7-QR-007-B",
    ]);
    expect(
      result.challenge_set.cases[0]?.does_not_satisfy_evidence_coverage,
    ).toBe(true);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.challenge_set)).toBe(true);
    expect(Object.isFrozen(result.challenge_set.cases)).toBe(true);
    expect(Object.isFrozen(result.challenge_set.cases[0])).toBe(true);
    expect(isAdmittedSyntheticChallengeSet(result.challenge_set)).toBe(true);
    expect(
      isAdmittedSyntheticChallengeSet(structuredClone(result.challenge_set)),
    ).toBe(false);
  });

  it("allows multiple synthetic cases for one admitted target", () => {
    const second = runnable({
      case_id: "SYN-M7-CVS-002-B",
      fixture_ref: "fixtures/m7/cvs-002-b.json",
      expected_ref: "fixtures/m7/cvs-002-b.expected.json",
    });
    const result = admitSyntheticChallengeSet(
      { version: "1", cases: [second, runnable()] },
      PLAN,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.challenge_set.cases).toHaveLength(2);
    expect(
      result.challenge_set.cases.every(
        (item) => item.coverage_target_id === "JP-CVS-002",
      ),
    ).toBe(true);
  });

  it("is invariant to case order and object key order", () => {
    const first = { version: "1", cases: [runnable(), blocked()] };
    const second = {
      cases: [
        {
          blocker_code: "fixture_not_available",
          capability: "blocked",
          does_not_satisfy_evidence_coverage: true,
          trust_class: "synthetic_test",
          synthetic_only: true,
          coverage_target_id: "JP-QR-007",
          case_id: "SYN-M7-QR-007-B",
        },
        {
          valuation_version: "valuation-v1",
          rules_version: "rules-v1",
          engine_version: "engine-v1",
          canonical_expected_output_sha256: HASH,
          canonical_input_sha256: HASH,
          expected_sha256: HASH,
          fixture_sha256: HASH,
          expected_ref: "fixtures/m7/cvs-002-a.expected.json",
          fixture_ref: "fixtures/m7/cvs-002-a.json",
          capability: "runnable",
          does_not_satisfy_evidence_coverage: true,
          trust_class: "synthetic_test",
          synthetic_only: true,
          coverage_target_id: "JP-CVS-002",
          case_id: "SYN-M7-CVS-002-A",
        },
      ],
      version: "1",
    };
    expect(hashSyntheticChallengeSet(first, PLAN)).toBe(
      hashSyntheticChallengeSet(second, PLAN),
    );
    expect(canonicalSyntheticChallengeSet(first, PLAN)).toBe(
      canonicalSyntheticChallengeSet(second, PLAN),
    );
  });

  it("rejects unknown targets, duplicate ids/paths, and malformed hashes", () => {
    expect(
      admitSyntheticChallengeSet(
        {
          version: "1",
          cases: [runnable({ coverage_target_id: "JP-FOO-001" })],
        },
        PLAN,
      ),
    ).toEqual({
      ok: false,
      denial: {
        code: "unknown_coverage_target",
        path: "/cases/0/coverage_target_id",
      },
    });
    expect(
      admitSyntheticChallengeSet(
        { version: "1", cases: [runnable(), runnable()] },
        PLAN,
      ),
    ).toEqual({
      ok: false,
      denial: { code: "duplicate_case_id", path: "/cases/1/case_id" },
    });
    expect(
      admitSyntheticChallengeSet(
        {
          version: "1",
          cases: [
            runnable(),
            runnable({
              case_id: "SYN-M7-CVS-002-B",
              expected_ref: "fixtures/m7/cvs-002-a.json",
            }),
          ],
        },
        PLAN,
      ),
    ).toEqual({
      ok: false,
      denial: { code: "duplicate_path", path: "/cases/1/expected_ref" },
    });
    expect(
      admitSyntheticChallengeSet(
        { version: "1", cases: [runnable({ fixture_sha256: "not-a-hash" })] },
        PLAN,
      ),
    ).toEqual({
      ok: false,
      denial: { code: "hash_invalid", path: "/cases/0/fixture_sha256" },
    });
  });

  it("requires the exact host-admitted coverage snapshot, never a lookalike", () => {
    expect(
      admitSyntheticChallengeSet(
        { version: "1", cases: [runnable()] },
        { scenarios: [{ scenario_id: "JP-CVS-002" }] },
      ).ok,
    ).toBe(false);
    expect(
      admitSyntheticChallengeSet({ version: "1", cases: [runnable()] }, [
        "JP-CVS-002",
      ]).ok,
    ).toBe(false);

    const structurallyExactForgery = Object.freeze({
      value: PLAN.value,
      canonical_json: PLAN.canonical_json,
      sha256: PLAN.sha256,
    });
    expect(
      admitSyntheticChallengeSet(
        { version: "1", cases: [runnable()] },
        structurallyExactForgery,
      ).ok,
    ).toBe(false);
  });

  it("rejects fabricated evidence/golden fields and blocked artifacts", () => {
    for (const extra of [
      { golden: true },
      { evidence_id: "evidence-1" },
      { source_url: "https://evil.example.test" },
      { review_status: "approved" },
      { rate: 0.1 },
    ]) {
      expect(
        admitSyntheticChallengeSet(
          { version: "1", cases: [runnable(extra)] },
          PLAN,
        ).ok,
      ).toBe(false);
    }
    expect(
      admitSyntheticChallengeSet(
        {
          version: "1",
          cases: [blocked({ fixture_ref: "fixtures/m7/nope.json" })],
        },
        PLAN,
      ),
    ).toEqual({
      ok: false,
      denial: { code: "blocked_field_invalid", path: "/cases/0/fixture_ref" },
    });
  });

  it("rejects proxy/accessor/hidden/symbol/cycle/sparse input before dereference", () => {
    const accessor = runnable();
    Object.defineProperty(accessor, "fixture_ref", {
      enumerable: true,
      get: () => "fixtures/m7/owned.json",
    });
    expect(
      admitSyntheticChallengeSet({ version: "1", cases: [accessor] }, PLAN).ok,
    ).toBe(false);

    const hidden = runnable();
    Object.defineProperty(hidden, "credential", {
      enumerable: false,
      value: "Bearer hidden-secret",
    });
    expect(
      admitSyntheticChallengeSet({ version: "1", cases: [hidden] }, PLAN).ok,
    ).toBe(false);

    const symbolValue = runnable();
    Object.defineProperty(symbolValue, Symbol("hidden"), {
      enumerable: true,
      value: "owned",
    });
    expect(
      admitSyntheticChallengeSet({ version: "1", cases: [symbolValue] }, PLAN)
        .ok,
    ).toBe(false);

    const cyclic = runnable() as Record<string, unknown>;
    cyclic.self = cyclic;
    expect(
      admitSyntheticChallengeSet({ version: "1", cases: [cyclic] }, PLAN).ok,
    ).toBe(false);

    const sparse = [] as unknown[];
    sparse[1] = runnable();
    expect(
      admitSyntheticChallengeSet({ version: "1", cases: sparse }, PLAN).ok,
    ).toBe(false);

    const proxy = new Proxy(runnable(), {
      ownKeys: () => {
        throw new Error("trap");
      },
    });
    expect(
      admitSyntheticChallengeSet({ version: "1", cases: [proxy] }, PLAN).ok,
    ).toBe(false);

    const planAccessor = Object.create(Object.getPrototypeOf(PLAN)) as Record<
      string,
      unknown
    >;
    Object.defineProperties(planAccessor, {
      value: { enumerable: true, get: () => PLAN.value },
      canonical_json: { enumerable: true, value: PLAN.canonical_json },
      sha256: { enumerable: true, value: PLAN.sha256 },
    });
    expect(
      admitSyntheticChallengeSet(
        { version: "1", cases: [runnable()] },
        planAccessor,
      ).ok,
    ).toBe(false);

    const planHidden = {
      value: PLAN.value,
      canonical_json: PLAN.canonical_json,
      sha256: PLAN.sha256,
    };
    Object.defineProperty(planHidden, "hidden", {
      enumerable: false,
      value: true,
    });
    Object.freeze(planHidden);
    expect(
      admitSyntheticChallengeSet(
        { version: "1", cases: [runnable()] },
        planHidden,
      ).ok,
    ).toBe(false);

    const planProxy = new Proxy(PLAN, {
      get: () => {
        throw new Error("must not run");
      },
    });
    expect(
      admitSyntheticChallengeSet(
        { version: "1", cases: [runnable()] },
        planProxy,
      ).ok,
    ).toBe(false);
  });

  it("does not admit a blocked case without a stable blocker and never counts synthetic coverage", () => {
    const blockedCase = blocked({ blocker_code: "not stable" });
    expect(
      admitSyntheticChallengeSet({ version: "1", cases: [blockedCase] }, PLAN)
        .ok,
    ).toBe(false);
    expect(() =>
      assertSyntheticChallengeSet({ version: "1", cases: [runnable()] }, PLAN),
    ).not.toThrow();
  });
});
