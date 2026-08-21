import { describe, expect, it } from "vitest";
import {
  createRedactedHistoryRecord,
  decideRetention,
  type HistoryAuthorizationPort,
} from "../src/history.js";
import {
  authorizeReplay,
  buildReplayArtifact,
  type ReplayAuthorizationContext,
} from "../src/replay.js";
import {
  assessRuleTrust,
  canonicalSnapshot,
  findProhibitedData,
  M5SecurityError,
} from "../src/security.js";

describe("M5 security admission", () => {
  it("rejects nested key and value evasion without leaking the value", () => {
    const issues = findProhibitedData({
      outer: [{ payment: { cArD__NuMbEr: "4111-1111-1111-1111" } }],
    });
    expect(issues.some((item) => item.code === "prohibited_pan")).toBe(true);
    expect(issues.every((item) => !item.path.includes("4111"))).toBe(true);
    expect(issues.every((item) => !item.path.includes("cArD"))).toBe(true);
    expect(() =>
      canonicalSnapshot({ nested: { bearer: "Bearer secret-token" } }),
    ).toThrow(M5SecurityError);
    try {
      canonicalSnapshot({ nested: { api_key: "api_live_abcdefghijklmnop" } });
    } catch (error) {
      expect(error).toBeInstanceOf(M5SecurityError);
      expect((error as Error).message).not.toContain("api_live");
      expect((error as Error).message).not.toContain("api_key");
    }
  });

  it("allows exactly four optional last-four digits", () => {
    expect(
      findProhibitedData({ optional_last_four: "1234", benign_id: "411111" }),
    ).toEqual([]);
    expect(
      findProhibitedData({ card_number: "4111 1111 1111 1111" }).some(
        (item) => item.code === "prohibited_pan",
      ),
    ).toBe(true);
    expect(
      findProhibitedData({ card_number: "4111‐1111‐1111‐1111" }).some(
        (item) => item.code === "prohibited_pan",
      ),
    ).toBe(true);
  });

  it("rejects dynamic unencrypted screenshots and malformed JSON values", () => {
    expect(
      findProhibitedData({
        screenshot: { dynamic: true, encrypted: false, bytes: "opaque" },
      }).some((item) => item.code === "prohibited_dynamic_screenshot"),
    ).toBe(true);
    expect(
      findProhibitedData({
        screenshots: [{ type: "dynamic-payment-qr", encrypted: false }],
      }).some((item) => item.code === "prohibited_dynamic_screenshot"),
    ).toBe(true);
    expect(() => canonicalSnapshot({ amount: Number.NaN })).toThrow(
      M5SecurityError,
    );
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => canonicalSnapshot(cyclic)).toThrow(M5SecurityError);
    expect(() => canonicalSnapshot({ big: 1n })).toThrow(M5SecurityError);
  });

  it("returns an immutable deterministic snapshot and does not freeze the caller", () => {
    const input = { z: 1, nested: { a: "ok" } };
    const first = canonicalSnapshot(input);
    const second = canonicalSnapshot({ nested: { a: "ok" }, z: 1 });
    expect(first.sha256).toBe(second.sha256);
    expect(first.canonical_json).toBe('{"nested":{"a":"ok"},"z":1}');
    expect(Object.isFrozen(first.value)).toBe(true);
    expect(Object.isFrozen(first.value.nested)).toBe(true);
    expect(Object.isFrozen(input)).toBe(false);
    expect(() => {
      (first.value as { nested: { a: string } }).nested.a = "mutated";
    }).toThrow();
  });

  it("rejects ignored own properties, symbols, accessors, toJSON, and pollution keys", () => {
    const hidden = { safe: "ok" };
    Object.defineProperty(hidden, "issuer_secret", {
      value: "Bearer hidden",
      enumerable: false,
    });
    expect(() => canonicalSnapshot(hidden)).toThrow(M5SecurityError);
    const symbolSecret = {
      safe: "ok",
      [Symbol("issuer_secret")]: "Bearer hidden",
    };
    expect(() => canonicalSnapshot(symbolSecret)).toThrow(M5SecurityError);
    let getterCalls = 0;
    const getter = { safe: "ok" };
    Object.defineProperty(getter, "credential", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "Bearer changed";
      },
    });
    expect(() => canonicalSnapshot(getter)).toThrow(M5SecurityError);
    expect(getterCalls).toBe(0);
    const toJson = {
      safe: "ok",
      toJSON: () => "Bearer should never execute",
    };
    expect(() => canonicalSnapshot(toJson)).toThrow(M5SecurityError);
    expect(() =>
      canonicalSnapshot(
        JSON.parse('{"constructor":{"prototype":{"polluted":true}}}'),
      ),
    ).toThrow(M5SecurityError);
    expect(Object.prototype).not.toHaveProperty("polluted");
    expect(
      findProhibitedData({ issuer_secret: "Bearer redacted" })[0]?.path,
    ).not.toContain("issuer_secret");
    expect(
      findProhibitedData({ innocuous: "ghp_1234567890abcdefghijkl" }).some(
        (item) => item.code === "prohibited_api_or_bearer_token",
      ),
    ).toBe(true);
    let proxyReads = 0;
    const proxy = new Proxy(
      { credential: "safe" },
      {
        getOwnPropertyDescriptor(target, key) {
          proxyReads += 1;
          return Object.getOwnPropertyDescriptor(target, key);
        },
      },
    );
    expect(() => canonicalSnapshot(proxy)).toThrow(M5SecurityError);
    expect(proxyReads).toBe(0);
  });
});

