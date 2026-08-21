# `@jro/source-maintenance`

Pure, offline contracts for the M4 two-lane source-maintenance rehearsal.
The package freezes the eight-source cohort in registry order, evaluates a
permission-aware direct-check state machine, and reduces append-only synthetic
evaluation records into deterministic metrics.

This package never fetches a source, stores official page content, creates
canonical evidence, or declares that the 30-day rehearsal has completed. The
fixtures under `fixtures/m4/` are explicitly `test_fixture` representations.
Production terms are `not_reviewed` and technical feasibility is `unknown`, so
the fixed cohort is blocked for direct capture until separate approvals and
observations exist.

The reducer returns `insufficient_data` until the full planned 30-day window,
all eight source coverage entries, and four complete weekly maintenance-time
buckets are present. Honest partial, failed, cancelled, and absent monitor runs
remain measurable outcomes; they are not hidden by relabeling the observation
window incomplete. Unknown delay, cost, winner, and review-time values remain
unknown rather than being imputed.
