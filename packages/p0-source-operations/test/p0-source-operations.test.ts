import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  admitP0SourceRolePlan,
  evaluateP0Readiness,
  hashP0SourceRolePlan,
  P0_EXPECTED_PLAN_SHA256,
  P0_SOURCE_READINESS_VERSION,
  type P0RoleOperationalState,
  type P0SourceRolePlan,
} from "../src/index.js";

const artifactPath = resolve(
  process.cwd(),
  "../../registry/planning/p0-source-role-plan.v0.1.json",
);

function rawPlan(): Record<string, unknown> {
  return JSON.parse(readFileSync(artifactPath, "utf8")) as Record<
    string,
    unknown
  >;
}

function admitted(): P0SourceRolePlan {
  const result = admitP0SourceRolePlan(rawPlan());
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.plan;
}

function readiness(
  plan: P0SourceRolePlan,
  roles: readonly P0RoleOperationalState[],
): Record<string, unknown> {
  return {
    version: P0_SOURCE_READINESS_VERSION,
    plan_sha256: hashP0SourceRolePlan(plan),
    roles,
  };
}

function readyState(
  familyId: string,
  sourceRoleId: string,
  evidence_status: P0RoleOperationalState["evidence_status"] = "canonical_current",
): P0RoleOperationalState {
  return {
    family_id: familyId,
    source_role_id: sourceRoleId,
    producer_status: "authorized",
    permission_status: "approved_manual",
    technical_status:
      evidence_status === "conservative_exclusion"
        ? "unavailable"
        : "manual_capture",
    liveness_status: "healthy",
    evidence_status,
    impact_status: "mapped",
    experimental_eligible: false,
  };
}

describe("P0 source-role plan", () => {
  it("admits the exact 44-family, 19-stream, 301-role artifact", () => {
    const result = admitP0SourceRolePlan(rawPlan());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.family_count).toBe(44);
    expect(result.stream_count).toBe(19);
    expect(result.required_role_count).toBe(301);
    expect(result.plan_sha256).toBe(P0_EXPECTED_PLAN_SHA256);
    expect(Object.isFrozen(result.plan)).toBe(true);
  });

  it("normalizes semantic ordering to the same admitted snapshot", () => {
    const reordered = rawPlan();
    const families = reordered.families as Array<Record<string, unknown>>;
    reordered.families = families
      .map((family) => ({
        ...family,
        required_source_roles: [
          ...(family.required_source_roles as string[]),
        ].reverse(),
      }))
      .reverse();
    const result = admitP0SourceRolePlan(reordered);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.plan_sha256).toBe(P0_EXPECTED_PLAN_SHA256);
  });

  it("rejects missing, duplicate, extra, and SKU-substituted planning content", () => {
    const missing = rawPlan();
    (missing.families as unknown[]).pop();
    expect(admitP0SourceRolePlan(missing).ok).toBe(false);

    const duplicate = rawPlan();
    const first = (duplicate.families as Array<Record<string, unknown>>)[0];
    if (!first) throw new Error("fixture missing family");
    (first.required_source_roles as string[]).push(
      (first.required_source_roles as string[])[0] ?? "card_catalog",
    );
    expect(admitP0SourceRolePlan(duplicate).ok).toBe(false);

    const extra = rawPlan();
    extra.representative_official_urls = ["https://planning.invalid/"];
    expect(admitP0SourceRolePlan(extra).ok).toBe(false);

    const sku = rawPlan();
    const skuFamily = (sku.families as Array<Record<string, unknown>>).find(
      (family) => family.family_id === "card.rakuten",
    );
    if (!skuFamily) throw new Error("fixture missing Rakuten family");
    skuFamily.family_id = "card.rakuten.premium";
    expect(admitP0SourceRolePlan(sku).ok).toBe(false);
  });

  it("rejects Proxy, getter, hidden, symbol, and sparse inputs before admission", () => {
    expect(admitP0SourceRolePlan(new Proxy(rawPlan(), {})).ok).toBe(false);
    let getterCalls = 0;
    const getter = rawPlan();
    Object.defineProperty(getter, "families", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return [];
      },
    });
    expect(admitP0SourceRolePlan(getter).ok).toBe(false);
    expect(getterCalls).toBe(0);
    const hidden = rawPlan();
    Object.defineProperty(hidden, "hidden", { value: true });
    expect(admitP0SourceRolePlan(hidden).ok).toBe(false);
    const symbol = rawPlan();
    Object.defineProperty(symbol, Symbol("secret"), { value: true });
    expect(admitP0SourceRolePlan(symbol).ok).toBe(false);
    const sparse = rawPlan();
    const sparseFamilies = sparse.families as unknown[];
    delete sparseFamilies[2];
    expect(admitP0SourceRolePlan(sparse).ok).toBe(false);
  });
});

