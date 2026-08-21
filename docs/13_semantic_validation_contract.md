# Semantic Validation Contract v0.3

## Status

This document is canonical for cross-field invariants that JSON Schema Draft 2020-12 cannot express portably. It complements, but does not replace, the JSON Schemas.

Contract precedence:

1. JSON Schema defines structure, discriminators, required fields, lexical types, enums, and references.
2. This document defines cross-property and graph invariants.
3. PostgreSQL constraints protect persisted forms where the database can express the same invariant.
4. A contradiction between layers blocks release; an implementation must not choose a convenient interpretation.

A document is valid only when it passes **both** JSON Schema and semantic validation.

## 1. Comparable values

Estimated user-state bounds must be comparable numeric values:

- both integers; or
- both decimal strings matching the schema's decimal pattern.

The shared semantic validator converts either form to arbitrary-precision decimal before comparison. Mixed integer/string representations are allowed only after exact decimal normalization. Objects, arrays, booleans, and nonnumeric strings are not valid estimated bounds.

Invariant:

```text
lower_bound <= upper_bound
```

Known facts may hold any schema-valid `value`; estimated facts are deliberately restricted to ordered numeric ranges.

## 2. User-state invariants

### Known fact

- `value` is present;
- `observed_at` is present;
- bounds are ignored or null;
- source is not silently changed to `inferred`.

### Estimated fact

- lower and upper bounds are present and comparable;
- lower is not greater than upper;
- confidence and observation time are present;
- the source identifies whether the estimate came from the user, history, provider, inference, or review.

### Unknown or not applicable

- no favorable value is invented;
- confidence is null;
- the engine either omits the affected reward, returns a feasible range, or asks a targeted question according to policy.

## 3. Cap-progress invariants

For `known` and `estimated` cap progress:

```text
eligible_spend_jpy_min <= eligible_spend_jpy_max
reward_earned_units_min <= reward_earned_units_max
```

For `known` progress:

```text
eligible_spend_jpy_min = eligible_spend_jpy_max
reward_earned_units_min = reward_earned_units_max
```

`period_end` must be strictly after `period_start` when both are present. Unknown progress is never treated as zero.

## 4. Bitemporal rule uniqueness

For each rule and any pair:

```text
(transaction_time, replay_knowledge_time)
```

there may be at most one approved matching version.

A version matches when both are true:

```text
valid_from <= transaction_time < valid_to
recorded_at <= replay_knowledge_time < superseded_at
```

Null end values mean positive infinity. The database exclusion constraint and engine property tests must enforce the same half-open interval semantics.

## 5. Plan graph invariants

- operation IDs and sequence numbers are unique;
- dependencies point to existing earlier operations;
- timestamps do not move backward relative to operation sequence;
- an asset lot is consumed only after it exists;
- external funding cannot masquerade as an internal reusable lot;
- candidate plans do not contain engine-calculated rewards, movements, ending lots, economics, or winners;
- every candidate completes the same frozen merchant purchase or transfer objective.

### Tax-exclusive eligible spend

`line_items[].amount_jpy` remains the tax-inclusive tender component and must reconcile to the merchant operation amount. When a reward rule declares `scope.tax_basis = tax_exclusive`, it must also use `eligible_amount_basis = eligible_line_items`, and every reward-eligible line must provide `tax_exclusive_amount_jpy`.

For each line:

```text
0 <= tax_exclusive_amount_jpy <= amount_jpy
```

The engine sums the explicit tax-exclusive values for reward-eligible lines. It must reject the rule calculation when any required value is missing or invalid; it must not derive pre-tax spend by assuming a tax rate.

## 6. Asset conservation

For each reusable asset:

```text
opening quantity
+ created/returned quantity
- consumed/expired quantity
= ending quantity
```

External funding and fees are economic flows, not reusable opening lots. Rewards are reconciled separately from principal assets. A top-up reward is attached to the acquisition operation and cannot be awarded again when the resulting balance is spent.

## 7. Economic reconciliation

For exact-valued fixtures:

```text
guaranteed net value
= merchant value received
+ ending asset value
+ guaranteed reward value
- external funding
- opening asset value consumed
- fees
```

```text
expected net value
= guaranteed net value
+ probabilistic expected reward value
```

Residual principal is never labeled reward. A plan cannot win by omitting the funding used to acquire its balance.

## 8. Valuation isolation

Valuation may change:

- ending-asset value;
- reward value;
- objective score;
- winner and runner-up.

Valuation must not change:

- operation graph;
- principal movements;
- reward quantities and classes;
- ending asset quantities;
- applied rule IDs;
- settlement, expiry, or restriction facts.

The two synthetic golden fixtures prove this by using identical native accounting with different residual valuation profiles and opposite winners.

## 9. Reward certainty

- `guaranteed` components do not enter probabilistic expected value;
- `probabilistic` components require a non-null probability source;
- official or historical probability sources require an explicit probability;
- `undisclosed` probability may remain null and must not enter guaranteed ranking;
- conditional selection is not silently converted into a lottery probability.

## 10. Source observation consistency

- technical reachability is tied to an observation ID, time, method, and environment;
- a source with a non-unknown technical classification cites at least one observation;
- a mixed classification cites the conflicting observations;
- reachability never changes terms permission;
- blocked access never authorizes a bypass.

## 11. Required negative semantic tests

The shared validator must reject at least:

1. known cap progress whose lower and upper values differ;
2. cap progress with any lower bound greater than its upper bound;
3. estimated user state with lower bound greater than upper bound;
4. probabilistic reward with null probability source;
5. disclosed probability source with null probability;
6. duplicate operation IDs or backward dependency;
7. asset consumption before creation;
8. economic summary that fails reconciliation;
9. valuation change that mutates native accounting;
10. two approved versions matching one bitemporal replay point.

## 12. v0.4.1 conservation identity

Conservation buckets are keyed by:

```text
(asset_id, reward_class)
```

Normal, limited-period, usage-limited, and stored-value classes are not fungible merely because they share a program or asset ID. Any intentional conversion between classes must be an explicit reviewed operation with input and output movements.

The generic `adjust` direction is not part of v0.4.1. Corrections must use explicit create/consume/return/expire/reversal semantics. A future signed adjustment contract requires a reason code, evidence, and separate review.

## 13. Review-policy completion

A record declares `required_review_modes` separately from immutable review events. A record may enter `verified`, `approved`, `reviewed`, or `golden` only when every required mode has at least one approved completion event. Agent challenge is never mislabeled as independent human review.

## 14. Definition hash semantics

`definition_hash` is a reproducible hash of canonicalized economic definition content only. It is useful for comparison and duplicate warnings but is not a unique historical identifier. The same hash may recur in distinct non-overlapping bitemporal intervals. Publication retries are controlled by an explicit idempotency key.
