# Review — Japan Rewards Optimizer + Agent Feed Workspace v0.4

Reviewed 2026-08-17. Both migrations executed against PostgreSQL 16.14; the new consumer test run; the FK graph mapped to check whether the trust boundary is real; the ChatGPT capability claims checked against OpenAI's current documentation; the three previously-reported defects re-tested against v0.4 code.

---

## Verdict

The ingestion redesign is sound, and the single most important thing about it is verifiable rather than aspirational: **the trust boundary is enforced by foreign keys, not prose.** That's the thing most likely to have gone wrong in a design like this, and it didn't.

But two things need saying up front:

1. **None of the four v0.3 findings were fixed.** I re-tested three of them against v0.4 code and they reproduce exactly. Two of those I flagged as "fix before Codex starts."
2. **The scope of the workspace roughly doubled** at the point in the plan where the identified risk was already operational capacity, not architecture.

Neither is a reason to abandon the redesign. The protocol itself is good work.

---

## 1. The trust boundary is real — verified

The obvious failure mode for "let agents submit findings" is that a finding eventually becomes a rule through some convenient path nobody remembers adding. I mapped every foreign key touching the new tables:

```
app_private.source_observations                    → agent_feed_receipts
app_private.source_observation_submitted_evidence  → source_observations
app_private.source_observation_submitted_evidence  → evidence_records
```

That's the whole reach. Combined with the v0.1 schema, where `evidence_records.source_snapshot_id` is **not null** and references `source_snapshots`, and `extraction_candidate_snapshots` requires a snapshot, there is **no SQL path from an agent-feed observation to a reward rule** that doesn't pass through a canonical snapshot the Rewards Optimizer captured itself. The single edge into `evidence_records` runs the correct direction — submitted evidence points *at* a promoted canonical record, gated by `check ((promotion_status = 'promoted') = (promoted_evidence_id is not null))`.

Both migrations apply cleanly with `ON_ERROR_STOP=1`, and `db/tests/003_agent_feed_consumer.sql` passes. `validate_workspace.py` passes across all three packages, and `generate_checksums.py --check` verifies 162 checksums without writing.

Other things that are right:

- **`begin_run` / `submit_batch` / `complete_run` with zero-findings distinguished from failure** is the correct primitive, and it's the one most monitoring designs get wrong. "I checked and nothing changed" and "I never got to check" are opposite facts about staleness.
- **Two dedup layers** — transport identity in Agent Feed, versioned semantic fingerprint in the consumer — is the right separation. `semantic_fingerprint_version` being a pinned integer means you can re-fingerprint later without losing history.
- **`protocol-lock.json`** pinning `direct_database_access: false` and `realtime_required: false` puts the boundary somewhere a build can assert it.
- **Realtime demoted to optional UX** is correct. Using a realtime channel as a queue is a common Supabase mistake and you avoided it explicitly.
- **The two-lane rehearsal is a genuine improvement on what I asked for.** I suggested measuring whether one person can sustain the maintenance load. You turned it into an A/B with confirmed-change recall, false positives, detection delay, and cost per useful finding *by lane*, against a ground-truth event log. That answers a better question, and the decision outcomes are named in advance.

The ChatGPT claim in `docs/07` is accurate as of today — OpenAI's help centre confirms scheduled tasks don't support webhooks and are better suited to recurring check-ins than event-triggered automation. Treating them as sentinels rather than production producers is the right read.

---

## 2. The v0.3 findings are still open

These were the recommended order in the last review. None are in the v0.4 changelog, and I confirmed each against v0.4 code:

| v0.3 finding | Status in v0.4 |
|---|---|
| `definition_hash` undefined; `unique (rule_id, definition_hash)` blocks re-publication | **Unfixed** — reproduced on the v0.4 database |
| Conservation ignores `reward_class` | **Unfixed** — reproduced against v0.4's validator |
| `adjust` movements bypass conservation, undocumented | **Unfixed** — same `continue`, same docstring, `docs/13` §6 still silent |
| Required review mode is prose-only | **Unfixed** — `required_review_mode` appears nowhere in the workspace |

Re-tested on `jro4` after applying both migrations:

```
-- publish campaign with valid_to null, later learn the end date,
-- supersede and re-publish the same definition with the date set
ERROR: duplicate key value violates unique constraint
       "reward_rule_versions_rule_id_definition_hash_key"
```

And against `validate_movement_conservation` in `rewards-optimizer/scripts/validate_package.py`:

```
consume 100 limited_period points → create 100 normal points (same asset_id)
→ declare 100 limited_period remaining
RESULT: accepted
```

The conservation one matters more now, not less. The whole point of the agent-feed lane is to catch campaign changes faster, and campaign rewards are overwhelmingly paid in limited-period points. A ledger check that lets limited and normal points cancel is precisely the wrong blind spot to carry into a faster campaign-detection pipeline.

