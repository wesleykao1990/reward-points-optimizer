# P0 provisional Agent Feed rehearsal review

Date: **2026-08-21 (Asia/Tokyo)**

## Decision

**GO for one private experimental family-role rehearsal. This is not broad P0
coverage, canonical publication, or production advice.**

The checkpoint proves that a validated local Agent Feed run bundle can be
mapped into an untrusted `SourceObservation`, admitted as an under-review
provisional candidate, persisted privately, selected only in an experimental
lane, and removed from selection after a credible correction.

## Implemented boundary

`@jro/provisional-rules` rejects hostile representations before dereference,
validates the shared `SourceObservation` and `RewardRule` contracts, and binds
each candidate to an exact P0 `(family_id, source_role_id)` tuple and known
source. Source authority is independent of the semantic role. Corroborating
observations may be retained for research but cannot activate; conflict
observations are rejected.

Migration `0006_p0_provisional_rules.sql` stores immutable private candidates,
transitions, and correction signals. Its three owner-only security-definer
adapters use a fixed `pg_catalog` search path, share a candidate advisory lock,
and expose only a security-invoker/barrier view of primary-authority active
experimental candidates. The database rejects legacy fields, missing or null
critical fields, publication/review claims, non-under-review rules, and
authority mismatches.

Seed `002_p0_provisional_rehearsal.sql` imports one exact checked-in
Seven-Eleven payment-acceptance run bundle. It deliberately records
`signature_verified=false`, retains submitted evidence as `lead_only`, and
persists the exact candidate and rule-definition hashes. It creates no approved
rule version, completed review, publication request, or frontend route.

## Independent hostile review

Independent review initially reproduced forged process envelopes, hostile
objects, terminal observation admission, prototype pollution, secret-like
keys, duplicate family-role handling, semantic-role/authority confusion, SQL
JSON NULL fail-open behavior, legacy-field acceptance, corroborating-source
activation, and inconsistent lock ordering. Each reproduction was closed and
rechecked.

The final database review used PostgreSQL 16 and a `NOSUPERUSER`, `NOINHERIT`
adapter role with only schema usage plus execute on the three intended
functions. Hostile shapes and authority substitutions failed closed; the valid
primary candidate activated once; the corroborating candidate remained hidden;
and correction concurrency completed without deadlock.

## Scope and next data step

Only `merchant.7eleven` / `accepted_payment_methods` is durably rehearsed. The
repository does not yet contain authorized Agent Feed producer runs for all 44
P0 source families, and Agent Feed itself is transport rather than a crawler.
Scaling this lane requires explicit producer inputs, truthful source-role
coverage, deterministic evidence-to-economic-rule support checks, extractor
authenticity, and correction adjudication. Missing rates, products, campaigns,
dates, or source relationships must never be inferred.

Canonical evidence promotion, human review, `RewardRuleVersion` publication,
production recommendation use, UI exposure, and unknown-world
`CoverageCandidate` discovery remain separate gated work.
