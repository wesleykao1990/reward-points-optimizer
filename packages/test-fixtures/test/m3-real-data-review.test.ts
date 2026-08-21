import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import {
  auditM3SourceReadiness,
  type M3SeedBlueprintDocument,
  type SourceAccessObservationDocument,
  type SourceReviewQueueDocument,
  type TrustedSourceRegistry,
} from "../../contracts/src/index.ts";
import {
  evaluateM3Scenario,
  type M3ScenarioRecord,
  type M3ScenarioSourceReadiness,
} from "../src/m3-gate.ts";

const repositoryRoot = resolve(process.cwd(), "../..");

function loadYaml<T>(path: string): T {
  return YAML.parse(readFileSync(resolve(repositoryRoot, path), "utf8")) as T;
}

function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(resolve(repositoryRoot, path), "utf8")) as T;
}

describe("M3 reviewed real-data slice", () => {
  it("clears each isolated scenario gate using authoritative manual source readiness", () => {
    const sourceGate = auditM3SourceReadiness({
      blueprints: loadYaml<M3SeedBlueprintDocument>(
        "examples/ten-seed-scenario-blueprints.yaml",
      ),
      registry: loadYaml<TrustedSourceRegistry>(
        "registry/trusted-sources.v0.3.yaml",
      ),
      review_queue: loadYaml<SourceReviewQueueDocument>(
        "registry/source-review-queue.v0.3.yaml",
      ),
      access_observations: loadYaml<SourceAccessObservationDocument>(
        "registry/source-access-observations.v0.3.yaml",
      ),
    });

    expect(sourceGate.automation_ready).toBe(false);
    expect(sourceGate.promotion_ready).toBe(false);
    expect(sourceGate.counts.promotion_ready_scenario_count).toBe(2);

    const records = [
      loadJson<M3ScenarioRecord>(
        "fixtures/m3/real-data/jp-cvs-002/scenario-record-reviewed.json",
      ),
      loadJson<M3ScenarioRecord>(
        "fixtures/m3/real-data/jp-cvs-006/reviewed-scenario.v0.1.json",
      ),
    ];

    for (const record of records) {
      const readiness = sourceGate.scenario_readiness.find(
        (item) => item.scenario_id === record.scenario_id,
      );
      expect(readiness).toBeDefined();
      expect(readiness?.promotion_ready).toBe(true);
      expect(readiness?.promotion_blockers).toEqual([]);
      const result = evaluateM3Scenario(
        record,
        readiness as M3ScenarioSourceReadiness,
      );
      expect(result).toMatchObject({
        scenario_id: record.scenario_id,
        observed_status: "reviewed",
        can_promote_to_golden: true,
        safe_status: "golden",
      });
      expect(result.blockers).toEqual([]);
    }
  });
});
