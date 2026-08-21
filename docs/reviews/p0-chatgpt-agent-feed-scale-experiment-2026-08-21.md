# P0 ChatGPT Scheduled Task -> Agent Feed scale experiment

Date: 2026-08-21
Scope: acquisition and transport only; no canonical rule publication
Decision: continue the bounded P0 trial, but do not treat the current ChatGPT
Scheduled Task as the production scheduler for all P0 coverage.

## Executive conclusion

The experiment proved that ChatGPT Scheduled Tasks can call the generic Agent
Feed lifecycle, close every begun run honestly, and leave durable receipts that
can be reconciled in PostgreSQL. It also proved that the current work unit is
too large and the control plane is incomplete for dependable bulk operation.

The database was not the bottleneck. The dominant problems were:

1. one scheduled occurrence combined 64 research targets with eight run
   lifecycles and optional evidence submission;
2. research and exact-schema construction competed for the same model context;
3. rejected `submit_batch` calls returned insufficiently precise validation
   paths;
4. none of the 19 P0 streams had Agent Feed liveness, schedule, expected-
   occurrence, job-definition, or deployment-binding records;
5. ChatGPT account task capacity and browser/session state are separate from
   Agent Feed scheduling and delivery state.

The production direction is therefore: register the P0 work in Agent Feed's
job and occurrence control plane, use small stream-sized resumable units with a
machine preflight, and retain ChatGPT Scheduled Tasks as a bounded research
producer or sentinel. The scalable primary path should ultimately be an API or
workflow producer using the same Agent Feed protocol.

Subsequent evidence strengthens that decision. Supplying known first-party
locators raised one occurrence to 62/64. A separate two-role nanaco recovery
run then completed the exact gap, giving cumulative receipt-backed locator
coverage of 64/64. Another broad rerun fell to 37/64 even with the better
prompt, proving that broad occurrence output remains time- and navigation-
variant and must not overwrite prior successes.

The economic-delivery failure is now localized to the connector schema, not
the Agent Feed service or the source pages. The live tool declaration exposed
only `{findings}` or `{evidence}` because a validation-only top-level `anyOf`
was compiled as alternative tool argument shapes. The actual protocol requires
nine root fields. The correctly constructed request therefore failed at `$`
before service validation or database persistence.

## Experiment scope

The deterministic task pack is
`registry/planning/p0-chatgpt-task-pack.v0.1.json`:

| Item | Count |
| --- | ---: |
| P0 source families | 44 |
| Required family-role targets | 301 |
| Agent Feed streams | 19 |
| Proposed ChatGPT tasks | 6 |

Only `p0.1-core-point-ecosystems` was run. It contains eight point families,
eight streams, and eight required source roles per family: 64 targets total.
The other five task definitions remain deferred until the trial gates below are
met.

## Verified runtime evidence

### Connectivity smoke

Run `0332d121-9d22-4f8d-b552-16ea0c995644` used producer
`chatgpt-scheduled-task` and stream `economy.rakuten`. It reached terminal
`completed` with zero batches, findings, and evidence. This established the
plugin -> tunnel -> Agent Feed -> PostgreSQL path, but did not establish useful
research throughput.

### First P0 occurrence

The first manual occurrence began and terminated all eight streams as
`partial`. It attempted all 64 roles and reported 44 first-party roles verified
(68.75%). PostgreSQL contained the eight terminal runs and no accepted batch,
finding, or evidence rows.

| Stream | Verified roles |
| --- | ---: |
| `economy.aeon-waon` | 7/8 |
| `economy.au-ponta` | 5/8 |
| `economy.docomo` | 6/8 |
| `economy.paypay` | 6/8 |
| `economy.rakuten` | 5/8 |
| `economy.seven-nanaco` | 5/8 |
| `economy.vpoint-smbc` | 6/8 |
| `transit.jre-suica-view` | 4/8 |

A bounded submission failed validation. The task did not convert that rejection
into a success claim and recorded a safe diagnostic in the terminal run.

