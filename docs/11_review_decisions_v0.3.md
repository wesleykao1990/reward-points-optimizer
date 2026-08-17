# Review Decisions for Foundation v0.3

Reviewed input: `docs/reviews/agent-review-v0.2-2026-08-17.md`.

This document is the authoritative disposition of the v0.2 implementation review. The original review is retained unchanged. A later agent must follow this document, the schemas, and `docs/13_semantic_validation_contract.md` rather than rediscovering or silently resolving the same issues.

## Decision summary

| Review item | Decision | v0.3 implementation |
|---|---|---|
| Historical replay can match two rule versions | **Accept — blocking** | Replace the current-state-only GiST exclusion with a three-column bitemporal exclusion over rule ID, economic range, and system-record range. Add replay uniqueness to the database and property-test gates. |
| `app_api` views use migration-owner privileges by default | **Accept** | Define both views with `security_invoker = true` and `security_barrier = true`. Install no client grants. Future access must use a reviewed backend role or RPC. |
| JSON Schema is looser than SQL for ordered/equal bounds | **Accept with a different implementation** | JSON Schema remains canonical for structure and lexical types. Cross-property comparisons that Draft 2020-12 cannot express are canonical in `docs/13_semantic_validation_contract.md` and implemented by one shared semantic validator plus database checks. |
| View Card source was marked plainly reachable despite a 403 elsewhere | **Accept** | Preserve both observations, label the source `environment_dependent_or_mixed`, identify the environments, and keep automation disabled. No observation grants permission or authorizes bypass. |
| Probabilistic certainty condition was a no-op | **Accept** | Probabilistic rewards now require a non-null probability source. Disclosed or historically estimated probability sources also require a probability value. |
| Milestone 1 is too broad for one foundation slice | **Accept** | Split the engine into Milestone 1a (conservation/reconciliation with percentage and points-per-unit) and Milestone 1b (remaining calculations, caps, uncertainty, transfers, probabilistic results, refunds, and questions). |
| Valuation flip exists only in prose | **Accept** | Add a second golden synthetic fixture with identical plans, movements, rewards, and residual quantity but a different residual valuation that reverses the winner. |
| Residual valuation dominates top-up-route ranking | **Accept** | Add per-asset valuation assumptions, onboarding guidance, and break-even sensitivity output. Never use one global stored-value discount. |
| First-ten review mode remains unspecified | **Resolve now** | Default to `solo_dual_pass` plus `agent_challenged` for nine seed scenarios. `JP-XFR-002` requires `human_second_review`; any scenario escalates when the source is ambiguous or the rule is classified high-loss. |
| Personal versus commercial product remains open | **Defer deliberately** | Keep the narrow Tokyo convenience-store alpha and use the 30-day maintenance rehearsal as the decision gate. Do not assume affiliate/commercial breadth before operational viability is measured. |

## 1. Bitemporal replay uniqueness

The invariant is:

> For a given `rule_id`, transaction time, and replay-knowledge time, at most one approved rule version may match.

The SQL exclusion must reject two approved rows only when all three dimensions conflict simultaneously:

1. the same rule ID;
2. overlapping economic validity;
3. overlapping system-record validity.

This is stronger and more accurate than preventing overlap only among rows whose `superseded_at` is null. Backdated corrections are valid only when their system interval begins at or after the prior version's system interval closes.

Implementation locations:

- `db/0001_core_schema.sql`
- `db/tests/001_bitemporal_replay.sql`
- `tests/acceptance-criteria.md`
- `prompts/CODEX_INITIATING_PROMPT.md`

## 2. `app_api` view security

v0.3 chooses **security-invoker views**, not migration-owner/definer views.

Consequences:

- granting a view does not lend the migration owner's privileges;
- the querying role must already have the permitted underlying access, or the application must expose a reviewed RPC/backend method;
- `anon` and `authenticated` receive no grants in the foundation migration;
- `app_api` is not evidence that browser clients may query internal tables directly;
- the view column list and predicate remain useful, but are not the sole security boundary.

