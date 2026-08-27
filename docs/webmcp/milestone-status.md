# WebMCP rewards milestone status

Updated: 2026-08-27

## M1 — Shared capability core, WebMCP and OpenAI agent

Status: browser-testable; automated gate passed.

Completed:

- Shared typed `@jro/reward-capabilities` package with six bounded operations.
- Existing deterministic consumer recommendation path adapted as the only calculator.
- Current `document.modelContext` WebMCP tools with dynamic registration and abort lifecycle.
- Server-only `@openai/agents` adapter with strict Zod schemas and bounded execution.
- Built-in `/api/agent` endpoint and browser panel.
- One UI state bridge for normal UI, WebMCP and built-in agent results.
- Synthetic Rewards Passport summary and expiry lot, explicitly labeled as demo data.
- Preference-aware deterministic reranking without changing default behavior.
- Supabase/PostgreSQL is the sole runtime source for merchant acceptance and route economics; calculation fails closed when `JRO_DATABASE_URL` is absent.
- Unit, integration, adversarial and identical-winner gate coverage.

Validation record:

- `@jro/reward-capabilities`: 2 tests passed.
- `@jro/rewards-agent`: 1 test passed.
- `@jro/consumer-alpha-app`: 186 tests passed at final handoff.
- TypeScript consumer build passed.
- Clean Chrome 152 browser verification passed: normal comparison and native WebMCP comparison selected the same route, dynamic explanation registration succeeded, and no page errors were reported.

External prerequisites:

- A WebMCP-capable Chrome build with the local testing flag enabled is required to test native tool discovery.
- `OPENAI_API_KEY` is required only for a real built-in agent response. The normal UI and WebMCP deterministic path do not need it.

## M2–M6

Not started in this branch. M2 is deliberately gated on real authentication, per-user RLS, provider authorization/compliance and private-data handling. Browser extension, commerce extraction, ledgers, reconciliation, Neo4j, Qdrant and production evals remain later milestones.
