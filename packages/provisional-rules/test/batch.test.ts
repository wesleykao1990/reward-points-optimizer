import { describe, expect, it } from "vitest";
import {
  createMachineCheckRecord,
  createProvisionalRuleStore,
  freezeP0CoverageIndex,
  type MachineCheckChecks,
  type ProvisionalRuleAdmissionRequest,
  preflightProvisionalPublicationBatch,
} from "../src/index.js";

const TIME = "2026-08-21T00:00:00Z";
const CHECKS: MachineCheckChecks = {
  representation_safe: true,
  rule_structure: true,
  rule_semantics: true,
  observation_binding: true,
  p0_coverage: true,
};

function rule(candidateId: string): Record<string, unknown> {
  return {
    rule_id: `rr_${candidateId}`,
    version: 1,
    status: "draft",
    rule_type: "base_reward",
    name: "Batch test reward",
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
      asset: {
        asset_id: "asset_reward",
        asset_kind: "reward_point",
        program_id: "program_test",
        reward_class: "normal",
        scale: 1,
      },
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
        notes: "batch test",
      },
      clawback: {
        on_refund: "none",
        posting_delay_days: null,
        notes: "batch test",
      },
    },
    caps: [],
    stacking: {
      stack_group: "batch_test",
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
      evidence_ids: ["ev_batch"],
      minimum_source_tier: "T1_CANONICAL",
      confidence: 0.8,
      human_verified: false,
    },
    audit: {
      created_at: TIME,
      created_by: "batch-test",
      review_mode: null,
      reviewed_at: null,
      reviewed_by: null,
      change_reason: "batch test",
      required_review_modes: ["solo_dual_pass"],
      review_events: [],
    },
  };
}

function admission(candidateId: string): ProvisionalRuleAdmissionRequest {
  return {
    candidate: {
      version: "provisional-rule-candidate.v1",
      candidate_id: candidateId,
      observation_id: "so_batch_test",
      observation_fingerprint: `sha256:${"a".repeat(64)}`,
      p0_family_id: "P0_BATCH_TEST",
      source_role_id: "reward_program_terms",
      source_authority_role: "primary",
      source_ids: ["source_batch_test"],
      rule: rule(candidateId),
      extractor: { name: "batch-test", version: "1" },
      machine_check: createMachineCheckRecord(TIME, CHECKS),
    },
    observation: {
      observation_id: "so_batch_test",
      agent_feed: {
        protocol_version: "0.1",
        event_id: "event_batch_test",
        stream_id: "stream_batch_test",
        run_id: "run_batch_test",
        finding_id: "finding_batch_test",
      },
      source_ids: ["source_batch_test"],
      subjects: [{ type: "merchant", id: "merchant_batch", name: "Batch" }],
      change_type: "reward_rate",
      summary: "Batch test observation",
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
      submitted_evidence_refs: ["ev_batch"],
      canonical_evidence_ids: [],
      semantic_fingerprint_version: 1,
      semantic_fingerprint: `sha256:${"a".repeat(64)}`,
      status: "needs_review",
      security_flags: [],
      raw_attributes: {},
      created_at: TIME,
      updated_at: TIME,
    },
    p0_coverage_index: freezeP0CoverageIndex({
      version: "p0-batch-test.v1",
      entries: [
        {
          family_id: "P0_BATCH_TEST",
          source_role_id: "reward_program_terms",
          known_source_ids: ["source_batch_test"],
        },
      ],
    }),
  };
}

function batch(
  members: readonly {
    member_id: string;
    admission_request: ProvisionalRuleAdmissionRequest;
  }[],
) {
  return {
    version: "provisional-publication-batch.v1",
    batch_id: "batch-test-001",
    plan_sha256:
      "sha256:a59447525cb207838439a3cdb8b9cc22d19d875a650a64f50354137a78892003",
    published_at: "2026-08-21T00:01:00Z",
    members,
  };
}

