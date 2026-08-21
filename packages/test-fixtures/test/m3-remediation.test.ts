import { describe, expect, it } from "vitest";
import experimentJson from "../../../fixtures/m3/non-human-seed-experiment-2026-08-18.v0.1.json";
import remediationJson from "../../../fixtures/m3/remediation-proposals-2026-08-18.v0.1.json";
import {
  createM3RemediationProposalId,
  M3_NON_TRANSFER_SEED_SCENARIO_IDS,
  type M3FailedExperimentInput,
  type M3RemediationProposal,
  validateM3RemediationProposalSet,
} from "../src/index.ts";

const experiment = experimentJson as unknown as M3FailedExperimentInput;
const remediation = remediationJson as unknown as {
  proposals: readonly M3RemediationProposal[];
};

function proposalsFor(value: M3FailedExperimentInput): M3RemediationProposal[] {
  const readiness = value.source_gate?.source_readiness ?? [];
  return M3_NON_TRANSFER_SEED_SCENARIO_IDS.map((scenarioId) => {
    const sourceIds = [
      ...(value.scenarios?.find((item) => item.scenario_id === scenarioId)
        ?.primary_source_ids ?? []),
    ];
    const covered = sourceIds.flatMap((sourceId) => {
      const item = readiness.find(
        (candidate) => candidate.source_id === sourceId,
      );
      return (item?.promotion_blocker_codes ?? []).map((code) => ({
        source_id: sourceId,
        code: code as never,
      }));
    });
    return {
      proposal_id: createM3RemediationProposalId(
        scenarioId,
        "permission_review",
      ),
      scenario_id: scenarioId,
      action: "permission_review",
      mapping_before: sourceIds,
      mapping_after: [...sourceIds],
      covered_source_blockers: covered,
      authority: { status: "uncertain" },
      first_party: { status: "uncertain" },
      terms: { status: "restricted_observed" },
      provenance: { status: "recorded" },
      intent:
        "Obtain an explicit source-specific authority and terms decision.",
      rollback:
        "Keep the current mapping and blocked gate until review completes.",
      assessment: {
        verified: ["The current source gate is blocked."],
        inference: [],
        uncertainty: ["Authority and terms remain unresolved."],
        recommendation: ["Request permission review."],
        decisions: ["No promotion decision."],
      },
      approval: { status: "pending", human_approval: false },
      promotion: { status: "blocked", gate_override: false },
    };
  });
}

