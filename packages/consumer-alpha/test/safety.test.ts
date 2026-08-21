import { describe, expect, it } from "vitest";
import {
  assertCorrectionReport,
  createCorrectionReport,
} from "../src/corrections.js";
import {
  DEEP_LINK_CATALOG,
  getDeepLinkCatalog,
  resolveDeepLink,
} from "../src/deep-links.js";

const RECOMMENDATION_HASH = `sha256:${"a".repeat(64)}` as const;

function validCorrection(overrides: Record<string, unknown> = {}) {
  return {
    version: "1",
    category: "missing_reward",
    recommendation_hash: RECOMMENDATION_HASH,
    merchant_id: "merchant.synthetic",
    branch_id: "branch.tokyo.synthetic",
    eligible_plan_id: "plan.synthetic",
    source_ids: ["source.b", "source.a"],
    note_code: "reward_not_posted",
    ...overrides,
  };
}

describe("M6 host-owned deep links", () => {
  it("resolves only enabled synthetic catalogue ids", () => {
    const result = resolveDeepLink("synthetic_loyalty_app");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.link.href).toBe(
      "https://alpha.rewards-optimizer.test/fixtures/loyalty-app",
    );
    expect(result.link.synthetic).toBe(true);
    expect(result.link.status).toBe("enabled");
    expect(result.link.verification_status).toBe("synthetic_fixture");
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.link)).toBe(true);
  });

  it("contains disabled and unverified entries but never resolves them", () => {
    expect(resolveDeepLink("synthetic_disabled_app")).toEqual({
      ok: false,
      denial: { code: "link_disabled" },
    });
    expect(resolveDeepLink("synthetic_unverified_app")).toEqual({
      ok: false,
      denial: { code: "link_unverified" },
    });
    expect(getDeepLinkCatalog()).toBe(DEEP_LINK_CATALOG);
    expect(getDeepLinkCatalog().every((entry) => entry.synthetic)).toBe(true);
  });

  it("does not accept arbitrary hrefs, schemes, paths, queries, or hosts", () => {
    const attacks = [
      { link_id: "synthetic_loyalty_app", href: "javascript:alert(1)" },
      { link_id: "synthetic_loyalty_app", href: "data:text/html,owned" },
      { link_id: "synthetic_loyalty_app", href: "file:///tmp/owned" },
      {
        link_id: "synthetic_loyalty_app",
        href: "https://evil.example.test/",
      },
      {
        link_id: "synthetic_loyalty_app",
        href: "https://alpha.rewards-optimizer.test/fixtures/loyalty-app?next=https://evil.example",
      },
      {
        link_id: "synthetic_loyalty_app",
        href: "https://alpha.rewards-optimizer.test/fixtures/loyalty-app#evil",
      },
      {
        link_id: "synthetic_loyalty_app",
        href: "https://alpha.rewards-optimizer.test.evil.example/",
      },
      {
        link_id: "synthetic_loyalty_app",
        href: "https://аlpha.rewards-optimizer.test/fixtures/loyalty-app",
      },
    ];
    for (const attack of attacks) {
      expect(resolveDeepLink(attack)).toEqual({
        ok: false,
        denial: { code: "invalid_selection" },
      });
    }
    expect(resolveDeepLink("https://alpha.rewards-optimizer.test/")).toEqual({
      ok: false,
      denial: { code: "invalid_selection" },
    });
  });

  it("rejects selection objects with extra fields, accessors, or lookalike ids", () => {
    expect(
      resolveDeepLink({
        link_id: "synthetic_loyalty_app",
        authorization: "self-approved",
      }),
    ).toEqual({ ok: false, denial: { code: "invalid_selection" } });
    expect(resolveDeepLink("synthetic_loyalty_app/../evil")).toEqual({
      ok: false,
      denial: { code: "invalid_selection" },
    });
    const accessor: Record<string, unknown> = {};
    Object.defineProperty(accessor, "link_id", {
      enumerable: true,
      get: () => "synthetic_loyalty_app",
    });
    expect(resolveDeepLink(accessor)).toEqual({
      ok: false,
      denial: { code: "invalid_selection" },
    });
  });
});