describe("provisional publication batches", () => {
  it("preflights and activates two members deterministically", () => {
    const first = preflightProvisionalPublicationBatch(
      batch([
        { member_id: "member-a", admission_request: admission("candidate-a") },
        { member_id: "member-b", admission_request: admission("candidate-b") },
      ]),
    );
    const reversed = preflightProvisionalPublicationBatch(
      batch([
        { member_id: "member-b", admission_request: admission("candidate-b") },
        { member_id: "member-a", admission_request: admission("candidate-a") },
      ]),
    );
    expect(first.ok).toBe(true);
    expect(reversed.ok).toBe(true);
    if (first.ok && reversed.ok) {
      expect(first.batch.published).toHaveLength(2);
      expect(first.batch.published[0]?.candidate_hash).toBe(
        [...first.batch.published].sort((left, right) =>
          left.candidate_hash.localeCompare(right.candidate_hash),
        )[0]?.candidate_hash,
      );
      expect(first.batch.batch_hash).toBe(reversed.batch.batch_hash);
    }
  });

  it("leaves the store untouched when the final member is malformed", () => {
    const store = createProvisionalRuleStore();
    const malformed = batch([
      { member_id: "member-a", admission_request: admission("candidate-a") },
      {
        member_id: "member-b",
        admission_request: {
          ...admission("candidate-b"),
          observation: { status: "rejected" },
        },
      },
    ]);
    const result = store.publishBatch(malformed);
    expect(result.ok).toBe(false);
    expect(store.snapshot()).toHaveLength(0);
  });

  it("rejects duplicate hashes and supports exact replay without resurrection", () => {
    const store = createProvisionalRuleStore();
    const duplicate = batch([
      { member_id: "member-a", admission_request: admission("candidate-a") },
      { member_id: "member-b", admission_request: admission("candidate-a") },
    ]);
    expect(store.publishBatch(duplicate)).toMatchObject({ ok: false });

    const duplicateIdBase = admission("candidate-shared-id");
    const duplicateIdCandidate = duplicateIdBase.candidate as Record<
      string,
      unknown
    >;
    const duplicateIdRule = duplicateIdCandidate.rule as Record<
      string,
      unknown
    >;
    expect(
      store.publishBatch(
        batch([
          {
            member_id: "member-shared-a",
            admission_request: duplicateIdBase,
          },
          {
            member_id: "member-shared-b",
            admission_request: {
              ...duplicateIdBase,
              candidate: {
                ...duplicateIdCandidate,
                rule: { ...duplicateIdRule, name: "Changed definition" },
              },
            },
          },
        ]),
      ),
    ).toMatchObject({
      ok: false,
      issues: [{ code: "duplicate_candidate_id" }],
    });

    const request = batch([
      { member_id: "member-a", admission_request: admission("candidate-a") },
      { member_id: "member-b", admission_request: admission("candidate-b") },
    ]);
    const published = store.publishBatch(request);
    expect(published.ok).toBe(true);
    expect(store.publishBatch(request)).toEqual(published);
    expect(
      store.publishBatch({
        ...request,
        published_at: "2026-08-21T00:01:01Z",
      }),
    ).toMatchObject({
      ok: false,
      issues: [{ code: "batch_identity_mismatch" }],
    });
    expect(store.snapshot()).toHaveLength(2);
    if (!published.ok) return;
    const hash = published.batch.published[0]?.candidate_hash;
    if (!hash) return;
    expect(
      store.reportCorrection({
        version: "provisional-correction.v1",
        signal_id: "batch-test-correction",
        candidate_hash: hash,
        category: "rate_wrong",
        credible: true,
        reported_at: "2026-08-21T00:02:00Z",
      }).ok,
    ).toBe(true);
    expect(store.select()).toHaveLength(1);
    expect(store.publishBatch(request)).toMatchObject({ ok: false });
  });

  it("rejects hostile and oversized envelopes before dereference or mutation", () => {
    const store = createProvisionalRuleStore();
    let reads = 0;
    const hostile = new Proxy(batch([]), {
      get(target, property, receiver) {
        reads += 1;
        return Reflect.get(target, property, receiver);
      },
    });
    expect(store.publishBatch(hostile)).toMatchObject({ ok: false });
    expect(reads).toBe(0);

    const forgedAdmission = admission(
      "candidate-forged-field",
    ) as ProvisionalRuleAdmissionRequest & { forged_extra: boolean };
    forgedAdmission.forged_extra = true;
    expect(
      store.publishBatch(
        batch([
          {
            member_id: "member-forged-field",
            admission_request: forgedAdmission,
          },
        ]),
      ),
    ).toMatchObject({
      ok: false,
      issues: [{ code: "batch_shape_invalid" }],
    });

    const oversized = batch(
      Array.from({ length: 33 }, (_, index) => ({
        member_id: `member-${index}`,
        admission_request: admission(`candidate-${index}`),
      })),
    );
    expect(store.publishBatch(oversized)).toMatchObject({
      ok: false,
      issues: [{ code: "batch_too_large" }],
    });
    expect(store.snapshot()).toHaveLength(0);
  });

  it("rejects a fully admitted non-primary member before store mutation", () => {
    const store = createProvisionalRuleStore();
    const secondary = admission("candidate-secondary");
    const candidate = secondary.candidate as Record<string, unknown>;
    const observation = secondary.observation as Record<string, unknown>;
    const assessment = observation.discovery_assessment as Record<
      string,
      unknown
    >;
    const result = store.publishBatch(
      batch([
        {
          member_id: "member-primary",
          admission_request: admission("candidate-a"),
        },
        {
          member_id: "member-secondary",
          admission_request: {
            ...secondary,
            candidate: {
              ...candidate,
              source_authority_role: "corroborating",
            },
            observation: {
              ...observation,
              discovery_assessment: {
                ...assessment,
                source_authority_claim: "official_secondary",
              },
            },
          },
        },
      ]),
    );
    expect(result).toMatchObject({
      ok: false,
      issues: [{ code: "activation_rejected" }],
    });
    expect(store.snapshot()).toHaveLength(0);
  });
});
