# Selectable Product Catalogue Plan

## Why this is separate from source coverage

The source-family registry answers: **what ecosystems must be monitored to maintain truth?**

The selectable-product catalogue answers: **what concrete products/programs can a user add to their wallet and what source families govern them?**

These cardinalities are different. For example, `card.smbc` is one source family but may map to many individual card products. Therefore the current count of 29 credit-card issuer families must never be presented as 29 supported card SKUs.

## Planned catalogue domains

Create versioned catalogues for:

- credit-card products;
- point programs;
- QR/payment wallets;
- e-money/transit products;
- airline mileage programs and user tiers;
- hotel loyalty programs and user tiers;
- cashback/portal memberships where user ownership matters;
- payment-interface capabilities where they alter eligibility.

## Suggested record shape

```yaml
product_id: card.example.product
product_type: credit_card
display_name: Example Card
issuer_family_id: card.example
source_family_ids:
  - card.example
reward_asset_ids:
  - point.example
payment_capabilities:
  - physical_card
  - mobile_contactless
catalogue_status: active
rule_coverage_status: planned
valid_from: null
valid_to: null
notes: ""
```

## Invariants

- Every selectable product must map to at least one source family.
- Card/product metadata must come from canonical issuer sources; do not infer products from comparison sites.
- Product existence does not imply complete reward-rule coverage.
- Product variants with materially different fees, rewards, interfaces, caps, or transfer behavior require separate product IDs.
- User-specific state (selected bonus shops, tier, annual spend, campaign enrollment) belongs in user state, not in the product catalogue.
- Historical/retired products remain versioned for replay when needed.

## Implementation sequence

1. Define catalogue schemas and IDs.
2. Enumerate P0 user-selectable products from official issuer/program sources.
3. Map products to source-family IDs.
4. Add coverage-state fields that distinguish catalogue presence from economic-rule completeness.
5. Add CI checks: no selectable product without a valid source-family mapping; no fully supported product whose required family roles are incomplete.
6. Expand P1/P2/P3 only after source-maintenance capacity is measured.

## Current limitation

The 2026-08-20 research enumerates 255 source families, not every individual card SKU. When a requested card/product has not yet been enumerated, record a catalogue gap rather than guessing.
