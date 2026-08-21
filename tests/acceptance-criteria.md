# Foundation Acceptance Criteria v0.4.1

## Contracts and semantic validation

- [ ] All eleven JSON Schemas pass Draft 2020-12 meta-validation.
- [ ] Relative references resolve without duplicate handwritten types.
- [ ] JSON Schema and `docs/13_semantic_validation_contract.md` are both implemented.
- [ ] Estimated fact bounds are comparable and lower is not greater than upper.
- [ ] Cap spend/reward minimums do not exceed maximums.
- [ ] Known cap progress has equal minimum and maximum values.
- [ ] Schema-valid but semantically invalid fixtures fail with path-specific errors.
- [ ] YAML and JSON source registries are semantically identical.
- [ ] Every source ID/URL is unique.
- [ ] All four access observations reference valid sources or document aggregate scope.
- [ ] Scenario plan contains exactly 100 records with a 40/40/20 split.
- [ ] Both synthetic valuation fixtures validate.
- [ ] Prompt-injection fixture yields no candidate rule and a security flag.

## Milestone 1A — operation and asset conservation

- [ ] Uses deterministic integer/decimal arithmetic.
- [ ] Validates operation order, timestamps, and dependencies.
- [ ] Supports direct purchase and top-up/voucher acquisition followed by purchase.
- [ ] Creates, partially consumes, and preserves asset lots.
- [ ] Candidate plans do not contain engine-calculated movements, rewards, ending lots, economics, or winners.
- [ ] Principal movements reconcile opening lots to ending lots.
- [ ] Residual value cannot disappear or be counted twice.
- [ ] A top-up reward is emitted only on the acquisition operation.
- [ ] Implements percentage and points-per-unit calculations with explicit rounding.
- [ ] Emits native reward components before valuation.
- [ ] Reconciles merchant value, external funding, opening asset value consumed, ending assets, guaranteed rewards, fees, and guaranteed net value.
- [ ] JPY 0.95 and JPY 1.00 residual valuations preserve identical native ledgers.
- [ ] The two valuation profiles reverse the winner only through valuation.
- [ ] Break-even residual valuation is derived from native economics.

## Milestone 1B — later engine surface

- [ ] Fixed, tiered, multiplier, and transfer calculations are added only after 1A passes.
- [ ] Tier basis supports transaction, user attribute, period aggregate, and event counter.
- [ ] Transfers enforce minimums, increments, maxima, fees, posting, cancellation, and cycle guards.
- [ ] Caps support known, estimated, unknown, partial, and exhausted progress.
- [ ] Stacking, inclusion, conflict, precedence, and replacement are tested.
- [ ] Probabilistic rewards are excluded from guaranteed value.
- [ ] Refund, reversal, and clawback are explicit.
- [ ] Definite winners are invariant across feasible states.
- [ ] Conditional winners and useful questions are returned when needed.
- [ ] Incompatible best-case assumptions are never combined.
- [ ] Residual-value sensitivity is user-visible and per asset.

## Evidence, source safety, and review

- [ ] Authority, permission, and technical reachability are independent.
- [ ] Conflicting environment observations are retained.
- [ ] The View Card source records both manual-browser reachability and datacenter 403.
- [ ] Unapproved automation is blocked.
- [ ] A blocked observation never triggers bypass behavior.
- [ ] Manual snapshot capture is available.
- [ ] Retrieved content is untrusted and embedded instructions are not executed.
- [ ] Source snapshots are immutable and content-hashed.
- [ ] Evidence maps exact snapshot regions to supported fields.
- [ ] Review mode is recorded honestly.
- [ ] Low/medium-risk first-ten scenarios use at least solo dual-pass.
- [ ] Transfer/large-campaign/loss-causing scenarios require human second review before golden.

## Bitemporal replay and database security

- [ ] `app_private`, `app_api`, and `user_data` are separate.
- [ ] Existing and default privileges are deny-by-default.
- [ ] User-owned tables have RLS enabled and forced.
- [ ] Approved rule definitions are immutable except controlled one-time system closure.
- [ ] No two approved versions of one rule overlap in both economic and system time.
- [ ] For generated `(transaction_time, replay_knowledge_time)` pairs, at most one approved version per rule matches.
- [ ] Adjacent system intervals are accepted.
- [ ] `app_api` views use `security_invoker` and `security_barrier`.
- [ ] A role granted only the view cannot read through it without explicit underlying privilege.
- [ ] FK join tables replace UUID-array pseudo-references.
- [ ] Permanent benchmark replay is separate from deletable user history.
- [ ] User history has retention class, purge deadline, and deletion tests.
- [ ] APIs reject PAN, CVV, PIN, payment QR, and bank-password fields.

## Delivery

- [ ] Fresh checkout can install, validate, test, and build.
- [x] Foundation checks use no live external content or secrets; the separate Agent Feed artifact check uses only the bounded, pinned HTTPS release URL.
- [ ] Checksum `--check` is non-mutating and fails on mismatch/untracked files.
- [ ] The initiating Codex run stops after Milestone 1A.
- [ ] Milestone 1B uses its separate prompt.
- [ ] PostgreSQL integration tests report the actual server version.
- [ ] README documents the internal-alpha scope and commercial gates.

## Required PostgreSQL integration scripts

- [ ] `db/tests/001_bitemporal_replay.sql` passes after the baseline migration.
- [ ] `db/tests/002_view_security.sql` passes with an isolated test role.
- [ ] Generated timestamp property tests show at most one approved version per rule for every `(transaction_time, replay_knowledge_time)` pair.


## Agent Feed integration

- [x] Agent Feed remains a separate project/deployable and protocol `0.1` is pinned through the published `@agent-feed/schema@0.1.1` release URL and SHA-512 integrity.
- [ ] Signed events are recorded idempotently before acknowledgement.
- [ ] Generic findings map only to untrusted `SourceObservation`.
- [ ] Transport dedupe and semantic dedupe are independently tested.
- [ ] Submitted evidence requires app-specific canonical capture/promotion.
- [ ] Agent confidence never becomes source authority.
- [ ] No direct database access crosses project boundaries.
- [ ] Realtime is not used as the queue or cross-project delivery mechanism.
- [ ] Completed zero-finding, partial, failed, and replayed runs are distinguishable.
