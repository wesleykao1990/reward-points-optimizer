import { readFileSync } from "node:fs";
import { canonicalHash, canonicalize } from "@jro/rule-engine";
import { describe, expect, it } from "vitest";
import { tryValidateDocument } from "../../contracts/src/index.ts";
import { evaluateM3Scenario, type M3ScenarioRecord } from "../src/m3-gate.ts";
import {
  buildJpCvs002GoldenScenario,
  hashJpCvs002PlanResult,
  JP_CVS_002_ACCEPT_RULE_ID,
  JP_CVS_002_ACCEPTED_PLAN_ID,
  JP_CVS_002_AMOUNT_JPY,
  JP_CVS_002_DENY_RULE_ID,
  JP_CVS_002_ENGINE_REPLAY_AT,
  JP_CVS_002_EVIDENCE_ID,
  JP_CVS_002_INDEPENDENT_COMPLETED_AT,
  JP_CVS_002_PLANS,
  JP_CVS_002_REPLAY_KNOWLEDGE_AT,
  JP_CVS_002_RULES,
  JP_CVS_002_SCENARIO_ID,
  JP_CVS_002_SCENARIO_RECORD,
  JP_CVS_002_SOURCE_ID,
  JP_CVS_002_TRANSACTION_TIME,
  JP_CVS_002_UNSUPPORTED_PLAN_ID,
  type JpCvs002GoldenScenario,
  projectJpCvs002GoldenPlanResult,
  projectJpCvs002GoldenReplayOutput,
  projectJpCvs002PlanResultForHash,
  projectJpCvs002Replay,
  replayJpCvs002,
} from "../src/m3-real-data-jp-cvs-002.ts";

interface ManualPlanExpectation {
  plan_id: string;
  payment_family: string;
  independent_expectation: {
    payment_acceptance: "accepted" | "rejected";
    eligible: boolean;
    reward_components: readonly unknown[];
    zero_point_placeholder: boolean;
    financially_ranked: boolean;
    rejection_rule_id?: string;
    reason: string;
  };
}

interface ManualExpectation {
  record_type: string;
  scenario_id: string;
  method: string;
  completed_at: string;
  transaction_time: string;
  replay_knowledge_at: string;
  purchase: {
    merchant_id: string;
    channel: string;
    amount_jpy: number;
    product_class: string;
  };
  source_basis: {
    source_id: string;
    evidence_id: string;
    snapshot_id: string;
    accepted_family_used: string;
    unsupported_tender_used: string;
  };
  plans: readonly ManualPlanExpectation[];
  invariants: readonly string[];
}

