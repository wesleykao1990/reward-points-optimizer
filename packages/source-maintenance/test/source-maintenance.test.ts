import { describe, expect, it } from "vitest";
import {
  partialWindowFixture,
  syntheticCheck,
} from "../../../fixtures/m4/partial-window.ts";
import {
  appendEvaluationRecord,
  calculateM4Metrics,
  canonicalSha256,
  createDiffArtifact,
  createEvaluationLedger,
  createGroundTruthEvent,
  createLaneDetection,
  createMaterialityArtifact,
  createRunLedger,
  createSnapshotArtifact,
  evaluateDirectCheck,
  M4_COHORT_MANIFEST,
  M4_COHORT_SOURCE_IDS,
  validateM4Cohort,
} from "../src/index.ts";

function rehashRecord<T extends Record<string, unknown>>(
  record: T,
): T & { record_hash: string } {
  const { record_hash: _recordHash, ...payload } = record;
  return {
    ...payload,
    record_hash: canonicalSha256(
      payload as unknown as Parameters<typeof canonicalSha256>[0],
    ),
  } as T & { record_hash: string };
}

describe("fixed M4 cohort", () => {
  it("keeps the exact eight-source order and rejects drift", () => {
    expect(validateM4Cohort(M4_COHORT_SOURCE_IDS).valid).toBe(true);
    expect(
      validateM4Cohort([
        ...M4_COHORT_SOURCE_IDS.slice(1),
        M4_COHORT_SOURCE_IDS[0],
      ]).valid,
    ).toBe(false);
    expect(Object.isFrozen(M4_COHORT_MANIFEST)).toBe(true);
    expect(Object.isFrozen(M4_COHORT_MANIFEST.sources)).toBe(true);
  });
});

