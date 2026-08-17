# Implementation Plan v0.4.1

## Product objective

Build an evidence-backed deterministic service that answers:

> For this merchant, amount, date, wallet, known or unknown user state, and set of feasible acquisition/payment/conversion operations, which plan maximizes the user's selected objective, what remains afterward, and why?

The sequence is deliberately split so the conserved native ledger is proven before advanced reward calculations are layered onto it.

## Existing runnable baseline

The v0.4.1 package already contains a zero-dependency TypeScript prototype under `prototype/`. It passes tests for conservation by reward class, exact residual accounting, valuation-only rank reversal, definition hashing, review-policy enforcement, and hostile Agent Feed intake. Codex must begin by running and understanding these tests. It should migrate and extend the prototype into the preferred production monorepo rather than discard it.

## Milestone 0P — v0.4.1 preflight and prototype preservation

### Deliverables

- run all package validators and three prototype test suites;
- verify definition hashes are non-unique historical content fingerprints;
- verify conservation keys include `reward_class`;
- verify generic `adjust` is absent;
- verify required review modes are machine-enforced;
- preserve the public prototype behavior while reorganizing code;
- add regression tests before refactoring any prototype code.

### Gate

- every existing prototype test remains green;
- no known review defect is reintroduced;
- the browser prototype starts and its `/api/evaluate` endpoint returns deterministic output.

## External dependency — separate Agent Feed project

The sibling `../agent-feed` project owns the generic run/finding/evidence protocol, SDKs, adapters, MCP/REST ingress, and durable consumer delivery. This application pins protocol `0.1` and never imports Agent Feed server internals or queries its database.

Rewards Milestones 0, 1A, 1B, and 2 can proceed independently. Milestone 2.5 requires Agent Feed Milestones 0–2.

## Milestone 0 — Resolve and freeze the v0.4.1 contract

### Deliverables

- compile all eleven JSON Schemas under Draft 2020-12;
- generate TypeScript types from schemas rather than maintaining parallel handwritten contracts;
- implement one shared semantic validator from `docs/13_semantic_validation_contract.md`;
- document operation/asset graphs, reward lots, uncertainty, settlement, expiry, review modes, and residual valuation;
- validate the 140-source registry, four access observations, ten blueprints, and 100-scenario plan;
- identify any remaining contradiction and stop rather than choosing a silent interpretation;
- freeze the Agent Feed consumer boundary without implementing the external service in this codebase.

### Gate

- all examples validate structurally and semantically;
- known and estimated bound negative tests fail correctly;
- no documentation promises a field absent from the schema/semantic contracts;
- checksum verification is non-mutating.

## Milestone 1a — Conservation and reconciliation kernel

This is the scope of the initiating Codex prompt. Stop after this gate.

### Deliverables

- purchase-plan and dependency validation;
- direct merchant purchase;
- stored-value top-up and voucher acquisition followed by merchant purchase;
- asset-lot creation, partial consumption, residual quantity, settlement, expiry, and restrictions;
- explicit principal movements and external funding;
- acceptance/exclusion matching required by the synthetic fixtures;
- bitemporal rule selection;
- percentage and points-per-unit reward calculations only;
- native reward ledger and rejected reason codes;
- per-asset valuation separated from native accounting;
- reconciled merchant value, funding, opening assets consumed, ending assets, rewards, fees, net value, and objective score;
- winner, runner-up, replay serialization, and valuation break-even sensitivity.

### Mandatory synthetic proofs

1. direct card purchase;
2. card-funded top-up followed by purchase;
3. JPY 10,000 acquisition funding a smaller purchase with a conserved residual lot;
4. top-up reward attached only to the acquisition operation;
5. normal and limited-period reward classes valued differently;
6. identical plans/movements/rewards under two residual valuations;
7. winner reverses between those valuation profiles without any native-ledger mutation;
8. percentage boundary;
9. points-per-unit one below, exact, and one above denominator;
10. bitemporal start/end and replay-knowledge boundaries.

### Gate

- no binary floating-point canonical amounts;
- every reusable asset conserves exactly;
- residual value is neither discarded nor counted twice;
- every economic summary reconciles;
- valuation changes rank but never native movements, quantities, rule IDs, or reward classes;
- a pre-funded plan cannot win by omitting acquisition funding;
- property tests cover conservation, determinism, valuation isolation, and bitemporal rule selection.

## Milestone 1b — Extended calculations and uncertainty

Begin only with the explicit continuation prompt after Milestone 1a passes.

### Deliverables

