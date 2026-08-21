# `@jro/consumer-alpha`

Pure Milestone 6 consumer-state and presentation contracts for the local,
synthetic alpha. Production advice, persistence, authentication, live sources,
and client-supplied evaluator inputs remain disabled.

The package exposes a browser/user transition facade separately from trusted
host evaluation events. `transitionConsumerState` is trusted-host
orchestration and must never be wired directly to a browser event body.

It also provides fail-closed recommendation presentation, a fixed synthetic
`.test` deep-link catalog, and session-only correction admission without free
text. See
`docs/reviews/m6-local-synthetic-alpha-2026-08-19.md` for the verified scope and
remaining real-alpha blockers.
