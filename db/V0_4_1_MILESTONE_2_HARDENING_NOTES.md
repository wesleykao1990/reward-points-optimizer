# Milestone 2 persistence hardening notes

`0003_milestone_2_hardening.sql` is additive and must follow `0001_core_schema.sql` and `0002_agent_feed_consumer.sql`.

It adds:

- transactionally sealed canonical replay runs and immutable replay/rule links;
- a retention purge that removes expired user-derived history while preserving legal holds;
- stricter semantic states for user facts and unknown cap progress;
- allowed review-mode and terminal reviewer constraints;
- a deferred approval gate tying approved rule versions to verified evidence and immutable approved review decisions;
- a deployment helper for role-specific, owner-isolated `auth.uid()` RLS policies;
- comprehensive current and default privilege revocation.

The policy installer intentionally does not grant table or schema privileges. A deployment must create its non-superuser, non-`BYPASSRLS` application roles, provide `auth.uid()`, call `app_private.install_user_data_rls_policies(role_name)` as the migration owner, and separately grant only the CRUD privileges each role needs.

The migration validates every pre-existing approved rule version against the new immutable decision and verified-evidence gate. Backfill legitimate review records before applying `0003`; noncompliant approvals intentionally abort the migration rather than being grandfathered.

The purge function is `SECURITY DEFINER`, has a locked search path, and is not executable by `PUBLIC`. Narrow read/delete RLS policies for the migration/function owner let it operate correctly even when that owner is not a superuser or `BYPASSRLS`; those policies do not apply to clients. Schedule the function only through a reviewed backend role. Its timestamp argument makes retention tests deterministic.

Canonical replay creation is two-phase within one transaction: insert the run with `sealed_at = NULL`, insert every rule-version link, then set `sealed_at`. Deferred constraints reject an unsealed commit, and the insert guard rejects every link added after sealing.

Validate a fresh installation with:

```bash
JRO_TEST_DATABASE_URL=postgresql://.../jro_test \
JRO_DB_TEST_CONFIRM=isolated \
pnpm test:db
```

The runner rejects a non-empty application database. Back up and rehearse any production upgrade separately; this reference package does not perform an in-place production deployment.
