/**
 * TensorX model catalog. OpenAI-completions-compatible endpoint.
 *
 * cost is USD per 1M tokens, verbatim from https://tensorx.ai/pricing/ (2026-08-28).
 * TensorX bills no separate cache-write tier, so cacheWrite mirrors input.
 */

import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";

export const TENSORX_BASE_URL = "https://api.tensorx.ai/v1";
export const TENSORX_API = "openai-completions";
const MAX_TOKENS = 64_000;

// Enabling reasoning on TensorX's DeepSeek V4 models. They default to NON-thinking on
// the OpenAI-compatible API; reasoning is turned on by passing
// `chat_template_kwargs: { thinking: true }` in the request body, after which the
// response carries `reasoning_content` (+ a `reasoning_tokens` usage count). pi models
// that exact wire shape with `thinkingFormat: "chat-template"`: it injects
// `chat_template_kwargs` and parses `reasoning_content` back into a `thinking` content
// block. `chatTemplateKwargs` is the object sent as `chat_template_kwargs`; the `$var`
// placeholder binds `thinking` to pi's own thinking-enabled state, so the session's
// thinking level (off → false, anything else → true) drives it. Without this,
// `reasoning: true` is inert and the model's chain-of-thought is dropped on the floor.
// The MiniMax, Qwen and GLM entries are not DeepSeek models and carry none of this
// (reasoning surface unknown).
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

type CatalogEntry = {
  id: string;
  name: string;
  input: ("text" | "image")[];
  contextWindow: number;
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  thinking?: Record<string, unknown>;
  thinkingLevelMap?: Record<string, string | null>;
};

// contextWindow is set per model rather than shared. The Qwen entries match the 256K
// window TensorX advertises; the rest are held at 512K against an advertised 1M.
const MODELS: CatalogEntry[] = [
  {
    id: "deepseek/deepseek-v4-flash-0731",
    name: "DeepSeek V4 Flash 0731",
    input: ["text"],
    contextWindow: 512_000,
    cost: { input: 0.25, output: 0.3, cacheRead: 0.06, cacheWrite: 0.25 },
    thinking: DEEPSEEK_THINKING,
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
  },
  {
    id: "qwen/qwen3.5-9b",
    name: "Qwen3.5 9B",
    input: ["text"],
    contextWindow: 256_000,
    cost: { input: 0.15, output: 0.2, cacheRead: 0.04, cacheWrite: 0.15 },
  },
  {
    id: "qwen/qwen3.8-flash-next",
    name: "Qwen3.8 Flash Next",
    input: ["text", "image"],
    contextWindow: 256_000,
    cost: { input: 0.2, output: 0.5, cacheRead: 0.05, cacheWrite: 0.2 },
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