`security_barrier = true` is also enabled so predicates are not casually reordered around user-supplied expressions.

## 3. Structural and semantic contracts

ADR-006 is refined rather than abandoned:

- JSON Schema is the source of truth for document shape, required fields, discriminators, lexical types, enums, and references;
- `docs/13_semantic_validation_contract.md` is the source of truth for cross-property invariants that standard Draft 2020-12 cannot express;
- the TypeScript implementation must expose one reusable semantic validator used by API input, fixtures, ingestion candidates, and tests;
- persisted data remains protected by SQL constraints where PostgreSQL can express the invariant;
- a schema-valid but semantic-invalid document is rejected before calculation or persistence.

The three review examples are explicitly tested:

- known cap progress with unequal lower/upper values is rejected;
- any cap lower bound above its upper bound is rejected;
- an estimated user fact with a lower bound above its upper bound is rejected.

## 4. Source reachability

`jp.viewcard.suica-charge` has two environment-specific observations:

- a manual-browser verification that reached and reviewed the official page;
- an independent plain-HTTP datacenter probe that returned 403.

The derived classification is `environment_dependent_or_mixed`. This is not a contradiction and does not imply that browser automation is permitted. Manual capture remains the approved early path until source-specific terms and method review are complete.

## 5. Milestone split

### Milestone 1a — conservation and reconciliation kernel

Implement only:

- operation/dependency validation;
- direct merchant purchase;
- stored-value top-up and voucher acquisition followed by purchase;
- principal asset creation, consumption, and residual lots;
- settlement, expiry, and restrictions required to value those lots;
- acceptance/exclusion matching needed by the fixtures;
- percentage and points-per-unit calculations;
- native ledger, external funding, ending assets, fees, and net-value reconciliation;
- valuation isolation and ranking;
- bitemporal rule selection and replay serialization.

Do not partially implement fixed, tiered, multiplier, transfer, cap-state search, probabilistic ranking, refunds, or next-question generation in this slice.

### Milestone 1b — extended calculation and uncertainty

Add the remaining primitives only after 1a passes its conservation and valuation-isolation gates.

The initiating Codex prompt stops after 1a. `prompts/CODEX_MILESTONE_1B_PROMPT.md` is the explicit continuation prompt.

## 6. Residual valuation policy

A stored-value balance is an asset, not a reward and not automatically equivalent to cash. Its valuation must be per asset and tied to transparent assumptions such as likely usage horizon, expiry, merchant reach, and transferability.

The system should expose a break-even statement such as:

> Direct payment wins at your current valuation. The top-up route becomes better when you value the remaining balance above JPY 0.9722 per unit.

The exact native ledger and residual quantity must remain unchanged when valuation changes.

Implementation locations:

- `docs/14_residual_valuation_and_sensitivity.md`
- `schemas/user-state.schema.json`
- `schemas/golden-scenario.schema.json`
- `examples/golden-scenario.example.yaml`
- `examples/golden-scenario.valuation-flip.example.yaml`

## 7. First-ten review modes

The first ten real scenarios use this default:

| Scenario | Required mode |
|---|---|
| `JP-XFR-002` Rakuten Point to ANA transfer | `human_second_review` |
| The other nine seed scenarios | `solo_dual_pass`, followed by an `agent_challenged` discrepancy pass |

Escalate any scenario to `human_second_review` or `expert_review` when:

- first-party sources conflict or remain materially ambiguous;
- the rule can cause irreversible point expiry, transfer loss, or a material spend commitment;
- a transfer, annual-fee, or high-loss recommendation is exposed to users;
- the reviewer cannot independently reproduce the result.

An agent challenge is a testing aid, not an accountable second human.

## Deferred validation

The independent reviewer executed the v0.2 migration and separately tested the proposed bitemporal exclusion on PostgreSQL 16.14. The v0.3 release builder did not have PostgreSQL available locally. Codex must still run the complete v0.3 migration and the supplied integration scripts in its implementation environment, including the invoker-view behavior and replay property test.
