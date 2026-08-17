# Database reference v0.3

`0001_core_schema.sql` is the v0.3 fresh-install reference for PostgreSQL 15+ and Supabase-compatible Postgres.

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
- `security_invoker`/`security_barrier` views with no implicit client grants;
- `updated_at` triggers on mutable tables.

The exact bitemporal constraint was independently exercised on PostgreSQL 16.14 in the v0.2 review. The implementation repository must still run the complete v0.3 migration and integration-test suite against its own PostgreSQL 15+ environment.

See:

- `V0_1_TO_V0_2_MIGRATION_NOTES.md` for the operation-and-asset breaking revision;
- `V0_2_TO_V0_3_MIGRATION_NOTES.md` for replay uniqueness and view-security changes.


## Agent Feed consumer migration

Apply `0002_agent_feed_consumer.sql` only after the baseline. It creates private idempotent receipts, untrusted `SourceObservation` staging, and submitted-evidence promotion state. Run `tests/003_agent_feed_consumer.sql`. It does not create any direct reward-rule publication path.
