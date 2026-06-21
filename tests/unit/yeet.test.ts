import { afterEach, describe, expect, test } from "bun:test";
import yeetExtension from "../../extensions/my-stuff/yeet.js";
import { resetBundleConfigForTests, setBundleConfigForTests } from "../../extensions/infra/lib/bundle-config.js";
import { createMockExtensionAPI } from "../helpers/mock-extension-api.js";

afterEach(() => {
  resetBundleConfigForTests();
});

describe("yeet extension", () => {
  test("registers the command when enabled", () => {
    const { pi, commands } = createMockExtensionAPI();

    yeetExtension(pi);

    expect(commands).toEqual(["yeet"]);
  });

  test("skips registration when disabled in bundle config", () => {
    const { pi, commands } = createMockExtensionAPI();
    setBundleConfigForTests({
      extensions: {
        yeet: { enabled: false },
      },
    });

    yeetExtension(pi);

    expect(commands).toEqual([]);
  });

  test("skips registration when the myStuff feature flag is disabled", () => {
    const { pi, commands } = createMockExtensionAPI();
    setBundleConfigForTests({
      featureFlags: {
        myStuff: false,
      },
      extensions: {
        yeet: { enabled: true },
      },
    });

    yeetExtension(pi);

    expect(commands).toEqual([]);
  });
});