### Exact-shape correction probe

Run `b530e619-e451-44e8-ad3c-66357fe132c7` reached terminal `partial` and
accepted:

- batch `p0-docomo-source-20260821`;
- finding `p0-docomo-expiry-source-20260821`;
- evidence `p0-docomo-expiry-evidence-20260821`.

PostgreSQL independently showed the finding as `coverage_candidate` and
`lead_only`, the evidence as `contains_secrets=false`, and the uncomputed
`content_hash` as null. This proves the transport can carry one correctly
shaped untrusted lead without turning it into canonical economic truth.

### Second P0 occurrence

A second manual `Run now` occurrence completed at 2026-08-21 16:59 JST. The
ChatGPT report claimed eight terminal `partial` receipts, 43 of 64 first-party
roles verified, and no accepted batch, finding, evidence, or
`RewardRuleVersion` action. PostgreSQL independently matched every Run ID,
terminal status, actual scope, diagnostic, and zero accepted-row count:

| Stream | Run ID | Verified |
| --- | --- | ---: |
| `economy.aeon-waon` | `de871864-39ee-46b1-ad0f-3ad2c1c5cadd` | 7/8 |
| `economy.au-ponta` | `1fdd38fc-0195-4bf0-b995-6b41bef3cf8d` | 2/8 |
| `economy.docomo` | `f55a050c-9a99-4307-8c9e-7a374b2dccda` | 7/8 |
| `economy.paypay` | `1966731c-7d45-41e8-8ec1-3f9f76a7db73` | 8/8 |
| `economy.rakuten` | `01670579-4643-43a0-9509-577cffbd42d2` | 7/8 |
| `economy.seven-nanaco` | `c42cefb4-ca64-4103-bab7-e4bc33b4fcf3` | 6/8 |
| `economy.vpoint-smbc` | `16034af1-415b-4831-a577-265f5307a91c` | 4/8 |
| `transit.jre-suica-view` | `abc7b6ec-10eb-416b-bea2-0b056073802e` | 2/8 |

PayPay reached 8/8 source-role coverage, but its evidence batch was rejected
with `INVALID_ARGUMENT`, `schema_validation_failed`, and failed path `$`. A
wrapper attempt returned `UNKNOWN`, also without a narrower path. The run was
correctly closed as `partial`; no rejected payload was persisted as accepted.

The variation from 44/64 to 43/64 shows that live web research is not a stable
enumeration mechanism by itself. A role found in one occurrence may be missed
in another, so the system needs durable target-level checkpoints rather than
treating each broad run as a fresh all-or-nothing search.

### Locator-first and bounded recovery occurrences

The locator-first occurrence checked 62/64 family-role keys, fetched 49
official locators, and observed 62 role markers. Seven family streams reached
8/8. Nanaco reached 6/8 and missed only `partner_merchant_directory` and
`transfer_partner_directory`.

Run `f85e00cf-8b8c-4de5-a617-c673079a7eec` then checked just those two targets
against exact first-party pages, observed both role markers, and closed
`completed` with sources attempted/succeeded 2/2 and zero batches. The exact
cumulative projection is
`registry/planning/p0-agent-feed-role-coverage.2026-08-21.v0.1.json` and covers
the declared P0.1 set 64/64.

This is a union of terminal checked-role outcomes. It does not claim that one
large occurrence was stable, that every role yielded an economic claim, or
that any page became canonical evidence. A later broad occurrence checked only
37/64 despite using the corrected locators. That attempt is evidence of
runtime variance, not a reason to erase the prior successes.

### Root connector schema diagnosis

The live `submit_batch` declaration exposed an alternative `{findings}` or
`{evidence}` request instead of the full required protocol object. Agent Feed's
source schema used a root `anyOf` only to enforce that at least one array was
non-empty. The connector compiler interpreted those branches as tool argument
alternatives and omitted `protocol_version`, `run_id`, `batch_id`,
`idempotency_key`, `sequence_number`, `submitted_at`, and `metadata`.

