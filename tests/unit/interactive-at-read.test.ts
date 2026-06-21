import { afterEach, describe, expect, test } from "bun:test";
import interactiveAtReadExtension from "../../extensions/cc-like/interactive-at-read.js";
import {
  resetBundleConfigForTests,
  setBundleConfigForTests,
} from "../../extensions/infra/lib/bundle-config.js";
import { createMockExtensionAPI } from "../helpers/mock-extension-api.js";

afterEach(() => {
  resetBundleConfigForTests();
});

describe("interactive-at-read extension", () => {
  test("registers handlers when enabled", () => {
    const { pi, handlers } = createMockExtensionAPI();

    interactiveAtReadExtension(pi);

    expect(handlers.get("input")?.length).toBe(1);
  });

  test("skips registration when headless is enabled", () => {
    const { pi, handlers } = createMockExtensionAPI();
    setBundleConfigForTests({
      featureFlags: {
        headless: true,
      },
      extensions: {
        "interactive-at-read": { enabled: true },
      },
    });

    interactiveAtReadExtension(pi);

    expect([...handlers.keys()]).toEqual([]);
  });
});
