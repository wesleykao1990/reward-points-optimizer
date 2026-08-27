# WebMCP Rewards Milestone 1 testing guide

This milestone is ready for local browser testing. The normal UI and deterministic WebMCP capability path use demo data. They do not connect to a real d POINT or Ponta account.

## 1. Browser and settings

Use current Google Chrome 149 or newer. Chrome Canary or Chrome Dev is recommended while WebMCP remains experimental.

1. Open `chrome://flags/#enable-webmcp-testing`.
2. Set **WebMCP for testing** to **Enabled**.
3. Relaunch Chrome.
4. Use a normal top-level tab. Do not embed the app in a cross-origin iframe.

The ordinary UI works in any current browser without this flag. WebMCP discovery specifically requires the compatible Chrome build and flag. Chrome's current setup is documented at [WebMCP for Chrome](https://developer.chrome.com/docs/ai/webmcp); the implemented API follows the current [Imperative API](https://developer.chrome.com/docs/ai/webmcp/imperative-api).

## 2. Runtime prerequisites

- Node.js 22.x (the repository's supported runtime)
- Corepack with pnpm 8.15.4
- Optional: an OpenAI API key for the built-in natural-language agent

From the repository root:

```bash
corepack enable
corepack prepare pnpm@8.15.4 --activate
pnpm install --frozen-lockfile
pnpm --filter @jro/consumer-alpha-app... build
```

Start the explicit local demo:

```bash
JRO_DEMO_REWARDS=1 PORT=3000 pnpm --filter @jro/consumer-alpha-app start
```

For the real built-in OpenAI agent, keep the key in the server process only:

```bash
OPENAI_API_KEY='your-key' JRO_DEMO_REWARDS=1 PORT=3000 pnpm --filter @jro/consumer-alpha-app start
```

Optionally set `JRO_OPENAI_MODEL` in the server environment. Never put the key in `app.js`, `webmcp.js`, HTML, DevTools local storage or a public environment variable.

Open [http://127.0.0.1:3000](http://127.0.0.1:3000).

## 3. Test the normal UI

1. Keep **一般のお買い物** selected.
2. Keep or select at least two payment products.
3. Set an amount such as ¥10,000.
4. Click the recommendation/compare action.
5. Confirm route cards appear, one winner is selected and the comparison explanation is visible.

The results are compiled from a bundled fixture only because `JRO_DEMO_REWARDS=1` was explicit. Do not treat the values as current financial advice.

## 4. Test WebMCP discovery and execution

The page badge should say **WebMCPツール公開中** once a valid purchase amount is present. Open Chrome DevTools Console and run:

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

Manually call the comparison tool using the browser's required JSON-string input:

```javascript
const compare = tools.find(({ name }) => name === "compare_purchase_routes");
await document.modelContext.executeTool(compare, "{}");
```

The same visible route cards should rerank and Agent Activity should record `compare_purchase_routes`. Then refresh the tool list; the explanation tool is registered only after a route exists:

```javascript
const updatedTools = await document.modelContext.getTools();
const explain = updatedTools.find(({ name }) => name === "explain_purchase_route");
await document.modelContext.executeTool(explain, "{}");
```

Test a typed session preference and recompute:

```javascript
const preference = updatedTools.find(
  ({ name }) => name === "set_session_purchase_preferences",
);
await document.modelContext.executeTool(
  preference,
  JSON.stringify({ max_extra_steps: 1, preferred_reward_class: "airline_miles" }),
);
const latestTools = await document.modelContext.getTools();
const latestCompare = latestTools.find(
  ({ name }) => name === "compare_purchase_routes",
);
await document.modelContext.executeTool(latestCompare, "{}");
```

## 5. Test the built-in Rewards Agent

With `OPENAI_API_KEY` set on the server, enter:

```text
What's the best way for me to buy this?
```

Then try:

```text
I'm saving airline miles and don't want more than one extra step. Compare my routes.
```

Confirm that:

- an answer appears in the Rewards Agent panel;
- Agent Activity lists bounded domain tools rather than SQL or raw engine calls;
- the visible route cards reflect the same selected route as the activity state;
- the browser Network panel never receives `OPENAI_API_KEY`.

Without a key, this section should fail safely with an agent-unavailable message; the normal UI and WebMCP tests still work.

## 6. Automated regression gate

```bash
pnpm --filter @jro/reward-capabilities test
pnpm --filter @jro/rewards-agent test
pnpm --filter @jro/consumer-alpha-app test
pnpm --filter @jro/consumer-alpha-app... build
```

The integration gate asserts that identical deterministic input produces the same winning route through the normal endpoint, WebMCP capability endpoint and injected built-in agent path.

## Troubleshooting

- **Badge says 通常UIで利用可能:** update Chrome, enable `chrome://flags/#enable-webmcp-testing`, relaunch and reload the page.
- **`document.modelContext` is undefined:** the flag/build is not active. The ordinary app can still be tested.
- **No comparison tool:** enter a valid positive purchase amount and wait briefly for dynamic tool refresh.
- **Recommendation unavailable:** restart with `JRO_DEMO_REWARDS=1`; the server intentionally refuses to invent a route source otherwise.
- **Agent unavailable:** set `OPENAI_API_KEY` in the terminal that starts the server and restart. Do not expose it to the client.
- **Install/build warns about Node:** switch to Node 22.x; newer unsupported runtimes may appear to work but are not the test baseline.

