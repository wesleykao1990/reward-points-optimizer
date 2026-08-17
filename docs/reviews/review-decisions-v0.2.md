# Review Decisions for Foundation v0.2

Source review: `docs/reviews/agent-review-2026-08-17.md`.

This document is the authoritative disposition of the review. Codex should not rediscover or silently reinterpret the resolved v0.1 conflicts. A new contradiction that changes a canonical contract must be reported before implementation.

## Decision matrix

| Review item | Decision | v0.2 implementation |
|---|---|---|
| Charge/top-up leg absent | Accept, implement differently | `purchase-plan.schema.json` uses operations, dependencies, asset inputs, requested outputs, and asset lots instead of a flat recipe or charge-only special case. |
| Denomination, residual balance, expiry | Accept | Output assets are created as lots; the engine emits principal movements and ending lots. Residual value is included in reconciled plan economics. |
| Charge reward/exclusion | Accept, generalize | Rules scope to operation types such as `stored_value_top_up` and `voucher_purchase`; reward and exclusion semantics do not require merchant-specific code. |
| Reward subtype and expiry | Accept | Asset references and lots carry reward class, settlement, expiry, and usage restrictions. Valuation can vary by class and expiry horizon. |
| Unknown user state | Accept, extend | User facts and cap progress use `known`, `estimated`, `unknown`, or `not_applicable`. Results can be definite or conditional and include value ranges and questions. |
| Best/worst range | Accept, strengthen | The engine must evaluate feasible assignments and must not combine incompatible optimistic assumptions. It returns a safe plan and conditional winners. |
| Tier basis too narrow | Accept | Tiers can use transaction amount, user fact, period aggregate, or event counter. |
| Transfer minimum/increment/max missing | Accept | Transfer calculations include minimums, increments, per-request and per-period limits, fees, timing, cancellation, and bonus rule IDs. |
| Merchant exclusions missing | Accept | Merchant, group, location, and category exclusions are explicit in rule scope. |
| Posting and clawback missing | Accept | Reward components include certainty, settlement, expiry, restrictions, sign, and clawback policy. Refund and reversal operations are first-class. |
| Doc/schema drift | Accept | JSON Schema remains canonical; docs, examples, SQL intent, tests, and prompts are reconciled to v0.2 terminology. |
| `amount_minor` ambiguity | Accept as clarity issue | JPY fields use `*_jpy`; reward quantities use decimal-string `units` with asset scale defined centrally. |
| Percentage rounding magic field | Accept | Rounding separates aggregation scope, optional spend quantum, and reward rounding mode. |
| RLS/default privileges | Accept, implement with schema boundaries | Internal tables move to `app_private`; user tables move to `user_data`, have RLS enabled and forced, and receive no permissive client policy by default. Existing and default grants are revoked. |
| Overlapping approved validity | Accept | A GiST exclusion constraint prevents overlap for approved, unsuperseded versions of the same rule. |
| Immutability not enforced | Accept, controlled implementation | Source snapshots and review decisions are append-only. Approved rule payloads/economic intervals are frozen; only a one-time `superseded_at` closure is allowed. |
| UUID array has no FK | Accept | Extraction candidate/snapshot relationships use a join table. |
| `current_version` drift | Accept | The column is removed; approved current versions are derived. |
| Permanent user request payload | Accept | Permanent replay is limited to synthetic/golden/redacted data. User history is separate, redacted, retention-classed, purgeable, and tied to a deletable profile root. |
| `updated_at` does not update | Accept | Mutable tables use a common trigger; append-only tables omit mutable timestamps where appropriate. |
| Four-eyes gates unrealistic for solo build | Accept | Review mode is explicit: `solo_dual_pass`, `agent_challenged`, `human_second_review`, or `expert_review`. Solo review is never mislabeled independent. |
| Data-maintenance risk tested too late | Accept | An eight-source, 30-day maintenance rehearsal runs alongside the engine foundation before broad source expansion. |
| 100 scenarios as blocking gate | Accept | The first ten establish throughput; the 100-scenario set becomes a continuing quality track rather than a narrow-alpha blocker. |
| Narrow v1 harder | Accept | The recommended alpha is Tokyo convenience stores plus a limited wallet/program set and manual user state. |
| Verification fields misleading | Accept | URL registration and content verification are separate; technical access is a dated observation. |
| All terms reviews pending | Accept | The first eight-source review and rehearsal cohort is explicit. |
| T4 sources as change detectors | Accept with restriction | Discovery-only sources may trigger review but can never establish canonical reward truth. |
| Prompt injection only documented | Accept | A hostile source fixture and quarantined expected extraction candidate are included and validated. |
| Codex should stop on contradictions | Accept with refinement | Known conflicts are resolved here; Codex stops only on a new contract-affecting contradiction. |

## Accepted with a different implementation

### Route model

The review proposed an ordered list of charge legs. v0.2 uses an operation-and-asset plan so an acquisition operation can create a reusable lot, a purchase can consume part of it, and residual value remains represented without attributing the whole acquisition cost to one purchase.

Candidate plans contain facts and requested principal outputs, not expected reward answers. The engine emits actual movements, reward components, ending lots, and a reconciled economic summary.

### Reward point subtypes

Separate asset IDs remain possible, but the canonical model does not encode every campaign lot as a new currency. It combines an asset/program identity with reward class, settlement, expiry, restrictions, and lot metadata.

### Unknown state

v0.2 returns:

- a definite winner when it wins across all feasible states;
- a safe plan where one exists;
- conditional winners with named conditions;
- bounded values;
- questions whose answers can change the winner.

A naive arithmetic combination of independent best cases is prohibited.

### Database security

Internal evidence and rule tables are outside client-exposed schemas. User tables have RLS enabled and forced, but this reference deliberately installs no permissive client policy because the authentication authority and exposed-schema configuration are deployment decisions. Codex must add and integration-test deployment-specific ownership policies before mobile access.

### Immutability

A blanket ban on every update would break rule approval and bitemporal supersession. Draft records can be edited; approved payloads are frozen; system validity can be closed once through a controlled transition. Corrections create a new version.

### Technical feasibility

Reachability is an observation containing time, environment, method, and result. It is not a permanent `bot_blocked` fact. Manual capture is the default during the rehearsal but is not assumed to be the final production data architecture.

## Pushbacks retained

- One network probe cannot establish durable collection capability.
- Technical success never grants collection, storage, or redistribution permission.
- Account aggregation is not required to represent user state; manual user input can provide it first.
- “Minor unit” was not technically invalid for JPY, but clearer v0.2 names reduce cross-asset errors.
- Scenario effort varies by complexity; measured first-ten throughput replaces a universal estimate.
- Codex should not spend its first implementation pass resolving contradictions already decided here.

## Additional gaps resolved

- Probabilistic rewards are distinct from guaranteed value and cannot silently enter guaranteed ranking.
- Acceptance and exclusion facts no longer require fake zero-value calculations.
- Debit/reversal components align with the documented ledger.
- User-owned database rows cascade from a profile root to make account deletion testable.
- User asset persistence now retains reward class, settlement timing, expiry policy, restrictions, and provenance references.
- A dedicated maintenance-rehearsal prompt turns the operational experiment into an executable agent workflow.

## Deferred validation

The SQL reference has not been executed against PostgreSQL 15 or Supabase in this package-building environment. Extension creation, RLS behavior, grants, exclusion constraints, immutability triggers, cascade deletion, and retention purging remain mandatory integration tests in the implementation repository.