describe("M3 remediation fixture governance", () => {
  it("validates the recorded remediation artifact against the failed experiment", () => {
    const beforeExperiment = structuredClone(experiment);
    const beforeRemediation = structuredClone(remediation);
    const result = validateM3RemediationProposalSet(
      experiment,
      remediation.proposals,
    );
    expect(result.valid).toBe(true);
    expect(result.expected_scenario_ids).toEqual([
      ...M3_NON_TRANSFER_SEED_SCENARIO_IDS,
    ]);
    expect(result.expected_blockers).toHaveLength(101);
    expect(result.covered_blockers).toHaveLength(101);
    expect(result.expected_scenario_scoped_blockers).toHaveLength(107);
    expect(result.covered_scenario_scoped_blockers).toHaveLength(107);
    expect(result.uncovered_blockers).toEqual([]);
    expect(result.summary.action_membership_count).toBe(31);
    expect(result.summary.scenario_scoped_blocker_count).toBe(107);
    expect(result.summary.proposals_by_action).toMatchObject({
      retain_source: 6,
      permission_review: 9,
      technical_access: 9,
      add_official_source: 4,
      narrow_split_scenario: 3,
    });
    expect(result.human_approval).toBe(false);
    expect(result.promotion_blocked).toBe(true);
    expect(result.gate_override).toBe(false);
    expect(experiment).toEqual(beforeExperiment);
    expect(remediation).toEqual(beforeRemediation);
  });

  it("accepts exactly the nine non-transfer proposals and covers every scoped blocker", () => {
    const result = validateM3RemediationProposalSet(
      experiment,
      proposalsFor(experiment),
    );
    expect(result.valid).toBe(true);
    expect(result.expected_scenario_ids).toEqual([
      ...M3_NON_TRANSFER_SEED_SCENARIO_IDS,
    ]);
    expect(result.expected_blockers.length).toBe(101);
    expect(result.uncovered_blockers).toEqual([]);
    expect(result.promotion_ready).toBe(false);
    expect(result.promotion_blocked).toBe(true);
  });

  it("is deterministic and does not mutate the experiment or proposals", () => {
    const proposals = proposalsFor(experiment);
    const beforeExperiment = structuredClone(experiment);
    const beforeProposals = structuredClone(proposals);
    const first = validateM3RemediationProposalSet(experiment, proposals);
    const second = validateM3RemediationProposalSet(experiment, proposals);
    expect(second).toEqual(first);
    expect(experiment).toEqual(beforeExperiment);
    expect(proposals).toEqual(beforeProposals);
  });

  it("requires every mapping_before to match the authoritative mapping", () => {
    const proposals = proposalsFor(experiment);
    proposals[0].mapping_before = ["jp.not-authoritative"];
    const result = validateM3RemediationProposalSet(experiment, proposals);
    expect(result.valid).toBe(false);
    expect(
      result.issues.some((issue) => issue.code === "mapping_before_mismatch"),
    ).toBe(true);
  });

  it("keeps approval pending and rejects a gate override", () => {
    const proposals = proposalsFor(experiment);
    proposals[0].approval = {
      status: "pending",
      human_approval: true,
    } as never;
    proposals[1].promotion = {
      status: "blocked",
      gate_override: true,
    } as never;
    const result = validateM3RemediationProposalSet(experiment, proposals);
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "human_approval_not_false",
        "gate_override_not_false",
      ]),
    );
    expect(result.human_approval).toBe(false);
    expect(result.gate_override).toBe(false);
  });

  it("rejects duplicate action memberships and duplicate grouped blocker codes", () => {
    const proposals = structuredClone(
      remediation.proposals,
    ) as M3RemediationProposal[];
    proposals[0].actions = [...(proposals[0].actions ?? []), "retain_source"];
    proposals[1].covered_source_blockers = [
      {
        source_id: "merchant.seveneleven.nanaco",
        codes: [
          "registry_collection_path_not_permitted",
          "registry_collection_path_not_permitted",
        ],
      },
    ] as never;
    const result = validateM3RemediationProposalSet(experiment, proposals);
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["action_duplicate", "covered_blocker_duplicate"]),
    );
  });

  it("requires a note and source requirements for null pending mappings", () => {
    const proposals = structuredClone(
      remediation.proposals,
    ) as M3RemediationProposal[];
    const proposal = proposals.find(
      (item) => item.scenario_id === "JP-CMP-003",
    );
    if (!proposal) throw new Error("fixture proposal missing");
    proposal.mapping_after = null;
    delete proposal.mapping_after_note;
    delete proposal.candidate_source_requirements;
    const result = validateM3RemediationProposalSet(experiment, proposals);
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "mapping_after_note_missing",
        "candidate_source_requirements_missing",
      ]),
    );
  });

  it("does not let shared-source coverage from another scenario satisfy this scenario", () => {
    const proposals = structuredClone(
      remediation.proposals,
    ) as M3RemediationProposal[];
    const proposal = proposals.find(
      (item) => item.scenario_id === "JP-CMP-007",
    );
    if (!proposal) throw new Error("fixture proposal missing");
    proposal.covered_source_blockers = proposal.covered_source_blockers?.filter(
      (item) =>
        !(
          !Array.isArray(item) &&
          "source_id" in item &&
          item.source_id === "jp.paypay.campaigns"
        ),
    );
    const result = validateM3RemediationProposalSet(experiment, proposals);
    expect(result.valid).toBe(false);
    expect(
      result.issues.some(
        (issue) =>
          issue.code === "covered_blocker_missing" &&
          issue.scenario_id === "JP-CMP-007" &&
          issue.source_id === "jp.paypay.campaigns",
      ),
    ).toBe(true);
  });

  it("rejects an uncovered blocker, duplicate ID, and transfer proposal", () => {
    const proposals = proposalsFor(experiment);
    proposals[0].covered_source_blockers =
      proposals[0].covered_source_blockers?.slice(1);
    proposals[1].proposal_id = proposals[0].proposal_id;
    proposals[2].scenario_id = "JP-XFR-002";
    const result = validateM3RemediationProposalSet(experiment, proposals);
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "covered_blocker_missing",
        "duplicate_proposal_id",
        "scenario_not_in_non_transfer_seed_set",
      ]),
    );
  });

  it("requires a recorded authority mismatch or retirement for replacement", () => {
    const proposals = proposalsFor(experiment);
    const proposal = proposals[0];
    proposal.action = "replace_source";
    proposal.proposal_id = createM3RemediationProposalId(
      proposal.scenario_id,
      "replace_source",
    );
    proposal.mapping_after = {
      status: "pending",
      source_ids: ["candidate.source", ...proposal.mapping_before.slice(1)],
    };
    proposal.candidate_source = { source_id: "candidate.source" };
    const result = validateM3RemediationProposalSet(experiment, proposals);
    expect(result.valid).toBe(false);
    expect(
      result.issues.some((issue) => issue.code === "replace_basis_missing"),
    ).toBe(true);
    expect(
      result.issues.some(
        (issue) => issue.code === "replace_basis_not_recorded",
      ),
    ).toBe(true);
  });

  it("rejects engine_gap for the source-blocked run and never treats restricted observation as approval", () => {
    const proposals = proposalsFor(experiment);
    proposals[0].action = "engine_gap";
    proposals[0].proposal_id = createM3RemediationProposalId(
      proposals[0].scenario_id,
      "engine_gap",
    );
    proposals[0].terms = { status: "restricted_observed" };
    const result = validateM3RemediationProposalSet(experiment, proposals);
    expect(result.valid).toBe(false);
    expect(
      result.issues.some((issue) => issue.code === "engine_gap_not_allowed"),
    ).toBe(true);
    expect(
      result.issues.some(
        (issue) => issue.code === "engine_gap_evidence_incomplete",
      ),
    ).toBe(true);
    expect(result.promotion_ready).toBe(false);
  });
});
