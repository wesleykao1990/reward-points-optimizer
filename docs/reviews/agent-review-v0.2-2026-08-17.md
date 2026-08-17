# Review — Japan Rewards Optimizer Foundation v0.2

Reviewed 2026-08-17. Package extracted and validated; **the migration was executed against a real PostgreSQL 16.14 instance** and every security and integrity claim was tested rather than read. New source URLs probed live.

---

## Verdict

Every item from the v0.1 review was addressed, and several were addressed *better* than proposed. The `docs/11_review_decisions_v0.2.md` decision matrix with an "Accepted with a different implementation" section and a "Pushbacks retained" section is the right way to handle a review — you kept the reasoning where the next agent will read it instead of silently patching.

Three responses in particular are improvements on what I suggested:

- **Operations + asset lots beats ordered legs.** I proposed a linear chain of charge legs. You generalized to timestamped operations with dependencies, asset inputs, requested outputs, and created lots. That handles the ¥10,000 voucher funding a ¥3,200 purchase with a residual lot — which my model would have fudged by attributing the whole acquisition cost to one purchase. It also absorbs transfers, redemptions, refunds, and portal clickouts as the same shape.
- **Asset ref + reward class + lot metadata beats minting a currency per campaign.** Keeping program identity separate from `reward_class`, `settlement`, `expiry`, and `restrictions` avoids a combinatorial explosion of currency IDs while letting valuation key on `(asset, class, expiry horizon)`.
- **Guaranteed vs probabilistic separation** wasn't in my review at all. Undisclosed-odds lottery rewards not silently entering guaranteed ranking is a real Japanese failure mode (抽選 campaigns are everywhere) and you caught it independently.

I have **one significant new finding**, two smaller ones, and one scoping concern.

---

## 1. What I verified this time

### Package

| Check | Result |
|---|---|
| `validate_package.py` | passes — 10 schemas, 140 sources, 3 access observations, 8 rehearsal sources, 100 scenarios, 40/40/20 |
| `generate_checksums.py --check` | **now non-mutating**, verified 67 checksums, exit 0 |
| `sha256sum -c` | all 67 verify |
| Doc↔schema identifier cross-check | no remaining drift (the ~170 unmatched tokens are all `authority_scope` free-text values in the catalog, not schema fields) |
| New source URLs | PayPay voucher help **200 live** (`他社カード利用券について`), PostgreSQL and Supabase docs 200 |

The synthetic economics fixture reconciles under independent arithmetic: 640 + 342 + 10 − 1,000 = −8 for the top-up plan, 640 − 640 = 0 for direct card. Correct, and it demonstrates the right thing.

### Database — executed, not just read

I installed PostgreSQL 16.14, ran `db/0001_core_schema.sql` with `ON_ERROR_STOP=1`, and tested each claim. **The migration applies cleanly** (23 tables in `app_private`, 10 in `user_data`, 2 views in `app_api`, 0 in `public`). Results:

| # | Test | Result |
|---|---|---|
| 1 | Overlapping approved economic interval | **blocked** by GiST exclusion constraint |
| 2 | `UPDATE` an approved rule definition | **blocked** by trigger |
| 3 | `DELETE` an approved rule version | **blocked** by trigger |
| 4 | Closing `superseded_at` only | **allowed** (exactly once) |
| 5 | New approved version after supersession | **allowed** |
| 6 | `approved` without `review_mode` | **blocked** by check constraint |
| 7 | Cascade delete from `user_profiles` | child rows removed |
| 8 | RLS on all 10 `user_data` tables | `enable` + `force`, 0 policies (deny-by-default confirmed) |
| 9 | `UPDATE`/`DELETE` on `source_snapshots` | **blocked** by append-only trigger |
| 10 | Deleting a source with snapshots | **blocked** by FK restrict |
| 11 | Non-superuser role reading `app_private` / `user_data` | permission denied for schema |

That closes the "Deferred validation" item in your decision doc for everything except deployment-specific RLS policies and retention purging. All eleven of my v0.1 database findings are now enforced *and* demonstrably enforced.

---

## 2. New finding: the overlap constraint guards current state, not replay

**This is the one to fix.** The exclusion constraint is:

```sql
exclude using gist (
    rule_id with =,
    tstzrange(valid_from, coalesce(valid_to, 'infinity'), '[)') with &&
)
where (review_status = 'approved' and superseded_at is null);
```

The `superseded_at is null` predicate means it only constrains the **currently active** set. Two *historical* versions can overlap in both economic and system time, and a bitemporal replay query will then match both.

I reproduced this on the live instance. Insert v1 with economic `[2026-01-01, ∞)` and system `[2026-02-01, 2026-09-01)`; insert v2 with a backdated system interval `[2026-04-01, 2026-09-01)` and economic `[2026-03-01, ∞)`. Both are accepted. Then:

