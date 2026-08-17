# Japan Rewards Optimizer Foundation Package v0.4.1

Research cutoff: **2026-08-17 (Asia/Tokyo)**

This package defines the evidence, domain model, database controls, implementation sequence, and Codex handoff for a Japan-first purchase-route optimizer.

## Separate Agent Feed project

Monitoring transport is no longer implemented inside this application. The sibling project `../agent-feed` owns generic agent runs, findings, submitted evidence, SDKs, adapters, MCP/REST ingress, and durable consumer delivery.

The Rewards Optimizer pins Agent Feed protocol `0.1` and converts supported generic findings into its own untrusted `SourceObservation` records. Only the Rewards Optimizer can acquire/promote canonical evidence and publish reward rules.

The projects are separate deployables and do not query one another's database.

## Status

v0.4.1 retains the converged operation-and-asset engine from v0.3 and adds a clean cross-project monitoring boundary. Realtime is explicitly optional UX rather than a monitor or job-delivery dependency.

The architecture remains commercial-capable, but the first validation target is a personal/internal Tokyo convenience-store alpha.

## Core model

```text
external funding
  → top-up or voucher acquisition
  → created asset lot
  → merchant purchase
  → residual asset lot
  → reward components
  → separate valuation
  → reconciled rank
```

## Discovery and evidence model

```text
external monitor
  → Agent Feed Finding
  → Rewards SourceObservation
  → canonical evidence acquisition
  → ExtractionCandidate
  → reviewed RewardRuleVersion
```

A finding is not a fact, and submitted evidence is not canonical evidence.

## Important new files

| Path | Purpose |
|---|---|
| `docs/15_agent_feed_integration.md` | Cross-project trust, mapping, dedupe, and delivery contract |
| `docs/16_supabase_stack_decision.md` | Supabase features and Realtime decision |
| `docs/17_monitoring_producer_contract.md` | Requirements for ChatGPT/Claude/API monitors |
| `schemas/source-observation.schema.json` | App-specific observation after generic finding intake |
| `db/0002_agent_feed_consumer.sql` | Private staging/receipt reference migration |
| `db/tests/003_agent_feed_consumer.sql` | Idempotency and no-direct-rule-link regression |
| `prompts/CODEX_AGENT_FEED_INTEGRATION_PROMPT.md` | Later app-side integration assignment |
| `packages/agent-feed-consumer/README.md` | Consumer package boundary |

The existing source registry remains data version v0.3 because this architectural update does not change the researched source set.

## Implementation order

1. Run `prompts/CODEX_INITIATING_PROMPT.md` for Milestones 0 + 1A.
2. Run `prompts/CODEX_MILESTONE_1B_PROMPT.md` after the conservation gate.
3. Implement hardened persistence.
4. Implement the separate Agent Feed project in parallel.
5. Run `prompts/CODEX_AGENT_FEED_INTEGRATION_PROMPT.md` only after both dependency gates pass.
6. Run the two-lane source-maintenance rehearsal.

## Boundaries

- no live source collection in the engine slices;
- no Agent Feed server implementation in this project;
- no direct database coupling between projects;
- no finding-to-rule automatic publication;
- no Realtime-based job delivery;
- no PAN, CVV, PIN, banking passwords, dynamic payment QR values, or copied issuer sessions;
- synthetic examples are not current market claims;
- this package is engineering/product research, not legal advice.

## Runnable prototype

`prototype/` contains a tested operation-and-asset kernel, a thin HTTP API, and a responsive browser experience using synthetic data. Run `cd prototype && npm test && npm start`. Codex must extend this baseline instead of deleting it and scaffolding from zero.
