# Database integration tests

These scripts require an isolated PostgreSQL 15+ database and are not run by the offline package validator. The supported runner applies every migration and test in order:

```bash
JRO_TEST_DATABASE_URL=postgresql://.../jro_test JRO_DB_TEST_CONFIRM=isolated pnpm test:db
```

- `001_bitemporal_replay.sql` reproduces the historical-overlap defect, proves the full bitemporal exclusion rejects it, verifies adjacent system intervals remain legal, and checks half-open replay boundaries.
- `002_view_security.sql` proves that granting an `app_api` view alone does not lend the migration owner’s underlying privileges, then demonstrates the deliberate least-privilege grants needed by a backend reader role.

- `003_agent_feed_consumer.sql`: event idempotency and no direct SourceObservation-to-rule publication path.
- `004_v0_4_1_hardening.sql`: monitoring and review-mode hardening regressions.
- `005_agent_feed_liveness.sql`: monitor liveness and terminal-run reconciliation.
- `006_m2_persistence_security.sql`: RLS denial/isolation, immutable records, approved-rule evidence, semantic user state, deletion cascades, legal-hold-aware retention purge, and privilege catalog assertions.
- `007_m25_agent_feed_consumer.sql`: verified receipt insert-or-get, transport/semantic dedupe, canonical observation alignment, hostile quarantine, Rewards-owned evidence promotion, run lifecycle/liveness, and redacted DLQ/replay diagnostics.
- `008_m3_golden_publication_boundary.sql`: exact M3 seed counts and hashes, sealed golden completion, immutable provenance links, denial of direct/forged rule publication, and absence from the approved-rule API view.
- `009_p0_provisional_rules.sql`: private provisional admission, exact current
  candidate shape, source role/authority binding, primary-only activation,
  immutable history/corrections, capability isolation, and hostile fail-closed
  database behavior.
- `010_p0_provisional_rehearsal_seed.sql`: exact local receipt, observation,
  lead-only evidence, candidate and definition hashes, experimental selection,
  absence of canonical publication, and rollback-safe correction exclusion.

The runner applies all numbered seeds after all migrations and before all SQL
tests. Use `pnpm seed:m3:check` to prove the generated M3 SQL still matches the
reviewed fixtures; seed 002 is separately pinned by test 010.
