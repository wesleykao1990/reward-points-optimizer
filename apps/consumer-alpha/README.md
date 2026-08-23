# M6 local consumer alpha

This consumer prototype exposes one bounded merchant comparison journey at
`POST /api/recommendations`, which evaluates the
synthetic card route alongside the Nanaco purchase and Seven Card Plus ->
Nanaco credit-charge experiments when their host ports are available. It
binds to `127.0.0.1` locally, accepts only bounded consumer inputs, and keeps
rules, assurances, evidence, candidate plans, database credentials, and
authorization material on the trusted host. Browser DTOs may include only the
official source URL and last-checked date needed to verify displayed guidance.

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
implementation facts, the active structured Agent Feed reward-rule
projection, and the exact Nanaco/Seven-Eleven experimental recommendations.
Without it the localhost shell retains its checked-in demo
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
browser starts with neutral general shopping and populates every currently
covered merchant family from `GET /api/consumer/reference`; Seven-Eleven is no
longer the only named choice. Only that merchant adds its Nanaco-specific
routes.
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

The five mobile tabs are ordered Balance, Spend, Earn, Catalogue, and
Settings. Earn keeps a session-only comparison history and does not claim
persistent account state. The `カタログ` tab exposes the
customer-facing projection of routes and implementation facts on one surface.
Its default localhost port reads all 364 checked-in implementation facts; a
host may inject either the browser-safe fact port or the bounded
`@jro/agent-feed-postgres` implementation store. `GET
/api/experimental/facts` returns `{ "status", "updated_at", "facts" }` with an
opaque UUID, stable `family_id` and `claim_type`, Japanese family/claim labels,
subject, predicate, summary, and `use_in_comparison` for each fact. Search and
the service-family filter run over
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

Findings that carry an exact `reward-claim.v1` document do not enter a manual
promotion queue. The ingress matches the signed finding's `target_id` to the
delivery stream's admitted operations manifest, then intersects source IDs
with the frozen P0 coverage index. Each valid sibling is compiled, persisted,
and atomically activated. Invalid or incomplete siblings remain rejected
without suppressing valid ones, and no summary or other prose is converted to
reward arithmetic. `JRO_P0_COVERAGE_INDEX_FILE` can override the default
checked-in coverage index used for this binding.

The normal PostgreSQL runtime reads those `active_experimental` compiler
candidates on every effective-time recommendation request. A computable active
candidate automatically replaces the checked-in bootstrap rate for its exact
service family; there is no second promotion endpoint, reviewer click, feature
tag, or browser gate. Merchant, branch, channel, tax basis, transaction limits,
conditions, caps, rounding, output certainty, validity, and provenance remain
structured rule inputs. If one candidate cannot be evaluated for the request,
it is skipped without hiding an applicable sibling or another service family.

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

The hosted route does not enable Supabase Auth, public Data API access, the
private Agent Feed delivery endpoint, or durable user/session state. See
`docs/28_deployment_vercel_supabase.md` for
the exact deployment and release automation boundary.

The PostgreSQL migration chain separately provides
`app_api.experimental_economic_claims`, an internal invoker/barrier view over
verified evidence linked to under-review economic rule versions. The default
localhost build does not open a database connection or grant client access;
an app-server adapter may query that view with an explicitly privileged
server role and map only its bounded projection. Raw Agent Feed observations,
approved-rule status, and browser database credentials are never implied.

## Front-end presentation

The browser shell is an award-wallet console: white cards on a cool grey
ground, one hairline border and one soft elevation step, 10-12px radii, and
full-round status chips. Colour is signal rather than decoration - the
primary blue carries action, selection and navigation, while red/amber/green
carry only expiry state, so the two channels stay readable side by side.

Latin type is Archivo and figures are JetBrains Mono on a tabular grid, so
balances and countdowns align down a column. Both faces are Latin-subset
variable woff2 files served from this origin (`public/assets/fonts`, 66 KB
total) rather than a font CDN: the strict same-origin CSP and the "nothing
leaves the browser" stance rule out a third-party request, so `font-src
'self'` is the only relaxation and no external host sees a visitor. Japanese
runs in the platform Gothic stack; no CJK webfont is shipped.

The bottom bar carries five peer destinations - `balance`, `spend`, `earn`,
`information`, `settings`. Balance is the landing tab because the award-wallet
job is a daily glance rather than a per-purchase query; the merchant
comparison keeps its full behaviour as `earn`, with the session log folded
into it.

## Lot ledger (demo data)

An aggregator stores one number per programme. This screen stores lots: a
通常 balance and a 期間限定 grant are different assets with different
deadlines, different places they can be spent, and different answers to "can
this deadline be moved at all?" Each programme card expands into its lots,
and each lot carries its own countdown, its usage restriction, its
`延長できる / できない` verdict, and its `推定 / 確認済み` confidence. Rule
exceptions are pinned to the lot they qualify rather than to the programme -
the 「KDDI定期付与」 case renders as a flagged note on the Ponta lot it
actually affects.

Above the list, a 90-day runway sizes bars by yen value and colours them by
urgency; tapping one jumps to `spend` with that lot loaded and the
expiring-balance objective preselected. Every yen figure is backed by a
`この前提で計算` disclosure naming the per-programme valuation and stating
plainly that the total is an "if I lost this today" figure, not a maximised
one. Every expiry rule shows its source and how recently it was checked.

No balance or account backend exists yet. The panel therefore runs on a
checked-in demo balance dataset in `public/app.js`, while expiry and redemption
reference fields load from `/api/consumer/reference`. It stores days relative to
"today" so a deadline is never rendered in the past, and says so in the
markup. Balance capture is deliberately credential-free - screenshot, paste,
CSV and manual entry are presented as the intended routes, all marked
準備中 - and the settings screen states what the product does not collect.

## Motion

The motion vocabulary is adapted from yui540's public CSS studies
(https://github.com/yui540/css-animations): a diagonal `clip-path` wipe
driven by a `--skew-x` variable, paired sheets offset by roughly 0.2s, and
one signature easing - `cubic-bezier(0.87, 0.05, 0.02, 0.97)` - that
loiters at both ends and snaps through the middle. Every reveal in the app
uses that curve, so the whole surface reads as one system.

What is deliberately not adapted is the amplitude. Those studies are
0.8-1.0s showpieces for a page you visit once; this is a wallet somebody
opens at a till. The same shapes therefore run at about a third of the
length for anything frequent - a 340ms panel wipe on tab change, a 320ms
lot expand - and the full-length treatment is spent only on moments that
happen once per visit: the 620ms opening sheet and the 720ms comparison
result reveal. Balance figures count up on the same curve so the number
settles on the beat the panel does, and the runway bars grow from the axis
in a 38ms stagger, which puts the eye on the tallest column while it is
still the only thing moving.

Two invariants hold throughout:

- **Nothing is visible only because an animation ran.** The resting DOM is
  the finished state; reveals are opt-in classes added by script. A failed
  script, a blocked stylesheet, or a disabled animation still leaves
  readable content. The opening sheet additionally removes itself on
  `animationend` and on a timeout, so a stalled animation can never strand
  a panel over the interface.
- **`prefers-reduced-motion: reduce` clears the reveal states outright**
  rather than merely shortening them, since a reveal held at its `from`
  keyframe would be invisible. Under that setting the curtain never
  renders, figures print their final value, and every panel is static.
