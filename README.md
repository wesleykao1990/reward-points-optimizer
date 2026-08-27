# Japan Rewards Optimizer

An agent-native rewards intelligence platform for comparing purchase routes in Japan. It combines a deterministic rewards engine, evidence-bound rule data, a browser interface, native WebMCP tools, and an optional OpenAI-powered Rewards Agent.

The long-term product is a **Rewards Passport + Agent Checkout Planner + Rewards Auditor**. The rewards intelligence is the platform; the chatbot is one interface to it.

> [!IMPORTANT]
> Reward rates, merchant acceptance, and route facts come from the configured Supabase PostgreSQL database. The current Rewards Passport balances and expiry lots are clearly marked test data because account authentication is not implemented yet; they must not be treated as real account balances.

## What works today

The current WebMCP milestone is ready for local testing:

- six typed rewards capabilities shared by the UI, WebMCP, and the built-in agent;
- deterministic purchase-route comparison through the existing recommendation engine;
- dynamic `document.modelContext` tool registration and visible Agent Activity;
- an optional server-side OpenAI agent with bounded, schema-validated tools;
- live Supabase-backed merchant acceptance and reward-rate calculations, shared by every merchant;
- a clearly labelled synthetic Rewards Passport until user authentication is added;
- browser, integration, adversarial, and identical-winner test coverage.

The wider repository also includes a versioned rule engine, evidence and provenance contracts, PostgreSQL/Supabase migrations, Agent Feed ingestion boundaries, source-maintenance workflows, and a Vercel deployment adapter.

Not yet included in the WebMCP product path: real user authentication, provider account connections, per-user Rewards Passport storage, browser-extension purchase extraction, reward reconciliation, or production graph/vector indexes. See [milestone status](docs/webmcp/milestone-status.md).

## Quick start

### Prerequisites

- Node.js 22.x
- Corepack and pnpm 8.15.4

From the repository root:

```bash
corepack enable
corepack prepare pnpm@8.15.4 --activate
pnpm install --frozen-lockfile
pnpm --filter @jro/consumer-alpha-app... build
```

Copy the **Session pooler** connection string from Supabase Dashboard → **Connect**, then read it into the current shell without displaying it:

```bash
read -rs "JRO_DATABASE_URL?Paste your Supabase Session pooler URL: "; echo
export JRO_DATABASE_URL
PORT=3000 pnpm --filter @jro/consumer-alpha-app start
```

`JRO_DATABASE_URL` is server-only. Do not place it in browser JavaScript, HTML, local storage, or a public `VITE_`/`NEXT_PUBLIC_` variable. The app can render without it, but route comparison intentionally reports data unavailable instead of using fixture rates.

