# Residual Stored-Value Valuation and Sensitivity v0.3

## Why this is a product-level contract

A top-up route commonly acquires more stored value than the current purchase consumes. The remaining balance is neither free reward nor automatically equal to cash. Its value depends on whether the user is likely to spend it, when it expires, where it can be used, and whether it can be transferred or refunded.

One global stored-value discount would systematically bias recommendations. Valuation must therefore be **per asset and per user assumption**.

## Valuation entry

Each stored-value valuation records:

- asset ID;
- JPY value per unit;
- assumption source;
- expected use horizon where known;
- expiry horizon;
- basis and optional note.

Supported assumption sources include:

- explicit onboarding answer;
- observed usage history;
- face-value default;
- program-restriction default;
- user custom value.

Defaults must be versioned and transparent. The application must not imply that a default is an objective market price.

## Recommended onboarding interaction

Ask the user a concrete, asset-specific question rather than asking for an abstract discount rate:

> How likely are you to spend this balance?

Suggested responses:

- within 30 days;
- within 90 days;
- eventually, but not regularly;
- rarely;
- use a custom valuation.

The UI may map these answers to versioned defaults, but must show the resulting JPY-per-unit assumption and permit an override.

## Sensitivity output

When a valuation assumption can change the winner, the canonical result should expose a break-even threshold:

```yaml
asset_id: wallet.synthetic.balance
current_jpy_per_unit: "0.95"
break_even_jpy_per_unit: "0.9722222222"
winner_at_or_below_threshold_plan_id: plan_synthetic_direct_card
winner_above_threshold_plan_id: plan_synthetic_topup_then_pay
```

A user-facing explanation can round safely:

> Direct card wins at your current balance valuation. The top-up route becomes better at roughly JPY 0.98 per remaining unit.

The engine computes the threshold using arbitrary-precision decimal arithmetic. It must not change native movements or quantities while doing so.

## Default ranking behavior

- use the active per-asset user valuation when present;
- otherwise ask the onboarding question before recommending a route whose winner is valuation-sensitive;
- if the user declines, return a conditional result or conservative safe plan;
- do not silently assume face value for restricted or expiring stored value;
- do not silently apply one pessimistic global rate to all wallets.

## Privacy

A usage-intent answer is preference data. It does not require transaction aggregation. Store only the minimum needed for personalization, allow deletion, and distinguish user-provided intent from inferred history.
