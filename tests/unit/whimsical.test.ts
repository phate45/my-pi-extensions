import { afterEach, describe, expect, test } from "bun:test";
import whimsicalExtension from "../../extensions/my-stuff/whimsical.js";
import {
  resetBundleConfigForTests,
  setBundleConfigForTests,
} from "../../extensions/infra/lib/bundle-config.js";
import { createMockExtensionAPI } from "../helpers/mock-extension-api.js";

afterEach(() => {
  resetBundleConfigForTests();
});

describe("whimsical extension", () => {
  test("registers handlers when enabled", () => {
    const { pi, handlers } = createMockExtensionAPI();

    whimsicalExtension(pi);

    expect(handlers.get("turn_start")?.length).toBe(1);
    expect(handlers.get("turn_end")?.length).toBe(1);
  });

  test("skips registration when headless is enabled", () => {
    const { pi, handlers } = createMockExtensionAPI();
    setBundleConfigForTests({
      featureFlags: {
        headless: true,
      },
      extensions: {
        whimsical: { enabled: true },
      },
    });

    whimsicalExtension(pi);

    expect([...handlers.keys()]).toEqual([]);
  });
});
