import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import {
  admitSyntheticChallengeSet,
  type SyntheticChallengeSet,
} from "../src/cases.js";
import {
  type AdmittedChallengeCoveragePlan,
  admitChallengeCoveragePlan,
} from "../src/coverage.js";
import {
  buildChallengeTrackReport,
  type ChallengeTrackReport,
  stableJson,
  verifyChallengeTrackReportHash,
} from "../src/report.js";
import {
  type BatchResultRow,
  type BatchRunResult,
  canonicalRunnerSha256,
  runBatch,
  type SubmittedCase,
} from "../src/runner.js";

const planInput = YAML.parse(
  readFileSync(
    new URL(
      "../../../scenarios/scenario-coverage-plan.v0.3.yaml",
      import.meta.url,
    ),
    "utf8",
  ),
) as unknown;
const registryInput = YAML.parse(
  readFileSync(
    new URL("../../../registry/trusted-sources.v0.3.yaml", import.meta.url),
    "utf8",
  ),
) as { readonly sources: readonly { readonly id: string }[] };
const admittedPlan = admitChallengeCoveragePlan(planInput, {
  knownSourceIds: registryInput.sources.map((source) => source.id),
});

function admittedCaseSet(input: unknown): SyntheticChallengeSet {
  const result = admitSyntheticChallengeSet(input, admittedPlan);
  if (!result.ok)
    throw new Error(`test case admission failed: ${result.denial.code}`);
  return result.challenge_set;
}

const emptyCases = admittedCaseSet({ version: "1", cases: [] });
const encoder = new TextEncoder();
const inputBytes = encoder.encode('{"n":1}');
const expectedBytes = encoder.encode('{"value":2}');

