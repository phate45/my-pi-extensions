import { afterEach, describe, expect, test } from "bun:test";
import webResearchExtension from "../../extensions/my-stuff/web-research.js";
import {
  resetBundleConfigForTests,
  setBundleConfigForTests,
} from "../../extensions/infra/lib/bundle-config.js";
import { createMockExtensionAPI } from "../helpers/mock-extension-api.js";

afterEach(() => {
  resetBundleConfigForTests();
});

describe("web-research extension", () => {
  test.each([
    [undefined, "fast", "gpt-6-luna"],
    ["deep", "deep", "gpt-6.1-terra"],
  ])("selects the model for %s depth", async (depth, expectedDepth, model) => {
    const { pi, tools } = createMockExtensionAPI();
    webResearchExtension(pi);
    const tool = tools[0] as { execute: Function };
    const stop = new Error("stop before spawning Codex");
    let message = "";
    await expect(
      tool.execute("test", { query: "test", depth }, undefined, (update: any) => {
        message = update.content[0].text;
        throw stop;
      }),
    ).rejects.toBe(stop);
    expect(message).toBe(`Running Codex web research (${expectedDepth}, cached, ${model})...`);
  });

  test("registers its tool when enabled", () => {
    const { pi, tools } = createMockExtensionAPI();

    webResearchExtension(pi);

    expect(tools).toHaveLength(1);
  });

  test("skips tool registration when myStuff feature flag is disabled", () => {
    const { pi, tools } = createMockExtensionAPI();
    setBundleConfigForTests({
      featureFlags: {
        myStuff: false,
      },
      extensions: {
        "web-research": { enabled: true },
      },
    });

    webResearchExtension(pi);

    expect(tools).toHaveLength(0);
  });
});