describe("P0 role readiness", () => {
  it("does not turn a planning-covered family into support", () => {
    const plan = admitted();
    const report = evaluateP0Readiness(plan, readiness(plan, []));
    const rakuten = report.families.find(
      (family) => family.family_id === "card.rakuten",
    );
    expect(rakuten?.baseline_planning_status).toBe("covered");
    expect(rakuten?.ready).toBe(false);
    expect(report.ready_family_count).toBe(0);
    expect(report.ready_role_count).toBe(0);
  });

  it("keeps lead-only experimental eligibility separate from readiness", () => {
    const plan = admitted();
    const state: P0RoleOperationalState = {
      ...readyState("merchant.7eleven", "accepted_payment_methods"),
      producer_status: "local_unverified",
      permission_status: "not_reviewed",
      technical_status: "unknown",
      liveness_status: "never_seen",
      evidence_status: "lead_only",
      impact_status: "unmapped",
      experimental_eligible: true,
    };
    const report = evaluateP0Readiness(plan, readiness(plan, [state]));
    const role = report.roles.find(
      (item) =>
        item.family_id === "merchant.7eleven" &&
        item.source_role_id === "accepted_payment_methods",
    );
    expect(role?.experimental_eligible).toBe(true);
    expect(role?.ready).toBe(false);
    expect(role?.blockers).toContain("canonical_evidence_missing");
    expect(report.experimental_role_count).toBe(1);
  });

  it("allows an explicit conservative exclusion but requires every family role", () => {
    const plan = admitted();
    const seven = plan.families.find(
      (family) => family.family_id === "merchant.7eleven",
    );
    if (!seven) throw new Error("fixture missing Seven-Eleven family");
    const one = evaluateP0Readiness(
      plan,
      readiness(plan, [
        readyState(
          "merchant.7eleven",
          "accepted_payment_methods",
          "conservative_exclusion",
        ),
      ]),
    );
    expect(
      one.families.find((family) => family.family_id === "merchant.7eleven")
        ?.ready,
    ).toBe(false);

    const all = evaluateP0Readiness(
      plan,
      readiness(
        plan,
        seven.required_source_roles.map((role) =>
          readyState("merchant.7eleven", role, "conservative_exclusion"),
        ),
      ),
    );
    const family = all.families.find(
      (item) => item.family_id === "merchant.7eleven",
    );
    expect(family?.ready).toBe(true);
    expect(family?.ready_role_count).toBe(seven.required_source_roles.length);
  });

  it("rejects unknown and duplicate family-role states", () => {
    const plan = admitted();
    const known = readyState("merchant.7eleven", "accepted_payment_methods");
    expect(() =>
      evaluateP0Readiness(plan, readiness(plan, [known, known])),
    ).toThrow("p0_readiness_invalid");
    expect(() =>
      evaluateP0Readiness(
        plan,
        readiness(plan, [readyState("card.rakuten.premium", "card_catalog")]),
      ),
    ).toThrow("p0_readiness_invalid");
  });
});
