# Initiating Prompt for Codex — Japan Rewards Optimizer Foundation v0.4.1, Milestone 1a

You are the lead implementation agent for an evidence-backed Japan rewards optimizer. Implement **Milestone 0 plus Milestone 1a only**. The purpose of this run is to prove conservation, residual accounting, valuation isolation, and deterministic replay before adding the broader calculation and uncertainty surface.

Do not continue into Milestone 1b, the consumer application, live source monitoring, or financial aggregation.

## Read before changing anything

Read in this order:

1. `README.md`
2. `docs/00_product_requirements.md`
3. `CHANGELOG.md`
4. `docs/01_trust_and_provenance_policy.md`
5. `docs/03_reward_rule_specification.md`
6. `docs/04_implementation_plan.md`
7. `docs/05_ingestion_and_review_workflow.md`
8. `docs/06_golden_scenario_program.md`
9. `docs/07_security_privacy_compliance.md`
10. `docs/08_architecture_decisions.md`
11. `docs/09_codex_execution_contract.md`
12. `docs/11_review_decisions_v0.3.md`
13. `docs/13_semantic_validation_contract.md`
14. `docs/14_residual_valuation_and_sensitivity.md`
15. `docs/15_agent_feed_integration.md`
16. `docs/16_supabase_stack_decision.md`
17. `docs/19_review_decisions_v0.4.1.md`
18. `prototype/README.md`, every file in `prototype/src/`, and every prototype test
19. `schemas/purchase-plan.schema.json`, then every other file in `schemas/`
20. `registry/trusted-sources.v0.3.yaml`
21. `registry/source-access-observations.v0.3.yaml`
22. every file in `examples/`
23. `db/0001_core_schema.sql`
24. `db/0002_agent_feed_consumer.sql`
25. `db/V0_4_TO_V0_4_1_MIGRATION_NOTES.md`
26. `db/tests/001_bitemporal_replay.sql`
27. `db/tests/002_view_security.sql`
28. `db/tests/004_v0_4_1_hardening.sql`
29. `db/tests/005_agent_feed_liveness.sql`
30. every remaining SQL file in `db/tests/`
31. `tests/acceptance-criteria.md`

Then present a concise implementation checklist mapped to the **Milestone 0 and Milestone 1a** acceptance criteria.

The known review decisions are already resolved. Stop and report only when you find a **new contract-affecting contradiction**. Do not silently choose between incompatible models.

## Preflight — mandatory

Before reorganizing anything, run:

```bash
cd prototype
npm test
npm run demo
```

Record the current behavior and test names. Refactoring may move code, but it may not delete the working browser prototype, weaken the tests, or change native accounting merely to fit a preferred scaffold.

## Objective

Evolve the bundled prototype into a runnable TypeScript monorepo that proves this synthetic path:

```text
schema + semantic validation
  -> approved bitemporal operation-scoped rule
  -> direct or pre-funded operation-and-asset plan
  -> deterministic principal movements
  -> percentage / points-per-unit reward components
  -> ending asset lots and residual quantity
  -> separate per-asset valuation
  -> reconciled economic summary
  -> winner + runner-up + break-even sensitivity
  -> serialized and identical replay
```

## Scope included in this run

### Contracts

- Compile all eleven Draft 2020-12 schemas with relative references resolved.
- Generate or infer TypeScript types from the schemas.
- Implement one shared semantic validator from `docs/13_semantic_validation_contract.md`.
- Validate both source-registry representations, access observations, and all synthetic examples.

### Pure rule/plan engine

Implement only what Milestone 1a needs:

- operation/dependency validation;
- direct merchant purchase;
- stored-value top-up and voucher acquisition followed by purchase;
- asset-lot creation, partial consumption, and residual lots;
- settlement, expiry, usage restrictions, and reward class preservation;
- external funding and principal movements;
- bitemporal rule selection;
- acceptance/exclusion matching used by the fixtures;
- percentage calculation;
- points-per-unit calculation with explicit aggregation and rounding;
- native reward ledger and rejected reason codes;
- per-asset valuation and exact economic reconciliation;
- winner, runner-up, replay record, and valuation break-even sensitivity.

### Minimal persistence/integration proof

- Apply the supplied migration to PostgreSQL 15+ when available.
- Run the bitemporal replay integration script.
- Verify the two `app_api` views are `security_invoker` and do not lend migration-owner access merely by granting the view.
- If PostgreSQL is unavailable, report the limitation; do not claim the database gate passed.

## Explicitly out of scope

Do not implement fixed, tiered, multiplier, transfer, or other Milestone 1b behavior in this run. In particular, do **not** implement:

- fixed reward;
- tiered reward;
- multiplier;
- transfer calculation or graph search;
- campaign caps beyond any minimal type plumbing already required by contracts;
- unknown-state feasible assignment search;
- conditional winners or next-question generation;
- probabilistic expected-value ranking;
- refund/reversal/clawback execution;
- live or scheduled web retrieval;
- polished admin or mobile UI.