Open [http://127.0.0.1:3000](http://127.0.0.1:3000), go to **貯める**, select at least two payment products, enter a purchase amount such as ¥10,000, and run the comparison.

The ordinary interface works in any current browser. Native WebMCP discovery needs the Chrome setup below.

## Test WebMCP in Chrome

Use Google Chrome 149 or newer. Chrome Canary or Chrome Dev is recommended while WebMCP remains experimental.

1. Open `chrome://flags/#enable-webmcp-testing`.
2. Set **WebMCP for testing** to **Enabled**.
3. Relaunch Chrome and open the app in a normal top-level tab.
4. Enter a valid positive purchase amount and wait for the **WebMCPツール公開中** badge.

In Chrome DevTools Console:

```javascript
const tools = await document.modelContext.getTools();
tools.map(({ name }) => name);
```

Expected tools include:

- `get_current_purchase_context`
- `get_rewards_passport_summary`
- `get_expiring_rewards`
- `compare_purchase_routes`
- `set_session_purchase_preferences`

Run a comparison with WebMCP's JSON-string input:

```javascript
const compare = tools.find(({ name }) => name === "compare_purchase_routes");
await document.modelContext.executeTool(compare, "{}");
```

The visible route cards should update and Agent Activity should record the tool call. After a comparison exists, the page dynamically adds `explain_purchase_route`:

```javascript
const updatedTools = await document.modelContext.getTools();
const explain = updatedTools.find(({ name }) => name === "explain_purchase_route");
await document.modelContext.executeTool(explain, "{}");
```

See the [complete WebMCP testing guide](docs/webmcp/testing-guide.md) for preference calls, agent prompts, expected results, and troubleshooting. Chrome's API references are [WebMCP for Chrome](https://developer.chrome.com/docs/ai/webmcp) and the [Imperative API](https://developer.chrome.com/docs/ai/webmcp/imperative-api).

## Add an OpenAI API key

The normal UI and deterministic WebMCP path do not require an API key. A key is needed only for the built-in natural-language Rewards Agent.

For zsh, read the key without displaying it and export it only to the current terminal session:

```bash
read -rs "OPENAI_API_KEY?Paste your OpenAI API key: "; echo
export OPENAI_API_KEY
PORT=3000 pnpm --filter @jro/consumer-alpha-app start
```

You can optionally set `JRO_OPENAI_MODEL`. Keep the API key server-side: never place it in `app.js`, `webmcp.js`, HTML, browser storage, DevTools, or a public environment variable. The app does not need the key prefixed with `NEXT_PUBLIC_`, `VITE_`, or anything similar.

Once the server is running, try this in the Rewards Agent panel:

```text
I'm saving airline miles and don't want more than one extra step. Compare my routes.
```

Without a key, the agent fails safely while the normal UI and WebMCP tools remain available.

## Configuration

| Variable | Required | Purpose |
|---|---:|---|
| `JRO_DATABASE_URL` | Route comparison | Server-only Supabase/PostgreSQL connection used for current rates, acceptance, and route facts. |
| `OPENAI_API_KEY` | Agent only | Server-side credential for the built-in Rewards Agent. |
| `JRO_OPENAI_MODEL` | No | Overrides the agent model. |
| `PORT` | No | Local server port; defaults to `3000`. |

Additional deployment and Agent Feed variables are documented with their respective subsystems.

## How it fits together

```text
normal browser UI ─────┐
native WebMCP client ──┼─> shared reward capabilities
built-in OpenAI agent ─┘            │
                                     v
                         recommendation adapter
                                     │
                                     v
                     deterministic rule and valuation engine
                                     │
                                     v
                      safe UI state + Agent Activity

Agent Feed findings -> untrusted observations -> reviewed evidence -> rules
PostgreSQL/Supabase -> authoritative facts and private runtime state
```

The three interaction paths call the same capability layer and calculator. An LLM may select and sequence bounded tools, but it does not perform reward arithmetic, execute SQL, read secrets, or publish findings as rules.

### Trust boundaries

- Reward calculations remain deterministic and replayable.
- Findings and submitted evidence are not canonical facts.
- Rule publication is reviewed and fails closed.
- Private data and credentials stay on the trusted server.
- Browser DTOs omit internal rules, hashes, evidence locators, and database credentials.
- Synthetic passport examples are visibly labeled and never substituted for Supabase route economics.

Read [WebMCP architecture](docs/webmcp/architecture.md), [security model](docs/webmcp/security-model.md), [data classification](docs/webmcp/data-classification.md), and the repository-wide [trust and provenance policy](docs/01_trust_and_provenance_policy.md) for the full design.

## Repository map

| Path | Responsibility |
|---|---|
| `apps/consumer-alpha` | Local browser app, API endpoints, WebMCP bridge, and hosted adapter. |
| `packages/reward-capabilities` | Shared typed rewards operations and session state. |
| `packages/rewards-agent` | OpenAI Agents SDK adapter and bounded tool definitions. |
| `packages/rule-engine` | Pure reward, transfer, valuation, replay, and accounting logic. |
| `packages/recommendation-api` | Internal recommendation and response-security boundary. |
| `packages/contracts` | Generated schemas plus structural and semantic validation. |
| `packages/agent-feed-consumer` | Signed delivery intake and untrusted-finding mapping. |
| `packages/agent-feed-postgres` | PostgreSQL adapters for compiled implementation facts. |
| `db` | Canonical SQL migrations, seeds, and adversarial database tests. |
| `supabase` | Ordered Supabase migrations and local project configuration. |
| `docs` | Product, architecture, trust, operations, deployment, and review records. |
| `prototype` | Preserved legacy operation-and-asset prototype. |

Agent Feed is a separate deployable sibling project. It transports generic findings; this repository owns evidence acquisition, review, rule publication, and recommendation behavior. The two projects do not query each other's databases. See [Agent Feed integration](docs/15_agent_feed_integration.md).

## Validation

For the current WebMCP milestone:

```bash
pnpm --filter @jro/reward-capabilities test
pnpm --filter @jro/rewards-agent test
pnpm --filter @jro/consumer-alpha-app test
pnpm --filter @jro/consumer-alpha-app... build
pnpm lint
```

For the complete workspace:

```bash
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

Database tests require a new disposable PostgreSQL 15+ database. They are intentionally guarded against running on an unconfirmed target:

```bash
JRO_TEST_DATABASE_URL=postgresql://.../jro_test \
JRO_DB_TEST_CONFIRM=isolated \
pnpm test:db
```

## Deployment

The hosted-alpha boundary uses Vercel for the static app and bounded Node adapter, with Supabase PostgreSQL as the authoritative data store. The runtime selects a restricted database role; account credentials, project IDs, database passwords, tokens, and production URLs are not committed.

Follow [Vercel and Supabase deployment](docs/28_deployment_vercel_supabase.md) for environment setup, migrations, CI ordering, smoke tests, and rollback guidance.

## Current scope and roadmap

- **M1 — complete and browser-testable:** shared capabilities, native WebMCP, optional OpenAI agent, one UI state bridge, and explicit demo mode.
- **M2 — planned:** authentication, private per-user Rewards Passport storage, RLS, provider authorization, and compliance boundaries.
- **M3 — planned:** browser extension foundation, normalized commerce context, and a narrow shopping companion.
- **M4 — planned:** complete checkout plans, controlled native-WebMCP commerce, and optional Neo4j route discovery.
- **M5 — planned:** expected reward ledger, reconciliation, Reward Auditor, and optional Qdrant evidence retrieval.
- **M6 — planned:** agent evals, security tests, production connector policy, budget controls, and hackathon hardening.

Detailed completion evidence and blockers live in [docs/webmcp/milestone-status.md](docs/webmcp/milestone-status.md).

## Research and safety notice

The source registry's current research cutoff is **2026-08-20 (Asia/Tokyo)**. Reward programmes, campaigns, acceptance rules, and conversion values change. Production guidance must be supported by current canonical evidence and its validity window; bundled fixtures and historical records are for engineering validation only.

This repository is product and engineering research, not financial, legal, tax, or compliance advice.
