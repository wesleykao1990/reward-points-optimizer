# Japan Rewards Optimizer Foundation Package v0.4.1

Research cutoff: **2026-08-20 (Asia/Tokyo)**

This package defines the evidence, domain model, database controls, implementation sequence, and Codex handoff for a Japan-first purchase-route optimizer.

## Separate Agent Feed project

Monitoring transport is no longer implemented inside this application. The sibling project `../agent-feed` owns generic agent runs, findings, submitted evidence, SDKs, adapters, MCP/REST ingress, and durable consumer delivery.

The Rewards Optimizer pins Agent Feed protocol `0.1` and converts supported generic findings into its own untrusted `SourceObservation` records. Only the Rewards Optimizer can acquire/promote canonical evidence and publish reward rules.

The projects are separate deployables and do not query one another's database.

## Status

v0.4.1 retains the converged operation-and-asset engine from v0.3 and adds a clean cross-project monitoring boundary. Realtime is explicitly optional UX rather than a monitor or job-delivery dependency.

The architecture remains commercial-capable, but the first validation target is a personal/internal Tokyo convenience-store alpha.

Milestones 0, 1A, 1B, 2, and 2.5 now have production-oriented implementation
surfaces alongside the preserved prototype. Milestones 3–7 also have
synthetic/internal gate implementations. The first six real-data evidence
records are verified and hash-bound, and two isolated scenarios now have
immutable golden replay fixtures plus private canonical database rows without
rule or frontend publication;
operational source maintenance and production consumer use remain blocked:

- `packages/contracts` owns the twelve generated schema type modules plus shared structural and semantic validation;
- `packages/rule-engine` owns the pure conservation, reward, valuation, bitemporal, and replay kernel;
- `packages/test-fixtures` owns schema-valid synthetic fixtures and builders.
- `db/0003_milestone_2_hardening.sql` and `db/tests/006_m2_persistence_security.sql` own the hardened persistence boundary and adversarial database gate.
- `packages/agent-feed-consumer`, `db/0004_m25_agent_feed_consumer.sql`, and `db/tests/007_m25_agent_feed_consumer.sql` own the signed Agent Feed consumer, durable receipt/mapping boundary, and M2.5 adversarial gate.
- `db/0005_m3_golden_publication_boundary.sql`, the generated M3 seed, and `db/tests/008_m3_golden_publication_boundary.sql` own sealed golden persistence and the separate fail-closed rule-publication boundary.
- `packages/recommendation-api` owns the pure M5 internal recommendation and
  security boundary; production mode is hard-blocked.
- `packages/consumer-alpha` owns the pure M6 onboarding, presentation,
  synthetic-link, and correction contracts.
- `apps/consumer-alpha` is the M6 loopback-only synthetic browser shell. It
  does not contain current reward data, authentication, persistence, or real
  official-app links.
- `packages/challenge-track` is the M7 deterministic 100-target control plane.
  Its `SYN-M7-*` probes and replay results never count as evidence or golden
  coverage.

The rule engine preserves the Milestone 1A accounting kernel and adds fixed, tiered, multiplier, and directed-transfer calculations; cap and stacking policies; explicit feasible-state ranking; probability separation; and refund, reversal, expiry, and clawback adjustments. Transfer cancellation and reward expiry are exposed through a typed event facade because they are state transitions rather than candidate purchase operations. Reward calculations remain explicit about their supported aggregation scope rather than silently approximating unsupported aggregation.

## Core model

```text
external funding
  → top-up or voucher acquisition
  → created asset lot
  → merchant purchase
  → residual asset lot
  → reward components
  → separate valuation
  → reconciled rank
```

## Discovery and evidence model

```text
external monitor
  → Agent Feed Finding
  → Rewards SourceObservation
  → canonical evidence acquisition
  → ExtractionCandidate
  → reviewed RewardRuleVersion
```

A finding is not a fact, and submitted evidence is not canonical evidence.

## Important new files

