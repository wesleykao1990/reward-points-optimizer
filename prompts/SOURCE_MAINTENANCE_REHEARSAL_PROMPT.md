# Two-lane source-maintenance rehearsal prompt

Run the 30-day experiment in `docs/12_source_maintenance_rehearsal.md` over the exact eight-source cohort.

Lane A performs only approved/manual direct checks. Lane B uses external semantic monitors that submit through the separate Agent Feed protocol `0.1`.

For every monitor run:

- begin with expected scope;
- complete with actual scope and honest completed/partial/failed status;
- submit findings as claims, never facts;
- preserve URLs, dates, locators, ambiguity, and evidence references;
- never publish a rule;
- never infer collection permission from an HTTP 200;
- never bypass blocks, login, rate limits, or bot controls;
- never treat agent confidence as source authority.

The Rewards Optimizer must map findings to `SourceObservation`, deduplicate semantically, and acquire canonical evidence independently.

Compare recall, delay, false positives, duplicates, official-source hit rate, human review time, direct-access failures, Agent Feed run health, cost per confirmed change, and changed-winner impact.

ChatGPT Scheduled Tasks may operate as an independent sentinel or produce a manual run bundle. Do not claim automatic ingestion unless outbound tool support has been verified.

Realtime may update a dashboard but cannot be used as the queue or evidence pipeline.

Non-negotiable statements:

- Never publish a rule automatically.
- Never infer collection permission from an HTTP 200 response.
- Keep the exact eight-source cohort for the comparison.
