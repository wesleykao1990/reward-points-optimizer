# P0 source operations

This private package admits the exact P0 planning universe and evaluates source-role readiness without converting planning records into evidence or reward rules.

The current plan contains 44 source families, 19 Agent Feed streams, and 301 required `(family_id, source_role_id)` slots. A baseline status such as `covered` means only that useful page-level seeds existed during planning. It never means a family, product, card SKU, or economic rule is supported.

A role is ready only when its producer run, collection permission, technical path, stream liveness, canonical evidence or explicit conservative exclusion, and source-to-rule impact mapping all pass. `lead_only` and discovery evidence remain blockers. Private experimental eligibility is reported separately and never satisfies readiness.

This package performs no network access, persistence, evidence promotion, rule publication, product catalogue enumeration, or unknown-world discovery.

## Resumable operations driver

`buildP0AgentFeedWorkUnitRequests` expands the admitted plan into 44 stable
family/stream requests (at most eight targets each). Supplying the checked-in
task pack adds producer metadata and source locator *hints*; hints are never
converted into checkpoints or evidence. `prepareP0Operations` accepts a
progress snapshot, receipt, or checkpoint array and, for `selection: "retry"`,
selects only unresolved or cadence-stale targets. A validation rejection is
held for the same `input_sha256` and becomes retryable only when that input
identity changes.

The CLI is intentionally offline:

```sh
pnpm p0:operations check
pnpm p0:operations prepare --mode all --dry-run
pnpm p0:operations prepare --mode retry \
  --progress progress.json \
  --effective-at 2026-08-22T00:00:00+09:00 \
  --input-sha256 sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
pnpm p0:operations reconcile --receipt receipt.json --dry-run
```

It performs no live Agent Feed or PostgreSQL call. A service with the existing
`@jro/agent-feed-postgres` adapter should call
`reconcileP0ReceiptThroughStore(manifest, store, receipt)` after the same local
admission; the adapter remains responsible for the transaction and database
receipt binding.