| Path | Purpose |
|---|---|
| `docs/15_agent_feed_integration.md` | Cross-project trust, mapping, dedupe, and delivery contract |
| `docs/16_supabase_stack_decision.md` | Supabase features and Realtime decision |
| `docs/17_monitoring_producer_contract.md` | Requirements for ChatGPT/Claude/API monitors |
| `schemas/source-observation.schema.json` | App-specific observation after generic finding intake |
| `db/0002_agent_feed_consumer.sql` | Private staging/receipt reference migration |
| `db/tests/003_agent_feed_consumer.sql` | Idempotency and no-direct-rule-link regression |
| `prompts/CODEX_AGENT_FEED_INTEGRATION_PROMPT.md` | Later app-side integration assignment |
| `packages/agent-feed-consumer/README.md` | Consumer package boundary |
| `db/0004_m25_agent_feed_consumer.sql` | M2.5 verified intake, semantic dedupe, evidence work, lifecycle, liveness, and diagnostics |
| `db/tests/007_m25_agent_feed_consumer.sql` | M2.5 transport, mapping, promotion, lifecycle, and redaction regressions |
| `db/0005_m3_golden_publication_boundary.sql` | Exact golden completion/immutability and completed-request rule publication gate |
| `db/seeds/001_m3_real_data_goldens.sql` | Generated private seed for six evidence records and two golden replays; no rule publication |
| `scripts/generate_m3_db_seed.mjs` | Reproducibly derives and verifies the canonical M3 seed from reviewed fixtures |
| `db/tests/008_m3_golden_publication_boundary.sql` | Golden provenance, immutability, privilege, and publication-bypass regressions |
| `fixtures/m3/publication/` | Hash-bound five-rule publication dossier, explicit synthetic-rule exclusion, and human-only decision instructions |
| `scripts/m3_publication.mjs` | Fail-closed publication validator and all-or-nothing SQL generator |
| `fixtures/security/agent-feed-hostile-run-bundle.json` | Protocol-valid hostile bundle retained as untrusted input |
| `packages/consumer-alpha/` | M6 immutable consumer state, safe presentation, link, and correction contracts |
| `apps/consumer-alpha/` | M6 `127.0.0.1` synthetic Node/static-DOM shell |
| `docs/reviews/m6-local-synthetic-alpha-2026-08-19.md` | M6 scope, verification, and remaining real-alpha blockers |
| `packages/challenge-track/` | M7 strict coverage, synthetic-case, runner, report, and CLI boundaries |
| `docs/reviews/m7-challenge-infrastructure-2026-08-19.md` | M7 hostile review, verification, and evidence-track blockers |
| `fixtures/m3/real-data-alpha-evidence-index.v0.1.json` | Six-record reviewed manual Seven-Eleven/nanaco evidence index; verified but not yet publishable |
| `fixtures/m3/real-data/jp-cvs-002/golden-scenario.v1.json` | Immutable JP-CVS-002 golden replay oracle with exact reviewed rule bindings |
| `fixtures/m3/real-data/jp-cvs-006/golden-scenario.v1.json` | Immutable JP-CVS-006 golden replay oracle with engine/preflight provenance and conserved asset ledger |
| `docs/reviews/m3-real-data-alpha-candidate-2026-08-20.md` | Owner source-policy decision, golden fixture checkpoint, resolved tax-basis gap, and publication boundary |
| `packages/rule-engine/src/point-route-optimizer.ts` | Value-ranked multi-hop routing with backward capacity, cap-aware splitting, per-hop stranded accounting, and date-of-hop validity |
| `packages/rule-engine/src/point-valuation.ts` | Explicit per-asset valuation; unvalued assets are reported, never defaulted to face value |
| `packages/rule-engine/src/payment-stack-synthesizer.ts` | Enumerates and prices funding/charge/payment/loyalty combinations through the stacking resolver |
| `packages/provisional-rules/src/p0-payment-layers.ts` | Compiles payment layers, charge exclusions, and redemption values from exact claim shapes only |
| `apps/consumer-alpha/src/payment-stack-recommendation.ts` | Browser surface for "how should I pay", scoped to what the buyer holds |

