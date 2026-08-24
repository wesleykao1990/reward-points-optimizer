# Agent Feed integration contract

## External project

Agent Feed is a separate project, implemented and deployed from the sibling project `../agent-feed`. The Rewards Optimizer pins protocol `0.1` and consumes only its published schema package and signed delivery contract.

## Published schema pin

The canonical lock is `packages/agent-feed-consumer/protocol-lock.json`:

- package/version: `@agent-feed/schema@0.1.1`;
- tag/source commit: `schema-v0.1.1` / `ad7e1a7270d0ebc09ffdc844d38cfa71a87bf95e`;
- artifact: `https://github.com/wesleykao1990/agent-feed/releases/download/schema-v0.1.1/agent-feed-schema-0.1.1.tgz`;
- manifest: `https://github.com/wesleykao1990/agent-feed/releases/download/schema-v0.1.1/schema-artifact-manifest.json`;
- SHA-512 integrity: `sha512-KHALcE3zQ/dey5GTXepDeXaz77Qf1DP3ySA+rcbG6eiFvUTws21cry8rfM191wyLeQthJ9ENd0neu23ETwX5/g==`;
- SHA-256: `9e020aba4e291f2e5328897dfb07195aaf392f6ecdd742b5c13b890cffdd9d6e`;
- size: `13078` bytes.

These values were independently recomputed from the published tarball after
release. Floating registry ranges, branch URLs, workspace links, and sibling
source imports do not satisfy this boundary.

CI does not maintain a workspace-wide checksum manifest. The offline foundation
validator covers repository contracts, while `scripts/verify_agent_feed_artifact.py`
is the explicit networked supply-chain check for the pinned external artifact:
it fetches the locked URL with bounded size/time and verifies the downloaded
bytes against the locked length, SHA-256, and SHA-512 SRI.

The projects must not:

- share application tables;
- query one another's database;
- import internal, unpublished implementation modules;
- rely on Realtime channels for delivery;
- allow an agent finding to mutate a reward rule directly.

## Processing pipeline

```text
Agent Feed signed finding event
  → durable transport receipt
  → structural/protocol validation
  → map to SourceObservation
  → reward-domain semantic fingerprint
  → duplicate/triage decision
  → evidence-acquisition request
  → canonical snapshot and EvidenceRecord
  → ExtractionCandidate
  → reviewed RewardRuleVersion
```

## Two deduplication layers

Agent Feed handles transport identity using event, run, batch, finding, and idempotency IDs. The Rewards Optimizer separately computes a versioned semantic fingerprint (`semantic_fingerprint_version = 1`) from domain fields such as subject, change type, effective date, campaign/program identity, and normalized claim.

A transport duplicate and a semantic duplicate are not the same event.

## Evidence ownership

Agent Feed evidence means “material supplied by the producer.” The Rewards Optimizer may use it as a lead, but canonical evidence requires its own authority check, acquisition permission, immutable capture, hash, locator, and review.

`canonical_evidence_ids` remains empty until promotion. Agent confidence never becomes source authority.

## Rule and plan update semantics

Agent Feed never writes or edits a `RewardRule` or `PurchasePlan` directly.
An accepted delivery can only start the Rewards-owned processing pipeline above.
When canonical evidence and a complete structured economic claim pass the
Rewards compiler and review policy, Rewards records a new immutable rule
candidate or `RewardRuleVersion`; it does not mutate the previous version.

The recommendation host then performs these deterministic steps:

```text
current eligible RewardRule versions at effective_at
  + exact source/evidence/candidate bindings
  + asset and merchant definitions
  -> hash-bound Rule IR records
  -> hash-bound executable-rule bundle
  -> request-specific candidate PurchasePlans
  -> deterministic engine evaluation and ranking
```

The executable bundle is derived state, not another publication authority. A
new active rule version, a correction, quarantine, supersession, source-trust
downgrade, or economic-validity boundary changes the eligible rule set and
therefore invalidates the prior bundle. The next recommendation request must
load the current eligible set and recompile or retrieve a bundle bound to that
exact set. It must never reuse a bundle whose rule, evidence, asset, merchant,
or validity binding is stale.

`PurchasePlan` remains ephemeral and request-specific. It represents the
operations and asset flows possible for the current merchant, amount, owned
instruments, balances, facts, and effective time. It is regenerated from the
current executable bundle; there is no Agent Feed event that edits an existing
plan. An incomplete claim can remain a searchable catalogue fact or make a
previous rule stale, but it cannot invent an operation, asset edge, tax basis,
rounding rule, cap, validity window, or candidate plan.

An optional LLM may propose extraction fields, Japanese wording, follow-up
question phrasing, or correction clusters. Those outputs are untrusted
annotations. Removing the model must leave rule hashes, candidate plans,
arithmetic, eligibility, ranking, winner IDs, and publication decisions
unchanged.

## Delivery

The production default is a signed HTTPS event from Agent Feed to:

```text
POST /internal/agent-feed/events
```

The endpoint records `event_id` idempotently before acknowledging. Agent Feed retries until acknowledgement and may dead-letter the event. The Rewards Optimizer can request replay by cursor or event ID.

## Supported finding types for the first integration

- `rewards.program_change`;
- `rewards.campaign`;
- `rewards.merchant_acceptance`;
- `rewards.transfer_change`;
- `rewards.source_relocation`.

Unknown types are stored or rejected according to policy; they never trigger generic rule creation.

## 2026-08-22 P0 live-run checkpoint

The sealed 44-work-unit / 301-target P0 operations set has been submitted to
the live Agent Feed application. Exact-hash reconciliation selected 39
completed and five partial terminal runs containing 196 findings and 187
lead-only evidence records. Every selected run has publication authority
`none`. The detailed counts and partial outcomes are recorded in
`docs/reviews/p0-live-agent-feed-execution-2026-08-22.md`.

This checkpoint proves Agent Feed ingestion and terminal run accounting. It
does not prove Rewards receipt import, canonical evidence acquisition, rule
publication, or recommendation coverage. Agent Feed's safety scanner also
currently rejects a structured Nanaco transfer claim whose benign eligibility
description uses a field named `credential`; the source claim remains partial
rather than being rewritten to bypass that boundary.

## ChatGPT monitoring

ChatGPT monitoring tasks remain useful as independent sentinels. Current Scheduled Tasks do not provide webhooks, so they are not assumed to submit automatically. A tool-capable runtime may use Agent Feed MCP/REST; otherwise a protocol-valid run bundle can be imported manually.

## v0.4.1 liveness boundary

The Rewards consumer owns `monitor_stream_expectations`, maps streams to canonical sources, and runs an overdue sweep. Agent Feed delivery guarantees cannot detect a run that was never created. A missed-run incident downgrades affected source freshness before recommendation rendering.

## Hostile findings

Security flags such as `embedded_instruction` and `attempted_authority_escalation` survive transport. Such findings are rejected or quarantined, cannot acquire canonical evidence automatically, and cannot create extraction candidates or rule links.
