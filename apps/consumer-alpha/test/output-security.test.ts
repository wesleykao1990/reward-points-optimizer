import { describe, expect, it } from "vitest";
import type {
  CorrectionDraftInput,
  ManualAlphaState,
} from "../src/contracts.js";
import {
  mapCorrectionDraftForBrowser,
  mapRecommendationForBrowser,
} from "../src/presentation-adapter.js";
import { evaluateSynthetic } from "../src/synthetic.js";

const validState: ManualAlphaState = {
  merchant_id: "merchant.synthetic",
  branch_id: "location.synthetic",
  amount_jpy: 640,
  owned_instruments: ["synthetic_card"],
  stored_value_use: "unknown",
  facts: [],
  caps: [],
};

function validCorrection(): CorrectionDraftInput {
  return {
    category: "wrong_reward_amount",
    note_code: "amount_disagrees",
    recommendation_id: `sha256:${"a".repeat(64)}`,
  };
}

describe("M6 browser output security boundary", () => {
  it("projects only the narrow synthetic view and omits source/evidence metadata", () => {
    const response = evaluateSynthetic(validState);
    const view = mapRecommendationForBrowser(response);
    expect(view.synthetic_only).toBe(true);
    expect(view.verification_status).toBe("synthetic_only");
    expect(view.freshness).toEqual({ status: "synthetic_fixture" });
    expect(view).not.toHaveProperty("evidence_ids");
    expect(view.freshness).not.toHaveProperty("source_ids");
    expect(view.freshness).not.toHaveProperty("notes");
    expect(view).not.toHaveProperty("plans");
    expect(view).not.toHaveProperty("rules");
  });

  it("does not present an unresolved stored-value question as definite advice", () => {
    const response = evaluateSynthetic({
      ...validState,
      stored_value_use: "unknown",
    });
    expect(response.questions.length).toBeGreaterThan(0);
    const view = mapRecommendationForBrowser(response);
    expect(view.outcome).toBe("conditional");
    expect(view.conditional).toBe(true);
    expect(view.primary?.plan_id).toBe("plan_synthetic_direct_card");
    expect(view.primary?.label).toContain("Safe synthetic option");
    expect(view.fallback).toBeNull();
    expect(view.deep_link_ids).toEqual(["synthetic_loyalty_app"]);
  });

  it("also treats an explicit stored-value unknown marker as conditional", () => {
    const response = {
      ...evaluateSynthetic(validState),
      questions: [],
      assumptions: ["Stored-value use is unknown; answer before choosing."],
    } as never;
    const view = mapRecommendationForBrowser(response);
    expect(view.outcome).toBe("conditional");
    expect(view.conditional).toBe(true);
    expect(view.primary?.plan_id).toBe("plan_synthetic_direct_card");
    expect(view.fallback).toBeNull();
  });

  it.each(["verified", "blocked", "forged"])(
    "never relabels %s responses as synthetic or exposes routes",
    (status) => {
      const response = {
        ...evaluateSynthetic(validState),
        verification_status: status,
        assumptions: ["<script>do not expose</script>"],
        questions: ["forged question"],
      } as never;
      const view = mapRecommendationForBrowser(response);
      expect(view.synthetic_only).toBe(false);
      expect(view.primary).toBeNull();
      expect(view.fallback).toBeNull();
      expect(view.conditional_alternatives).toEqual([]);
      expect(view.assumptions).toEqual([]);
      expect(view.questions).toEqual([]);
      expect(view.deep_link_ids).toEqual([]);
      expect(view.freshness).toEqual({ status: "blocked" });
    },
  );

  it("requires a host-bound recommendation id and honors admission denial", () => {
    expect(() => mapCorrectionDraftForBrowser(validCorrection(), null)).toThrow(
      "recommendation_id_required",
    );
    expect(() =>
      mapCorrectionDraftForBrowser(validCorrection(), "request-id-not-bound"),
    ).toThrow("recommendation_id_invalid");
    expect(() =>
      mapCorrectionDraftForBrowser(
        {
          ...validCorrection(),
          note_code: "<script>free text</script>",
        } as never,
        validCorrection().recommendation_id,
      ),
    ).toThrow("correction_admission_denied");

    const draft = mapCorrectionDraftForBrowser(
      validCorrection(),
      validCorrection().recommendation_id,
    );
    expect(draft.status).toBe("not_submitted");
    expect(draft.recommendation_id).toBe(validCorrection().recommendation_id);
    expect(draft).not.toHaveProperty("message");
    expect(draft).not.toHaveProperty("source_ids");
  });
});