- fixed, tiered, multiplier, and transfer calculations;
- transaction, user-fact, period-aggregate, and event-counter tier bases;
- transfer minimums, increments, per-request/period maxima, fees, timing, cancellation, and cycle guard;
- operation-specific and shared caps;
- known, estimated, unknown, partially remaining, and exhausted cap state;
- cap reset boundaries and partial consumption;
- stacking, included-base handling, conflict, precedence, and replacement;
- probabilistic reward separation;
- feasible-state evaluation without combining incompatible assumptions;
- definite and conditional winners, ranges, and next questions;
- refund, reversal, expiry, and clawback components;
- structured explanation tokens.

### Mandatory synthetic proofs

- fixed campaign minimum;
- all four tier bases;
- included base reward not doubled;
- excluded funding source;
- unknown campaign enrollment and cap progress;
- conditional winner and smallest useful question;
- cap partial/exhausted/reset behavior;
- transfer minimum/increment/maximum/fee and cycle guard;
- undisclosed lottery excluded from guaranteed rank;
- refund and proportional clawback.

### Gate

- caps cannot be exceeded;
- unknown state is never coerced to zero or false;
- a definite winner is returned only when stable across feasible states;
- probabilistic value never enters guaranteed value;
- transfer cycles cannot create unbounded value;
- uncertainty and cap property tests pass.

## Milestone 1S — Source-operations spike, run in parallel

### Deliverables

- terms and technical-access review for the eight-source rehearsal batch;
- manual snapshot capture as the default path;
- dated, environment-specific access observations;
- minimal snapshot, diff, evidence, and review workspace;
- prompt-injection quarantine test;
- permitted collection interfaces with all network adapters disabled by default;
- optional manual Agent Feed run-bundle intake as a discovery lead only, after the consumer contract exists.

### Gate

- unapproved automation cannot execute;
- blocked technical access cannot trigger bypass behavior;
- a reviewer can capture, hash, locate, and review evidence without direct database editing.

## Milestone 2 — Hardened Postgres/Supabase persistence

### Deliverables

- `app_private`, `app_api`, and `user_data` separation;
- immutable snapshots and append-only review decisions;
- controlled approved-rule immutability;
- full bitemporal non-overlap for approved rule versions;
- `security_invoker`/`security_barrier` controlled views with no client grants by default;
- extraction-candidate/snapshot join table;
- entities and asset definitions;
- user wallet, facts, lots, valuation, and cap state;
- permanent canonical replay separated from deletable user history;
- retention class and purge deadline;
- RLS enabled and forced for user-owned tables;
- explicit current and default privilege revocation.

### Gate

- SQL executes against an isolated PostgreSQL 15+ instance;
- a generated replay query returns at most one approved version per rule for every tested transaction/knowledge-time pair;
- the backdated-overlap reproduction in `db/tests/001_bitemporal_replay.sql` is rejected;
- invoker views do not lend migration-owner privileges;
- RLS tests prove denial before policies and user isolation after deployment policies;
- approved definitions cannot be altered in place;
- user deletion and retention purge cover derived recommendation history.


## Milestone 2.5 — Agent Feed consumer integration

Begin only after Rewards Milestone 2 and Agent Feed Milestones 0–2 pass.

### Deliverables

- pin Agent Feed protocol `0.1` through its published schema artifact;
- implement `packages/agent-feed-consumer` without importing Agent Feed server internals;
- expose a signed internal event endpoint and verify timestamp/signature;
- persist an idempotent transport receipt before acknowledgement;
- map supported generic findings into `SourceObservation`;
- compute a separate reward-domain semantic fingerprint;
- stage submitted evidence as untrusted/lead-only until canonical capture and promotion;
- handle completed, zero-finding, partial, failed, replayed, and missing expected runs;
- register consumer-owned cadence/grace per stream and map streams to affected sources;
- raise overdue-run incidents and downgrade mapped source freshness;
- expose dead-letter/replay diagnostics;
- keep all delivery independent of Supabase Realtime.

The schema prerequisite is complete: `@agent-feed/schema@0.1.1` is pinned by
release URL and SHA-512 integrity in
`packages/agent-feed-consumer/protocol-lock.json`. This does not by itself mark
the remaining Milestone 2.5 consumer implementation complete.

### Gate

- duplicate events create one receipt and at most one observation;
- transport identity and semantic dedupe are tested separately;
- unknown finding types cannot create generic reward rules;
- agent confidence cannot become source authority;
- submitted evidence cannot become `EvidenceRecord` without the app's permission, capture, hash, locator, and review workflow;
- consumer downtime is recoverable through Agent Feed replay;
- a stream that stops producing is detected within its cadence plus grace window;
- completed zero-finding and absent-run states remain distinct;
- no direct database credential or query crosses the project boundary.

