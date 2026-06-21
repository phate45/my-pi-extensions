import { afterEach, describe, expect, test } from "bun:test";
import tpsTrackerExtension from "../../extensions/my-stuff/tps-tracker.js";
import { resetBundleConfigForTests, setBundleConfigForTests } from "../../extensions/infra/lib/bundle-config.js";
import { createMockExtensionAPI } from "../helpers/mock-extension-api.js";

afterEach(() => {
  resetBundleConfigForTests();
});

describe("tps-tracker extension", () => {
  test("registers handlers when enabled", () => {
    const { pi, handlers } = createMockExtensionAPI();

    tpsTrackerExtension(pi);

    expect(handlers.get("agent_start")?.length).toBe(1);
    expect(handlers.get("message_start")?.length).toBe(1);
    expect(handlers.get("message_update")?.length).toBe(1);
    expect(handlers.get("message_end")?.length).toBe(1);
    expect(handlers.get("agent_end")?.length).toBe(1);
  });

  test("skips registration when disabled in bundle config", () => {
    const { pi, handlers } = createMockExtensionAPI();
    setBundleConfigForTests({
      extensions: {
        "tps-tracker": { enabled: false },
      },
    });

    tpsTrackerExtension(pi);

    expect([...handlers.keys()]).toEqual([]);
  });

  test("skips registration when the myStuff feature flag is disabled", () => {
    const { pi, handlers } = createMockExtensionAPI();
    setBundleConfigForTests({
      featureFlags: {
        myStuff: false,
      },
      extensions: {
        "tps-tracker": { enabled: true },
      },
    });

    tpsTrackerExtension(pi);

    expect([...handlers.keys()]).toEqual([]);
  });

  test("skips registration when headless is enabled", () => {
    const { pi, handlers } = createMockExtensionAPI();
    setBundleConfigForTests({
      featureFlags: {
        headless: true,
      },
      extensions: {
        "tps-tracker": { enabled: true },
      },
    });

    tpsTrackerExtension(pi);

    expect([...handlers.keys()]).toEqual([]);
  });
});
