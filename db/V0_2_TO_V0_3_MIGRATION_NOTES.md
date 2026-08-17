# v0.2 to v0.3 database migration notes

v0.3 is a small but important integrity/security migration. Apply it before inserting real approved rule history.

## 1. Detect existing replay ambiguity

Before adding the new exclusion constraint, search for approved version pairs that overlap in both economic and system time. Resolve each conflict by correcting the recorded/superseded interval or creating a reviewed replacement. Do not delete audit history merely to satisfy the constraint.

## 2. Replace the current-state-only exclusion

```sql
alter table app_private.reward_rule_versions
  drop constraint if exists reward_rule_versions_no_approved_overlap;

alter table app_private.reward_rule_versions
  add constraint reward_rule_versions_no_bitemporal_overlap
  exclude using gist (
      rule_id with =,
      tstzrange(valid_from, coalesce(valid_to, 'infinity'::timestamptz), '[)') with &&,
      tstzrange(recorded_at, coalesce(superseded_at, 'infinity'::timestamptz), '[)') with &&
  ) where (review_status = 'approved');
```

The invariant is now uniqueness over `(rule_id, transaction_time, replay_knowledge_time)`, not merely uniqueness among current rows.

## 3. Make API views explicit security invokers

```sql
alter view app_api.verified_sources
  set (security_invoker = true, security_barrier = true);

alter view app_api.approved_reward_rule_versions
  set (security_invoker = true, security_barrier = true);
```

Do not grant these views to `anon` or `authenticated` without a reviewed underlying permission/RLS design. Prefer a backend role or explicit RPC for the first implementation.

## 4. Contract-only changes

The following are application-contract changes rather than table migrations in this baseline:

- comparable estimated user-state bounds and shared semantic validation;
- residual valuation assumption metadata;
- valuation break-even sensitivity output;
- Milestone 1a/1b implementation split.

Persisted JSON payloads must be migrated or versioned if they use the older expected-output shape.

## 5. Integration tests

Run:

```bash
psql -v ON_ERROR_STOP=1 -f db/0001_core_schema.sql
psql -v ON_ERROR_STOP=1 -f db/tests/001_bitemporal_replay.sql
psql -v ON_ERROR_STOP=1 -f db/tests/002_view_security.sql
```

The second script uses a non-superuser test role. A view-only grant must not lend the migration owner's access to `app_private`; deliberate underlying grants are then tested separately.
