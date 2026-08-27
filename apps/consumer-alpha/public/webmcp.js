(() => {
  const status = document.getElementById("webmcp-status");
  const modelContext = document.modelContext;
  if (!modelContext || typeof modelContext.registerTool !== "function") {
    if (status) status.textContent = "通常UIで利用可能";
    return;
  }

  let controller = null;
  let refreshSequence = 0;
  let activePreferences = {
    preferred_reward_class: null,
    preferred_assets: [],
    excluded_family_ids: [],
    max_extra_steps: null,
    minimum_incremental_value_jpy: null,
  };
  let selectedRouteId = null;

  const bridgeState = () => {
    const detail = { value: null };
    document.dispatchEvent(
      new CustomEvent("rewards-request-bridge-state", { detail }),
    );
    return detail.value;
  };

  const callCapability = async (tool, args = {}, signal) => {
    const bridge = bridgeState();
    const response = await fetch("/api/capabilities/invoke", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        tool,
        purchase_context: bridge?.purchase_context || null,
        preferences: activePreferences,
        arguments: args,
      }),
      signal,
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body?.error?.code || "capability_failed");
    if (body.state?.preferences) activePreferences = body.state.preferences;
    selectedRouteId = body.state?.selected_route_id || selectedRouteId;
    document.dispatchEvent(
      new CustomEvent("rewards-capability-state", { detail: body.state }),
    );
    document.dispatchEvent(new Event("rewards-tool-state-changed"));
    return body.result;
  };

  const emptySchema = Object.freeze({
    type: "object",
    properties: {},
    additionalProperties: false,
  });

  const toolDefinitions = (hasPurchaseContext) => {
    const tools = [
      {
        name: "get_current_purchase_context",
        description:
          "Read the normalized current merchant, amount, owned instruments, and purchase context.",
        inputSchema: emptySchema,
        annotations: { readOnlyHint: true },
        execute: (_args, client) =>
          callCapability("get_current_purchase_context", {}, client?.signal),
      },
    ];
    if (document.body.dataset.demoPassport === "true") {
      tools.push(
        {
          name: "get_rewards_passport_summary",
          description:
            "Read the clearly labeled synthetic Rewards Passport demo summary. No provider credentials or sessions are exposed.",
          inputSchema: emptySchema,
          annotations: { readOnlyHint: true },
          execute: (_args, client) =>
            callCapability("get_rewards_passport_summary", {}, client?.signal),
        },
        {
          name: "get_expiring_rewards",
          description:
            "List synthetic demo reward lots expiring inside a bounded number of days.",
          inputSchema: {
            type: "object",
            properties: {
              within_days: { type: "integer", minimum: 1, maximum: 365 },
            },
            required: ["within_days"],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: true },
          execute: (args, client) =>
            callCapability("get_expiring_rewards", args, client?.signal),
        },
      );
    }
    if (hasPurchaseContext) {
      tools.push(
        {
          name: "compare_purchase_routes",
          description:
            "Run the trusted deterministic rewards engine for the visible purchase and rerank the visible route cards.",
          inputSchema: emptySchema,
          annotations: { readOnlyHint: true },
          execute: (_args, client) =>
            callCapability("compare_purchase_routes", {}, client?.signal),
        },
        {
          name: "set_session_purchase_preferences",
          description:
            "Set bounded session-only reward preferences. Call compare_purchase_routes afterwards to recompute.",
          inputSchema: {
            type: "object",
            properties: {
              preferred_reward_class: {
                type: ["string", "null"],
                enum: [
                  "cash_equivalent",
                  "airline_miles",
                  "hotel_points",
                  "merchant_points",
                  null,
                ],
              },
              preferred_assets: {
                type: "array",
                maxItems: 64,
                items: { type: "string", pattern: "^[a-z][a-z0-9._-]+$" },
              },
              excluded_family_ids: {
                type: "array",
                maxItems: 64,
                items: { type: "string", pattern: "^[a-z][a-z0-9._-]+$" },
              },
              max_extra_steps: {
                type: ["integer", "null"],
                minimum: 0,
                maximum: 8,
              },
              minimum_incremental_value_jpy: {
                type: ["integer", "null"],
                minimum: 0,
                maximum: 1000000,
              },
            },
            additionalProperties: false,
          },
          execute: (args, client) =>
            callCapability(
              "set_session_purchase_preferences",
              args,
              client?.signal,
            ),
        },
      );
    }
    if (hasPurchaseContext && selectedRouteId) {
      tools.push({
        name: "explain_purchase_route",
        description:
          "Read deterministic components and conditions for a compared route without recalculating rewards in the agent.",
        inputSchema: {
          type: "object",
          properties: {
            route_id: { type: "string", pattern: "^[a-z][a-z0-9._-]+$" },
          },
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true },
        execute: (args, client) =>
          callCapability("explain_purchase_route", args, client?.signal),
      });
    }
    return tools;
  };

  const refresh = async () => {
    const sequence = ++refreshSequence;
    controller?.abort();
    controller = new AbortController();
    await Promise.resolve();
    const context = bridgeState()?.purchase_context;
    const hasPurchaseContext = Boolean(
      context &&
        Number.isSafeInteger(context.amount_jpy) &&
        context.amount_jpy > 0,
    );
    try {
      for (const tool of toolDefinitions(hasPurchaseContext)) {
        if (sequence !== refreshSequence) return;
        await modelContext.registerTool(tool, { signal: controller.signal });
      }
      if (status)
        status.textContent = hasPurchaseContext
          ? "WebMCPツール公開中"
          : "WebMCP公開中・購入条件なし";
    } catch {
      if (status) status.textContent = "WebMCPを利用できません";
    }
  };

  let refreshTimer = null;
  const scheduleRefresh = () => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => void refresh(), 20);
  };
  document.addEventListener("input", scheduleRefresh);
  document.addEventListener("change", scheduleRefresh);
  document.addEventListener("rewards-tool-state-changed", scheduleRefresh);
  document.addEventListener("rewards-capability-state", (event) => {
    if (event.detail?.preferences) activePreferences = event.detail.preferences;
    selectedRouteId = event.detail?.selected_route_id || selectedRouteId;
    scheduleRefresh();
  });
  window.addEventListener("pagehide", () => controller?.abort(), {
    once: true,
  });
  void refresh();
})();
