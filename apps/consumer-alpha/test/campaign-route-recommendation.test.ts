import { promises as fs } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  type CampaignRouteSourcePort,
  parseCampaignRouteBrowserInput,
  recommendCampaignRoute,
} from "../src/campaign-route-recommendation.js";

const artifact = JSON.parse(
  await fs.readFile(
    new URL(
      "../../../fixtures/m3/agent-feed/p0-complex-route-benchmark.research.v0.1.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as {
  readonly metadata: { readonly artifact_id: string };
  readonly claims: readonly Record<string, unknown>[];
};

const claims = artifact.claims.map((claim) => ({
  claim_id: claim.claim_id,
  family_id: claim.family_id,
  source_role_id: claim.source_role_id,
  claim_type: claim.claim_type,
  subject: claim.subject,
  predicate: claim.predicate,
  source_ids: claim.source_ids,
  value: claim.value,
  applicability: claim.applicability,
}));

function source(
  suppliedClaims: readonly Record<string, unknown>[] = claims,
): CampaignRouteSourcePort {
  return {
    async current() {
      return {
        artifacts: [
          {
            metadata: { artifact_id: artifact.metadata.artifact_id },
            claims: suppliedClaims,
          },
        ],
        provenance: [
          {
            research_artifact_id: artifact.metadata.artifact_id,
            implementation_version:
              "p0-complex-route-benchmark.implementation.v0.7",
            implementation_hash: `sha256:${"a".repeat(64)}`,
            as_of: "2026-08-24T11:30:00.000Z",
            claim_count: suppliedClaims.length,
          },
        ],
        as_of: "2026-08-24T11:30:00.000Z",
      };
    },
  };
}

const moppyInput = {
  scenario: "moppy_aug_2026" as const,
  effective_at: "2026-08-15T12:00:00+09:00",
  ad_earned_points: 10_000,
  monthly_exchange_count: 0,
};

const jalInput = {
  scenario: "jal_mileage_park_rakuten" as const,
  effective_at: "2026-08-15T12:00:00+09:00",
  purchase_amount_jpy: 30_000,
  portal_traversal_confirmed: true,
};

describe("campaign route recommendation", () => {
  it("keeps Moppy principal, bonus, and rebate as separate engine-backed cards", async () => {
    const result = await recommendCampaignRoute(
      parseCampaignRouteBrowserInput(moppyInput),
      source(),
    );
    expect(result).toMatchObject({
      version: "campaign-route-recommendation.v1",
      status: "eligible",
      data_origin: "database",
      winner: {
        source_amount: "12000",
        steps: [
          {
            source_node_id: "asset.point.moppy",
            destination_node_id: "asset.mile.jal",
          },
        ],
        rewards: [
          {
            kind: "principal",
            asset_id: "asset.mile.jal",
            asset_label: "JALマイル",
            amount: "6000",
            settlement: "posted",
          },
          {
            kind: "bonus",
            asset_id: "asset.mile.jal-campaign-bonus",
            asset_label: "JALマイル",
            amount: "1200",
            settlement: "pending",
          },
          {
            kind: "rebate",
            asset_id: "asset.point.moppy-campaign-rebate",
            asset_label: "モッピーポイント（スカイボーナス）",
            amount: "4500",
            settlement: "pending",
          },
        ],
      },
    });
    expect(JSON.stringify(result)).not.toMatch(
      /claim\.|source_ids|evidence|implementation|hash|https?:\/\//u,
    );
    expect(result.winner?.note).toContain("合算せず");
  });

  it("returns conditional or no-valid-plan when Moppy prerequisites are unresolved", async () => {
    const missing = await recommendCampaignRoute(
      parseCampaignRouteBrowserInput({
        scenario: "moppy_aug_2026",
        effective_at: moppyInput.effective_at,
      }),
      source(),
    );
    expect(missing).toMatchObject({
      status: "conditional",
      reason: "missing_prerequisite",
      winner: null,
    });

    const exhausted = await recommendCampaignRoute(
      parseCampaignRouteBrowserInput({
        ...moppyInput,
        monthly_exchange_count: 1,
      }),
      source(),
    );
    expect(exhausted).toMatchObject({
      status: "no_valid_plan",
      reason: "monthly_limit_reached",
      winner: null,
    });

    const outside = await recommendCampaignRoute(
      parseCampaignRouteBrowserInput({
        ...moppyInput,
        effective_at: "2026-09-01T00:00:00+09:00",
      }),
      source(),
    );
    expect(outside).toMatchObject({
      status: "no_valid_plan",
      reason: "outside_validity_window",
      winner: null,
    });
  });

  it("requires the exact JAL portal traversal and computes ¥30,000 as 100 pending miles", async () => {
    const result = await recommendCampaignRoute(
      parseCampaignRouteBrowserInput(jalInput),
      source(),
    );
    expect(result).toMatchObject({
      status: "eligible",
      winner: {
        steps: [
          {
            source_node_id: "portal.jal-mileage-park",
            destination_node_id: "merchant.rakuten-market",
          },
          {
            source_node_id: "merchant.rakuten-market",
            destination_node_id: "asset.mile.jal",
            destination_amount: "100",
          },
        ],
        rewards: [
          {
            kind: "portal_reward",
            asset_id: "asset.mile.jal",
            asset_label: "JALマイル",
            amount: "100",
            settlement: "pending",
            processing_days_min: 90,
            processing_days_max: 120,
          },
        ],
      },
    });
    const missing = await recommendCampaignRoute(
      parseCampaignRouteBrowserInput({
        ...jalInput,
        portal_traversal_confirmed: null,
      }),
      source(),
    );
    expect(missing).toMatchObject({
      status: "conditional",
      reason: "portal_traversal_required",
      winner: null,
    });
  });

  it("fails closed for incomplete or malformed DB data", async () => {
    await expect(
      recommendCampaignRoute(
        parseCampaignRouteBrowserInput(moppyInput),
        source([]),
      ),
    ).rejects.toThrow("campaign_route_source_malformed");
    const malformed = claims.map((claim) =>
      claim.claim_id === "claim.campaign.moppy-jal.principal.001"
        ? {
            ...claim,
            value: {
              ...(claim.value as Record<string, unknown>),
              campaign: {
                ...((claim.value as Record<string, unknown>).campaign as Record<
                  string,
                  unknown
                >),
                destination_units_principal: 999,
              },
            },
          }
        : claim,
    );
    await expect(
      recommendCampaignRoute(
        parseCampaignRouteBrowserInput(moppyInput),
        source(malformed),
      ),
    ).rejects.toThrow("campaign_route_source_malformed");
  });
});
