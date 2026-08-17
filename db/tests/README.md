# Database integration tests

These scripts require an isolated PostgreSQL 15+ database and are not run by the offline package validator. Run the baseline migration first with `ON_ERROR_STOP=1`.

- `001_bitemporal_replay.sql` reproduces the historical-overlap defect, proves the full bitemporal exclusion rejects it, verifies adjacent system intervals remain legal, and checks half-open replay boundaries.
- `002_view_security.sql` proves that granting an `app_api` view alone does not lend the migration owner’s underlying privileges, then demonstrates the deliberate least-privilege grants needed by a backend reader role.

The implementation repository must additionally test:

- RLS denial before policies and user isolation after deployment policies;
- approved-version immutability and one-time `superseded_at` closure;
- source-snapshot append-only behavior;
- profile-root cascade deletion;
- retention purging and account deletion.

- `003_agent_feed_consumer.sql`: event idempotency and no direct SourceObservation-to-rule publication path.