Do not leave six half-working calculators behind feature flags. Stop after the conserved 1a kernel is complete.

## Separate Agent Feed boundary

The sibling `../agent-feed` project is external to this codebase. Do not implement its server, SDKs, MCP tools, queues, or database here. Live monitoring and Agent Feed consumer integration are out of scope for this run.

## Non-negotiable constraints

1. Do not invent Japanese reward rates, campaign dates, merchant acceptance, or expected real-world answers.
2. Use synthetic fixtures only.
3. Do not fall back to a flat payment-instrument/funding-source recipe.
4. Candidate plans cannot contain calculated movements, rewards, ending lots, economics, or winners.
5. A top-up reward belongs to the acquisition operation and is not re-awarded during spend.
6. Residual principal is not a reward and cannot disappear.
7. External funding must be included before ranking a pre-funded plan.
8. Use integer JPY and arbitrary-precision decimal reward units; no canonical JavaScript binary floating point.
9. Valuation can change winner, but never native operations, movements, quantities, rule IDs, reward classes, settlement, expiry, or restrictions.
10. For any `(rule_id, transaction_time, replay_knowledge_time)`, at most one approved version may match.
11. JSON Schema-valid but semantic-invalid input is rejected before calculation or persistence.
12. LLM output cannot determine canonical arithmetic, eligibility, asset flow, or rank.
13. Never store PAN, CVV, PIN, banking passwords, dynamic payment QR values, or copied issuer sessions.
14. Never weaken a contract or expected fixture merely to make tests pass.
15. `definition_hash` is reusable content identity, never a historical uniqueness key.
16. Conservation keys include both `asset_id` and `reward_class`.
17. Generic `adjust` movements remain forbidden.
18. Approved/golden state requires every configured review mode to have an approved review event.
19. Stop after Milestone 1a passes. The next step is `prompts/CODEX_MILESTONE_1B_PROMPT.md`.

## Preferred stack

- Node.js 22+
- pnpm workspaces and Turborepo
- TypeScript strict mode
- Ajv Draft 2020-12 plus `ajv-formats`
- generated/inferred types from schemas
- `decimal.js` or an equivalent arbitrary-precision decimal library
- Vitest
- `fast-check`
- Biome or ESLint/Prettier, one documented choice
- minimal CLI or Hono/Fastify API shell
- PostgreSQL 15+/Supabase-compatible migration
- GitHub Actions

Do not introduce microservices, Kafka, a vector database, GraphRAG, or a workflow orchestrator.

## Suggested workspace

```text
apps/
  api/                       # health, validation, evaluate, replay only
packages/
  contracts/                 # schemas, generated types, structural + semantic validators
  rule-engine/               # pure plan/rule/asset/economics logic
  test-fixtures/             # synthetic fixtures and builders
supabase/
  migrations/
db-tests/
scripts/
.github/workflows/
```

The rule engine imports no API, database, UI, network, or LLM client.

## Mandatory tests

1. all schemas compile;
2. registry YAML/JSON equivalence;
3. all examples validate structurally and semantically;
4. estimated fact lower bound above upper bound is rejected;
5. known cap range with unequal bounds is rejected;
6. direct purchase reconciles;
7. top-up then purchase conserves the created balance;
8. JPY 10,000 acquisition funding a smaller purchase leaves the exact residual;
9. top-up reward is emitted once, on acquisition;
10. percentage boundaries;
11. points-per-unit one below, exact, and one above denominator;
12. normal versus limited reward class remains distinct;
13. valuation fixture A selects direct card;
14. valuation fixture B uses the **identical native ledger** and selects top-up;
15. break-even residual valuation is calculated with arbitrary precision;
16. changing valuation does not mutate native accounting;
17. transaction start/end and replay-knowledge boundaries;
18. backdated bitemporal overlap is rejected by PostgreSQL;
19. generated timestamp property test returns at most one approved version per rule/replay point;
20. identical versioned input produces byte-stable canonical output;
21. same definition hash can recur in non-overlapping history;
22. limited-period and normal points cannot cancel;
23. missing required review mode blocks approval;
24. all bundled prototype tests remain green.

Add property tests for:

- asset conservation;
- reconciliation;
- determinism;
- valuation isolation;
- bitemporal selection uniqueness;
- nonnegative residual quantity;
- top-up reward non-duplication.

## Commands

Provide and run equivalents of:

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm validate:schemas
pnpm validate:registry
pnpm validate:examples
pnpm test
pnpm test:property
pnpm build
```

CI must not use live web content or secrets.

## Completion report

Return:

- architecture and package structure;
- files created or changed;
- structural and semantic validator design;
- commands and results;
- test/property coverage;
- native-ledger and valuation-flip proof;
- PostgreSQL migration/integration status;
- security-view status;
- known limitations;
- the exact recommendation to begin or defer Milestone 1b.

Begin by reading the package and presenting the mapped checklist. Then execute without asking for confirmation unless an actual repository or environment constraint blocks progress.
