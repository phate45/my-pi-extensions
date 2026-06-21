import { afterEach, describe, expect, test } from "bun:test";
import tpsTrackerExtension from "../../extensions/my-stuff/tps-tracker.js";
import {
  resetBundleConfigForTests,
  setBundleConfigForTests,
} from "../../extensions/infra/lib/bundle-config.js";
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

  test("includes a completion timestamp in the agent_end notification", async () => {
    const { pi, handlers } = createMockExtensionAPI();
    tpsTrackerExtension(pi);

    const notifyCalls: Array<{ message: string; level: string }> = [];
    const statusCalls: Array<{ key: string; message: string }> = [];
    const theme = { fg: (_tone: string, text: string) => text };
    const originalDateNow = Date.now;
    Date.now = () => Date.UTC(2026, 5, 21, 12, 34, 56);

    try {
      const handler = handlers.get("agent_end")?.[0];
      await handler?.(
        {},
        {
          hasUI: true,
          ui: {
            theme,
            notify(message: string, level: string) {
              notifyCalls.push({ message, level });
            },
            setStatus(key: string, message: string) {
              statusCalls.push({ key, message });
            },
          },
        },
      );
    } finally {
      Date.now = originalDateNow;
    }

    expect(notifyCalls).toEqual([
      {
        message: "✓ N/A  0 tokens in 0.0s streaming  [2026-06-21 12:34:56]",
        level: "info",
      },
    ]);
    expect(statusCalls).toEqual([{ key: "tps", message: "done — N/A" }]);
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