Both fixes are still small: a comment plus a `check` constraint plus a decision on the unique key; and keying three dictionaries on `(asset_id, reward_class)`.

---

## 3. New finding: nothing detects a producer that stops producing

**This is the significant gap in the new design.**

The protocol models everything about a run that *happens*. `RunEnvelope` carries `started_at`, `completed_at`, `status`, `expected_scope`, `actual_scope`, `stats`, `error_summary`. `docs/10` requires terminal runs to have completion times and actual scope, and requires `sources_succeeded <= sources_attempted`. All good.

There is no concept anywhere of a run that **should have happened and didn't**. I grepped the whole workspace for heartbeat, liveness, missed-run, expected-next, and staleness semantics: the only hit is "consumers reject stale timestamps," which is replay protection on individual events, not producer liveness.

So the failure mode is: a monitor stops running, submits nothing, and the consumer sees exactly what it sees when everything is fine and nothing changed. At-least-once delivery with retries and dead-lettering protects against *lost messages*. Nothing protects against *absent messages*.

This is not hypothetical, and the ChatGPT integration makes it concrete. Per OpenAI's documentation, scheduled tasks **auto-pause when ignored**, and **deleting the chat tied to a task automatically pauses that task**. A paused sentinel is silent, and silence currently reads as health.

It's a particularly sharp gap for this project because the entire architecture exists to know when a rule has gone stale. A monitoring lane that can die quietly converts "we monitor 140 sources" into "we believe we monitor 140 sources" — which is worse than not monitoring, because it produces unwarranted confidence in a freshness claim the recommendation API is gated on.

**The wiring point already exists.** Every registry source carries `recommended_check_cadence`, `app_private.source_check_runs` exists in the v0.1 schema, and Milestone 5's gate already says stale or unresolved high-risk rules cannot appear verified. What's missing is the link between them and the new lane.

Suggested:

- Register an **expected cadence per stream** (and per source within a stream) at the consumer, independent of whatever the producer believes its own schedule to be.
- Add a consumer-side sweep that raises an **overdue-run** condition when no terminal run has arrived for a stream within its window, and flips the affected sources to a stale/unverified freshness state that the recommendation API already knows how to act on.
- Add `agent_feed_partial/failed/zero_finding run rate` — already in the rehearsal metrics — alongside a **missed-run rate**, which currently has no way of being measured.
- Add to `docs/10`: *a stream with a registered cadence and no terminal run inside its window is an alarm condition, not a quiet period.*

Without this, the rehearsal's "confirmed-change recall by lane" metric will silently flatter Lane B: a lane that stopped running scores zero misses on days it produced no runs at all, because there's nothing recording that a run was owed.

---

## 4. New finding: ChatGPT active-task caps are a hard ceiling the docs don't state

`docs/07` and `docs/05` correctly capture the webhook limitation. They don't capture the quantitative limits, which bound the design harder:

- Active tasks per account: **Go 3, Plus 5, Business/Edu 10, Pro/Enterprise 15**
- Minimum interval between runs: **60 minutes**
- No custom GPTs, no file uploads inside a task; tasks inside a project can't read that project's files

The registry has 140 sources. Even the eight-source rehearsal cohort would consume more than a Plus account's entire task budget, and over half a Pro account's. Anyone reading "ChatGPT monitoring task" as a per-source or per-source-family fan-out will hit a wall at single digits.

Mode 4 (a separately scheduled API worker using the producer SDK) is correctly named the recommended automated path, and it's the only one that scales past a handful of streams. The fix is a sentence in `docs/07` stating the caps, so the sentinel role is understood as "a few high-value sources, one account" rather than "a monitoring tier."

The hourly floor is fine — your cadences are daily and weekly.

---

## 5. New finding: the agent-feed channel has no prompt-injection fixture

The v0.3 package pairs `examples/source-snapshot.prompt-injection.fixture.html` with `examples/extraction-candidate.prompt-injection.expected.yaml` — a hostile input and the expected quarantined output. `validate_package.py` asserts the pair. That's the right pattern, and it's the reason the injection threat isn't just a bullet in a threat model.

The new channel has no equivalent, and it's a **larger** injection surface than the snapshot path. In the snapshot path, hostile text sits inert in a stored blob until an extractor reads it. In the agent-feed path, an LLM producer reads the hostile page and then *writes* `title`, `summary`, `raw_attributes`, and `subjects` — free-text fields the consumer parses and a human reviews. Injection that survives one model's summarization and lands in a reviewer's queue as a plausible-looking finding is the more dangerous version.

The machinery is already there: `Finding.security_flags`, `source_observations.security_flags`, `agent_feed_receipts.processing_status = 'quarantined'`, and `status = 'rejected'`. Nothing exercises it.

Add a hostile run-bundle fixture — a producer that reports a page instructing it to assert a 100% reward rate — with an expected `SourceObservation` carrying the security flag, `status: rejected` or `needs_review`, and empty `canonical_evidence_ids`. Assert it in `validate_workspace.py` the same way the existing pair is asserted. It's an hour of work and it's the difference between a documented principle and a tested one.

