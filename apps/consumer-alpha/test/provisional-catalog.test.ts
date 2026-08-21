import { beforeEach, describe, expect, it } from "vitest";
import {
  correctExperimentalRule,
  createDemoExperimentalCataloguePort,
  getExperimentalRules,
  listExperimentalCatalogue,
  normalizeExperimentalCatalogueSnapshot,
  resetExperimentalCatalogue,
} from "../src/provisional-catalog.js";

describe("host-owned experimental catalogue port", () => {
  beforeEach(() => {
    resetExperimentalCatalogue();
  });

  it("projects the bulk fixture into the exact browser-safe card DTO", async () => {
    const rules = await getExperimentalRules();
    expect(rules).toHaveLength(11);
    const creditCard = rules.find(
      (item) =>
        item.publication_id ===
        "candidate_p0_seveneleven_credit_card_20260821_v0_1",
    );
    expect(creditCard).toEqual({
      publication_id: "candidate_p0_seveneleven_credit_card_20260821_v0_1",
      kind: "payment_acceptance",
      title: "セブン‐イレブンの支払い方法",
      summary: expect.stringContaining("クレジットカード"),
      display_status: "experimental_unverified",
      confidence: "high",
      source_label: "セブン‐イレブン公式情報",
      checked_at: "2026-08-21T04:52:00Z",
      valid_from: "2026-08-21T13:49:24+09:00",
    });
    expect(new Set(rules.map((item) => item.publication_id)).size).toBe(11);
    for (const rule of rules) {
      expect(Object.keys(rule).sort()).toEqual([
        "checked_at",
        "confidence",
        "display_status",
        "kind",
        "publication_id",
        "source_label",
        "summary",
        "title",
        "valid_from",
      ]);
      const serialized = JSON.stringify(rule);
      expect(serialized).not.toMatch(
        /candidate_hash|definition_hash|source_ids|evidence|rule_id|https?:\/\//iu,
      );
    }
  });

  it("creates a host-owned correction and removes the exact publication version", async () => {
    const initial = await getExperimentalRules();
    const publicationId = initial[0]?.publication_id;
    if (!publicationId) throw new Error("publication missing");
    const result = await correctExperimentalRule({
      publication_id: publicationId,
      category: "not_accepted",
    });
    expect(result).toEqual({
      ok: true,
      publication_id: publicationId,
      category: "not_accepted",
      accepted: true,
    });
    expect(JSON.stringify(result)).not.toMatch(
      /candidate_hash|definition_hash|reported_at|disputed|severity|credible/iu,
    );
    const remaining = await getExperimentalRules();
    expect(remaining).toHaveLength(10);
    expect(
      remaining.some((item) => item.publication_id === publicationId),
    ).toBe(false);
    await expect(
      correctExperimentalRule({
        publication_id: publicationId,
        category: "not_accepted",
      }),
    ).resolves.toMatchObject({
      ok: false,
      code: "publication_not_active",
    });
  });

  it("fails closed for malformed adapter snapshots and preserves no private fields", async () => {
    const validCard = {
      publication_id: "publication_a",
      kind: "campaign",
      title: "キャンペーン",
      summary: "公式情報をもとに自動収集した先行公開情報です。",
      display_status: "experimental_unverified",
      confidence: "medium",
      source_label: "公式情報",
      checked_at: "2026-08-21T00:00:00Z",
      valid_from: "2026-08-21T00:00:00Z",
    } as const;
    const malicious = {
      status: "ready",
      updated_at: "2026-08-21T00:00:00Z",
      rules: [
        {
          ...validCard,
          candidate_hash: `sha256:${"0".repeat(64)}`,
        },
      ],
    };
    expect(() => normalizeExperimentalCatalogueSnapshot(malicious)).toThrow(
      "catalogue_card_shape_invalid",
    );
  });

  it("supports injected demo ports independently", async () => {
    const first = createDemoExperimentalCataloguePort();
    const second = createDemoExperimentalCataloguePort();
    const firstSnapshot = await listExperimentalCatalogue(first);
    const publicationId = firstSnapshot.rules[0]?.publication_id;
    if (!publicationId) throw new Error("publication missing");
    await first.reportCorrection({
      publication_id: publicationId,
      category: "not_accepted",
    });
    expect((await first.list()).rules).toHaveLength(10);
    expect((await second.list()).rules).toHaveLength(11);
  });

  it("fails closed for unknown publications", async () => {
    await expect(
      correctExperimentalRule({
        publication_id: "candidate_unknown",
        category: "not_accepted",
      }),
    ).resolves.toEqual({
      ok: false,
      code: "publication_not_found",
    });
  });
});
