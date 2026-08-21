import { describe, expect, it } from "vitest";
import {
  createPostgresNanacoEconomicPilotHost,
  type QueryClient,
  type QueryPool,
  type SourceObservation,
} from "../src/index.js";
import { NANACO_CANONICAL_EVIDENCE_QUERY } from "../src/nanaco-host.js";

const OBSERVATION_ID = "so_p0_nanaco_earn_rules_20260821";
const LEAD_EVIDENCE_ID = "nanaco-shopping-earning-evidence-canary-20260821-v1";
const EVIDENCE_ID = "ev_m3_nanaco_shopping_earning_20260820";
const SOURCE_ID = "jp.nanaco.shopping-earning";
const RULE_KEY = "rr_jp_cvs_006_nanaco_purchase_reward";
const RULE_VERSION = 1;
const DEFINITION_HASH =
  "sha256:9f8cb5de0af689ee8ca751a3ae6a34c2d974eb1c79c29c60bd555da4db116746";
const OBSERVATION_FINGERPRINT =
  "sha256:18a176e1ccb2e0eafe353f86ea8dfa7c0660fe3eec3d460e527e5bcc90060894";

function observation(): SourceObservation {
  const timestamp = "2026-08-21T00:03:00Z";
  return {
    observation_id: OBSERVATION_ID,
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
        name: "Seven-Eleven Japan",
      },
    ],
    change_type: "reward_rate",
    summary: "Primary-source observation with exact economic values.",
    effective_time: {
      occurred_at: timestamp,
      effective_from: null,
      effective_to: null,
    },
    discovery_assessment: {
      source_authority_claim: "primary",
      evidence_completeness: "complete",
      agent_confidence: 0.9,
    },
    submitted_evidence_refs: [LEAD_EVIDENCE_ID],
    canonical_evidence_ids: [],
    semantic_fingerprint_version: 1,
    semantic_fingerprint: OBSERVATION_FINGERPRINT,
    status: "needs_review",
    security_flags: [],
    raw_attributes: {
      family_id: "point.nanaco",
      source_id: SOURCE_ID,
      source_role_id: "earn_rules",
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

function queryClient(result: unknown): QueryClient & {
  readonly calls: readonly { text: string; values?: readonly unknown[] }[];
} {
  const calls: Array<{ text: string; values?: readonly unknown[] }> = [];
  return {
    calls,
    async query(text, values) {
      calls.push({ text, values });
      return { rows: result as never };
    },
  };
}

describe("createPostgresNanacoEconomicPilotHost", () => {
  it("retains a private store and activates through the exact DB lookup", async () => {
    const target = queryClient([{ eligible: true }]);
    const route = createPostgresNanacoEconomicPilotHost(target);
    const input = observation();
    const admitted = route.admit(input);

    expect(Object.keys(route).sort()).toEqual(["activate", "admit"]);
    expect(admitted.ok).toBe(true);
    if (!admitted.ok) return;

    const activated = await route.activate(
      admitted.candidate_hash,
      { ...input, canonical_evidence_ids: [EVIDENCE_ID] },
      "2026-08-21T00:06:00Z",
      "trusted_nanaco_host_test",
    );
    expect(activated.ok).toBe(true);
    if (activated.ok)
      expect(activated.envelope.status).toBe("active_experimental");
    expect(NANACO_CANONICAL_EVIDENCE_QUERY).toContain(
      "work.agent_feed_evidence_id = submitted.agent_feed_evidence_id",
    );
    expect(NANACO_CANONICAL_EVIDENCE_QUERY).toContain(
      "observation.submitted_evidence_refs @> jsonb_build_array(submitted.agent_feed_evidence_id)",
    );
    expect(NANACO_CANONICAL_EVIDENCE_QUERY).not.toMatch(
      /(?:submitted|work)\.agent_feed_evidence_id\s*=\s*\$2/,
    );
    expect(target.calls).toEqual([
      {
        text: NANACO_CANONICAL_EVIDENCE_QUERY,
        values: [
          OBSERVATION_ID,
          EVIDENCE_ID,
          SOURCE_ID,
          RULE_KEY,
          RULE_VERSION,
          DEFINITION_HASH,
        ],
      },
    ]);
  });

  it("fails closed for a false lookup, mismatched observation, query error, and malformed result", async () => {
    const input = observation();
    const falseTarget = queryClient([{ eligible: false }]);
    const falseRoute = createPostgresNanacoEconomicPilotHost(falseTarget);
    const falseAdmission = falseRoute.admit(input);
    expect(falseAdmission.ok).toBe(true);
    if (!falseAdmission.ok) return;
    const falseActivation = await falseRoute.activate(
      falseAdmission.candidate_hash,
      { ...input, canonical_evidence_ids: [EVIDENCE_ID] },
      "2026-08-21T00:06:00Z",
    );
    expect(falseActivation.ok).toBe(false);

    const mismatchTarget = queryClient([{ eligible: true }]);
    const mismatchRoute = createPostgresNanacoEconomicPilotHost(mismatchTarget);
    const mismatchAdmission = mismatchRoute.admit(input);
    expect(mismatchAdmission.ok).toBe(true);
    if (!mismatchAdmission.ok) return;
    const mismatched = {
      ...input,
      canonical_evidence_ids: ["ev_forged"],
    } as SourceObservation;
    const mismatchActivation = await mismatchRoute.activate(
      mismatchAdmission.candidate_hash,
      mismatched,
      "2026-08-21T00:06:00Z",
    );
    expect(mismatchActivation.ok).toBe(false);
    expect(mismatchTarget.calls).toHaveLength(0);

    const error = new Error("database lookup failed");
    const errorTarget: QueryClient = {
      async query() {
        throw error;
      },
    };
    const errorRoute = createPostgresNanacoEconomicPilotHost(errorTarget);
    const errorAdmission = errorRoute.admit(input);
    expect(errorAdmission.ok).toBe(true);
    if (!errorAdmission.ok) return;
    const errorActivation = await errorRoute.activate(
      errorAdmission.candidate_hash,
      { ...input, canonical_evidence_ids: [EVIDENCE_ID] },
      "2026-08-21T00:06:00Z",
    );
    expect(errorActivation.ok).toBe(false);

    const malformedTarget = queryClient([{ eligible: "true" }]);
    const malformedRoute =
      createPostgresNanacoEconomicPilotHost(malformedTarget);
    const malformedAdmission = malformedRoute.admit(input);
    expect(malformedAdmission.ok).toBe(true);
    if (!malformedAdmission.ok) return;
    const malformedActivation = await malformedRoute.activate(
      malformedAdmission.candidate_hash,
      { ...input, canonical_evidence_ids: [EVIDENCE_ID] },
      "2026-08-21T00:06:00Z",
    );
    expect(malformedActivation.ok).toBe(false);
  });

  it("uses pool release(error) only for failed lookups and never exposes generic capabilities", async () => {
    const releases: Array<Error | undefined> = [];
    const pool: QueryPool = {
      async query() {
        throw new Error("pool.query must not be used");
      },
      async connect() {
        return {
          async query() {
            return { rows: [{ eligible: true }] };
          },
          release(error?: Error) {
            releases.push(error);
          },
        };
      },
    };
    const route = createPostgresNanacoEconomicPilotHost(pool);
    const input = observation();
    const admitted = route.admit(input);
    expect(admitted.ok).toBe(true);
    if (!admitted.ok) return;
    await route.activate(
      admitted.candidate_hash,
      { ...input, canonical_evidence_ids: [EVIDENCE_ID] },
      "2026-08-21T00:06:00Z",
    );
    expect(releases).toEqual([undefined]);

    const failure = new Error("pool lookup failure");
    const failingPool: QueryPool = {
      async query() {
        throw new Error("pool.query must not be used");
      },
      async connect() {
        return {
          async query() {
            throw failure;
          },
          release(error?: Error) {
            releases.push(error);
          },
        };
      },
    };
    const failingRoute = createPostgresNanacoEconomicPilotHost(failingPool);
    const failingAdmission = failingRoute.admit(input);
    expect(failingAdmission.ok).toBe(true);
    if (!failingAdmission.ok) return;
    await failingRoute.activate(
      failingAdmission.candidate_hash,
      { ...input, canonical_evidence_ids: [EVIDENCE_ID] },
      "2026-08-21T00:06:00Z",
    );
    expect(releases.at(-1)).toBe(failure);

    const exports = await import("../src/index.js");
    expect(exports).not.toHaveProperty("createNanacoEconomicPilot");
    expect(exports).not.toHaveProperty("createProvisionalRuleStore");
    expect(exports).not.toHaveProperty("activateNanacoEconomicPilot");
  });

  it("rejects untrusted extra store/verifier fields on the observation", () => {
    const route = createPostgresNanacoEconomicPilotHost(
      queryClient([{ eligible: true }]),
    );
    const forged = {
      ...observation(),
      store: { admit: () => ({ ok: true }) },
      verifier: () => true,
    } as unknown;
    expect(route.admit(forged).ok).toBe(false);
  });
});
