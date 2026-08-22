import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  admitP0ReceiptReconciliation,
  admitP0SourceRolePlan,
  buildP0OperationsManifest,
} from "../src/index.js";

const planPath = resolve(
  process.cwd(),
  "../../registry/planning/p0-source-role-plan.v0.1.json",
);
const mapPath = resolve(
  process.cwd(),
  "../../registry/planning/p0-agent-feed-reconciliation-map.v1.json",
);

describe("checked-in live P0 reconciliation map", () => {
  it("binds all five completed Agent Feed runs to the current manifest", () => {
    const planAdmission = admitP0SourceRolePlan(
      JSON.parse(readFileSync(planPath, "utf8")) as unknown,
    );
    if (!planAdmission.ok)
      throw new Error(JSON.stringify(planAdmission.issues));
    const manifest = buildP0OperationsManifest(planAdmission.plan);
    const map = JSON.parse(readFileSync(mapPath, "utf8")) as Record<
      string,
      unknown
    >;

    expect(map).toMatchObject({
      version: "p0-agent-feed-reconciliation-map.v1",
      plan_sha256: manifest.plan_sha256,
      manifest_sha256: manifest.manifest_sha256,
    });
    const reconciliations = map.reconciliations;
    expect(reconciliations).toBeDefined();
    if (
      reconciliations === null ||
      typeof reconciliations !== "object" ||
      Array.isArray(reconciliations)
    )
      throw new Error("reconciliation map is not an object");

    const expected = new Map([
      ["5c58e9ff-7017-4f4e-bf44-fce060f69d4a", ["point.d", 1]],
      ["baebbdc0-6460-4e6c-914e-8b1f88f99c7e", ["point.jre", 4]],
      ["3f8cbb3f-0758-4570-ae6f-345786d7c9ce", ["point.nanaco", 1]],
      ["44ff344a-8ed3-4372-9916-3bbd4f16f386", ["merchant.amazon-jp", 1]],
      ["8b1222b4-d705-44ef-9698-ade97814d966", ["reg.jp.meti.cashless", 4]],
    ] as const);
    expect(Object.keys(reconciliations).sort()).toEqual(
      [...expected.keys()].sort(),
    );

    let checkpointCount = 0;
    let economicFindingCount = 0;
    for (const [runId, [familyId, count]] of expected) {
      const raw = reconciliations[runId];
      const reconciliation = admitP0ReceiptReconciliation(manifest, raw);
      expect(reconciliation.run_id).toBe(runId);
      expect(reconciliation.family_id).toBe(familyId);
      expect(reconciliation.terminal_status).toBe("completed");
      expect(reconciliation.checkpoints).toHaveLength(count);
      for (const checkpoint of reconciliation.checkpoints) {
        expect(checkpoint.outcome).toBe("resolved");
        expect(checkpoint.run_id).toBe(runId);
        expect(checkpoint.event_id).toBe(`evt_${runId}_terminal`);
        expect(checkpoint.locator).toMatch(/^https:\/\//u);
        expect(checkpoint.locator_fingerprint).toMatch(
          /^sha256:[0-9a-f]{64}$/u,
        );
        checkpointCount += 1;
        economicFindingCount += checkpoint.economic_findings_accepted;
      }
    }
    expect(checkpointCount).toBe(11);
    expect(economicFindingCount).toBe(11);
  });
});