function validAssurance(rule_id: string) {
  return {
    rule_id,
    status: "approved",
    terms_reviewed: true,
    review_approved: true,
    canonical_evidence: [
      {
        evidence_id: `evidence-${rule_id}`,
        source_id: `source-${rule_id}`,
        verified: true,
      },
    ],
    sources: [{ source_id: `source-${rule_id}`, verified: true }],
    freshness_status: "healthy",
    risk_status: "low",
  } as const;
}

describe("M5 rule assurance gate", () => {
  it("requires exact unique coverage and all independent trust gates", () => {
    const approved = assessRuleTrust(
      ["r1", "r2"],
      [validAssurance("r1"), validAssurance("r2")],
    );
    expect(approved.trusted).toBe(true);
    expect(approved.blockers).toEqual([]);

    const missing = assessRuleTrust(["r1", "r2"], [validAssurance("r1")]);
    expect(missing.trusted).toBe(false);
    expect(
      missing.blockers.some((item) => item.code === "assurance_missing"),
    ).toBe(true);

    const duplicate = assessRuleTrust(
      ["r1"],
      [validAssurance("r1"), validAssurance("r1")],
    );
    expect(
      duplicate.blockers.some((item) => item.code === "assurance_duplicate"),
    ).toBe(true);

    const stale = assessRuleTrust(
      ["r1"],
      [{ ...validAssurance("r1"), freshness_status: "stale" }],
    );
    expect(
      stale.blockers.some((item) => item.code === "freshness_unhealthy"),
    ).toBe(true);
    const highRisk = assessRuleTrust(
      ["r1"],
      [{ ...validAssurance("r1"), unresolved_high_risk: true }],
    );
    expect(
      highRisk.blockers.some((item) => item.code === "high_risk_unresolved"),
    ).toBe(true);
  });

  it("does not accept producer authority claims in place of evidence/review", () => {
    const result = assessRuleTrust(
      ["r1"],
      [{ rule_id: "r1", producer_authority: "official" }],
    );
    expect(result.trusted).toBe(false);
    expect(
      result.blockers.some((item) => item.code === "evidence_missing"),
    ).toBe(true);
    expect(
      result.blockers.some((item) => item.code === "review_unapproved"),
    ).toBe(true);
    expect(
      result.blockers.some((item) => item.code === "freshness_unhealthy"),
    ).toBe(true);
  });
});

