# Supabase stack decision v0.4.1

## Rewards Optimizer

| Feature | Decision | Purpose |
|---|---|---|
| Postgres | Essential | Rules, bitemporal evidence, assets, users, observations, audit |
| Auth | Essential for consumer app | Account identity and sessions |
| RLS | Essential | User wallet, valuation, campaign state, history isolation |
| Storage | Essential for evidence | Permitted snapshots, PDFs, captures, extraction artifacts |
| PostGIS | Recommended | Merchant/branch resolution and location overrides |
| Edge Functions | Recommended | Authenticated APIs, Agent Feed event ingress, notifications |
| Queues/PGMQ | Recommended | Internal evidence, impact-analysis, and notification jobs |
| Cron | Recommended | Expiry checks, stale-source checks, app-owned monitors, housekeeping |
| Vault/Function Secrets | Recommended | Signing keys and external credentials |
| Database Webhooks | Optional | Cross-system events where queue/outbox is not the better fit |
| Realtime | Optional UX | Live admin queue, open-app campaign updates, cross-device state |
| pgvector | Not required | It cannot determine reward rules or ranking |

Realtime is not the source monitor, job queue, or canonical synchronization mechanism. The app works correctly without it.

## Agent Feed deployment

Agent Feed is a separate code project and the recommended production deployment is a separate Supabase project. Its primary features are Postgres, Edge Functions, Queues, scoped auth/RLS, secrets, and optional Storage. Realtime is optional for its admin dashboard.

Cross-project integration uses signed HTTPS events. Neither project receives direct database credentials for the other.

## Prototype concession

A local prototype may run both services on one machine or temporary Postgres instance. Tests must still cross the public protocol boundary so production separation does not require architectural rewriting.
