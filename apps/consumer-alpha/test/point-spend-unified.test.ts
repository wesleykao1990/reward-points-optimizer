import { promises as fs } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CampaignRouteSourcePort } from "../src/campaign-route-recommendation.js";
import {
  listPointSpendBrowserOptions,
  parsePointSpendBrowserInput,
} from "../src/point-spend-recommendation.js";
import { recommendUnifiedPointSpend } from "../src/point-spend-unified.js";
import { handleRequest, requestBodyLimit } from "../src/server.js";

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
  readonly sources: readonly Record<string, unknown>[];
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

const genericArtifacts = await Promise.all(
  [
    "p0-point-rules-a.research.v0.1.json",
    "p0-point-rules-b.research.v0.1.json",
    "p0-wallet-card-rules.research.v0.1.json",
    "p0-merchant-transit-regulatory-rules.research.v0.1.json",
  ].map(async (name) =>
    JSON.parse(
      await fs.readFile(
        new URL(`../../../fixtures/m3/agent-feed/${name}`, import.meta.url),
        "utf8",
      ),
    ),
  ),
);

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
            sources: artifact.sources,
          },
          ...genericArtifacts,
        ],
        provenance: [
          {
            research_artifact_id: artifact.metadata.artifact_id,
            implementation_version:
              "p0-complex-route-benchmark.implementation.v0.7",
            implementation_hash: `sha256:${"b".repeat(64)}`,
            as_of: "2026-08-24T11:30:00.000Z",
            claim_count: suppliedClaims.length,
          },
        ],
        as_of: "2026-08-24T11:30:00.000Z",
      };
    },
  };
}

const genericInput = {
  source_asset_id: "asset.point.rakuten",
  target_asset_id: "asset.mile.ana",
  balance: 1000,
  objective: "maximize_target" as const,
  effective_at: "2026-08-23T12:00:00+09:00",
  confirmed_rule_ids: ["p0.transfer.rakuten.ana"],
  unit_value_jpy: null,
};

