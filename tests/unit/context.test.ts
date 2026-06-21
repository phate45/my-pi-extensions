import { afterEach, describe, expect, test } from "bun:test";
import contextExtension from "../../extensions/cc-like/context.js";
import { resetBundleConfigForTests, setBundleConfigForTests } from "../../extensions/infra/lib/bundle-config.js";
import { createMockExtensionAPI } from "../helpers/mock-extension-api.js";

afterEach(() => {
  resetBundleConfigForTests();
});

describe("context extension", () => {
  test("registers handlers when enabled", () => {
    const { pi, handlers, commands } = createMockExtensionAPI();

    contextExtension(pi);

    expect(handlers.get("tool_result")?.length).toBe(1);
    expect(commands).toEqual(["context"]);
  });

  test("skips registration when headless is enabled", () => {
    const { pi, handlers, commands } = createMockExtensionAPI();
    setBundleConfigForTests({
      featureFlags: {
        headless: true,
      },
      extensions: {
        context: { enabled: true },
      },
    });

    contextExtension(pi);

    expect([...handlers.keys()]).toEqual([]);
    expect(commands).toEqual([]);
  });
});
