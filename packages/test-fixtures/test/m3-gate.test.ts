import { describe, expect, it } from "vitest";
import {
  evaluateM3PromotionGate,
  evaluateM3Scenario,
  evaluateM3SeedSet,
  M3_AUTHORITATIVE_PRIMARY_SOURCE_IDS,
  M3_SEED_SCENARIO_IDS,
  type M3ScenarioRecord,
  type M3ScenarioSourceReadiness,
  type M3SeedScenarioId,
  type M3SourceGateResultInput,
} from "../src/index.ts";

const ISO = {
  independent: "2026-08-17T12:00:00+09:00",
  engine: "2026-08-17T12:10:00+09:00",
  checks: "2026-08-17T12:20:00+09:00",
  reviews: "2026-08-17T12:30:00+09:00",
};

/** Synthetic project-test-only state; it contains no merchant facts. */
function authoritativeSourceIds(scenarioId: string): readonly string[] {
  return M3_AUTHORITATIVE_PRIMARY_SOURCE_IDS[scenarioId as M3SeedScenarioId];
}

function syntheticSourceReadiness(
  scenarioId: string,
): M3ScenarioSourceReadiness {
  return {
    scenario_id: scenarioId,
    source_ids: [...authoritativeSourceIds(scenarioId)],
    promotion_ready: true,
    promotion_blockers: [],
  };
}

function syntheticSourceGate(
  records: readonly M3ScenarioRecord[],
): M3SourceGateResultInput {
  return {
    promotion_ready: true,
    scenario_readiness: records.map((record) =>
      syntheticSourceReadiness(record.scenario_id),
    ),
    promotion_blockers: [],
  };
}

function completeSyntheticScenario(
  scenarioId: string,
  status: M3ScenarioRecord["status"] = "reviewed",
): M3ScenarioRecord {
  const transfer = scenarioId === "JP-XFR-002";
  const sourceIds = authoritativeSourceIds(scenarioId);
  const evidenceIds = sourceIds.map(
    (_, index) => `ev_test_${scenarioId.toLowerCase()}_${index}`,
  );
  const reviewEvents = transfer
    ? [
        {
          mode: "human_second_review" as const,
          reviewer_id: "synthetic-human-reviewer",
          completed_at: ISO.reviews,
          decision: "approved" as const,
          notes: "Synthetic review event only.",
        },
      ]
    : [
        {
          mode: "solo_dual_pass" as const,
          reviewer_id: "synthetic-builder",
          completed_at: ISO.reviews,
          decision: "approved" as const,
          notes: "Synthetic solo pass only.",
        },
        {
          mode: "agent_challenged" as const,
          reviewer_id: "synthetic-agent-challenger",
          completed_at: "2026-08-17T12:31:00+09:00",
          decision: "approved" as const,
          notes: "Synthetic challenge only.",
        },
      ];

  return {
    scenario_id: scenarioId,
    status,
    primary_source_ids: [...sourceIds],
    evidence_ids: evidenceIds,
    evidence: sourceIds.map((sourceId, index) => ({
      evidence_id: evidenceIds[index] ?? `ev_test_fallback_${index}`,
      first_party: true,
      status: "verified" as const,
      review_decision: "approved" as const,
      // The evidence content is synthetic; this ID only exercises the
      // authoritative source mapping copied from the seed blueprint.
      source_id: sourceId,
    })),
    candidate_plans: [
      { plan_id: "plan_test_direct" },
      { plan_id: "plan_test_alternative" },
    ],
    plan_results: [
      {
        plan_id: "plan_test_direct",
        result_artifact_id: "result_test_direct",
        replay_id: "replay_test_engine",
        produced_by: "engine",
      },
      {
        plan_id: "plan_test_alternative",
        result_artifact_id: "result_test_alternative",
        replay_id: "replay_test_engine",
        produced_by: "engine",
      },
    ],
    independent_calculation: {
      artifact_id: "calc_test_independent",
      status: "completed",
      completed_at: ISO.independent,
      method: "spreadsheet",
      plan_ids: ["plan_test_direct", "plan_test_alternative"],
    },
    engine_replay: {
      replay_id: "replay_test_engine",
      status: "passed",
      completed_at: ISO.engine,
      result_plan_ids: ["plan_test_direct", "plan_test_alternative"],
    },
    required_negative_assertions: ["negative_test_exclusion"],
    negative_assertions: [
      {
        assertion_id: "negative_test_exclusion",
        status: "passed",
        checked_at: ISO.checks,
        artifact_id: "negative_test_artifact",
      },
    ],
    conservation: {
      artifact_id: "conservation_test_artifact",
      status: "passed",
      checked_at: ISO.checks,
    },
    replay: {
      artifact_id: "replay_test_ci_artifact",
      status: "passed",
      checked_at: ISO.checks,
    },
    builder_id: "synthetic-builder",
    primary_reviewer_id: "synthetic-primary",
    review: {
      required_review_modes: transfer
        ? ["human_second_review"]
        : ["solo_dual_pass", "agent_challenged"],
      review_mode: transfer ? "human_second_review" : "agent_challenged",
      calculated_by: "synthetic-builder",
      decision: "approved",
      review_events: reviewEvents,
    },
  };
}

