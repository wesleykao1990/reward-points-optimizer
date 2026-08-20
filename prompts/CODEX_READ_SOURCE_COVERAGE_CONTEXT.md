# Codex prompt — read source coverage + discovery context before work

This prompt is for the non-main context branch `codex-context/source-coverage-v0.6`. Do not merge that branch wholesale into `main`.

Read `AGENTS.md` first and follow its read order. Then specifically read and summarize, without changing code yet:

1. `docs/20_source_coverage_strategy_2026-08-20.md`
2. `docs/25_source_coverage_v0.6_delta.md`
3. `registry/planning/source-families.v0.5/`
4. `registry/planning/source-family-additions.v0.6.tsv`
5. `registry/planning/reward-portals.v0.6.tsv`
6. `registry/planning/source-coverage-summary.2026-08-20.json`
7. `docs/21_product_catalogue_plan.md`
8. `registry/product-catalogue/README.md`
9. `registry/product-catalogue/catalogue-coverage-plan.v0.1.yaml`
10. `docs/22_p0_source_onboarding_exec_plan.md`
11. `docs/23_source_coverage_research_audit_2026-08-20.md`
12. `docs/24_unknown_world_discovery_loop.md`
13. `registry/planning/discovery-query-packs.v0.1.yaml`

Then return to `main` and read the canonical implementation/trust docs there:

- `PRD.md`
- `docs/00_product_requirements.md`
- `docs/04_implementation_plan.md`
- `docs/01_trust_and_provenance_policy.md`
- `docs/15_agent_feed_integration.md`
- `docs/17_monitoring_producer_contract.md`

After reading, report:

- the distinction between source family, page-level trusted source, Agent Feed stream, selectable product, EvidenceRecord, SourceObservation, CoverageCandidate and RewardRuleVersion;
- the v0.6 261-family / 95-stream planning universe and P0/P1/P2/P3 counts;
- the 26 reward-portal families and the six v0.6 additions;
- why the 29 credit-card issuer families are not 29 individual card SKUs;
- which data is planning/discovery context versus canonical economic truth;
- the support gate based on required source roles;
- the Agent Feed trust boundary and why findings/candidates cannot publish reward rules;
- the distinction between known-world monitoring and unknown-world discovery;
- why Codex should act on accepted CoverageCandidate issues rather than operate as the continuous monitor;
- the exact next milestone you believe is currently active.

Do not implement broad P1/P2/P3 coverage, invent card SKUs, invent reward rates, or promote planning/discovery URLs into production evidence unless explicitly assigned. If the active task is unrelated to source onboarding or discovery, use this context only to preserve architecture and continue the assigned milestone.
