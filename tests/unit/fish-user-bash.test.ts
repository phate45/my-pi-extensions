import { afterEach, describe, expect, test } from "bun:test";
import fishUserBashExtension from "../../extensions/my-stuff/fish-user-bash.js";
import { resetBundleConfigForTests, setBundleConfigForTests } from "../../extensions/infra/lib/bundle-config.js";
import { createMockExtensionAPI } from "../helpers/mock-extension-api.js";

afterEach(() => {
  resetBundleConfigForTests();
});

describe("fish-user-bash extension", () => {
  test("registers handlers when enabled", () => {
    const { pi, handlers } = createMockExtensionAPI();

    fishUserBashExtension(pi);

    expect(handlers.get("user_bash")?.length).toBe(1);
  });

  test("skips registration when disabled in bundle config", () => {
    const { pi, handlers } = createMockExtensionAPI();
    setBundleConfigForTests({
      extensions: {
        "fish-user-bash": { enabled: false },
      },
    });

    fishUserBashExtension(pi);

    expect([...handlers.keys()]).toEqual([]);
  });

  test("skips registration when the myStuff feature flag is disabled", () => {
    const { pi, handlers } = createMockExtensionAPI();
    setBundleConfigForTests({
      featureFlags: {
        myStuff: false,
      },
      extensions: {
        "fish-user-bash": { enabled: true },
      },
    });

    fishUserBashExtension(pi);

    expect([...handlers.keys()]).toEqual([]);
  });
});