This explains the otherwise opaque `$` failures. The Scheduled Task supplied
the correct nine-root object, but the connector rejected it before Agent Feed
service validation or database persistence. Prompt changes cannot repair a
misdeclared callable contract. The required fix is a semantically equivalent
non-union schema, an MCP discovery regression, deployment, and plugin
reconnection.

## What `partial` meant in this experiment

`partial` did not mean that the point program had no public information. It
meant that the run reached a terminal state without successfully completing
and delivering its entire declared `expected_scope`. There were two distinct
causes:

1. one or more source roles were not resolved during that occurrence; or
2. the roles were resolved, but the evidence batch was rejected before
   acceptance.

The two reconciled occurrences give a more useful classification than either
single run:

| Measure | Family-role targets | Share of 64 |
| --- | ---: | ---: |
| Found in both runs | 34 | 53.1% |
| Found in exactly one run | 19 | 29.7% |
| Found in at least one run | 53 | 82.8% |
| Not found in either run | 11 | 17.2% |

The 19 intermittent targets are proven retrieval or classification
instability: the same public role was found once and missed once. They cannot
be explained by information being non-public.

| Stream | Stable in both | Found across either | Not found in either |
| --- | ---: | ---: | --- |
| `economy.aeon-waon` | 7 | 7 | `program_terms` |
| `economy.au-ponta` | 2 | 5 | `change_notices`, `expiry_and_reward_classes`, `program_terms` |
| `economy.docomo` | 5 | 8 | none |
| `economy.paypay` | 6 | 8 | none |
| `economy.rakuten` | 5 | 7 | `change_notices` |
| `economy.seven-nanaco` | 3 | 8 | none |
| `economy.vpoint-smbc` | 4 | 6 | `campaign_directory`, `change_notices` |
| `transit.jre-suica-view` | 2 | 4 | `campaign_directory`, `change_notices`, `partner_merchant_directory`, `transfer_partner_directory` |

PayPay demonstrates the second kind of partial result. Its second run resolved
all eight roles, but `submit_batch` failed schema validation. The run correctly
remained `partial` because research completion is not the same as accepted
delivery.

### Were the 11 double-missing roles actually non-public?

The evidence does not support that conclusion. A focused official-site check
found representative public material for every double-missing category:

