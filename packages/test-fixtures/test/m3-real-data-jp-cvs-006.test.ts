import { readFileSync } from "node:fs";
import { tryValidateDocument } from "@jro/contracts";
import { canonicalHash, evaluateCandidates } from "@jro/rule-engine";
import { describe, expect, it } from "vitest";
import independentCalculation from "../../../fixtures/m3/real-data/jp-cvs-006/independent-calculation.v0.1.json";
import integratedReplayArtifact from "../../../fixtures/m3/real-data/jp-cvs-006/integrated-replay.v0.1.json";
import reviewedScenario from "../../../fixtures/m3/real-data/jp-cvs-006/reviewed-scenario.v0.1.json";
import {
  evaluateM3Scenario,
  type M3ScenarioRecord,
  type M3ScenarioSourceReadiness,
} from "../src/m3-gate.ts";
import {
  buildJpCvs006GoldenManifest,
  buildJpCvs006GoldenScenario,
  canonicalJpCvs006GoldenScenarioHash,
  JP_CVS_006_ASSETS,
  JP_CVS_006_BELOW_MINIMUM_PLAN,
  JP_CVS_006_CANDIDATE_PLANS,
  JP_CVS_006_CASH_REGISTER_BOUNDARIES,
  JP_CVS_006_CONTEXT,
  JP_CVS_006_CREDIT_CHARGE_BOUNDARIES,
  JP_CVS_006_EVIDENCE_IDS,
  JP_CVS_006_INTEGRATED_REPLAY_ARTIFACT_ID,
  JP_CVS_006_OPERATION_IDS,
  JP_CVS_006_PLAN_IDS,
  JP_CVS_006_PREREGISTRATION_FACT_KEY,
  JP_CVS_006_PRIMARY_SOURCE_IDS,
  JP_CVS_006_PURCHASE,
  JP_CVS_006_REPLAY_ID,
  JP_CVS_006_REWARD_QUANTUM_JPY,
  JP_CVS_006_RULES,
  JP_CVS_006_VALID_PLAN,
  projectJpCvs006GoldenScenario,
  projectJpCvs006IntegratedReplay,
  replayJpCvs006Candidates,
  validateJpCvs006Candidate,
} from "../src/m3-real-data-jp-cvs-006.ts";

