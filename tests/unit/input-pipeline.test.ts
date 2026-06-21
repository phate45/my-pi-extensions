import { afterEach, describe, expect, test } from "bun:test";
import inputPipelineExtension from "../../extensions/infra/input-pipeline.js";
import {
  registerInputRouter,
  registerInputTransform,
  resetInputPipelineForTests,
} from "../../extensions/infra/lib/input-pipeline.js";
import { createMockExtensionAPI } from "../helpers/mock-extension-api.js";

afterEach(() => {
  resetInputPipelineForTests();
});

describe("input pipeline", () => {
  test("runs transforms before routers", async () => {
    const { pi, handlers } = createMockExtensionAPI();
    inputPipelineExtension(pi);

    registerInputTransform("rewrite", ({ text }) => {
      if (text !== "hnd") return undefined;
      return { text: "/from-handoff test" };
    });

    registerInputRouter("route", ({ text, images }) => {
      if (text !== "/from-handoff test") return { action: "continue" } as const;
      return {
        action: "transform" as const,
        text: `<claude-command>${text}</claude-command>`,
        images,
      };
    });

    const handler = handlers.get("input")?.[0];
    await expect(
      handler?.(
        { text: "hnd", images: [], source: "interactive" },
        { cwd: process.cwd(), ui: { notify() {} } },
      ),
    ).resolves.toEqual({
      action: "transform",
      images: [],
      text: "<claude-command>/from-handoff test</claude-command>",
    });
  });

  test("returns transformed text when no router handles it", async () => {
    const { pi, handlers } = createMockExtensionAPI();
    inputPipelineExtension(pi);

    registerInputTransform("rewrite", ({ text }) => ({ text: `${text}!` }));

    const handler = handlers.get("input")?.[0];
    await expect(
      handler?.({ text: "hello" }, { cwd: process.cwd(), ui: { notify() {} } }),
    ).resolves.toEqual({
      action: "transform",
      text: "hello!",
      images: undefined,
    });
  });
});
