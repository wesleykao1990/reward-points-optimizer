# v0.1 to v0.2 database migration notes

This is a **breaking domain-model revision**, not a safe in-place column rename. No production deployment is assumed to exist. New implementations should use `0001_core_schema.sql` as a fresh baseline.

## Breaking changes

- Flat `payment_instrument_id + funding_source_id` recipes become ordered operation-and-asset plans.
- Reward currency strings become canonical asset definitions plus reward class, settlement, expiry, restrictions, and lots.
- User campaign/tier/cap state becomes typed `known | estimated | unknown | not_applicable` state.
- `reward_rules.current_version` is removed; current approved versions are derived.
- `extraction_candidates.source_snapshot_ids uuid[]` becomes a foreign-key join table.
- Permanent recommendation audit is split from deletable user recommendation history.
- Registry verification splits URL registration from actual content verification.
- Source authority, collection permission, and technical reachability are stored separately.
- Internal tables move from the exposed `public` schema to `app_private`; user records move to `user_data` with RLS enabled.

## Migration strategy for an existing prototype

1. Freeze writes and export all v0.1 data.
2. Create the v0.2 schemas in a separate database or schema namespace.
3. Convert each flat recipe into at least one `merchant_purchase` operation. Do not infer top-up operations from prose.
4. Map each reward currency to an `asset_definition`; split normal, limited-period, and usage-limited rewards where evidence supports it.
5. Convert exact Boolean user state to `known`; do not convert missing values to `false` or zero.
6. Rebuild rule versions from their immutable source payloads and evidence references.
7. Resolve approved economic-validity overlaps before import.
8. Import only redacted/synthetic recommendation replays into `canonical_replay_runs`; place user history under a documented retention class.
9. Create `user_profiles` first, map every user-owned row to it, and verify cascade deletion in an isolated database.
10. Run schema, historical replay, RLS, deletion, and retention tests before switching traffic.

A coding agent must stop and report any value that cannot be mapped without inventing a fact.
