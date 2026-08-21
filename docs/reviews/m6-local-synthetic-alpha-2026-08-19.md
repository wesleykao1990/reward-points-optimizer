# Milestone 6 local synthetic alpha review — 2026-08-19

## Decision

The Milestone 6 implementation checkpoint is **GO for a localhost-only,
synthetic consumer alpha; real-data and production use remain blocked**. Two
independent hostile reviews issued final **GO** verdicts after reproducing and
rechecking all remediation findings.

This decision does not complete the real Tokyo convenience-store alpha. It
does not authorize current reward advice, real merchant/rule coverage,
production source access, official external app links, authentication,
persistence, or deployment. The M4 operational gate remains
`insufficient_data`, and the deferred `JP-XFR-002` human experiment remains a
non-evidentiary research note.

## Pure consumer boundary

`@jro/consumer-alpha` provides a closed, immutable onboarding state machine,
safe recommendation presentation, a host-owned synthetic deep-link catalog,
and bounded correction admission.

- The catalog requires exact Tokyo merchant/branch IDs and rejects unknown or
  missing city scope.
- Browser/user transitions are separated from trusted-host evaluation events.
  The general reducer is explicitly a trusted-host orchestration API and is
  not a browser admission boundary.
- Owned assets, manual facts, caps, per-asset stored-value answers, and custom
  valuations are structurally admitted, canonicalized, sorted, and deeply
  frozen. Unknown values remain unknown rather than becoming false or zero.
- Custom stored-value values use exact decimal checks with bounded length and
  the range `0 < value <= 1`; binary floating-point rounding cannot expand the
  range.
- Corrections are session-only, contain no free-text narrative, retain the
  displayed result, and must match its SHA-256 recommendation hash.
- Positive presentation is possible only for exact `synthetic_internal` /
  `synthetic_only` responses. Production, blocked, malformed, or forged modes
  expose no routes or positive economic claims.
- Synthetic deep links are selected only by opaque host-owned IDs and resolve
  only to the fixed `.test` fixture host.

## Localhost application

`@jro/consumer-alpha-app` is a small Node.js and static-DOM shell bound to
`127.0.0.1`. The browser can submit only a bounded manual-state DTO. Rules,
candidate plans, assurances, evidence, source URLs, canonical documents, and
authorization material remain host-owned.

The current fixture slice supports an exact synthetic Tokyo branch, a direct
synthetic card plan, and an optional stored-value top-up plan. A QR wallet may
be recorded as owned but no QR purchase route is exposed; a card remains
required for this fixture slice. Stored-value opt-out removes the top-up
candidate, and an unknown usage answer yields a conditional safe card route
rather than a definite optimum. Unsupported ownership combinations fail with
an explicit bounded input error before evaluator construction.

Full admitted input is normalized and SHA-256 hashed into the recommendation
ID. Corrections require an ID issued for a displayed definite/conditional
primary result. The volatile issued-ID registry retains at most 128 entries;
no-valid/blocked results cannot authorize corrections, and there is no HTTP
reset or persistence surface.

The browser projection is allowlisted and source/evidence-free. It uses
`textContent`, strict CSP/security headers, no CORS, no cookies, and no browser
storage. API and fixture-link routes reject query parameters, oversized or
non-JSON bodies, hostile POST `Host`/`Origin`, unsupported methods, traversal,
and arbitrary URLs. Fixture links are labeled synthetic; they are not called
official links or current services.

## Hostile findings closed

Independent review initially reproduced fail-open handling of Proxy and hidden
state, credential-bearing facts, floating-point valuation overflow, unknown
Tokyo scope, empty wallets, order-dependent state, unbound corrections,
blocked/malformed presentation routes, valuation above face value, unresolved
questions labeled definite, duplicate fallback, request-ID collisions,
unissued correction drafts, forged verified output, source/evidence leakage,
misleading official-link labels, and generic unsupported-ownership failures.

The final rechecks confirmed that every reproduction is closed, including PAN,
Bearer token, email, accessor, Proxy, non-enumerable-field, deep-link hostname,
query, traversal, hostile authority, and issued-registry eviction probes.

## Verification

- consumer package tests: **28/28**;
- localhost app tests: **23/23**;
- independent consumer-package review: **GO**;
- independent localhost-app review: **GO**;
- root typecheck, tests, property tests, build, and lint exit successfully;
- root lint retains **53 pre-existing warnings** outside the M6 files;
- an actual loopback smoke run served `/health`, `/`, `/config`, and a POST
  evaluation whose unknown stored-value answer returned a conditional safe
  direct-card route;
- the offline Python package validator and checksum gate pass after the
  milestone record is regenerated.

## Remaining work before a real consumer alpha

1. Complete the M4 source-specific terms, permission, and technical-method
   review, then run the real 30-day rehearsal.
2. Capture, independently calculate, review, and promote evidence/rules only
   for the exact merchant, wallet, stored-value, and QR routes exposed.
3. Replace synthetic `.test` link fixtures with separately verified,
   host-owned official-app mappings; never infer them from user input.
4. Implement and verify an actual QR-wallet candidate route before claiming QR
   optimization coverage.
5. Add authenticated server-side sessions, durable correction intake, history
   policy, and deployment controls before any network-accessible beta.
