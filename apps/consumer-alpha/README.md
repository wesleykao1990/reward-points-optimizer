# M6 local consumer alpha

This is a localhost-only consumer prototype. It exposes one bounded merchant
comparison journey at `POST /api/recommendations`, which evaluates the
synthetic card route alongside the Nanaco purchase and Seven Card Plus ->
Nanaco credit-charge experiments when their host ports are available. It
binds to `127.0.0.1`, accepts only bounded consumer inputs, and keeps rules,
assurances, evidence, candidate plans, source URLs, database credentials, and
authorization material on the trusted host.

Run the checks with:

```sh
pnpm --filter @jro/consumer-alpha-app test
pnpm --filter @jro/consumer-alpha-app typecheck
pnpm --filter @jro/consumer-alpha-app build
```

Run the populated P0 database-backed UI with:

```sh
JRO_DATABASE_URL=postgresql://.../jro_local \
  pnpm --filter @jro/consumer-alpha-app start
```

`JRO_DATABASE_URL` is explicit and server-only. When set, one bounded pool
backs the experimental catalogue, its correction route, all 364 P0
implementation facts, and the exact Nanaco/Seven-Eleven experimental
recommendations. Without it the localhost shell retains its checked-in demo
catalogues; each unavailable real route remains visible with a route-scoped
issue instead of suppressing its valid neighbors.

The unified response returns one safe record per route. Records distinguish
`calculation` from `information_only`, report `eligible`, `conditional`,
`no_valid_plan`, `blocked`, or `unavailable`, and classify campaign validity
as `active`, `scheduled`, `expired`, or `unknown`. A graph outage is shown as
`facts_unavailable` while preserving a valid numeric result; an exact applied
fact binding failure blocks only the affected route. Displayed recommendation
IDs are host-issued and are the only IDs accepted by
`POST /api/recommendations/corrections`.

The real-data route accepts gross amount, tax-exclusive eligible amount,
Nanaco balance, and an explicit effective time. It requires the exact active
payment-acceptance and earning candidates, applies the source-stated floor of
one Nanaco point per tax-exclusive ¥200, and leaves JPY valuation empty. Its
PostgreSQL composition compiles the current reward candidate into a
source/evidence/hash-bound Rule IR record with explicit host-owned assets and
principal edges before generating the request-specific purchase plan; it does
not inject the checked-in Nanaco rule when the database route is active. Its
response is always labeled `experimental_real_data` and
`experimental_unverified`; it is neither a canonical publication nor current
production advice.

The database-backed shell also exposes a separate Seven Card Plus -> Nanaco
credit-charge experiment at `POST
/api/experimental/nanaco-credit-charge`. It requires explicit card ownership,
Nanaco credit-charge preregistration, charge amount, current Nanaco balance,
and effective time. The host enforces the reviewed JPY 5,000 minimum, JPY 1,000
increment, JPY 30,000 per-charge maximum, JPY 50,000 post-charge balance cap,
and one Nanaco point per JPY 200. This is one stored-value top-up operation;
the created principal balance and the reward points remain separate, and no
JPY valuation is invented. The internal response retains its audit status; the
customer UI presents the route neutrally and exposes none of its evidence,
source, rule, or hash bindings.

The correction route creates a `not_submitted` session-only draft. No browser
storage, cookies, authentication, live source collection, production mode, or
current reward advice is enabled.

The legacy synthetic endpoint still exposes one exact Tokyo test branch. The
browser now starts with a neutral general-shopping merchant; Seven-Eleven is
an explicit merchant choice and only that choice adds the Nanaco routes.
Enabling credit cards, mobile payments, or point programmes expands an exact
allowlisted catalogue of seven card families, six mobile-payment families,
and eight point families. The selected cards and mobile payments create real
calculation candidates from their structured base-rate claims, so selection
changes both the arithmetic result and the recommendation/correction hash.
Selected point programmes feed the deterministic point-spending graph.
Home does not expose a generic electronic-money switch or a global
`use / do not use` valuation question. Electronic money is represented only by
named, service-specific routes such as Nanaco, with inputs collected when that
route is relevant.
Home and Wallet identify each of the 21 selectable service families with a
locally served logo retrieved from the provider's official public website.
The adjacent Japanese service name remains the accessible label; decorative
logo images have empty alternative text. Source URLs and trademark handling
notes are recorded in `public/assets/payment-logos/SOURCES.md`.
Home presents every service directly without a family-level enable switch. The
whole service card is the mobile-sized checkbox target, and its border and
checkmark communicate the selected state.

