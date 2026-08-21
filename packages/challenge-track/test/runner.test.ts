import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  admitSyntheticChallengeSet,
  type RunnableSyntheticCase,
  type SyntheticChallengeSet,
} from "../src/cases.js";
import { admitChallengeCoveragePlan } from "../src/coverage.js";
import {
  type BatchRunRequest,
  canonicalRunnerSha256,
  isAdmittedBatchRunResult,
  runBatch,
  runReplayBatch,
  type SubmittedCase,
} from "../src/runner.js";

const PLAN = admitChallengeCoveragePlan(
  readFileSync(
    new URL(
      "../../../scenarios/scenario-coverage-plan.v0.3.yaml",
      import.meta.url,
    ),
    "utf8",
  ),
);
const encoder = new TextEncoder();

function rawHash(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function runnable(
  caseId: string,
  targetId: string,
  fixtureRef: string,
  expectedRef: string,
  fixture: Uint8Array,
  expected: Uint8Array,
): RunnableSyntheticCase {
  return {
    case_id: caseId,
    coverage_target_id: targetId,
    synthetic_only: true,
    trust_class: "synthetic_test",
    does_not_satisfy_evidence_coverage: true,
    capability: "runnable",
    fixture_ref: fixtureRef,
    expected_ref: expectedRef,
    fixture_sha256: rawHash(fixture) as `sha256:${string}`,
    expected_sha256: rawHash(expected) as `sha256:${string}`,
    canonical_input_sha256: canonicalRunnerSha256(
      JSON.parse(new TextDecoder().decode(fixture)),
    ) as `sha256:${string}`,
    canonical_expected_output_sha256: canonicalRunnerSha256(
      JSON.parse(new TextDecoder().decode(expected)) as unknown,
    ) as `sha256:${string}`,
    engine_version: "engine-v1",
    rules_version: "rules-v1",
    valuation_version: "valuation-v1",
  };
}

function admittedSet(
  cases: readonly RunnableSyntheticCase[],
): SyntheticChallengeSet {
  const result = admitSyntheticChallengeSet({ version: "1", cases }, PLAN);
  if (!result.ok) throw new Error(result.denial.code);
  return result.challenge_set;
}

function submission(item: RunnableSyntheticCase): SubmittedCase {
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

function fixtureData(): {
  readonly files: Map<string, Uint8Array>;
  readonly cases: readonly RunnableSyntheticCase[];
  readonly case_set: SyntheticChallengeSet;
} {
  const aInput = encoder.encode('{"n":1}');
  const aExpected = encoder.encode('{ "value": 2 }');
  const bInput = encoder.encode('{"n":2}');
  const bExpected = encoder.encode('{"value":3}');
  const cases = [
    runnable(
      "SYN-M7-CVS-002-A",
      "JP-CVS-002",
      "m7/a.in",
      "m7/a.out",
      aInput,
      aExpected,
    ),
    runnable(
      "SYN-M7-CVS-006-B",
      "JP-CVS-006",
      "m7/b.in",
      "m7/b.out",
      bInput,
      bExpected,
    ),
  ] as const;
  return {
    files: new Map([
      ["m7/a.in", aInput],
      ["m7/a.out", aExpected],
      ["m7/b.in", bInput],
      ["m7/b.out", bExpected],
    ]),
    cases,
    case_set: admittedSet(cases),
  };
}

function request(
  files: Map<string, Uint8Array>,
  cases: SyntheticChallengeSet,
  submittedCases: readonly SubmittedCase[],
  evaluator: BatchRunRequest["evaluator"] = {
    evaluate: async (_input, context) => context.expected,
  },
  counts?: { reads: number; calls: number },
): BatchRunRequest {
  return {
    plan: PLAN,
    case_set: cases,
    submitted_cases: submittedCases,
    reader: {
      read: async (path) => {
        if (counts) counts.reads += 1;
        const bytes = files.get(path);
        if (!bytes) throw new Error("missing");
        return bytes;
      },
    },
    evaluator: {
      evaluate: async (input, context) => {
        if (counts) counts.calls += 1;
        return evaluator.evaluate(input, context);
      },
    },
    replay: false,
  };
}

describe("M7 deterministic batch runner", () => {
  it("runs an admitted full batch with separate raw and canonical hashes", async () => {
    const { files, cases, case_set } = fixtureData();
    const counts = { reads: 0, calls: 0 };
    const result = await runBatch(
      request(files, case_set, cases.map(submission), undefined, counts),
    );

    expect(counts).toEqual({ reads: 4, calls: 2 });
    expect(result.rows.map((row) => row.case_id)).toEqual([
      "SYN-M7-CVS-002-A",
      "SYN-M7-CVS-006-B",
    ]);
    expect(
      result.rows.every((row) => row.status === "passed" && row.executed),
    ).toBe(true);
    expect(result.rows[0]?.expected_artifact_sha256).not.toBe(
      result.rows[0]?.canonical_expected_sha256,
    );
    expect(result.evidence_promoted).toBe(false);
    expect(result.golden_promoted).toBe(false);
  });

  it("preflights every admitted runnable case and makes zero evaluator calls for a partial submission", async () => {
    const { files, cases, case_set } = fixtureData();
    const firstCase = cases[0];
    if (!firstCase) throw new Error("missing test case");
    const counts = { reads: 0, calls: 0 };
    const result = await runBatch(
      request(files, case_set, [submission(firstCase)], undefined, counts),
    );

    expect(counts.calls).toBe(0);
    expect(counts.reads).toBe(0);
    expect(result.rows.map((row) => row.case_id)).toEqual([
      "SYN-M7-CVS-002-A",
      "SYN-M7-CVS-006-B",
    ]);
    expect(
      result.rows.every((row) => row.status === "blocked" && !row.executed),
    ).toBe(true);
    expect(result.rows[1]?.blockers.map((item) => item.code)).toContain(
      "missing_case",
    );
  });

  it("rejects aliases, unknown fields, and inline payloads before dereference", async () => {
    const { files, cases, case_set } = fixtureData();
    let calls = 0;
    const valid = request(files, case_set, cases.map(submission), {
      evaluate: async (_input, context) => {
        calls += 1;
        return context.expected;
      },
    });
    const forged = {
      ...valid,
      coveragePlan: valid.plan,
      submittedCases: valid.submitted_cases,
      evaluator: {
        evaluate: async () => {
          calls += 100;
          return null;
        },
      },
    } as unknown as BatchRunRequest;
    const result = await runBatch(forged);
    expect(calls).toBe(0);
    expect(result.evaluator_calls).toBe(0);
    expect(result.rows).toHaveLength(2);
    expect(result.rows.map((row) => row.case_id)).toEqual([
      "SYN-M7-CVS-002-A",
      "SYN-M7-CVS-006-B",
    ]);
  });

  it("requires the exact WeakSet-branded plan and case set", async () => {
    const { files, cases, case_set } = fixtureData();
    const forgedPlan = Object.freeze({
      value: PLAN.value,
      canonical_json: PLAN.canonical_json,
      sha256: PLAN.sha256,
    });
    const forgedSet = structuredClone(case_set);
    let calls = 0;
    const evaluator = {
      evaluate: async () => {
        calls += 1;
        return null;
      },
    };
    const planResult = await runBatch({
      ...request(files, case_set, cases.map(submission), evaluator),
      plan: forgedPlan,
    } as unknown as BatchRunRequest);
    const setResult = await runBatch({
      ...request(files, case_set, cases.map(submission), evaluator),
      case_set: forgedSet,
    } as unknown as BatchRunRequest);
    expect(calls).toBe(0);
    expect(planResult.evaluator_calls).toBe(0);
    expect(setResult.evaluator_calls).toBe(0);
  });

  it("blocks malformed bytes before any evaluator call and never rereads paths", async () => {
    const { files, cases, case_set } = fixtureData();
    files.set("m7/b.in", encoder.encode("{malformed"));
    const counts = { reads: 0, calls: 0 };
    const result = await runBatch(
      request(files, case_set, cases.map(submission), undefined, counts),
    );
    expect(counts).toEqual({ reads: 4, calls: 0 });
    expect(
      result.rows.every((row) => row.status === "blocked" && !row.executed),
    ).toBe(true);
    expect(
      result.rows
        .find((row) => row.case_id === "SYN-M7-CVS-006-B")
        ?.blockers.map((item) => item.code),
    ).toContain("malformed_file");
  });

  it("isolates evaluator input and keeps the retained snapshots unchanged", async () => {
    const { files, cases } = fixtureData();
    const singleSet = admittedSet(cases.slice(0, 1));
    const result = await runBatch(
      request(files, singleSet, cases.slice(0, 1).map(submission), {
        evaluate: async (input, context) => {
          try {
            (input as { n: number }).n = 999;
            (context.expected as { value: number }).value = 999;
          } catch {
            // Immutable boundary values are expected.
          }
          return { value: 2 };
        },
      }),
    );
    expect(result.rows[0]?.status).toBe("passed");
    expect(result.rows[0]?.canonical_input_sha256).toBe(
      canonicalRunnerSha256({ n: 1 }),
    );
  });

  it("records evaluator exceptions, unsafe output, and canonical mismatches", async () => {
    const { files, cases, case_set } = fixtureData();
    const result = await runBatch(
      request(files, case_set, cases.map(submission), {
        evaluate: async (_input, context) => {
          if (context.case_id.endsWith("002-A")) throw new Error("deliberate");
          return { wrong: true };
        },
      }),
    );
    expect(result.rows[0]?.status).toBe("error");
    expect(result.rows[0]?.reason_code).toBe("evaluator_exception");
    expect(result.rows[1]?.status).toBe("failed");
    expect(result.rows[1]?.reason_code).toBe("output_mismatch");
  });

  it("keeps replay non-promoting and order-independent", async () => {
    const { files, cases, case_set } = fixtureData();
    const left = await runReplayBatch(
      request(files, case_set, cases.map(submission).reverse()),
    );
    const right = await runReplayBatch(
      request(files, case_set, cases.map(submission)),
    );
    expect(left.replay).toBe(true);
    expect(left.batch_sha256).toBe(right.batch_sha256);
    expect(left.rows).toEqual(right.rows);
    expect(
      left.rows.every(
        (row) => row.replay && !row.evidence_promoted && !row.golden_promoted,
      ),
    ).toBe(true);

    let forgedCalls = 0;
    const forged = {
      ...request(files, case_set, cases.map(submission), {
        evaluate: async (_input, context) => {
          forgedCalls += 1;
          return context.expected;
        },
      }),
      forged_extra: true,
    } as unknown as BatchRunRequest;
    const denied = await runReplayBatch(forged);
    expect(forgedCalls).toBe(0);
    expect(denied.evaluator_calls).toBe(0);
    expect(denied.rows.every((row) => row.status === "blocked")).toBe(true);
  });

  it("accounts for safe unexpected IDs while rejecting duplicate or substituted members", async () => {
    const { files, cases, case_set } = fixtureData();
    const firstCase = cases[0];
    const secondCase = cases[1];
    if (!firstCase || !secondCase) throw new Error("missing test cases");
    const extra = { ...submission(firstCase), case_id: "SYN-M7-CVS-999-X" };
    const substituted = {
      ...submission(secondCase),
      fixture_ref: firstCase.fixture_ref,
    };
    const result = await runBatch(
      request(files, case_set, [submission(firstCase), extra, substituted]),
    );
    expect(result.evaluator_calls).toBe(0);
    expect(result.rows.map((row) => row.case_id)).toEqual([
      "SYN-M7-CVS-002-A",
      "SYN-M7-CVS-006-B",
      "SYN-M7-CVS-999-X",
    ]);
  });

  it("rejects accessors, symbols, hidden fields, and cycles before evaluator calls", async () => {
    const { files, cases, case_set } = fixtureData();
    const firstCase = cases[0];
    if (!firstCase) throw new Error("missing test case");
    const valid = request(files, case_set, cases.map(submission));
    const hostile = {
      ...valid,
      submitted_cases: [...valid.submitted_cases],
    } as unknown as Record<string, unknown>;
    const member = { ...submission(firstCase) } as Record<string, unknown>;
    Object.defineProperty(member, "fixture_ref", {
      enumerable: true,
      get: () => firstCase.fixture_ref,
    });
    (hostile.submitted_cases as unknown[])[0] = member;
    const result = await runBatch(hostile as unknown as BatchRunRequest);
    expect(result.evaluator_calls).toBe(0);
  });

  it("brands only runner-minted results for report provenance", async () => {
    const { files, cases, case_set } = fixtureData();
    const result = await runBatch(
      request(files, case_set, cases.map(submission)),
    );
    expect(isAdmittedBatchRunResult(result)).toBe(true);
    expect(isAdmittedBatchRunResult(structuredClone(result))).toBe(false);
    expect(
      isAdmittedBatchRunResult({ ...result, rows: [...result.rows] }),
    ).toBe(false);
    const revoked = Proxy.revocable(result, {});
    revoked.revoke();
    expect(isAdmittedBatchRunResult(revoked.proxy)).toBe(false);
  });
});
