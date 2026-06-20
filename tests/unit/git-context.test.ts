import { afterEach, describe, expect, test } from "bun:test";
import gitContextExtension from "../../extensions/cc-like/git-context.js";
import { resetBundleConfigForTests, setBundleConfigForTests } from "../../extensions/my-stuff/lib/bundle-config.js";
import { createMockExtensionAPI } from "../helpers/mock-extension-api.js";

afterEach(() => {
  resetBundleConfigForTests();
});

describe("git-context extension", () => {
  test("registers handlers when enabled", () => {
    const { pi, handlers } = createMockExtensionAPI();

    gitContextExtension(pi);

    expect(handlers.get("session_start")?.length).toBe(1);
    expect(handlers.get("before_agent_start")?.length).toBe(1);
  });

  test("skips registration when disabled in bundle config", () => {
    const { pi, handlers } = createMockExtensionAPI();
    setBundleConfigForTests({
      extensions: {
        "git-context": { enabled: false },
      },
    });

    gitContextExtension(pi);

    expect([...handlers.keys()]).toEqual([]);
  });
});