describe("unified point-spend campaign lane", () => {
  it("derives campaign assets and bounded lanes from the source claims", async () => {
    const result = await listPointSpendBrowserOptions(source());
    expect(result.assets).toEqual(
      expect.arrayContaining([
        {
          asset_id: "asset.point.moppy",
          label: "モッピーポイント",
          kind: "reward_point",
        },
        {
          asset_id: "asset.value.jpy-spend",
          label: "日本円での支出",
          kind: "fiat",
        },
      ]),
    );
    expect(result.campaign_routes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          route_id: "moppy_aug_2026",
          source_asset_id: "asset.point.moppy",
          target_asset_id: "asset.mile.jal",
          principal_source_amount: "12000",
          principal_target_amount: "6000",
        }),
        expect.objectContaining({
          route_id: "jal_mileage_park_rakuten",
          source_asset_id: "asset.value.jpy-spend",
          target_asset_id: "asset.mile.jal",
          principal_source_amount: "300",
          principal_target_amount: "1",
        }),
      ]),
    );
    expect(
      result.coverage.targets_by_source.find(
        (item) => item.asset_id === "asset.point.moppy",
      )?.targets,
    ).toContainEqual(expect.objectContaining({ asset_id: "asset.mile.jal" }));
  });

  it("maps the eligible Moppy principal into the normal winner and keeps modifiers separate", async () => {
    const result = await recommendUnifiedPointSpend(
      {
        source_asset_id: "asset.point.moppy",
        target_asset_id: "asset.mile.jal",
        balance: 12_000,
        objective: "maximize_target",
        effective_at: "2026-08-15T12:00:00+09:00",
        confirmed_rule_ids: [],
        confirmed_prerequisite_ids: [],
        period_source_used_by_rule: {},
        unit_value_jpy: null,
        campaign_application: true,
        campaign_ad_earned_points: 10_000,
        campaign_monthly_exchange_count: 0,
        portal_traversal_confirmed: null,
      },
      source(),
    );
    expect(result).toMatchObject({
      status: "ready",
      campaign_applied: true,
      winner: {
        target_amount: "6000",
        source_amount_used: "12000",
        steps: [
          {
            source_node_id: "asset.point.moppy",
            destination_node_id: "asset.mile.jal",
            destination_amount: "6000",
          },
        ],
      },
      campaign_rewards: [
        { kind: "bonus", amount: "1200" },
        { kind: "rebate", amount: "4500" },
      ],
    });
    expect(result.campaign_rewards).not.toContainEqual(
      expect.objectContaining({ kind: "principal" }),
    );
  });

  it("reports unresolved and expired campaigns without applying them", async () => {
    const missing = await recommendUnifiedPointSpend(
      {
        ...genericInput,
        source_asset_id: "asset.point.moppy",
        target_asset_id: "asset.mile.jal",
        balance: 12_000,
        campaign_application: true,
        campaign_ad_earned_points: null,
        campaign_monthly_exchange_count: null,
        portal_traversal_confirmed: null,
      },
      source(),
    );
    expect(missing).toMatchObject({
      status: "no_route",
      no_route_reason: "condition_confirmation_required",
      campaign_applied: false,
      winner: null,
      campaign_rewards: [],
    });
    expect(missing.campaign_prerequisites).toEqual(
      expect.arrayContaining([expect.objectContaining({ status: "missing" })]),
    );

    const expired = await recommendUnifiedPointSpend(
      {
        ...genericInput,
        source_asset_id: "asset.point.moppy",
        target_asset_id: "asset.mile.jal",
        balance: 12_000,
        effective_at: "2026-09-01T00:00:00+09:00",
        campaign_application: true,
        campaign_ad_earned_points: 10_000,
        campaign_monthly_exchange_count: 0,
        portal_traversal_confirmed: null,
      },
      source(),
    );
    expect(expired).toMatchObject({
      status: "no_route",
      no_route_reason: "outside_validity_window",
      campaign_applied: false,
      campaign_rewards: [],
    });
  });

  it("maps the JAL portal campaign from explicitly labeled JPY spend", async () => {
    const result = await recommendUnifiedPointSpend(
      {
        ...genericInput,
        source_asset_id: "asset.value.jpy-spend",
        target_asset_id: "asset.mile.jal",
        balance: 30_000,
        campaign_application: true,
        campaign_ad_earned_points: null,
        campaign_monthly_exchange_count: null,
        portal_traversal_confirmed: true,
      },
      source(),
    );
    expect(result).toMatchObject({
      status: "ready",
      campaign_applied: true,
      winner: {
        target_amount: "100",
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
      },
      campaign_rewards: [],
    });
  });

  it("leaves generic routes unchanged and keeps parser admission descriptor-safe", async () => {
    const result = await recommendUnifiedPointSpend(genericInput, source());
    expect(result.campaign_applied).toBe(false);
    expect(result.campaign_rewards).toEqual([]);
    expect(result.campaign_prerequisites).toEqual([]);

    const hostile = new Proxy(genericInput, {
      getOwnPropertyDescriptor() {
        throw new Error("proxy_should_not_be_observed");
      },
    });
    expect(() => parsePointSpendBrowserInput(hostile)).toThrow(
      "point_spend_request_invalid",
    );
  });

  it("routes the HTTP recommendation through the same unified adapter", async () => {
    const body = JSON.stringify({
      source_asset_id: "asset.point.moppy",
      target_asset_id: "asset.mile.jal",
      balance: 12_000,
      objective: "maximize_target",
      effective_at: "2026-08-15T12:00:00+09:00",
      confirmed_rule_ids: [],
      confirmed_prerequisite_ids: [],
      period_source_used_by_rule: {},
      unit_value_jpy: null,
      campaign_application: true,
      campaign_ad_earned_points: 10_000,
      campaign_monthly_exchange_count: 0,
      portal_traversal_confirmed: null,
    });
    const response = await handleRequest(
      {
        method: "POST",
        pathname: "/api/experimental/point-spend/recommendation",
        headers: {
          host: "127.0.0.1:3010",
          origin: "http://127.0.0.1:3010",
          "content-type": "application/json",
          "content-length": String(Buffer.byteLength(body, "utf8")),
        },
        body,
      },
      { routeGraphSource: source() },
    );
    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      status: "ready",
      campaign_applied: true,
      winner: { target_amount: "6000" },
    });
    expect(
      requestBodyLimit(
        "POST",
        "/api/experimental/campaign-routes/recommendation",
      ),
    ).toBeNull();
    const retired = await handleRequest({
      method: "POST",
      pathname: "/api/experimental/campaign-routes/recommendation",
      headers: {
        host: "127.0.0.1:3010",
        origin: "http://127.0.0.1:3010",
      },
    });
    expect(retired.status).toBe(404);
  });

  it("rejects nested proxies and accessors before reading their values", () => {
    const proxiedIds = new Proxy([], {});
    expect(() =>
      parsePointSpendBrowserInput({
        ...genericInput,
        confirmed_rule_ids: proxiedIds,
      }),
    ).toThrow("point_spend_request_invalid");

    let getterReads = 0;
    const accessorIds: unknown[] = [];
    Object.defineProperty(accessorIds, "0", {
      enumerable: true,
      get() {
        getterReads += 1;
        return "p0.transfer.rakuten.ana";
      },
    });
    Object.defineProperty(accessorIds, "length", { value: 1 });
    expect(() =>
      parsePointSpendBrowserInput({
        ...genericInput,
        confirmed_rule_ids: accessorIds,
      }),
    ).toThrow("point_spend_request_invalid");
    expect(getterReads).toBe(0);

    expect(() =>
      parsePointSpendBrowserInput({
        ...genericInput,
        period_source_used_by_rule: new Proxy({}, {}),
      }),
    ).toThrow("point_spend_request_invalid");
  });
});