```sql
-- replay: transaction 2026-06-01, knowledge time 2026-05-01
select count(*) ... where review_status='approved'
  and valid_from <= '2026-06-01' and (valid_to is null or valid_to > '2026-06-01')
  and recorded_at <= '2026-05-01' and (superseded_at is null or superseded_at > '2026-05-01');
-- → matching_versions = 2  {1,2}
```

Two rule versions match one `(transaction_time, knowledge_time)` pair. That is exactly the non-determinism ADR-003 exists to prevent, and it silently breaks the replay reproducibility that Milestone 5's gate asserts. It won't appear in normal sequential operation — it appears the first time someone backdates a correction, which is precisely when audit matters most.

**Fix — tested and working.** Extend the exclusion to the full bitemporal rectangle. GiST exclusion requires *all* operators to conflict simultaneously, so this expresses "no two approved versions of the same rule overlap in both economic and system time":

```sql
alter table app_private.reward_rule_versions
drop constraint reward_rule_versions_no_approved_overlap;

alter table app_private.reward_rule_versions
add constraint reward_rule_versions_no_bitemporal_overlap
exclude using gist (
    rule_id with =,
    tstzrange(valid_from,  coalesce(valid_to,      'infinity'::timestamptz), '[)') with &&,
    tstzrange(recorded_at, coalesce(superseded_at, 'infinity'::timestamptz), '[)') with &&
)
where (review_status = 'approved');
```

I verified on PG 16 that this rejects the backdated overlap above and still accepts a version whose system interval starts where the previous one closed. It also subsumes the current constraint — two unsuperseded approved versions both have system interval `[recorded_at, ∞)`, which always overlaps.

Add the replay-ambiguity case to the Milestone 2 gate: *a replay query for any `(transaction_time, knowledge_time)` returns at most one approved version per rule.* Assert it as a property test over generated timestamps, not just as a constraint.

---

## 3. Smaller findings

### 3.1 `app_api` views run as superuser (one-line fix)

The two views in `app_api` are owned by the migration runner (`postgres`) and have no `security_invoker` option, so they execute with the owner's privileges. Right now nothing is granted, so it's latent — but `app_api` exists precisely to be the granted surface, and the next step an implementer takes is a grant. I confirmed on the instance:

```
grant usage on schema app_api to appclient;
grant select on app_api.approved_reward_rule_versions to appclient;
set role appclient;
select count(*) from app_api.approved_reward_rule_versions;  -- works
select count(*) from app_private.reward_rule_versions;       -- permission denied
```

So a client role reads `app_private` data through a superuser-owned view. The exposure is bounded by the view's column list and `WHERE` clause, so it isn't an escalation to arbitrary data — but it means the view definition is the *entire* security boundary with no defense in depth, and the boundary is enforced by a superuser. Given the package's stated principle of schema separation, this should be a recorded decision rather than a PostgreSQL default.

Either:

```sql
alter view app_api.verified_sources set (security_invoker = true);
alter view app_api.approved_reward_rule_versions set (security_invoker = true);
```

(then grant `usage` on `app_private` plus `select` on the two underlying tables to the reader role), or keep security-definer semantics deliberately and **reassign the views to a least-privilege owner** that holds nothing beyond select on those tables. Add a comment either way — this is the kind of default an agent will never revisit.

### 3.2 JSON Schema is looser than SQL in three places

`docs/08` ADR-006 makes JSON Schema the contract source of truth, but the SQL is now stricter, so a payload can validate and then be rejected by the database:

| Case | JSON Schema | SQL |
|---|---|---|
| `capProgressState` with `status: known` and `min ≠ max` | **accepts** | rejected by check constraint |
| `capProgressState` with `min > max` | **accepts** | rejected |
| `stateValue` with `status: estimated` and `lower_bound > upper_bound` | **accepts** | n/a |

Confirmed with `jsonschema` Draft 2020-12. `stateValue.lower_bound` / `upper_bound` are untyped `{}`, so no ordering is expressible there without typing them. Either add `if/then` ordering assertions to the schemas, or state explicitly in ADR-006 that a documented set of semantic invariants lives outside JSON Schema and list them — right now the asymmetry is undeclared, and "the schema is the contract" is the sentence Codex will act on.

### 3.3 `jp.viewcard.suica-charge` is classified reachable but returns 403

Registered with `technical_feasibility.current_classification: plain_http_observed_reachable` and `last_observed_at: 2026-08-17T14:30+09:00`. My probe from a datacenter IP returns **403 Access Denied** — consistent with the rest of the JR East cluster (`jp.jrepoint.*` were all 403 in the v0.1 probe and are correctly recorded as blocked).