function blockerCodes(result: {
  blockers: readonly { code: string }[];
}): string[] {
  return result.blockers.map((blocker) => blocker.code);
}

describe("M3 scenario promotion gate", () => {
  it("promotes a complete synthetic record and keeps the review policy honest", () => {
    const normalRecord = completeSyntheticScenario("JP-CVS-002");
    const normal = evaluateM3Scenario(
      normalRecord,
      syntheticSourceReadiness(normalRecord.scenario_id),
    );
    const transferRecord = completeSyntheticScenario("JP-XFR-002");
    const transfer = evaluateM3Scenario(
      transferRecord,
      syntheticSourceReadiness(transferRecord.scenario_id),
    );

    expect(normal.can_promote_to_golden).toBe(true);
    expect(normal.safe_status).toBe("golden");
    expect(transfer.can_promote_to_golden).toBe(true);
    expect(transfer.required_review_modes).toEqual(["human_second_review"]);
  });

  it("fails closed when scenario source readiness is omitted", () => {
    const record = completeSyntheticScenario("JP-CVS-002");
    const result = evaluateM3Scenario(record, undefined);

    expect(result.can_promote_to_golden).toBe(false);
    expect(blockerCodes(result)).toContain("source_readiness_missing");
  });

  it("accepts all ten synthetic records only when the exact seed set is present", () => {
    const records = M3_SEED_SCENARIO_IDS.map((scenarioId) =>
      completeSyntheticScenario(scenarioId),
    );
    const result = evaluateM3SeedSet(records, syntheticSourceGate(records));

    expect(result.seed_set_valid).toBe(true);
    expect(result.can_promote_all).toBe(true);
    expect(result.scenarios).toHaveLength(10);
  });

  it("keeps every early state representable but never promotable", () => {
    const earlyStatuses: M3ScenarioRecord["status"][] = [
      "planned",
      "to_be_researched",
      "candidate",
      "researched",
      "calculated",
      "under_review",
    ];

    for (const status of earlyStatuses) {
      const record = completeSyntheticScenario("JP-CVS-002", status);
      const result = evaluateM3Scenario(
        record,
        syntheticSourceReadiness(record.scenario_id),
      );
      expect(result.state_valid).toBe(true);
      expect(result.can_promote_to_golden).toBe(false);
      expect(blockerCodes(result)).toContain("status_not_promotable");
    }
  });

  it("fails closed for a same-person transfer second review", () => {
    const source = completeSyntheticScenario("JP-XFR-002");
    const record: M3ScenarioRecord = {
      ...source,
      review: {
        ...source.review,
        review_events: source.review?.review_events?.map((event) => ({
          ...event,
          reviewer_id: "synthetic-builder",
        })),
      },
    };

    expect(
      blockerCodes(
        evaluateM3Scenario(
          record,
          syntheticSourceReadiness(record.scenario_id),
        ),
      ),
    ).toContain("transfer_reviewer_not_independent");
  });

  it("requires independent calculation to finish before engine replay", () => {
    const source = completeSyntheticScenario("JP-CVS-002");
    const record: M3ScenarioRecord = {
      ...source,
      independent_calculation: {
        ...source.independent_calculation,
        completed_at: ISO.engine,
      },
      engine_replay: {
        ...source.engine_replay,
        completed_at: ISO.independent,
      },
    };

    expect(
      blockerCodes(
        evaluateM3Scenario(
          record,
          syntheticSourceReadiness(record.scenario_id),
        ),
      ),
    ).toContain("engine_replay_before_independent_calculation");
  });

  it("blocks missing evidence, negative assertion, replay, and conservation artifacts", () => {
    const source = completeSyntheticScenario("JP-CVS-006");
    const record: M3ScenarioRecord = {
      ...source,
      evidence_ids: [],
      evidence: [],
      negative_assertions: [],
      conservation: undefined,
      replay: undefined,
    };
    const codes = blockerCodes(
      evaluateM3PromotionGate(
        record,
        syntheticSourceReadiness(record.scenario_id),
      ),
    );

    expect(codes).toContain("missing_evidence");
    expect(codes).toContain("required_negative_assertions_missing");
    expect(codes).toContain("conservation_check_missing");
    expect(codes).toContain("replay_check_missing");
  });

  it("requires every evidence item to name a declared primary source", () => {
    const source = completeSyntheticScenario("JP-CVS-014");
    const missingSourceId: M3ScenarioRecord = {
      ...source,
      evidence: source.evidence?.map(
        ({ source_id: _sourceId, ...item }) => item,
      ),
    };
    const unexpectedSourceId: M3ScenarioRecord = {
      ...source,
      evidence: source.evidence?.map((item) => ({
        ...item,
        source_id: "source.synthetic.unexpected",
      })),
    };

    expect(
      blockerCodes(
        evaluateM3Scenario(
          missingSourceId,
          syntheticSourceReadiness(missingSourceId.scenario_id),
        ),
      ),
    ).toContain("evidence_source_id_missing");
    expect(
      blockerCodes(
        evaluateM3Scenario(
          unexpectedSourceId,
          syntheticSourceReadiness(unexpectedSourceId.scenario_id),
        ),
      ),
    ).toContain("evidence_source_id_unexpected");
  });

  it("requires verified evidence and an approved review decision", () => {
    const source = completeSyntheticScenario("JP-CVS-002");
    const missingApproval: M3ScenarioRecord = {
      ...source,
      evidence: source.evidence?.map((item) => ({
        ...item,
        review_decision: "pending",
      })),
    };
    const unverified: M3ScenarioRecord = {
      ...source,
      evidence: source.evidence?.map((item) => ({
        ...item,
        status: "captured",
      })),
    };

    expect(
      blockerCodes(
        evaluateM3Scenario(
          missingApproval,
          syntheticSourceReadiness(missingApproval.scenario_id),
        ),
      ),
    ).toContain("evidence_not_approved_or_verified");
    expect(
      blockerCodes(
        evaluateM3Scenario(
          unverified,
          syntheticSourceReadiness(unverified.scenario_id),
        ),
      ),
    ).toContain("evidence_not_approved_or_verified");
  });

  it("requires each declared primary source to be covered by acceptable evidence", () => {
    const source = completeSyntheticScenario("JP-QR-008");
    const record: M3ScenarioRecord = {
      ...source,
      primary_source_ids: [
        ...source.primary_source_ids,
        "source.synthetic.uncovered",
      ],
    };

    expect(
      blockerCodes(
        evaluateM3Scenario(
          record,
          syntheticSourceReadiness(record.scenario_id),
        ),
      ),
    ).toContain("primary_source_uncovered");
  });

  it("rejects duplicate plan ids instead of treating them as an exact set", () => {
    const source = completeSyntheticScenario("JP-CVS-002");
    const record: M3ScenarioRecord = {
      ...source,
      independent_calculation: {
        ...source.independent_calculation,
        plan_ids: ["plan_test_direct", "plan_test_direct"],
      },
      engine_replay: {
        ...source.engine_replay,
        result_plan_ids: ["plan_test_direct", "plan_test_direct"],
      },
    };
    const codes = blockerCodes(
      evaluateM3Scenario(record, syntheticSourceReadiness(record.scenario_id)),
    );

    expect(codes).toContain("independent_calculation_plan_coverage_missing");
    expect(codes).toContain("plan_result_invalid");
  });

  it("accepts an explicitly preflight-rejected candidate with accountable replay coverage", () => {
    const source = completeSyntheticScenario("JP-CVS-006");
    const rejectedPlanId = "plan_test_alternative";
    const record: M3ScenarioRecord = {
      ...source,
      // The candidate payload is intentionally opaque to this generic gate;
      // the result provenance records that this candidate was rejected before
      // reward calculation rather than pretending that the engine produced it.
      candidate_plans: source.candidate_plans?.map((plan) =>
        plan.plan_id === rejectedPlanId
          ? {
              ...plan,
              candidate: {
                preflight: {
                  eligible: false,
                  reward_calculation_performed: false,
                },
              },
            }
          : plan,
      ),
      plan_results: source.plan_results?.map((result) =>
        result.plan_id === rejectedPlanId
          ? {
              ...result,
              produced_by: "preflight" as const,
              preflight_rejection: {
                eligible: false as const,
                rejection_code: "candidate_preflight_rejected",
                reward_calculation_performed: false as const,
              },
            }
          : result,
      ),
    };
    const result = evaluateM3Scenario(
      record,
      syntheticSourceReadiness(record.scenario_id),
    );

    expect(result.can_promote_to_golden).toBe(true);
    expect(result.blockers).toEqual([]);
  });

  it("requires exact rejection metadata for preflight provenance", () => {
    const source = completeSyntheticScenario("JP-CVS-006");
    const sourceResults = source.plan_results ?? [];
    const rejectedPlanId = "plan_test_alternative";
    const rejectionMetadata = {
      eligible: false,
      rejection_code: "candidate_preflight_rejected",
      reward_calculation_performed: false,
    };
    const readiness = syntheticSourceReadiness(source.scenario_id);
    const evaluate = (record: M3ScenarioRecord) =>
      evaluateM3Scenario(record, readiness);
    const withPreflightMetadata = (metadata: unknown) =>
      ({
        ...source,
        plan_results: sourceResults.map((result) =>
          result.plan_id === rejectedPlanId
            ? {
                ...result,
                produced_by: "preflight",
                preflight_rejection: metadata,
              }
            : result,
        ),
      }) as unknown as M3ScenarioRecord;

    const withoutMetadata = {
      ...source,
      plan_results: sourceResults.map((result) =>
        result.plan_id === rejectedPlanId
          ? { ...result, produced_by: "preflight" }
          : result,
      ),
    } as unknown as M3ScenarioRecord;
    expect(blockerCodes(evaluate(withoutMetadata))).toContain(
      "plan_result_invalid",
    );

    expect(
      blockerCodes(
        evaluate(
          withPreflightMetadata({
            ...rejectionMetadata,
            eligible: true,
          }),
        ),
      ),
    ).toContain("plan_result_invalid");
    expect(
      blockerCodes(
        evaluate(
          withPreflightMetadata({
            ...rejectionMetadata,
            reward_calculation_performed: true,
          }),
        ),
      ),
    ).toContain("plan_result_invalid");
    for (const rejection_code of ["", "  ", 42]) {
      expect(
        blockerCodes(
          evaluate(
            withPreflightMetadata({
              ...rejectionMetadata,
              rejection_code,
            }),
          ),
        ),
      ).toContain("plan_result_invalid");
    }

    const engineWithMetadata = {
      ...source,
      plan_results: sourceResults.map((result) =>
        result.plan_id === rejectedPlanId
          ? { ...result, preflight_rejection: rejectionMetadata }
          : result,
      ),
    };
    expect(blockerCodes(evaluate(engineWithMetadata))).toContain(
      "plan_result_invalid",
    );
  });

  it("fails closed for legacy provenance and incomplete preflight pairings", () => {
    const source = completeSyntheticScenario("JP-CVS-006");
    const sourceResults = source.plan_results ?? [];
    const firstResult = sourceResults[0];
    const secondResult = sourceResults[1];
    if (!firstResult || !secondResult) {
      throw new Error("Synthetic scenario must contain two plan results.");
    }
    const readiness = syntheticSourceReadiness(source.scenario_id);
    const evaluate = (record: M3ScenarioRecord) =>
      evaluateM3Scenario(record, readiness);

    const legacyOther = {
      ...source,
      plan_results: sourceResults.map((result, index) =>
        index === 1 ? { ...result, produced_by: "other" } : result,
      ),
    } as unknown as M3ScenarioRecord;
    expect(blockerCodes(evaluate(legacyOther))).toContain(
      "plan_result_invalid",
    );

    const missingResult = {
      ...source,
      plan_results: [firstResult],
    };
    expect(blockerCodes(evaluate(missingResult))).toContain(
      "plan_result_pairing_missing",
    );

    const duplicateResult = {
      ...source,
      plan_results: [firstResult, { ...firstResult }],
    };
    expect(blockerCodes(evaluate(duplicateResult))).toContain(
      "plan_result_pairing_missing",
    );

    const mismatchedResult = {
      ...source,
      plan_results: [
        firstResult,
        { ...secondResult, plan_id: "plan_test_unexpected" },
      ],
    };
    expect(blockerCodes(evaluate(mismatchedResult))).toContain(
      "plan_result_pairing_missing",
    );

    const invalidPreflightArtifact = {
      ...source,
      plan_results: sourceResults.map((result, index) =>
        index === 1
          ? {
              ...result,
              produced_by: "preflight" as const,
              result_artifact_id: "",
              replay_id: "replay_wrong",
            }
          : result,
      ),
    };
    expect(blockerCodes(evaluate(invalidPreflightArtifact))).toContain(
      "plan_result_invalid",
    );
  });

  it("rejects substituted authoritative sources for JP-CVS-002", () => {
    const record = completeSyntheticScenario("JP-CVS-002");
    const readiness = syntheticSourceReadiness(record.scenario_id);
    const substitutedReadiness: M3ScenarioSourceReadiness = {
      ...readiness,
      source_ids: ["jp.rakutenpay.change-notice-2026"],
    };
    const result = evaluateM3Scenario(record, substitutedReadiness);

    expect(blockerCodes(result)).toContain(
      "source_readiness_source_set_mismatch",
    );

    const substitutedRecord: M3ScenarioRecord = {
      ...record,
      primary_source_ids: ["jp.rakutenpay.change-notice-2026"],
    };
    const substitutedRecordResult = evaluateM3Scenario(
      substitutedRecord,
      readiness,
    );
    expect(blockerCodes(substitutedRecordResult)).toContain(
      "primary_source_set_mismatch",
    );
  });

  it("requires a promotion-ready whole source-gate result for seed promotion", () => {
    const records = M3_SEED_SCENARIO_IDS.map((scenarioId) =>
      completeSyntheticScenario(scenarioId),
    );
    const sourceGate = syntheticSourceGate(records);
    const blockedSourceGate: M3SourceGateResultInput = {
      ...sourceGate,
      promotion_ready: false,
      promotion_blockers: [
        {
          code: "synthetic_source_not_ready",
          detail: "Synthetic test-only source gate blocker.",
        },
      ],
    };
    const result = evaluateM3SeedSet(records, blockedSourceGate);

    expect(result.can_promote_all).toBe(false);
    expect(blockerCodes(result)).toContain("source_gate_not_ready");
    expect(blockerCodes(result)).toContain("source_gate_blocked");

    const missingResult = evaluateM3SeedSet(records, undefined);
    expect(missingResult.can_promote_all).toBe(false);
    expect(blockerCodes(missingResult)).toContain("source_gate_missing");
  });

  it("rejects an incorrect ten-id set", () => {
    const records = M3_SEED_SCENARIO_IDS.slice(0, -1).map((scenarioId) =>
      completeSyntheticScenario(scenarioId),
    );
    const result = evaluateM3SeedSet(records, syntheticSourceGate(records));

    expect(result.seed_set_valid).toBe(false);
    expect(result.can_promote_all).toBe(false);
    expect(blockerCodes(result)).toContain("seed_set_mismatch");
  });
});