---

## 6. Scope: is the generic protocol worth building now?

The redesign is architecturally right and I'd keep the protocol design. My concern is about sequencing, and it's the same concern I raised at v0.1 in a different form.

The workspace now asks for: two repositories, two Supabase projects, an MCP server with three tools, five adapters, TypeScript and Python SDKs, signed cross-service delivery with retry/replay/dead-letter, and a durable outbox — **on top of** the original thirteen-milestone rewards plan, which has not yet produced a single working calculation.

`docs/03` states the constraint plainly: *"Agent Feed must remain usable by other consumers throughout; rewards-specific shortcuts block the gate."* That constraint costs real time on every decision and buys nothing until a second consumer exists. Building a reusable transport before having one working consumer is the classic version of this mistake, and it's the version that stalls solo projects.

The good news is that almost none of the value depends on the split being physical. Consider:

- Keep the protocol, schemas, trust model, `begin/submit/complete` lifecycle, and both dedup layers **exactly as designed**.
- Build Agent Feed as a **module inside the rewards repo**, with the boundary enforced in code and by test rather than by deployment: separate schema (`agent_feed`), no cross-schema joins asserted by a test, consumers talk to it through the published schema package and the signed-event handler.
- Extract it to a separate repo and Supabase project **when a second consumer actually exists**, or when the delivery volume justifies it.

You'd keep the FK-enforced trust boundary, the protocol lock, and the ability to swap in HTTP delivery later. You'd drop two Supabase projects, cross-service signing/retry/replay infrastructure, the SDK packaging work, and the "must remain generic" tax — all of which are pure cost until consumer number two.

For the first integration you need exactly two producers: the API worker (mode 4) and the local-file importer (mode 2, for ChatGPT run bundles). The generic-webhook and REST adapters and both SDKs can wait. The MCP server is the piece you're best positioned to build quickly, but it's still not needed to answer the rehearsal's question.

If you've decided a second consumer is genuinely coming, this concern mostly dissolves and the current structure is right. If Agent Feed exists because it's a cleaner design, I'd take the module version and spend the saved weeks on the rehearsal instead — that's still the highest-information item in the plan, and it's now gated behind a join point that requires an entire second project to reach.

---

## 7. Smaller notes

- **`agent_feed_receipts.raw_payload jsonb not null`** stores the full producer payload for 30 days with `redaction_status` defaulting to `pending`. Nothing enforces that redaction ever completes — no constraint tying `processing_status = 'mapped'` to `redaction_status = 'complete'`, and no purge mechanism beyond the `purge_after` default. Given `docs/05` says to minimise personal data and reject secret fields, a check constraint here is cheap: a receipt shouldn't reach a terminal processing status with redaction still pending.
- **`source_observations.status` has no terminal-state protection.** The core schema is careful about immutability (append-only snapshots, frozen approved rules, one-time `superseded_at`). Observations are freely mutable in both directions — `rejected` can become `new` again with no record. A small `check` or a status-transition trigger would match the rest of the schema's discipline.
- **`docs/05_security_privacy.md` is 12 lines for a service that accepts authenticated writes from external agents.** It's a good checklist, but signature algorithm, key rotation, replay window, and body/rate limits are all "must be implemented" without values. `docs/09` says outbound webhooks include a timestamp and signature and consumers reject stale timestamps — without saying what stale means. Pin the numbers before Codex picks them.
- **The `agent-feed` reference schema is 64 lines against the rewards project's 905.** That's appropriate for a reference, but the asymmetry means the trust properties in `docs/02` (append-only accepted batches, immutable terminal run state) are currently prose on the Agent Feed side while being FK- and trigger-enforced on the Rewards side. If Agent Feed is going to be a separate production data store, its immutability deserves the same treatment.

---

## Recommended order

1. Fix the two v0.3 items I flagged as pre-implementation: `definition_hash` semantics and `(asset_id, reward_class)` conservation. Under an hour, and the second one now sits directly under the campaign-detection lane.
2. Add producer liveness — expected cadence per stream plus an overdue-run alarm wired to the existing freshness state (§3). This is the one that would otherwise become invisible in production.
3. Add the hostile run-bundle fixture and its expected quarantined observation (§5).
4. State the ChatGPT task caps in `docs/07` (§4).
5. Decide the split question in §6 explicitly and record it in `docs/18`, whichever way you go. A recorded "we are building this generic because X" is fine; drifting into it is not.
6. Then the remaining v0.3 items (`adjust`, `required_review_mode`) with Milestone 0.

The architecture keeps getting better and the open items keep getting smaller — but four of them have now survived a version, and the highest-information experiment in the plan has moved further away rather than closer. If you only do one thing from this review, do item 1; if you do two, add item 2.
