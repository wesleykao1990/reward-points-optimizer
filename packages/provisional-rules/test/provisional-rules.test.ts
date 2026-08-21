import { describe, expect, it } from "vitest";
import type { MachineCheckChecks } from "../src/index.js";
import {
  activateExperimental,
  admitProvisionalRuleCandidate,
  createMachineCheckRecord,
  createProvisionalRuleStore,
  freezeP0CoverageIndex,
  hashCanonical,
  recordCorrectionSignal,
  selectProvisionalRules,
  serializeProvisionalRuleEnvelope,
} from "../src/index.js";

const CHECKS: MachineCheckChecks = {
  representation_safe: true,
  rule_structure: true,
  rule_semantics: true,
  observation_binding: true,
  p0_coverage: true,
};
const TIME = "2026-08-21T00:00:00Z";

function rule(
  status: "draft" | "under_review" = "draft",
): Record<string, unknown> {
  const asset = {
    asset_id: "asset_reward",
    asset_kind: "reward_point",
    program_id: "program_test",
    reward_class: "normal",
    scale: 1,
  };
  return {
    rule_id: "rr_test_reward",
    version: 1,
    status,
    rule_type: "base_reward",
    name: "Test reward",
    subject: { entity_type: "loyalty_program", entity_id: "program_test" },
    scope: {
      countries: ["JP"],
      operation_types: ["merchant_purchase"],
      channels: ["in_store"],
    },
    eligibility: {
      operation_match: {},
      user_conditions: [],
      transaction_conditions: {},
      campaign_conditions: {},
    },
    calculation: {
      model: "percentage",
      rate_basis_points: 100,
      rounding: {
        aggregation_scope: "per_operation",
        eligible_spend_quantum_jpy: null,
        reward_rounding_mode: "floor",
      },
    },
    output: {
      asset,
      sign: "credit",
      certainty: {
        type: "guaranteed",
        probability: null,
        probability_source: null,
      },
      settlement: {
        status: "posted",
        expected_posting_from: null,
        expected_posting_to: null,
        posted_at: null,
      },
      expiry: {
        policy: "none",
        expires_at: null,
        duration_days: null,
        timezone: null,
      },
      restrictions: {
        transferable: null,
        redeemable_for_cash: null,
        usable_for_payment: true,
        investable: null,
        permitted_destination_ids: [],
        notes: "test",
      },
      clawback: { on_refund: "none", posting_delay_days: null, notes: "test" },
    },
    caps: [],
    stacking: {
      stack_group: "test",
      mode: "additive",
      precedence: 1,
      conflicts_with_rule_ids: [],
      requires_rule_ids: [],
    },
    validity: {
      valid_from: TIME,
      valid_to: null,
      timezone: "Asia/Tokyo",
      recorded_at: TIME,
      superseded_at: null,
    },
    provenance: {
      evidence_ids: ["ev_test"],
      minimum_source_tier: "T1_CANONICAL",
      confidence: 0.8,
      human_verified: false,
    },
    audit: {
      created_at: TIME,
      created_by: "test",
      review_mode: null,
      reviewed_at: null,
      reviewed_by: null,
      change_reason: "test",
      required_review_modes: ["solo_dual_pass"],
      review_events: [],
    },
  };
}

function observation(status = "needs_review"): Record<string, unknown> {
  return {
    observation_id: "so_test",
    agent_feed: {
      protocol_version: "0.1",
      event_id: "event_test",
      stream_id: "stream_test",
      run_id: "run_test",
      finding_id: "finding_test",
    },
    source_ids: ["source_test"],
    subjects: [{ type: "campaign", id: "campaign_test", name: "Test" }],
    change_type: "reward_rate",
    summary: "Test observation",
    effective_time: {
      occurred_at: TIME,
      effective_from: TIME,
      effective_to: null,
    },
    discovery_assessment: {
      source_authority_claim: "primary",
      evidence_completeness: "complete",
      agent_confidence: 0.9,
    },
    submitted_evidence_refs: ["ev_lead"],
    canonical_evidence_ids: [],
    semantic_fingerprint_version: 1,
    semantic_fingerprint: `sha256:${"a".repeat(64)}`,
    status,
    security_flags: [],
    raw_attributes: {},
    created_at: TIME,
    updated_at: TIME,
  };
}

