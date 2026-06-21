import { afterEach, describe, expect, test } from "bun:test";
import customHeaderExtension from "../../extensions/cc-like/custom-header.js";
import { resetBundleConfigForTests, setBundleConfigForTests } from "../../extensions/infra/lib/bundle-config.js";
import { createMockExtensionAPI } from "../helpers/mock-extension-api.js";

afterEach(() => {
  resetBundleConfigForTests();
});

describe("custom-header extension", () => {
  test("registers handlers when enabled", () => {
    const { pi, handlers } = createMockExtensionAPI();

    customHeaderExtension(pi);

    expect(handlers.get("session_start")?.length).toBe(1);
    expect(handlers.get("resources_discover")?.length).toBe(1);
    expect(handlers.get("model_select")?.length).toBe(1);
    expect(handlers.get("session_shutdown")?.length).toBe(1);
  });

  test("skips registration when disabled in bundle config", () => {
    const { pi, handlers } = createMockExtensionAPI();
    setBundleConfigForTests({
      extensions: {
        "custom-header": { enabled: false },
      },
    });

    customHeaderExtension(pi);

    expect([...handlers.keys()]).toEqual([]);
  });

  test("skips registration when the ccLike feature flag is disabled", () => {
    const { pi, handlers } = createMockExtensionAPI();
    setBundleConfigForTests({
      featureFlags: {
        ccLike: false,
      },
      extensions: {
        "custom-header": { enabled: true },
      },
    });

    customHeaderExtension(pi);

    expect([...handlers.keys()]).toEqual([]);
  });

  test("skips registration when headless is enabled", () => {
    const { pi, handlers } = createMockExtensionAPI();
    setBundleConfigForTests({
      featureFlags: {
        headless: true,
      },
      extensions: {
        "custom-header": { enabled: true },
      },
    });

    customHeaderExtension(pi);

    expect([...handlers.keys()]).toEqual([]);
  });
});