Your own framing handles this correctly — an observation is environment-specific, not a permanent fact — so the fix is small: either downgrade this one to match the JR East cluster, or record which environment observed it reachable. It's worth catching because it's the exact source backing the highest-value charge route in the new operation model (View Card → Mobile Suica), and Milestone 3 will assume it's fetchable.

Also minor: the `certainty` definition's `allOf` (`if type = probabilistic then required: probability_source`) is a no-op, since `probability_source` is already in the top-level `required`. If the intent was to require a **non-null** probability source for probabilistic rewards, the `then` needs to narrow the type rather than restate the requirement.

---

## 4. Scoping concern: Milestone 1 has grown

The schemas went from 1,956 to 4,194 lines (+114%); `reward-rule.schema.json` alone is now 1,416. Milestone 1 lists 13 deliverable groups and 10 mandatory synthetic proofs, spanning six calculation models, operation-and-asset conservation, settlement, expiry, restrictions, caps in five states, stacking, probabilistic separation, typed unknown state, conditional winners, and next-question generation.

The model is right. But "foundation vertical slice" now means most of the engine, and the failure mode is six half-working calculation models rather than a conserved ledger.

**Suggested split, preserving your ordering:**

- **1a — conservation and reconciliation.** Operations, dependencies, asset lots, movements, residuals, and the reconciled economic summary, with **only** `percentage` and `points_per_unit`. Mandatory proofs: direct purchase; card-funded top-up then purchase; ¥10,000 acquisition funding a smaller purchase with residual; limited-period vs normal valuation. Gate: every plan reconciles, residual neither discarded nor double-counted, valuation never mutates native accounting.
- **1b — the remaining calculation and uncertainty surface.** `fixed`, `tiered` (all four bases), `multiplier`, `transfer` (minimum/increment/maximum/fee/cycle guard), caps in all five states, probabilistic separation, conditional winners and next questions.

Getting conservation provably right on two calculation models is worth more than partial coverage of six, because everything downstream reconciles against the ledger. And 1a is a natural place to stop and check the shape before committing to the rest.

Related: the two synthetic fixtures currently differ in that the direct-card plan earns **nothing**, which is what makes the top-up lose. `examples/synthetic-calculation-note.md` observes that at a residual valuation of ¥1.00 the top-up plan would instead net +10 — but that flip only exists in prose. Encode it as a second fixture with an identical ledger and a different valuation profile, so "valuation changes ranking but never the native ledger" is proven by data.

---

## 5. One product-level consequence worth naming

Valuing the ¥360 residual at ¥0.95 is architecturally correct, and the model is right to force the question. But it means **the residual/stored-value valuation is now the single most influential number in the system** — it is what decides top-up routes against direct payment, and in Japan that is where most of the value lives.

It is also a user-supplied guess, and a slightly pessimistic default will systematically steer users away from exactly the routes (Rakuten Cash, Mobile Suica, au PAY, and now PayPay vouchers) that the v0.2 model was built to represent.

Two things follow:

- Make residual valuation an explicit onboarding question with per-asset defaults grounded in something real — "will you spend your Rakuten Cash balance within a month?" → 1.0, "rarely" → discount — rather than a single global rate.
- Surface the sensitivity in the "why" view: *"direct card wins unless you value leftover wallet balance above ¥0.98."* That is genuinely useful, it is only possible because you separated ledger from valuation, and it turns the model's main complexity into a visible product feature.

---

## 6. Still open from the v0.1 review

- **Solo or second reviewer.** v0.2 handles this well — `review_mode` is now a typed, enforced column (`approved` requires it), and `docs/11` states solo review is never mislabeled independent. What's still unstated is *which mode you will actually use* for the first ten scenarios. Pick it now; it changes the Milestone 3 time budget by roughly a factor of two.
- **Personal tool or commercial product.** Milestone 6 narrows to Tokyo convenience stores, and Milestone 4's decision gate explicitly lists "change the product into a personal optimizer for a fixed wallet" as an outcome — which is the right way to defer the question. Worth being honest with yourself about which answer you're hoping for, because it changes whether the affiliate/disclosure work in `docs/07` §8 is ever needed.

---

## Recommended order

1. Apply the bitemporal exclusion constraint (§2) and add the replay-ambiguity property test.
2. Decide the `app_api` view ownership/invoker question and comment it (§3.1).
3. Reconcile the three JSON-Schema-vs-SQL asymmetries, or declare them in ADR-006 (§3.2).
4. Correct the `jp.viewcard.suica-charge` feasibility classification (§3.3).
5. Split Milestone 1 into 1a/1b and add the second valuation fixture (§4).
6. Hand to Codex.

The foundation is sound. Nothing above blocks starting implementation except item 1, which is a one-line constraint change that is far cheaper now than after there are rule versions in the table.