The source registry remains data version v0.3. Its research cutoff is now 2026-08-20 and it includes the exact first-party pages used by the manual alpha slice.

## Implementation order

1. Run `prompts/CODEX_INITIATING_PROMPT.md` for Milestones 0 + 1A.
2. Run `prompts/CODEX_MILESTONE_1B_PROMPT.md` after the conservation gate.
3. Implement hardened persistence.
4. Implement the separate Agent Feed project in parallel.
5. Run `prompts/CODEX_AGENT_FEED_INTEGRATION_PROMPT.md` only after both dependency gates pass.
6. Run the two-lane source-maintenance rehearsal.

## Boundaries

- no automated live source collection in the engine slices;
- no Agent Feed server implementation in this project;
- no direct database coupling between projects;
- no finding-to-rule automatic publication;
- no Realtime-based job delivery;
- no PAN, CVV, PIN, banking passwords, dynamic payment QR values, or copied issuer sessions;
- synthetic examples are not current market claims;
- this package is engineering/product research, not legal advice.

## Runnable prototype

`prototype/` contains a tested operation-and-asset kernel, a thin HTTP API, and a responsive browser experience using synthetic data. Run `cd prototype && npm test && npm start`. Codex must extend this baseline instead of deleting it and scaffolding from zero.

The local synthetic M6 checkpoint is implemented and verified. The two
isolated real-data golden fixtures are now also seeded in private canonical
database tables. Their rule versions remain `under_review`, no publication
request exists, and the approved-rule API view cannot expose them. Explicit
rule publication review and a controlled frontend adapter remain separate
product steps. The localhost app must not be presented as current reward advice.

The five-rule publication dossier is prepared and machine-verified. Its decision
remains honestly `pending` because funding/tender exclusions and the JPY 5,000
charge commitment require accountable human confirmation. Follow
`fixtures/m3/publication/README.md`; publication SQL cannot be generated before
that hash-bound decision is approved. The deliberately synthetic unsupported-
tender rule remains an unpublished golden-test input and is excluded from the
dossier.

## Verified workspace

Node.js 22+ and pnpm 8.15.4 are required. The workspace does not use live web content or secrets.

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm validate:schemas
pnpm validate:registry
pnpm validate:examples
pnpm test
pnpm test:property
pnpm build
pnpm challenge:validate
pnpm seed:m3:check
pnpm publication:m3:check
pnpm publication:m3:self-test
```

Run the local synthetic consumer shell only after building its dependencies:

```bash
pnpm --filter @jro/consumer-alpha-app build
pnpm --filter @jro/consumer-alpha-app start
```

It binds to `127.0.0.1`, uses synthetic `.test` link fixtures, and keeps all
state in process memory. A direct synthetic card route and optional
stored-value top-up route are exercised; no QR purchase candidate is exposed.

## Vercel + Supabase deployment

The repository includes a deployment-ready hosted-alpha boundary:

- Vercel serves `apps/consumer-alpha/public` and the bounded Node adapter in
  `api/[...path].mjs`;
- Supabase hosts the ordered PostgreSQL schema and released application data;
- the Vercel runtime connects through the Supabase transaction pooler and
  immediately selects the restricted NOLOGIN `jro_runtime` role;
- Vercel's Git integration deploys `main` after merges, while the
  `Deploy Supabase` workflow applies pending migrations only after the `CI`
  workflow succeeds on `main`.

Account authentication, project IDs, database passwords, access tokens, and
the production URL are intentionally not committed. The complete account
handoff, secrets, initial deployment, and verification commands are documented
in `docs/28_deployment_vercel_supabase.md`.

The Milestone 2, 2.5, and M3 canonical-persistence gates require a new disposable PostgreSQL 15+ database. No extra Python packages are needed:

```bash
JRO_TEST_DATABASE_URL=postgresql://.../jro_test \
JRO_DB_TEST_CONFIRM=isolated \
pnpm test:db
```

The legacy offline foundation validator remains available with `make validate` after installing `requirements-dev.txt`. Database integration tests require an isolated PostgreSQL 15+ instance and must report the actual server version.
