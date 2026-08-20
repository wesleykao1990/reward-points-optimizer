# Source Coverage Research Audit — 2026-08-20

## Baseline and purpose

This audit expands the v0.4.1 trusted-source baseline (140 page-level records) into a planning inventory for the full Japan Rewards Optimizer vision. The planning inventory is versioned as source-family v0.5.

A `covered` family means the baseline already contains useful official seeds; it does **not** mean every source role is complete. `partial` means material roles/routes remain absent. `missing` means the family is not adequately represented.

## Result

- 255 source families.
- 95 eventual Agent Feed streams.
- P0 44, P1 73, P2 101, P3 37.
- Baseline assessment: 48 covered, 20 partial, 187 missing.

Category counts:

- 29 credit-card issuer/card families;
- 24 point programs;
- 20 airline mileage programs;
- 18 hotel loyalty programs;
- 19 QR/payment wallets;
- 20 e-money/transit systems;
- 20 cashback/point-shopping portals;
- 86 merchant families;
- 5 card-network families;
- 5 payment-interface families;
- 4 regulatory families;
- 5 discovery-only families.

The complete family inventory, priority, status, stream, cadence, required source roles and representative URLs is stored under `registry/planning/source-families.v0.5/`.

## Major strengths in the current 140-page seed

The existing registry is strongest for the six major Japanese reward/payment ecosystems and a narrow set of high-frequency merchants:

- Rakuten;
- PayPay;
- d POINT / d払い;
- V Point / SMBC;
- Ponta / au PAY;
- AEON / WAON;
- ANA/JAL foundations and selected point-to-mile routes;
- major convenience stores and selected food, drugstore, electronics and e-commerce merchants;
- several Japanese/international cashback portals.

## Material gaps identified

### Credit cards / issuer points

JCB J-POINT, MUFG Global Points, Saison/UC, Orico, EPOS, JACCS, Life, Seven Card, Amex Membership Rewards, Diners and additional major/long-tail issuers require deeper catalogue, reward, exclusion, campaign and transfer coverage.

### QR/payment wallets and stored value

FamiPay completeness, Merpay, J-Coin Pay, Bank Pay, COIN+/AirWallet, ANA Pay, JAL Pay, Toyota Wallet, Kyash, Rakuten Edy, QUICPay and iD are important additions.

### Transit/e-money

PASMO/private-rail autocharge, ICOCA/WESTER/J-WEST, private railway programs, regional transport schemes and future payment-system changes need staged coverage.

### Airlines and hotels

Beyond ANA/JAL, the app needs transfer-relevant international airline programs plus Marriott, Hilton, IHG, Hyatt, Accor and relevant Japanese hotel programs. The required sources include earn/expiry, redemption, transfers, status/tier rules, offers/campaigns and changes.

### Portals and exchange routes

PeX, DotMoney, G-Point, EC Navi, PointTown, Point Income, issuer shopping malls and long-tail transfer routes are material to online and conversion optimization.

### Interfaces and card networks

Apple Pay, Google Wallet, Samsung Wallet, Visa/Mastercard/JCB/Amex network offer surfaces and interface-specific eligibility must be tracked separately from card products.

### Merchants

Broad daily-life coverage still requires supermarkets, drugstores, restaurants, electronics, department stores, fuel, travel-booking, delivery and other merchant families. Merchant support must include payment acceptance, loyalty, coupons/campaigns, channel differences, branch overrides and exclusions.

## Required source-pack roles

The `required_source_roles` column in the planning TSV is normative planning context. Common packs include:

- **Point program:** terms, earning, redemption/use, expiry/reward classes, transfers, campaigns, changes, merchant partners.
- **Payment wallet:** terms, base rewards, funding/top-up, eligible/excluded tenders, acceptance, campaigns/local campaigns, changes/incidents.
- **E-money/transit:** terms, charge/autocharge, eligible cards, earning, acceptance, campaigns, changes.
- **Credit-card issuer:** product catalogue, fees/benefits, base rewards, merchant/category bonuses, wallet/e-money exclusions, exchange directory, campaigns, changes.
- **Airline/hotel:** terms, earn/expiry, redemption, transfer partners/limits, campaigns/offers, status where relevant, changes.
- **Merchant:** accepted payments, loyalty, campaigns/coupons, channel differences, branch overrides, excluded products/services.

A family cannot be called fully supported until every required role has current canonical evidence or an explicit conservative exclusion.

## Monitoring architecture conclusions

1. Monitor source **families/streams**, not individual URLs.
2. Agent Feed is the generic run/finding transport; Rewards owns this 255-family domain registry.
3. `Finding != fact`; discovery sources can open investigation but cannot publish a reward rule.
4. New campaign pages are temporal canonical-source candidates linked to a family.
5. Expected cadence must be consumer-owned; a missed run is an alarm condition, distinct from a completed zero-finding run.
6. ChatGPT Scheduled Tasks may be used as a few independent sentinels; scalable production monitoring should use API workers that publish Agent Feed runs.
7. Public monitoring cannot guarantee app-only, email-only, invitation-only, receipt, branch-signage or user-targeted offers. Those require a private/user evidence lane and conditional recommendations.

## Rollout recommendation

- P0: 44 families / 19 streams — narrow launch core.
- P0+P1: 117 / 42 — credible nationwide daily-life breadth.
- P0+P1+P2: 218 / 86 — travel and broad consumer coverage.
- All planned: 255 / 95 — long-tail target.

Do not attempt all 255 before validating maintenance economics. Import P0 plus selected P1, run the two-lane 30-day rehearsal, measure recall/false positives/detection delay/human review time/source accessibility/missed runs/cost per useful finding, then decide expansion.

## Product-catalogue consequence

The 29 credit-card issuer families are **not 29 individual cards**. A source family is the monitored authority unit; the user-selectable product catalogue must separately enumerate actual card SKUs and map each to one or more source families. The same distinction applies to airline/hotel tiers and other product variants.
