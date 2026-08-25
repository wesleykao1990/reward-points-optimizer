import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  PRODUCTION_EXCHANGE_DIRECTORY_SNAPSHOT_VERSION,
  reconcileProductionExchangeDirectory,
} from "../src/index.js";

const artifact = JSON.parse(
  readFileSync(
    new URL(
      "../../../fixtures/m3/agent-feed/p0-exchange-route-completeness.research.v0.1.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as {
  sources: Record<string, unknown>[];
  claims: Record<string, unknown>[];
};

const claim = artifact.claims.find(
  (item) => item.claim_id === "claim.route.moppy.ana.001",
) as Record<string, unknown>;
const sources = artifact.sources.filter((item) =>
  (claim.source_ids as string[]).includes(item.source_id as string),
);

const snapshot = () => ({
  version: PRODUCTION_EXCHANGE_DIRECTORY_SNAPSHOT_VERSION,
  directory_id: "directory.moppy.exchange",
  family_id: "point.moppy",
  source_role_id: "transfer_partner_directory",
  source_asset_id: "asset.point.moppy",
  complete: true,
  sources: structuredClone(sources),
  entries: [
    {
      entry_id: "moppy-to-ana",
      destination_asset_id: "asset.mile.ana",
      disposition: "exact_executable",
      primary_claim_id: "claim.route.moppy.ana.001",
      claims: [structuredClone(claim)],
      research_request: null,
    },
    {
      entry_id: "moppy-to-unknown-fee-destination",
      destination_asset_id: "asset.point.ponta",
      disposition: "incomplete_parameters",
      primary_claim_id: null,
      claims: [],
      research_request: {
        missing_fields: ["fee_schedule"],
        question_ja: "交換額ごとの手数料表を公式ページで確認してください。",
      },
    },
  ],
});

describe("production exchange-directory reconciliation", () => {
  it("compiles exact entries and creates precise research tasks for incomplete rows", () => {
    const result = reconcileProductionExchangeDirectory(snapshot());
    expect(result.outcomes).toEqual([
      {
        entry_id: "moppy-to-ana",
        destination_asset_id: "asset.mile.ana",
        disposition: "exact_executable",
        rule_ids: ["p0.transfer.moppy-to-ana"],
        research_request: null,
      },
      {
        entry_id: "moppy-to-unknown-fee-destination",
        destination_asset_id: "asset.point.ponta",
        disposition: "incomplete_parameters",
        rule_ids: [],
        research_request: {
          missing_fields: ["fee_schedule"],
          question_ja: "交換額ごとの手数料表を公式ページで確認してください。",
        },
      },
    ]);
    expect(result.affected_asset_ids).toEqual([
      "asset.mile.ana",
      "asset.point.moppy",
      "asset.point.ponta",
    ]);
    expect(result.affected_rule_ids).toEqual(["p0.transfer.moppy-to-ana"]);
  });

  it("rejects an executable label whose exact claim cannot compile", () => {
    const input = snapshot();
    const route = input.entries[0]?.claims[0] as Record<string, unknown>;
    const value = route.value as Record<string, unknown>;
    const transfer = value.transfer as Record<string, unknown>;
    transfer.fee_source_units = null;
    expect(() => reconcileProductionExchangeDirectory(input)).toThrow(
      "exchange_directory_claim_not_executable",
    );
  });

  it("rejects hostile values before dereferencing their fields", () => {
    let reads = 0;
    const hostile = snapshot();
    Object.defineProperty(hostile.entries[0], "entry_id", {
      enumerable: true,
      get() {
        reads += 1;
        return "moppy-to-ana";
      },
    });
    expect(() => reconcileProductionExchangeDirectory(hostile)).toThrow(
      "exchange_directory_snapshot_invalid",
    );
    expect(reads).toBe(0);
  });
});
