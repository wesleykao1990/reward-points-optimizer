# M3 real-data publication checkpoint

This directory separates machine-verifiable readiness from the accountable human publication decision.

- `m3-real-data-alpha-publication-candidate.v0.1.json` is generated from the two golden fixtures and their manifests. It binds exactly five publishable source rule versions, definition hashes, evidence IDs, fixture hashes, and replay hashes. It separately records the synthetic negative-test rule that must stay unpublished.
- `m3-real-data-alpha-publication-decision.v0.1.json` is the only human-edited file. It remains `pending` until an accountable person performs the four listed checks.

## Human review instructions

Do not change `candidate_hash` or any candidate file field. Open the decision file and, only after doing the checks below:

1. Set `status` to `approved` or `rejected`.
2. Set `reviewer_id` to your stable human identifier or name. Do not use an agent name.
3. Set `reviewed_at` to the current ISO 8601 timestamp with timezone, for example `2026-08-20T15:30:00+09:00`.
4. For approval, set every `confirmed` value to `true`. Use each `notes` field for any caveat; it may remain `null` when there is none.
5. Set `decision_notes` to a short explanation of what you checked and why you approve or reject publication.

The four checks mean:

- `official_source_facts_match`: compare the normalized paraphrases to the official Seven-Eleven, nanaco, and Seven Card pages; pay special attention to accepted/unsupported tenders, preregistration, JPY 5,000 minimum, JPY 1,000 increment, JPY 30,000 per-charge and JPY 50,000 balance limits, and both reward rates.
- `calculation_and_boundaries_match`: confirm `JP-CVS-002` accepts the supported credit-card family and rejects the unsupported tender; confirm `JP-CVS-006` produces 25 charge points plus 3 purchase points and JPY 4,340 residual, rejects the JPY 4,000 top-up, and fails when preregistration is missing.
- `five_rule_scope_only`: confirm the decision covers only the five listed version-2 rules and excludes `rr_jp_cvs_002_a_deny_unsupported_tender`, which exists only to test rejection. It does not enable production mode, the browser frontend, automated collection, or any other merchant/program.
- `correction_and_rollback_understood`: confirm that a correction creates new evidence and a new rule version; published definitions are never edited in place.

Then run:

```bash
pnpm publication:m3:authorize-check
pnpm publication:m3:generate
pnpm publication:m3:sql-check
```

The generator creates `db/seeds/002_m3_real_data_publication.sql` only after a hash-matched approval. The SQL creates version 2 rows rather than mutating the golden-bound version 1 candidates, copies their exact evidence links, records the human decision and immutable publication receipts, and publishes all five real rules in one transaction. It asserts that the synthetic denial remains `under_review`. It does not activate a frontend or production recommendation mode.

The transaction shape has been exercised with a synthetic approval in a disposable PostgreSQL database. That test produced five version-2/API rows and five receipts while preserving all six version-1 golden bindings and leaving the synthetic denial unpublished; the synthetic approval and SQL were not placed in the repository.

Until authorization, use `pnpm publication:m3:check`; it succeeds only when the machine dossier is current, the decision is honestly pending, and no publication SQL exists.
