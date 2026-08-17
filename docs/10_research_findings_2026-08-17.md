# Research Findings That Shape the Data Model

Research cutoff: **2026-08-17**

This note summarizes why a simple `merchant + card + percentage` table is insufficient. The source IDs refer to the canonical registry.

## 1. Payment route is distinct from payment product

Japanese reward eligibility can differ among physical card, card contactless, smartphone contactless, QR wallet, balance, linked card, mobile order, and online checkout. Card issuer pages such as `jp.smbc.eligible-merchant-rewards` and `jp.smbc.vpoint-up-program` make the payment interface and eligible merchant scope material to the return. The rule specification therefore models `payment_instrument`, `funding_source`, `interface`, and `channel` separately.

## 2. Funding source can remove a wallet reward layer

Official d払い and d Card material in `jp.dcard.exclusions` and `jp.dpoint.campaign-example-funding-exclusion` demonstrates that a QR route cannot be evaluated from the wallet name alone. The engine must match the underlying funding source and distinguish ordinary points from campaign points.

## 3. Rounding and points-funded amounts can reverse a small purchase winner

PayPay sources `jp.paypay.calculation-faq`, `jp.paypay.eligibility-faq`, and `jp.paypay.reward-rate` document calculation-unit and eligible-payment details. A headline percentage is therefore not enough: the rule needs denominator, rounding stage, eligible amount basis, and treatment of points used. Small transactions must be boundary-tested.

## 4. Identity and enrollment are economic inputs

`jp.paypay.step` and campaign-specific payment-provider pages show that identity verification, prior entry, or user state may determine eligibility. The application must represent those values as known, unknown, true, or false rather than treating absence as false or assuming enrollment.

## 5. Announced changes are not necessarily effective changes

`jp.rakutenpay.change-notice-2026` is included because an announcement, modification, postponement, or later clarification must not be applied merely because a future rule appeared on an official page. Store publication time, economic effective time, and system knowledge time separately.

## 6. Merchant-owned channel rules can override generic acceptance assumptions

Merchant pages such as `merchant.mcdonalds.payment`, `merchant.mcdonalds.rewards`, and `merchant.starbucks.rewards` distinguish counter, app, mobile-order, or reward-earning behavior. The merchant is generally the appropriate authority for channel and product exceptions, while the payment or card issuer remains authoritative for its own reward layer.

## 7. Common-point presentation can be selectable or linked

FamilyMart and Lawson sources in the registry show that common point identification and presentation order deserve their own layer. The engine must prevent two mutually exclusive common-point programs from being awarded merely because the user owns both.

## 8. Electronics-store point value is product- and tender-dependent

`merchant.biccamera.store-payment`, `merchant.biccamera.points`, `merchant.yodobashi.payment`, and `merchant.yodobashi.points` justify modeling the merchant reward separately from the card reward. A generic store headline cannot safely substitute for a product-specific rate or tender adjustment.

## 9. Transfer campaigns are time-bounded directed graph edges

Ponta/JAL, Rakuten/ANA, and airline/hotel sources in the registry show that transfer routes can have separate entry, request, posting, minimum, maximum, and cancellation conditions. The transfer engine therefore uses directed, versioned edges instead of converting every currency to a timeless yen rate.

## 10. Cashback portal comparison requires clickout and attribution state

Rakuten Rebates, Moppy, Hapitas, airline malls, hotel cashback services, and international portals are represented as portal sources. Their economic value may depend on click sequence, cookies, app/browser context, excluded products, approval delay, and last-click attribution. Portal optimization belongs after the in-store deterministic foundation.

## 11. Source authority and collection permission are separate

Every registry entry starts with a terms review state. An official public page can be authoritative evidence while automated retrieval, full-page retention, or redistribution remains restricted. The collection service therefore defaults to blocked and supports manual snapshots.

## 12. Place discovery cannot become the reward database

`tech.google.places-policies` is included to constrain merchant discovery and caching. External place data should help resolve place identity, while the product retains its own canonical merchant, alias, branch-confidence, and reward-rule records subject to provider policy.

## 13. Loyalty wallet support requires static/dynamic separation

`tech.apple.wallet-loyalty` and `tech.google.wallet-loyalty` describe issuer-oriented loyalty passes. The consumer app should not assume it can reproduce arbitrary third-party credentials. Static loyalty payloads can be stored locally under a strict security policy; dynamic credentials and payment QR codes should open the official app instead.

## 14. Financial aggregation is a later partner integration

`tech.moneytree.link-sdk` is included as an example of a consent-based partner integration path. The first release should use manual wallet configuration and avoid bank/card credential scraping. Aggregation adds meaningful regulatory, security, consent, and deletion work.

## 15. Ranking and affiliate placement must remain separate

`gov.caa.stealth-marketing` is included because commercial relationships must be visibly disclosed. The organic engine output should be immutable with respect to affiliate compensation; a sponsored placement is a separate UI object.

## Resulting required fields

At minimum, production rules need explicit fields for:

- merchant, branch confidence, category, product class, and channel;
- payment instrument, funding source, interface, and presentation order;
- eligible amount basis, denominator, rounding mode, and aggregation stage;
- enrollment, identity, membership tier, selected-shop, first-use, and target state;
- cap, progress source, reset period, and unknown-progress policy;
- base inclusion, stacking group, replacement, precedence, and mutual exclusion;
- economic and system validity;
- reward posting and clawback;
- source snapshot, field-level evidence, reviewer, and version.

## v0.3 addendum — operation and asset shape

A payment route is not merely a payment instrument plus a funding source. Stored-value top-ups and voucher acquisition create assets that can be consumed over several purchases. The engine must attach rewards and exclusions to the operation that generated them, preserve residual balances, and avoid re-awarding acquisition benefits when the balance is spent.

`jp.paypay.third-party-card-voucher` is registered as a high-volatility canonical research source because the planned route includes advance voucher acquisition, increments, residual balance, caps, channel/card restrictions, and reward exclusions. No production fact should be inferred until the exact current page is captured and reviewed.

## v0.3 addendum — reward asset quality

Normal, limited-period, and usage-limited points may have different posting, expiry, transferability, and user value. Reward output therefore requires asset class, settlement, expiry, usage restrictions, certainty, and clawback rather than a bare currency ID.

## v0.3 addendum — unknown user state

Manual user input can establish campaign entry, identity, tier, or approximate progress before financial aggregation exists. Unknown state produces conditional recommendations and questions; aggregation later improves convenience and freshness.

## v0.3 addendum — probabilistic campaigns

Lottery and draw campaigns must be separated from guaranteed rewards. Maximum prizes cannot enter guaranteed ranking, and expected value is unavailable where probability is not officially supported.

## v0.3 addendum — database enforcement

The persistence layer must enforce rather than merely document non-overlapping approved economic ranges, snapshot finality, approved-definition freezing, user-data retention, default privilege revocation, and RLS for user-owned exposed tables.

---

## v0.3 addendum — implementation-review findings

The independent review confirmed that the largest remaining risk was not arithmetic but route shape and data operations. Version 0.2 therefore adds:

- multi-operation charge/top-up/voucher routes and residual assets;
- separate reward classes and settlement lifecycle;
- first-class unknown user state;
- source technical reachability observations;
- PostgreSQL/Supabase RLS, exclusion-constraint, immutability, and retention guidance;
- a source-maintenance rehearsal before broad expansion.

Two official sources were added after manual review on 2026-08-17:

- PayPay third-party-card voucher help;
- View Card Mobile Suica charge reward information.

These source registrations do not authorize automated collection.