describe("permission-aware direct check", () => {
  it("blocks the production cohort before capture", () => {
    const check = evaluateDirectCheck({
      check_id: "check_production_blocked",
      source_id: M4_COHORT_SOURCE_IDS[0],
      checked_at: "2026-08-01T00:00:00Z",
      permission: {
        terms_review_status: "not_reviewed",
        technical_classification: "unknown",
        observation: {
          observation_id: "aggregate_observation",
          source_id: M4_COHORT_SOURCE_IDS[0],
          observed_at: "2026-08-01T00:00:00Z",
          method: "manual_capture",
          scope: "aggregate",
          result: "reachable",
          permission_asserted: false,
          representation_kind: "test_fixture",
        },
      },
      synthetic: true,
    });
    expect(check.state).toBe("blocked_permission");
    expect(check.blockers.map((blocker) => blocker.code)).toEqual(
      expect.arrayContaining([
        "terms_not_approved",
        "technical_feasibility_unknown",
        "aggregate_observation_only",
      ]),
    );
    expect(check.canonical_evidence_ids).toEqual([]);
  });

  it("takes unchanged, material, and security paths without canonical evidence", () => {
    const observation = {
      observation_id: "obs_test_ready",
      source_id: M4_COHORT_SOURCE_IDS[0],
      observed_at: "2026-08-01T00:00:00Z",
      method: "manual_capture" as const,
      scope: "per_source" as const,
      result: "reachable" as const,
      permission_asserted: true,
      representation_kind: "test_fixture" as const,
    };
    const snapshot = createSnapshotArtifact({
      snapshot_id: "snapshot_test_ready",
      source_id: M4_COHORT_SOURCE_IDS[0],
      captured_at: observation.observed_at,
      capture_method: "manual_capture",
      representation_kind: "test_fixture",
      representation_digest: "sha256:test-only",
      completeness: "complete",
    });
    const check = evaluateDirectCheck({
      check_id: "check_test_ready",
      source_id: M4_COHORT_SOURCE_IDS[0],
      checked_at: observation.observed_at,
      permission: {
        terms_review_status: "approved",
        technical_classification: "manual_only",
        observation,
      },
      snapshot,
      human_minutes: 2,
      synthetic: true,
    });
    expect(check.state).toBe("captured");
    expect(check.canonical_evidence_ids).toEqual([]);
  });

  it("fails closed for non-ready technical classifications and hostile artifacts", () => {
    const fixtureCheck = syntheticCheck(
      M4_COHORT_SOURCE_IDS[0],
      1,
      "unchanged",
      2,
    );
    const base = {
      check_id: "check_hostile_artifacts",
      source_id: fixtureCheck.source_id,
      checked_at: fixtureCheck.checked_at,
      planned_method: fixtureCheck.planned_method,
      permission: fixtureCheck.permission,
      human_minutes: 2,
      synthetic: true,
    } as const;
    const notReady = evaluateDirectCheck({
      ...base,
      check_id: "check_not_ready",
      permission: {
        ...fixtureCheck.permission,
        technical_classification: "not_reachable",
      },
    });
    expect(notReady.state).toBe("blocked_technical");
    expect(notReady.blockers.map((item) => item.code)).toContain(
      "technical_classification_not_ready",
    );

    const hostileSnapshot = {
      ...fixtureCheck.snapshot,
      representation_digest: "tampered_without_rehash",
    };
    const invalidSnapshot = evaluateDirectCheck({
      ...base,
      check_id: "check_bad_snapshot",
      snapshot: hostileSnapshot,
    });
    expect(invalidSnapshot.state).toBe("capture_failed");
    expect(invalidSnapshot.blockers.map((item) => item.code)).toContain(
      "snapshot_hash_invalid",
    );

    const wrongSourceSnapshot = createSnapshotArtifact({
      snapshot_id: "snapshot_wrong_source_valid_hash",
      source_id: M4_COHORT_SOURCE_IDS[1],
      captured_at: fixtureCheck.checked_at,
      capture_method: "manual_capture",
      representation_kind: "test_fixture",
      representation_digest: "sha256:wrong-source-test",
      completeness: "complete",
    });
    const wrongSourceSnapshotCheck = evaluateDirectCheck({
      ...base,
      check_id: "check_wrong_snapshot_source",
      snapshot: wrongSourceSnapshot,
    });
    expect(wrongSourceSnapshotCheck.state).toBe("capture_failed");
    expect(
      wrongSourceSnapshotCheck.blockers.map((item) => item.code),
    ).toContain("snapshot_source_mismatch");

    const invalidDiff = {
      ...fixtureCheck.diff,
      after_snapshot_id: "wrong_snapshot",
    };
    const invalidDiffCheck = evaluateDirectCheck({
      ...base,
      check_id: "check_bad_diff_link",
      snapshot: fixtureCheck.snapshot,
      diff: invalidDiff,
    });
    expect(invalidDiffCheck.state).toBe("capture_failed");
    expect(invalidDiffCheck.blockers.map((item) => item.code)).toContain(
      "diff_hash_invalid",
    );

    const validWrongLinkDiff = createDiffArtifact({
      diff_id: "diff_wrong_link_valid_hash",
      source_id: fixtureCheck.source_id,
      before_snapshot_id: null,
      after_snapshot_id: "wrong_snapshot",
      changed: false,
      classification: "unchanged",
    });
    const wrongLinkCheck = evaluateDirectCheck({
      ...base,
      check_id: "check_wrong_diff_link",
      snapshot: fixtureCheck.snapshot,
      diff: validWrongLinkDiff,
    });
    expect(wrongLinkCheck.state).toBe("capture_failed");
    expect(wrongLinkCheck.blockers.map((item) => item.code)).toContain(
      "diff_snapshot_link_mismatch",
    );

    const invalidMateriality = {
      ...fixtureCheck.materiality,
      impact_tags: ["tampered_without_rehash"],
    };
    const invalidMaterialityCheck = evaluateDirectCheck({
      ...base,
      check_id: "check_bad_materiality_hash",
      snapshot: fixtureCheck.snapshot,
      diff: fixtureCheck.diff,
      materiality: invalidMateriality,
    });
    expect(invalidMaterialityCheck.state).toBe("capture_failed");
    expect(invalidMaterialityCheck.blockers.map((item) => item.code)).toContain(
      "materiality_hash_invalid",
    );

    const validWrongMaterialityLink = createMaterialityArtifact({
      materiality_id: "materiality_wrong_link_valid_hash",
      source_id: fixtureCheck.source_id,
      diff_id: "wrong_diff",
      materiality: "unchanged",
      review_required: false,
      impact_tags: [],
    });
    const wrongMaterialityLinkCheck = evaluateDirectCheck({
      ...base,
      check_id: "check_wrong_materiality_link",
      snapshot: fixtureCheck.snapshot,
      diff: fixtureCheck.diff,
      materiality: validWrongMaterialityLink,
    });
    expect(wrongMaterialityLinkCheck.state).toBe("capture_failed");
    expect(
      wrongMaterialityLinkCheck.blockers.map((item) => item.code),
    ).toContain("materiality_diff_mismatch");
  });

  it("records all three materiality transitions as review-bound states", () => {
    const unchanged = syntheticCheck(
      M4_COHORT_SOURCE_IDS[0],
      1,
      "unchanged",
      1,
    );
    const material = syntheticCheck(M4_COHORT_SOURCE_IDS[0], 2, "material", 1);
    const security = syntheticCheck(M4_COHORT_SOURCE_IDS[0], 3, "security", 1);
    expect(unchanged.state).toBe("unchanged");
    expect(material.state).toBe("material_review");
    expect(security.state).toBe("security_review");
    expect(material.canonical_evidence_ids).toEqual([]);
    expect(security.canonical_evidence_ids).toEqual([]);
  });

  it("enforces technical-classification and observed capture-method policy", () => {
    const sourceId = M4_COHORT_SOURCE_IDS[0];
    const checkedAt = "2026-08-10T00:00:00Z";
    const observation = {
      observation_id: "obs_method_policy",
      source_id: sourceId,
      observed_at: checkedAt,
      method: "official_api" as const,
      scope: "per_source" as const,
      result: "reachable" as const,
      permission_asserted: true,
      representation_kind: "test_fixture" as const,
    };
    const snapshot = createSnapshotArtifact({
      snapshot_id: "snapshot_method_policy",
      source_id: sourceId,
      captured_at: checkedAt,
      capture_method: "official_api",
      representation_kind: "test_fixture",
      representation_digest: "sha256:method-policy",
      completeness: "complete",
    });
    const mismatched = evaluateDirectCheck({
      check_id: "check_manual_only_official_api",
      source_id: sourceId,
      checked_at: checkedAt,
      planned_method: "official_api",
      permission: {
        terms_review_status: "approved",
        technical_classification: "manual_only",
        observation,
      },
      snapshot,
      synthetic: true,
    });
    expect(mismatched.state).toBe("blocked_permission");
    expect(mismatched.blockers.map((item) => item.code)).toContain(
      "collection_path_not_permitted",
    );

    const matching = evaluateDirectCheck({
      check_id: "check_official_api_available",
      source_id: sourceId,
      checked_at: checkedAt,
      planned_method: "official_api",
      permission: {
        terms_review_status: "approved",
        technical_classification: "official_api_available",
        observation,
      },
      snapshot,
      synthetic: true,
    });
    expect(matching.state).toBe("captured");

    const renderedObservation = {
      ...observation,
      observation_id: "obs_rendered_policy",
      method: "rendered_capture" as const,
    };
    const renderedSnapshot = createSnapshotArtifact({
      snapshot_id: "snapshot_rendered_policy",
      source_id: sourceId,
      captured_at: checkedAt,
      capture_method: "rendered_capture",
      representation_kind: "test_fixture",
      representation_digest: "sha256:rendered-policy",
      completeness: "complete",
    });
    const renderedBlocked = evaluateDirectCheck({
      check_id: "check_rendered_without_explicit_permission",
      source_id: sourceId,
      checked_at: checkedAt,
      planned_method: "rendered_capture",
      permission: {
        terms_review_status: "approved",
        technical_classification: "rendered_capture_only",
        observation: renderedObservation,
      },
      snapshot: renderedSnapshot,
      synthetic: true,
    });
    expect(renderedBlocked.state).toBe("blocked_permission");
    expect(renderedBlocked.blockers.map((item) => item.code)).toContain(
      "collection_path_not_permitted",
    );
    const renderedAllowed = evaluateDirectCheck({
      check_id: "check_rendered_with_explicit_permission",
      source_id: sourceId,
      checked_at: checkedAt,
      planned_method: "rendered_capture",
      permission: {
        terms_review_status: "approved",
        technical_classification: "rendered_capture_only",
        rendered_capture_allowed: true,
        observation: renderedObservation,
      },
      snapshot: renderedSnapshot,
      synthetic: true,
    });
    expect(renderedAllowed.state).toBe("captured");

    const methodMismatch = evaluateDirectCheck({
      check_id: "check_observation_method_mismatch",
      source_id: sourceId,
      checked_at: checkedAt,
      planned_method: "manual_capture",
      permission: {
        terms_review_status: "approved",
        technical_classification: "manual_only",
        observation: {
          ...observation,
          observation_id: "obs_manual_mismatch",
          method: "rendered_capture",
        },
      },
      synthetic: true,
    });
    expect(methodMismatch.blockers.map((item) => item.code)).toContain(
      "observation_method_mismatch",
    );

    const futureObservation = evaluateDirectCheck({
      check_id: "check_future_observation",
      source_id: sourceId,
      checked_at: checkedAt,
      planned_method: "manual_capture",
      permission: {
        terms_review_status: "approved",
        technical_classification: "manual_only",
        observation: {
          ...observation,
          observation_id: "obs_future",
          method: "manual_capture",
          observed_at: "2026-08-10T00:01:00Z",
        },
      },
      synthetic: true,
    });
    expect(futureObservation.blockers.map((item) => item.code)).toContain(
      "observation_timestamp_invalid",
    );

    const futureSnapshot = createSnapshotArtifact({
      snapshot_id: "snapshot_future",
      source_id: sourceId,
      captured_at: "2026-08-10T00:01:00Z",
      capture_method: "manual_capture",
      representation_kind: "test_fixture",
      representation_digest: "sha256:future-snapshot",
      completeness: "complete",
    });
    const futureSnapshotCheck = evaluateDirectCheck({
      check_id: "check_future_snapshot",
      source_id: sourceId,
      checked_at: checkedAt,
      planned_method: "manual_capture",
      permission: {
        terms_review_status: "approved",
        technical_classification: "manual_only",
        observation: {
          ...observation,
          observation_id: "obs_snapshot_future",
          method: "manual_capture",
        },
      },
      snapshot: futureSnapshot,
      synthetic: true,
    });
    expect(futureSnapshotCheck.blockers.map((item) => item.code)).toContain(
      "snapshot_timestamp_invalid",
    );
  });
});

