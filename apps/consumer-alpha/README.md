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

The home page also shows host-owned Japanese `先行公開データ` cards. The local
demo port builds its 11 payment-family cards from the checked-in Agent Feed run
bundle, coverage index, and generated candidate set; a database-backed host
may be injected without changing the browser or HTTP contract. Cards show only
an opaque publication identity, kind, bounded Japanese title/summary, coarse
confidence, source label, and dates. Hashes, rule payloads, evidence, source
identifiers, and URLs stay on the trusted host.

The `情報` tab exposes the separate generic P0 implementation-fact catalogue.
Its default localhost port reads the checked-in 87-fact implementation
snapshot; a host may inject either the browser-safe fact port or the bounded
`@jro/agent-feed-postgres` implementation store. `GET
/api/experimental/facts` returns `{ "status", "updated_at", "facts" }` with an
opaque UUID, Japanese family/claim labels, subject, predicate, summary, and
`use_in_comparison` for each card. Search and filters run over the returned
bounded list in the browser. The fixture response is explicitly `partial`
because it contains the current 87-fact slice; a database-backed port pages
through the full bounded catalogue before returning `ready`. `POST
/api/experimental/fact-corrections` accepts only `{ "fact_key", "category" }`;
the trusted host binds the opaque UUID to one exact implementation fact and
the database view hides only that fact after recording the correction. No
source IDs, hashes, evidence locators, raw values, parent claim IDs, reasons,
or internal statuses cross the browser boundary.

`GET /api/experimental/rules` returns exactly
`{ "status", "updated_at", "rules" }`. The status is `ready` or `partial`, and
each rule is a browser-safe card with `display_status:
"experimental_unverified"` for audit separation. The Japanese UI presents
these cards as `先行公開` and invites corrections without an approval gate.
A correction is the exact two-field JSON DTO `{ "publication_id", "category" }`.
The host resolves that publication version and owns all hashes, credibility,
severity, timestamps, and persistence details; the response is only a safe
acceptance acknowledgement. Unknown, repeated, stale, malformed, or throwing
port results fail closed. The demo port is volatile and disappears when the
process exits.

Pass a trusted implementation of `ExperimentalCataloguePort` to
`handleRequest`, `createAppServer`, or `startServer` to connect a persistence
adapter. The app imports no database driver.

Only displayed definite/conditional primary results enter the volatile,
128-entry issued-ID registry and can receive a correction draft. No-valid and
blocked results cannot authorize one. The registry and drafts disappear when
the process exits.

The PostgreSQL migration chain separately provides
`app_api.experimental_economic_claims`, an internal invoker/barrier view over
verified evidence linked to under-review economic rule versions. The default
localhost build does not open a database connection or grant client access;
an app-server adapter may query that view with an explicitly privileged
server role and map only its bounded projection. Raw Agent Feed observations,
approved-rule status, and browser database credentials are never implied.
