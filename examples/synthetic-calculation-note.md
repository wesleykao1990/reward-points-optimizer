# Synthetic independent calculation note

This note is contract-test arithmetic, not a market claim.

Both fixtures use the same operations, principal movements, reward quantities, and ending residual quantity. Only the valuation profile and valuation-dependent economics differ.

## Native accounting shared by both fixtures

- External funding for top-up: JPY 1,000
- Stored value created: 1,000 units
- Merchant purchase: 640 units / JPY 640
- Ending stored value: 360 units
- Guaranteed top-up reward: 10 normal points
- Direct-card external funding: JPY 640
- Direct-card merchant value: JPY 640

## Fixture JP-SYN-001 — residual valued at JPY 0.95

- Ending stored value: 360 × JPY 0.95 = JPY 342
- Top-up-plan net value: 640 + 342 + 10 − 1,000 = **JPY −8**
- Direct-card net value: 640 − 640 = **JPY 0**
- Winner: direct card

## Fixture JP-SYN-002 — residual valued at JPY 1.00

- Ending stored value: 360 × JPY 1.00 = JPY 360
- Top-up-plan net value: 640 + 360 + 10 − 1,000 = **JPY +10**
- Direct-card net value: JPY 0
- Winner: top-up then purchase

## Break-even sensitivity

Let `x` be JPY value per residual unit.

```text
Top-up net = 640 + 360x + 10 − 1,000
             = 360x − 350
```

The numerical tie occurs at:

```text
x = 350 / 360
  = 0.972222222222222222...
```

Because the objective tie-breaker prefers lower external funding, direct card remains the winner at the exact tie. The top-up plan wins only when the residual is valued **above** this threshold.

This pair proves that valuation can change ranking while native accounting remains unchanged.
