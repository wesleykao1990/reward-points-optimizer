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

Implementation status (2026-08-18): dependency gates passed and the deliverables below are implemented in the pinned `schema-v0.1.1` consumer, additive 0004 migration, and 007 adversarial SQL suite.

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

Implementation checkpoint (2026-08-19): the pure consumer contracts and a
localhost-only synthetic UI have independent **GO** verdicts. This checkpoint
is intentionally narrower than the real alpha: it exposes one synthetic Tokyo
branch, a direct card route, and an optional stored-value top-up route. It has
no current reward data, official external app link, QR candidate route,
authentication, persistence, or deployment. The real-data/production gate
remains blocked by the incomplete M4 operational rehearsal and evidence work.

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

### 2026-08-19 infrastructure checkpoint

The deterministic M7 control plane is implemented and independently verified.
It strictly admits the canonical 100-target plan, isolates `SYN-M7-*` probes
from evidence/golden lifecycle states, preflights complete batches before any
evaluator call, and produces an honest stable progress report. The current
report is 100 declared/planned, 0 executed, 0 evidence-backed, and 0 golden.
This is an infrastructure checkpoint only; M3 evidence promotion and M4
operational readiness remain blocked.

## Interim Milestone 7P — P0 provisional Agent Feed rehearsal

Implementation checkpoint (2026-08-21): **GO for one private experimental
family-role rehearsal; P0 coverage, publication, and production remain
incomplete.** This lane was prioritized before Milestone 8 so the prototype can
exercise correction-driven provisional data without weakening the canonical
evidence and review gates.

Implemented scope:

- admit an untrusted Agent Feed `SourceObservation` only after hostile-value,
  shared-contract, source, family-role, and authority checks;
- keep semantic source role `(family_id, source_role_id)` separate from source
  authority (`primary`, `corroborating`, or `conflict`);
- allow only primary-authority, draft/under-review candidates into the private
  `active_experimental` selection view;
- persist immutable candidate, transition, and correction records in private
  PostgreSQL tables with owner-only security-definer adapters;
- remove disputed or quarantined candidates from experimental selection; and
- seed one exact, evidence-backed Seven-Eleven credit-card acceptance candidate
  from a local run bundle for repeatable prototype development.

The seeded receipt is explicitly unsigned/unverified, submitted evidence stays
`lead_only`, and the rule is neither approved nor published. No provisional
rule is exposed through the approved-rule API or the consumer frontend.

Before this lane can scale across P0, add authorized producer runs for each
explicit family-role, deterministic semantic support checks between evidence
and extracted economics, extractor authenticity, and operational correction
triage. Do not infer missing rates, products, campaigns, or source
relationships. Unknown-world `CoverageCandidate` discovery remains a separate
future milestone.

### Interim Milestone 7P.1 — P0 source-operations alpha

Implementation checkpoint (2026-08-21): the Rewards-owned P0 planning universe
is now an exact, hash-bound control-plane input: 44 source families, 19 Agent
Feed streams, and 301 required `(family_id, source_role_id)` slots. PostgreSQL
stores the same one-way sealed plan and a separate operational state for every
role. Exact counts are verified before sealing, after which append, update,
delete, and truncate operations fail closed.

Readiness is fail-closed across producer authorization, collection permission,
technical acquisition, stream liveness, canonical evidence or an explicit
conservative exclusion, and source-to-rule impact mapping. A planning status of
`covered` never satisfies any of those gates. The existing local Seven-Eleven
rehearsal remains the sole `experimental_eligible` role and is still blocked by
unverified producer provenance, unreviewed permission, unknown acquisition,
missing liveness, lead-only evidence, and unmapped impact. Consequently the
checkpoint reports zero ready roles and zero supported families.

This milestone copies no representative planning URLs, creates no selectable
products or economic rules, and exposes no public API or frontend data. The
next P0 data step is an authorized producer run plus evidence-acquisition pack
for one explicit family-role slice, followed by semantic-support and extractor
authenticity checks before broader provisional activation.

### Interim Milestone 7P.2 — Atomic provisional catalogue alpha

The experimental lane can now accept a bounded batch of 1–32 candidate
admission requests. It snapshots hostile inputs, admits and primary-authority
activates every member before the first in-process mutation, binds the sealed
P0 plan hash, rejects duplicate identities, and emits a deterministic batch
hash. Exact replay is idempotent only while the published versions remain
active; a correction cannot be replayed to resurrect a disputed candidate.