The Wallet tab exposes the same 21 service families plus the deterministic
fixed-ratio point-spending graph. Only complete transfer/redemption claims are
calculated. Current official lottery, draw, game and scratch links appear in
the matching service block in the Catalogue tab and never enter recommendation
arithmetic.

The `カタログ` tab presents one block per customer-facing service family. Each
block combines its useful fact summaries, host-owned routes, and current
official campaign links instead of exposing separate records by claim type.
The local demo port builds its Seven-Eleven payment-family records from the
checked-in Agent Feed run bundle, coverage index, and generated candidate set;
the browser groups those methods into one merchant block. Exact duplicate facts
are collapsed, internal predicates and record counts are hidden, and one
service-level wrong-information control identifies the exact fact on the
trusted host. Hashes, rule payloads, evidence, source identifiers, and raw URLs
stay on the trusted host.

The five mobile tabs are ordered Home, Wallet, History, Catalogue, and
Settings. Wallet and History are session-only views of the unified selection;
they do not claim persistent account state. The `カタログ` tab exposes the
customer-facing projection of routes and implementation facts on one surface.
Its default localhost port reads all 364 checked-in implementation facts; a
host may inject either the browser-safe fact port or the bounded
`@jro/agent-feed-postgres` implementation store. `GET
/api/experimental/facts` returns `{ "status", "updated_at", "facts" }` with an
opaque UUID, Japanese family/claim labels, subject, predicate, summary, and
`use_in_comparison` for each fact. Search and the service-family filter run over
the returned bounded list in the browser before facts are grouped into service
blocks. The checked-in fixture is labeled `partial` for
provenance even though it contains all 364 facts in this wave; a database-
backed port pages through the full bounded catalogue before returning `ready`.
`POST
/api/experimental/fact-corrections` accepts only `{ "fact_key", "category" }`;
the trusted host binds the opaque UUID to one exact implementation fact and
the database view hides only that fact after recording the correction. No
source IDs, hashes, evidence locators, raw values, parent claim IDs, reasons,
or internal statuses cross the browser boundary.

## Internal Agent Feed delivery

The server contains one optional, server-only delivery boundary at
`POST /internal/agent-feed/events`. It is not a browser API and is `404` unless
the host injects an `agentFeedIngress` port into `AppDependencies`. When
enabled, the route forwards the untouched request bytes and the seven
`x-agent-feed-*` signature headers to `createAgentFeedConsumerHandler`; it does
not parse or re-encode the signed body first. GET, query-string, cross-origin,
unsigned, stale, malformed, and tampered requests fail closed.

`createP0AgentFeedIngress` composes the generic atomic consumer persistence for
run-start and finding deliveries with
`createPostgresP0TerminalAtomicPersistence` for terminal deliveries. The host
must supply the current admitted P0 operations manifest and an exact
`reconciliation_by_run_id` map for the five live recovery runs. Each map entry
is checked against the manifest before the port is created; no run ID, target,
locator, outcome, or economic claim is discovered from Agent Feed. A terminal
event without an exact host mapping is rejected by the persistence boundary.

Signing can use a host-owned resolver or the environment resolver. The latter
reads only `JRO_AGENT_FEED_SIGNING_KEY_ID` plus
`JRO_AGENT_FEED_SIGNING_SECRET` (or the secret file named by
`JRO_AGENT_FEED_SIGNING_SECRET_FILE`). These values stay in the process and
are never returned in HTTP responses or diagnostics. The browser receives only
the bounded acknowledgement, outcome status, and opaque Rewards receipt ID.

The normal `dist/server.js` startup composes this port automatically when
`JRO_AGENT_FEED_RECONCILIATION_FILE` is set together with the signing key
variables. The reconciliation file may be a raw `{ "run_id": reconciliation }`
object or the strict `p0-agent-feed-reconciliation-map.v1` wrapper containing
`plan_sha256`, `manifest_sha256`, and `reconciliations`. The current admitted
plan is loaded from
`JRO_P0_SOURCE_ROLE_PLAN_FILE` when set, otherwise from
`registry/planning/p0-source-role-plan.v0.1.json` relative to the process
working directory; its derived manifest must match every reconciliation entry.
Missing, stale, malformed, or incomplete configuration aborts startup rather
than exposing an unauthenticated endpoint. A map entry may contain a completed
subset of a family work unit when the current P0 operations admission permits
that exact subset; it is still bound to the run, stream, family, hashes, and
checkpoint identities.

