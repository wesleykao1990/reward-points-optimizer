# Japan Rewards Optimizer Foundation v0.4.1 validation report

Validated: **2026-08-21 (Asia/Tokyo)**

## Result

**GO through the Milestone 7 challenge-infrastructure checkpoint and the
interim P0 provisional Agent Feed rehearsal for private experimental use. Broad
P0 coverage, canonical rule publication, the Milestone 4 operational
rehearsal, the evidence-backed 100-scenario workstream, and any real-data or
production consumer alpha remain pending.**

- JSON Schemas: 11;
- trusted sources: 144;
- access observations: 5;
- source review entries: 144;
- rehearsal sources: 8;
- seed scenario blueprints: 10;
- planned scenarios: 100, distributed 40/40/20;
- synthetic valuation fixtures reconcile with identical native ledgers and reverse the winner;
- semantic invalid-range self-tests reject invalid documents;
- prompt-injection fixtures produce no candidate/published rule;
- SQL structural checks passed;
- prototype syntax/build checks passed;
- prototype tests: 10/10 passed;
- browser/API smoke flow passed.
- Agent Feed `@agent-feed/schema@0.1.1` release pin matches the independently verified artifact URL, source commit, SHA-256, byte length, and SHA-512 integrity.
- consumer-alpha package tests: 28/28 passed;
- localhost consumer-alpha app tests: 23/23 passed.
- challenge-track tests: 41/41 passed.
- provisional-rule tests: 9/9 passed;
- database gate: 6 migrations, 2 seeds, and 10 SQL tests passed on PostgreSQL 16.

The prototype proves exact residual conservation, reward-class separation, valuation isolation, break-even sensitivity, reusable definition hashes, separate publication idempotency, bitemporal-overlap rejection, required review modes, and hostile Agent Feed intake rejection.

## Milestone 0 + 1A implementation verification

The TypeScript workspace passes lint, strict typechecking, all three contract validation commands, unit tests, property tests, and build. The preserved prototype still passes all ten regression tests, both valuation demos, and local health/evaluate smoke checks.

Independent review found and the implementation fixed mandatory contract-validation bypass, reusable-lot tender underfunding, contract-invalid synthetic asset fields, reward-exclusion targeting, unsupported aggregation handling, and the points-per-unit boundary proof.

## Milestone 1B implementation verification

The rule engine now exposes and integrates deterministic kernels for fixed and four-basis tiered rewards, multipliers, directed transfers, caps, stacking, feasible-state ranking, probability separation, and lifecycle adjustments. Transfer and refund operations preserve explicit principal movements; refund clawbacks are separate debit reward components. Transfer cancellation and reward expiry have a typed public event facade that requires explicit posting/expiry facts and does not mutate a candidate purchase plan. Unknown cap and enrollment states remain ranges or conditional outcomes rather than being coerced to zero or false.

The focused Milestone 1B suite covers threshold boundaries, all tier bases, cap partial/exhausted/reset/unknown/shared behavior, shared-pool reservation across concurrent rules, included-base suppression, conflicts and dependencies, compatible feasible states, useful questions, transfer constraints, fees, cancellation and cycle detection, probability policy, refund/reversal/expiry, and proportional/full/provider-defined clawback. Contract and engine checks bind lifecycle returns to the original tender asset, declared amount, and cumulative principal. Recommendation tests require concrete winner fields to agree with feasible-state outcomes. Property tests additionally prove cap monotonicity and that ranges derive only from enumerated compatible states while every Milestone 1A regression/property remains active.

An independent adversarial re-review reproduced the former shared-cap, refund-substitution, and contradictory-winner failures against the remediated public APIs and confirmed all three are closed. It also verified cancellation and expiry through the public package export. The resulting Milestone 1B decision is **GO**.

## Milestone 2 persistence verification

The additive `0003_milestone_2_hardening.sql` migration completes the persistence gate with transactionally sealed canonical replay, legal-hold-aware retention purge, review-mode and user-state constraints, immutable review/evidence enforcement for approvals, role-scoped `auth.uid()` RLS installation, and explicit current/default privilege revocation. Existing approved versions are validated during upgrade rather than grandfathered.

