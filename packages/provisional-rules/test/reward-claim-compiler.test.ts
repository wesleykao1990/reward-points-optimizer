import { describe, expect, it } from "vitest";
import {
  compileRewardClaims,
  freezeP0CoverageIndex,
  parseRewardClaimDocument,
} from "../src/index.js";

const COVERAGE = freezeP0CoverageIndex({
  version: "p0-coverage-index.v1",
  entries: [
    {
      family_id: "test.family",
      source_role_id: "test_role",
      known_source_ids: ["source.test"],
    },
  ],
});

function observation(
  reward_claims: Record<string, unknown> | undefined,
  rawExtra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    observation_id: "so_test_reward_claims_001",
    agent_feed: {
      protocol_version: "0.1",
      event_id: "event_test_reward_claims_001",
      stream_id: "stream.test",
      run_id: "run_test_reward_claims_001",
      finding_id: "finding_test_reward_claims_001",
    },
    source_ids: ["source.test"],
    subjects: [
      { type: "merchant", id: "merchant.test", name: "Test Merchant" },
      { type: "loyalty_program", id: "program.test", name: "Test Points" },
    ],
    change_type: "reward_rate",
    summary: "Structured claim test observation.",
    effective_time: {
      occurred_at: "2026-08-21T00:00:00Z",
      effective_from: null,
      effective_to: null,
    },
    discovery_assessment: {
      source_authority_claim: "primary",
      evidence_completeness: "complete",
      agent_confidence: null,
    },
    submitted_evidence_refs: ["ev_test_reward_claims_001"],
    canonical_evidence_ids: [],
    semantic_fingerprint_version: 1,
    semantic_fingerprint:
      "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    status: "needs_review",
    security_flags: [],
    raw_attributes: {
      ...(reward_claims === undefined ? {} : { reward_claims }),
      ...rawExtra,
    },
    created_at: "2026-08-21T00:00:00Z",
    updated_at: "2026-08-21T00:00:00Z",
  };
}

function options() {
  return {
    family_id: "test.family",
    source_role_id: "test_role",
    source_ids: ["source.test"],
    p0_coverage_index: COVERAGE,
  } as const;
}

const rewardAsset = {
  asset_id: "asset.test-point",
  asset_kind: "reward_point",
  program_id: "program.test",
  reward_class: "normal",
  scale: 0,
};

const output = {
  asset: rewardAsset,
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
    policy: "unknown",
    expires_at: null,
    duration_days: null,
    timezone: "Asia/Tokyo",
  },
  restrictions: {
    transferable: null,
    redeemable_for_cash: null,
    usable_for_payment: null,
    investable: null,
    permitted_destination_ids: [],
    notes: "",
  },
  clawback: {
    on_refund: "unknown",
    posting_delay_days: null,
    notes: "",
  },
};

const subject = {
  entity_type: "stored_value_program",
  entity_id: "program.test",
};

const scope = {
  countries: ["JP"],
  operation_types: ["merchant_purchase"],
  channels: ["in_store"],
  merchant_ids: ["merchant.test"],
  tax_basis: "tax_inclusive",
};

const eligibility = {
  operation_match: {
    required_loyalty_program_ids: ["program.test"],
    allowed_payment_instrument_ids: ["instrument.test"],
  },
  user_conditions: [],
  transaction_conditions: {
    eligible_amount_basis: "operation_amount",
  },
  campaign_conditions: {},
};

const transferCalculation = {
  model: "transfer_ratio",
  source_asset: {
    asset_id: "asset.source",
    asset_kind: "reward_point",
    program_id: "program.test",
    reward_class: "normal",
    scale: 0,
  },
  destination_asset: rewardAsset,
  source_units: "1",
  destination_units: "1",
  minimum_source_units: null,
  increment_source_units: null,
  maximum_source_units_per_request: null,
  maximum_source_units_per_period: null,
  maximum_period: null,
  fee: null,
  rounding: {
    aggregation_scope: "transfer_request",
    eligible_spend_quantum_jpy: null,
    reward_rounding_mode: "exact",
  },
  processing_time_days_min: null,
  processing_time_days_max: null,
  cancellation_policy: "unknown",
};

function transferClaim(claim_id: string, destination_asset = rewardAsset) {
  return {
    claim_id,
    claim_type: "conversion",
    subject,
    scope: {
      ...scope,
      operation_types: ["point_transfer"],
      channels: ["transfer"],
      tax_basis: "not_applicable",
    },
    eligibility,
    calculation: {
      ...structuredClone(transferCalculation),
      destination_asset: structuredClone(destination_asset),
    },
    output: {
      ...structuredClone(output),
      asset: structuredClone(destination_asset),
    },
  };
}

