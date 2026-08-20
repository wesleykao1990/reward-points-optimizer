# Codex repository map — Japan Rewards Optimizer

This repository is the source of truth for the Japan Rewards Optimizer. Treat repository documents and machine-readable registries as authoritative project context; do not rely on chat history.

## Read order

Before making product, data-model, monitoring, or source-coverage changes, read:

1. `PRD.md`
2. `docs/00_product_requirements.md`
3. `docs/04_implementation_plan.md`
4. `docs/20_source_coverage_strategy_2026-08-20.md`
5. `registry/planning/source-families.v0.5/`
6. `registry/planning/source-coverage-summary.2026-08-20.json`
7. `docs/21_product_catalogue_plan.md`
8. `docs/22_p0_source_onboarding_exec_plan.md`
9. `docs/23_source_coverage_research_audit_2026-08-20.md`
10. `docs/01_trust_and_provenance_policy.md`
11. `docs/15_agent_feed_integration.md`
12. `docs/17_monitoring_producer_contract.md`
13. the relevant active implementation prompt or milestone document.

Use the priority-split TSV registries under `registry/planning/source-families.v0.5/` for programmatic filtering and implementation planning. `prompts/CODEX_READ_SOURCE_COVERAGE_CONTEXT.md` is the reusable prompt for explicitly loading and summarizing this context at the start of a Codex session.

## Non-negotiable invariants

- Agent Feed is a separate generic project. This repository owns reward-domain source coverage, evidence promotion, products, merchants, and economic truth.
- `Agent Feed Finding != verified fact`.
- `Agent-submitted evidence != canonical Rewards evidence`.
- `SourceObservation != RewardRuleVersion`.
- Do not invent current reward rates, campaign dates, merchant acceptance, card products, transfer ratios, or unsupported program relationships.
- A source family in the planning registry is not automatically a supported product/program.
- Do not mark a family `fully_supported` until every required source role has current canonical evidence or an explicit conservative exclusion.
- Discovery-only sources may trigger investigation but may never publish canonical economic truth.
- The v0.5 source-family registry is planning input, not current reward truth.
- Monitor by source family / Agent Feed stream, not by building one bespoke scraper per URL.
- Implement P0 before P1/P2/P3 unless an explicit active exec plan says otherwise.
- If product-level catalogue data is absent, record a catalogue gap; do not infer individual cards from an issuer family.
- Preserve the deterministic operation-and-asset rule engine, bitemporal evidence model, reward-class conservation, and review gates already defined in the repository.

## Coverage snapshot (research date 2026-08-20)

- 255 source families across 95 eventual Agent Feed streams.
- Priority: P0 44, P1 73, P2 101, P3 37.
- Existing registry assessment: 48 covered, 20 partial, 187 missing.
- Categories: 29 credit-card issuer families, 24 point programs, 20 airline programs, 18 hotel programs, 19 payment wallets, 20 e-money/transit systems, 20 cashback/portal families, 86 merchant families, 5 card-network families, 5 payment-interface families, 4 regulatory families, 5 discovery families.
- P0 launch core: 44 families / 19 streams.
- P0+P1 nationwide daily-life target: 117 families / 42 streams.
- P0+P1+P2 travel/breadth target: 218 families / 86 streams.

## Source-family vs selectable-product distinction

`source family` is the monitoring/authority unit. `selectable product` is what a user owns or chooses in the app.

Example: `card.smbc` is one monitored issuer family but may map to many user-selectable card SKUs. Never treat the 29 issuer-family count as the number of supported individual cards.

## Working rule

When asked to add coverage, first locate the relevant family in the appropriate priority TSV under `registry/planning/source-families.v0.5/` and inspect the source-role requirements for its category, then update canonical source/evidence records and product mappings separately. Never collapse planning coverage into production truth.