function request(overrides: Record<string, unknown> = {}) {
  const candidate = {
    version: "provisional-rule-candidate.v1",
    observation_id: "so_test",
    observation_fingerprint: `sha256:${"a".repeat(64)}`,
    p0_family_id: "P0_TEST",
    source_role_id: "reward_program_terms",
    source_authority_role: "primary",
    source_ids: ["source_test"],
    rule: rule(),
    extractor: { name: "test-extractor", version: "1" },
    machine_check: createMachineCheckRecord(TIME, CHECKS),
    ...overrides,
  };
  return {
    candidate,
    observation: observation(),
    p0_coverage_index: freezeP0CoverageIndex({
      version: "p0-test.v1",
      entries: [
        {
          family_id: "P0_TEST",
          source_role_id: "reward_program_terms",
          known_source_ids: ["source_test"],
        },
      ],
    }),
  };
}

describe("provisional rule kernel", () => {
  it("machine-checks a bound draft and hashes source order deterministically", () => {
    const first = admitProvisionalRuleCandidate(request());
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.status).toBe("machine_checked");
    expect(first.envelope.status).toBe("machine_checked");
    expect(first.envelope.rule.status).toBe("draft");
    expect(serializeProvisionalRuleEnvelope(first.envelope)).toContain(
      first.candidate_hash,
    );
  });

  it("quarantines unknown coverage, hostile observations, and forged publication claims", () => {
    const unknown = admitProvisionalRuleCandidate({
      ...request(),
      candidate: { ...request().candidate, p0_family_id: "P0_UNKNOWN" },
    });
    expect(unknown.ok).toBe(false);
    expect(
      unknown.issues.some((item) => item.code === "coverage_family_unknown"),
    ).toBe(true);

    const hostile = admitProvisionalRuleCandidate({
      ...request(),
      observation: { ...observation(), status: "rejected" },
    });
    expect(hostile.ok).toBe(false);
    expect(
      hostile.issues.some((item) => item.code === "observation_rejected"),
    ).toBe(true);

    const forged = admitProvisionalRuleCandidate({
      ...request(),
      candidate: { ...request().candidate, rule: rule("published") },
    });
    expect(forged.ok).toBe(false);
    expect(
      forged.issues.some(
        (item) => item.code === "rule_publication_status_forbidden",
      ),
    ).toBe(true);

    for (const status of ["closed", "new", "duplicate"] as const) {
      const rejectedStatus = admitProvisionalRuleCandidate({
        ...request(),
        observation: { ...observation(), status },
      });
      expect(rejectedStatus.ok).toBe(false);
      expect(
        rejectedStatus.issues.some(
          (item) => item.code === "observation_status_forbidden",
        ),
      ).toBe(true);
    }

    const evidenceNeeded = admitProvisionalRuleCandidate({
      ...request(),
      observation: {
        ...observation("needs_evidence"),
        discovery_assessment: {
          source_authority_claim: "primary",
          evidence_completeness: "partial",
          agent_confidence: 0.9,
        },
      },
    });
    expect(evidenceNeeded.ok).toBe(true);
    if (evidenceNeeded.ok)
      expect(
        activateExperimental(evidenceNeeded.envelope, "2026-08-21T00:01:00Z"),
      ).toMatchObject({
        ok: false,
        code: "activation_not_allowed",
      });
  });

  it("activates, disputes on one credible correction, and excludes the candidate", () => {
    const store = createProvisionalRuleStore();
    const admitted = store.admit(request());
    expect(admitted.ok).toBe(true);
    if (!admitted.ok) return;
    const activated = store.activate(
      admitted.candidate_hash,
      "2026-08-21T00:01:00Z",
    );
    expect(activated.ok).toBe(true);
    const before = store.select();
    expect(before).toHaveLength(1);
    const correction = store.reportCorrection({
      version: "provisional-correction.v1",
      signal_id: "sig-1",
      candidate_hash: admitted.candidate_hash,
      category: "rate_wrong",
      credible: true,
      reported_at: "2026-08-21T00:02:00Z",
    });
    expect(correction.ok).toBe(true);
    expect(store.get(admitted.candidate_hash)?.status).toBe("disputed");
    expect(store.select()).toHaveLength(0);
    expect(store.get(admitted.candidate_hash)?.history).toHaveLength(3);
  });

  it("rejects duplicate/tampered corrections and quarantines severe mismatch", () => {
    const store = createProvisionalRuleStore();
    const admitted = store.admit(request());
    expect(admitted.ok).toBe(true);
    if (!admitted.ok) return;
    expect(
      store.activate(admitted.candidate_hash, "2026-08-21T00:01:00Z").ok,
    ).toBe(true);
    const signal = {
      version: "provisional-correction.v1",
      signal_id: "sig-2",
      candidate_hash: admitted.candidate_hash,
      category: "source_mismatch",
      credible: true,
      reported_at: "2026-08-21T00:02:00Z",
    } as const;
    expect(store.reportCorrection(signal).ok).toBe(true);
    expect(store.get(admitted.candidate_hash)?.status).toBe("quarantined");
    expect(store.reportCorrection(signal).ok).toBe(false);
    expect(
      store.reportCorrection({ ...signal, category: "rate_wrong" }).ok,
    ).toBe(false);
  });

  it("separates semantic source role from authority and requires primary for activation", () => {
    const wrongSemanticRole = admitProvisionalRuleCandidate({
      ...request(),
      p0_coverage_index: freezeP0CoverageIndex({
        version: "p0-test.v1",
        entries: [
          {
            family_id: "P0_TEST",
            source_role_id: "merchant_acceptance",
            known_source_ids: ["source_test"],
          },
        ],
      }),
    });
    expect(wrongSemanticRole.ok).toBe(false);
    expect(
      wrongSemanticRole.issues.some(
        (item) => item.code === "source_role_coverage_mismatch",
      ),
    ).toBe(true);

    const corroborating = admitProvisionalRuleCandidate({
      ...request(),
      candidate: {
        ...request().candidate,
        source_authority_role: "corroborating",
      },
      observation: {
        ...observation(),
        discovery_assessment: {
          source_authority_claim: "official_secondary",
          evidence_completeness: "complete",
          agent_confidence: 0.9,
        },
      },
    });
    expect(corroborating.ok).toBe(true);
    if (corroborating.ok)
      expect(
        activateExperimental(corroborating.envelope, "2026-08-21T00:01:00Z"),
      ).toMatchObject({
        ok: false,
        code: "source_authority_required_for_activation",
      });

    const conflict = admitProvisionalRuleCandidate({
      ...request(),
      candidate: {
        ...request().candidate,
        source_authority_role: "conflict",
      },
    });
    expect(conflict.ok).toBe(false);
  });

  it("allows multiple semantic roles per family with tuple-stable coverage", () => {
    const first = freezeP0CoverageIndex({
      version: "p0-test.v1",
      entries: [
        {
          family_id: "merchant.7eleven",
          source_role_id: "merchant_profile",
          known_source_ids: ["source_test"],
        },
        {
          family_id: "merchant.7eleven",
          source_role_id: "reward_program_terms",
          known_source_ids: ["source_test"],
        },
      ],
    });
    const reversed = freezeP0CoverageIndex({
      version: "p0-test.v1",
      entries: [...first.entries].reverse(),
    });
    expect(reversed).toEqual(first);
    expect(hashCanonical(reversed)).toBe(hashCanonical(first));
    const admitted = admitProvisionalRuleCandidate({
      ...request(),
      candidate: {
        ...request().candidate,
        p0_family_id: "merchant.7eleven",
      },
      p0_coverage_index: reversed,
    });
    expect(admitted.ok).toBe(true);
  });

  it("rejects forged, cloned, proxied, and chronologically regressed envelopes", () => {
    const store = createProvisionalRuleStore();
    const admitted = store.admit(request());
    expect(admitted.ok).toBe(true);
    if (!admitted.ok) return;
    const forged = {
      ...admitted.envelope,
      status: "machine_checked",
    } as typeof admitted.envelope;
    expect(
      store.activate(admitted.candidate_hash, "2026-08-21T00:01:00Z").ok,
    ).toBe(true);
    expect(activateExperimental(forged, "2026-08-21T00:01:00Z")).toMatchObject({
      ok: false,
      code: "envelope_invalid",
    });
    let getterCalls = 0;
    const proxy = new Proxy(forged, {
      get() {
        getterCalls += 1;
        throw new Error("proxy getter invoked");
      },
    });
    expect(activateExperimental(proxy, "2026-08-21T00:01:00Z")).toMatchObject({
      ok: false,
      code: "envelope_invalid",
    });
    expect(getterCalls).toBe(0);
    expect(
      recordCorrectionSignal(proxy, {
        version: "provisional-correction.v1",
        signal_id: "sig-forged",
        candidate_hash: admitted.candidate_hash,
        category: "rate_wrong",
        credible: true,
        reported_at: "2026-08-21T00:02:00Z",
      }),
    ).toMatchObject({ ok: false, code: "envelope_invalid" });
    const active = store.get(admitted.candidate_hash);
    expect(active).not.toBeNull();
    expect(
      selectProvisionalRules(
        [active as typeof admitted.envelope, forged, proxy],
        {
          include_machine_checked: true,
        },
      ),
    ).toHaveLength(1);
    expect(getterCalls).toBe(0);
    expect(
      activateExperimental(admitted.envelope, "2020-01-01T00:00:00Z"),
    ).toMatchObject({
      ok: false,
      code: "transition_time_regression",
    });
  });
});
