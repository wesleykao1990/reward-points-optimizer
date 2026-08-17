# Reward Rule Specification v0.3

The JSON Schemas in `schemas/` define the portable structural and lexical contract. `docs/13_semantic_validation_contract.md` is equally normative for cross-field comparisons, graph constraints, conservation, reconciliation, and bitemporal uniqueness. This document explains the domain semantics the implementation must preserve.

## 1. Enclosing request, objective, and candidate plans

A recommendation request or golden scenario freezes the comparison facts—merchant or transfer target, amount, channel, time, user state, and valuation profile—and supplies one explicit objective. Candidate plans contain only the operations and assumptions needed to satisfy those facts. They do not contain expected rewards, expected residual balances, or any other answer that the engine is supposed to calculate.

A candidate route is an ordered operation-and-asset plan rather than a flat card/wallet/funding tuple:

```text
optional portal clickout
  -> stored-value top-up or voucher acquisition
  -> point transfer or redemption
  -> merchant purchase
  -> possible refund or reversal
  -> engine-calculated ending asset lots
```

Each operation has its own timestamp, instrument, interface, channel, amount, principal asset inputs, requested principal outputs, dependencies, and applicable rules. A reward attached to a top-up operation is not awarded again when the resulting balance is spent.

## 2. Principal movements and reward components are different ledgers

The engine produces two related but separate ledgers:

1. **Principal asset movements** record external funding, tender consumption, stored-value creation, transfers, refunds, reversals, and other changes in owned assets.
2. **Reward components** record points, miles, cashback, discounts, fees, probabilistic benefits, and clawbacks produced by reviewed rules.

A candidate operation may request the creation of a principal asset, such as a JPY 10,000 voucher. The engine—not the candidate plan—calculates the actual movement, lot creation, partial consumption, and ending balance. This prevents a candidate from supplying the answer or making residual value disappear.

## 3. Asset definitions and lots

Value is represented through canonical asset definitions and concrete lots. The model distinguishes:

- JPY and external funding liabilities;
- stored-value balances and vouchers;
- normal, limited-period, usage-limited, merchant-limited, pending, and promotional points;
- airline miles and hotel points;
- cashback, discounts, fees, refunds, and reversals.

An asset definition supplies its kind, program, precision, default reward class, default expiry policy, and default usage restrictions. A lot supplies the actual quantity, settlement status, acquisition time, expiry, restrictions, source operation, and provenance.

Residual value remains an ending asset after the current purchase. It is neither discarded nor described as a reward.

## 4. Economic reconciliation

Every eligible plan result must reconcile these explicit JPY value ranges:

```text
guaranteed net value change
  = merchant value received
  + ending asset value
  + guaranteed reward value
  - external funding
  - opening asset value consumed
  - fee value

expected net value change
  = guaranteed net value change
  + probabilistic expected reward value
```

`opening_asset_value_consumed_jpy` applies only to value the user owned before the plan. It does not include a stored-value lot created by an earlier operation in the same plan, because the external funding used to create that lot has already been counted.

For a JPY 1,000 top-up followed by a JPY 640 purchase, the JPY 360 balance remains an ending asset. The engine must not assign the entire JPY 1,000 as irreversible cost while omitting the ending asset, and it must not treat the JPY 360 as free reward value. The ending lot is valued under the scenario objective and the user's asset/class/expiry valuation profile. Stored-value valuation is per asset rather than global. A recommendation should preserve the valuation assumption and, when rank is sensitive, derive the break-even value at which the winner changes.

The result's `objective_score_jpy` is derived from the declared objective. It cannot bypass the reconciled economics. Probabilistic value is excluded from guaranteed ranking by default.

## 5. Rule families

### Non-financial rules

`payment_acceptance` and `exclusion` use an explicit effect and do not contain fake zero-reward calculations. An exclusion identifies the exact affected target, such as:

- operation eligibility;
- reward earning;
- tier progress;
- campaign progress;
- transfer eligibility;
- asset use.

A reward exclusion and a tier-progress exclusion are different facts unless evidence proves they are the same.

### Financial output rules

Base rewards, merchant bonuses, campaign bonuses, loyalty presentment, discounts, fees, and card benefits require both a calculation and an output description. The output states:

- asset and reward class;
- credit or debit sign;
- guaranteed, probabilistic, or conditional-selection certainty;
- posting state and expected posting window;
- expiry;
- usage restrictions;
- refund/clawback policy.

### Asset conversion, transfer, and redemption rules

`asset_conversion`, `transfer`, and `redemption` use the directed transfer calculation. They define source and destination assets, ratio, minimum, increment, per-request and per-period limits, fees, processing time, cancellation policy, and separately versioned bonus-rule IDs where applicable.

## 6. Scope and eligibility

A rule can include or exclude:

- countries and operation types;
- merchants, merchant groups, locations, and merchant categories;
- channels and interfaces;
- product classes;
- payment instruments and funding sources;
- source and destination assets;
- loyalty presentment;
- transaction, campaign, identity, tier, and prior-period conditions.

A broad chain fact is not automatically a verified branch fact. Merchant, channel, location, tenant, and franchise uncertainty remain visible.

## 7. User state and uncertainty

A user fact or cap-progress record is one of:

```text
known
estimated
unknown
not_applicable
```