describe("M5 redacted history", () => {
  const baseRequest = { merchant_id: "merchant.synthetic" };
  const baseResponse = { status: "complete", winner_plan_id: "plan.synthetic" };
  const base = {
    retention_class: "30_days",
    created_at: "2026-08-19T00:00:00Z",
    request: baseRequest,
    response: baseResponse,
    request_sha256: canonicalSnapshot(baseRequest).sha256,
    response_sha256: canonicalSnapshot(baseResponse).sha256,
    result_summary: {
      status: "complete",
      winner_plan_id: "plan.synthetic",
      wallet: { raw: "must not be copied" },
      facts: { location: "must not be copied" },
    },
  } as const;

  it("is session-only without creating a record", () => {
    const result = createRedactedHistoryRecord({
      retention_class: "session_only",
    });
    expect(result.persist).toBe(false);
    expect(result.record).toBeNull();
  });

  it("creates only an allowlisted redacted record with deterministic purge", () => {
    const first = createRedactedHistoryRecord(base);
    const second = createRedactedHistoryRecord(base);
    expect(first.persist).toBe(true);
    expect(first.record).not.toBeNull();
    expect(first.record?.history_id).toBe(second.record?.history_id);
    expect(first.record?.purge_after).toBe("2026-09-18T00:00:00.000Z");
    expect(first.record?.result_summary).toEqual({
      status: "complete",
      winner_plan_id: "plan.synthetic",
    });
    expect(JSON.stringify(first.record)).not.toContain("must not be copied");
    expect(Object.isFrozen(first.record)).toBe(true);
  });

  it("requires explicit authorized legal hold and removes purge deadline", () => {
    const legalHoldContext: HistoryAuthorizationPort = {
      authorizeLegalHold: ({
        retention_class,
        requested_authorization_id,
      }) => ({
        kind: "m5_trusted_legal_hold" as const,
        retention_class,
        authorization_id: requested_authorization_id ?? "hold-1",
        issuer: "trusted-host",
        issued_at: "2026-08-19T00:00:00Z",
      }),
    };
    const result = createRedactedHistoryRecord(
      { ...base, legal_hold_authorization_id: "hold-1" },
      legalHoldContext,
    );
    expect(result.record?.legal_hold).toBe(true);
    expect(result.record?.purge_after).toBeNull();
    expect(() =>
      createRedactedHistoryRecord(
        { ...base, legal_hold_authorization_id: "asked" },
        {
          authorizeLegalHold: ({ retention_class }) => ({
            kind: "m5_trusted_legal_hold" as const,
            retention_class,
            authorization_id: "other",
            issuer: "trusted-host",
            issued_at: "2026-08-19T00:00:00Z",
          }),
        },
      ),
    ).toThrow(/legal_hold_id_invalid/);
    expect(() =>
      createRedactedHistoryRecord(
        { ...base, legal_hold_authorization_id: "hold-1" },
        {
          authorizeLegalHold: () => ({
            kind: "m5_trusted_legal_hold" as const,
            retention_class: "90_days",
            authorization_id: "hold-1",
            issuer: "trusted-host",
            issued_at: "2026-08-19T00:00:00Z",
          }),
        },
      ),
    ).toThrow(/legal_hold_proof_invalid/);
    expect(() =>
      createRedactedHistoryRecord({
        ...base,
        legal_hold: { authorized: true, authorization_id: "hold-1" },
      }),
    ).toThrow(/legal_hold/);
    expect(
      decideRetention({
        retention_class: "user_selected",
        created_at: base.created_at,
        retention_days: 7,
      }).purge_after,
    ).toBe("2026-08-26T00:00:00.000Z");
    expect(() =>
      createRedactedHistoryRecord({
        ...base,
        legal_hold_authorization: {
          kind: "m5_trusted_legal_hold",
          authorization_id: "hold-1",
          issuer: "attacker",
          issued_at: "2026-08-19T00:00:00Z",
        },
      }),
    ).toThrow(/legal_hold/);
    expect(() =>
      createRedactedHistoryRecord({
        ...base,
        result_summary: { summary: "alice@example.com" },
      }),
    ).toThrow(/summary_invalid/);
  });

  it("does not accept unbound attacker-provided hashes", () => {
    expect(() =>
      createRedactedHistoryRecord({
        retention_class: "30_days",
        created_at: base.created_at,
        request_sha256: base.request_sha256,
        response_sha256: base.response_sha256,
        result_summary: { status: "complete" },
      }),
    ).toThrow(/hash_missing/);
    expect(() =>
      createRedactedHistoryRecord({
        ...base,
        request_sha256:
          "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      }),
    ).toThrow(/hash_mismatch/);
  });
});

describe("M5 canonical replay authorization", () => {
  const requestPayload = { fixture_id: "synthetic-fixture-1", amount: 100 };
  const resultPayload = {
    fixture_id: "synthetic-result-1",
    status: "complete",
  };
  const validReplay = {
    replay_class: "synthetic",
    actor_scopes: ["replay:write"],
    request: requestPayload,
    result: resultPayload,
    request_sha256: canonicalSnapshot(requestPayload).sha256,
    result_sha256: canonicalSnapshot(resultPayload).sha256,
    sealed: true,
    transaction_time: "2026-08-19T00:00:00Z",
    replay_knowledge_at: "2026-08-19T00:00:00Z",
    created_at: "2026-08-19T00:00:00Z",
    engine_version: "engine-v1",
    rules_version: "rules-v1",
    valuation_version: "valuation-v1",
    fixture_manifest_id: "manifest-1",
    fixture_manifest_sha256:
      "sha256:1111111111111111111111111111111111111111111111111111111111111111",
  } as const;

  function replayContext(): ReplayAuthorizationContext {
    return {
      authorizeActor: ({ replay_class, request_sha256, result_sha256 }) => ({
        kind: "m5_trusted_replay_actor",
        replay_class,
        scopes: [
          replay_class === "redacted_incident"
            ? "replay:redacted_incident"
            : "replay:write",
        ],
        request_sha256,
        result_sha256,
        verified: true,
      }),
      verifyFixtureManifest: ({
        replay_class,
        manifest_id,
        manifest_sha256,
        request_sha256,
        result_sha256,
      }) => ({
        kind: "m5_trusted_fixture_manifest",
        replay_class,
        manifest_id,
        manifest_sha256: manifest_sha256 as `sha256:${string}`,
        request_sha256,
        result_sha256,
        immutable: true,
        verified: true,
      }),
      verifyIncidentApproval: ({
        approval_id,
        replay_class,
        request_sha256,
        result_sha256,
      }) =>
        replay_class === "redacted_incident"
          ? {
              kind: "m5_trusted_incident_approval",
              approval_id,
              replay_class,
              request_sha256,
              result_sha256,
              verified: true,
            }
          : null,
    };
  }

  it("denies missing scope, mismatched hashes, user data, and unsealed artifacts", () => {
    expect(
      authorizeReplay({ ...validReplay, actor_scopes: [] }, replayContext())
        .allowed,
    ).toBe(false);
    expect(
      authorizeReplay(
        {
          ...validReplay,
          request_sha256:
            "sha256:0000000000000000000000000000000000000000000000000000000000000000",
        },
        replayContext(),
      ).blockers.some((item) => item.code === "payload_hash_mismatch"),
    ).toBe(true);
    expect(
      authorizeReplay(
        {
          ...validReplay,
          request: { user_id: "user-1" },
        },
        replayContext(),
      ).blockers.some((item) => item.code === "user_data_present"),
    ).toBe(true);
    expect(
      authorizeReplay(
        { ...validReplay, sealed: false },
        replayContext(),
      ).blockers.some((item) => item.code === "sealed_required"),
    ).toBe(true);
  });

  it("produces a deterministic frozen synthetic artifact", () => {
    const first = buildReplayArtifact(validReplay, replayContext());
    const second = buildReplayArtifact(validReplay, replayContext());
    expect(first.artifact_id).toBe(second.artifact_id);
    expect(first.contains_user_data).toBe(false);
    expect(first.sealed).toBe(true);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.request_snapshot.value)).toBe(true);
  });

  it("requires separate approval and an allowlisted payload for incidents", () => {
    const baseIncident = {
      ...validReplay,
      replay_class: "redacted_incident",
      approval_id: "approval-1",
      actor_scopes: ["replay:redacted_incident"],
      redacted_payload: {
        incident_id: "incident-1",
        redaction_version: "v1",
        reason_codes: ["stale_rule"],
      },
    } as const;
    expect(authorizeReplay(baseIncident, replayContext()).allowed).toBe(true);
    expect(
      authorizeReplay({ ...baseIncident, approval: undefined }, replayContext())
        .allowed,
    ).toBe(false);
    expect(
      authorizeReplay(
        { ...baseIncident, redacted_payload: { wallet: "raw" } },
        replayContext(),
      ).allowed,
    ).toBe(false);
    expect(
      authorizeReplay(
        {
          ...baseIncident,
          actor_scopes: ["replay:write"],
          approval: { id: "approval-1", authorized: true },
        },
        replayContext(),
      ).allowed,
    ).toBe(false);
    expect(
      authorizeReplay(
        { ...baseIncident, approval: { authorized: true } },
        replayContext(),
      ).allowed,
    ).toBe(false);
    expect(
      authorizeReplay(
        { ...baseIncident, approval_authorized: true },
        replayContext(),
      ).allowed,
    ).toBe(false);
    expect(
      authorizeReplay({ ...baseIncident, approved: true }, replayContext())
        .allowed,
    ).toBe(false);
  });

  it("requires host-bound fixture provenance and exact payload hashes", () => {
    const noFixturePort: ReplayAuthorizationContext = {
      authorizeActor: replayContext().authorizeActor,
    };
    expect(authorizeReplay(validReplay, noFixturePort).allowed).toBe(false);

    const mismatchedFixturePort: ReplayAuthorizationContext = {
      authorizeActor: replayContext().authorizeActor,
      verifyFixtureManifest: ({
        replay_class,
        manifest_id,
        manifest_sha256,
        result_sha256,
      }) => ({
        kind: "m5_trusted_fixture_manifest",
        replay_class,
        manifest_id,
        manifest_sha256: manifest_sha256 as `sha256:${string}`,
        request_sha256:
          "sha256:0000000000000000000000000000000000000000000000000000000000000000",
        result_sha256,
        immutable: true,
        verified: true,
      }),
    };
    expect(
      authorizeReplay(validReplay, mismatchedFixturePort).blockers.some(
        (item) => item.code === "actor_scope_invalid",
      ),
    ).toBe(true);
  });

  it("forbids restricted user data independently of synthetic markers or flags", () => {
    for (const payload of [
      { wallet: { synthetic: true } },
      { account: { synthetic: true } },
      { customer: { email: "person@example.test" } },
      { contains_user_data: false, location: "Tokyo" },
    ]) {
      expect(
        authorizeReplay(
          { ...validReplay, request: payload },
          replayContext(),
        ).blockers.some((item) => item.code === "user_data_present"),
      ).toBe(true);
    }
    expect(
      authorizeReplay(
        {
          ...validReplay,
          request: { extra: { contact: "alice@example.com" } },
        },
        replayContext(),
      ).blockers.some((item) => item.code === "user_data_present"),
    ).toBe(true);
    expect(authorizeReplay(validReplay).allowed).toBe(false);
  });
});
