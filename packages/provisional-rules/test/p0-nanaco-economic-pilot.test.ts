import { readFile } from "node:fs/promises";
import type { SourceObservation } from "@jro/agent-feed-consumer";
import { canonicalize, tryValidateDocument } from "@jro/contracts";
import { describe, expect, it } from "vitest";
import {
  activateNanacoEconomicPilot,
  createNanacoEconomicPilot,
  createProvisionalRuleStore,
  freezeP0CoverageIndex,
  hashDefinition,
  type P0CoverageIndex,
  type ProvisionalRuleCandidate,
} from "../src/index.js";

type JsonRecord = Record<string, unknown>;

const SOURCE_ID = "jp.nanaco.shopping-earning";
const FAMILY_ID = "point.nanaco";
const SOURCE_ROLE_ID = "earn_rules";
const EVIDENCE_ID = "ev_m3_nanaco_shopping_earning_20260820";
const DEFINITION_HASH =
  "sha256:9f8cb5de0af689ee8ca751a3ae6a34c2d974eb1c79c29c60bd555da4db116746";
const CHECKED_AT = "2026-08-21T00:05:00Z";

async function fixture<T>(relativePath: string): Promise<T> {
  return JSON.parse(
    await readFile(
      new URL(`../../../fixtures/m3/${relativePath}`, import.meta.url),
      "utf8",
    ),
  ) as T;
}

async function inputs(): Promise<{
  candidate: ProvisionalRuleCandidate;
  coverage: P0CoverageIndex;
}> {
  const [candidate, coverageValue] = await Promise.all([
    fixture<ProvisionalRuleCandidate>(
      "provisional/p0-nanaco-economic-candidate.v0.1.json",
    ),
    fixture<JsonRecord>("provisional/p0-coverage-index.v0.2.json"),
  ]);
  return {
    candidate,
    coverage: freezeP0CoverageIndex(coverageValue),
  };
}

function economicProjection(rule: JsonRecord): JsonRecord {
  const projection = structuredClone(rule);
  for (const key of ["version", "status", "validity", "provenance", "audit"])
    delete projection[key];
  return projection;
}

function observation(
  candidate: ProvisionalRuleCandidate,
  options: {
    status?: SourceObservation["status"];
    evidence_completeness?: "complete" | "partial" | "lead_only";
    submitted_evidence_refs?: string[];
    canonical_evidence_ids?: string[];
    security_flags?: string[];
    raw_attributes?: Record<string, unknown>;
  } = {},
): SourceObservation {
  const timestamp = "2026-08-21T00:03:00Z";
  return {
    observation_id: candidate.observation_id,
    agent_feed: {
      protocol_version: "0.1",
      event_id: "event_p0_nanaco_earn_rules",
      stream_id: "economy.seven-nanaco",
      run_id: "run_p0_nanaco_earn_rules",
      finding_id: "nanaco-economic-ui-canary-20260821-v1",
    },
    source_ids: [SOURCE_ID],
    subjects: [
      {
        type: "loyalty_program",
        id: "program.jp.nanaco",
        name: "nanaco",
      },
      {
        type: "merchant",
        id: "merchant.seveneleven",
        name: "Seven-Eleven",
      },
    ],
    change_type: "reward_rate",
    summary: "Primary-source observation binding with no economic values.",
    effective_time: {
      occurred_at: timestamp,
      effective_from: null,
      effective_to: null,
    },
    discovery_assessment: {
      source_authority_claim: "primary",
      evidence_completeness: options.evidence_completeness ?? "complete",
      agent_confidence: 0.9,
    },
    submitted_evidence_refs: options.submitted_evidence_refs ?? [
      "lead_p0_nanaco_earn_rules",
    ],
    canonical_evidence_ids: options.canonical_evidence_ids ?? [],
    semantic_fingerprint_version: 1,
    semantic_fingerprint: candidate.observation_fingerprint,
    status: options.status ?? "needs_review",
    security_flags: options.security_flags ?? [],
    raw_attributes: options.raw_attributes ?? {
      change_type: "reward_rate",
      program_id: "program.jp.nanaco",
      merchant_id: "merchant.seveneleven",
      reward_rate: {
        reward_units: "1",
        spend_jpy: 200,
        spend_basis: "tax_exclusive",
      },
      eligible_product_class: "ordinary",
      posting_timing: "immediate_for_listed_merchant",
      product_exclusions_apply: true,
      canonical_publication: false,
      human_verified: false,
    },
    created_at: timestamp,
    updated_at: timestamp,
  };
}

