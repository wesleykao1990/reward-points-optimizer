import { describe, expect, it } from "vitest";

import {
  compileNanacoCreditChargeCandidate,
  NANACO_CREDIT_CHARGE_CANDIDATE_ARTIFACT_HASH,
  NANACO_CREDIT_CHARGE_CLAIM_IDS,
  NANACO_CREDIT_CHARGE_DEFINITION_HASH,
  NANACO_CREDIT_CHARGE_EVIDENCE_IDS,
  NANACO_CREDIT_CHARGE_SOURCE_IDS,
} from "../src/index.js";

const exactInput = () => ({
  claim_ids: [...NANACO_CREDIT_CHARGE_CLAIM_IDS],
  evidence_ids: [...NANACO_CREDIT_CHARGE_EVIDENCE_IDS],
  source_ids: [...NANACO_CREDIT_CHARGE_SOURCE_IDS],
});

describe("Nanaco credit-charge candidate compiler", () => {
  it("compiles only the exact reviewed claim, evidence, and source tuple", () => {
    const result = compileNanacoCreditChargeCandidate(exactInput());

    expect(result.ok).toBe(true);
    expect(result.definition_hash).toBe(NANACO_CREDIT_CHARGE_DEFINITION_HASH);
    expect(result.candidate_hash).toBe(
      NANACO_CREDIT_CHARGE_CANDIDATE_ARTIFACT_HASH,
    );
    expect(result.candidate?.rule.scope.operation_types).toEqual([
      "stored_value_top_up",
    ]);
    expect(result.candidate?.rule.calculation).toMatchObject({
      model: "points_per_unit",
      reward_units: "1",
      spend_jpy: 200,
    });
  });

  it("rejects reordered, incomplete, extra, and hostile input", () => {
    const reordered = exactInput();
    reordered.evidence_ids.reverse();
    expect(compileNanacoCreditChargeCandidate(reordered).ok).toBe(false);

    const incomplete = exactInput();
    incomplete.claim_ids.pop();
    expect(compileNanacoCreditChargeCandidate(incomplete).ok).toBe(false);

    expect(
      compileNanacoCreditChargeCandidate({ ...exactInput(), approved: true })
        .ok,
    ).toBe(false);
    expect(
      compileNanacoCreditChargeCandidate(new Proxy(exactInput(), {})).ok,
    ).toBe(false);
  });
});
