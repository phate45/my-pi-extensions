import { expect, test } from "bun:test";
import {
  type Api,
  type Context,
  type Model,
  type SimpleStreamOptions,
  normalizeContext,
} from "@earendil-works/pi-ai";
import { getApiProvider } from "@earendil-works/pi-ai/compat";
import { tensorxModels } from "../../extensions/my-stuff/lib/tensorx-models.js";

const minimaxLevels = {
  off: "disabled",
  minimal: "adaptive",
  low: "adaptive",
  medium: "adaptive",
  high: "enabled",
  xhigh: "enabled",
  max: "enabled",
};
const deepseekLevels = {
  off: "none",
  minimal: "low",
  low: "low",
  medium: "high",
  high: "high",
  xhigh: "high",
  max: "max",
};
const minimaxIds = ["minimax/minimax-m3", "minimax/minimax-m3.1-flash"];
const deepseekId = "deepseek/deepseek-v4.1-flash-1017";

function catalogModel(id: string) {
  const model = tensorxModels().find((entry) => entry.id === id);
  expect(model).toBeDefined();
  if (!model || (model.type !== undefined && model.type !== "chat")) {
    throw new Error(`Missing chat model: ${id}`);
  }
  return model;
}

test("catalog drops retired models and prices the image-capable replacements", () => {
  const models = tensorxModels();
  expect(models).toHaveLength(7);
  expect(models.some((model) => model.id.startsWith("qwen/"))).toBe(false);
  expect(models.some((model) => model.id === "deepseek/deepseek-v4-flash-0731")).toBe(false);
  for (const [id, input, output, cacheRead] of [
    [minimaxIds[1]!, 0.3, 1.2, 0.08],
    [deepseekId, 0.5, 1.5, 0.13],
  ] as const) {
    const model = catalogModel(id);
    expect(model.input).toEqual(["text", "image"]);
    expect(model.cost).toEqual({ input, output, cacheRead, cacheWrite: input });
    expect(model.contextWindow).toBe(512_000);
    expect(model.maxTokens).toBe(64_000);
  }
});

for (const id of [...minimaxIds, deepseekId]) {
  const isMinimax = minimaxIds.includes(id);
  const levels = isMinimax ? minimaxLevels : deepseekLevels;

  test(`${id} declares its reasoning protocol and every level`, () => {
    const model = catalogModel(id);
    expect(model.reasoning).toBe(true);
    expect(model.thinkingLevelMap).toEqual(levels);
    expect(model.compat?.supportsReasoningEffort).toBe(!isMinimax);
    expect(model.compat?.chatTemplateKwargs).toEqual(
      isMinimax ? { thinking_mode: { $var: "thinking.effort" } } : undefined,
    );
    expect(model.compat?.thinkingFormat).toBe(isMinimax ? "chat-template" : undefined);
  });

  for (const [level, expected] of Object.entries(levels)) {
    test(`${id} sends ${expected} for ${level} through the real adapter`, async () => {
      const adapter = getApiProvider("openai-completions" as Api);
      if (!adapter) throw new Error("No openai-completions adapter");
      let payload: Record<string, unknown> | undefined;
      const fetch = (async (_input: unknown, init?: RequestInit) => {
        payload = JSON.parse(init?.body as string);
        return new Response(
          'data: {"choices":[{"index":0,"delta":{"content":"Hello world"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
          { headers: { "content-type": "text/event-stream" } },
        );
      }) as typeof globalThis.fetch;
      const model = {
        ...catalogModel(id),
        provider: "tensorx",
        api: "openai-completions",
        baseUrl: "https://api.tensorx.invalid/v1",
      } as Model<Api>;
      const context = normalizeContext({
        messages: [{ role: "user", content: "hi" }],
      } as unknown as Context);
      const stream = adapter.streamSimple(model, context, {
        apiKey: "test-key",
        fetch,
        ...(level === "off" ? {} : { reasoning: level as SimpleStreamOptions["reasoning"] }),
      });
      const result = await stream.result();
      expect(result.stopReason).toBe("stop");
      expect(payload).toBeDefined();
      expect(payload?.thinking).toBeUndefined();
      expect(payload?.enable_thinking).toBeUndefined();
      if (isMinimax) {
        expect(payload?.chat_template_kwargs).toEqual({ thinking_mode: expected });
        expect(payload?.reasoning_effort).toBeUndefined();
      } else {
        expect(payload?.reasoning_effort).toBe(expected);
        expect(payload?.chat_template_kwargs).toBeUndefined();
      }
    });
  }
}