describe("append-only records and metrics", () => {
  it("keeps hashes stable and rejects duplicate IDs", () => {
    const event = createGroundTruthEvent({
      event_id: "event_immutable",
      source_id: M4_COHORT_SOURCE_IDS[0],
      occurred_at: "2026-08-01T00:00:00Z",
      confirmed_at: "2026-08-01T01:00:00Z",
      materiality: "material",
      official_primary_source_hit: true,
      winner_impact: "changed",
      review_minutes: 1,
      synthetic: true,
    });
    const ledger = createEvaluationLedger([event]);
    expect(Object.isFrozen(ledger)).toBe(true);
    expect(() => appendEvaluationRecord(ledger, event)).toThrow(/Duplicate/);
    expect(ledger.records).toHaveLength(1);
    expect(() =>
      createGroundTruthEvent({
        ...event,
        canonical_evidence_ids: ["canonical_should_not_exist"],
      }),
    ).toThrow(/canonical evidence/i);
  });

  it("rejects completed runs without the exact ordered cohort scope", () => {
    const completed = partialWindowFixture.run_ledger[0];
    for (const actualScope of [
      [],
      [M4_COHORT_SOURCE_IDS[0]],
      [...M4_COHORT_SOURCE_IDS.slice(1), M4_COHORT_SOURCE_IDS[0]],
    ]) {
      expect(() =>
        createRunLedger({
          ...completed,
          actual_scope: actualScope,
        }),
      ).toThrow(/completed actual_scope/);
    }

    const forgedCompleted = rehashRecord({
      ...completed,
      actual_scope: [],
    });
    expect(() => createEvaluationLedger([forgedCompleted] as never)).toThrow(
      /Invalid immutable evaluation record/,
    );
    expect(() =>
      calculateM4Metrics({
        ...partialWindowFixture,
        run_ledger: [forgedCompleted],
      } as never),
    ).toThrow(/immutable shape\/hash validation/);
  });

  it("replays the partial synthetic window deterministically", () => {
    const first = calculateM4Metrics(partialWindowFixture);
    const second = calculateM4Metrics(partialWindowFixture);
    expect(first.input_hash).toBe(second.input_hash);
    expect(first).toEqual(second);
    expect(first.decision.status).toBe("insufficient_data");
    expect(first.decision.threshold_applied).toBe(false);
    expect(first.confirmed_material_event_count).toBe(2);
    expect(first.by_lane.direct.confirmed_change_recall).toBe(0.5);
    expect(first.by_lane.semantic.confirmed_change_recall).toBe(0.5);
    expect(first.by_lane.semantic.false_positive_count).toBe(2);
    expect(first.by_lane.semantic.transport_duplicate_count).toBe(1);
    expect(first.by_lane.semantic.completed_zero_finding_run_rate).toBe(0.2);
    expect(first.by_lane.semantic.partial_run_rate).toBe(0.2);
    expect(first.by_lane.semantic.failed_run_rate).toBe(0.2);
    expect(first.by_lane.semantic.cancelled_run_rate).toBe(0.2);
    expect(first.by_lane.semantic.absent_run_rate).toBe(0.2);
    expect(first.independent_sentinel_misses).toEqual([
      "gt_test_dbarai_campaign",
    ]);
  });

  it("grounds detections, official hits, and winners in matching canonical events", () => {
    const falseOfficialEvent = createGroundTruthEvent({
      event_id: "gt_test_official_false",
      source_id: M4_COHORT_SOURCE_IDS[0],
      occurred_at: "2026-08-01T00:00:00Z",
      confirmed_at: "2026-08-01T01:00:00Z",
      materiality: "material",
      official_primary_source_hit: false,
      winner_impact: "unchanged",
      review_minutes: 1,
      synthetic: true,
    });
    const claim = createLaneDetection({
      detection_id: "det_test_official_claim",
      lane: "semantic",
      source_id: falseOfficialEvent.source_id,
      detected_at: "2026-08-01T02:00:00Z",
      ground_truth_event_id: falseOfficialEvent.event_id,
      classification: "material",
      official_primary_source_hit: true,
      useful_finding: true,
      review_minutes: 1,
      model_cost: 0.1,
      synthetic: true,
    });
    const wrongSource = createLaneDetection({
      detection_id: "det_test_wrong_source",
      lane: "semantic",
      source_id: M4_COHORT_SOURCE_IDS[1],
      detected_at: "2026-08-01T02:00:00Z",
      ground_truth_event_id: falseOfficialEvent.event_id,
      classification: "material",
      official_primary_source_hit: true,
      useful_finding: true,
      review_minutes: 1,
      model_cost: 0.1,
      synthetic: true,
    });
    const metrics = calculateM4Metrics({
      ...partialWindowFixture,
      ground_truth_events: [
        ...partialWindowFixture.ground_truth_events,
        falseOfficialEvent,
      ],
      lane_detections: [
        ...partialWindowFixture.lane_detections,
        claim,
        wrongSource,
      ],
    });
    expect(metrics.by_lane.semantic.official_primary_source_hit_numerator).toBe(
      1,
    );
    expect(
      metrics.by_lane.semantic.official_primary_source_hit_denominator,
    ).toBe(2);
    expect(metrics.by_lane.semantic.false_positive_count).toBe(3);
    expect(metrics.by_lane.semantic.changed_winner_rate).toBe(0.5);
  });

  it("rejects evaluation records outside the fixed cohort or scopes", () => {
    const unknownEvent = {
      ...partialWindowFixture.ground_truth_events[0],
      source_id: "not-a-cohort-source",
    };
    expect(() =>
      calculateM4Metrics({
        ...partialWindowFixture,
        ground_truth_events: [unknownEvent],
      } as never),
    ).toThrow(/unknown source/);

    const badScope = {
      ...partialWindowFixture.run_ledger[0],
      expected_scope: [
        ...partialWindowFixture.run_ledger[0].expected_scope,
        "not-a-cohort-source",
      ],
    };
    expect(() =>
      calculateM4Metrics({
        ...partialWindowFixture,
        run_ledger: [badScope],
      } as never),
    ).toThrow(/unknown source/);
  });

  it("rejects forged rehashed records, malformed dates, and scalar fields", () => {
    const forgedSyntheticEvidence = rehashRecord({
      ...partialWindowFixture.ground_truth_events[0],
      canonical_evidence_ids: ["forged_canonical_id"],
    });
    expect(() =>
      calculateM4Metrics({
        ...partialWindowFixture,
        ground_truth_events: [forgedSyntheticEvidence],
      } as never),
    ).toThrow(/immutable shape\/hash validation/);

    const forgedCheckSource = rehashRecord({
      ...partialWindowFixture.checks[0],
      source_id: "not-a-cohort-source",
    });
    expect(() =>
      calculateM4Metrics({
        ...partialWindowFixture,
        checks: [forgedCheckSource],
      } as never),
    ).toThrow(/unknown source/);

    const negativeReview = rehashRecord({
      ...partialWindowFixture.ground_truth_events[0],
      review_minutes: -1,
    });
    expect(() =>
      calculateM4Metrics({
        ...partialWindowFixture,
        ground_truth_events: [negativeReview],
      } as never),
    ).toThrow(/immutable shape\/hash validation/);

    const unknownClassification = rehashRecord({
      ...partialWindowFixture.lane_detections[0],
      classification: "invented_classification",
    });
    expect(() =>
      calculateM4Metrics({
        ...partialWindowFixture,
        lane_detections: [unknownClassification],
      } as never),
    ).toThrow(/immutable shape\/hash validation/);

    const malformedScope = rehashRecord({
      ...partialWindowFixture.run_ledger[0],
      expected_scope: "not-an-array",
    });
    expect(() =>
      calculateM4Metrics({
        ...partialWindowFixture,
        run_ledger: [malformedScope],
      } as never),
    ).toThrow(/immutable shape\/hash validation/);

    const invalidOrdering = rehashRecord({
      ...partialWindowFixture.ground_truth_events[0],
      confirmed_at: "2026-07-31T23:00:00Z",
    });
    expect(() =>
      calculateM4Metrics({
        ...partialWindowFixture,
        ground_truth_events: [invalidOrdering],
      } as never),
    ).toThrow(/immutable shape\/hash validation/);
  });

  it("treats invalid or missing source coverage as insufficient data", () => {
    const invalidCoverage = {
      ...partialWindowFixture,
      window: {
        ...partialWindowFixture.window,
        source_coverage_days: {
          ...partialWindowFixture.window.source_coverage_days,
          [M4_COHORT_SOURCE_IDS[0]]: Number.NaN,
          [M4_COHORT_SOURCE_IDS[1]]: "30",
        },
      },
    };
    const invalidMetrics = calculateM4Metrics(invalidCoverage as never);
    expect(invalidMetrics.coverage.complete).toBe(false);
    expect(invalidMetrics.decision.status).toBe("insufficient_data");
    expect(invalidMetrics.coverage.missing_source_ids).toEqual(
      expect.arrayContaining([
        M4_COHORT_SOURCE_IDS[0],
        M4_COHORT_SOURCE_IDS[1],
      ]),
    );

    const missingCoverage = {
      ...partialWindowFixture,
      window: {
        ...partialWindowFixture.window,
        source_coverage_days: Object.fromEntries(
          M4_COHORT_SOURCE_IDS.slice(1).map((sourceId) => [sourceId, 30]),
        ),
      },
    };
    const missingMetrics = calculateM4Metrics(missingCoverage as never);
    expect(missingMetrics.decision.status).toBe("insufficient_data");
    expect(missingMetrics.coverage.missing_source_ids).toContain(
      M4_COHORT_SOURCE_IDS[0],
    );

    const unknownCoverageKey = {
      ...partialWindowFixture,
      window: {
        ...partialWindowFixture.window,
        source_coverage_days: {
          ...partialWindowFixture.window.source_coverage_days,
          unknown_source: 30,
        },
      },
    };
    expect(() => calculateM4Metrics(unknownCoverageKey as never)).toThrow(
      /unknown source key/,
    );
  });

  it("only applies a threshold after explicit full-window coverage", () => {
    const completeSynthetic = {
      ...partialWindowFixture,
      window: {
        ...partialWindowFixture.window,
        observed_window_days: 30,
        window_end: "2026-08-31T00:00:00Z",
        status: "complete" as const,
        source_coverage_days: Object.fromEntries(
          M4_COHORT_SOURCE_IDS.map((sourceId) => [sourceId, 30]),
        ),
        expected_run_counts: {
          semantic: 6,
          independent_sentinel: 1,
        },
      },
      checks: [
        syntheticCheck(M4_COHORT_SOURCE_IDS[0], 1, "unchanged", 6),
        syntheticCheck(M4_COHORT_SOURCE_IDS[0], 8, "unchanged", 6),
        syntheticCheck(M4_COHORT_SOURCE_IDS[0], 15, "unchanged", 6),
        syntheticCheck(M4_COHORT_SOURCE_IDS[0], 22, "unchanged", 6),
      ],
      run_ledger: [...partialWindowFixture.run_ledger],
    };
    const metrics = calculateM4Metrics(completeSynthetic);
    expect(metrics.coverage.complete).toBe(true);
    expect(metrics.coverage.incomplete_run_count).toBe(4);
    expect(metrics.coverage.run_reconciliation.semantic.delta).toBe(-1);
    expect(metrics.coverage.run_reconciliation.independent_sentinel.delta).toBe(
      -1,
    );
    expect(metrics.by_lane.semantic.absent_run_rate).toBe(2 / 6);
    expect(metrics.by_lane.independent_sentinel.absent_run_rate).toBe(1);
    expect(metrics.weekly_maintenance.complete_week_count).toBe(4);
    expect(metrics.weekly_maintenance.trailing_bucket_excluded).toBe(true);
    expect(metrics.decision.median_weekly_maintenance_hours).toBe(0.1);
    expect(metrics.decision.threshold_applied).toBe(true);
    expect(metrics.decision.status).toBe("amber");
    expect(metrics.decision.rationale.join(" ")).toMatch(/partial\/failed/);
    expect(metrics.decision.informational_rationale.join(" ")).toMatch(
      /partial\/failed/,
    );
    expect(metrics.decision.threshold_rationale.join(" ")).toMatch(
      /manual capture share/,
    );
    expect(metrics.decision.synthetic_only).toBe(true);
  });

  it("keeps incomplete run health informational when thresholds are otherwise green", () => {
    const checks = [1, 8, 15, 22].map((day) =>
      evaluateDirectCheck({
        check_id: `check_no_planned_method_${day}`,
        source_id: M4_COHORT_SOURCE_IDS[0],
        checked_at: `2026-08-${String(day).padStart(2, "0")}T00:00:00Z`,
        permission: {
          terms_review_status: "approved",
          technical_classification: "manual_only",
          observation: {
            observation_id: `obs_no_planned_method_${day}`,
            source_id: M4_COHORT_SOURCE_IDS[0],
            observed_at: `2026-08-${String(day).padStart(2, "0")}T00:00:00Z`,
            method: "manual_capture",
            scope: "per_source",
            result: "reachable",
            permission_asserted: true,
            representation_kind: "test_fixture",
          },
        },
        human_minutes: 1,
        synthetic: true,
      }),
    );
    const metrics = calculateM4Metrics({
      ...partialWindowFixture,
      window: {
        ...partialWindowFixture.window,
        observed_window_days: 30,
        window_end: "2026-08-31T00:00:00Z",
        status: "complete" as const,
        source_coverage_days: Object.fromEntries(
          M4_COHORT_SOURCE_IDS.map((sourceId) => [sourceId, 30]),
        ),
      },
      checks,
    });
    expect(metrics.coverage.incomplete_run_count).toBe(4);
    expect(metrics.by_lane.direct.manual_capture_share).toBeNull();
    expect(metrics.decision.status).toBe("green");
    expect(metrics.decision.rationale.join(" ")).toMatch(/remain recorded/);
  });

  it("rejects duplicate IDs instead of silently deduplicating", () => {
    const duplicate = {
      ...partialWindowFixture,
      ground_truth_events: [
        ...partialWindowFixture.ground_truth_events,
        partialWindowFixture.ground_truth_events[0],
      ],
    };
    expect(() => calculateM4Metrics(duplicate)).toThrow(
      /Duplicate evaluation ID/,
    );

    const crossKindDuplicate = {
      ...partialWindowFixture,
      lane_detections: [
        rehashRecord({
          ...partialWindowFixture.lane_detections[0],
          detection_id: partialWindowFixture.ground_truth_events[0].event_id,
        }),
      ],
    };
    expect(() => calculateM4Metrics(crossKindDuplicate as never)).toThrow(
      /Duplicate evaluation ID/,
    );
  });

  it("does not label an empty record set synthetic-only", () => {
    const empty = {
      ...partialWindowFixture,
      checks: [],
      ground_truth_events: [],
      lane_detections: [],
      run_ledger: [],
      window: {
        ...partialWindowFixture.window,
        observed_window_days: 30,
        window_end: "2026-08-31T00:00:00Z",
        status: "complete" as const,
        source_coverage_days: Object.fromEntries(
          M4_COHORT_SOURCE_IDS.map((sourceId) => [sourceId, 30]),
        ),
      },
    };
    const metrics = calculateM4Metrics(empty);
    expect(metrics.decision.status).toBe("insufficient_data");
    expect(metrics.decision.synthetic_only).toBe(false);
  });
});
