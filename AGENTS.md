# Codex repository map — Japan Rewards Optimizer

This context branch exists so Codex can load broad planning/research knowledge without polluting the checksummed `main` release package. Treat `main` as canonical implementation/release state and this branch as planning context.

## Read order

Before making product, data-model, monitoring, source-coverage, catalogue, or discovery-loop changes, read:

1. `PRD.md`
2. `docs/00_product_requirements.md`
3. `docs/04_implementation_plan.md`
4. `docs/20_source_coverage_strategy_2026-08-20.md`
5. `docs/25_source_coverage_v0.6_delta.md`
6. `registry/planning/source-families.v0.5/`
7. `registry/planning/source-family-additions.v0.6.tsv`
8. `registry/planning/reward-portals.v0.6.tsv`
9. `registry/planning/source-coverage-summary.2026-08-20.json`
10. `docs/21_product_catalogue_plan.md`
11. `docs/22_p0_source_onboarding_exec_plan.md`
12. `docs/23_source_coverage_research_audit_2026-08-20.md`
13. `docs/24_unknown_world_discovery_loop.md`
14. `registry/planning/discovery-query-packs.v0.1.yaml`
15. `docs/01_trust_and_provenance_policy.md`
16. `docs/15_agent_feed_integration.md`
17. `docs/17_monitoring_producer_contract.md`
18. the relevant active implementation prompt or milestone document.

Use `prompts/CODEX_READ_SOURCE_COVERAGE_CONTEXT.md` for an explicit session-start readback.

## Non-negotiable invariants

- Agent Feed is a separate generic project. Rewards owns reward-domain source coverage, evidence promotion, products, merchants, economic truth and CoverageCandidate decisions.
- `Agent Feed Finding != verified fact`.
- `Agent-submitted evidence != canonical Rewards evidence`.
- `SourceObservation != RewardRuleVersion`.
- `CoverageCandidate != registered source family`.
- Do not invent current reward rates, campaign dates, merchant acceptance, card products, transfer ratios, or unsupported program relationships.
- A source family in the planning registry is not automatically a supported product/program.
- Do not mark a family `fully_supported` until every required source role has current canonical evidence or an explicit conservative exclusion.
- Discovery-only sources may trigger investigation but may never publish canonical economic truth.
- Monitor by source family / Agent Feed stream, not by building one bespoke scraper per URL.
- Implement P0 before broad P1/P2/P3 unless an explicit active exec plan says otherwise.
- If product-level catalogue data is absent, record a catalogue gap; do not infer individual cards from an issuer family.
- Preserve the deterministic operation-and-asset rule engine, bitemporal evidence model, reward-class conservation, and review gates already defined on `main`.
- Do not merge this context branch wholesale into `main`; intentional implementation changes should go through focused PRs with package/checksum updates as required.

## Coverage snapshot — v0.6 planning context

- 261 source families across 95 eventual Agent Feed streams.
- Priority: P0 44, P1 76, P2 103, P3 38.
- Existing registry assessment: 48 covered, 20 partial, 193 missing.
- Categories: 29 credit-card issuer families, 24 point programs, 20 airline programs, 18 hotel programs, 19 payment wallets, 20 e-money/transit systems, 26 cashback/reward-portal families, 86 merchant families, 5 card-network families, 5 payment-interface families, 4 regulatory families, 5 discovery families.
- P0 launch core: 44 families / 19 streams.
- P0+P1 nationwide daily-life target: 120 families / 42 streams.
- P0+P1+P2 travel/breadth target: 223 families / 86 streams.
- Full planned target: 261 / 95.

The six v0.6 portal additions are Warau, GMO PoiKatsu, Nifty Point Club, Chance It, Amefuri and Sugutama.

## Source-family vs selectable-product distinction

`source family` is the monitoring/authority unit. `selectable product` is what a user owns or chooses in the app.

Example: `card.smbc` is one monitored issuer family but may map to many user-selectable card SKUs. Never treat the 29 issuer-family count as the number of supported individual cards.

## Known-world vs unknown-world

Known-world monitoring asks whether a registered family changed.

Unknown-world discovery searches broad market/official/partner surfaces for entities or relationships absent from the registry. Discovery producers submit `coverage_candidate` findings through Agent Feed. Rewards resolves/triages them. Only accepted candidates are handed to Codex for official-source research and a PR.

Codex is not the always-on discovery monitor. Agent Feed is not the reward-domain coverage authority.

## Working rule

When asked to add coverage:

1. check whether the entity is already a source family, product, alias, child source or known relationship;
2. if known, extend the existing family/product using canonical evidence;
3. if genuinely novel, create/triage a CoverageCandidate first;
4. only after acceptance should Codex research official sources and propose a focused PR;
5. never collapse planning or discovery evidence into production truth.
