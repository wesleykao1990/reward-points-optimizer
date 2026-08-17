# Codex Continuation Prompt — Japan Rewards Optimizer Milestone 1b

Use this prompt only after Milestone 1a has passed its conservation, reconciliation, valuation-isolation, replay, and database gates.

## Preconditions

Before editing, verify and report:

- the direct and pre-funded plans reconcile;
- both valuation fixtures use identical native accounting and opposite winners;
- percentage and points-per-unit are complete;
- the bitemporal replay property test passes against PostgreSQL;
- no unresolved contract contradiction remains.

Do not proceed if any precondition fails.

## Objective

Extend the already conserved kernel with the remaining calculation and uncertainty surface without changing its native accounting contracts.

## Required implementation

### Calculations

- fixed reward;
- tiered reward with transaction, user-fact, period-aggregate, and event-counter bases;
- multiplier;
- transfer ratio with minimum, increment, request/period maxima, fee, posting window, cancellation, and cycle guard.

### Caps and stacking

- per-transaction/day/month/campaign/year/lifetime caps;
- known, estimated, unknown, partially remaining, and exhausted progress;
- timezone and reset boundary;
- partial consumption;
- shared cap groups;
- included base reward;
- additive, best-of, replacement, precedence, conflict, and dependency behavior.

### Uncertainty and ranking

- feasible-state evaluation without joining incompatible assumptions;
- definite winner only when invariant;
- conditional winners and value ranges;
- smallest useful questions likely to change the winner;
- probabilistic components separated from guaranteed ranking;
- optional expected-value objective only when probability is supported.

### Lifecycle adjustments

- refund;
- reversal;
- reward expiry;
- proportional/full/provider-defined clawback.

## Mandatory tests

- fixed threshold one below/exact/one above;
- all four tier bases;
- included base reward not doubled;
- funding exclusion;
- cap partial/exhausted/reset/unknown cases;
- unknown enrollment produces conditional output rather than false;
- no incompatible best-case assumption combination;
- transfer minimum/increment/max/fee and cycle guard;
- undisclosed lottery excluded from guaranteed value;
- refund and proportional clawback;
- all Milestone 1a fixtures and properties remain unchanged.

## Stop condition

Stop when Milestone 1b passes. Do not build the consumer UI or live source collectors. Report whether the engine is ready for the first ten evidence-backed scenarios.

## Separate Agent Feed boundary

The sibling `../agent-feed` project is external to this codebase. Do not implement its server, SDKs, MCP tools, queues, or database here. Live monitoring and Agent Feed consumer integration are out of scope for this run.