The adversarial SQL suite now generates replay-time pairs, verifies both invoker/barrier views, proves deny-before-policy behavior and two-user isolation on all ten forced-RLS tables, exercises approved-rule/source-snapshot/review-decision/replay immutability, checks profile-root deletion, and proves expired-history purge while preserving future and legal-hold records. A committed replay could not accept a later disposition link, and the complete migration/test chain also passed with a database owned by a `NOSUPERUSER`, `NOBYPASSRLS` role.

Independent review initially found post-commit replay augmentation and a purge dependency on superuser RLS bypass. Transactional replay sealing and narrow maintenance-owner RLS policies closed both reproductions; the final independent re-review found no remaining release blocker. The Milestone 2 decision is **GO**.

## Milestone 2.5 Agent Feed consumer verification

The consumer pins the immutable Agent Feed `schema-v0.1.1` release asset (`@agent-feed/schema` SHA-256 `9e020aba4e291f2e5328897dfb07195aaf392f6ecdd742b5c13b890cffdd9d6e`) and validates public delivery, finding, evidence, run-envelope, and run-bundle documents without importing Agent Feed server code. Its signed boundary verifies exact raw bytes, all seven tagged transport headers, HMAC-SHA256, key validity, body limits, and the replay window before invoking one atomic persistence port. A response is acknowledged only after that port resolves.

Transport and semantic identity remain separate: retries may change delivery ID, attempt, exact bytes, and transport hash while retaining a stable attempt-independent event hash; reward-domain duplicates link to one canonical observation. Supported findings remain untrusted, confidence is not promoted to authority, unknown types cannot create observations or rules, and submitted evidence remains lead-only until Rewards permission, independent capture/hash/locator, and approved review are present. The protocol-valid hostile run-bundle from the tagged Agent Feed release is validated, converted to a signed delivery fixture, quarantined with both security flags preserved, and retains an empty canonical-evidence list.

Run handling distinguishes started, completed-zero, partial, failed, cancelled, replayed, overdue, and never-seen states. The implementation matches the tagged producer's compact six-field terminal delivery shape, including `cancelled` carried by `run.failed`. Dead-letter, replay, attempt, and receipt payloads have append-only or fail-closed redaction controls, and no database or Realtime dependency crosses the project boundary.

The focused consumer suite passes 16 tests, strict typechecking, linting, and build. The M2.5 SQL gate proves receipt-before-ack storage, retry identity, semantic linkage, exact 17-field `SourceObservation` documents, hostile quarantine, evidence promotion, lifecycle/liveness incidents, and diagnostic redaction. An upgrade rehearsal also proves legacy terminal payload redaction, assessment normalization, and canonical-document backfill.

Independent read-only verification reproduced all 16 focused tests plus root typecheck, test, property, build, and lint gates; validated the hostile mapped observation against the app schema; and inspected the live PostgreSQL security-definer revocations, append-only triggers, and terminal-redaction constraints. It found no reproducible release blocker and issued a Milestone 2.5 **GO** verdict. The copied hostile fixture differs from the tagged file only in JSON whitespace; canonical sorted JSON is identical.

## Milestone 3 gate checkpoint

Milestone 3 is **in progress; no real scenario is golden**. The contracts package now audits the ten seed blueprints and 18 unique first-party sources against the trusted-source registry, review queue, and per-source technical observations. Authority and manual reachability do not grant automation, aggregate observations cannot establish an individual source state, malformed or duplicate source records fail closed, and an approved `manual_only` path remains distinct from automation readiness.

The fixture package now composes source readiness with an explicit promotion gate. Promotion requires the exact blueprint source set, verified evidence with an approved review decision for every primary source, independent calculation before engine replay, exact candidate/result coverage, negative assertions, conservation and CI replay artifacts, and the documented review modes. Early lifecycle states cannot become golden, and `JP-XFR-002` requires an accountable second human different from the builder and primary reviewer.