function rawHash(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function row(
  caseId: string,
  overrides: Partial<BatchResultRow> = {},
): BatchResultRow {
  return {
    case_id: caseId,
    status: "passed",
    outcome: "passed",
    executed: true,
    reason_code: null,
    blockers: Object.freeze([]),
    input_path: null,
    expected_path: null,
    input_artifact_sha256: null,
    expected_artifact_sha256: null,
    canonical_input_sha256: null,
    canonical_expected_sha256: null,
    actual_output_sha256: null,
    input_artifact_hash: null,
    expected_artifact_hash: null,
    canonical_input_hash: null,
    canonical_expected_hash: null,
    actual_output_hash: null,
    versions: Object.freeze({}),
    replay: false,
    evidence_promoted: false,
    golden_promoted: false,
    evaluator_error: null,
    ...overrides,
  };
}

function batch(rows: readonly BatchResultRow[]): BatchRunResult {
  return {
    kind: "m7_deterministic_batch",
    replay: false,
    coverage_plan_sha256: admittedPlan.sha256,
    case_set_sha256: `sha256:${"b".repeat(64)}`,
    case_ids: Object.freeze(rows.map((item) => item.case_id)),
    versions: Object.freeze({}),
    rows: Object.freeze([...rows]),
    results: Object.freeze([...rows]),
    accounting_rows: Object.freeze([...rows]),
    batch_sha256: `sha256:${"c".repeat(64)}`,
    batch_hash: `sha256:${"c".repeat(64)}`,
    evaluator_calls: rows.length,
    evidence_promoted: false,
    golden_promoted: false,
  };
}

function caseSet(
  caseId = "SYN-M7-CVS-002-A",
  expectedRef = "fixtures/m7/cvs-002-a.expected.json",
): SyntheticChallengeSet {
  return admittedCaseSet({
    version: "1",
    cases: [
      {
        case_id: caseId,
        coverage_target_id: "JP-CVS-002",
        synthetic_only: true,
        trust_class: "synthetic_test",
        does_not_satisfy_evidence_coverage: true,
        capability: "runnable",
        fixture_ref: "fixtures/m7/cvs-002-a.json",
        expected_ref: expectedRef,
        fixture_sha256: rawHash(inputBytes),
        expected_sha256: rawHash(expectedBytes),
        canonical_input_sha256: canonicalRunnerSha256({ n: 1 }),
        canonical_expected_output_sha256: canonicalRunnerSha256({ value: 2 }),
        engine_version: "engine-v1",
        rules_version: "rules-v1",
        valuation_version: "valuation-v1",
      },
    ],
  });
}

function submission(
  item: SyntheticChallengeSet["cases"][number],
): SubmittedCase {
  if (item.capability !== "runnable")
    throw new Error("test case must be runnable");
  return {
    case_id: item.case_id,
    fixture_ref: item.fixture_ref,
    expected_ref: item.expected_ref,
    fixture_sha256: item.fixture_sha256,
    expected_sha256: item.expected_sha256,
    canonical_input_sha256: item.canonical_input_sha256,
    canonical_expected_output_sha256: item.canonical_expected_output_sha256,
    engine_version: item.engine_version,
    rules_version: item.rules_version,
    valuation_version: item.valuation_version,
  };
}

async function genuineBatch(
  cases: SyntheticChallengeSet,
  submitted: readonly SubmittedCase[] = cases.cases.map(submission),
): Promise<BatchRunResult> {
  const files = new Map<string, Uint8Array>();
  for (const item of cases.cases) {
    if (item.capability !== "runnable") continue;
    files.set(item.fixture_ref, inputBytes);
    files.set(item.expected_ref, expectedBytes);
  }
  return runBatch({
    plan: admittedPlan,
    case_set: cases,
    submitted_cases: submitted,
    reader: {
      read: async (path) => {
        const bytes = files.get(path);
        if (!bytes) throw new Error("missing test fixture");
        return bytes;
      },
    },
    evaluator: { evaluate: async (_input, context) => context.expected },
    replay: false,
  });
}

function report(
  input: {
    readonly case_set?: SyntheticChallengeSet | null;
    readonly runner?: BatchRunResult | null;
  } = {},
): ChallengeTrackReport {
  return buildChallengeTrackReport({
    plan: admittedPlan,
    ...input,
    attempt_port_available: false,
  });
}

describe("M7 deterministic report", () => {
  it("reports exactly 100 declared and planned targets without inventing execution", () => {
    const value = report({ case_set: emptyCases });
    expect(value.declared_target_count).toBe(100);
    expect(value.planned_target_count).toBe(100);
    expect(value.bound_target_count).toBe(0);
    expect(value.executed_count).toBe(0);
    expect(value.passed_count).toBe(0);
    expect(value.evidence_backed_count).toBe(0);
    expect(value.golden_count).toBe(0);
    expect(value.coverage_targets).toHaveLength(100);
    expect(value.production_ready).toBe(false);
    expect(value.blockers.map((item) => item.milestone)).toEqual(["M3", "M4"]);
    expect(value.execution_accounting_status).toBe("valid");
    expect(verifyChallengeTrackReportHash(value)).toBe(true);
  });

  it("counts a genuine synthetic runner pass as execution only, never evidence or golden", async () => {
    const cases = caseSet();
    const runner = await genuineBatch(cases);
    const value = report({ case_set: cases, runner });
    expect(value.bound_target_count).toBe(1);
    expect(value.executed_count).toBe(1);
    expect(value.executed_pass_count).toBe(1);
    expect(value.passed_count).toBe(1);
    expect(value.evidence_backed_count).toBe(0);
    expect(value.golden_count).toBe(0);
    expect(
      value.coverage_targets.find((item) => item.scenario_id === "JP-CVS-002"),
    ).toMatchObject({
      planned: true,
      bound: true,
      executed_count: 1,
      passed_count: 1,
      lifecycle_status: "planned",
    });
  });

  it("fails closed for missing, duplicate, unexpected, and malformed rows", () => {
    const cases = caseSet();
    const missing = report({ case_set: cases });
    expect(missing.execution_accounting_status).toBe("rejected");
    expect(missing.executed_count).toBe(0);
    expect(missing.unexecuted_count).toBe(1);
    expect(
      missing.accounting_issues.some((item) => item.code === "missing_result"),
    ).toBe(true);

    const duplicate = report({
      case_set: cases,
      runner: batch([row("SYN-M7-CVS-002-A"), row("SYN-M7-CVS-002-A")]),
    });
    expect(duplicate.execution_accounting_status).toBe("rejected");
    expect(duplicate.executed_count).toBe(0);
    expect(
      duplicate.accounting_issues.some(
        (item) => item.code === "invalid_result",
      ),
    ).toBe(true);

    const unexpected = report({
      case_set: cases,
      runner: batch([row("SYN-M7-CVS-002-Z")]),
    });
    expect(unexpected.execution_accounting_status).toBe("rejected");
    expect(unexpected.executed_count).toBe(0);
    expect(
      unexpected.accounting_issues.some(
        (item) => item.code === "invalid_result",
      ),
    ).toBe(true);

    const malformed = report({
      case_set: cases,
      runner: batch([row("SYN-M7-CVS-002-A", { outcome: "blocked" as never })]),
    });
    expect(malformed.execution_accounting_status).toBe("rejected");
    expect(malformed.executed_count).toBe(0);
    expect(
      malformed.accounting_issues.some(
        (item) => item.code === "invalid_result",
      ),
    ).toBe(true);
  });

  it("rejects a lifecycle upgrade and does not retain hostile accessors", () => {
    const upgraded = report({
      case_set: caseSet(),
      runner: batch([
        row("SYN-M7-CVS-002-A", { evidence_promoted: true as never }),
      ]),
    });
    expect(upgraded.execution_accounting_status).toBe("rejected");
    expect(upgraded.executed_count).toBe(0);
    expect(upgraded.evidence_backed_count).toBe(0);

    const hostile = row("SYN-M7-CVS-002-A");
    let getterCalls = 0;
    Object.defineProperty(hostile, "outcome", {
      enumerable: true,
      configurable: true,
      get: () => {
        getterCalls += 1;
        return "passed";
      },
    });
    const value = report({ case_set: caseSet(), runner: batch([hostile]) });
    expect(value.execution_accounting_status).toBe("rejected");
    expect(value.executed_count).toBe(0);
    expect(getterCalls).toBe(0);
  });

  it("rejects an authentic runner row for an unexpected submitted case", async () => {
    const cases = caseSet();
    const firstCase = cases.cases[0];
    if (!firstCase) throw new Error("missing test case");
    const base = submission(firstCase);
    const runner = await genuineBatch(cases, [
      base,
      { ...base, case_id: "SYN-M7-CVS-999-X" },
    ]);
    const value = report({ case_set: cases, runner });
    expect(value.execution_accounting_status).toBe("rejected");
    expect(value.executed_count).toBe(0);
    expect(
      value.accounting_issues.some((item) => item.code === "unexpected_result"),
    ).toBe(true);
  });

  it("rejects an authentic batch bound to a different admitted case set", async () => {
    const original = caseSet();
    const runner = await genuineBatch(original);
    const replacement = caseSet(
      "SYN-M7-CVS-002-A",
      "fixtures/m7/cvs-002-b.expected.json",
    );
    const value = report({ case_set: replacement, runner });
    expect(value.execution_accounting_status).toBe("rejected");
    expect(value.executed_count).toBe(0);
    expect(value.accounting_issues).toEqual([
      {
        code: "invalid_result",
        case_id: null,
        detail:
          "The runner batch does not match the admitted plan and case set.",
      },
    ]);
  });

  it("rejects a case set and batch minted for a different plan identity", async () => {
    const original = caseSet();
    const runner = await genuineBatch(original);
    const secondPlan = admitChallengeCoveragePlan(planInput, {
      knownSourceIds: registryInput.sources.map((source) => source.id),
    });
    const value = buildChallengeTrackReport({
      plan: secondPlan,
      case_set: original,
      runner,
      attempt_port_available: false,
    });
    expect(value.execution_accounting_status).toBe("rejected");
    expect(value.bound_target_count).toBe(0);
    expect(value.executed_count).toBe(0);
  });

  it("serializes deterministically", () => {
    const first = report({ case_set: emptyCases });
    const second = report({ case_set: emptyCases });
    expect(stableJson(first)).toBe(stableJson(second));
    expect(first.report_hash).toBe(second.report_hash);
  });

  it("rejects structural plan, case-set, and runner forgeries without re-admitting them", async () => {
    const forgedPlan = structuredClone(
      admittedPlan,
    ) as AdmittedChallengeCoveragePlan;
    expect(() =>
      buildChallengeTrackReport({ plan: forgedPlan, case_set: emptyCases }),
    ).toThrowError(expect.objectContaining({ code: "invalid_plan" }));

    const forgedCases = structuredClone(caseSet()) as SyntheticChallengeSet;
    const value = buildChallengeTrackReport({
      plan: admittedPlan,
      case_set: forgedCases,
      attempt_port_available: false,
    });
    expect(value.execution_accounting_status).toBe("rejected");
    expect(value.bound_target_count).toBe(0);
    expect(value.executed_count).toBe(0);
    expect(value.accounting_issues).toEqual([
      {
        code: "invalid_result",
        case_id: null,
        detail: "The synthetic case set was not admitted.",
      },
    ]);

    const genuineCases = caseSet();
    const forgedRunner = structuredClone(
      await genuineBatch(genuineCases),
    ) as BatchRunResult;
    const runnerValue = report({
      case_set: genuineCases,
      runner: forgedRunner,
    });
    expect(runnerValue.execution_accounting_status).toBe("rejected");
    expect(runnerValue.executed_count).toBe(0);
    expect(runnerValue.accounting_issues).toEqual([
      {
        code: "invalid_result",
        case_id: null,
        detail: "The runner batch was not admitted.",
      },
    ]);
  });
});
