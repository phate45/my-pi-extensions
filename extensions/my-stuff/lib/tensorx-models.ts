/**
 * TensorX model catalog. OpenAI-completions-compatible endpoint.
 *
 * Cost is USD per 1M tokens from TensorX pricing.
 * TensorX bills no separate cache-write tier, so cacheWrite mirrors input.
 */

import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";

export const TENSORX_BASE_URL = "https://api.tensorx.ai/v1";
export const TENSORX_API = "openai-completions";
const MAX_TOKENS = 64_000;

// DeepSeek V4 Pro uses a boolean chat-template switch rather than reasoning_effort.
const DEEPSEEK_THINKING = {
  thinkingFormat: "chat-template",
  chatTemplateKwargs: { thinking: { $var: "thinking.enabled" } },
};

// With no thinkingFormat, pi sends `reasoning_effort` (the session's thinking level)
// only when the model claims support for it; without this the level never leaves pi.
const REASONING_EFFORT = { supportsReasoningEffort: true };

// TensorX honours only "none", "low" and "high" for GLM 5.3; every other value, and an
// omitted one, runs at maximum depth (docs.tensorx.ai/api-reference/reasoning).
const GLM_53_LEVELS = {
  off: "none",
  minimal: "low",
  low: "low",
  medium: "high",
  high: "high",
  xhigh: "max",
  max: "max",
};

// DeepSeek Flash keeps xhigh at high; only max requests maximum reasoning.
const DEEPSEEK_FLASH_LEVELS = {
  off: "none",
  minimal: "low",
  low: "low",
  medium: "high",
  high: "high",
  xhigh: "high",
  max: "max",
};

const MINIMAX_THINKING = {
  thinkingFormat: "chat-template",
  chatTemplateKwargs: { thinking_mode: { $var: "thinking.effort" } },
};

// MiniMax accepts modes, not graded reasoning effort.
const MINIMAX_LEVELS = {
  off: "disabled",
  minimal: "adaptive",
  low: "adaptive",
  medium: "adaptive",
  high: "enabled",
  xhigh: "enabled",
  max: "enabled",
};

type CatalogEntry = {
  id: string;
  name: string;
  input: ("text" | "image")[];
  contextWindow: number;
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  thinking?: Record<string, unknown>;
  thinkingLevelMap?: Record<string, string | null>;
};

// Context windows and output limits remain conservative local caps.
const MODELS: CatalogEntry[] = [
  {
    id: "deepseek/deepseek-v4.1-flash-1017",
    name: "DeepSeek V4.1 Flash 1017",
    input: ["text", "image"],
    contextWindow: 512_000,
    cost: { input: 0.5, output: 1.5, cacheRead: 0.13, cacheWrite: 0.5 },
    thinking: REASONING_EFFORT,
    thinkingLevelMap: DEEPSEEK_FLASH_LEVELS,
  },
  {
    id: "deepseek/deepseek-v4-pro",
    name: "DeepSeek V4 Pro",
    input: ["text"],
    contextWindow: 512_000,
    cost: { input: 1.75, output: 3.5, cacheRead: 0.44, cacheWrite: 1.75 },
    thinking: DEEPSEEK_THINKING,
  },
  {
    id: "minimax/minimax-m3",
    name: "MiniMax M3",
    input: ["text", "image"],
    contextWindow: 512_000,
    cost: { input: 0.4, output: 2.0, cacheRead: 0.1, cacheWrite: 0.4 },
    thinking: MINIMAX_THINKING,
    thinkingLevelMap: MINIMAX_LEVELS,
  },
  {
    id: "minimax/minimax-m3.1-flash",
    name: "MiniMax M3.1 Flash",
    input: ["text", "image"],
    contextWindow: 512_000,
    cost: { input: 0.3, output: 1.2, cacheRead: 0.08, cacheWrite: 0.3 },
    thinking: MINIMAX_THINKING,
    thinkingLevelMap: MINIMAX_LEVELS,
  },
  {
    id: "z-ai/glm-5.3-flash",
    name: "GLM 5.3 Flash",
    input: ["text", "image"],
    contextWindow: 999_999,
    cost: { input: 0.2, output: 0.5, cacheRead: 0.05, cacheWrite: 0.2 },
    thinking: REASONING_EFFORT,
    thinkingLevelMap: GLM_53_LEVELS,
  },
  {
    id: "z-ai/glm-5.3",
    name: "GLM 5.3",
    input: ["text", "image"],
    contextWindow: 999_999,
    cost: { input: 1.75, output: 4.5, cacheRead: 0.44, cacheWrite: 1.75 },
  },
  {
    id: "moonshotai/kimi-k3",
    name: "Kimi K3",
    input: ["text", "image"],
    contextWindow: 999_999,
    cost: { input: 3, output: 15, cacheRead: 0.75, cacheWrite: 3 },
  },
];

export function tensorxModels(): ProviderModelConfig[] {
  return MODELS.map((entry) => ({
    id: entry.id,
    name: entry.name,
    reasoning: true,
    input: entry.input,
    cost: entry.cost,
    contextWindow: entry.contextWindow,
    maxTokens: MAX_TOKENS,
    ...(entry.thinkingLevelMap ? { thinkingLevelMap: entry.thinkingLevelMap } : {}),
    compat: {
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      maxTokensField: "max_tokens",
      ...(entry.thinking ?? {}),
    },
  })) as ProviderModelConfig[];
}
