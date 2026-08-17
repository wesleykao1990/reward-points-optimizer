# Codex Execution Contract v0.3

## First run: Milestone 0 + Milestone 1a only

The initiating prompt implements the conserved ledger kernel and stops. Advanced calculation and uncertainty work belongs to the explicit Milestone 1b continuation prompt.

## Required behavior

- read `docs/11_review_decisions_v0.3.md`, `docs/13_semantic_validation_contract.md`, and `docs/14_residual_valuation_and_sensitivity.md` before scaffolding;
- treat JSON Schema as canonical for structure and the semantic contract as canonical for cross-field invariants;
- stop and report any new contract-affecting contradiction;
- keep current economic facts out of source code;
- use synthetic fixtures only;
- implement operation plans, asset conservation, residual accounting, and reconciliation before advanced calculations;
- preserve reason codes and bitemporal replay;
- prove the valuation flip without native-ledger mutation;
- run tests after each primitive;
- stop after Milestone 1a.

## Forbidden behavior

- no live or scheduled scraping;
- no bypass of terms or technical controls;
- no invented rates, dates, acceptance, or expected real scenarios;
- no LLM calculation or canonical ranking;
- no flat-recipe fallback;
- no residual disappearance or double counting;
- no probabilistic reward in guaranteed value;
- no schema weakening to silence tests;
- no permanent raw user request audit;
- no partial implementation of Milestone 1b in the first run.

## Required first-run tests

- schema and semantic validation;
- direct purchase;
- top-up/voucher acquisition followed by purchase;
- asset conservation and residual balance;
- top-up reward non-duplication;
- percentage and points-per-unit boundaries;
- normal versus limited reward class;
- identical native ledger under two valuation profiles;
- winner reversal and break-even threshold;
- bitemporal rule selection and replay uniqueness;
- approved bitemporal overlap rejected by PostgreSQL;
- invoker-secured API views do not lend migration-owner privileges;
- deterministic replay.

## Completion report

Return architecture, changed files, validator design, commands/results, tests, SQL status, security controls, limitations, and whether the Milestone 1b continuation gate is satisfied.
