# Codex prompt — Rewards Optimizer Agent Feed integration

Use this prompt only after:

- Rewards Optimizer Milestones 0, 1A, 1B, and 2 pass;
- the separate sibling `../agent-feed` project has protocol `0.1`, REST ingress, and durable delivery available.

Implement Milestone 2.5 in this project only.

Read `docs/15_agent_feed_integration.md`, `docs/16_supabase_stack_decision.md`, `docs/17_monitoring_producer_contract.md`, `schemas/source-observation.schema.json`, `db/0002_agent_feed_consumer.sql`, and the sibling Agent Feed protocol/trust documents.

Required implementation:

- `packages/agent-feed-consumer`;
- signed event verification and stale-timestamp rejection;
- Agent Feed schema validation using a pinned published protocol artifact;
- idempotent event receipt before acknowledgement;
- supported finding-type routing;
- mapping to `SourceObservation`;
- domain semantic fingerprinting separate from transport IDs;
- submitted-evidence staging and explicit promotion states;
- replay, failure, and dead-letter diagnostics;
- tests for duplicates, partial/failed runs, unknown finding types, malicious attributes, and evidence lead-only behavior.

Non-negotiable boundaries:

- do not implement Agent Feed server code here;
- do not query the Agent Feed database;
- do not use Realtime for delivery;
- do not let a finding or agent confidence create/approve a RewardRuleVersion;
- do not promote submitted evidence without the Rewards authority/permission/capture workflow.

Stop when the integration gate passes. Do not start broad live monitoring or the mobile UI.


Additional v0.4.1 gates:

- register consumer-owned expected cadence and grace per stream;
- create overdue-run incidents and stale source-freshness overrides;
- distinguish completed zero-findings from no owed run received;
- enforce receipt redaction before mapped/duplicate terminal processing;
- enforce one-way SourceObservation transitions;
- pass the hostile run-bundle fixture with rejected observation and no canonical evidence.