## Milestone 3 — First ten real evidence-backed scenarios

Research `examples/ten-seed-scenario-blueprints.yaml` in architecture-risk order.

Per scenario:

1. freeze operation facts, assets, user state, transaction time, and replay-knowledge time;
2. capture first-party sources using an approved/manual method;
3. create atomic evidence;
4. encode applicable and exclusion rules;
5. calculate every candidate plan independently before viewing engine output;
6. preserve residual assets, posting, expiry, restrictions, and clawbacks;
7. record negative assertions and runner-up/conditional plans;
8. perform the required review mode;
9. promote only when the gate is honest;
10. replay in CI.

### Review modes selected now

- `JP-XFR-002`: `human_second_review` is mandatory.
- The other nine seed scenarios: `solo_dual_pass` followed by an `agent_challenged` discrepancy pass.
- Escalate to human/expert review when source ambiguity, irreversible transfer loss, material spend commitment, or inability to reproduce the result is present.

### Gate

- no merchant-specific engine branches;
- every expected unit reconciles;
- every top-up/transfer plan conserves assets;
- solo-reviewed fixtures are labeled solo-reviewed;
- the transfer scenario has a different accountable human reviewer.

## Milestone 4 — Two-lane data-maintenance rehearsal

Run `docs/12_source_maintenance_rehearsal.md` across the same eight-source cohort.

### Lane A — direct source operations

Use approved/manual capture, technical-access observations, hashes, diffs, and evidence review.

### Lane B — semantic monitoring through Agent Feed

Use external ChatGPT/Claude/API/custom monitors to submit generic findings through the separate Agent Feed service. The app maps them to `SourceObservation` and acquires canonical evidence independently.

Measure:

- confirmed material-change recall;
- median detection delay;
- false positives and duplicates;
- official-source hit rate;
- review minutes per useful change;
- manual/rendered/partner-path percentage;
- monitor/API cost per confirmed change;
- partial/failed run visibility;
- changed-winner rate;
- incidents found by an independent ChatGPT sentinel but missed by production monitors.

### Decision gate

Choose the least complex sustainable mix:

- semantic monitor plus manual canonical capture;
- stable direct checks plus semantic discovery;
- reduced merchant/program breadth;
- weekly rather than near-real-time freshness;
- partner/licensed data;
- personal fixed-wallet scope before commercial expansion.

Do not build a source-specific scraper merely because one semantic-monitor query missed a change; compare repeatability, terms, and maintenance cost first.

## Milestone 5 — Recommendation API and internal beta

### Deliverables

- merchant/branch resolution;
- wallet, facts, opening assets, per-asset valuation profile, frozen comparison facts, objective, and candidate-plan input;
- deterministic evaluation endpoint;
- definite/conditional result, safe plan, runner-up, principal movements, rewards, ending assets, reconciled economics, assumptions, questions, freshness, and evidence references;
- residual-valuation break-even sensitivities;
- redacted short-retention history;
- authorized canonical replay only.

### Gate

- identical versioned inputs produce identical structured outputs;
- stale or unresolved high-risk rules cannot appear verified;
- prohibited credentials are rejected and absent from logs;
- sensitivity explanations reconcile to the same native ledger.

## Milestone 6 — Narrow consumer alpha

Initial scope:

- Tokyo;
- major convenience-store chains;
- a small set of widely owned cards, QR wallets, stored-value systems, and common points;
- manual user state and cap entry;
- asset-specific stored-value usage question during onboarding;
- one recommendation, one fallback, and visible conditional/sensitivity explanation;
- official-app deep links;
- correction reporting.

The alpha does not wait for all 100 fixtures. It requires complete scenario and evidence coverage only for features actually exposed.

## Milestone 7 — Continuous 100-scenario challenge track

Maintain exactly 40 single-rule, 40 stacking, and 20 adversarial scenarios as an ongoing quality workstream.

| Scenario | Initial working range |
|---|---:|
| Simple first-party base rule | 1–3 hours |
| Merchant/interface/funding interaction | 3–6 hours |
| Multi-source campaign stack | 0.5–1 working day |
| Transfer or adversarial historical case | 1–2 working days |

Replace these assumptions with observed throughput after the first ten.

## Later milestones

- full data-operations console;
- mobile static loyalty wallet with local encryption;
- campaign reminders and cap tracking;
- online cashback/share extension;
- broader point/mile/hotel conversion graph;
- partner-based transaction aggregation;
- retrospective reward-regret analysis;
- transparent best-new-card ranking.

Each expansion requires feature-specific evidence coverage, privacy controls, and measured operational capacity.
