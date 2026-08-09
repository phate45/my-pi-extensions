import { afterEach, describe, expect, test } from "bun:test";
import askUserExtension from "../../extensions/my-stuff/ask-user.js";
import {
  resetBundleConfigForTests,
  setBundleConfigForTests,
} from "../../extensions/infra/lib/bundle-config.js";
import { createMockExtensionAPI } from "../helpers/mock-extension-api.js";

afterEach(() => {
  resetBundleConfigForTests();
});

describe("ask-user extension", () => {
  test("registers the ask_user tool when enabled", () => {
    const { pi, tools } = createMockExtensionAPI();

    askUserExtension(pi);

    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({
      name: "ask_user",
      label: "Ask User",
      promptGuidelines: [expect.stringContaining("ask_user"), expect.stringContaining("ask_user")],
    });
  });

  test("skips registration when the myStuff feature flag is disabled", () => {
    const { pi, tools } = createMockExtensionAPI();
    setBundleConfigForTests({
      featureFlags: { myStuff: false },
      extensions: { "ask-user": { enabled: true } },
    });

    askUserExtension(pi);

    expect(tools).toHaveLength(0);
  });

  test("skips registration when headless is enabled", () => {
    const { pi, tools } = createMockExtensionAPI();
    setBundleConfigForTests({
      featureFlags: { headless: true },
      extensions: { "ask-user": { enabled: true } },
    });

    askUserExtension(pi);

    expect(tools).toHaveLength(0);
  });
});
