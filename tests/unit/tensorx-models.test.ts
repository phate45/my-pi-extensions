import { expect, test } from "bun:test";
import { tensorxModels } from "../../extensions/my-stuff/lib/tensorx-models.js";

test("Qwen Flash Next maps every thinking level to a supported reasoning effort", () => {
  const qwen = tensorxModels().find((model) => model.id === "qwen/qwen3.8-flash-next");
  expect(qwen?.reasoning).toBe(true);
  expect(qwen?.compat?.supportsReasoningEffort).toBe(true);
  expect(qwen?.thinkingLevelMap).toEqual({
    off: "low",
    minimal: "low",
    low: "low",
    medium: "medium",
    high: "xhigh",
    xhigh: "xhigh",
    max: "xhigh",
  });
});