The current source data intentionally blocks all ten scenarios from promotion: all 18 sources remain `not_reviewed` and `requires_terms_review`; 17 have unknown technical feasibility, and one has only a manual-browser reachability observation. No permissions were inferred or changed. Real evidence capture, rule/scenario implementation, independent calculation, and human review therefore remain pending.

Focused M3 tests pass 8 source-gate cases and 14 promotion-gate cases. Independent verification initially reproduced five fail-open defects (empty source lists, duplicate observation IDs, substituted sources, duplicate plan coverage, and early-state promotion); the remediated checkpoint blocks all five and received a focused **GO**. The authoritative source map in the promotion module currently duplicates the blueprint and was manually verified equal; an automated parity check remains non-blocking follow-up debt.

## Database integration

The M2/M2.5 chain of four migrations and seven SQL tests was executed against isolated PostgreSQL **16.14** databases through `scripts/test_database.py`, both as the local superuser and as a non-superuser, non-`BYPASSRLS` database owner. A separate 0001→0003 legacy-data upgrade rehearsal passed before and after applying 0004. The current clean local chain additionally passed migration 0005, the generated M3 seed, and test 008: five migrations, one seed, and eight SQL tests in total. CI provisions PostgreSQL 16 and runs the same fresh-database gate.

## Milestone 4 implementation foundation

The Milestone 4 implementation foundation is **GO; the operational rehearsal is
still pending and remains `insufficient_data`**. The fixed eight-source cohort
is ordered and hash-bound. A new offline source-maintenance package implements
permission-aware direct checks, immutable snapshot/diff/materiality and
evaluation records, and deterministic two-lane metrics. It refuses malformed or
forged records at the reducer boundary, prevents synthetic canonical evidence,
requires compatible observed/planned/snapshot capture methods, and treats
completed zero-finding runs as successful only when their actual scope covers
the exact expected cohort.

The Agent Feed consumer now validates complete local run bundles with the pinned
published schema, snapshots input before asynchronous work, and normalizes a
whole run into deterministic immutable events. Persistence uses one explicit
atomic batch sink; malformed input, no sink, or a failing sink is not reported
as imported. Hostile findings remain lead-only and cannot create canonical
evidence.

Focused suites pass 17 source-maintenance and 27 Agent Feed consumer tests.
Root typecheck, tests, property tests, build, lint, and the offline package
validator pass; lint retains 53 pre-existing warnings outside M4. Independent
hostile review initially found fail-open method, record, coverage, callback,
and run-scope defects, reproduced each remediation, and issued final **GO**
verdicts for both lanes.

No real source was captured. All eight cohort sources remain terms
`not_reviewed` with unknown technical feasibility, so production Lane A work is
blocked. The real 30-day window, canonical evidence acquisition, atomic
persistence adapter, weekly maintenance observations, and final sustainable-mix
decision remain operational follow-up.

## Milestone 5 recommendation API foundation

The Milestone 5 implementation foundation is **GO for internal/synthetic use;
production is blocked**. The pure offline `@jro/recommendation-api` package
requires API version `1`, `Asia/Tokyo`, explicit transaction and replay-
knowledge times, exact merchant/branch resolution, and frozen comparison facts
that match every candidate merchant purchase by merchant, branch, amount,
channel, interface, line-item multiset, and transaction date. Candidate inputs
are normalized and partitioned into complete, disjoint eligible/rejected
results.

Trust admission requires exactly one concrete, versioned assurance per supplied
rule and evidence coverage. Stale, unresolved, lead-only, duplicate, missing,
or otherwise blocked trust states fail closed before engine evaluation. The
public response is deeply frozen, JSON serializable, BigInt-safe, excludes
engine canonical bodies, and exposes input/output hashes with independent
output-hash verification. Synthetic results are labeled `synthetic_only`.
Every production-mode request is blocked with
`production_authorization_unavailable`; a caller-provided green status cannot
bypass this gate.

