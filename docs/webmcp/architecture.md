# WebMCP rewards architecture

Status: Milestone 1 implementation, 2026-08-27.

## Current-code audit

| Component | Decision | Reason |
| --- | --- | --- |
| `packages/rule-engine` | REUSE | Authoritative deterministic arithmetic, caps, rounding, expiry and valuation. |
| `packages/recommendation-api` | REUSE | Existing public recommendation contracts and orchestration boundary. |
| `packages/consumer-alpha` | REUSE | Existing consumer-facing projections. |
| `apps/consumer-alpha` | EXTEND | Existing HTTP server, browser DTOs, static UI and Vercel adapter remain the delivery shell. |
| Postgres/Supabase migrations | EXTEND in M2 | Current hardened database roles and RLS patterns are reusable, but authenticated Rewards Passport tables and Auth identity mapping are not yet implemented. |
| Agent Feed | REUSE | Remains public evidence/rule intake; private balances are excluded. |
| `packages/reward-capabilities` | NEW | One typed, stateful application boundary shared by every agent adapter. |
| `packages/rewards-agent` | NEW | Server-only OpenAI Agents SDK adapter over the shared capabilities. |
| WebMCP adapter | NEW in existing UI | Progressive enhancement using `document.modelContext`; normal UI remains functional without it. |
| Browser extension | DEFER to M3 | Not needed to prove the shared-capability vertical slice. |
| Neo4j and Qdrant | DEFER | Derived discovery/evidence indexes, never canonical dependencies. |

## Milestone 1 request flow

```text
normal browser UI ───────┐
WebMCP browser tool ─────┼─> RewardCapabilities ─> existing recommendation/rule path
OpenAI Agents SDK tool ──┘              │
                                        └─> one shared UI state snapshot
```

`RewardCapabilities` owns bounded application operations and session state. It accepts a calculation port; the consumer app adapts that port to its existing deterministic `unifiedRecommendations` path. The WebMCP and OpenAI layers can select and sequence capabilities, but neither performs reward arithmetic.

## Implemented operations

- `getRewardsPassportSummary`
- `getExpiringRewards`
- `getCurrentPurchaseContext`
- `comparePurchaseRoutes`
- `setSessionPurchasePreferences`
- `explainPurchaseRoute`

The passport values in Milestone 1 are explicitly marked `demo_fixture`. Authenticated persistence and provider observations remain M2 work.

## Runtime boundaries

- Browser code calls bounded same-origin HTTP capabilities only.
- `OPENAI_API_KEY` is read only by the server-side SDK.
- The OpenAI agent receives typed domain tools, never SQL or raw rule-engine access.
- `JRO_DATABASE_URL` selects the authoritative Supabase/PostgreSQL runtime for merchant acceptance, reward rates, and route facts. Without it, live calculation endpoints fail closed; the demo flag never substitutes route economics.
- The production Postgres composition remains authoritative when `JRO_DATABASE_URL` is present.
