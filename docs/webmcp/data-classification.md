# Rewards data classification

| Class | Examples | Allowed locations | Agent handling |
| --- | --- | --- | --- |
| Public canonical facts | reward rules, merchant catalogue, official-source metadata | Supabase/Postgres canonical tables; Agent Feed intake; browser-safe projections | May be shared when bounded and relevant. |
| Private user state | instruments, balances, expiry lots, preferences, campaign progress, expected rewards | Authenticated Supabase/Postgres rows with per-user RLS; minimal same-origin responses | Send only the minimum fields required by a capability. Never send to Agent Feed. |
| Authentication secrets | provider passwords, cookies, refresh/access tokens, OpenAI API key | Purpose-specific server secret/token store only | Never send to the browser, WebMCP, model, traces, logs or Agent Feed. |
| Derived recommendations | ranked routes, explanations, expected reward projections | Same-origin response, UI state, auditable server record where needed | Safe only after private inputs are minimized; calculations must remain deterministic. |
| Demo fixtures | synthetic d POINT/Ponta balances and bundled rule snapshot | Repository fixtures and local demo state | Must carry an explicit `demo_fixture`/`bundled_fixture` label. |
| Derived indexes | Neo4j discovery graph, Qdrant evidence vectors | Rebuildable services | Never authoritative; requests must degrade safely when unavailable. |

## Logging and tracing

Log operation names, status, timings and opaque correlation identifiers. Do not log raw balances, full account activity, prompts containing private state, credentials, tokens or provider responses. Agent activity shown in the UI contains timestamp, bounded tool name, outcome and visible UI effect only.

Real private agent flows remain tracing-disabled until field-level redaction has automated tests and a reviewed retention policy.