The package also provides security admission with redacted stable diagnostics,
allowlisted redacted history and retention decisions, and hash-bound replay
authorization for synthetic, golden-fixture, and redacted-incident artifacts.
Legal holds, actor scopes, fixture manifests, incident approvals, and eventual
persistence are trusted server-side capabilities; the package contains no HTTP,
database, authentication, Agent Feed replay, or persistence adapter.

Focused recommendation API tests pass **26/26**. Independent core and security
re-reviews both issued **GO** verdicts, with the condition that trusted ports
remain server-side and inaccessible to untrusted callers.

This does not activate a real-data beta or current reward advice. M4 remains
`insufficient_data`, all eight operational sources remain `not_reviewed`, and
the deferred `JP-XFR-002` experiment remains a human research note pending
the required human review and evidence promotion.

## Milestone 6 local synthetic consumer alpha

The Milestone 6 checkpoint is **GO for localhost-only synthetic use; the real
consumer alpha and production remain blocked**. `@jro/consumer-alpha` provides
the closed immutable onboarding reducer, separate browser and trusted-host
evaluation events, deterministic catalog/manual-state normalization,
fail-closed presentation, a host-owned synthetic deep-link registry, and
bounded session-only correction admission.

`@jro/consumer-alpha-app` binds to `127.0.0.1` and accepts only exact synthetic
Tokyo merchant/branch IDs plus bounded manual wallet, fact, cap, purchase, and
per-asset stored-value inputs. Full normalized input determines the SHA-256
recommendation ID. Only displayed definite/conditional primary results enter
the bounded volatile issued-ID registry and can authorize a correction draft.
The browser receives no rule, candidate-plan body, evidence/source identifier,
canonical document, authorization data, cookie, or persisted state.

Unknown stored-value use yields a conditional safe direct-card route and never
a definite optimum. Custom values use exact decimal validation in the range
`0 < value <= 1`; stored-value opt-out withholds the top-up route. The fixture
does not expose a QR purchase candidate, real merchant/rule data, or verified
official external app links. All link targets are explicitly labeled
synthetic `.test` fixtures.

Independent reviewers initially reproduced hostile state representation,
credential/PII admission, precision overflow, catalog-scope, empty-selection,
ordering, correction binding, forged presentation, request-identity, unknown-
state, evidence leakage, and HTTP/deep-link failures. Final rechecks closed all
reproductions and issued **GO** verdicts for both the pure package and localhost
app. Focused suites pass 28 consumer-package and 23 app tests; root typecheck,
tests, property tests, build, and lint exit successfully. Lint reports the same
53 pre-existing warnings outside the M6 scope. A real loopback smoke run served
health, HTML, config, and a POST evaluation; the unknown stored-value request
returned the expected conditional safe direct-card result.

## Milestone 7 deterministic challenge infrastructure

The Milestone 7 control plane is **GO; the real evidence-backed challenge track
remains pending**. `@jro/challenge-track` validates the fixed 100-target plan
and its exact 40/40/20 levels and category totals against the trusted source
registry. Synthetic `SYN-M7-*` cases use a separate namespace and are
permanently excluded from evidence and golden coverage.

Plans, case sets, and runner results are host-minted capabilities rather than
forgeable structural claims. The batch runner requires one exact request and a
complete admitted-case bijection, snapshots each artifact once, separates raw
and canonical hashes, freezes evaluator inputs, and makes zero evaluator calls
when any preflight member is malformed, blocked, missing, duplicate,
substituted, or unexpected. The report validates plan-to-case and result
bindings and keeps declared, planned, bound, executed, passed, evidence-backed,
and golden counts distinct.

Independent hostile review initially reproduced forged-plan, alias, partial-
batch, replay-wrapper, cross-plan, and hostile-registry bypasses. All exact
reproductions are closed. The focused suite passes 41 tests, strict typecheck,
build, and scoped lint. The root CLI audit is byte-stable and reports 100
declared/planned targets, 0 executed, 0 evidence-backed, 0 golden,
`production_ready: false`, and explicit M3/M4 blockers.

