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

See:

- `V0_1_TO_V0_2_MIGRATION_NOTES.md` for the operation-and-asset breaking revision;
- `V0_2_TO_V0_3_MIGRATION_NOTES.md` for replay uniqueness and view-security changes.
- `V0_4_1_MILESTONE_2_HARDENING_NOTES.md` for the additive Milestone 2 controls and deployment steps.


## Agent Feed consumer migration

`0002_agent_feed_consumer.sql` creates private idempotent receipts, untrusted `SourceObservation` staging, and submitted-evidence promotion state. It does not create any direct reward-rule publication path.
