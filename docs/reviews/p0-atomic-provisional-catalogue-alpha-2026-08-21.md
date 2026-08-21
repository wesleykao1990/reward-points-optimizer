# P0 atomic provisional catalogue alpha review — 2026-08-21

## Decision

**GO for the private/localhost experimental checkpoint.** This is not approval
for canonical rule publication, production recommendations, or comprehensive
P0 data coverage.

## Implemented scope

- `@jro/provisional-rules` admits 1–32 exact batch members, binds the sealed P0
  plan hash, activates every primary-authority member before store mutation,
  sorts the output by candidate hash, and produces one deterministic batch
  hash.
- Exact in-process replay is idempotent while its versions remain active.
  Changed content, duplicate identities, and replay after correction fail
  closed.
- PostgreSQL migration `0008` stores one immutable private batch/member ledger,
  requires explicit role-level experimental eligibility, locks candidate
  hashes deterministically, and commits the complete trusted-adapter projection
  atomically. The active view automatically excludes disputed or quarantined
  versions.
- The Japanese localhost app exposes one bounded `先行公開データ` card for the
  exact checked-in Seven-Eleven acceptance candidate. It is visibly
  machine-checked/provisional and is not consumed by synthetic recommendation
  evaluation.
- The browser can submit only an issued publication ID and bounded correction
  category. The host supplies the exact candidate hash, credible disposition,
  severity, time, and signal identity; a successful report disputes and removes
  that version.

## Verification

- provisional-rule package: 14/14 tests, typecheck, build, scoped Biome;
- localhost consumer app: 31/31 tests, typecheck, build, scoped Biome;
- fresh PostgreSQL 16: 8 migrations, 3 seeds, 12 SQL tests;
- root typecheck, tests, property tests, build, and lint exit successfully;
- schema, registry, example, M3 seed/publication, M7 challenge, and offline
  package validators pass.

Independent review initially found three bulk-boundary defects: unknown fields
inside `admission_request`, duplicate caller candidate IDs, and SQL acceptance
of unsorted members. Exact-key validation, candidate/publication identity
uniqueness, and database order enforcement closed all three; the re-review
issued **GO**.

Independent frontend review initially found that the new experimental GET route
accepted a hostile `Host`/`Origin`, and that health still said only
`synthetic_only`. Authority validation now covers every request, the exact
hostile GET regression passes, and health separately reports synthetic-only
recommendations and experimental-catalogue availability. The re-review issued
**GO**.

## Deliberate limits

- Only one truthful source-bound candidate exists; bulk capacity is not a claim
  that P0 data has been collected.
- The app catalogue is process-local and volatile. Migration `0008` provides a
  durable adapter boundary, but the localhost app is not connected to that
  database.
- PostgreSQL validates strict representation, lifecycle, plan, role, and trusted
  hash fields but does not reimplement TypeScript canonical SHA-256 computation.
- The candidate is `under_review`, human-unverified, and experimental. It does
  not create an approved `RewardRuleVersion`, canonical evidence promotion, or
  publication request.
- It does not affect optimizer output because the repository has no exact
  evidence-backed mapping from the real Seven-Eleven merchant-level candidate
  to the synthetic merchant/branch fixture.

The next data milestone is to run authorized Agent Feed producers for named P0
family-role slices and create exact source-bound candidates. Missing economic
facts and merchant/product relationships remain unknown rather than inferred.