## M3 manual real-data alpha checkpoint — 2026-08-20

The project owner approved manual use of paraphrased structured facts for the
first Seven-Eleven/nanaco slice; automated collection and copied page content
remain prohibited. The normalized source snapshots are stored without page
bodies, screenshots, or excerpts and are SHA-256 bound by schema-valid
`extracted` EvidenceRecords.

`JP-CVS-002` and `JP-CVS-006` now have isolated, materialized v1 golden
fixtures. Their replay inputs and outputs, engine/preflight result origins,
result artifacts, and canonical fixture hashes are independently recomputed and
verified; the reviewed calculation and challenge records are carried into each
fixture. A generated seed now persists the six approved EvidenceRecords and the
two golden scenarios in private canonical tables. Exact evidence/rule links and
one sealed replay are required before a scenario can commit as golden, and all
linked provenance is immutable. The six rule versions remain `under_review`,
have no publication requests, and are absent from the approved-rule API view;
the frontend remains synthetic-only and M7 accounting is unchanged. Replay
admission remains explicitly `publication_authorized: false`.

A deterministic publication dossier now binds the five publishable rule hashes to
their exact evidence, golden fixtures, and replay hashes. Its separate human
decision is still `pending`. Hostile self-tests reject candidate-hash mismatch,
pending authorization, incomplete confirmations, and agent-like reviewer IDs;
the all-or-nothing SQL generator therefore has not emitted a publication seed.
The deliberately synthetic unsupported-tender denial remains golden-test-only
and is explicitly excluded. A synthetic approval was generated only into
`/tmp` and executed against a disposable PostgreSQL 16.14 database: it created
five hash-identical version-2 rules, five immutable human-review decisions and
receipts, and exactly five API rows while leaving all six golden-bound version-1
candidates unchanged. That
test authorization is not present in the repository and grants no real
publication authority.

Encoding exposed a tax-basis defect. The purchase-plan contract now supports an
explicit per-line `tax_exclusive_amount_jpy`; semantic validation enforces that
it is no greater than tender, tax-exclusive rules must select eligible line
items, and the engine fails closed when the value is absent. A clean PostgreSQL
16.14 run passed all five migrations, the generated seed, and all eight SQL
tests. Production rule publication and consumer activation remain separate
follow-up decisions.

## Interim P0 provisional Agent Feed rehearsal — 2026-08-21

The private experimental ingestion lane is **GO for one exact P0 family-role;
it is not a canonical or production rule path**. `@jro/provisional-rules`
validates hostile representations and shared contracts, binds semantic source
roles separately from source authority, rejects publication/review claims, and
allows only primary-authority candidates to enter experimental selection.
Process-local capability branding prevents forged or rehydrated structural
lookalikes from using transition APIs.

Migration `0006_p0_provisional_rules.sql` adds immutable private candidates,
transitions, and correction signals plus a primary-only experimental view. A
fresh PostgreSQL 16 run applied all six migrations and both numbered seeds, then
passed all ten SQL tests. Independent `NOSUPERUSER` hostile probes confirmed
owner-only function access, fixed search paths, fail-closed JSON shape/type
checks, exact family-role/authority binding, non-primary activation denial, and
consistent lock ordering under contention.

The durable rehearsal imports one local Seven-Eleven payment-acceptance bundle.
Its receipt is explicitly unsigned/unverified, its submitted evidence remains
`lead_only`, and its rule remains `under_review` while the candidate is visible
only as `active_experimental`. Exact candidate and definition hashes match the
checked-in fixture and database seed. Credible corrections remove the candidate
from experimental selection; severe source/security corrections quarantine it.
No approved `RewardRuleVersion`, publication request, approved-rule API entry,
or frontend route is created.

This proves the lifecycle for one `merchant.7eleven` /
`accepted_payment_methods` tuple only. It does not populate all 44 P0 families.
Scaling requires truthful authorized producer runs, semantic
evidence-to-economic-rule support, extractor authenticity, and operational
correction adjudication; missing economic facts must not be invented.