const manualExpectation = JSON.parse(
  readFileSync(
    new URL(
      "../../../fixtures/m3/real-data/jp-cvs-002/independent-expected-manual.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as ManualExpectation;

const scenarioRecord = JSON.parse(
  readFileSync(
    new URL(
      "../../../fixtures/m3/real-data/jp-cvs-002/scenario-record-reviewed.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as M3ScenarioRecord;

const paymentSnapshot = JSON.parse(
  readFileSync(
    new URL(
      "../../../fixtures/m3/source-snapshots/snap_m3_seveneleven_payment_methods_20260820.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as {
  facts?: readonly {
    accepted_payment_families?: readonly string[];
  }[];
};

const goldenScenario = JSON.parse(
  readFileSync(
    new URL(
      "../../../fixtures/m3/real-data/jp-cvs-002/golden-scenario.v1.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as JpCvs002GoldenScenario;

const goldenManifest = JSON.parse(
  readFileSync(
    new URL(
      "../../../fixtures/m3/real-data/jp-cvs-002/golden-scenario.v1.manifest.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as {
  scenario_id: string;
  fixture_path: string;
  canonical_fixture_hash: string;
  result_artifact_hashes: readonly {
    plan_id: string;
    result_artifact_hash: string;
  }[];
  replay_hashes: { input_hash: string; output_hash: string };
};

describe("JP-CVS-002 real-data M3 candidate", () => {
  it("replays exactly the two manually expected plans", () => {
    // Load and validate the independent artifact before the first engine call.
    expect(manualExpectation.record_type).toBe(
      "m3_jp_cvs_002_independent_expected",
    );
    expect(manualExpectation.method).toBe("manual");
    expect(manualExpectation.scenario_id).toBe(JP_CVS_002_SCENARIO_ID);
    expect(manualExpectation.completed_at).toBe(
      JP_CVS_002_INDEPENDENT_COMPLETED_AT,
    );
    expect(Date.parse(JP_CVS_002_INDEPENDENT_COMPLETED_AT)).toBeLessThan(
      Date.parse(JP_CVS_002_ENGINE_REPLAY_AT),
    );
    expect(manualExpectation.transaction_time).toBe(
      JP_CVS_002_TRANSACTION_TIME,
    );
    expect(manualExpectation.replay_knowledge_at).toBe(
      JP_CVS_002_REPLAY_KNOWLEDGE_AT,
    );
    expect(manualExpectation.purchase).toMatchObject({
      merchant_id: "merchant.seveneleven",
      channel: "in_store",
      amount_jpy: JP_CVS_002_AMOUNT_JPY,
      product_class: "ordinary",
    });
    expect(manualExpectation.source_basis).toMatchObject({
      source_id: JP_CVS_002_SOURCE_ID,
      evidence_id: JP_CVS_002_EVIDENCE_ID,
      accepted_family_used: "credit_card",
    });
    expect(paymentSnapshot.facts?.[0]?.accepted_payment_families).toContain(
      "credit_card",
    );
    expect(manualExpectation.plans.map((plan) => plan.plan_id)).toEqual([
      JP_CVS_002_ACCEPTED_PLAN_ID,
      JP_CVS_002_UNSUPPORTED_PLAN_ID,
    ]);
    expect(JP_CVS_002_PLANS).toHaveLength(2);

    const replay = replayJpCvs002();
    const actual = projectJpCvs002Replay(replay);
    const acceptedExpected = manualExpectation.plans[0];
    const unsupportedExpected = manualExpectation.plans[1];
    if (!acceptedExpected || !unsupportedExpected)
      throw new Error("manual expectation must cover both plans");

    const { reason: _acceptedReason, ...acceptedExpectation } =
      acceptedExpected.independent_expectation;
    expect({
      payment_acceptance: actual.accepted.eligible ? "accepted" : "rejected",
      eligible: actual.accepted.eligible,
      reward_components: actual.accepted.reward_components,
      zero_point_placeholder: actual.accepted.zero_point_placeholder,
      financially_ranked: actual.accepted.financially_ranked_plan_ids.includes(
        JP_CVS_002_ACCEPTED_PLAN_ID,
      ),
    }).toEqual(acceptedExpectation);

    const { reason: _unsupportedReason, ...unsupportedExpectation } =
      unsupportedExpected.independent_expectation;
    expect({
      payment_acceptance: actual.unsupported.eligible ? "accepted" : "rejected",
      eligible: actual.unsupported.eligible,
      reward_components: actual.unsupported.reward_components,
      zero_point_placeholder: actual.unsupported.zero_point_placeholder,
      financially_ranked: actual.unsupported.financially_ranked,
      rejection_rule_id: actual.unsupported.first_acceptance_rejection_rule_id,
    }).toEqual(unsupportedExpectation);
  });

  it("keeps acceptance non-financial and emits no fake zero-point reward", () => {
    expect(JP_CVS_002_RULES).toHaveLength(2);
    for (const rule of JP_CVS_002_RULES) {
      expect(rule.rule_type).toBe("payment_acceptance");
      expect(rule.effect?.effect_target).toBe("operation_eligibility");
      expect(rule.calculation).toBeUndefined();
      expect(rule.output).toBeUndefined();
      expect(rule.stacking.mode).toBe("non_reward_acceptance");
    }

    const replay = replayJpCvs002();
    expect(replay.accepted.applied_rule_ids).toContain(
      JP_CVS_002_ACCEPT_RULE_ID,
    );
    expect(replay.accepted.reward_components).toEqual([]);
    expect(replay.unsupported.reward_components).toEqual([]);
    expect(replay.accepted.reward_components).not.toContainEqual(
      expect.objectContaining({ quantity: { amount: "0" } }),
    );
    expect(replay.unsupported.reward_components).not.toContainEqual(
      expect.objectContaining({ quantity: { amount: "0" } }),
    );
  });

  it("denies the unsupported tender before it can enter financial ranking", () => {
    const replay = replayJpCvs002();
    const firstRejection = replay.unsupported.rejection_reasons[0];
    expect(firstRejection).toMatchObject({
      rule_id: JP_CVS_002_DENY_RULE_ID,
      code: "rule_excluded",
      operation_id: "op_jp_cvs_002_unsupported_tender",
    });
    expect(replay.unsupported.eligible).toBe(false);
    expect(replay.unsupported.reward_components).toHaveLength(0);
    expect(replay.recommendation.plans.map((plan) => plan.plan_id)).toEqual([
      JP_CVS_002_ACCEPTED_PLAN_ID,
    ]);
    expect(replay.recommendation.winner?.plan_id).toBe(
      JP_CVS_002_ACCEPTED_PLAN_ID,
    );
    expect(replay.recommendation.plans).not.toContainEqual(
      expect.objectContaining({ plan_id: JP_CVS_002_UNSUPPORTED_PLAN_ID }),
    );
  });

  it("records the approved scenario review without publishing a golden fixture", () => {
    expect(scenarioRecord).toEqual(JP_CVS_002_SCENARIO_RECORD);
    expect(scenarioRecord.status).toBe("reviewed");
    expect(scenarioRecord.review).toMatchObject({
      required_review_modes: ["solo_dual_pass", "agent_challenged"],
      review_mode: "agent_challenged",
      decision: "approved",
    });
    expect(
      scenarioRecord.review?.review_events?.map((event) => event.mode),
    ).toEqual(["solo_dual_pass", "agent_challenged"]);
    expect(scenarioRecord.candidate_plans).toHaveLength(2);
    expect(scenarioRecord.plan_results).toHaveLength(2);
    expect(scenarioRecord.independent_calculation?.method).toBe("manual");
    expect(scenarioRecord.engine_replay?.completed_at).toBe(
      JP_CVS_002_ENGINE_REPLAY_AT,
    );

    const gate = evaluateM3Scenario(scenarioRecord, {
      scenario_id: JP_CVS_002_SCENARIO_ID,
      source_ids: [JP_CVS_002_SOURCE_ID],
      promotion_ready: true,
      promotion_blockers: [],
    });
    expect(gate.can_promote_to_golden).toBe(true);
    expect(gate.safe_status).toBe("golden");
    expect(gate.blockers).toEqual([]);
  });

  it("materializes a schema-valid golden replay oracle with exact rule bindings", () => {
    const built = buildJpCvs002GoldenScenario();
    expect(canonicalize(goldenScenario)).toBe(canonicalize(built));

    const validation = tryValidateDocument(goldenScenario, "golden-scenario", {
      relatedRules: JP_CVS_002_RULES,
    });
    expect(validation.valid).toBe(true);
    expect(validation.issues).toEqual([]);
    expect(goldenScenario.status).toBe("golden");
    expect(goldenScenario.candidate_plans).toHaveLength(2);
    expect(goldenScenario.expected.plan_results).toHaveLength(2);
    expect(goldenScenario.expected.definite_winner_plan_id).toBe(
      JP_CVS_002_ACCEPTED_PLAN_ID,
    );

    const replay = replayJpCvs002();
    const nativeResults = [replay.accepted, replay.unsupported];
    for (const native of nativeResults) {
      const frozen = goldenScenario.expected.plan_results.find(
        (result) => result.plan_id === native.plan_id,
      );
      if (!frozen) throw new Error(`missing frozen result ${native.plan_id}`);
      expect(projectJpCvs002GoldenPlanResult(native)).toEqual(
        projectJpCvs002PlanResultForHash(frozen),
      );
      expect(hashJpCvs002PlanResult(frozen)).toBe(frozen.result_artifact_hash);
      expect(frozen.result_origin).toBe("engine");
      expect(frozen.preflight_rejection).toBeNull();
    }
  });

  it("recomputes the fixture, result, and replay hashes from canonical projections", () => {
    expect(goldenManifest).toMatchObject({
      scenario_id: JP_CVS_002_SCENARIO_ID,
      fixture_path: "golden-scenario.v1.json",
    });
    expect(goldenManifest.canonical_fixture_hash).toBe(
      canonicalHash(goldenScenario),
    );
    expect(goldenManifest.replay_hashes).toEqual({
      input_hash: goldenScenario.replay_provenance.input_hash,
      output_hash: goldenScenario.replay_provenance.output_hash,
    });
    expect(goldenScenario.asset_definitions).toEqual([]);
    expect(goldenManifest.replay_input_projection).toMatchObject({
      projection_version: "engine_candidates_input.v1",
      fixture_bindings: {
        plans: "candidate_plans",
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
    expect(goldenScenario.replay_provenance.output_hash).toBe(
      canonicalHash(projectJpCvs002GoldenReplayOutput(goldenScenario.expected)),
    );
    expect(goldenManifest.result_artifact_hashes).toEqual(
      goldenScenario.expected.plan_results.map((result) => ({
        plan_id: result.plan_id,
        result_artifact_hash: result.result_artifact_hash,
      })),
    );
  });

  it("keeps the golden status distinct from rule publication authorization", () => {
    expect(goldenScenario.replay_provenance).toMatchObject({
      rule_admission: "ephemeral_published_clone",
      publication_authorized: false,
    });
    expect(
      goldenScenario.rule_version_bindings.every(
        (binding) => binding.source_candidate_status === "under_review",
      ),
    ).toBe(true);
    expect(
      goldenScenario.rule_version_bindings.find(
        (binding) => binding.rule_id === JP_CVS_002_DENY_RULE_ID,
      )?.roles,
    ).toEqual(["rejected"]);
    expect(
      goldenScenario.rule_version_bindings.find(
        (binding) => binding.rule_id === JP_CVS_002_ACCEPT_RULE_ID,
      )?.roles,
    ).toEqual(["applied", "rejected"]);

    const accepted = goldenScenario.expected.plan_results.find(
      (result) => result.plan_id === JP_CVS_002_ACCEPTED_PLAN_ID,
    );
    const unsupported = goldenScenario.expected.plan_results.find(
      (result) => result.plan_id === JP_CVS_002_UNSUPPORTED_PLAN_ID,
    );
    expect(accepted?.reward_components).toEqual([]);
    expect(unsupported?.eligible).toBe(false);
    expect(unsupported?.reward_components).toEqual([]);
    expect(unsupported?.economics.guaranteed_net_value_change_jpy).toEqual({
      minimum_jpy: 0,
      maximum_jpy: 0,
      expected_jpy: 0,
    });
  });
});