function evidenceVerifier(candidate: ProvisionalRuleCandidate) {
  return ({
    observation_id,
    evidence_id,
    source_id,
  }: {
    observation_id: string;
    evidence_id: string;
    source_id: string;
  }) =>
    observation_id === candidate.observation_id &&
    evidence_id === EVIDENCE_ID &&
    source_id === SOURCE_ID;
}

describe("P0 nanaco economic provisional candidate", () => {
  it("copies the exact reviewed economic definition and adds only v0.2 coverage", async () => {
    const { candidate, coverage } = await inputs();
    const manifest = await fixture<JsonRecord>(
      "real-data/jp-cvs-006/golden-scenario.v1.manifest.json",
    );
    const projection = manifest.replay_input_projection as JsonRecord;
    const baseContext = projection.base_context as JsonRecord;
    const rules = baseContext.rules as JsonRecord[];
    const authoritative = rules.find(
      (rule) => rule.rule_id === "rr_jp_cvs_006_nanaco_purchase_reward",
    );
    expect(authoritative).toBeDefined();
    if (!authoritative) return;

    expect(hashDefinition(candidate.rule)).toBe(DEFINITION_HASH);
    expect(
      canonicalize(economicProjection(candidate.rule as unknown as JsonRecord)),
    ).toBe(canonicalize(economicProjection(authoritative)));
    expect(candidate.rule.status).toBe("under_review");
    expect(candidate.rule.provenance.human_verified).toBe(false);
    expect(candidate.rule.audit.review_events).toEqual([]);
    expect(candidate.rule.audit.review_mode).toBeNull();
    expect(candidate.rule.audit.reviewed_at).toBeNull();
    expect(candidate.rule.audit.reviewed_by).toBeNull();
    expect(candidate.source_authority_role).toBe("primary");
    expect(candidate.source_ids).toEqual([SOURCE_ID]);
    expect(candidate.p0_family_id).toBe(FAMILY_ID);
    expect(candidate.source_role_id).toBe(SOURCE_ROLE_ID);
    expect(coverage.entries).toEqual([
      {
        family_id: "merchant.7eleven",
        source_role_id: "accepted_payment_methods",
        known_source_ids: ["merchant.seveneleven.payment-methods"],
      },
      {
        family_id: FAMILY_ID,
        source_role_id: SOURCE_ROLE_ID,
        known_source_ids: [SOURCE_ID],
      },
    ]);
    expect(tryValidateDocument(candidate.rule, "reward-rule").valid).toBe(true);
  });

  it("admits binding-only observation text without letting it change economics, then activates explicitly", async () => {
    const { candidate, coverage } = await inputs();
    const boundObservation = observation(candidate, {
      // Candidate economics are sealed by the route and are not copied from
      // arbitrary narrative text in the finding.
    });
    expect(
      tryValidateDocument(boundObservation, "source-observation").valid,
    ).toBe(true);

    const store = createProvisionalRuleStore();
    const admitted = store.admit({
      candidate,
      observation: boundObservation,
      p0_coverage_index: coverage,
    });
    expect(admitted.ok).toBe(true);
    if (!admitted.ok) return;
    expect(admitted.status).toBe("machine_checked");
    expect(admitted.definition_hash).toBe(DEFINITION_HASH);
    expect(admitted.envelope.rule.calculation).toEqual(
      candidate.rule.calculation,
    );
    expect(admitted.envelope.rule.scope).toEqual(candidate.rule.scope);
    expect(store.select()).toHaveLength(0);
    expect(store.select({ include_machine_checked: true })).toHaveLength(1);

    const activated = store.activate(
      admitted.candidate_hash,
      "2026-08-21T00:06:00Z",
      "explicit_nanaco_economic_pilot_activation",
    );
    expect(activated.ok).toBe(true);
    if (!activated.ok) return;
    expect(activated.envelope.status).toBe("active_experimental");
    expect(activated.envelope.rule.status).toBe("under_review");
    expect(store.select()).toHaveLength(1);
  });

  it("fails closed for changed economic hash, wrong source/role, extra fields, and hostile observations", async () => {
    const { candidate, coverage } = await inputs();
    const boundObservation = observation(candidate);

    const changedRate = structuredClone(candidate);
    changedRate.rule.calculation.spend_jpy = 199;
    changedRate.machine_check.checks.rule_semantics = false;
    expect(hashDefinition(changedRate.rule)).not.toBe(DEFINITION_HASH);
    const changedRateResult = createProvisionalRuleStore().admit({
      candidate: changedRate,
      observation: boundObservation,
      p0_coverage_index: coverage,
    });
    expect(changedRateResult.ok).toBe(false);
    if (!changedRateResult.ok)
      expect(
        changedRateResult.issues.some(
          (issue) => issue.code === "machine_check_mismatch",
        ),
      ).toBe(true);

    const wrongSource = structuredClone(candidate);
    wrongSource.source_ids = ["jp.nanaco.earning"];
    const wrongSourceResult = createProvisionalRuleStore().admit({
      candidate: wrongSource,
      observation: boundObservation,
      p0_coverage_index: coverage,
    });
    expect(wrongSourceResult.ok).toBe(false);
    if (!wrongSourceResult.ok)
      expect(
        wrongSourceResult.issues.some(
          (issue) => issue.code === "source_unregistered",
        ),
      ).toBe(true);

    const wrongRole = structuredClone(candidate);
    wrongRole.source_role_id = "program_terms";
    const wrongRoleResult = createProvisionalRuleStore().admit({
      candidate: wrongRole,
      observation: boundObservation,
      p0_coverage_index: coverage,
    });
    expect(wrongRoleResult.ok).toBe(false);
    if (!wrongRoleResult.ok)
      expect(
        wrongRoleResult.issues.some(
          (issue) => issue.code === "source_role_coverage_mismatch",
        ),
      ).toBe(true);

    const extraField = {
      ...candidate,
      invented_economic_claim: { reward_units: "999" },
    } as unknown;
    const extraFieldResult = createProvisionalRuleStore().admit({
      candidate: extraField,
      observation: boundObservation,
      p0_coverage_index: coverage,
    });
    expect(extraFieldResult.ok).toBe(false);
    if (!extraFieldResult.ok)
      expect(
        extraFieldResult.issues.some(
          (issue) => issue.code === "input_shape_invalid",
        ),
      ).toBe(true);

    const proxiedCandidate = new Proxy(candidate, {});
    const proxyResult = createProvisionalRuleStore().admit({
      candidate: proxiedCandidate,
      observation: boundObservation,
      p0_coverage_index: coverage,
    });
    expect(proxyResult.ok).toBe(false);
    if (!proxyResult.ok)
      expect(
        proxyResult.issues.some((issue) => issue.code === "hostile_proxy"),
      ).toBe(true);

    const hostileObservation = observation(candidate, {
      security_flags: ["prompt_injection"],
    });
    const hostileResult = createProvisionalRuleStore().admit({
      candidate,
      observation: hostileObservation,
      p0_coverage_index: coverage,
    });
    expect(hostileResult.ok).toBe(false);
    if (!hostileResult.ok)
      expect(
        hostileResult.issues.some(
          (issue) => issue.code === "observation_hostile",
        ),
      ).toBe(true);
  });

  it("keeps incomplete evidence inactive and forbids activation of non-primary authority", async () => {
    const { candidate, coverage } = await inputs();
    const needsEvidence = observation(candidate, {
      status: "needs_evidence",
      evidence_completeness: "partial",
      submitted_evidence_refs: [],
    });
    const store = createProvisionalRuleStore();
    const admitted = store.admit({
      candidate,
      observation: needsEvidence,
      p0_coverage_index: coverage,
    });
    expect(admitted.ok).toBe(true);
    if (!admitted.ok) return;
    expect(admitted.status).toBe("needs_evidence");
    expect(store.activate(admitted.candidate_hash, CHECKED_AT)).toMatchObject({
      ok: false,
      code: "activation_not_allowed",
    });

    const corroboratingCandidate = structuredClone(candidate);
    corroboratingCandidate.source_authority_role = "corroborating";
    const corroboratingObservation = observation(corroboratingCandidate, {
      // The observation is still schema-valid but no longer matches the
      // primary authority required by the candidate.
    });
    corroboratingObservation.discovery_assessment.source_authority_claim =
      "official_secondary";
    const corroboratingStore = createProvisionalRuleStore();
    const corroborating = corroboratingStore.admit({
      candidate: corroboratingCandidate,
      observation: corroboratingObservation,
      p0_coverage_index: coverage,
    });
    expect(corroborating.ok).toBe(true);
    if (!corroborating.ok) return;
    expect(
      corroboratingStore.activate(
        corroborating.candidate_hash,
        "2026-08-21T00:06:00Z",
      ),
    ).toMatchObject({
      ok: false,
      code: "source_authority_required_for_activation",
    });
  });

  it("uses only the sealed candidate and coverage through the nanaco pilot route", async () => {
    const { candidate } = await inputs();
    const store = createProvisionalRuleStore();
    const route = createNanacoEconomicPilot(store, evidenceVerifier(candidate));
    const sourceObservation = observation(candidate);
    const canonicalObservation = observation(candidate, {
      canonical_evidence_ids: [EVIDENCE_ID],
    });

    const admitted = route.admit(sourceObservation);
    expect(admitted.ok).toBe(true);
    if (!admitted.ok) return;
    expect(admitted.definition_hash).toBe(DEFINITION_HASH);
    expect(admitted.status).toBe("machine_checked");
    expect(admitted.envelope.candidate.rule.calculation).toEqual(
      candidate.rule.calculation,
    );
    expect(admitted.envelope.candidate.rule.scope).toEqual(
      candidate.rule.scope,
    );

    const activated = await route.activate(
      admitted.candidate_hash,
      canonicalObservation,
      "2026-08-21T00:07:00Z",
      "explicit_nanaco_economic_pilot_activation",
    );
    expect(activated.ok).toBe(true);
    if (!activated.ok) return;
    expect(activated.envelope.status).toBe("active_experimental");
    expect(store.select()).toHaveLength(1);
  });

  it("rejects coherent economic/source/coverage rewrites without store side effects", async () => {
    const { candidate } = await inputs();
    const store = createProvisionalRuleStore();
    const route = createNanacoEconomicPilot(store, evidenceVerifier(candidate));
    const sourceObservation = observation(candidate);
    const before = store.snapshot();

    const forgedCandidate = structuredClone(candidate);
    forgedCandidate.rule.calculation.spend_jpy = 1;
    forgedCandidate.rule.calculation.rounding.reward_rounding_mode = "ceil";
    const forgedCoverage = Object.freeze({
      version: "p0-coverage-index.attacker",
      entries: [
        {
          family_id: FAMILY_ID,
          source_role_id: SOURCE_ROLE_ID,
          known_source_ids: ["jp.nanaco.attacker-source"],
        },
      ],
    });

    // The public route has no candidate/coverage parameters. Extra runtime
    // arguments are ignored, so forged economics and coverage cannot enter.
    const routeAdmit = route.admit as unknown as (
      observation: unknown,
      candidate: unknown,
      coverage: unknown,
    ) => ReturnType<typeof route.admit>;
    const admitted = routeAdmit(
      sourceObservation,
      forgedCandidate,
      forgedCoverage,
    );
    expect(admitted.ok).toBe(true);
    if (!admitted.ok) return;
    expect(admitted.envelope.rule.calculation.spend_jpy).toBe(200);
    expect(
      admitted.envelope.rule.calculation.rounding.reward_rounding_mode,
    ).toBe("floor");
    expect(admitted.envelope.candidate.source_ids).toEqual([SOURCE_ID]);
    expect(store.snapshot()).not.toEqual(before);

    const wrongSourceObservation = observation(candidate, {
      raw_attributes: {
        change_type: "reward_rate",
        program_id: "program.jp.nanaco",
        merchant_id: "merchant.seveneleven",
        reward_rate: {
          reward_units: "1",
          spend_jpy: 200,
          spend_basis: "tax_exclusive",
        },
        eligible_product_class: "ordinary",
        posting_timing: "immediate_for_listed_merchant",
        product_exclusions_apply: true,
        canonical_publication: false,
        human_verified: false,
        source_id: "jp.nanaco.attacker-source",
      },
    });
    const snapshotBeforeWrongSource = store.snapshot();
    const rejectedWrongSource = route.admit(wrongSourceObservation);
    expect(rejectedWrongSource.ok).toBe(false);
    expect(store.snapshot()).toEqual(snapshotBeforeWrongSource);
  });

  it("makes a complete lead-only observation machine_checked without canonical promotion", async () => {
    const { candidate } = await inputs();
    const store = createProvisionalRuleStore();
    const route = createNanacoEconomicPilot(store, evidenceVerifier(candidate));
    const leadObservation = observation(candidate, {
      // Canonical promotion is separate; a complete canary finding can enter
      // the machine-checked lane immediately.
      canonical_evidence_ids: [],
      status: "needs_review",
      evidence_completeness: "complete",
      submitted_evidence_refs: ["lead_only_nanaco_source"],
    });
    const admitted = route.admit(leadObservation);
    expect(admitted.ok).toBe(true);
    if (!admitted.ok) return;
    expect(admitted.status).toBe("machine_checked");
    expect(store.get(admitted.candidate_hash)?.status).toBe("machine_checked");
    expect(store.select()).toHaveLength(0);
  });

  it("does not treat an exact evidence ID string as a canonical record", async () => {
    const { candidate } = await inputs();
    const store = createProvisionalRuleStore();
    const route = createNanacoEconomicPilot(store, () => false);
    const sourceObservation = observation(candidate);
    const admitted = route.admit(sourceObservation);
    expect(admitted.ok).toBe(true);
    if (!admitted.ok) return;

    const activated = await route.activate(
      admitted.candidate_hash,
      observation(candidate, { canonical_evidence_ids: [EVIDENCE_ID] }),
      "2026-08-21T00:07:00Z",
    );
    expect(activated).toMatchObject({
      ok: false,
      code: "activation_not_allowed",
    });
    expect(store.get(admitted.candidate_hash)?.status).toBe("machine_checked");
    expect(store.select()).toHaveLength(0);
  });

  it("fails closed when the asynchronous evidence verifier rejects", async () => {
    const { candidate } = await inputs();
    const store = createProvisionalRuleStore();
    const route = createNanacoEconomicPilot(store, async () => {
      throw new Error("evidence_store_unavailable");
    });
    const sourceObservation = observation(candidate);
    const admitted = route.admit(sourceObservation);
    expect(admitted.ok).toBe(true);
    if (!admitted.ok) return;

    const activated = await route.activate(
      admitted.candidate_hash,
      observation(candidate, { canonical_evidence_ids: [EVIDENCE_ID] }),
      "2026-08-21T00:07:00Z",
    );
    expect(activated).toMatchObject({
      ok: false,
      code: "activation_not_allowed",
    });
    expect(store.get(admitted.candidate_hash)?.status).toBe("machine_checked");
    expect(store.select()).toHaveLength(0);
  });

  it("rejects Proxy and extra-input observations before mutating the pilot store", async () => {
    const { candidate } = await inputs();
    const store = createProvisionalRuleStore();
    const route = createNanacoEconomicPilot(store, evidenceVerifier(candidate));
    const sourceObservation = observation(candidate);
    const proxied = new Proxy(sourceObservation, {});
    const proxyResult = route.admit(proxied);
    expect(proxyResult.ok).toBe(false);
    expect(store.snapshot()).toEqual([]);

    const extraResult = route.admit({
      ...sourceObservation,
      candidate: structuredClone(candidate),
      p0_coverage_index: Object.freeze({ entries: [] }),
    });
    expect(extraResult.ok).toBe(false);
    expect(store.snapshot()).toEqual([]);

    // The explicit activation helper also cannot activate a candidate under a
    // mismatched observation, and it must leave the machine-checked envelope
    // untouched.
    const admitted = route.admit(sourceObservation);
    expect(admitted.ok).toBe(true);
    if (!admitted.ok) return;
    const wrongEvidence = observation(candidate, {
      canonical_evidence_ids: ["ev_fake_nanaco"],
    });
    expect(
      await activateNanacoEconomicPilot(
        store,
        admitted.candidate_hash,
        wrongEvidence,
        "2026-08-21T00:07:00Z",
        evidenceVerifier(candidate),
      ),
    ).toMatchObject({ ok: false, code: "activation_not_allowed" });
    expect(store.get(admitted.candidate_hash)?.status).toBe("machine_checked");
  });
});
