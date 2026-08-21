import { createHash } from "node:crypto";
import { evaluateCandidates, serializeReplay } from "@jro/rule-engine";
import { describe, expect, it } from "vitest";
import nonHumanSeedExperiment from "../../../fixtures/m3/non-human-seed-experiment-2026-08-18.v0.1.json";
import {
  composeM3ExperimentPromotionGate,
  M3_NON_TRANSFER_SEED_SCENARIO_IDS,
  type M3ExperimentFileReader,
  type M3ExperimentManifest,
  type M3ScenarioRecord,
  type M3ScenarioSourceReadiness,
  makeDirectPurchasePlan,
  makeEngineContext,
  replayM3Experiment,
  replayM3ExperimentSet,
  validateM3ExperimentManifest,
  validateM3ExperimentSeedScenarioIds,
} from "../src/index.ts";

const TIMES = {
  transaction: "2026-08-17T12:00:00+09:00",
  knowledge: "2026-08-17T12:30:00+09:00",
  independent: "2026-08-17T12:40:00+09:00",
  engine: "2026-08-17T12:50:00+09:00",
};

function hash(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function completeRecord(scenarioId: string): M3ScenarioRecord {
  // This is a gate-shaped synthetic record only.  It intentionally carries no
  // merchant or source facts; those belong to later scenario fixtures.
  const sourceId = `synthetic.source.${scenarioId.toLowerCase()}`;
  return {
    scenario_id: scenarioId,
    status: "reviewed",
    primary_source_ids: [sourceId],
    evidence_ids: ["ev_synthetic"],
    evidence: [
      {
        evidence_id: "ev_synthetic",
        first_party: true,
        status: "verified",
        review_decision: "approved",
        source_id: sourceId,
      },
    ],
    candidate_plans: [
      { plan_id: "plan_synthetic_a" },
      { plan_id: "plan_synthetic_b" },
    ],
    plan_results: [
      {
        plan_id: "plan_synthetic_a",
        result_artifact_id: "result_synthetic_a",
        replay_id: "replay_synthetic",
        produced_by: "engine",
      },
      {
        plan_id: "plan_synthetic_b",
        result_artifact_id: "result_synthetic_b",
        replay_id: "replay_synthetic",
        produced_by: "engine",
      },
    ],
    independent_calculation: {
      artifact_id: "calc_synthetic",
      status: "completed",
      completed_at: TIMES.independent,
      method: "spreadsheet",
      plan_ids: ["plan_synthetic_a", "plan_synthetic_b"],
    },
    engine_replay: {
      replay_id: "replay_synthetic",
      status: "passed",
      completed_at: TIMES.engine,
      result_plan_ids: ["plan_synthetic_a", "plan_synthetic_b"],
    },
    required_negative_assertions: ["negative_synthetic"],
    negative_assertions: [
      {
        assertion_id: "negative_synthetic",
        status: "passed",
        checked_at: TIMES.engine,
        artifact_id: "negative_artifact",
      },
    ],
    conservation: {
      artifact_id: "conservation_artifact",
      status: "passed",
      checked_at: TIMES.engine,
    },
    replay: {
      artifact_id: "replay_artifact",
      status: "passed",
      checked_at: TIMES.engine,
    },
    builder_id: "synthetic-builder",
    primary_reviewer_id: "synthetic-primary",
    review: {
      required_review_modes: ["solo_dual_pass", "agent_challenged"],
      review_mode: "agent_challenged",
      calculated_by: "synthetic-builder",
      decision: "approved",
      review_events: [
        {
          mode: "solo_dual_pass",
          reviewer_id: "synthetic-builder",
          completed_at: "2026-08-17T12:55:00+09:00",
          decision: "approved",
          notes: "Synthetic only.",
        },
        {
          mode: "agent_challenged",
          reviewer_id: "synthetic-challenger",
          completed_at: "2026-08-17T12:56:00+09:00",
          decision: "approved",
          notes: "Synthetic only.",
        },
      ],
    },
  };
}

function sourceReadiness(scenarioId: string): M3ScenarioSourceReadiness {
  // Existing m3-gate owns the authoritative source mapping.  These tests only
  // exercise the harness boundary and therefore use a blocked/readiness stub.
  return {
    scenario_id: scenarioId,
    source_ids: ["synthetic.source"],
    promotion_ready: true,
    promotion_blockers: [],
  };
}

function makeManifest(
  scenarioId = M3_NON_TRANSFER_SEED_SCENARIO_IDS[0],
  expectedSerialized = "{}",
  overrides: Partial<M3ExperimentManifest> = {},
): { manifest: M3ExperimentManifest; files: Map<string, string> } {
  const files = new Map<string, string>([
    ["source.synthetic", "synthetic source bytes"],
    ["snapshot.synthetic", "synthetic snapshot bytes"],
    ["evidence.synthetic", "synthetic evidence bytes"],
    ["expected.synthetic.json", expectedSerialized],
  ]);
  const ref = (artifactId: string, path: string) => ({
    artifact_id: artifactId,
    path,
    sha256: hash(files.get(path) ?? ""),
  });
  const manifest: M3ExperimentManifest = {
    scenario_id: scenarioId,
    status: "run_ready",
    source_files: [ref("source.synthetic", "source.synthetic")],
    snapshot_files: [ref("snapshot.synthetic", "snapshot.synthetic")],
    evidence_files: [ref("evidence.synthetic", "evidence.synthetic")],
    transaction_time: TIMES.transaction,
    replay_knowledge_at: TIMES.knowledge,
    engine_run_at: TIMES.engine,
    serialized_plans: JSON.stringify([makeDirectPurchasePlan()]),
    serialized_context: JSON.stringify(makeEngineContext()),
    expected_artifact: {
      ...ref("expected.synthetic", "expected.synthetic.json"),
      completed_at: TIMES.independent,
      method: "independent_script",
    },
    required_negative_assertions: ["negative.synthetic"],
    blockers: [],
    ...overrides,
  };
  return { manifest, files };
}

function reader(files: Map<string, string>): M3ExperimentFileReader {
  return (path) => files.get(path);
}

describe("M3 experiment replay harness", () => {
  it("replays an exact independent expected result", () => {
    const plans = [makeDirectPurchasePlan()];
    const context = makeEngineContext();
    const expected = serializeReplay(evaluateCandidates(plans, context));
    const { manifest, files } = makeManifest(
      M3_NON_TRANSFER_SEED_SCENARIO_IDS[0],
      expected,
    );

    const result = replayM3Experiment(manifest, { readFile: reader(files) });

    expect(result.status).toBe("passed");
    expect(result.executed).toBe(true);
    expect(result.expected_match).toBe(true);
    expect(result.mismatch_paths).toEqual([]);
  });

  it("fails on any public expected-result mismatch", () => {
    const { manifest, files } = makeManifest(
      M3_NON_TRANSFER_SEED_SCENARIO_IDS[0],
      JSON.stringify({ outcome_mode: "definite", plans: [] }),
    );

    const result = replayM3Experiment(manifest, { readFile: reader(files) });

    expect(result.status).toBe("failed");
    expect(result.executed).toBe(true);
    expect(result.expected_match).toBe(false);
    expect(result.mismatch_paths.length).toBeGreaterThan(0);
    expect(
      result.blockers.some((item) => item.code === "expected_result_mismatch"),
    ).toBe(true);
  });

  it("fails closed on missing and hash-mismatched artifacts", () => {
    const { manifest, files } = makeManifest(
      M3_NON_TRANSFER_SEED_SCENARIO_IDS[0],
      "{}",
    );
    files.delete("snapshot.synthetic");
    const hashMismatch = {
      ...manifest,
      source_files: [
        { ...manifest.source_files[0], sha256: hash("different bytes") },
      ],
    };

    const result = replayM3Experiment(hashMismatch, {
      readFile: reader(files),
    });

    expect(result.executed).toBe(false);
    expect(result.status).toBe("failed");
    expect(
      result.blockers.some((item) => item.code === "artifact_missing"),
    ).toBe(true);
    expect(
      result.blockers.some((item) => item.code === "artifact_hash_mismatch"),
    ).toBe(true);
  });

  it("rejects an engine run at or before the independent timestamp", () => {
    const plans = [makeDirectPurchasePlan()];
    const expected = serializeReplay(
      evaluateCandidates(plans, makeEngineContext()),
    );
    const { manifest, files } = makeManifest(
      M3_NON_TRANSFER_SEED_SCENARIO_IDS[0],
      expected,
      { engine_run_at: TIMES.independent },
    );
    let calls = 0;

    const result = replayM3Experiment(manifest, {
      readFile: reader(files),
      evaluate: (candidatePlans, context) => {
        calls += 1;
        return evaluateCandidates(candidatePlans, context);
      },
    });

    expect(result.executed).toBe(false);
    expect(calls).toBe(0);
    expect(
      result.blockers.some(
        (item) => item.code === "engine_before_independent_calculation",
      ),
    ).toBe(true);
  });

  it("reports blocked manifests without executing the evaluator", () => {
    const manifest: M3ExperimentManifest = {
      scenario_id: M3_NON_TRANSFER_SEED_SCENARIO_IDS[0],
      status: "blocked",
      blockers: [
        {
          code: "source_not_ready",
          scenario_id: M3_NON_TRANSFER_SEED_SCENARIO_IDS[0],
          detail: "Synthetic source readiness blocker.",
        },
      ],
    };
    let calls = 0;
    let reads = 0;

    const result = replayM3Experiment(manifest, {
      readFile: () => {
        reads += 1;
        throw new Error("must not read blocked artifacts");
      },
      evaluate: () => {
        calls += 1;
        throw new Error("must not execute");
      },
    });

    expect(result.status).toBe("blocked");
    expect(result.executed).toBe(false);
    expect(calls).toBe(0);
    expect(reads).toBe(0);
    expect(validateM3ExperimentManifest(manifest).valid).toBe(true);
    expect(
      result.blockers.some((item) => item.code === "blocked_manifest"),
    ).toBe(true);
  });

  it("enforces the exact nine-set and rejects transfer", () => {
    const duplicateAndMissing = [
      ...M3_NON_TRANSFER_SEED_SCENARIO_IDS.slice(0, -1),
      M3_NON_TRANSFER_SEED_SCENARIO_IDS[0],
    ];
    const duplicateBlockers =
      validateM3ExperimentSeedScenarioIds(duplicateAndMissing);
    expect(
      duplicateBlockers.some((item) => item.code === "duplicate_scenario_id"),
    ).toBe(true);
    expect(
      duplicateBlockers.some((item) => item.code === "scenario_set_mismatch"),
    ).toBe(true);

    const transferBlockers = validateM3ExperimentSeedScenarioIds([
      ...M3_NON_TRANSFER_SEED_SCENARIO_IDS,
      "JP-XFR-002",
    ]);
    expect(
      transferBlockers.some(
        (item) => item.code === "transfer_scenario_rejected",
      ),
    ).toBe(true);
    expect(
      transferBlockers.some((item) => item.code === "scenario_set_mismatch"),
    ).toBe(true);
  });

  it("keeps source/promotion blocked until reviewed and source-ready", () => {
    const plans = [makeDirectPurchasePlan()];
    const expected = serializeReplay(
      evaluateCandidates(plans, makeEngineContext()),
    );
    const { manifest, files } = makeManifest(
      M3_NON_TRANSFER_SEED_SCENARIO_IDS[0],
      expected,
      {
        status: "passed",
        review: {
          reviewer_id: "synthetic-reviewer",
          completed_at: "2026-08-17T13:00:00+09:00",
          decision: "approved",
        },
      },
    );
    const record = completeRecord(manifest.scenario_id);
    const readiness = sourceReadiness(manifest.scenario_id);
    const blocked = composeM3ExperimentPromotionGate(
      manifest,
      undefined,
      record,
    );
    expect(blocked.can_promote_to_golden).toBe(false);
    expect(blocked.gate_result).toBeUndefined();

    const ready = composeM3ExperimentPromotionGate(manifest, readiness, record);
    // The synthetic source id intentionally does not satisfy m3-gate's
    // authoritative source mapping, so the existing gate remains fail-closed.
    expect(ready.can_promote_to_golden).toBe(false);
    expect(ready.gate_result).toBeDefined();
    expect(files.get("expected.synthetic.json")).toBe(expected);
  });

  it("does not accidentally execute a malformed nine-set batch", () => {
    const { manifest, files } = makeManifest(
      M3_NON_TRANSFER_SEED_SCENARIO_IDS[0],
      "{}",
    );
    let calls = 0;
    const result = replayM3ExperimentSet([manifest, manifest], {
      readFile: reader(files),
      evaluate: () => {
        calls += 1;
        throw new Error("malformed batches must fail closed");
      },
    });
    expect(result.seed_set_valid).toBe(false);
    expect(calls).toBe(0);
    expect(result.scenarios).toEqual([]);
    expect(
      result.blockers.some((item) => item.code === "duplicate_scenario_id"),
    ).toBe(true);
  });

  it("preflights every exact-nine member before any evaluator call", () => {
    const validMembers = M3_NON_TRANSFER_SEED_SCENARIO_IDS.map(
      (scenarioId) => makeManifest(scenarioId, "{}").manifest,
    );
    const malformed = {
      ...validMembers[0],
      serialized_context: 42 as unknown as string,
    };
    const manifests = [malformed, ...validMembers.slice(1)];
    const { files } = makeManifest(M3_NON_TRANSFER_SEED_SCENARIO_IDS[0], "{}");
    let evaluatorCalls = 0;

    const result = replayM3ExperimentSet(manifests, {
      readFile: reader(files),
      evaluate: () => {
        evaluatorCalls += 1;
        throw new Error("batch preflight must finish before evaluation");
      },
    });

    expect(result.seed_set_valid).toBe(true);
    expect(result.scenarios).toHaveLength(9);
    expect(result.scenarios.every((scenario) => !scenario.executed)).toBe(true);
    expect(evaluatorCalls).toBe(0);
    expect(
      result.blockers.some(
        (item) => item.code === "serialized_context_invalid",
      ),
    ).toBe(true);
    expect(
      result.blockers.filter((item) => item.code === "batch_execution_blocked"),
    ).toHaveLength(9);
  });

  it("executes an exact-nine runnable batch from one preflight snapshot", () => {
    const plans = [makeDirectPurchasePlan()];
    const expected = serializeReplay(
      evaluateCandidates(plans, makeEngineContext()),
    );
    const template = makeManifest(
      M3_NON_TRANSFER_SEED_SCENARIO_IDS[0],
      expected,
    );
    const files = new Map<string, string>();
    const manifests = M3_NON_TRANSFER_SEED_SCENARIO_IDS.map(
      (scenarioId, index) => {
        const pathFor = (path: string) => `${path}.${index}`;
        for (const [path, value] of template.files) {
          files.set(pathFor(path), value);
        }
        const sourceFiles = template.manifest.source_files.map((reference) => ({
          ...reference,
          path: pathFor(reference.path),
        }));
        const snapshotFiles = template.manifest.snapshot_files.map(
          (reference) => ({ ...reference, path: pathFor(reference.path) }),
        );
        const evidenceFiles = template.manifest.evidence_files.map(
          (reference) => ({ ...reference, path: pathFor(reference.path) }),
        );
        const expectedArtifact = {
          ...template.manifest.expected_artifact,
          path: pathFor(template.manifest.expected_artifact.path),
        };
        return {
          ...template.manifest,
          scenario_id: scenarioId,
          source_files: sourceFiles,
          snapshot_files: snapshotFiles,
          evidence_files: evidenceFiles,
          expected_artifact: expectedArtifact,
        };
      },
    );
    let reads = 0;
    const readsByPath = new Map<string, number>();
    const expectedReadCount = M3_NON_TRANSFER_SEED_SCENARIO_IDS.length * 4;
    let evaluatorCalls = 0;

    const result = replayM3ExperimentSet(manifests, {
      readFile: (path) => {
        reads += 1;
        readsByPath.set(path, (readsByPath.get(path) ?? 0) + 1);
        // A reread observes changed bytes.  A correct batch consumes exactly
        // one four-artifact snapshot per member and never reaches this branch.
        return reads <= expectedReadCount
          ? files.get(path)
          : "changed-after-preflight";
      },
      evaluate: (candidatePlans, context) => {
        evaluatorCalls += 1;
        return evaluateCandidates(candidatePlans, context);
      },
    });

    expect(result.seed_set_valid).toBe(true);
    expect(result.scenarios).toHaveLength(9);
    expect(
      result.scenarios.every(
        (scenario) =>
          scenario.status === "passed" &&
          scenario.executed &&
          scenario.expected_match === true,
      ),
    ).toBe(true);
    expect(evaluatorCalls).toBe(9);
    expect(reads).toBe(expectedReadCount);
    expect([...readsByPath.values()].every((count) => count === 1)).toBe(true);
  });

  it("fails closed for mixed blocked and run-ready exact-nine batches", () => {
    const blocked: M3ExperimentManifest = {
      scenario_id: M3_NON_TRANSFER_SEED_SCENARIO_IDS[0],
      status: "blocked",
      blockers: [
        {
          code: "source_not_ready",
          scenario_id: M3_NON_TRANSFER_SEED_SCENARIO_IDS[0],
          detail: "Synthetic mixed-batch blocker.",
        },
      ],
    };
    const runnable = M3_NON_TRANSFER_SEED_SCENARIO_IDS.slice(1).map(
      (scenarioId) => makeManifest(scenarioId, "{}").manifest,
    );
    const { files } = makeManifest(M3_NON_TRANSFER_SEED_SCENARIO_IDS[0], "{}");
    let evaluatorCalls = 0;

    const result = replayM3ExperimentSet([blocked, ...runnable], {
      readFile: reader(files),
      evaluate: () => {
        evaluatorCalls += 1;
        throw new Error("mixed batches must fail closed");
      },
    });

    expect(result.seed_set_valid).toBe(true);
    expect(result.scenarios).toHaveLength(9);
    expect(result.scenarios.every((scenario) => !scenario.executed)).toBe(true);
    expect(result.scenarios[0]?.status).toBe("blocked");
    expect(
      result.scenarios
        .slice(1)
        .every((scenario) => scenario.status === "failed"),
    ).toBe(true);
    expect(evaluatorCalls).toBe(0);
    expect(
      result.blockers.some((item) => item.code === "batch_execution_blocked"),
    ).toBe(true);
  });

  it("replays the stored non-human readiness record as a blocked negative control", () => {
    const manifests =
      nonHumanSeedExperiment.scenarios as unknown as M3ExperimentManifest[];
    let evaluatorCalls = 0;
    let readerCalls = 0;

    const result = replayM3ExperimentSet(manifests, {
      readFile: () => {
        readerCalls += 1;
        throw new Error("blocked readiness records must not read artifacts");
      },
      evaluate: () => {
        evaluatorCalls += 1;
        throw new Error(
          "blocked readiness records must not execute the engine",
        );
      },
    });

    expect(result.seed_set_valid).toBe(true);
    expect(result.expected_scenario_ids).toEqual([
      ...M3_NON_TRANSFER_SEED_SCENARIO_IDS,
    ]);
    expect(result.supplied_scenario_ids).toEqual([
      ...M3_NON_TRANSFER_SEED_SCENARIO_IDS,
    ]);
    expect(result.supplied_scenario_ids).not.toContain("JP-XFR-002");
    expect(result.scenarios).toHaveLength(9);
    expect(
      result.scenarios.every(
        (scenario) =>
          scenario.status === "blocked" && scenario.executed === false,
      ),
    ).toBe(true);
    expect(evaluatorCalls).toBe(0);
    expect(readerCalls).toBe(0);
  });

  it("uses exact blocker codes for malformed context and assertions", () => {
    const { manifest } = makeManifest();
    const malformedContext = validateM3ExperimentManifest({
      ...manifest,
      serialized_context: 42 as unknown as string,
    });
    expect(
      malformedContext.blockers.some(
        (item) => item.code === "serialized_context_invalid",
      ),
    ).toBe(true);
    expect(
      malformedContext.blockers.some(
        (item) => item.code === "required_negative_assertions_missing",
      ),
    ).toBe(false);

    const missingAssertions = validateM3ExperimentManifest({
      ...manifest,
      required_negative_assertions: [],
    });
    expect(
      missingAssertions.blockers.some(
        (item) => item.code === "required_negative_assertions_missing",
      ),
    ).toBe(true);

    const duplicateAssertions = validateM3ExperimentManifest({
      ...manifest,
      required_negative_assertions: [
        "negative.synthetic",
        "negative.synthetic",
      ],
    });
    expect(
      duplicateAssertions.blockers.some(
        (item) => item.code === "required_negative_assertion_duplicate",
      ),
    ).toBe(true);
    expect(
      duplicateAssertions.blockers.some(
        (item) => item.code === "serialized_context_invalid",
      ),
    ).toBe(false);
  });

  it("validates a manifest before any bytes are read", () => {
    const { manifest } = makeManifest();
    const validation = validateM3ExperimentManifest(manifest);
    expect(validation.valid).toBe(true);
  });
});
