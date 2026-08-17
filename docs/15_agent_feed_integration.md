# Agent Feed integration contract

## External project

Agent Feed is a separate project, implemented and deployed from the sibling project `../agent-feed`. The Rewards Optimizer pins protocol `0.1` and consumes only its published schema package and signed delivery contract.

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

## ChatGPT monitoring

ChatGPT monitoring tasks remain useful as independent sentinels. Current Scheduled Tasks do not provide webhooks, so they are not assumed to submit automatically. A tool-capable runtime may use Agent Feed MCP/REST; otherwise a protocol-valid run bundle can be imported manually.

## v0.4.1 liveness boundary

The Rewards consumer owns `monitor_stream_expectations`, maps streams to canonical sources, and runs an overdue sweep. Agent Feed delivery guarantees cannot detect a run that was never created. A missed-run incident downgrades affected source freshness before recommendation rendering.

## Hostile findings

Security flags such as `embedded_instruction` and `attempted_authority_escalation` survive transport. Such findings are rejected or quarantined, cannot acquire canonical evidence automatically, and cannot create extraction candidates or rule links.
