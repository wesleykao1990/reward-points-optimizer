import type { RewardCapabilities } from "@jro/reward-capabilities";
import { Agent, Runner } from "@openai/agents";
import { createRewardsAgentTools } from "./tools.js";

export const DEFAULT_REWARDS_AGENT_MODEL = "gpt-5-mini" as const;
export const MAX_REWARDS_AGENT_TURNS = 6 as const;
export const DEFAULT_REWARDS_AGENT_TIMEOUT_MS = 20_000 as const;

export interface RewardsAgentRunOptions {
  readonly model?: string;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly tracing?: "disabled" | "safe_fixture";
}

export interface RewardsAgentRunResult {
  readonly answer: string;
  readonly state: ReturnType<RewardCapabilities["snapshot"]>;
}

export function createRewardsAgent(
  capabilities: RewardCapabilities,
  model: string = DEFAULT_REWARDS_AGENT_MODEL,
): Agent {
  return new Agent({
    name: "Rewards Agent",
    model,
    instructions: [
      "You help the user choose a complete rewards route for the current purchase.",
      "Use RewardCapabilities tools for facts, preferences, route comparison, and arithmetic.",
      "Never calculate rewards yourself and never invent payment acceptance.",
      "When the user expresses a preference, call set_session_purchase_preferences before compare_purchase_routes.",
      "For 'how should I pay' questions, read the current context, compare routes, and explain the winner.",
      "If every route reports catalogue_unavailable, explain that merchant catalogue data is unavailable; do not claim that stored-value or preference changes will repair missing catalogue data.",
      "Do not purchase, pay, transfer, redeem, or claim to have completed a consequential action.",
      "Keep private state minimal. Demo fixture data must be described as demo data.",
    ].join("\n"),
    tools: [...createRewardsAgentTools(capabilities)],
  });
}

export async function runRewardsAgent(
  capabilities: RewardCapabilities,
  message: string,
  options: RewardsAgentRunOptions = {},
): Promise<RewardsAgentRunResult> {
  if (message.length < 1 || message.length > 2_000)
    throw new TypeError("agent_message_invalid");
  const timeout = options.timeoutMs ?? DEFAULT_REWARDS_AGENT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeout) || timeout < 1_000 || timeout > 60_000)
    throw new TypeError("agent_timeout_invalid");
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), timeout);
  const abortFromCaller = () => timeoutController.abort();
  options.signal?.addEventListener("abort", abortFromCaller, { once: true });
  try {
    const runner = new Runner({
      tracingDisabled: options.tracing !== "safe_fixture",
      traceIncludeSensitiveData: false,
      workflowName: "Rewards Agent",
    });
    const result = await runner.run(
      createRewardsAgent(capabilities, options.model),
      message,
      {
        maxTurns: MAX_REWARDS_AGENT_TURNS,
        signal: timeoutController.signal,
        toolExecution: { maxFunctionToolConcurrency: 1 },
      },
    );
    return Object.freeze({
      answer:
        typeof result.finalOutput === "string"
          ? result.finalOutput
          : JSON.stringify(result.finalOutput),
      state: capabilities.snapshot(),
    });
  } finally {
    clearTimeout(timeoutId);
    options.signal?.removeEventListener("abort", abortFromCaller);
  }
}
