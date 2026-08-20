# Codex prompt — read source coverage context before work

Read the repository's `AGENTS.md` first and follow its read order.

Then specifically read and summarize, without changing code yet:

1. `PRD.md`
2. `docs/00_product_requirements.md`
3. `docs/04_implementation_plan.md`
4. `docs/20_source_coverage_strategy_2026-08-20.md`
5. `registry/planning/source-families.v0.5/`
6. `registry/planning/source-coverage-summary.2026-08-20.json`
7. `docs/21_product_catalogue_plan.md`
8. `registry/product-catalogue/README.md`
9. `registry/product-catalogue/catalogue-coverage-plan.v0.1.yaml`
10. `docs/22_p0_source_onboarding_exec_plan.md`
11. `docs/23_source_coverage_research_audit_2026-08-20.md`
12. `docs/01_trust_and_provenance_policy.md`
13. `docs/15_agent_feed_integration.md`
14. `docs/17_monitoring_producer_contract.md`

After reading, report:

- the distinction between source families, page-level trusted sources, Agent Feed streams, selectable products, evidence records and `RewardRuleVersion`s;
- the 255-family / 95-stream coverage plan and P0/P1/P2/P3 rollout counts;
- why the 29 credit-card issuer families are not 29 individual cards;
- which data is planning context versus canonical economic truth;
- the support gate based on `required_source_roles`;
- the Agent Feed trust boundary and why findings cannot publish reward rules;
- the exact next milestone you believe is currently active.

Do not implement P1/P2/P3 coverage, invent card SKUs, invent reward rates, or promote planning URLs into production evidence. If the active task does not require source onboarding, use this context to preserve architecture but continue only with the explicitly assigned milestone.
