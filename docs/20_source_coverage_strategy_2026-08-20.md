# Source Coverage Strategy — 2026-08-20

## Purpose

This document turns the 2026-08-20 source-coverage research into implementation policy for Japan Rewards Optimizer and its Agent Feed monitoring integration.

The application ultimately needs to optimize complete purchase routes across credit cards, point systems, QR/payment wallets, e-money/transit systems, airline miles, hotel rewards, cashback portals, payment interfaces, merchant programs, and time-limited campaigns.

## Coverage model

A **source family** is a monitoring and authority unit. It is not an individual card SKU, point balance, campaign, or merchant branch.

A family groups the official surfaces needed to understand one ecosystem. Examples:

- `card.smbc` — SMBC/Vpass card ecosystem.
- `wallet.paypay` — PayPay wallet rules, funding, acceptance, campaigns, and notices.
- `point.rakuten` — Rakuten Point earning, use, expiry/reward classes, transfers, campaigns, and partner merchants.
- `merchant.familymart` — FamilyMart acceptance, loyalty, campaigns/coupons, channel differences, branch overrides, and exclusions.

Dynamic campaign pages are temporary canonical sources linked to the relevant family.

## Coverage snapshot

Research date: 2026-08-20.

| Category | Planned families |
|---|---:|
| Credit-card issuers / card families | 29 |
| Point programs | 24 |
| Airline mileage programs | 20 |
| Hotel loyalty programs | 18 |
| QR/payment wallets | 19 |
| E-money/transit systems | 20 |
| Cashback / point-shopping portals | 20 |
| Merchant families | 86 |
| Card networks | 5 |
| Payment interfaces | 5 |
| Regulatory | 4 |
| Discovery-only | 5 |
| **Total** | **255** |

Current planning assessment: 48 covered, 20 partial, 187 missing. These statuses describe the pre-existing registry's useful source presence, not readiness to expose a program as fully supported.

## Rollout

### P0 — launch core

44 families across 19 Agent Feed streams. Prioritize major Japanese daily-spend ecosystems, core convenience/daily merchants, primary wallets/points/cards, transit foundations, and regulatory/trust sources.

### P0 + P1 — nationwide daily-life breadth

117 families across 42 streams. Add additional major card issuers, wallets, portals, ANA/JAL, and broader merchants.

### P0 + P1 + P2 — travel and broad consumer coverage

218 families across 86 streams. Add major hotel programs, international mileage programs relevant to Japanese transfers, payment interfaces/networks, secondary wallets, broader transit, merchant and portal coverage.

### P3 — long tail

255 families across 95 streams. Add smaller/regional/international programs where user demand justifies the maintenance burden.

## Supported-program gate

A family must not be represented as fully supported merely because a root official URL is known.

For each family, inspect `required_source_roles` in the appropriate priority TSV under `registry/planning/source-families.v0.5/`. Every required role must have either:

1. current canonical evidence, or
2. an explicit conservative exclusion stating that the capability is unavailable/unverified and therefore cannot improve a recommendation.

Examples of required roles include base earning, funding/top-up, exclusions, campaign directory, transfer partners, expiry/reward classes, merchant acceptance, branch/channel differences, and change notices.

## Source authority and discovery

- Official issuer/program/merchant/regulator sources may become canonical evidence after source-policy review and capture.
- Discovery sources, social posts, comparison sites, and point/travel media may create investigation leads only.
- Discovery evidence must never directly mutate `RewardRuleVersion`.
- App-only, email-only, invitation-only and account-targeted offers require a separate private/user-specific evidence lane and must not be generalized without canonical public evidence.

## Agent Feed ownership boundary

Agent Feed owns generic run/finding/evidence transport and liveness semantics. Rewards Optimizer owns the list of Japan reward source families, mapping of source families to streams, canonical evidence acquisition, reward-domain review, and rule publication.

Do not move the 255-family registry into the generic Agent Feed project.

## Monitoring granularity

Prefer one stream covering related families and source roles rather than one scheduled task per URL. For example, `economy.paypay` can monitor the PayPay wallet, PayPay Card, PayPay Points, Yahoo Shopping relationship, funding-route changes, and campaign/change surfaces.

A run must report expected scope, actual scope, successful/failed checks, findings, and terminal status. A registered stream that should have run but did not is an overdue-run incident, not a quiet zero-finding period.

## Near-term implementation rule

Do not attempt to onboard all 255 families before product validation. Implement P0 and a selected P1 sample, then run the planned two-lane source-maintenance rehearsal before expanding coverage.
