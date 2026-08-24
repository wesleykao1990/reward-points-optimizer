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

`createPostgresP0TerminalAtomicPersistence(target, manifest, resolver)` is a
narrow terminal-only bridge for a signature/schema-verified Agent Feed
`AtomicPersistenceInput`. The host-owned resolver returns one exact admitted
`P0ReceiptReconciliation` template (its receipt ID may be a valid placeholder);
the consumer's process-local verification capability is required on the
original input, and the bridge rejects structural/unsigned, non-terminal, or
identity-mismatched inputs before checkout,
persists the receipt/lifecycle, binds the returned receipt UUID into the root
and every checkpoint, then calls `reconcile_p0_agent_feed_work_unit` on the
same client and transaction. A checkpoint or reconciliation failure rolls the
receipt and lifecycle back together. The resolver must provide target outcomes
and locators explicitly; this adapter never queries Agent Feed state or infers
missing checkpoints. Use the ordinary `createPostgresAtomicPersistence` for
non-P0 and non-terminal events.

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
the current 364 catalogue facts (zero derived rules) without creating canonical
reward rules, evidence, publication requests, or human-approval records.

`createPostgresP0FactInfluenceGraphStore(target)` is the separate host-only
explanation boundary. It reads the private
`p0_implementation_fact_influence_graph_rows(timestamptz)` function with a
364-row bound, retains inactive and corrected history, validates the complete
server-side JSON material, and sorts by the deterministic implementation-hash
and claim identity order. The adapter returns no browser DTO; the consumer
host reduces these rows to opaque factor IDs, localized labels, and bounded
questions/warnings. A correction therefore remains addressable in the graph
but is never rankable.

`loadCurrentP0EconomicRuleIRs(target, options)` is the separate executable-rule
boundary. It reads the complete current candidate document from the private
experimental projection, verifies its row/candidate/source/authority/time/hash
bindings, and compiles only supported economic rules. Because the projection
does not contain claim identity, full asset definitions, or principal graph
edges, the trusted host must provide those immutable bindings explicitly.
Missing, inactive, corrected, drifted, hostile, unsupported, or incomplete
rows are returned as deterministic issues and never become Rule IR records.

`createPostgresAgentFeedTypedRuleRecordStore(target)` reads the bounded private
universal-rule projections. Every normalized SourceObservation and immutable
implementation fact is represented as a versioned typed outcome, including
informational or incomplete rows (`calculable: false`); no arithmetic is
inferred from prose or missing fields. `listMerchantPaymentAcceptance` reads
the Rewards-owned merchant authority relation, populated only from explicit
structured `merchant_id`, payment-family, and boolean `accepted` attributes.
Recommendation-time reads do not require an evidence or manual-approval query.
Active records and family enumeration remain correction-, quarantine-, and
applicability-sensitive inside PostgreSQL.