PostgreSQL stores the trusted adapter's exact batch projection in an immutable
private ledger. The adapter preflights the entire payload, requires every
family-role to be explicitly `experimental_eligible` in the sealed plan,
locks candidate hashes in deterministic order, and commits the batch and its
lifecycle changes in one statement transaction. The active batch view joins
the existing correction-sensitive provisional view, so disputed or
quarantined versions disappear without mutating batch history. The database
continues to trust the TypeScript adapter for canonical hash recomputation and
does not grant a canonical rule-publication capability.

The Japanese localhost prototype exposes the exact checked-in Seven-Eleven
payment-acceptance candidate in a separate `先行公開データ` catalogue. It is
clearly labeled machine-checked and provisional, is not used by the synthetic
optimizer, and exposes no raw rule, evidence body, or source URL. A bounded
browser correction identifies only the host-issued publication and category;
the host supplies the candidate hash, credibility, severity, timestamp, and
signal ID, then immediately disputes and removes the exact version.

This is bulk-capable infrastructure, not bulk data acquisition: the repository
still contains only one source-bound experimentally eligible candidate. Adding
more visible records requires truthful Agent Feed runs and exact candidate
packages for named P0 roles. Missing rates, products, campaigns, merchant
relationships, and branch mappings must not be inferred.

### Interim Milestone 7P.3 — Bounded P0 payment-family source run

Implementation checkpoint (2026-08-21): one operator-authorized, bounded
manual source check of the registered first-party Seven-Eleven payment-methods
page is encoded as an Agent Feed protocol `0.1` run bundle and accepted by both
the pinned Rewards consumer and the current Agent Feed local-file validator.
The run carries one source-bound finding whose exact structured claim is the
same 11-family payment-acceptance set already represented by reviewed evidence.

The provisional admission boundary now binds every payment-acceptance rule to
an explicit singular or plural payment-family claim in its SourceObservation.
An invented or mismatched family fails the entire batch before mutation. The
admitted 11-member batch is generated deterministically, persisted by seed
`004_p0_payment_acceptance_batch.sql`, and exposed by the Japanese prototype as
11 separately correctable provisional entries. Each correction disputes only
the exact selected version.

This expands payment acceptance only. It creates no reward earning rate,
campaign, transfer ratio, card/product SKU, branch exception, canonical
`RewardRuleVersion`, or production recommendation. The run is a local-file
import with `signature_verified=false`; its submitted evidence remains
`lead_only`. The sealed 44-family/301-role readiness snapshot is unchanged and
still must be superseded by a reviewed operational snapshot when broader
authorized producers and liveness are available.

### Interim Milestone 7P.4 — P0 Scheduled Task scale experiment

Implementation checkpoint (2026-08-21): the first ChatGPT Scheduled Task was
run twice against eight P0 streams and 64 family-role targets. Both occurrences
closed every begun run honestly as `partial`; the first verified 44 roles and
the second verified 43. A focused exact-shape probe delivered one
`coverage_candidate` and lead-only evidence record, while malformed broad-run
submissions created no accepted rows or canonical rules. All claimed Run IDs,
terminal statuses, diagnostics, and row counts were reconciled in Agent Feed's
PostgreSQL ledger.

This proves ChatGPT can be a bounded Agent Feed research producer, but it is
not yet a stable bulk scheduler. None of the 19 P0 streams currently has a
matching Agent Feed stream expectation, schedule version, expected occurrence,
job definition, or deployment binding. The 64-target work unit is also too
large: live source discovery varied between occurrences and exact payload
construction repeatedly failed at an imprecise schema root.

Across both occurrences, 34 of 64 roles were found consistently, 19 were found
in only one occurrence, and 11 were not found in either. A focused official-
site check found representative public material for all 11 missing categories,
so `unresolved` currently means “not established by this run,” not “the
information is not public.” Agent Feed must add structured target-attempt
outcomes and reviewed negative-evidence semantics before absence can be
reported.

Before enabling task definitions P0.2 through P0.6, register generic jobs,
deployments, cadences, and expected occurrences; reduce work to stream-sized
resumable slices; persist target-level checkpoints; add a producer-side exact-
schema preflight with precise JSON Pointers; add scheduler-provider dispatch
reconciliation, per-target source-attempt provenance, and bounded
backpressure; and require database receipt reconciliation. These generic
control-plane changes are required before expanding from 44 P0 families to the
cumulative 223 P0–P2 families and eventual 95 streams. The longer-term primary
scheduler should be a durable API/workflow producer using the same Agent Feed
protocol, with ChatGPT retained as a replaceable research producer or sentinel.
Full evidence, result analysis, Agent Feed changes, and acceptance gates are
documented in
`docs/reviews/p0-chatgpt-agent-feed-scale-experiment-2026-08-21.md`.

