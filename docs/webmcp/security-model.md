# WebMCP rewards security model

Status: Milestone 1 baseline. Revisit before authenticated provider data is introduced.

## Trust boundaries

The browser and all agent output are untrusted inputs. The same-origin server validates exact keys, sizes, identifier formats, numeric bounds and enums before invoking a capability. `RewardCapabilities` can orchestrate only a fixed domain allowlist. The deterministic engine remains the only arithmetic authority.

WebMCP exposes purpose-built tools. It does not expose SQL, generic HTTP fetch, rule execution, credential access, cookies, provider sessions or filesystem operations. Tool registration is dynamic and removed with an `AbortSignal` when page state changes. Tool execution cancellation is forwarded to the same-origin request.

## OpenAI boundary

- `OPENAI_API_KEY` is server-only and is never serialized to HTML, JavaScript, WebMCP schemas or API responses.
- Agent inputs are bounded to 2,000 characters and typed schemas are strict.
- SDK turns, timeout and tool concurrency are bounded.
- Tracing is disabled by default for this private-data path; sensitive trace inclusion is disabled.
- The agent can explain or choose a capability, but cannot calculate reward values itself.
- SDK/provider failures return a stable unavailable response rather than leaking internal errors.

## Private data policy

Milestone 1 exposes only synthetic passport data. Future private state must be scoped to an authenticated user at both the same-origin API and database RLS layer. Provider credentials, copied cookies and logged-in sessions must never enter application storage, Agent Feed, model context or tracing.

Provider synchronization requires explicit authorization and a compliant provider mechanism. Until that is available, adapters must remain tested contracts with deterministic fixtures rather than simulated live connections.

## Actions and consent

Current tools are read-only except session-only preference changes. There is no redemption, transfer, checkout submission or provider mutation. Future irreversible or financially material tools require explicit human confirmation, idempotency, an audit record and narrowly scoped provider authorization.

## Known residual risks

- WebMCP is experimental and browser behavior may change.
- Any browser extension with broad page permissions has powers beyond WebMCP; install only trusted test extensions.
- Prompt injection is not eliminated by typed tools. Tool output remains bounded and capability authorization must not depend on model prose.
- Real authentication, per-user RLS and provider consent flows are M2 gates, not implied by the synthetic demo.