describe("structured reward-claim compiler", () => {
  it("compiles representable phase-one shapes including explicit transfer output", () => {
    const result = compileRewardClaims(
      observation({
        version: "reward-claim.v1",
        claims: [
          {
            claim_id: "payment-allow",
            claim_type: "payment_acceptance",
            decision: "allow",
            payment_family: "barcode",
          },
          {
            claim_id: "points-earning",
            claim_type: "points_per_unit",
            subject,
            scope,
            eligibility,
            calculation: {
              model: "points_per_unit",
              reward_units: "1",
              spend_jpy: 200,
              rounding: {
                aggregation_scope: "per_operation",
                eligible_spend_quantum_jpy: 200,
                reward_rounding_mode: "floor",
              },
            },
            output,
          },
          {
            claim_id: "fixed-earning",
            claim_type: "fixed",
            subject,
            scope,
            eligibility,
            calculation: {
              model: "fixed",
              reward_units: "5",
              rounding: {
                aggregation_scope: "per_operation",
                eligible_spend_quantum_jpy: null,
                reward_rounding_mode: "exact",
              },
            },
            output,
          },
          {
            claim_id: "percent-earning",
            claim_type: "percentage",
            subject,
            scope,
            eligibility,
            calculation: {
              model: "percentage",
              rate_basis_points: 100,
              rounding: {
                aggregation_scope: "per_operation",
                eligible_spend_quantum_jpy: null,
                reward_rounding_mode: "floor",
              },
            },
            output,
          },
          {
            claim_id: "transfer-conversion",
            claim_type: "conversion",
            subject,
            scope: {
              ...scope,
              operation_types: ["point_transfer"],
              channels: ["transfer"],
              tax_basis: "not_applicable",
            },
            eligibility,
            calculation: transferCalculation,
            output,
          },
          {
            claim_id: "tender-exclusion",
            claim_type: "exclusion",
            target: "cash",
          },
          {
            claim_id: "campaign-conditions",
            claim_type: "campaign",
            subject: { entity_type: "campaign", entity_id: "campaign.test" },
            scope,
            eligibility,
            campaign_id: "campaign.test",
            conditions: [
              {
                fact_key: "member.test",
                operator: "eq",
                value: true,
                unknown_policy: "ask_user",
              },
            ],
            calculation: {
              model: "fixed",
              reward_units: "1",
              rounding: {
                aggregation_scope: "per_campaign_period",
                eligible_spend_quantum_jpy: null,
                reward_rounding_mode: "exact",
              },
            },
            output,
            validity: {
              valid_from: "2026-08-21T00:00:00Z",
              valid_to: "2026-09-01T00:00:00Z",
              timezone: "Asia/Tokyo",
              recorded_at: "2026-08-21T00:00:00Z",
              superseded_at: null,
            },
          },
        ],
      }),
      options(),
    );

    expect(result.ok).toBe(true);
    expect(result.members).toHaveLength(7);
    expect(result.members.filter((member) => member.ok)).toHaveLength(7);
    expect(result.members[4]?.ok).toBe(true);
    expect(result.members[4]?.envelope?.status).toBe("active_experimental");
    expect(result.members[4]?.envelope?.rule.rule_type).toBe(
      "asset_conversion",
    );
    expect(result.members[4]?.envelope?.rule.output).toEqual(output);
    expect(
      result.members
        .filter((member) => member.ok)
        .every((member) => member.envelope?.status === "active_experimental"),
    ).toBe(true);
    expect(
      result.members.map((member) => member.envelope?.rule.rule_type),
    ).toEqual(
      expect.arrayContaining([
        "payment_acceptance",
        "base_reward",
        "exclusion",
        "campaign_bonus",
      ]),
    );
    expect(
      result.members[1]?.envelope?.rule.provenance.minimum_source_tier,
    ).toBe("T2_OFFICIAL_SUPPORT");
  });

  it("keeps a valid sibling when one structured claim type is unsupported", () => {
    const result = compileRewardClaims(
      observation({
        version: "reward-claim.v1",
        claims: [
          {
            claim_id: "valid-sibling",
            claim_type: "fixed",
            subject,
            scope,
            eligibility,
            calculation: {
              model: "fixed",
              reward_units: "1",
              rounding: {
                aggregation_scope: "per_operation",
                eligible_spend_quantum_jpy: null,
                reward_rounding_mode: "exact",
              },
            },
            output,
          },
          { claim_id: "future-type", claim_type: "future_model" },
        ],
      }),
      options(),
    );
    expect(result.ok).toBe(true);
    expect(result.members[0]?.ok).toBe(true);
    expect(result.members[1]?.ok).toBe(false);
    expect(result.members[1]?.issues[0]?.code).toBe("unsupported_claim_type");
    expect(result.store.select()).toHaveLength(1);
  });

  it("rejects a transfer output asset mismatch while activating a valid sibling", () => {
    const invalid = transferClaim("mismatched-transfer");
    invalid.output.asset = { ...rewardAsset, program_id: "program.other" };
    const result = compileRewardClaims(
      observation({
        version: "reward-claim.v1",
        claims: [invalid, transferClaim("valid-transfer")],
      }),
      options(),
    );
    expect(result.ok).toBe(true);
    expect(result.members[0]?.ok).toBe(false);
    expect(result.members[0]?.issues[0]).toMatchObject({
      code: "claim_economics_invalid",
      path: "/output/asset",
    });
    expect(result.members[1]?.ok).toBe(true);
    expect(result.members[1]?.envelope?.status).toBe("active_experimental");
  });

  it("binds transfer candidate and definition hashes to the explicit destination output", () => {
    const firstAsset = { ...rewardAsset, asset_id: "asset.transfer.first" };
    const secondAsset = { ...rewardAsset, asset_id: "asset.transfer.second" };
    const first = compileRewardClaims(
      observation({
        version: "reward-claim.v1",
        claims: [transferClaim("same-transfer", firstAsset)],
      }),
      options(),
    );
    const second = compileRewardClaims(
      observation({
        version: "reward-claim.v1",
        claims: [transferClaim("same-transfer", secondAsset)],
      }),
      options(),
    );
    expect(first.members[0]?.ok).toBe(true);
    expect(second.members[0]?.ok).toBe(true);
    expect(first.members[0]?.candidate_hash).not.toBe(
      second.members[0]?.candidate_hash,
    );
    expect(first.members[0]?.definition_hash).not.toBe(
      second.members[0]?.definition_hash,
    );
  });

  it("returns a deterministic rejected member for an id-less malformed sibling", () => {
    const result = compileRewardClaims(
      observation({
        version: "reward-claim.v1",
        claims: [
          42,
          {
            claim_id: "invalid-claim-index-000000",
            claim_type: "fixed",
            subject,
            scope,
            eligibility,
            calculation: {
              model: "fixed",
              reward_units: "1",
              rounding: {
                aggregation_scope: "per_operation",
                eligible_spend_quantum_jpy: null,
                reward_rounding_mode: "exact",
              },
            },
            output,
          },
        ],
      }),
      options(),
    );
    expect(result.ok).toBe(true);
    expect(result.members[0]?.claim_id).toBe("invalid#claim-index-000000");
    expect(result.members[0]?.ok).toBe(false);
    expect(result.members[0]?.issues[0]?.code).toBe("claim_document_invalid");
    expect(result.members[1]?.ok).toBe(true);
    expect(result.members[1]?.envelope?.status).toBe("active_experimental");
  });

  it("keeps full claim identity distinct across slug collisions and truncation", () => {
    const prefix = `same${"x".repeat(76)}`;
    const firstId = `${prefix}.id`;
    const secondId = `${prefix}_id`;
    const fixed = (claim_id: string, reward_units: string) => ({
      claim_id,
      claim_type: "fixed",
      subject,
      scope,
      eligibility,
      calculation: {
        model: "fixed",
        reward_units,
        rounding: {
          aggregation_scope: "per_operation",
          eligible_spend_quantum_jpy: null,
          reward_rounding_mode: "exact",
        },
      },
      output,
    });
    const result = compileRewardClaims(
      observation({
        version: "reward-claim.v1",
        claims: [fixed(firstId, "1"), fixed(secondId, "2")],
      }),
      options(),
    );
    expect(result.members.every((member) => member.ok)).toBe(true);
    const rules = result.members.map((member) => member.envelope?.rule.rule_id);
    const candidates = result.members.map(
      (member) => member.envelope?.candidate.candidate_id,
    );
    expect(new Set(rules).size).toBe(2);
    expect(new Set(candidates).size).toBe(2);
  });

  it("rejects structured economics when scope tax_basis is absent", () => {
    const scopeWithoutTaxBasis = Object.fromEntries(
      Object.entries(scope).filter(([key]) => key !== "tax_basis"),
    );
    const result = compileRewardClaims(
      observation({
        version: "reward-claim.v1",
        claims: [
          {
            claim_id: "missing-tax-basis",
            claim_type: "fixed",
            subject,
            scope: scopeWithoutTaxBasis,
            eligibility,
            calculation: {
              model: "fixed",
              reward_units: "1",
              rounding: {
                aggregation_scope: "per_operation",
                eligible_spend_quantum_jpy: null,
                reward_rounding_mode: "exact",
              },
            },
            output,
          },
        ],
      }),
      options(),
    );
    expect(result.ok).toBe(false);
    expect(result.members[0]?.ok).toBe(false);
    expect(result.members[0]?.issues[0]?.code).toBe("claim_economics_missing");
    expect(result.members[0]?.issues[0]?.path).toBe("/scope/tax_basis");
  });

  it("does not infer calculable economics from observation subjects", () => {
    const result = compileRewardClaims(
      observation({
        version: "reward-claim.v1",
        claims: [
          {
            claim_id: "missing-structured-fields",
            claim_type: "fixed",
            reward_units: "1",
            output,
          },
          {
            claim_id: "complete-structured-fields",
            claim_type: "fixed",
            subject,
            scope,
            eligibility,
            calculation: {
              model: "fixed",
              reward_units: "1",
              rounding: {
                aggregation_scope: "per_operation",
                eligible_spend_quantum_jpy: null,
                reward_rounding_mode: "exact",
              },
            },
            output,
          },
        ],
      }),
      options(),
    );
    expect(result.ok).toBe(true);
    expect(result.members[0]?.ok).toBe(false);
    expect(result.members[0]?.issues[0]?.code).toBe("claim_economics_missing");
    expect(result.members[1]?.ok).toBe(true);
  });

  it("preserves explicit output restrictions and clawback fields", () => {
    const explicitOutput = {
      ...output,
      restrictions: {
        ...output.restrictions,
        transferable: false,
        usable_for_payment: true,
        notes: "Only usable at the issuing merchant.",
      },
      clawback: {
        ...output.clawback,
        on_refund: "full",
        posting_delay_days: 2,
        notes: "Reversed in full after a qualifying refund.",
      },
    };
    const result = compileRewardClaims(
      observation({
        version: "reward-claim.v1",
        claims: [
          {
            claim_id: "explicit-output-fields",
            claim_type: "fixed",
            subject,
            scope,
            eligibility,
            calculation: {
              model: "fixed",
              reward_units: "1",
              rounding: {
                aggregation_scope: "per_operation",
                eligible_spend_quantum_jpy: null,
                reward_rounding_mode: "exact",
              },
            },
            output: explicitOutput,
          },
        ],
      }),
      options(),
    );
    expect(result.members[0]?.ok).toBe(true);
    expect(result.members[0]?.envelope?.rule.output?.restrictions).toEqual(
      explicitOutput.restrictions,
    );
    expect(result.members[0]?.envelope?.rule.output?.clawback).toEqual(
      explicitOutput.clawback,
    );
  });

  it("fails whole-document for hostile representations and enforces exact claim IDs", () => {
    const hostile: Record<string, unknown> = {
      version: "reward-claim.v1",
      claims: [
        {
          claim_id: "safe-claim",
          claim_type: "fixed",
          subject,
          scope,
          eligibility,
          calculation: {
            model: "fixed",
            reward_units: "1",
            rounding: {
              aggregation_scope: "per_operation",
              eligible_spend_quantum_jpy: null,
              reward_rounding_mode: "exact",
            },
          },
          output,
        },
      ],
    };
    Object.defineProperty(hostile.claims?.[0] as object, "secret_token", {
      enumerable: true,
      value: "not-a-real-secret",
    });
    const hostileResult = compileRewardClaims(observation(hostile), options());
    expect(hostileResult.ok).toBe(false);
    expect(hostileResult.members).toEqual([]);

    const parsed = parseRewardClaimDocument({
      version: "reward-claim.v1",
      claims: [
        {
          claim_id: "UPPERCASE",
          claim_type: "fixed",
          reward_units: "1",
        },
      ],
    });
    expect(parsed.issues.map((item) => item.code)).toContain(
      "claim_id_invalid",
    );
  });

  it("produces the same candidate identity when claim order changes", () => {
    const document = {
      version: "reward-claim.v1",
      claims: [
        {
          claim_id: "b-claim",
          claim_type: "fixed",
          subject,
          scope,
          eligibility,
          calculation: {
            model: "fixed",
            reward_units: "2",
            rounding: {
              aggregation_scope: "per_operation",
              eligible_spend_quantum_jpy: null,
              reward_rounding_mode: "exact",
            },
          },
          output,
        },
        {
          claim_id: "a-claim",
          claim_type: "fixed",
          subject,
          scope,
          eligibility,
          calculation: {
            model: "fixed",
            reward_units: "1",
            rounding: {
              aggregation_scope: "per_operation",
              eligible_spend_quantum_jpy: null,
              reward_rounding_mode: "exact",
            },
          },
          output,
        },
      ],
    };
    const first = compileRewardClaims(observation(document), options());
    const reordered = compileRewardClaims(
      observation({ ...document, claims: [...document.claims].reverse() }),
      options(),
    );
    const hashes = (result: typeof first) =>
      result.members
        .filter((member) => member.ok)
        .map((member) => [member.claim_id, member.candidate_hash])
        .sort((left, right) => left[0].localeCompare(right[0]));
    expect(hashes(first)).toEqual(hashes(reordered));
  });
});