### Interim Milestone 7P.5 — Direct-source locator recovery

Implementation checkpoint (2026-08-21): the 11 family-role targets missed by
both Scheduled Task occurrences were retried without Agent Feed. The bounded
resolver reused exact or related trusted-source catalogue entries, searched
only official provider domains and indexes, performed direct public HTTP GETs,
and verified a role-specific marker. All 11 returned HTTP 200 and yielded an
official locator, bringing cumulative locator discovery for the eight-family
slice to 64/64.

The result is preserved as the lead-only planning artifact
`registry/planning/p0-direct-source-recovery.2026-08-21.v0.1.json`. It creates
no canonical evidence or economic rule: only two locators were exact existing
registered sources, while the others still require exact-mapping or source-
addition review, permission/access review, canonical capture, hashing, and
source-role completeness review.

This direct resolver is an acceptable P0 bootstrap while Agent Feed liveness
and target accounting are incomplete. It must operate on bounded unresolved
targets, carry forward prior successes, and never publish from a page locator
alone. Approved locators can later become Agent Feed monitoring inputs.

### Interim Milestone 7P.6 — Resumable P0.1 coverage and connector repair

Implementation checkpoint (2026-08-21): a locator-first Scheduled Task
occurrence reached 62/64 roles, and bounded recovery run
`f85e00cf-8b8c-4de5-a617-c673079a7eec` checked the remaining two nanaco roles.
The exact cumulative P0.1 role set is now receipt-backed 64/64 in
`registry/planning/p0-agent-feed-role-coverage.2026-08-21.v0.1.json`. This is
locator/role-marker coverage only; it creates no canonical evidence or rule.

The deterministic task pack now limits an occurrence to one family/stream,
carries forward successful role outcomes, retries only unresolved or stale
keys, separates locator and economic-claim phases, bounds economic batches to
five source-bound claims, and fails closed when the connector does not expose
the full `submit_batch` request.

Agent Feed PR #16 merged the semantically equivalent non-union schema repair
and MCP discovery regression at commit
`d232aac75c3a5e5a2d36c2af71464f4f13ac4713`; all hosted checks passed. The
running ChatGPT connector still exposes the stale alternative
`{findings}`/`{evidence}` signature, however. The local tunnel was stopped and
its checkout/setup refreshed, but local PostgreSQL restart is blocked by a
missing Docker Compose plugin and a loopback port-forward failure. The tunnel
must be restored, the ChatGPT connection rediscovered, and the live nine-root
tool declaration verified before retrying economic ingestion. The Rewards
database already contains five verified M3 economic evidence records, one
verified payment-acceptance record, and six under-review rule versions; the
current blocker is new live Agent Feed ingestion, not an empty evidence store.

### Interim Milestone 7P.7 — Atomic intake and exact nanaco economic pilot

Rewards now supplies a PostgreSQL implementation of the Agent Feed consumer's
atomic persistence port. One verified event is persisted with its receipt,
mapped observation or submitted-evidence lead, and lifecycle effect in a single
transaction; a downstream failure rolls the receipt back with the rest. The
private adapter has no canonical-evidence, rule-publication, or public API
capability.

The economic pilot is deliberately narrower than a generic extractor. A
deterministic generator copies the exact already-reviewed
`rr_jp_cvs_006_nanaco_purchase_reward` rule projection and binds it to
`point.nanaco / earn_rules` and the registered primary source. Its definition
hash is fixed, its lifecycle remains `under_review`, and it carries no human
review or publication claim. Agent Feed narrative text cannot alter that
template, and missing evidence remains `needs_evidence`; activation is explicit
and primary-authority-only.

The PostgreSQL host owns the in-process provisional store and asynchronous
evidence verifier; callers receive only the nanaco pilot's admit/activate
surface. Before activation, one fixed query proves the observation is
canonical-reviewed, follows its distinct Agent Feed lead through promoted
evidence work to a verified EvidenceRecord and content-verified source, and
binds that evidence to rule version 1 with the exact definition hash. Store,
verifier, rule identity, and database target are not accepted from an
untrusted request or browser DTO.

This checkpoint does not prove a live signed delivery, does not populate the
database with a new canonical economic rule, and does not turn the current
lead-only source material into economic truth. The next operational step is to
restore the Agent Feed connector, verify its deployed schema, submit one bounded
nanaco finding, and reconcile its receipt and observation before considering a
larger P0 economic batch.

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
