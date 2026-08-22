# P0 rule-shape pipeline and point-spending optimizer

Date: 2026-08-23

## What this milestone adds

The P0 research wave contains 364 useful facts, but a fact is not automatically
an arithmetic rule. `compileP0SpendRuleSet` classifies every claim and emits an
executable edge only when the checked-in research contains explicit source and
destination quantities. The initial graph contains 23 fixed-ratio transfer or
redemption edges, including direct and multi-hop routes among Rakuten, ANA,
Ponta, JAL, nanaco, JRE POINT, Bic Point, Suica, V Point, WAON, Seven Mile and
explicit payment-value destinations.

The remaining claims stay available in the information catalogue with one of
these dispositions:

- `state_required`: a rate depends on exchange count, cap usage, membership,
  enrollment or another missing fact;
- `inactive`: the applicability window has ended;
- `information_only`: the claim is descriptive, variable, illustrative,
  probabilistic, or lacks a complete operation mapping;
- `companion_constraint`: a minimum, increment, timing, cap or condition that
  is merged into a compatible economic edge rather than calculated alone.

This is not editorial approval. It is deterministic representation of the
already-collected P0 data. Corrections still flow through the existing fact and
recommendation correction paths.

## Calculation boundary

The point-spending optimizer performs a bounded acyclic search of at most six
hops. It does not calculate ratios itself. Every proposed hop is evaluated by
the existing `calculateTransfer` kernel, which remains authoritative for:

- minimums and increments;
- request and period caps;
- exact decimal ratios and rounding;
- fees;
- cancellation state; and
- cycle rejection.

The first consumer surface offers three deterministic objectives:

1. maximize destination quantity;
2. prefer the fastest known route; or
3. prefer consuming an expiring source balance.

Unknown processing time ranks after known time. Ties use fewer irreversible
steps and then a canonical route hash. Conditional edges are unavailable until
the user explicitly confirms their displayed condition. Period-capped edges
remain unavailable until prior-period usage is supplied.

## Consumer boundary

The Wallet tab exposes only Japanese labels, quantities, route steps, timing
and a recommendation hash. It does not expose claim IDs, source IDs, evidence
locators, raw source text or economic payloads. The only public URLs are the
bounded official lottery/campaign links described below. Customer-facing copy
does not expose internal milestone names or implementation vocabulary and
tells the user to verify execution conditions with the provider.

The Wallet catalogue also lists every point family (8), mobile-payment family
(6), and credit-card family (7), replacing the sample-only Wallet list.
Customer-facing cards describe the available use without exposing internal
execution classifications.

The Home payment selector uses the same exact 21-family allowlist. The sorted
family IDs remain session-only and are included in the recommendation and
correction hash. Selected cards and mobile payments are also compiled into
real purchase candidates using the structured base-rate claims; selected
point programmes are available to the fixed-ratio spending optimizer. The
browser starts from neutral general shopping. Seven-Eleven is an explicit
merchant selection and only that selection adds the Nanaco-specific routes.

Lottery, draw, game, and scratch claims remain information-only regardless of
their advertised maximum prize. The Information tab deduplicates these claims
by checked-in official source and displays a bounded HTTPS link. A current
campaign is labelled `公式ページで応募・詳細を確認`; an explicitly ended or
date-expired campaign is labelled `公式告知を確認`. These links are never added
to the calculation graph and no expected value is inferred.

Balances are session input only. This milestone does not log in to loyalty
programs, store credentials, perform an exchange, or claim that a redemption
value is cash.

## AwardWallet-compatible roadmap, later

AwardWallet's official product describes a useful adjacent capability set:
multi-program balance aggregation, expiration tracking and reminders, balance
change/history monitoring, elite-status and certificate tracking, and travel
itinerary management. Its supported-program catalogue currently spans hundreds
of programs, including ANA and JAL.

For Japan Rewards Optimizer these belong after the deterministic optimizer,
in this order:

1. user-entered balances and expiration lots with encrypted local storage;
2. balance history, change detection and expiration alerts;
3. read-only account connectors with revocable credentials and per-provider
   security review;
4. certificate/status metadata and itinerary context where it materially
   changes a recommendation; and
5. portfolio optimization across several balances.

We should not copy account aggregation into Agent Feed. Agent Feed monitors
public economic sources; private user balances need a separate credentialed,
user-authorized connector boundary.

References:

- <https://awardwallet.com/>
- <https://awardwallet.com/en/supported-programs>
- <https://awardwallet.com/en/faqs>
- <https://awardwallet.com/pricing>

## Deferred work

- Persist the 23 executable spend edges as immutable, versioned database rows
  and load them through a database port instead of checked-in P0 artifacts.
- Add exact user-state inputs for annual exchange counts, cap usage,
  enrollment, reward class and expiration lots.
- Expand structured compilation to tiered rows, campaigns, stacking and
  lifecycle events only when the claim carries every required quantity and
  condition.
- Add multi-balance portfolio allocation. The current solver recommends a
  route from each balance independently; it does not solve a mixed-integer
  redemption portfolio.
- Add recurring source-change handling that creates a new provisional version
  and invalidates affected recommendations without silently publishing it.
