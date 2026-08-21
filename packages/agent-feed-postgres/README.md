# `@jro/agent-feed-postgres`

This package adapts the Agent Feed consumer's `AtomicPersistencePort` to the
Rewards Optimizer PostgreSQL boundary. It imports no PostgreSQL driver: pass a
driver-owned query client or a pool with `connect()`/`release()` and the adapter
will run `BEGIN`, the fixed `app_private.persist_agent_feed_atomic(jsonb)`
wrapper, and `COMMIT` (or `ROLLBACK`).

A failed transaction/query/commit is passed to `release(error)` after the
adapter attempts rollback, so a driver-compatible pool can discard a damaged
connection. Successful transactions release without an error.

The SQL wrapper validates the handler-shaped JSON document before calling the
existing verified receipt, semantic observation, evidence-lead, and run
lifecycle routines. It never promotes producer evidence or creates a rule.
The wrapper requires exact event/lifecycle pairing and exact set equality
between observation evidence references and submitted lead identities; JSON
nulls and mismatched terminal states fail before writes.

`createPostgresNanacoEconomicPilotHost(target)` is the trusted-host adapter for
the sealed Nanaco economic pilot. It retains a private provisional-rule store
and supplies the route's verifier from one Rewards-owned `EXISTS` query over
the exact observation, promoted evidence work, verified EvidenceRecord,
content-verified non-discovery source, and under-review unsuperseded rule
version. The public result exposes only `admit` and asynchronous `activate`;
query failures and malformed results fail closed.

`createPostgresP0ImplementationCatalogueStore(target)` reads the correction-
sensitive `app_api.p0_active_implementation_facts` projection with bounded,
parameterized search over query text, family, source role, claim type, limit,
and an opaque UUID cursor. Results contain an opaque `fact_id` for host-side
correction plus safe fact text; hashes, URLs, evidence locators, raw values,
and parent claim IDs are not returned. `reportCorrection` resolves that key
inside the database's fixed-search-path SECURITY DEFINER routine and commits
the exact correction transactionally. The generic implementation lane stores
the current 87 catalogue facts (zero derived rules) without creating canonical
reward rules, evidence, publication requests, or human-approval records.