const goldenFixture = JSON.parse(
  readFileSync(
    new URL(
      "../../../fixtures/m3/real-data/jp-cvs-006/golden-scenario.v1.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as Record<string, unknown>;
const goldenManifest = JSON.parse(
  readFileSync(
    new URL(
      "../../../fixtures/m3/real-data/jp-cvs-006/golden-scenario.v1.manifest.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as {
  fixture_hash: string;
  canonical_fixture_hash: string;
  result_artifact_hashes: readonly {
    plan_id: string;
    result_artifact_hash: string;
  }[];
  replay_hashes: {
    input_hash: string;
    output_hash: string;
  };
  replay_input_projection: Record<string, unknown>;
  replay_output_projection: Record<string, unknown>;
};

describe("JP-CVS-006 real-data candidate slice", () => {
  it("records the independent arithmetic before replay and preserves the exact residual", () => {
    // This assertion intentionally precedes the only engine invocation in the
    // test.  The expected quantities below come from the manual artifact, not
    // from an engine snapshot.
    expect(independentCalculation.method).toBe("manual");
    expect(independentCalculation.status).toBe("completed");
    expect(independentCalculation.calculations).toHaveLength(2);

    const manualValid = independentCalculation.calculations[0];
    const manualRejected = independentCalculation.calculations[1];
    expect(manualValid?.plan_id).toBe(JP_CVS_006_PLAN_IDS.valid);
    expect(manualValid?.top_up.reward_formula).toBe("floor(5000 / 200)");
    expect(manualValid?.top_up.reward_quantity).toBe(25);
    expect(manualValid?.purchase.reward_formula).toBe("floor(600 / 200)");
    expect(manualValid?.purchase.reward_quantity).toBe(3);
    expect(
      manualValid?.principal_conservation.residual_nanaco_principal_jpy,
    ).toBe(4340);
    expect(manualRejected?.plan_id).toBe(JP_CVS_006_PLAN_IDS.belowMinimum);
    expect(manualRejected?.status).toBe("rejected");
    expect(manualRejected?.rejection.reward_calculation_performed).toBe(false);
    expect(manualRejected?.reward_calculation).toBeNull();

    const validPreflight = validateJpCvs006Candidate(JP_CVS_006_VALID_PLAN);
    const belowMinimumPreflight = validateJpCvs006Candidate(
      JP_CVS_006_BELOW_MINIMUM_PLAN,
    );
    expect(validPreflight).toEqual({
      plan_id: JP_CVS_006_PLAN_IDS.valid,
      eligible: true,
      reward_calculation_performed: false,
    });
    expect(belowMinimumPreflight.eligible).toBe(false);
    expect(belowMinimumPreflight.rejection_code).toBe(
      "credit_charge_below_minimum",
    );
    expect(belowMinimumPreflight.reward_calculation_performed).toBe(false);

    let evaluatorCalls = 0;
    const candidateReplay = replayJpCvs006Candidates(
      JP_CVS_006_CANDIDATE_PLANS,
      JP_CVS_006_CONTEXT,
      (plans, context) => {
        evaluatorCalls += 1;
        expect(plans.map((plan) => plan.plan_id)).toEqual([
          JP_CVS_006_PLAN_IDS.valid,
        ]);
        return evaluateCandidates([...plans], context);
      },
    );
    expect(evaluatorCalls).toBe(1);
    expect(candidateReplay.admitted_plan_ids).toEqual([
      JP_CVS_006_PLAN_IDS.valid,
    ]);
    expect(candidateReplay.rejected_plan_ids).toEqual([
      JP_CVS_006_PLAN_IDS.belowMinimum,
    ]);
    const replay = candidateReplay.recommendation;
    expect(replay).not.toBeNull();
    expect(replay.plans).toHaveLength(1);
    const evaluated = replay.plans[0];
    expect(evaluated?.eligible).toBe(true);
    expect(evaluated?.external_funding_jpy).toBe(5000n);
    expect(evaluated?.merchant_value_jpy).toBe(660n);
    expect(evaluated?.ending_asset_lots).toHaveLength(1);
    expect(evaluated?.ending_asset_lots[0]?.quantity.amount).toBe("4340");

    const rewardsByOperation = new Map<string, string>();
    for (const reward of evaluated?.reward_components ?? []) {
      rewardsByOperation.set(reward.operation_id, reward.quantity.amount);
    }
    expect(rewardsByOperation).toEqual(
      new Map([
        [JP_CVS_006_OPERATION_IDS.validTopUp, "25"],
        [JP_CVS_006_OPERATION_IDS.validPurchase, "3"],
      ]),
    );
    expect(
      (evaluated?.reward_components ?? []).filter(
        (reward) =>
          reward.operation_id === JP_CVS_006_OPERATION_IDS.validPurchase,
      ),
    ).toHaveLength(1);
    expect(
      evaluated?.reward_components.some(
        (reward) =>
          reward.operation_id === JP_CVS_006_OPERATION_IDS.validPurchase &&
          reward.quantity.amount === "25",
      ),
    ).toBe(false);

    const purchaseReward = evaluated?.reward_components.find(
      (reward) =>
        reward.operation_id === JP_CVS_006_OPERATION_IDS.validPurchase,
    );
    expect(purchaseReward?.calculation_trace).toMatchObject({
      eligible_basis: "eligible_line_items",
      spend_jpy: "600",
      denominator_jpy: JP_CVS_006_REWARD_QUANTUM_JPY,
      rounding_stage: "per_operation",
    });
    expect(evaluated?.economics.ending_asset_value_jpy.expected_jpy).toBe(
      "4340",
    );
    expect(evaluated?.economics.guaranteed_reward_value_jpy.expected_jpy).toBe(
      "28",
    );

    const integratedReplay = projectJpCvs006IntegratedReplay(candidateReplay);
    expect(integratedReplay).toEqual(integratedReplayArtifact);
    expect(integratedReplay.replay).toMatchObject({
      replay_id: JP_CVS_006_REPLAY_ID,
      completed_at: "2026-08-20T05:57:00+09:00",
      replay_knowledge_at: "2026-08-20T05:56:00+09:00",
    });
    expect(integratedReplay.plan_results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          plan_id: JP_CVS_006_PLAN_IDS.valid,
          produced_by: "engine",
          reward_components: expect.arrayContaining([
            expect.objectContaining({
              operation_id: JP_CVS_006_OPERATION_IDS.validTopUp,
              quantity: "25",
            }),
            expect.objectContaining({
              operation_id: JP_CVS_006_OPERATION_IDS.validPurchase,
              quantity: "3",
              calculation_trace: expect.objectContaining({
                spend_jpy: "600",
              }),
            }),
          ]),
          residual_nanaco_principal_jpy: "4340",
          external_funding_jpy: "5000",
        }),
        expect.objectContaining({
          plan_id: JP_CVS_006_PLAN_IDS.belowMinimum,
          produced_by: "preflight",
          eligible: false,
          rejection_code: "credit_charge_below_minimum",
          reward_calculation_performed: false,
          reward_components: [],
          preflight_rejection: {
            eligible: false,
            rejection_code: "credit_charge_below_minimum",
            reward_calculation_performed: false,
          },
        }),
      ]),
    );
    expect(integratedReplay.negative_assertions).toHaveLength(4);
    expect(integratedReplay.conservation).toMatchObject({
      status: "passed",
      residual_nanaco_principal_jpy: "4340",
    });
    expect(integratedReplay.ci_replay).toMatchObject({
      artifact_id: JP_CVS_006_INTEGRATED_REPLAY_ARTIFACT_ID,
      status: "passed",
    });
  });

  it("keeps the credit-charge boundary distinct from the cash-register boundary", () => {
    expect(JP_CVS_006_CREDIT_CHARGE_BOUNDARIES).toEqual({
      minimumJpy: 5000,
      incrementJpy: 1000,
      maximumJpy: 30000,
      postChargeBalanceLimitJpy: 50000,
    });
    expect(JP_CVS_006_CASH_REGISTER_BOUNDARIES).toEqual({
      incrementJpy: 1000,
      singleChargeLimitJpy: 49000,
      postChargeBalanceLimitJpy: 50000,
    });
    expect(JP_CVS_006_CREDIT_CHARGE_BOUNDARIES.maximumJpy).not.toBe(
      JP_CVS_006_CASH_REGISTER_BOUNDARIES.singleChargeLimitJpy,
    );
    expect(JP_CVS_006_VALID_PLAN.operations[0]?.amount_jpy).toBe(5000);
    expect(JP_CVS_006_VALID_PLAN.operations[0]?.amount_jpy).not.toBe(49000);
    expect(JP_CVS_006_VALID_PLAN.operations[1]?.amount_jpy).toBe(
      JP_CVS_006_PURCHASE.grossAmountJpy,
    );
  });

  it("uses explicit tax-exclusive line-item input and reviewed operation-scoped rules", () => {
    const purchase = JP_CVS_006_VALID_PLAN.operations[1];
    const line = purchase?.line_items[0];
    expect(line?.amount_jpy).toBe(660);
    expect(line?.tax_exclusive_amount_jpy).toBe(600);
    expect(
      JP_CVS_006_RULES.find(
        (rule) => rule.rule_id === "rr_jp_cvs_006_nanaco_purchase_reward",
      ),
    ).toMatchObject({
      status: "under_review",
      scope: { tax_basis: "tax_exclusive" },
      eligibility: {
        transaction_conditions: {
          eligible_amount_basis: "eligible_line_items",
        },
      },
    });
    expect(
      JP_CVS_006_RULES.every(
        (rule) =>
          rule.status === "under_review" &&
          rule.provenance.human_verified === false &&
          rule.audit.required_review_modes.includes("solo_dual_pass") &&
          rule.audit.required_review_modes.includes("agent_challenged") &&
          rule.audit.review_events.length === 0,
      ),
    ).toBe(true);
    expect(
      JP_CVS_006_CONTEXT.rules?.every(
        (rule) =>
          rule.status === "published" &&
          rule.provenance.review_notes?.includes("fixture-replay admission"),
      ),
    ).toBe(true);
    expect(JP_CVS_006_CANDIDATE_PLANS.map((plan) => plan.plan_id)).toEqual([
      JP_CVS_006_PLAN_IDS.valid,
      JP_CVS_006_PLAN_IDS.belowMinimum,
    ]);
  });

  it("fails candidate preflight when credit-charge preregistration is absent", () => {
    const baseUserState = JP_CVS_006_CONTEXT.user_state;
    expect(baseUserState).toBeDefined();
    if (!baseUserState) {
      throw new Error("fixture_user_state_missing");
    }
    const withoutPreregistration = {
      ...JP_CVS_006_CONTEXT,
      user_state: {
        ...baseUserState,
        facts: {},
      },
    };
    expect(
      validateJpCvs006Candidate(JP_CVS_006_VALID_PLAN, withoutPreregistration),
    ).toMatchObject({
      eligible: false,
      rejection_code: "credit_charge_preregistration_missing",
      reward_calculation_performed: false,
    });
    let evaluatorCalls = 0;
    const rejectedReplay = replayJpCvs006Candidates(
      [JP_CVS_006_VALID_PLAN],
      withoutPreregistration,
      (plans, context) => {
        evaluatorCalls += 1;
        return evaluateCandidates([...plans], context);
      },
    );
    expect(evaluatorCalls).toBe(0);
    expect(rejectedReplay.recommendation).toBeNull();
    expect(rejectedReplay.admitted_plan_ids).toEqual([]);
    expect(rejectedReplay.rejected_plan_ids).toEqual([
      JP_CVS_006_PLAN_IDS.valid,
    ]);
    expect(
      JP_CVS_006_CONTEXT.user_state?.facts[JP_CVS_006_PREREGISTRATION_FACT_KEY],
    ).toMatchObject({ status: "known", value: true });
    for (const ruleId of [
      "rr_jp_cvs_006_sevencard_credit_acceptance",
      "rr_jp_cvs_006_sevencard_credit_topup_reward",
    ]) {
      expect(
        JP_CVS_006_RULES.find((rule) => rule.rule_id === ruleId)?.eligibility
          .user_conditions,
      ).toEqual([
        expect.objectContaining({
          fact_key: JP_CVS_006_PREREGISTRATION_FACT_KEY,
          operator: "eq",
          value: true,
        }),
      ]);
    }
  });

  it("records the approved scenario review without publishing a golden fixture", () => {
    const record = reviewedScenario as unknown as M3ScenarioRecord;
    expect(record.scenario_id).toBe("JP-CVS-006");
    expect(record.status).toBe("reviewed");
    expect(record.review).toMatchObject({
      required_review_modes: ["solo_dual_pass", "agent_challenged"],
      review_mode: "agent_challenged",
      decision: "approved",
    });
    expect(record.review?.review_events?.map((event) => event.mode)).toEqual([
      "solo_dual_pass",
      "agent_challenged",
    ]);
    expect(record.primary_source_ids).toEqual([
      ...JP_CVS_006_PRIMARY_SOURCE_IDS,
    ]);
    expect(record.evidence_ids).toEqual([...JP_CVS_006_EVIDENCE_IDS]);
    expect(record.independent_calculation?.method).toBe("manual");
    expect(record.independent_calculation?.plan_ids).toEqual([
      JP_CVS_006_PLAN_IDS.valid,
      JP_CVS_006_PLAN_IDS.belowMinimum,
    ]);
    expect(record.plan_results).toHaveLength(2);
    expect(record.plan_results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          plan_id: JP_CVS_006_PLAN_IDS.valid,
          replay_id: JP_CVS_006_REPLAY_ID,
          produced_by: "engine",
        }),
        expect.objectContaining({
          plan_id: JP_CVS_006_PLAN_IDS.belowMinimum,
          replay_id: JP_CVS_006_REPLAY_ID,
          produced_by: "preflight",
          preflight_rejection: {
            eligible: false,
            rejection_code: "credit_charge_below_minimum",
            reward_calculation_performed: false,
          },
        }),
      ]),
    );
    expect(record.engine_replay).toMatchObject({
      replay_id: JP_CVS_006_REPLAY_ID,
      status: "passed",
      completed_at: "2026-08-20T05:57:00+09:00",
      result_plan_ids: [
        JP_CVS_006_PLAN_IDS.valid,
        JP_CVS_006_PLAN_IDS.belowMinimum,
      ],
    });
    expect(record.negative_assertions).toHaveLength(4);
    expect(
      record.negative_assertions?.every((item) => item.status === "passed"),
    ).toBe(true);
    expect(record.conservation).toMatchObject({
      status: "passed",
      checked_at: "2026-08-20T05:57:00+09:00",
    });
    expect(record.replay).toMatchObject({
      status: "passed",
      checked_at: "2026-08-20T05:57:00+09:00",
    });

    const readiness: M3ScenarioSourceReadiness = {
      scenario_id: "JP-CVS-006",
      source_ids: [...JP_CVS_006_PRIMARY_SOURCE_IDS],
      promotion_ready: true,
      promotion_blockers: [],
    };
    const gate = evaluateM3Scenario(record, readiness);
    expect(gate.can_promote_to_golden).toBe(true);
    expect(gate.safe_status).toBe("golden");
    expect(gate.blockers).toEqual([]);
  });

  it("materializes a schema-valid golden fixture with exact hashes and full ledgers", () => {
    const built = buildJpCvs006GoldenScenario();
    expect(built).toEqual(goldenFixture);
    const validation = tryValidateDocument(built, "golden-scenario", {
      relatedRules: JP_CVS_006_RULES,
    });
    expect(validation.valid).toBe(true);
    expect(canonicalJpCvs006GoldenScenarioHash(goldenFixture)).toBe(
      goldenManifest.fixture_hash,
    );
    expect(goldenManifest.canonical_fixture_hash).toBe(
      goldenManifest.fixture_hash,
    );
    expect(goldenManifest).toMatchObject(
      buildJpCvs006GoldenManifest(goldenFixture),
    );
    expect(goldenManifest.replay_hashes).toEqual({
      input_hash: goldenFixture.replay_provenance.input_hash,
      output_hash: goldenFixture.replay_provenance.output_hash,
    });
    expect(goldenManifest.replay_input_projection).toMatchObject({
      projection_version: "engine_candidates_input.v1",
      fixture_bindings: {
        plans: "candidate_plans[engine_origin]",
        "context.asset_definitions": "asset_definitions",
        "context.user_state": "user_state",
        "context.user_state.asset_lots": "user_state.asset_lots",
        "context.user_state.valuation_profile.entries":
          "user_state.valuation_profile.entries",
        "context.objective": "objective",
        "context.replay_knowledge_at": "replay_knowledge_at",
        "context.transaction_time": "as_of",
      },
    });
    expect(
      goldenManifest.replay_input_projection.base_context,
    ).not.toHaveProperty("assets");
    expect(JP_CVS_006_CONTEXT).not.toHaveProperty("valuation_profile");
    expect(goldenFixture.asset_definitions).toEqual(JP_CVS_006_ASSETS);
    expect(
      (
        goldenFixture.user_state as {
          valuation_profile: { entries: unknown[] };
        }
      ).valuation_profile.entries,
    ).toHaveLength(2);
    expect(goldenManifest.replay_output_projection).toMatchObject({
      projection_version: "golden_replay_output.v1",
      mode: "manifest_engine_canonical",
      fixture_binding: "expected.plan_results",
    });

    const results = (
      goldenFixture.expected as {
        plan_results: Record<string, unknown>[];
      }
    ).plan_results;
    expect(results).toHaveLength(2);
    for (const result of results) {
      const { result_artifact_hash: _hash, ...withoutHash } = result;
      expect(canonicalHash(withoutHash)).toBe(result.result_artifact_hash);
    }
    expect(goldenManifest.result_artifact_hashes).toEqual(
      results.map((result) => ({
        plan_id: result.plan_id,
        result_artifact_hash: result.result_artifact_hash,
      })),
    );

    const valid = results[0];
    const preflight = results[1];
    expect(valid).toMatchObject({
      plan_id: JP_CVS_006_PLAN_IDS.valid,
      eligible: true,
      result_origin: "engine",
      preflight_rejection: null,
      applied_rule_ids: expect.arrayContaining([
        "rr_jp_cvs_006_sevencard_credit_acceptance",
        "rr_jp_cvs_006_sevencard_credit_topup_reward",
        "rr_jp_cvs_006_nanaco_payment_acceptance",
        "rr_jp_cvs_006_nanaco_purchase_reward",
      ]),
    });
    expect(valid.economics).toMatchObject({
      guaranteed_reward_value_jpy: {
        minimum_jpy: 28,
        maximum_jpy: 28,
        expected_jpy: 28,
      },
      ending_asset_value_jpy: {
        minimum_jpy: 4340,
        maximum_jpy: 4340,
        expected_jpy: 4340,
      },
    });
    expect(preflight).toMatchObject({
      plan_id: JP_CVS_006_PLAN_IDS.belowMinimum,
      eligible: false,
      result_origin: "preflight",
      asset_movements: [],
      reward_components: [],
      ending_asset_lots: [],
      applied_rule_ids: [],
      rejected_rule_ids: [],
      rejection_reasons: ["credit_charge_below_minimum"],
      preflight_rejection: {
        rejection_code: "credit_charge_below_minimum",
        reward_calculation_performed: false,
      },
    });
    const preflightEconomics = preflight.economics as Record<
      string,
      { minimum_jpy: number; maximum_jpy: number; expected_jpy: number }
    >;
    expect(
      Object.values(preflightEconomics).every(
        (range) =>
          range.minimum_jpy === 0 &&
          range.maximum_jpy === 0 &&
          range.expected_jpy === 0,
      ),
    ).toBe(true);
  });

  it("invokes the evaluator once for only the admitted route and rejects hostile projections", () => {
    let evaluatorCalls = 0;
    const built = buildJpCvs006GoldenScenario((plans, context) => {
      evaluatorCalls += 1;
      expect(plans.map((plan) => plan.plan_id)).toEqual([
        JP_CVS_006_PLAN_IDS.valid,
      ]);
      return evaluateCandidates([...plans], context);
    });
    expect(evaluatorCalls).toBe(1);
    expect(built).toEqual(goldenFixture);

    const tampered = structuredClone(goldenFixture);
    const results = (
      tampered.expected as {
        plan_results: Record<string, unknown>[];
      }
    ).plan_results;
    const preflight = results[1];
    if (!preflight) throw new Error("golden_preflight_result_missing");
    preflight.asset_movements = [
      structuredClone(results[0]?.asset_movements?.[0]),
    ];
    const invalid = tryValidateDocument(tampered, "golden-scenario", {
      relatedRules: JP_CVS_006_RULES,
    });
    expect(invalid.valid).toBe(false);
    expect(
      invalid.issues.some((issue) => issue.path.includes("plan_results/1")),
    ).toBe(true);

    const projected = projectJpCvs006GoldenScenario(replayJpCvs006Candidates());
    expect(projected).toEqual(goldenFixture);
  });
});