Missing is never converted to `false`, zero, or a favorable assumption. Facts retain source, observation time, confidence, and optional bounds.

When uncertainty can change the result, the engine returns:

- a **definite winner** when one plan wins under every feasible state assignment;
- a **safe plan** when a conservative valid fallback exists;
- **conditional winners** with the named conditions under which they win;
- minimum, maximum, and—where justified—expected value ranges;
- the smallest useful questions likely to collapse the uncertainty.

Best-case and worst-case values must be calculated over mutually feasible assumptions. The engine may not combine incompatible favorable states merely to create a headline maximum.

## 8. Calculations and tiers

Supported calculation primitives are:

- percentage;
- points per JPY unit;
- fixed reward;
- tiered reward;
- multiplier;
- directed transfer/redemption ratio.

Tier basis can come from:

- the current transaction amount;
- a user fact such as membership rank;
- a period aggregate such as prior-month spend;
- an event counter such as monthly point-card presentations.

Arithmetic uses integer JPY and arbitrary-precision decimal reward units. JavaScript binary floating-point cannot determine canonical rewards, thresholds, caps, or rankings.

## 9. Rounding

Rounding records:

- aggregation scope;
- optional eligible-spend quantum;
- reward rounding mode.

A plain percentage rule does not require a meaningless spend quantum. A points-per-unit rule normally does.

## 10. Caps

Each cap records:

- cap identity and optional shared group;
- reward-unit or eligible-spend maximum;
- progress source;
- reset period, timezone, and boundary;
- whether the current operation may partially consume the remainder;
- behavior when progress is unknown.

Top-up, voucher, purchase, transfer, tier-progress, and campaign caps are distinct unless official evidence explicitly shares them.

## 11. Probabilistic rewards

A lottery or selection campaign is not guaranteed cashback. Guaranteed, probabilistic, and conditional-selection rewards remain distinct.

The default objective uses guaranteed value. Expected value is allowed only when the objective permits it and the probability has an accepted source. An undisclosed probability cannot be converted into face-value expected return.

## 12. Settlement, expiry, and clawback

A reward may be pending, posted, available, reversed, expired, or unknown. Posting delay and restricted expiry can affect user valuation without altering the factual earned units.

Refunds and cancellations produce explicit principal movements and debit reward components. Restoration of campaign cap, tier progress, or annual spend is a separate reviewed fact and is never assumed.

## 13. Bitemporal selection

Economic validity:

```text
valid_from <= operation_timestamp < valid_to
```

System validity:

```text
recorded_at <= replay_knowledge_at < superseded_at
```

Both operation time and replay-knowledge time are required for historical replay. An announced rule is not economically effective merely because it was published, and a later correction must not rewrite what the system knew earlier.

For each approved `rule_id`, economic and system validity form a bitemporal rectangle. Approved rectangles may overlap in one dimension, but never in both. Therefore a replay query for any `(operation_timestamp, replay_knowledge_at)` pair returns at most one approved version of a rule.

## 14. Evaluation algorithm

For every candidate plan:

1. Validate operation order, dependencies, timestamps, and referenced lot IDs.
2. Resolve merchant identity, location confidence, and the frozen comparison facts.
3. Select rule versions valid at operation time and replay-knowledge time.
4. Reject invalid acceptance, channel, interface, instrument, funding, and asset paths.
5. Match scope, user state, transaction conditions, and campaign conditions.
6. Calculate native reward/debit components with explicit rounding.
7. Apply operation-specific and shared caps.
8. Resolve inclusion, replacement, precedence, and conflicts.
9. Set settlement, expiry, certainty, restrictions, and clawback metadata.
10. Apply principal asset inputs and requested outputs, emit actual movements, and create ending lots.
11. Reconcile merchant value, external funding, opening assets consumed, ending assets, rewards, and fees.
12. Return applied and rejected rules, assumptions, ranges, and uncertainty conditions.
13. Apply the separate valuation profile without mutating native quantities.
14. Rank by the declared guaranteed or expected objective and apply explicit tie-breakers.
15. Persist exact contract, code, rule, evidence, valuation, source, and replay versions.

## 15. Invariants

- New merchants and campaigns are normally data, not merchant-specific code.
- Candidate plans do not contain engine-calculated rewards, movements, residual lots, or expected winners.
- The native principal and reward ledgers do not change when valuation changes.
- A reward cannot exceed its remaining cap.
- An expired, unrecorded, or ineligible rule cannot apply.
- A top-up reward cannot be re-awarded when the same asset is spent.
- Principal quantities are conserved across acquisition, consumption, transfer, refund, and ending assets.
- Residual assets cannot disappear and cannot be counted as rewards.
- External funding and pre-existing asset consumption cannot disappear.
- Economic summary fields reconcile exactly to the canonical formulas above.
- A probabilistic reward cannot enter guaranteed value.
- Transfer cycles cannot manufacture unbounded value.
- Rejected plans cannot win.
- Structured explanation tokens reconcile to applied rules, movements, components, and ending assets.
- Schema-valid but semantically invalid sibling ranges are rejected before calculation or persistence.
- For any transaction/system-time pair, at most one approved version per rule matches.
- A valuation-sensitivity result is derived from native economics and never changes native accounting.
