# Changelog

## 0.4.1 — 2026-08-17

- Applied the pre-implementation review fixes and added runnable prototype code.
- Removed historical uniqueness from definition hashes and added publication idempotency.
- Conserved assets by asset plus reward class and removed generic adjust movements.
- Added required review modes/events, monitoring liveness, hostile Agent Feed regression, receipt redaction, and observation transition controls.


## 0.4.0 — 2026-08-17

- Moved generic agent monitoring transport into the separate sibling `agent-feed` project.
- Added Agent Feed protocol `0.1` consumer boundary and app-specific `SourceObservation` contract.
- Added transport receipt, semantic dedupe, submitted-evidence staging, and no-direct-rule-publication reference migration.
- Added an app-side Agent Feed integration Codex prompt.
- Converted the 30-day maintenance rehearsal into direct-check versus semantic-monitor lanes.
- Documented the Supabase stack and made Realtime optional UX only.
- Added capability-gated ChatGPT monitoring: independent sentinel or run-bundle fallback where outbound tools are unavailable.

## 0.3.0 — 2026-08-17

Convergence revision after independent review of v0.2.

### Fixed

- Replaced current-only approved-interval protection with full bitemporal rectangle exclusion across economic and system time.
- Made `app_api` views `security_invoker` and `security_barrier` so a grant cannot silently lend migration-owner privileges.
- Declared and implemented canonical semantic validation for cross-field user-state and cap ranges.
- Corrected the probabilistic certainty conditional so `probability_source` is non-null when required.
- Reclassified the View Card source as environment-dependent/mixed and retained both the manual-browser 200 and datacenter 403 observations.

### Added

- `docs/13_semantic_validation_contract.md`.
- A second synthetic valuation fixture proving winner reversal with an unchanged native ledger.
- Full replay-ambiguity acceptance/property requirements.
- Residual-value break-even sensitivity as a Milestone 1B/product requirement.
- Explicit first-ten review-mode policy and personal/internal-alpha scope.
- Separate Codex prompts for Milestone 1A and Milestone 1B.

### Changed

- Split the engine foundation into 1A conservation/reconciliation and 1B calculation/uncertainty expansion.
- The initiating Codex run stops after percentage and points-per-unit conservation proofs.
- ADR-006 now names JSON Schema and the semantic-validation contract as complementary canonical layers.

## 0.2.0 — 2026-08-17

Breaking revision after the first independent review.

- Replaced flat recipes with operation-and-asset plans.
- Added residual asset lots, reward classes, settlement, expiry, restrictions, uncertainty, certainty, refunds, and clawbacks.
- Added source access observations and a maintenance rehearsal.
- Hardened schema separation, RLS, retention, immutability, interval integrity, and foreign-key relationships.
- Moved broad scenario expansion behind an operational feasibility gate.

## 0.1.0 — 2026-08-17

Initial evidence-first foundation package.