`GET /api/experimental/rules` returns exactly
`{ "status", "updated_at", "rules" }`. The status is `ready` or `partial`, and
each rule is a browser-safe card with `display_status:
"experimental_unverified"` for internal audit separation. The Japanese UI does
not render that implementation status; it groups related routes with the point
families and provides a wrong-information report action on every card.
A correction is the exact two-field JSON DTO `{ "publication_id", "category" }`.
The host resolves that publication version and owns all hashes, credibility,
severity, timestamps, and persistence details; the response is only a safe
acceptance acknowledgement. Unknown, repeated, stale, malformed, or throwing
port results fail closed. The demo port is volatile and disappears when the
process exits.

Pass a trusted implementation of `ExperimentalCataloguePort` to
`handleRequest`, `createAppServer`, or `startServer` to connect a persistence
adapter. The normal CLI composition performs this injection only when
`JRO_DATABASE_URL` is present; browser code never imports the database driver.

Only displayed definite/conditional primary results enter the volatile,
128-entry issued-ID registry and can receive a correction draft. No-valid and
blocked results cannot authorize one. The registry and drafts disappear when
the process exits.

## Hosted alpha adapter

The loopback server remains the local development host. The repository also
contains a bounded Vercel Node adapter at `src/vercel-adapter.ts`; it rechecks
the forwarded HTTPS host and same-origin browser authority before passing the
request to the existing application contract. The adapter requires a
server-only `JRO_DATABASE_URL`, selects the NOLOGIN `jro_runtime` database role
inside each transaction, verifies Supabase pooler TLS with the published CA,
and keeps the client pool at one connection per warm serverless instance.

The hosted route is still an experimental alpha, not current reward advice.
It does not enable Supabase Auth, public Data API access, Agent Feed ingress,
or durable user/session state. See `docs/28_deployment_vercel_supabase.md` for
the exact deployment and release automation boundary.

The PostgreSQL migration chain separately provides
`app_api.experimental_economic_claims`, an internal invoker/barrier view over
verified evidence linked to under-review economic rule versions. The default
localhost build does not open a database connection or grant client access;
an app-server adapter may query that view with an explicitly privileged
server role and map only its bounded projection. Raw Agent Feed observations,
approved-rule status, and browser database credentials are never implied.

## Front-end presentation

The browser shell uses a printed-ledger visual system: a warm off-white paper
ground, indigo ink for structure and the primary action, and a single
vermilion accent reserved for the seal and for peak moments (the urgent
expiry, the best-route kicker). Depth comes from hairline rules and recessed
paper wells rather than shadows, blur, or gradients, and every glyph comes
from one 24x24 outline set at a 1.6px stroke. A `prefers-color-scheme: dark`
block re-tints the same tokens onto warm charcoal stock; no component defines
a colour outside the token layer.

Typography is a system stack by design. The strict same-origin CSP and the
"nothing leaves the browser" stance rule out a webfont CDN, so display
headings and figures use the platform Mincho families with Gothic for body
and UI, and figures carry `tabular-nums`.

The bottom bar carries four peer destinations - `home`, `expiry`, `wallet`,
`information`. The session log and the handling/privacy notes are sub-pages
reached from a header control; they are ARIA regions, not tab panels.

## Expiry advisor (demo data)

The `expiry` panel answers "which points am I about to lose, and where do I
shop to stop that?" for each recorded point programme: the remaining runway,
whether the deadline can be moved at all, the single concrete action that
moves it, and the chains where that action is available. A merchant-first
board inverts the same dataset so one errand can be planned against several
deadlines at once.

No balance, expiry, or account backend exists yet. The panel therefore runs
entirely on a checked-in demo dataset in `public/app.js`, stores days relative
to "today" so a deadline is never rendered in the past, and labels itself as
demo data in the markup. Nothing there is a published rule, nothing is sent
anywhere, and each card links back into the catalogue for the recorded source
information.
