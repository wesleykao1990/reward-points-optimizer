# Ingestion and Review Workflow v0.4.1

## 0. Generic discovery intake through Agent Feed

External monitors submit `RunEnvelope`, `Finding`, and submitted-evidence objects to the separate Agent Feed project. The Rewards Optimizer receives signed delivery events and maps supported findings into `SourceObservation`.

A finding is a claim/lead, not a fact. It cannot alter a source registry, evidence record, extraction candidate, or reward rule directly.

## 0.1 Two evidence stores with different meanings

- Agent Feed evidence: material supplied by a producer.
- Rewards canonical evidence: authority-checked, permission-aware, immutably captured, hashed, precisely located, and reviewed material that may support a rule.

Promotion is explicit and may require recapture. Agent confidence and producer authority labels are never sufficient by themselves.

## 0.2 Dedupe and run health

Transport dedupe uses Agent Feed event/run/finding IDs. Reward-domain semantic dedupe uses subject, change type, program/campaign identity, effective dates, and normalized claims.

Completed zero-finding runs, partial runs, and failed runs remain distinguishable so absence of findings is not confused with absence of coverage.

## 1. Registry onboarding

A source is registered with claim-specific authority scope, volatility, cadence, and three separate states:

- legal/terms permission;
- technical reachability classification;
- content verification.

`url_registered_on` is not `content_verified_on`.

## 2. Access observation

Before planning automation, record a dated observation containing environment, method, source scope, result, and notes. Observations are append-only facts, not durable labels.

A `403`, timeout, or WAF result must never cause stealth browser automation. The next action is manual capture, permission review, an official feed, a partner path, or reduced scope.

## 3. Capture hierarchy

Prefer:

1. official API or licensed feed;
2. permitted HTTP collection;
3. permitted rendered capture;
4. official email/announcement ingestion;
5. manual browser capture.

Manual capture is the primary early-stage path for blocked issuer and merchant sources. It is not assumed to be the permanent production architecture.

## 4. Immutable snapshot

Every capture records acquisition method, policy version, requested/effective URL, timestamps, hashes, permitted storage, completeness, and parser/renderer versions. A failed check never overwrites the last valid snapshot.

## 5. Diff and materiality

Normalize only under a source-specific policy. Classify changes as:

- cosmetic/noise;
- non-material copy;
- potential material rule change;
- removal/relocation;
- inaccessible;
- security anomaly.

The data-maintenance rehearsal measures false positives and review effort before a broad freshness promise is made.

## 6. Extraction candidate

The extractor receives an immutable snapshot as untrusted data and emits only a candidate document. It must capture:

- operation types and route constraints;
- included and excluded merchants/channels/assets;
- reward class and certainty;
- calculation, rounding, caps, and tier basis;
- posting, expiry, restrictions, and clawback;
- economic and announced dates;
- exact evidence locators;
- unresolved questions and conflicts;
- security flags.

It cannot publish or calculate the canonical recommendation.

## 7. Prompt-injection handling

Retrieved text may contain instructions aimed at the model. The extractor treats them as page content, never as instructions.

The required fixture contains an instruction to set the reward rate to 100%. The expected candidate has no rule and includes an `embedded_instruction` security flag. Implementations must run this test in CI.

## 8. Semantic validation

Flag or reject:

- end before start;
- announced date used as an effective date;
- financial rule without output asset metadata;
- acceptance/exclusion rule with a fake calculation;
- points-per-unit without denominator and rounding;
- tier rule without a typed basis;
- cap without reset, partial-consumption, and unknown-progress policy;
- transfer without minimum, increment, limit, posting, and cancellation semantics;
- top-up route without residual-asset handling;
- limited points represented as unrestricted normal points;
- probabilistic award included in guaranteed value;
- evidence outside the source's authority scope.

## 9. Review interface

Show side by side:

- current approved version;
- proposed version;
- material field diff;
- exact passages;
- source authority, permission, reachability, and freshness;
- affected scenarios and changed winners;
- open questions;
- review mode and required risk tier.

## 10. Publication transaction

Publication is atomic:

1. persist approved evidence;
2. insert a new rule version;
3. link evidence;
4. run boundary, property, and impacted-scenario tests;
5. close the prior version's system validity;
6. verify no approved economic overlap remains;
7. publish only if every gate passes;
8. emit changed-recommendation events;
9. schedule expiry and the next permitted check.

## 11. Corrections

A user report is a lead, not canonical evidence. Redact personal data, identify implicated rule versions, acquire first-party evidence, create a new version, and preserve historical replay.