- WAON publishes its
  [WAON POINT service terms](https://www.smartwaon.com/ext/001/terms/service.html).
- Ponta publishes its
  [member terms](https://www.ponta.jp/c/ppm/terms/),
  [point expiry details](https://www.ponta.jp/c/point-detail/), and an official
  site with current and historical notices.
- Rakuten publishes official
  [point-rule change announcements](https://point.rakuten.co.jp/doc/announcement/20211001/).
- V Point publishes an official
  [news index](https://www.vpoint.co.jp/news/) and public campaign pages.
- JRE POINT publishes an official
  [campaign area](https://www.jrepoint.jp/campaign/0061001953/),
  [notice index](https://www.jrepoint.jp/information/list/),
  [merchant directory](https://www.jrepoint.jp/point/append/jrepoint-card/),
  and public point/partner-exchange guidance.

These examples do not prove that each source role is completely covered or
that every page is suitable as canonical evidence. They do prove that the two
runs' unresolved flags mostly reflect discovery, navigation, taxonomy, or
time-budget failures rather than a general absence of public information.

The current Agent Feed record cannot make a stronger absence claim because it
does not retain structured target-attempt reasons, searched official domains,
access outcomes, or a reviewed negative-evidence record. Until those exist,
`unresolved` must mean “not established by this run,” never “does not exist.”

## Direct-source recovery experiment without Agent Feed

The 11 double-missing targets were retried outside Agent Feed using a bounded
four-step resolver:

1. inspect the existing trusted-source catalogue for exact or related sources;
2. search only the provider's official domain and official site indexes;
3. follow redirects and perform a direct public HTTP GET; and
4. verify a role-specific marker in the returned page.

The deterministic lead-only record is
`registry/planning/p0-direct-source-recovery.2026-08-21.v0.1.json`.

| Result | Count |
| --- | ---: |
| Targets retried | 11 |
| Public HTTP 200 responses | 11 |
| Expected role marker found | 11 |
| Official locator recovered | 11 |
| Remaining locator-unresolved targets | 0 |
| Canonical evidence ready | 0 |

Two recovered locators were already exact registered sources:
`jp.vpoint.campaigns` and `jp.jrepoint.campaigns`. Every other target had at
least one related registered source, but needed an exact mapping decision or a
new source-catalogue candidate. This demonstrates another concrete cause of the
Scheduled Task failures: the task received family/role targets but not the
app's existing exact/related trusted-source map.

For this eight-family slice, cumulative locator discovery is now 64/64: 53
were found by at least one Scheduled Task occurrence and the remaining 11 by
the direct resolver. This is a discovery result only. No page body was retained,
no source was silently registered, no canonical evidence was captured, and no
economic fact or `RewardRuleVersion` was created.

The experiment supports a near-term non-Agent-Feed bootstrap path: generate a
bounded unresolved-target worklist from Rewards, enrich it with existing
trusted-source relations and official-domain hints, run the direct resolver,
then send only reviewed source candidates through the normal source
registration and canonical evidence workflow. Agent Feed can later monitor the
same approved locators once its P0 scheduling and target-accounting controls are
ready.

### Scheduled-task capacity diagnosis

The task is active and remains scheduled daily at 03:00 Asia/Tokyo. A stale
task-management session reported an active-task limit, but a fresh authenticated
session successfully resumed and manually reran the task. The account had 12
active tasks at inspection time. This is consistent with the current ChatGPT
Pro documented maximum of 15 active tasks, but account capacity is an operator
constraint, not an Agent Feed scheduling guarantee. See the official
[Scheduled Tasks documentation](https://help.openai.com/en/articles/10291617-scheduled-tasks-in-chatgpt).

## What worked

### Honest lifecycle closure

Every begun stream run received a terminal record. Missing roles produced
`partial`, not a false `completed` zero-finding result. Rejected submissions did
not create accepted rows.

### Generic transport boundary

Agent Feed remained domain-neutral. It transported an untrusted
`coverage_candidate`; Rewards retained responsibility for source-role mapping,
admission, provisional display, correction handling, and eventual canonical
review.

### Durable reconciliation

ChatGPT's natural-language report could be checked against durable Run IDs,
scopes, statuses, diagnostics, and row counts. This is the correct trust model:
the UI summary is convenient, but the receipt ledger is authoritative.

### Fail-closed publication boundary

No experiment path published or approved a `RewardRuleVersion`. The accepted
probe remained lead-only, and malformed submissions created no economic rule.

## What was fragile

### The work unit was too large

One occurrence had to research 64 roles, maintain eight lifecycle handles,
construct exact nested payloads, retry failures, and close all eight runs.
Partial research success was high enough to be useful, but too variable to be
an idempotent bulk-import job.

### Schema guidance arrived too late

The MCP schema exposed references, but the model still produced a root-level
validation failure. Restating field names helped one focused probe, yet the
second broad occurrence still failed. Prompt prose is not a substitute for a
producer-side validator that returns the exact failing JSON pointer.

### Research and submission competed for context

The task spent its limited execution window on web discovery and source-role
classification, then had little room left to construct and repair evidence
batches. These should be separate resumable phases joined by a typed manifest.

### Agent Feed could not detect an absent P0 occurrence

A read-only database audit across all 19 P0 streams found zero matching rows in:

- `stream_expectations`;
- `schedule_expectation_versions`;
- `expected_occurrences`;
- `job_definition_versions` whose definition or metadata referenced a P0
  stream;
- `job_deployment_binding_versions` attached to such a job.

Therefore Agent Feed records runs that arrive, but it currently cannot declare
that a P0 occurrence never arrived. A paused task, expired login, disabled
tunnel, or account limit can be silent unless a separate operator notices.

### Independent dependencies can fail separately

ChatGPT scheduling, the authenticated session, MCP plugin, secure tunnel,
Agent Feed service, PostgreSQL, and source websites have distinct liveness and
authorization states. A successful run proves only that they overlapped for
that occurrence.

## Stability design for large-scale Agent Feed work

P0 contains 44 families. P1 and P2 add 76 and 103 respectively, bringing the
cumulative P0–P2 planning universe to 223 families; the eventual design has 95
Agent Feed streams. The P0 experiment therefore cannot be repaired with a
larger prompt. Agent Feed needs explicit multi-provider scheduling, target
accounting, and backpressure while remaining unaware of Rewards-specific
support decisions.

### Agent Feed changes required before P1/P2 scale

Some required primitives already exist in Agent Feed, but the P0 workload has
not been registered in them. Other gaps require product work.

| Area | Current P0 state | Required Agent Feed change |
| --- | --- | --- |
| Job and deployment registry | Generic tables exist; zero P0 definitions or bindings | Register versioned jobs and provider bindings for every enabled stream/task; bind the exact instruction digest, capability profile, off switch, and output contract. |
| Schedule and expected occurrence | Generic tables exist; zero P0 schedule versions or expected occurrences | Materialize every due occurrence with cadence, grace, overlap/misfire policy, and expected scope before execution; link each received run to exactly one occurrence. |
| Target accounting | Only terminal `actual_scope` arrays and free-text diagnostics | Add a generic immutable target-attempt ledger keyed by opaque target ID, with attempt number, timestamps, outcome code, source locator/fingerprint when safe, and receipt linkage. Rewards can encode `family_id/source_role_id` in the opaque target metadata without Agent Feed interpreting it. |
| Partial-result semantics | One broad `partial` state | Add structured per-target outcomes such as `resolved`, `not_found_this_attempt`, `access_blocked`, `authentication_required`, `timeout`, `unsupported_content`, `validation_rejected`, and `interrupted`. Reserve any `no_public_source` assertion for a separately reviewed negative-evidence workflow. |
| Batch validation | Broad runs received root path `$` and `UNKNOWN` | Provide a producer SDK or `validate_batch` preflight using the exact deployed schema. Return all safe violations with JSON Pointer, keyword, expected type/enum, and schema version; preflight must cause zero writes. |
| Resumability | Every occurrence restarts broad web research | Add checkpoint/continuation support for unresolved opaque targets. A retry must reuse target attempt and payload idempotency keys and resume from the last durable receipt. |
| Source-attempt provenance | URLs and navigation outcomes were not durably attached to unresolved targets | Persist bounded untrusted source-attempt metadata: official domain/locator, discovery method, HTTP/browser outcome, observed time, redirect/auth state, and content fingerprint where computed. Never store credentials or full copied pages by default. |
| Provider reconciliation | ChatGPT task state is external to Agent Feed | Record scheduler-provider occurrence identity, dispatch acknowledgement, heartbeat, and terminal provider status. Detect “scheduled but never dispatched,” “dispatched but no begin_run,” and “begun but not completed” separately. |
| Backpressure and fairness | One task opened eight runs and attempted 64 roles | Enforce tenant/provider limits for open runs, targets per run, batch size, validation-rejection rate, and delivery backlog. Use bounded queues and fair scheduling across streams rather than maximum fan-out. |
| Schema compatibility | Exact nested schema was difficult for the producer to construct | Bind each job to an Agent Feed protocol/schema version and run provider-conformance tests before activation. Reject incompatible deployments before creating expected occurrences. |
| Operational visibility | Natural-language ChatGPT summary required manual SQL reconciliation | Expose a generic dashboard/API for expected versus arrived occurrences, open/terminal runs, target outcomes, rejected batches by JSON Pointer, dedupe/retry results, and overdue incidents. |

These are Agent Feed transport and operations capabilities. Agent Feed must not
decide whether a point program, card, merchant, source family, or rule belongs
in P0/P1/P2, and it must not convert a discovery result into a canonical
`RewardRuleVersion`.

### Practical changes to improve fetch and delivery success

The measured data already shows that cumulative target state will help. The
best single occurrence found 44/64 roles, while the union of two occurrences
found 53/64. Retaining valid prior discoveries would therefore have raised
observed role coverage from 68.75% to 82.8% without inventing any new source.

Apply the following changes in order:

1. **Carry forward verified locators.** Store the last successful official
   locator and source fingerprint for each opaque target. Recheck it directly
   before launching a new discovery search. Do not make every occurrence find
   known pages again.
2. **Retry only unresolved or stale targets.** Use the target ledger to build
   the next worklist. This prevents a second run from losing roles that the
   first already found and directs the model's budget to the actual gaps.
3. **Use a role-specific discovery ladder.** For each official domain, try the
   registered source, site navigation/index, sitemap or feed where permitted,
   official help/FAQ search, terms index, campaign index, notice index, and
   finally a domain-restricted web search. Record which step succeeded.
4. **Give the producer domain and vocabulary hints, not economic answers.** A
   target may include approved official domains, Japanese/English aliases, and
   page-type synonyms such as 規約, お知らせ, キャンペーン, 加盟店, 交換,
   有効期限. Planning URLs remain leads until acquired and admitted normally.
5. **Separate discovery and delivery.** First write a bounded typed candidate
   manifest. Then run machine validation and submit it in a separate phase.
   Web-research context should not be responsible for repairing a large nested
   transport payload at the end of the run.
6. **Use small, homogeneous batches.** Submit one stream or source-role class
   at a time. A failure then blocks only that slice and gives a more meaningful
   JSON Pointer.
7. **Use deterministic HTTP retrieval with browser fallback.** Prefer stable
   official HTML/PDF/feed endpoints when permitted; use a browser for
   JavaScript navigation, cookie gates, or dynamic indexes. Record redirects,
   status, media type, and access limitation rather than silently counting a
   page as missing.
8. **Introduce a validated Agent Feed payload builder.** The producer should
   populate typed fields and let the SDK generate canonical JSON, IDs,
   references, nulls, and security flags. The same validator must run before a
   live tool call.
9. **Use bounded targeted retries.** Retry transient network/browser failures
   with backoff, but do not repeatedly retry a schema-invalid payload or an
   authentication-required page without changing the plan.
10. **Model source-role applicability explicitly in Rewards.** Some families
    may genuinely lack a central directory for a role. That is a Rewards
    planning decision supported by reviewed negative evidence or a conservative
    exclusion, not something Agent Feed or a single search occurrence should
    infer.

These changes improve two different rates: locator discovery and accepted
delivery. Better search alone will not fix a schema-rejected batch, and a
perfect payload builder will not find an obscure official page. Both phases
need independent measurements and retry policies.

### 1. Register expectations before increasing coverage

For each P0 stream, create versioned job and deployment bindings plus cadence,
grace, and expected-occurrence records. Link each received run to its expected
occurrence. Alert separately for:

- overdue occurrence;
- occurrence started but not terminal;
- terminal partial scope;
- rejected submission;
- producer/tunnel capability failure.

This uses Agent Feed's generic control plane. It must not encode Rewards policy
or decide which source families the product supports.

### 2. Reduce task size to one stream or a small target slice

Do not begin eight streams up front. A safer unit is one stream with two to four
source roles, processed sequentially:

1. begin one run;
2. research the bounded target list;
3. persist a target manifest;
4. preflight and submit zero or more small batches;
5. complete that run;
6. start the next stream only after the terminal receipt exists.

This bounds blast radius and avoids leaving many open runs if the task is
interrupted.

### 3. Track every target explicitly

Each `(family_id, source_role_id)` needs a durable state such as:

- `not_attempted`;
- `checked_no_official_source`;
- `official_source_found`;
- `candidate_preflight_failed`;
- `submitted`;
- `receipt_verified`.

The next occurrence should resume unresolved targets, not rediscover all 64.
Target state remains operational metadata; it is not canonical evidence.

### 4. Add a machine preflight before `submit_batch`

The producer should validate a fully dereferenced Agent Feed schema locally,
including exact keys, date-times, unique IDs, resolved evidence references,
security flags, and payload-size limits. A failure should identify the exact
JSON pointer and must result in zero network submission.

### 5. Separate acquisition from interpretation

The acquisition phase may emit source-page leads and bounded excerpts. A
Rewards-side phase should then normalize, match aliases/products, classify the
candidate, and decide whether it is accepted for research. Only the normal
canonical evidence and review gates may produce a `RewardRuleVersion`.

### 6. Make retries and recovery first-class

Persist a per-occurrence manifest containing expected targets, completed target
states, candidate hashes, idempotency keys, Run IDs, and receipt IDs. Replaying
the same manifest must create no duplicate accepted records. If live delivery
is unavailable, emit one protocol-valid run bundle for later replay and never
claim live acceptance.

### 7. Add bounded concurrency and backpressure

Limit simultaneously open runs and submitted batches. Stop creating new work
when the consumer backlog, validation rejection rate, or overdue occurrence
count exceeds configured thresholds. Large-scale stability comes from a small
bounded queue, not maximum fan-out.

### 8. Measure the pipeline, not just model output

At minimum, retain metrics for:

- expected, arrived, terminal, partial, failed, and overdue occurrences;
- target coverage and recheck stability by family-role;
- accepted and rejected batches by validation code and JSON pointer;
- finding/evidence dedupe rate;
- time from discovery lead to Rewards triage and canonical review;
- credentials/PII/security admission failures;
- retry and recovery success.

### 9. Move the primary scheduler to an API/workflow producer

ChatGPT Scheduled Tasks are useful for a bounded trial, manual research, and a
sentinel that exercises the public producer contract. They are not the best
source of truth for 301 continuously monitored targets. A durable workflow
producer should own enumeration, checkpoints, backoff, and occurrence
reconciliation while using the same generic Agent Feed APIs.

## Gates before enabling tasks P0.2 through P0.6

Do not bulk-enable the remaining task entries until a stable trial demonstrates:

- 100% of begun runs reach a terminal state;
- 100% of scheduled occurrences are recorded as arrived or overdue;
- no missing work is reported as completed-zero;
- no malformed batch is accepted;
- retries create no duplicate run, batch, finding, or evidence records;
- no credential, PII, or dynamic payment data crosses the boundary;
- ChatGPT summaries reconcile exactly with database receipts;
- tunnel-down, producer-timeout, validation-rejection, and replay recovery drills
  are observable and recoverable;
- source-role coverage is resumed from durable target state rather than
  restarted from scratch.

## Repository responsibilities

Rewards should own the P0 source-role plan, product/alias matching, provisional
catalogue, correction workflow, and canonical review gates. Agent Feed should
own generic producer authentication, validation, idempotent ingestion, run and
occurrence ledgers, liveness, replay, and provider-neutral job/deployment
control. ChatGPT should be treated as one replaceable producer, not as the
control plane.

After the experiment, a focused Agent Feed source repair was separately
authorized, reviewed, and merged as PR #16 at
`d232aac75c3a5e5a2d36c2af71464f4f13ac4713`. It changes only the MCP-compatible
`submit_batch` declaration and its regression coverage; it does not implement
the broader scheduling, checkpointing, target-attempt, or backpressure work
identified above.

The deployment attempt added another operational lesson: merging a schema fix
does not refresh an already-running stdio child or ChatGPT's cached connector
declaration. The operational checkout and setup were refreshed, but the local
runtime could not be restored because Docker Compose was unavailable and the
replacement container's loopback port was unreachable. A successful source
merge, local service restart, tunnel restart, and ChatGPT connector rediscovery
must therefore be tracked as separate gates. This does not authorize broadening
Rewards to P1/P2/P3 data.
