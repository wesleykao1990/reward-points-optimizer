import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  adaptResearchArtifact,
  compileP0ResearchImplementation,
  RESEARCH_FACT_REASONS,
} from "../src/index.js";

type JsonRecord = Record<string, unknown>;

function researchArtifact(): JsonRecord {
  return JSON.parse(
    readFileSync(
      new URL(
        "../../../fixtures/m3/agent-feed/p0-point-rules-a.research.v0.1.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as JsonRecord;
}

function cloneArtifact(): JsonRecord {
  return structuredClone(researchArtifact()) as JsonRecord;
}

function implementationSnapshot(): JsonRecord {
  return JSON.parse(
    readFileSync(
      new URL(
        "../../../fixtures/m3/provisional/p0-point-rules-a.implementation.v0.1.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as JsonRecord;
}

function coverageSnapshot(): JsonRecord {
  return JSON.parse(
    readFileSync(
      new URL(
        "../../../fixtures/m3/provisional/p0-coverage-index.v0.3.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as JsonRecord;
}

function implementationSnapshotNamed(name: string): JsonRecord {
  return JSON.parse(
    readFileSync(
      new URL(
        `../../../fixtures/m3/provisional/${name}.implementation.v0.7.json`,
        import.meta.url,
      ),
      "utf8",
    ),
  ) as JsonRecord;
}

function coverageSnapshotNamed(version: string): JsonRecord {
  return JSON.parse(
    readFileSync(
      new URL(
        `../../../fixtures/m3/provisional/${version}.json`,
        import.meta.url,
      ),
      "utf8",
    ),
  ) as JsonRecord;
}

function artifact(name: string): JsonRecord {
  return JSON.parse(
    readFileSync(
      new URL(
        `../../../fixtures/m3/agent-feed/${name}.research.v0.1.json`,
        import.meta.url,
      ),
      "utf8",
    ),
  ) as JsonRecord;
}

describe("Research-A implementation ledger", () => {
  it("retains all 87 claims exactly once with resolved source-role identity", () => {
    const input = researchArtifact();
    const result = adaptResearchArtifact(input);

    expect(result.ok).toBe(true);
    expect(result.entries).toHaveLength(87);
    expect(result.artifact?.parent_claim_count).toBe(87);
    expect(
      new Set(result.entries.map((entry) => entry.parent_claim_id)).size,
    ).toBe(87);
    expect(result.coverage?.entries).toHaveLength(32);
    expect(
      result.entries.filter((entry) => entry.disposition === "engine_rule"),
    ).toHaveLength(result.artifact?.derived_rule_count);
    expect(
      result.derived_rules.every(
        (derivedRule) => derivedRule.status === "active_experimental",
      ),
    ).toBe(true);
    expect(
      result.entries.every((entry) =>
        ["engine_rule", "catalogue_fact"].includes(entry.disposition),
      ),
    ).toBe(true);
    expect(
      result.entries.every(
        (entry) =>
          entry.reason === undefined ||
          RESEARCH_FACT_REASONS.includes(entry.reason),
      ),
    ).toBe(true);
    expect(
      result.entries.every(
        (entry) =>
          entry.source_ids.length > 0 &&
          entry.source_identity.length === entry.source_ids.length,
      ),
    ).toBe(true);

    const sources = new Map(
      (input.sources as JsonRecord[]).map((source) => [
        source.source_id,
        source,
      ]),
    );
    for (const roleResult of input.role_results as JsonRecord[]) {
      for (const sourceId of roleResult.source_ids as string[]) {
        const source = sources.get(sourceId);
        expect(source?.family_id).toBe(roleResult.family_id);
        expect(source?.roles).toContain(roleResult.source_role_id);
      }
    }

    const claims = new Map(
      (input.claims as JsonRecord[]).map((claim) => [claim.claim_id, claim]),
    );
    for (const entry of result.entries) {
      const claim = claims.get(entry.parent_claim_id);
      expect(claim).toBeDefined();
      expect(entry.family_id).toBe(claim.family_id);
      expect(entry.source_role_id).toBe(claim.source_role_id);
      expect(entry.source_ids).toEqual([...claim.source_ids].sort());
      expect(entry.subject).toBe(claim.subject);
      expect(entry.value).toEqual(claim.value);
      expect(entry.applicability).toEqual(claim.applicability);
      expect(entry.exclusions).toEqual([...claim.exclusions].sort());
      expect(entry.evidence_locator).toBe(claim.evidence_locator);
      expect(entry.short_paraphrase).toBe(claim.short_paraphrase);
      expect(
        entry.source_identity.every((source) =>
          source.roles.includes(entry.source_role_id),
        ),
      ).toBe(true);
    }
  });

  it("is permutation-stable and produces a deterministic hash", () => {
    const first = adaptResearchArtifact(researchArtifact());
    const reordered = cloneArtifact();
    reordered.sources.reverse();
    reordered.role_results.reverse();
    reordered.claims.reverse();
    const second = adaptResearchArtifact(reordered);

    expect(second.ok).toBe(true);
    expect(second.artifact?.research_artifact_hash).toBe(
      first.artifact?.research_artifact_hash,
    );
    expect(second.artifact?.implementation_hash).toBe(
      first.artifact?.implementation_hash,
    );
    expect(second.entries.map((entry) => entry.parent_claim_id)).toEqual(
      first.entries.map((entry) => entry.parent_claim_id),
    );
  });

  it("keeps facts active for search without approval/publication labels", () => {
    const result = adaptResearchArtifact(researchArtifact());
    const serialized = JSON.stringify(result.artifact);

    expect(result.derived_rules).toHaveLength(0);
    expect(
      result.entries.every((entry) => entry.disposition === "catalogue_fact"),
    ).toBe(true);
    expect(result.issues).toHaveLength(87);
    expect(serialized).not.toMatch(
      /pending_approval|manual_review|human_verified|approval_required/iu,
    );
    expect(serialized).not.toMatch(
      /"(?:secret_token|api_key|password|pan|cvv)"|-----BEGIN|Bearer /iu,
    );
    expect(serialized).toContain("two-factor-authentication phone number");
  });

  it("matches the checked-in deterministic implementation and coverage snapshots", () => {
    const result = adaptResearchArtifact(researchArtifact());
    expect(result.artifact).toEqual(implementationSnapshot());
    expect(result.coverage).toEqual(coverageSnapshot());
  });

  it("rejects hostile representations, extra keys, and duplicate parent IDs", () => {
    const missingValue = cloneArtifact();
    delete (missingValue.claims as JsonRecord[])[0].value;
    const missingValueResult = adaptResearchArtifact(missingValue);
    expect(missingValueResult.ok).toBe(false);
    expect(missingValueResult.issues).toContainEqual(
      expect.objectContaining({
        code: "research_shape_invalid",
        path: "/claims/0/value",
      }),
    );

    const nullValue = cloneArtifact();
    (nullValue.claims as JsonRecord[])[0].value = null;
    const nullValueResult = adaptResearchArtifact(nullValue);
    expect(nullValueResult.ok).toBe(false);
    expect(nullValueResult.issues).toContainEqual(
      expect.objectContaining({
        code: "research_shape_invalid",
        path: "/claims/0/value",
      }),
    );

    const wrongValue = cloneArtifact();
    (wrongValue.claims as JsonRecord[])[0].value = new Date("2026-01-01");
    const wrongValueResult = adaptResearchArtifact(wrongValue);
    expect(wrongValueResult.ok).toBe(false);
    expect(wrongValueResult.issues).toContainEqual(
      expect.objectContaining({ code: "input_invalid" }),
    );

    const proxyResult = adaptResearchArtifact(
      new Proxy(researchArtifact(), {}),
    );
    expect(proxyResult.ok).toBe(false);
    expect(proxyResult.entries).toHaveLength(0);
    expect(
      proxyResult.issues.some((item) => item.code === "input_invalid"),
    ).toBe(true);

    const accessor = cloneArtifact();
    Object.defineProperty(accessor.claims[0], "accessor_value", {
      enumerable: true,
      get: () => "must not be read",
    });
    const accessorResult = adaptResearchArtifact(accessor);
    expect(accessorResult.ok).toBe(false);
    expect(
      accessorResult.issues.some((item) => item.code === "input_invalid"),
    ).toBe(true);

    const safeAccessor = cloneArtifact();
    const safeClaim = (safeAccessor.claims as JsonRecord[]).find(
      (claim) => claim.claim_id === "claim.point.nanaco.transfer.auth.003",
    );
    Object.defineProperty(safeClaim?.value as JsonRecord, "credential", {
      enumerable: true,
      get: () => {
        throw new Error("must not be read");
      },
    });
    const safeAccessorResult = adaptResearchArtifact(safeAccessor);
    expect(safeAccessorResult.ok).toBe(false);
    expect(
      safeAccessorResult.issues.some((item) => item.code === "input_invalid"),
    ).toBe(true);

    const roleMismatch = cloneArtifact();
    const roleMismatchSource = (roleMismatch.sources as JsonRecord[]).find(
      (source) => source.source_id === "jp.jrepoint.suica-info",
    );
    expect(roleMismatchSource).toBeDefined();
    roleMismatchSource.roles = ["unrelated_role"];
    const roleMismatchResult = adaptResearchArtifact(roleMismatch);
    expect(roleMismatchResult.ok).toBe(false);
    expect(
      roleMismatchResult.issues.some((item) =>
        item.message.includes("does not advertise"),
      ),
    ).toBe(true);

    const nonEnumerable = cloneArtifact();
    Object.defineProperty(nonEnumerable, "hidden", {
      enumerable: false,
      value: true,
    });
    const nonEnumerableResult = adaptResearchArtifact(nonEnumerable);
    expect(nonEnumerableResult.ok).toBe(false);
    expect(
      nonEnumerableResult.issues.some((item) => item.code === "input_invalid"),
    ).toBe(true);

    const extra = cloneArtifact();
    extra.claims[0].unknown_field = true;
    const extraResult = adaptResearchArtifact(extra);
    expect(extraResult.ok).toBe(false);
    expect(
      extraResult.issues.some((item) => item.code === "research_shape_invalid"),
    ).toBe(true);

    const duplicate = cloneArtifact();
    duplicate.claims[1].claim_id = duplicate.claims[0].claim_id;
    const duplicateResult = adaptResearchArtifact(duplicate);
    expect(duplicateResult.ok).toBe(false);
    expect(
      duplicateResult.issues.some((item) =>
        item.message.includes("claim_id must be unique"),
      ),
    ).toBe(true);
  });
});

describe("generic P0 research implementation ledger", () => {
  it("conserves every accepted claim from B, wallet/card, and Wave-D", () => {
    const cases = [
      ["p0-point-rules-b", 111, "p0-point-rules-b.implementation.v0.4"],
      ["p0-wallet-card-rules", 103, "p0-wallet-card-rules.implementation.v0.5"],
      [
        "p0-merchant-transit-regulatory-rules",
        63,
        "p0-merchant-transit-regulatory-rules.implementation.v0.6",
      ],
    ] as const;
    for (const [name, count, version] of cases) {
      const input = artifact(name);
      const result = compileP0ResearchImplementation(input);
      expect(result.ok).toBe(true);
      expect(result.entries).toHaveLength(count);
      expect(result.artifact?.version).toBe(version);
      expect(result.artifact?.parent_claim_count).toBe(count);
      expect(result.artifact?.derived_rule_count).toBe(0);
      expect(result.derived_rules).toHaveLength(0);
      expect(result.issues).toHaveLength(count);
      expect(
        new Set(result.entries.map((entry) => entry.parent_claim_id)).size,
      ).toBe(count);
      expect(
        result.entries.every((entry) => entry.disposition === "catalogue_fact"),
      ).toBe(true);
      expect(
        result.entries.every((entry) => entry.derived_rule_ids.length === 0),
      ).toBe(true);
    }
  });

  it("normalizes metadata role variants and remains permutation-stable", () => {
    for (const name of [
      "p0-point-rules-b",
      "p0-wallet-card-rules",
      "p0-merchant-transit-regulatory-rules",
      "p0-complex-route-benchmark",
    ]) {
      const input = artifact(name);
      const first = compileP0ResearchImplementation(input);
      const reordered = structuredClone(input) as JsonRecord;
      (reordered.sources as JsonRecord[]).reverse();
      (reordered.role_results as JsonRecord[]).reverse();
      (reordered.claims as JsonRecord[]).reverse();
      const second = compileP0ResearchImplementation(reordered);
      expect(second.ok).toBe(true);
      expect(second.artifact?.research_artifact_hash).toBe(
        first.artifact?.research_artifact_hash,
      );
      expect(second.artifact?.implementation_hash).toBe(
        first.artifact?.implementation_hash,
      );
      expect(second.entries.map((entry) => entry.parent_claim_id)).toEqual(
        first.entries.map((entry) => entry.parent_claim_id),
      );
    }
  });

  it("uses claim-level validity and lifecycle status without retiring nested sub-periods", () => {
    const pointRules = artifact("p0-point-rules-b");
    const pointResult = compileP0ResearchImplementation(pointRules);
    const pointEntry = (claimId: string) =>
      pointResult.entries.find((entry) => entry.parent_claim_id === claimId);

    expect(
      pointEntry("claim.point.waon.campaign.charge-period.001")?.reason,
    ).toBe("non_calculable_fact");
    expect(pointEntry("claim.point.v.campaign.app-entry.001")?.reason).toBe(
      "ended_or_future_inactive",
    );
    expect(pointEntry("claim.point.v.campaign.app-expiry.001")?.reason).toBe(
      "ended_or_future_inactive",
    );
    expect(pointEntry("claim.point.v.campaign.app-prizes.001")?.reason).toBe(
      "ended_or_future_inactive",
    );

    const walletRules = artifact("p0-wallet-card-rules");
    const walletResult = compileP0ResearchImplementation(walletRules);
    expect(
      walletResult.entries.find(
        (entry) =>
          entry.parent_claim_id ===
          "claim.wallet.rakutenpay.campaign.scratch.001",
      )?.reason,
    ).toBe("ended_or_future_inactive");
    expect(
      walletResult.entries.find(
        (entry) =>
          entry.parent_claim_id ===
          "claim.wallet.rakutenpay.campaign.scratch-expiry.002",
      )?.reason,
    ).toBe("ended_or_future_inactive");

    const regulatoryRules = artifact("p0-merchant-transit-regulatory-rules");
    const regulatoryResult = compileP0ResearchImplementation(regulatoryRules);
    expect(
      regulatoryResult.entries.find(
        (entry) =>
          entry.parent_claim_id ===
          "claim.merchant.yahoo-shopping.campaign.001",
      )?.reason,
    ).toBe("ended_or_future_inactive");
  });

  it("fails closed for malformed or reversed claim-level windows", () => {
    const malformed = artifact("p0-point-rules-b");
    const malformedClaim = (malformed.claims as JsonRecord[]).find(
      (claim) =>
        claim.claim_id === "claim.point.waon.campaign.charge-period.001",
    );
    malformedClaim.applicability.effective_to = "not-a-date";
    const malformedResult = compileP0ResearchImplementation(malformed);
    expect(
      malformedResult.entries.find(
        (entry) =>
          entry.parent_claim_id ===
          "claim.point.waon.campaign.charge-period.001",
      )?.reason,
    ).toBe("invalid_applicability_window");

    const reversed = artifact("p0-point-rules-b");
    const reversedClaim = (reversed.claims as JsonRecord[]).find(
      (claim) =>
        claim.claim_id === "claim.point.ponta.campaign.summer-period.001",
    );
    reversedClaim.applicability.effective_from = "2026-08-31";
    reversedClaim.applicability.effective_to = "2026-07-01";
    const reversedResult = compileP0ResearchImplementation(reversed);
    expect(
      reversedResult.entries.find(
        (entry) =>
          entry.parent_claim_id ===
          "claim.point.ponta.campaign.summer-period.001",
      )?.reason,
    ).toBe("invalid_applicability_window");

    const dateOnly = artifact("p0-point-rules-b");
    const dateOnlyClaim = (dateOnly.claims as JsonRecord[]).find(
      (claim) =>
        claim.claim_id === "claim.point.ponta.campaign.summer-period.001",
    );
    dateOnlyClaim.applicability.effective_to = "2026-08-21";
    const dateOnlyResult = compileP0ResearchImplementation(dateOnly);
    expect(
      dateOnlyResult.entries.find(
        (entry) =>
          entry.parent_claim_id ===
          "claim.point.ponta.campaign.summer-period.001",
      )?.reason,
    ).toBe("ended_or_future_inactive");
  });

  it("honors an explicit direct status without treating nested status-like data as lifecycle", () => {
    const ended = artifact("p0-point-rules-b");
    const endedClaim = (ended.claims as JsonRecord[]).find(
      (claim) =>
        claim.claim_id === "claim.point.waon.campaign.charge-period.001",
    );
    endedClaim.value = { ...(endedClaim.value as JsonRecord), status: "ended" };
    endedClaim.applicability.effective_to = null;
    const endedResult = compileP0ResearchImplementation(ended);
    expect(
      endedResult.entries.find(
        (entry) =>
          entry.parent_claim_id ===
          "claim.point.waon.campaign.charge-period.001",
      )?.reason,
    ).toBe("ended_or_future_inactive");

    const current = artifact("p0-point-rules-b");
    const currentClaim = (current.claims as JsonRecord[]).find(
      (claim) =>
        claim.claim_id === "claim.point.waon.campaign.charge-period.001",
    );
    currentClaim.applicability.status = "partly_ended_and_current";
    const currentResult = compileP0ResearchImplementation(current);
    expect(
      currentResult.entries.find(
        (entry) =>
          entry.parent_claim_id ===
          "claim.point.waon.campaign.charge-period.001",
      )?.reason,
    ).toBe("non_calculable_fact");
  });

  it("compiles the complex benchmark descriptor without dropping optional envelope fields", () => {
    const input = artifact("p0-complex-route-benchmark");
    const result = compileP0ResearchImplementation(input);

    expect(result.ok).toBe(true);
    expect(result.entries).toHaveLength(18);
    expect(result.artifact?.version).toBe(
      "p0-complex-route-benchmark.implementation.v0.7",
    );
    expect(result.artifact?.parent_claim_count).toBe(18);
    expect(result.artifact?.derived_rule_count).toBe(0);
    expect(result.derived_rules).toHaveLength(0);
    expect(result.issues).toHaveLength(18);
    expect(result.coverage?.version).toBe("p0-coverage-index.v0.7");
    expect(result.coverage?.entries).toHaveLength(13);
    expect(result.artifact?.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          parent_claim_id: "claim.route.revolut.ana-pay.001",
          value: expect.objectContaining({ transfer: expect.any(Object) }),
          disposition: "catalogue_fact",
        }),
        expect.objectContaining({
          parent_claim_id: "claim.campaign.moppy-jal.principal.001",
          value: expect.objectContaining({ campaign: expect.any(Object) }),
          disposition: "catalogue_fact",
        }),
      ]),
    );
    expect(result.artifact).toEqual(
      implementationSnapshotNamed("p0-complex-route-benchmark"),
    );
    expect(result.coverage).toEqual(
      coverageSnapshotNamed("p0-coverage-index.v0.7"),
    );
  });

  it("validates complex optional fields only for their descriptor", () => {
    const invalidDate = artifact("p0-complex-route-benchmark");
    (
      (invalidDate.metadata as JsonRecord).bounded_run as JsonRecord
    ).retrieval_cutoff = "2026-02-30";
    const invalidDateResult = compileP0ResearchImplementation(invalidDate);
    expect(invalidDateResult.ok).toBe(false);
    expect(invalidDateResult.issues).toContainEqual(
      expect.objectContaining({
        code: "research_shape_invalid",
        path: "/metadata/bounded_run/retrieval_cutoff",
      }),
    );

    const duplicateFields = artifact("p0-complex-route-benchmark");
    (duplicateFields.schema as JsonRecord).structured_transfer_required_fields =
      ["route_id", "route_id"];
    const duplicateFieldsResult =
      compileP0ResearchImplementation(duplicateFields);
    expect(duplicateFieldsResult.ok).toBe(false);
    expect(duplicateFieldsResult.issues).toContainEqual(
      expect.objectContaining({
        code: "research_shape_invalid",
        path: "/schema/structured_transfer_required_fields",
      }),
    );

    const legacy = cloneArtifact();
    (legacy.schema as JsonRecord).structured_transfer_required_fields = [
      "route_id",
    ];
    (
      (legacy.metadata as JsonRecord).bounded_run as JsonRecord
    ).retrieval_cutoff = "2026-08-24";
    const legacyResult = compileP0ResearchImplementation(legacy);
    expect(legacyResult.ok).toBe(false);
    expect(legacyResult.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "/schema/structured_transfer_required_fields",
        }),
        expect.objectContaining({
          path: "/metadata/bounded_run/retrieval_cutoff",
        }),
      ]),
    );
  });

  it("rejects a source-role mismatch after normalization", () => {
    const input = structuredClone(artifact("p0-point-rules-b")) as JsonRecord;
    const source = (input.sources as JsonRecord[]).find(
      (item) => item.source_id === "src.point.v.use-rules",
    );
    expect(source).toBeDefined();
    source.roles = ["use_redemption_rules"];
    const result = compileP0ResearchImplementation(input);
    expect(result.ok).toBe(false);
    expect(
      result.issues.some((item) => item.code === "source_unresolved"),
    ).toBe(true);
  });

  it("requires bidirectional, unique claim membership in role results", () => {
    const omitted = structuredClone(artifact("p0-point-rules-b")) as JsonRecord;
    const omittedClaimId = "claim.point.waon.campaign.charge-expiry.001";
    const omittedRole = (omitted.role_results as JsonRecord[]).find(
      (role) =>
        role.family_id === "point.waon" &&
        role.source_role_id === "campaign_directory",
    );
    expect(omittedRole).toBeDefined();
    omittedRole.claim_ids = (omittedRole.claim_ids as string[]).filter(
      (claimId) => claimId !== omittedClaimId,
    );
    const omittedResult = compileP0ResearchImplementation(omitted);
    expect(omittedResult.ok).toBe(false);
    expect(omittedResult.issues).toContainEqual(
      expect.objectContaining({
        code: "claim_unresolved",
        claim_id: omittedClaimId,
      }),
    );

    const misindexed = structuredClone(
      artifact("p0-point-rules-b"),
    ) as JsonRecord;
    const misindexedClaimId = "claim.point.ponta.terms.accrual-use-balance.001";
    const correctRole = (misindexed.role_results as JsonRecord[]).find(
      (role) =>
        role.family_id === "point.ponta" &&
        role.source_role_id === "program_terms",
    );
    const wrongRole = (misindexed.role_results as JsonRecord[]).find(
      (role) =>
        role.family_id === "point.ponta" &&
        role.source_role_id === "use_redemption_rules",
    );
    expect(correctRole).toBeDefined();
    expect(wrongRole).toBeDefined();
    correctRole.claim_ids = (correctRole.claim_ids as string[]).filter(
      (claimId) => claimId !== misindexedClaimId,
    );
    wrongRole.claim_ids = [
      ...(wrongRole.claim_ids as string[]),
      misindexedClaimId,
    ];
    const misindexedResult = compileP0ResearchImplementation(misindexed);
    expect(misindexedResult.ok).toBe(false);
    expect(misindexedResult.issues).toContainEqual(
      expect.objectContaining({
        code: "claim_unresolved",
        claim_id: misindexedClaimId,
        message: expect.stringContaining("wrong family/source-role tuple"),
      }),
    );

    const duplicate = structuredClone(
      artifact("p0-point-rules-b"),
    ) as JsonRecord;
    const duplicateClaimId = "claim.point.ponta.terms.accrual-use-balance.001";
    const duplicateRole = (duplicate.role_results as JsonRecord[]).find(
      (role) =>
        role.family_id === "point.ponta" &&
        role.source_role_id === "use_redemption_rules",
    );
    expect(duplicateRole).toBeDefined();
    duplicateRole.claim_ids = [
      ...(duplicateRole.claim_ids as string[]),
      duplicateClaimId,
    ];
    const duplicateResult = compileP0ResearchImplementation(duplicate);
    expect(duplicateResult.ok).toBe(false);
    expect(duplicateResult.issues).toContainEqual(
      expect.objectContaining({
        code: "claim_unresolved",
        claim_id: duplicateClaimId,
        message: expect.stringContaining("listed more than once"),
      }),
    );
  });
});
