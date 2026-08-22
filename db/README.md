# Database reference v0.4.1

The ordered migration chain targets PostgreSQL 15+ and Supabase-compatible Postgres:

1. `0001_core_schema.sql` creates the foundation schema.
2. `0002_agent_feed_consumer.sql` adds private Agent Feed intake state.
3. `0003_milestone_2_hardening.sql` closes the Milestone 2 persistence and security gates.
4. `0004_m25_agent_feed_consumer.sql` hardens signed Agent Feed intake and evidence work.
5. `0005_m3_golden_publication_boundary.sql` seals canonical golden replays and keeps reviewed rules private until a completed publication request exists.
6. `0006_p0_provisional_rules.sql` adds a private experimental candidate,
   transition, correction, and active-selection boundary for P0 Agent Feed
   rehearsals without creating a canonical publication path.
7. `0007_p0_source_operations.sql` adds the private, immutable P0 planning and
   source-role readiness control plane for exactly 44 families, 19 streams,
   and 301 semantic role requirements.
8. `0008_p0_bulk_provisional_publication.sql` adds an append-only, atomic batch
   ledger for exact experimentally eligible provisional candidates. It does
   not create canonical rules or publication requests.
9. `0009_p0_experimental_economic_claims.sql` adds an internal invoker/barrier
   view over verified evidence attached to under-review rule versions. It gives
   a privileged prototype server a bounded economic-claim read surface without
   publishing those rules or admitting raw Agent Feed observations.
10. `0010_agent_feed_atomic_adapter.sql` adds a private atomic adapter that
    persists one already-verified Agent Feed event, its receipt, mapped
    `SourceObservation` or submitted-evidence lead, and run lifecycle update in
    one transaction. It creates no canonical evidence, reward rule, publication
    request, or provisional candidate.
11. `0011_p0_unverified_experimental_catalogue.sql` adds the bounded private
    catalogue projection for unverified experimental observations without
    changing canonical reward truth.
12. `0012_p0_generic_implementation_catalogue.sql` adds an immutable,
    correction-sensitive implementation receipt/fact lane. It validates the
    complete generic P0 envelope before writing, accepts the four exact
    zero-derived snapshots (87 + 111 + 103 + 63 = 364 facts), and exposes only
    a safe invoker/barrier projection with an opaque fact key. It never creates
    candidate, evidence, reward-rule, publication, or human-approval rows;
    PostgreSQL validates hash shape but does not recompute the TypeScript
    canonical hash.
13. `0013_p0_agent_feed_operations.sql` adds the private, append-only P0
    work-unit and target-attempt checkpoint ledger, with exact terminal receipt
    reconciliation and idempotent replay comparison.
14. `0014_p0_nanaco_credit_charge_recommendation.sql` binds the bounded Seven
    Card Plus credit-charge experiment to its current provisional rule and
    correction-sensitive availability projection.
15. `0015_p0_fact_influence_graph.sql` exposes all 364 immutable implementation
    facts through a private, correction-aware host projection. Inactive and
    corrected facts remain addressable, while only separately verified rule
    bindings may be reported as applied to a recommendation.
16. `0016_p0_generic_reward_claim_persistence.sql` adds an execute-only,
    SECURITY DEFINER adapter for generic structured reward-claim candidates.
    It classifies exact replays under the existing candidate advisory lock,
    delegates shape/source-observation binding to the generic provisional
    candidate routine, and never grants relation access or creates canonical
    rules, evidence, or publication requests.
17. `0017_p0_agent_feed_scope_projection.sql` adds an append-only private
    projection of verified terminal expected/actual target scopes before raw
    receipt redaction, and makes completed recovery-subset reconciliation use
    that projection. It retains no raw payload and fails closed on missing,
    forged, or drifted scope bindings.
18. `0018_deployment_runtime_role.sql` creates the NOLOGIN `jro_runtime` role
    used by the Vercel adapter. It grants only the bounded catalogue reads and
    two correction routines needed by the hosted alpha; it receives no broad
    table writes, canonical-rule access, user-data access, or future-object
    privileges.

It separates:

- `app_private`: authority, access observations, snapshots, evidence, rules, review, scenarios, and canonical replay;
- `app_api`: deny-by-default controlled views;
- `user_data`: user-owned wallet, state, lots, valuations, cap progress, corrections, and short-retention history.

Important controls include:

