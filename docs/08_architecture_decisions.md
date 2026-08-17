# Architecture Decisions v0.4.1

## ADR-001 — Evidence is a first-class object

Source snapshots and evidence records exist independently from rules so pages can change without destroying audit history.

## ADR-002 — Deterministic canonical engine

Eligibility, asset flows, arithmetic, stacking, caps, uncertainty, and ranking are deterministic code. LLMs are restricted to extraction assistance and post-result wording.

## ADR-003 — Bitemporal rule versions

Economic validity and system-record validity are separate.

## ADR-004 — Native asset ledger before valuation

Points, miles, balances, discounts, fees, pending rewards, and reversals remain separate before user valuation.

## ADR-005 — Integer/decimal arithmetic only

JPY uses integer yen; rates and reward units use scaled integers or arbitrary-precision decimals.

## ADR-006 — Structural schema plus canonical semantic validation

JSON Schema Draft 2020-12 defines portable structure, enums, formats, and lexical number representation. `docs/13_semantic_validation_contract.md` defines sibling comparisons, graph rules, conservation, reconciliation, and temporal uniqueness that portable JSON Schema cannot express. Types are generated from schemas; all inputs pass both layers before calculation or persistence.

## ADR-007 — Merchant chain and location are separate

Chain evidence does not silently become branch certainty.

## ADR-008 — Permission is separate from authority

An authoritative public page may restrict automated retrieval, storage, or reuse.

## ADR-009 — Monorepo foundation

Contracts, engine, fixtures, API, workers, and admin tooling evolve together in a TypeScript monorepo.

## ADR-010 — Postgres/Supabase for structured state

Relational evidence, rules, review, assets, user state, and replay belong in Postgres; long-running retrieval stays in workers.

## ADR-011 — No live scraping in the first Codex slice

Implement interfaces, manual ingestion, permission gates, and fixtures first.

## ADR-012 — Source-specific adapters, common snapshot contract

Approved adapters can differ, but all emit one immutable snapshot contract.

## ADR-013 — Commercial rank separation

Sponsorship cannot alter organic calculation.

## ADR-014 — Operation-and-asset plan replaces flat recipe

A candidate is an ordered set of top-up, voucher, purchase, transfer, redemption, refund, reversal, and portal operations.

## ADR-015 — Asset lots represent reward class and residual value

Normal and limited points, stored value, vouchers, pending rewards, and expiry are asset lots rather than bare currency strings.

## ADR-016 — Unknown state is a result dimension

The engine returns definite and conditional winners, feasible ranges, and useful questions instead of assuming favorable or zero state.

## ADR-017 — Technical reachability is observational

Reachability is dated and environment-specific. Conflicting observations are retained rather than collapsed into false certainty.

## ADR-018 — Review mode must be honest

Solo dual-pass is supported and labeled. Agent challenge does not count as a second human. High-loss rules can require human or expert review.

## ADR-019 — Private/internal and user data are separated

Internal evidence/rules remain outside exposed schemas. User data has RLS, retention, deletion, and no permanent raw request audit by default.

## ADR-020 — Probabilistic reward is not guaranteed value

Lottery and selection campaigns remain separate from guaranteed value.

## ADR-021 — Manual capture is an early path, not the permanent assumption

Initial blocked sources may require manual capture. Long-term coverage should prefer licensed feeds, official APIs, or permitted collection.

## ADR-022 — Candidate plans cannot contain expected outcomes

Candidate plans provide operations, principal inputs, requested outputs, dependencies, and assumptions. Rewards, actual movements, ending lots, economics, and winners are engine outputs.

## ADR-023 — Ranking uses reconciled net economic value

A route cannot win by omitting acquisition funding or treating residual balance as a reward.

## ADR-024 — Approved versions occupy non-overlapping bitemporal rectangles

For each rule, no two approved versions may overlap in both economic and system time. This guarantees at most one match per `(transaction_time, replay_knowledge_time)` pair, including backdated corrections.

## ADR-025 — `app_api` views fail closed with invoker semantics

Views use `security_invoker` and `security_barrier`. A view grant alone does not lend migration-owner privileges. Deployment access requires deliberate underlying server-role privileges or a reviewed RPC.

## ADR-026 — Conservation core precedes calculation breadth

Milestone 1A proves operations, lots, residuals, percentage/points-per-unit rewards, valuation isolation, reconciliation, and replay uniqueness. Milestone 1B adds the remaining calculations and uncertainty only after 1A passes.

## ADR-027 — Residual valuation is per asset and sensitivity is visible

Stored-value assets are not assigned one global discount. Product onboarding records asset-specific use assumptions; recommendation explanations derive the break-even valuation that changes the winner when material.

## ADR-028 — Commercial-capable architecture, internal alpha first

The initial validation target is a personal/internal Tokyo convenience-store alpha. Commercial ranking, sponsorship, and affiliate behavior remain disabled until source-maintenance and legal gates pass.


## ADR-029 — Agent Feed is a separate project and deployable

Generic agent run/finding/evidence transport lives in `../agent-feed`. The Rewards Optimizer consumes a pinned protocol and signed events, not Agent Feed tables or server internals.

## ADR-030 — Generic finding is not a domain fact

A finding records a producer claim. It maps to `SourceObservation`, never directly to `RewardRuleVersion`.

## ADR-031 — Submitted evidence and canonical evidence are separate

Agent Feed retains producer-supplied material. The Rewards Optimizer independently decides whether to reject, recapture, or promote it under its own authority, permission, hash, locator, and review policy.

## ADR-032 — Transport and semantic dedupe are separate

Agent Feed event/idempotency keys prevent transport duplication. The Rewards Optimizer computes its own semantic change fingerprint because multiple agents or sources may report the same material change.

## ADR-033 — Durable delivery uses outbox/queue and signed events

Cross-project delivery is at-least-once and consumer-idempotent. Supabase Realtime is optional for live UI and is never a durable job or event-delivery dependency.

## ADR-034 — ChatGPT Scheduled Tasks are capability-gated sentinels

Monitoring tasks may independently alert the owner and remember prior runs, but current Scheduled Tasks do not provide webhooks. Automated Agent Feed submission requires a verified tool-capable runtime or a separate API worker; otherwise use manual run-bundle import.

## ADR-035 — Separate production Supabase projects

The recommended production deployment gives Agent Feed and the Rewards Optimizer separate Supabase projects and credentials. A same-machine or same-Postgres prototype is allowed only when all integration tests still cross the public protocol boundary.
