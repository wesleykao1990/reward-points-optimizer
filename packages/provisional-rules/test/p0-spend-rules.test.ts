import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { compileP0SpendRuleSet } from "../src/index.js";

const FILES = [
  "p0-point-rules-a.research.v0.1.json",
  "p0-point-rules-b.research.v0.1.json",
  "p0-wallet-card-rules.research.v0.1.json",
  "p0-merchant-transit-regulatory-rules.research.v0.1.json",
  "p0-complex-route-benchmark.research.v0.1.json",
  "p0-moppy-jal-standard.research.v0.1.json",
  "p0-exchange-route-completeness.research.v0.1.json",
] as const;

function artifacts(): unknown[] {
  return FILES.map((name) =>
    JSON.parse(
      readFileSync(
        new URL(`../../../fixtures/m3/agent-feed/${name}`, import.meta.url),
        "utf8",
      ),
    ),
  );
}

type CampaignClaim = {
  claim_id: string;
  family_id: string;
  source_role_id: string;
  source_ids: string[];
  value: Record<string, unknown>;
};

type CampaignRoleResult = {
  family_id: string;
  source_role_id: string;
  source_ids: string[];
  claim_ids: string[];
};

type CampaignSource = {
  source_id: string;
  family_id: string;
  roles: string[];
};