describe("M6 correction admission", () => {
  it("builds a redacted session-only report with deterministic sorted sources", () => {
    const first = createCorrectionReport(validCorrection());
    const second = createCorrectionReport(
      validCorrection({ source_ids: ["source.a", "source.b"] }),
    );
    expect(first).toEqual(second);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.report.state).toBe("session_only");
    expect(first.report.submission_status).toBe("not_submitted");
    expect(first.report.source_ids).toEqual(["source.a", "source.b"]);
    expect(first.report.correction_hash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(first.report.correction_id).toBe(
      `correction_${first.report.correction_hash.slice("sha256:".length)}`,
    );
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.report)).toBe(true);
    expect(Object.isFrozen(first.report.source_ids)).toBe(true);
  });

  it("never includes the raw recommendation or arbitrary caller fields", () => {
    const result = createCorrectionReport(
      validCorrection({
        recommendation: { winner: "raw payload" },
        href: "https://evil.example.test/collect",
      }),
    );
    expect(result).toEqual({ ok: false, denial: { code: "unknown_field" } });
  });

  it("rejects credentials and prohibited values before schema handling", () => {
    const credential = createCorrectionReport(
      validCorrection({
        attachment: { copied_session: "Bearer secret-token" },
      }),
    );
    expect(credential).toEqual({
      ok: false,
      denial: { code: "prohibited_data" },
    });
    const pan = createCorrectionReport(
      validCorrection({
        nested: { arbitrary_key: "4111 1111 1111 1111" },
      }),
    );
    expect(pan).toEqual({ ok: false, denial: { code: "prohibited_data" } });
    const qr = createCorrectionReport(
      validCorrection({
        screenshot: { dynamic: true, encrypted: false },
      }),
    );
    expect(qr).toEqual({ ok: false, denial: { code: "prohibited_data" } });
  });

  it("rejects self-authorization, persistence, legal, and review fields", () => {
    for (const key of [
      "authorization",
      "authorized",
      "status",
      "submitted_by",
      "purge_after",
      "legal_hold",
      "review_id",
      "user_id",
      "auth_token",
      "receipt",
      "attachments",
      "notes",
    ]) {
      expect(
        createCorrectionReport(validCorrection({ [key]: "attacker" })),
      ).toEqual({ ok: false, denial: { code: "unknown_field" } });
    }
  });

  it("rejects Unicode spoofing, URLs, query-bearing identifiers, and hashes", () => {
    expect(
      createCorrectionReport(
        validCorrection({ merchant_id: "merchаnt.synthetic" }),
      ),
    ).toEqual({ ok: false, denial: { code: "invalid_identifier" } });
    for (const value of [
      "https://alpha.rewards-optimizer.test/",
      "merchant@example.test",
      "branch/evil",
      "branch?next=https://evil.test",
      "branch#fragment",
    ]) {
      expect(
        createCorrectionReport(validCorrection({ branch_id: value })),
      ).toEqual({ ok: false, denial: { code: "invalid_identifier" } });
    }
    expect(
      createCorrectionReport(
        validCorrection({ recommendation_hash: "sha256:ABC" }),
      ),
    ).toEqual({ ok: false, denial: { code: "invalid_recommendation_hash" } });
  });

  it("enforces bounded enum fields and source-id limits", () => {
    expect(
      createCorrectionReport(validCorrection({ category: "free_text" })),
    ).toEqual({ ok: false, denial: { code: "invalid_category" } });
    expect(
      createCorrectionReport(validCorrection({ note_code: "please call me" })),
    ).toEqual({ ok: false, denial: { code: "invalid_note_code" } });
    expect(
      createCorrectionReport(
        validCorrection({ source_ids: ["source.a", "source.a"] }),
      ),
    ).toEqual({ ok: false, denial: { code: "duplicate_source_id" } });
    expect(
      createCorrectionReport(
        validCorrection({ source_ids: ["source".repeat(65)] }),
      ),
    ).toEqual({ ok: false, denial: { code: "invalid_source_ids" } });
  });

  it("does not mutate caller data and rejects mutation of the report", () => {
    const input = validCorrection({ source_ids: ["source.z", "source.a"] });
    const result = assertCorrectionReport(input);
    expect(input.source_ids).toEqual(["source.z", "source.a"]);
    expect(() => {
      (result as { category: string }).category = "wrong_branch";
    }).toThrow();
    expect(() => {
      (result.source_ids as string[]).push("source.evil");
    }).toThrow();
  });

  it("rejects malformed objects, cycles, sparse arrays, and arbitrary nested keys", () => {
    expect(createCorrectionReport(null)).toEqual({
      ok: false,
      denial: { code: "invalid_schema" },
    });
    const cyclic: Record<string, unknown> = validCorrection();
    cyclic.nested = cyclic;
    expect(createCorrectionReport(cyclic)).toEqual({
      ok: false,
      denial: { code: "prohibited_data" },
    });
    const sparse = validCorrection({ source_ids: [] }) as {
      source_ids: string[];
    };
    sparse.source_ids.length = 2;
    expect(createCorrectionReport(sparse)).toEqual({
      ok: false,
      denial: { code: "prohibited_data" },
    });
  });
});