- explicit current and default privilege revocation;
- RLS enabled and forced on every user-owned table, with no permissive client policy by default;
- a GiST exclusion constraint preventing overlap in both economic and system time for approved versions of the same rule;
- immutable snapshots, append-only review decisions, and controlled approved-rule system closure;
- foreign-key join tables instead of UUID arrays;
- cascading deletion through `user_profiles`;
- retention classes and `purge_after`;
- a legal-hold-aware retention purge function;
- transactionally sealed canonical replay rows and immutable replay/rule joins;
- exact evidence, rule-version, and sealed-replay completion for golden scenarios;
- a separate completed-publication-request gate before an approved rule can become API-visible;
- private immutable provisional candidates with exact semantic family-role and
  source-authority bindings;
- primary-authority-only experimental activation and automatic exclusion after
  credible dispute or quarantine;
- atomic 1–32-member provisional batch persistence with sealed-plan and
  experimental-role binding, deterministic candidate locks, idempotent exact
  replay, and a correction-sensitive active projection;
- an evidence-and-review-event completion gate for approved rule versions;
- role-scoped `auth.uid()` RLS policy installation for all ten user-owned tables;
- `security_invoker`/`security_barrier` views with no implicit client grants;
- `updated_at` triggers on mutable tables.

Run the complete chain and adversarial suite only against a new disposable database:

```bash
JRO_TEST_DATABASE_URL=postgresql://.../jro_test \
JRO_DB_TEST_CONFIRM=isolated \
pnpm test:db
```

The runner applies every numbered migration, then every numbered canonical seed, then every SQL test. It refuses administrative databases, PostgreSQL versions before 15, existing application schemas, and runs without third-party Python packages.

`@jro/agent-feed-postgres` is the host-side implementation of the consumer's
`AtomicPersistencePort`. It requires a caller-owned PostgreSQL pool/client,
checks out one client, and wraps the private `persist_agent_feed_atomic`
function in `BEGIN`/`COMMIT` with rollback on every error. Signature and schema
verification remain the responsibility of `@jro/agent-feed-consumer` before
this port is called.

The same package provides the server-owned nanaco pilot host. It retains the
provisional store and verifier privately and performs an exact read-only join
from a canonical-reviewed observation through promoted evidence work to the
verified source and fixed under-review rule version before permitting the
sealed pilot candidate to activate. Agent Feed lead IDs and canonical evidence
keys remain separate identities and are joined through their promotion rows.

The M3 seed is generated from the reviewed golden fixtures rather than maintained by hand:

```bash
pnpm seed:m3:check
# Intentional regeneration only:
pnpm seed:m3:generate
```

`db/seeds/001_m3_real_data_goldens.sql` stores the six approved EvidenceRecords and two golden scenarios in private tables. Its six reward-rule versions remain `under_review`; it creates no publication request and grants no frontend/API route.

`db/seeds/002_p0_provisional_rehearsal.sql` imports one exact local Agent Feed
run-bundle finding as an explicitly unverified receipt, maps it to a lead-only
`SourceObservation`, and activates one private experimental Seven-Eleven
payment-acceptance candidate. It creates no approved rule version, publication
request, or consumer route.

`db/seeds/003_p0_source_operations.sql` expands the hash-bound P0 planning
manifest into 44 private family rows and 301 role requirements. All roles start
fail-closed: zero are ready, and only the existing Seven-Eleven rehearsal role
is separately marked experimental. The seed then one-way seals the exact
snapshot; post-seal inserts and every update, delete, or truncate are rejected.
Planning status is not evidence, product catalogue coverage, or a support claim.

`db/seeds/004_p0_payment_acceptance_batch.sql` imports one bounded, unsigned
local Agent Feed run containing the normalized 11-family Seven-Eleven payment
acceptance claim. It persists the lead-only finding/evidence and atomically
publishes 11 exact `under_review` provisional candidates into the private
experimental catalogue. It creates no reward rates, card/product SKUs,
approved rule versions, publication requests, or production API entries.

`app_api.experimental_economic_claims` exposes the existing M3 verified
economic evidence and under-review rule bindings only to an explicitly granted
server role. The migration grants nothing to PUBLIC, `anon`, or
`authenticated`; an app deployment must opt in with the minimum underlying
table privileges required by the invoker view.

See:

- `V0_1_TO_V0_2_MIGRATION_NOTES.md` for the operation-and-asset breaking revision;
- `V0_2_TO_V0_3_MIGRATION_NOTES.md` for replay uniqueness and view-security changes.
- `V0_4_1_MILESTONE_2_HARDENING_NOTES.md` for the additive Milestone 2 controls and deployment steps.


## Agent Feed consumer migration

`0002_agent_feed_consumer.sql` creates private idempotent receipts, untrusted `SourceObservation` staging, and submitted-evidence promotion state. It does not create any direct reward-rule publication path.
