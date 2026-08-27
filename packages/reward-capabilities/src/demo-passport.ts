import type { RewardsPassportSummary } from "./types.js";
import { REWARD_CAPABILITIES_VERSION } from "./types.js";

/**
 * Explicitly synthetic passport for demos and unrestricted agent tracing.
 * No provider HTML, credential, cookie, or copied browser session contributes
 * to this object.
 */
export const DEMO_REWARDS_PASSPORT: RewardsPassportSummary = Object.freeze({
  version: REWARD_CAPABILITIES_VERSION,
  mode: "demo_fixture",
  balances: Object.freeze([
    Object.freeze({
      program_id: "point.d",
      label: "d POINT",
      available: 12_450,
      limited: 850,
      unit: "points" as const,
      pending: 120,
      last_synced_at: null,
      source: "demo_fixture" as const,
    }),
    Object.freeze({
      program_id: "point.ponta",
      label: "Ponta",
      available: 6_320,
      limited: 0,
      unit: "points" as const,
      pending: 0,
      last_synced_at: null,
      source: "demo_fixture" as const,
    }),
  ]),
  expiry_lots: Object.freeze([
    Object.freeze({
      lot_id: "demo-d-point-limited-2026-09",
      program_id: "point.d",
      amount: 850,
      expires_at: "2026-09-30T23:59:59+09:00",
      source: "demo_fixture" as const,
    }),
  ]),
  owned_family_ids: Object.freeze([
    "card.d",
    "card.rakuten",
    "wallet.dbarai",
    "point.d",
    "point.ponta",
  ]),
});
