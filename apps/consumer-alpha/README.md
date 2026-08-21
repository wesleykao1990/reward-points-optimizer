# M6 local consumer alpha

This is a localhost-only, synthetic UI shell for the narrow M6 consumer
workflow. It binds to `127.0.0.1`, accepts only bounded manual onboarding state,
and keeps rules, assurances, evidence, candidate plans, source URLs, and
authorization material on the trusted host. The host constructs a fixture M5
request and projects the result to a small browser-safe presentation model.

Run the checks with:

```sh
pnpm --filter @jro/consumer-alpha-app test
pnpm --filter @jro/consumer-alpha-app typecheck
pnpm --filter @jro/consumer-alpha-app build
```

The correction route creates a `not_submitted` session-only draft. No browser
storage, cookies, authentication, live source collection, production mode, or
current reward advice is enabled.

The current fixture exposes one exact synthetic Tokyo branch, a direct card
route, and an optional stored-value top-up route. Unknown stored-value use is
shown as conditional. QR ownership can be recorded, but no QR purchase route
is evaluated; a supported card is required. All outbound links use the fixed
synthetic `.test` catalog and are not real official-app links.

Only displayed definite/conditional primary results enter the volatile,
128-entry issued-ID registry and can receive a correction draft. No-valid and
blocked results cannot authorize one. The registry and drafts disappear when
the process exits.
