# P0 Source Onboarding Exec Plan

## Objective

Turn the P0 planning coverage into a verified source/evidence foundation without widening the consumer product faster than the maintenance system can sustain.

P0 scope is **44 source families across 19 Agent Feed streams**.

## Inputs

- `registry/planning/source-families.v0.5/`
- `docs/20_source_coverage_strategy_2026-08-20.md`
- `docs/01_trust_and_provenance_policy.md`
- `docs/05_ingestion_and_review_workflow.md`
- `docs/12_source_maintenance_rehearsal.md`
- `docs/15_agent_feed_integration.md`
- `docs/17_monitoring_producer_contract.md`

## Work packages

### P0.1 — core point ecosystems

Onboard required source roles for the P0 point families. Validate earning, use/redemption, reward classes/expiry, transfers, campaigns, notices and merchant partner roles separately.

### P0.2 — core wallets/payment apps

Onboard base rewards, funding/top-up, eligible/excluded tenders, merchant acceptance, campaigns/local campaigns and change/incident notices.

### P0.3 — core card issuers

Onboard catalogue, annual fees/benefits, base rewards, merchant/category bonuses, wallet/e-money exclusions, exchange directory, campaigns and change notices.

### P0.4 — core merchants

Onboard accepted payment methods, loyalty, campaigns/coupons, channel differences, branch overrides/store locator, and excluded products/services.

### P0.5 — transit/e-money foundations

Onboard service terms, charge/autocharge, eligible cards, earning, acceptance, campaigns and notices.

### P0.6 — source-maintenance rehearsal

Use a representative subset across volatility/access patterns. Compare direct canonical-source checking with semantic Agent Feed monitoring. Measure useful-finding recall, false positives, official-source hit rate, detection delay, human review minutes, missed/partial/failed runs, source accessibility and changed-winner impact.

## Gates

A P0 family may advance to `fully_supported` only when:

- all `required_source_roles` have canonical evidence or explicit conservative exclusion;
- collection permission and technical acquisition state are recorded separately;
- monitoring cadence/liveness expectations are registered where applicable;
- source-to-rule impact mapping exists;
- stale high-risk rules cannot appear fully verified;
- discovery-only findings cannot publish rules;
- relevant golden/boundary scenarios pass.

## Non-goals

- Do not onboard P1–P3 merely to increase headline coverage.
- Do not create one scraper per URL.
- Do not infer individual card products from issuer-family names.
- Do not treat Agent Feed findings as canonical evidence.
- Do not block the deterministic engine/kernel work on completing all P0 source roles.
