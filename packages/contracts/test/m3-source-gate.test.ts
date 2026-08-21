import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import {
  auditM3SourceReadiness,
  type M3SeedBlueprintDocument,
  type M3SourceGateInput,
  type SourceAccessObservationDocument,
  type SourceReviewQueueDocument,
  type TrustedSourceRegistry,
} from "../src/index.js";

const repositoryRoot = resolve(process.cwd(), "../..");

function load<T>(file: string): T {
  return YAML.parse(readFileSync(resolve(repositoryRoot, file), "utf8")) as T;
}

function baseline(): M3SourceGateInput {
  return {
    blueprints: load<M3SeedBlueprintDocument>(
      "examples/ten-seed-scenario-blueprints.yaml",
    ),
    registry: load<TrustedSourceRegistry>("registry/trusted-sources.v0.3.yaml"),
    review_queue: load<SourceReviewQueueDocument>(
      "registry/source-review-queue.v0.3.yaml",
    ),
    access_observations: load<SourceAccessObservationDocument>(
      "registry/source-access-observations.v0.3.yaml",
    ),
  };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function defined<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("expected fixture value");
  return value;
}

describe("M3 source-readiness gate", () => {
  it("audits all ten seed scenarios with only the approved manual slice promotion-ready", () => {
    const result = auditM3SourceReadiness(baseline());

    expect(result.automation_ready).toBe(false);
    expect(result.promotion_ready).toBe(false);
    expect(result.counts).toMatchObject({
      scenario_count: 10,
      unique_source_count: 21,
      automation_ready_scenario_count: 0,
      automation_blocked_scenario_count: 10,
      promotion_ready_scenario_count: 2,
      promotion_blocked_scenario_count: 8,
      automation_ready_source_count: 0,
      automation_blocked_source_count: 21,
      promotion_ready_source_count: 6,
      promotion_blocked_source_count: 15,
    });
    expect(result.scenario_readiness).toHaveLength(10);
    expect(result.source_readiness).toHaveLength(21);
    expect(
      result.source_readiness.every((item) => item.status === "blocked"),
    ).toBe(true);
    expect(
      result.counts.blocker_counts.registry_terms_not_reviewed,
    ).toBeGreaterThanOrEqual(15);
    expect(
      result.counts.blocker_counts.review_queue_terms_not_reviewed,
    ).toBeGreaterThanOrEqual(15);
    expect(result.counts.blocker_counts).toMatchObject({
      registry_terms_not_reviewed: 15,
      review_queue_terms_not_reviewed: 15,
      registry_automation_not_permitted: 21,
      review_queue_automation_not_permitted: 21,
      technical_feasibility_unknown: 14,
      technical_observation_missing: 14,
      manual_reachability_only: 1,
    });
  });

  it("allows manual promotion but not automation for the owner-approved slice", () => {
    const result = auditM3SourceReadiness(baseline());

    for (const sourceId of [
      "jp.nanaco.redemption-value",
      "jp.nanaco.sevencard-earning",
      "jp.nanaco.shopping-earning",
      "jp.sevencard.nanaco-charge",
      "merchant.seveneleven.nanaco",
      "merchant.seveneleven.payment-methods",
    ]) {
      const readiness = defined(
        result.source_readiness.find((item) => item.source_id === sourceId),
      );
      expect(readiness.per_source_observation_ids).toEqual([
        "sao_m3_seveneleven_nanaco_manual_20260820",
      ]);
      expect(readiness.automation_ready).toBe(false);
      expect(readiness.promotion_ready).toBe(true);
      expect(readiness.blockers).toContainEqual(
        expect.objectContaining({
          code: "technical_feasibility_not_automatable",
        }),
      );
      expect(readiness.promotion_blockers).toEqual([]);
    }
  });

  it("is independent of source, queue, observation, and scenario input order", () => {
    const input = baseline();
    const reordered = clone(input);
    reordered.blueprints = {
      ...input.blueprints,
      scenarios: [...input.blueprints.scenarios].reverse(),
    };
    reordered.registry = {
      ...input.registry,
      sources: [
        ...input.registry.sources,
      ].reverse() as TrustedSourceRegistry["sources"],
    };
    reordered.review_queue = {
      ...input.review_queue,
      items: [...input.review_queue.items].reverse(),
    };
    reordered.access_observations = {
      ...input.access_observations,
      observations: [...input.access_observations.observations].reverse(),
    };

    expect(auditM3SourceReadiness(reordered)).toEqual(
      auditM3SourceReadiness(input),
    );
  });

  it("fails closed when a blueprint source is absent from the registry or queue", () => {
    const missingRegistry = baseline();
    const blueprint = clone(missingRegistry.blueprints);
    const firstScenario = defined(blueprint.scenarios[0]);
    firstScenario.primary_source_ids = [
      ...firstScenario.primary_source_ids,
      "jp.missing.registry-source",
    ];
    missingRegistry.blueprints = blueprint;
    const registryResult = auditM3SourceReadiness(missingRegistry);
    const missingRegistrySource = registryResult.source_readiness.find(
      (item) => item.source_id === "jp.missing.registry-source",
    );
    expect(missingRegistrySource?.automation_ready).toBe(false);
    expect(missingRegistrySource?.blockers).toContainEqual(
      expect.objectContaining({ code: "missing_registry_source" }),
    );

    const missingQueue = baseline();
    const queue = clone(missingQueue.review_queue);
    queue.items = queue.items.filter(
      (item) => item.source_id !== "merchant.seveneleven.payment-methods",
    );
    missingQueue.review_queue = queue;
    const queueResult = auditM3SourceReadiness(missingQueue);
    const missingQueueSource = queueResult.source_readiness.find(
      (item) => item.source_id === "merchant.seveneleven.payment-methods",
    );
    expect(missingQueueSource?.review_queue_item_found).toBe(false);
    expect(missingQueueSource?.blockers).toContainEqual(
      expect.objectContaining({ code: "missing_review_queue_item" }),
    );
  });

  it("blocks a scenario that declares no primary sources", () => {
    const input = baseline();
    const blueprint = clone(input.blueprints);
    const firstScenario = defined(blueprint.scenarios[0]);
    firstScenario.primary_source_ids = [];
    input.blueprints = blueprint;

    const result = auditM3SourceReadiness(input);
    const scenario = defined(
      result.scenario_readiness.find(
        (item) => item.scenario_id === firstScenario.scenario_id,
      ),
    );
    expect(scenario.automation_ready).toBe(false);
    expect(scenario.promotion_ready).toBe(false);
    expect(scenario.automation_blockers).toContainEqual(
      expect.objectContaining({ code: "empty_primary_source_ids" }),
    );
    expect(scenario.promotion_blockers).toContainEqual(
      expect.objectContaining({ code: "empty_primary_source_ids" }),
    );
    expect(result.counts.blocker_counts.empty_primary_source_ids).toBe(1);
    expect(
      result.counts.promotion_blocker_counts.empty_primary_source_ids,
    ).toBe(1);
  });

  it("does not treat a registry-wide aggregate observation as per-source state", () => {
    const input = baseline();
    const targetId = "jp.paypay.third-party-card-voucher";
    const registry = clone(input.registry);
    const target = defined(
      registry.sources.find((source) => source.id === targetId),
    );
    target.access.terms_review_status = "approved";
    target.access.automation_status = "official_documentation";
    target.access.technical_feasibility.current_classification =
      "plain_http_observed_reachable";
    target.access.technical_feasibility.observation_ids = [
      "sao_agent_review_registry_probe_20260817",
    ];
    target.access.technical_feasibility.last_observed_at =
      "2026-08-17T14:00:00+09:00";
    registry.sources = registry.sources as TrustedSourceRegistry["sources"];
    input.registry = registry;

    const queue = clone(input.review_queue);
    const queueTarget = defined(
      queue.items.find((item) => item.source_id === targetId),
    );
    queueTarget.current_terms_review_status = "approved";
    queueTarget.current_automation_status = "official_documentation";
    input.review_queue = queue;

    const result = auditM3SourceReadiness(input);
    const readiness = defined(
      result.source_readiness.find((item) => item.source_id === targetId),
    );
    expect(readiness.per_source_observation_ids).toEqual([]);
    expect(readiness.automation_ready).toBe(false);
    expect(readiness.blockers).toContainEqual(
      expect.objectContaining({ code: "technical_observation_aggregate_only" }),
    );
  });

  it("fails closed and remains order-independent for duplicate observation IDs", () => {
    const duplicateId = "sao_official_web_checks_20260817";
    const firstInput = baseline();
    const secondInput = baseline();

    for (const [input, reverse] of [
      [firstInput, false],
      [secondInput, true],
    ] as const) {
      const observations = clone(input.access_observations);
      const original = defined(
        observations.observations.find(
          (observation) => observation.observation_id === duplicateId,
        ),
      );
      const unavailable = {
        ...original,
        result: "unavailable" as const,
        notes: "conflicting duplicate used only by the hostile test",
      };
      const duplicatePair = reverse
        ? [unavailable, original]
        : [original, unavailable];
      observations.observations = observations.observations.flatMap(
        (observation) =>
          observation.observation_id === duplicateId
            ? duplicatePair
            : [observation],
      );
      input.access_observations = observations;
    }

    const firstResult = auditM3SourceReadiness(firstInput);
    const secondResult = auditM3SourceReadiness(secondInput);
    expect(firstResult).toEqual(secondResult);
    const readiness = defined(
      firstResult.source_readiness.find(
        (item) => item.source_id === "jp.paypay.third-party-card-voucher",
      ),
    );
    expect(readiness.automation_ready).toBe(false);
    expect(readiness.promotion_ready).toBe(false);
    expect(readiness.blockers).toContainEqual(
      expect.objectContaining({ code: "duplicate_observation_id" }),
    );
    expect(readiness.promotion_blockers).toContainEqual(
      expect.objectContaining({ code: "duplicate_observation_id" }),
    );
    expect(
      firstResult.counts.blocker_counts.duplicate_observation_id,
    ).toBeGreaterThan(0);
  });

  it("does not turn manual/browser reachability into automated permission", () => {
    const input = baseline();
    const targetId = "jp.paypay.third-party-card-voucher";
    const registry = clone(input.registry);
    const target = defined(
      registry.sources.find((source) => source.id === targetId),
    );
    target.access.terms_review_status = "approved";
    target.access.automation_status = "official_documentation";
    target.access.technical_feasibility.current_classification =
      "plain_http_observed_reachable";
    input.registry = registry;

    const queue = clone(input.review_queue);
    const queueTarget = defined(
      queue.items.find((item) => item.source_id === targetId),
    );
    queueTarget.current_terms_review_status = "approved";
    queueTarget.current_automation_status = "official_documentation";
    input.review_queue = queue;

    const result = auditM3SourceReadiness(input);
    const readiness = defined(
      result.source_readiness.find((item) => item.source_id === targetId),
    );
    expect(readiness.per_source_observation_ids).toEqual([
      "sao_official_web_checks_20260817",
    ]);
    expect(readiness.automation_ready).toBe(false);
    expect(readiness.blockers).toContainEqual(
      expect.objectContaining({ code: "manual_reachability_only" }),
    );
  });

  it("allows a terms-approved manual-only source for promotion without automated observations", () => {
    const input = baseline();
    const targetId = "merchant.seveneleven.payment-methods";
    const registry = clone(input.registry);
    const target = defined(
      registry.sources.find((source) => source.id === targetId),
    );
    target.access.terms_review_status = "approved";
    target.access.automation_status = "manual_only";
    target.access.technical_feasibility.current_classification = "unknown";
    target.access.technical_feasibility.observation_ids = [];
    target.access.technical_feasibility.last_observed_at = null;
    input.registry = registry;

    const queue = clone(input.review_queue);
    const queueTarget = defined(
      queue.items.find((item) => item.source_id === targetId),
    );
    queueTarget.current_terms_review_status = "approved";
    queueTarget.current_automation_status = "manual_only";
    input.review_queue = queue;

    const result = auditM3SourceReadiness(input);
    const readiness = defined(
      result.source_readiness.find((item) => item.source_id === targetId),
    );
    expect(readiness.automation_ready).toBe(false);
    expect(readiness.promotion_ready).toBe(true);
    expect(readiness.status).toBe("blocked");
    expect(readiness.automation_blockers.length).toBeGreaterThan(0);
    expect(readiness.promotion_blockers).toEqual([]);

    const scenario = defined(
      result.scenario_readiness.find(
        (item) => item.scenario_id === "JP-CVS-002",
      ),
    );
    expect(scenario.automation_ready).toBe(false);
    expect(scenario.promotion_ready).toBe(true);
  });
});
