# Milestone 5 recommendation API foundation review — 2026-08-19

## Decision

The pure implementation foundation for Milestone 5 is **GO for internal and
synthetic use; production is blocked**. Independent core and security lanes
both issued final **GO** verdicts. The authorization and persistence ports
described below remain trusted-host capabilities and must not be exposed to
untrusted callers.

This checkpoint does not authorize a real-data beta, current reward advice, or
production capture. The M4 operational rehearsal remains `insufficient_data`;
the fixed eight-source cohort is still `not_reviewed` with unknown technical
feasibility. `JP-XFR-002` remains deferred: the owner's ANA/Rakuten 2:1
statement is a research note, not approved canonical evidence or a completed
human second review.

## Implemented boundary

`@jro/recommendation-api` is a pure offline adapter around the deterministic
rule engine. It has no HTTP server, database adapter, authentication service,
Agent Feed replay path, or deployment integration. `synthetic_internal` requests
can evaluate synthetic fixtures and are labeled `synthetic_only`; every
`production` request returns the stable blocker
`production_authorization_unavailable`, regardless of caller-provided source
status.

The request contract requires API version `1`, `Asia/Tokyo`, explicit absolute
transaction and replay-knowledge times, a non-earlier replay-knowledge time,
merchant catalog/query, frozen comparison facts, candidate plans, rules,
assets, user state, valuation/objective policy, and source-maintenance status.
Only the two explicitly supported engine objectives are admitted:
`maximize_guaranteed_net_value` and `maximize_expected_net_value`.

## Merchant and candidate integrity

- Merchant and branch resolution uses canonical IDs or normalized exact aliases.
  A branch selector is mandatory; ambiguous aliases, mismatches, fuzzy lookup,
  and chain-to-branch inference are rejected.
- Frozen comparison facts bind every candidate merchant purchase to the exact
  merchant, branch, amount, channel, interface, line-item multiset, and
  transaction date. Candidates that do not match remain visible as rejected
  plans with stable reason codes.
- Candidate, catalog, asset, rule, assurance, and evidence ordering is
  normalized for deterministic hashing. The response preserves a complete,
  disjoint eligible/rejected candidate partition and exposes winner, safe,
  runner-up, conditional, assumptions, questions, freshness/evidence metadata,
  and valuation sensitivities.
- The public response contains only hashes for replay verification. Engine
  canonical input/output bodies are excluded; BigInt values become strings;
  responses are deeply frozen and JSON serializable. `verifyRecommendationHashes`
  recomputes the public output hash rather than trusting the envelope.

## Trust and security admission

Every supplied rule must have exactly one concrete assurance for its exact
`rule_id@version`, including at least one evidence record. Missing, duplicate,
unexpected, stale, unresolved, lead-only, or otherwise blocked trust states
fail closed before engine evaluation. A caller-provided green operational value
does not bypass the production gate.

The admission scanner rejects prohibited payment credentials and hostile
representations, including key/value evasion, PAN/CVV/PIN and token patterns,
dynamic QR/screenshot material, cycles, accessors, `toJSON`, prototype
pollution, unsupported values, BigInt where not admitted, and non-finite
numbers. Diagnostics are stable and redact sensitive path segments.

## Redacted history and authorized replay

History creation is an in-process decision/DTO boundary, not persistence. It
supports session-only, 30-day, 90-day, and user-selected retention. Persisted
records contain request/response hashes and an allowlisted redacted summary;
caller user IDs/references, PII, wallets, facts, and unverified hashes are not
accepted. Legal holds require a separately supplied trusted
`HistoryAuthorizationPort`; input flags cannot mint authorization.

Canonical replay accepts only `synthetic`, `golden_fixture`, and
`redacted_incident` classes. It recomputes request/result hashes, requires
sealed artifacts, `contains_user_data: false`, absolute times, engine/rules/
valuation versions, and host-authorized actor scopes. Synthetic/golden replay
requires a host-verified immutable fixture manifest. Redacted incidents require
a host-verified approval bound to both hashes and an allowlisted redacted
payload. Restricted user data, caller-supplied approval claims, client lookup,
token issuance, and Agent Feed replay surfaces are denied.

The host must implement and protect the actor, fixture-manifest, incident-
approval, legal-hold, and eventual persistence capabilities. This package does
not claim that an in-memory artifact is database-sealed or authenticated by
itself.

## Verification

- recommendation API focused tests: **26/26**;
- independent core re-review: **GO**;
- independent security re-review: **GO**;
- response partition, mutation isolation, merchant exactness, explicit-time
  binding, objective admission, trust coverage, production blocking, hash
  verification, redaction, retention, replay authorization, and hostile-input
  regressions are covered by the focused suites.

## Remaining work before a real beta

1. Complete source-specific terms/permission and technical feasibility review
   for the eight-source M4 cohort.
2. Run and persist the complete real 30-day two-lane rehearsal, including
   weekly maintenance-time buckets and the sustainable-mix decision.
3. Promote only independently confirmed, human-reviewed canonical evidence and
   approved reward rules; complete the deferred `JP-XFR-002` human experiment.
4. Add the trusted server adapters for authentication, history persistence,
   canonical replay sealing, and authorization-port enforcement before exposing
   any non-synthetic workflow.
