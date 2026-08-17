# Product Requirements — Japan Rewards Optimizer v0.4.1

## Product promise

For a selected Japanese merchant, purchase amount, date, user wallet, campaign state, and stored-value assumptions, return the feasible purchase route with the highest user-valued benefit and explain every acquisition, payment, residual asset, reward, exclusion, uncertainty, and source.

## Primary v1 user journey

1. User selects a merchant or branch.
2. User enters an optional purchase amount.
3. App considers only instruments and loyalty programs the user owns.
4. App displays one primary route and one fallback.
5. App shows the sequence: present loyalty card, top up or acquire stored value when needed, select payment interface, and pay.
6. App shows native rewards, user-valued JPY benefit, residual balance, assumptions, caps, freshness, and evidence.
7. User can answer a small number of questions that would change the winner.

## Initial alpha scope

- Tokyo convenience stores;
- a deliberately small set of common cards, QR wallets, stored-value systems, and common-point programs;
- manual wallet, tier, campaign-entry, and cap state;
- deterministic percentage and points-per-unit calculations first;
- synthetic prototype data until real evidence-backed scenarios are promoted;
- no payment initiation, bank credential collection, or automated rule publication.

## Prototype acceptance

The bundled prototype must already demonstrate:

- direct payment versus card-funded stored-value purchase;
- exact residual conservation;
- reward class separation;
- residual valuation changing rank without changing native accounting;
- break-even sensitivity;
- winner and runner-up;
- monitoring health that distinguishes zero findings, failed/partial runs, and a missed run;
- hostile Agent Feed input rejected without canonical evidence.

## Trust requirements

- Agent Feed findings are claims, not facts.
- Canonical evidence requires Rewards-owned capture, hash, locator, authority, and review.
- Reward calculations and ranking are deterministic.
- Production recommendations are bitemporally replayable.
- Required review modes are machine-enforced.
- Stale monitoring cannot be displayed as healthy freshness.

## Non-goals for the prototype

- current Japanese reward-rate coverage;
- production Supabase authentication or deployment;
- all calculation types;
- every Agent Feed adapter or SDK;
- Realtime dependency;
- automatic financial-account aggregation;
- card application ranking or affiliate placement.