describe("P0 spend rule-shape compiler", () => {
  it("compiles an explicit fixed-ratio subset and classifies every P0 claim", () => {
    const result = compileP0SpendRuleSet(artifacts());

    expect(result.rules.length).toBeGreaterThan(0);
    expect(result.dispositions).toHaveLength(
      artifacts().reduce((total, artifact) => {
        const claims = (artifact as { claims?: unknown }).claims;
        return total + (Array.isArray(claims) ? claims.length : 0);
      }, 0),
    );
    expect(
      result.rules.find((rule) => rule.rule_id === "p0.transfer.rakuten.ana"),
    ).toMatchObject({
      source_units: "2",
      destination_units: "1",
      minimum_source_units: "50",
      source_asset: { asset_id: "asset.point.rakuten" },
      destination_asset: { asset_id: "asset.mile.ana" },
    });
    expect(
      result.rules.find((rule) => rule.rule_id === "p0.transfer.nanaco.ana"),
    ).toMatchObject({
      source_units: "500",
      destination_units: "250",
      increment_source_units: "500",
      processing_time_days_min: 2,
      processing_time_days_max: 7,
    });
    expect(
      result.rules.find((rule) => rule.rule_id === "p0.transfer.ponta.jal"),
    ).toMatchObject({
      source_units: "2",
      destination_units: "1",
      minimum_source_units: "2",
      increment_source_units: "2",
      source_claim_ids: [
        "claim.point.ponta.transfer.jal-rate.001",
        "claim.point.ponta.transfer.jal-unit-timing.001",
      ],
    });
    expect(
      result.rules.find(
        (rule) => rule.rule_id === "p0.transfer.moppy-to-jal-standard",
      ),
    ).toMatchObject({
      source_units: "1000",
      destination_units: "500",
      minimum_source_units: "1000",
      increment_source_units: "1000",
      fee_source_units: "0",
      processing_time_days_min: 0,
      processing_time_days_max: 0,
      source_asset: { asset_id: "asset.point.moppy" },
      destination_asset: { asset_id: "asset.mile.jal" },
    });
    expect(
      result.dispositions.find(
        (item) => item.claim_id === "claim.point.ponta.use.example-value.001",
      ),
    ).toMatchObject({ status: "information_only" });
    expect(
      result.dispositions.find(
        (item) =>
          item.claim_id ===
          "claim.point.rakuten.transfer.ana-to-rakuten-third.001",
      ),
    ).toMatchObject({ status: "state_required" });
    expect(
      result.dispositions.find(
        (item) =>
          item.claim_id === "claim.point.ponta.transfer.jal-unit-timing.001",
      ),
    ).toMatchObject({
      status: "companion_constraint",
      derived_rule_ids: ["p0.transfer.ponta.jal"],
    });
    expect(result.rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule_id: "p0.transfer.v-to-jr-kyupo",
          source_units: "10000",
          destination_units: "10000",
          source_asset: expect.objectContaining({ asset_id: "asset.point.v" }),
          destination_asset: expect.objectContaining({
            asset_id: "asset.point.jr-kyupo",
          }),
          partial_consumption: true,
        }),
        expect.objectContaining({
          rule_id: "p0.transfer.jr-kyupo-to-saison-permanent",
          source_units: "10000",
          destination_units: "2000",
          source_asset: expect.objectContaining({
            asset_id: "asset.point.jr-kyupo",
          }),
          destination_asset: expect.objectContaining({
            asset_id: "asset.point.saison-permanent",
          }),
          requires_rule_ids: ["prereq.jq-card-saison"],
          partial_consumption: true,
        }),
        expect.objectContaining({
          rule_id: "p0.transfer.saison-permanent-to-ana-mizuho",
          source_units: "2000",
          destination_units: "7000",
          processing_time_days_min: 21,
          processing_time_days_max: 56,
          cancellation_policy: "provider_defined",
          requires_rule_ids: ["prereq.mizuho-ana-existing-holder"],
          partial_consumption: true,
        }),
        expect.objectContaining({
          rule_id: "p0.transfer.v-to-ana-ana-card",
          source_units: "5",
          destination_units: "3",
          requires_rule_ids: ["prereq.ana-smbc-card"],
          partial_consumption: true,
        }),
        expect.objectContaining({
          rule_id: "p0.transfer.revolut-to-ana-pay",
          source_units: "1",
          destination_units: "1",
          source_asset: expect.objectContaining({
            asset_id: "asset.value.revolut-jpy",
            asset_kind: "stored_value",
          }),
          destination_asset: expect.objectContaining({
            asset_id: "asset.value.ana-pay",
            asset_kind: "stored_value",
          }),
          maximum_source_units_per_period: "100000",
          maximum_period: "rolling_30_day",
          fee_source_units: "0",
          partial_consumption: false,
          valid_from: "2025-05-27",
          valid_to: null,
          requires_rule_ids: ["prereq.revolut-ana-pay-card"],
          source_ids: ["jp.revolut.ana-pay-payment-limit"],
          source_claim_ids: [
            "claim.route.prerequisite.revolut-ana-pay-card.001",
            "claim.route.revolut.ana-pay.001",
          ],
        }),
      ]),
    );
    expect(
      result.rules.find(
        (rule) => rule.rule_id === "p0.transfer.jr-kyupo-to-saison-permanent",
      ),
    ).toMatchObject({
      source_claim_ids: [
        "claim.route.jr-kyupo.saison.001",
        "claim.route.prerequisite.jq-card-saison.001",
      ],
      processing_time_days_min: null,
      processing_time_days_max: null,
    });
    expect(
      result.dispositions.find(
        (item) =>
          item.claim_id === "claim.route.jal-mileage-park.amazon-suspended.001",
      ),
    ).toMatchObject({ status: "inactive", derived_rule_ids: [] });
    expect(
      result.dispositions.find(
        (item) => item.claim_id === "claim.route.kyash.ana-pay-no-reward.001",
      ),
    ).toMatchObject({ status: "information_only", derived_rule_ids: [] });
    expect(
      result.dispositions.find(
        (item) => item.claim_id === "claim.route.kyash.ana-pay-unavailable.001",
      ),
    ).toMatchObject({ status: "information_only", derived_rule_ids: [] });
    expect(
      result.dispositions.find(
        (item) =>
          item.claim_id === "claim.route.ana-pay.revolut-unavailable.001",
      ),
    ).toMatchObject({ status: "information_only", derived_rule_ids: [] });
    expect(
      result.dispositions.find(
        (item) =>
          item.claim_id === "claim.route.jal-mileage-park.rakuten-market.001",
      ),
    ).toMatchObject({ status: "information_only", derived_rule_ids: [] });
    expect(
      result.rules.some(
        (rule) =>
          rule.rule_id.includes("amazon") || rule.rule_id.includes("kyash"),
      ),
    ).toBe(false);
    expect(
      result.rules.some(
        (rule) =>
          rule.source_claim_ids.includes("claim.route.revolut.ana-pay.001") &&
          rule.destination_asset.asset_kind === "airline_mile",
      ),
    ).toBe(false);
    expect(result.rule_set_hash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("keeps Moppy/JAL campaign outputs separate and non-executable", () => {
    const result = compileP0SpendRuleSet(artifacts());
    const complex = artifacts().find(
      (artifact) =>
        (artifact as { metadata?: { artifact_id?: string } }).metadata
          ?.artifact_id === "p0-complex-route-benchmark.research.v0.1",
    ) as {
      claims: CampaignClaim[];
      role_results: CampaignRoleResult[];
      sources: CampaignSource[];
    };
    const campaignIds = [
      "claim.campaign.moppy-jal.principal.001",
      "claim.campaign.moppy-jal.jal-bonus.001",
      "claim.campaign.moppy-jal.moppy-rebate.001",
    ];
    expect(
      result.rules.filter((rule) =>
        rule.source_claim_ids.some((claimId) => campaignIds.includes(claimId)),
      ),
    ).toHaveLength(0);
    for (const claimId of campaignIds)
      expect(
        result.dispositions.find((item) => item.claim_id === claimId),
      ).toMatchObject({ status: "information_only", derived_rule_ids: [] });

    const principal = complex.claims.find(
      (claim) => claim.claim_id === campaignIds[0],
    );
    const bonus = complex.claims.find(
      (claim) => claim.claim_id === campaignIds[1],
    );
    const rebate = complex.claims.find(
      (claim) => claim.claim_id === campaignIds[2],
    );
    expect(principal?.value).toMatchObject({
      campaign: {
        source_units_debited: 12000,
        destination_units_principal: 6000,
        validity: {
          valid_from: "2026-08-01",
          valid_to: "2026-09-01",
        },
        bonus_prerequisite: {
          minimum_ad_earned_source_units: 10000,
          source_asset_origin: "advertising_only",
          must_be_earned_before_exchange: true,
        },
      },
    });
    expect(bonus?.value).toMatchObject({
      campaign: {
        base_destination_units: 6000,
        bonus_rate_percent: 20,
        bonus_units: 1200,
        posting: { status: "pending" },
      },
    });
    expect(rebate?.value).toMatchObject({
      campaign: {
        rebate_units: 4500,
        eligibility: {
          minimum_ad_earned_source_units: 10000,
          monthly_limit: 1,
        },
      },
    });

    const sourceById = new Map(
      complex.sources.map((source) => [source.source_id, source]),
    );
    for (const claim of [principal, bonus, rebate]) {
      expect(claim).toBeDefined();
      const role = complex.role_results.find(
        (item) =>
          item.family_id === claim?.family_id &&
          item.source_role_id === claim?.source_role_id,
      );
      expect(role?.claim_ids).toContain(claim?.claim_id);
      for (const sourceId of claim?.source_ids ?? []) {
        expect(sourceById.get(sourceId)?.roles).toContain(
          claim?.source_role_id,
        );
        expect(role?.source_ids).toContain(sourceId);
        expect(sourceById.get(sourceId)?.family_id).toBe(claim?.family_id);
      }
    }
  });

  it("is order-independent and rejects hostile public values", () => {
    const left = compileP0SpendRuleSet(artifacts());
    const right = compileP0SpendRuleSet([...artifacts()].reverse());
    expect(right.rule_set_hash).toBe(left.rule_set_hash);

    let reads = 0;
    const hostile = artifacts();
    Object.defineProperty(hostile, "0", {
      enumerable: true,
      get() {
        reads += 1;
        return artifacts()[0];
      },
    });
    expect(() => compileP0SpendRuleSet(hostile)).toThrow(
      "p0_spend_artifacts_invalid",
    );
    expect(reads).toBe(0);
  });

  it("reuses an exact official source across route slices but rejects drift", () => {
    expect(() => compileP0SpendRuleSet(artifacts())).not.toThrow();
    const changed = structuredClone(artifacts());
    const finalArtifact = changed.at(-1) as {
      sources: Array<{ source_id: string; family_id: string }>;
    };
    const shared = finalArtifact.sources.find(
      (source) => source.source_id === "jp.jrkyushu.point-exchange",
    );
    expect(shared).toBeDefined();
    if (shared) shared.family_id = "point.forged";
    expect(() => compileP0SpendRuleSet(changed)).toThrow(
      "p0_spend_source_conflict:jp.jrkyushu.point-exchange",
    );

    const changedUrl = structuredClone(artifacts());
    const duplicateArtifact = changedUrl.at(-1) as {
      sources: Array<{ source_id: string; url: string }>;
    };
    const duplicateSource = duplicateArtifact.sources.find(
      (source) => source.source_id === "jp.jrkyushu.point-exchange",
    );
    expect(duplicateSource).toBeDefined();
    if (duplicateSource) duplicateSource.url = "https://example.invalid/";
    expect(() => compileP0SpendRuleSet(changedUrl)).toThrow(
      "p0_spend_source_conflict:jp.jrkyushu.point-exchange",
    );
  });

  it("rejects incomplete, duplicate, and mis-role-bound structured claims", () => {
    const base = artifacts();
    const complex = base.find(
      (artifact) =>
        (artifact as { metadata?: { artifact_id?: string } }).metadata
          ?.artifact_id === "p0-complex-route-benchmark.research.v0.1",
    ) as {
      claims: Array<Record<string, unknown>>;
      sources: Array<Record<string, unknown>>;
    };
    const direct = complex.claims.find(
      (claim) => claim.claim_id === "claim.route.v.ana-smbc.001",
    );
    expect(direct).toBeDefined();
    const transfer = (direct?.value as { transfer: Record<string, unknown> })
      .transfer;

    const incomplete = structuredClone(base) as typeof base;
    const incompleteComplex = incomplete.find(
      (artifact) =>
        (artifact as { metadata?: { artifact_id?: string } }).metadata
          ?.artifact_id === "p0-complex-route-benchmark.research.v0.1",
    ) as typeof complex;
    const incompleteClaim = incompleteComplex.claims.find(
      (claim) => claim.claim_id === "claim.route.v.ana-smbc.001",
    ) as { value: { transfer: Record<string, unknown> } };
    delete incompleteClaim.value.transfer.fee_source_units;
    const incompleteResult = compileP0SpendRuleSet(incomplete);
    expect(
      incompleteResult.rules.some(
        (rule) => rule.rule_id === "p0.transfer.v-to-ana-ana-card",
      ),
    ).toBe(false);
    expect(
      incompleteResult.dispositions.find(
        (item) => item.claim_id === "claim.route.v.ana-smbc.001",
      ),
    ).toMatchObject({ status: "information_only" });

    const misRole = structuredClone(base) as typeof base;
    const misRoleComplex = misRole.find(
      (artifact) =>
        (artifact as { metadata?: { artifact_id?: string } }).metadata
          ?.artifact_id === "p0-complex-route-benchmark.research.v0.1",
    ) as typeof complex;
    const directSource = misRoleComplex.sources.find(
      (source) => source.source_id === "jp.smbc.ana-vpoint-transfer",
    );
    expect(directSource).toBeDefined();
    directSource?.roles.splice(0, directSource.roles.length, "eligible_cards");
    const misRoleResult = compileP0SpendRuleSet(misRole);
    expect(
      misRoleResult.rules.some(
        (rule) => rule.rule_id === "p0.transfer.v-to-ana-ana-card",
      ),
    ).toBe(false);
    expect(
      misRoleResult.dispositions.find(
        (item) => item.claim_id === "claim.route.v.ana-smbc.001",
      ),
    ).toMatchObject({ status: "information_only" });

    const duplicate = structuredClone(base) as typeof base;
    const duplicateComplex = duplicate.find(
      (artifact) =>
        (artifact as { metadata?: { artifact_id?: string } }).metadata
          ?.artifact_id === "p0-complex-route-benchmark.research.v0.1",
    ) as typeof complex;
    duplicateComplex.claims.push(structuredClone(direct));
    expect(() => compileP0SpendRuleSet(duplicate)).toThrow(
      "p0_spend_claim_duplicate:claim.route.v.ana-smbc.001",
    );
    expect(transfer.fee_source_units).toBe(0);
  });

  it("hashes the complex slice deterministically under claim and source reordering", () => {
    const left = compileP0SpendRuleSet(artifacts());
    const reordered = structuredClone(artifacts()) as Array<{
      claims?: unknown[];
      sources?: unknown[];
      role_results?: unknown[];
    }>;
    const complex = reordered.find(
      (artifact) =>
        (artifact as { metadata?: { artifact_id?: string } }).metadata
          ?.artifact_id === "p0-complex-route-benchmark.research.v0.1",
    );
    complex?.claims?.reverse();
    complex?.sources?.reverse();
    complex?.role_results?.reverse();
    const right = compileP0SpendRuleSet(reordered);
    expect(right.rule_set_hash).toBe(left.rule_set_hash);
  });
});
