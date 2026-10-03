import { afterEach, describe, expect, test } from "bun:test";
import {
  resetBundleConfigForTests,
  setBundleConfigForTests,
} from "../../extensions/infra/lib/bundle-config.js";
import { defineExtensionConfig } from "../../extensions/infra/lib/extension-config.js";
import {
  composeManagedExtensions,
  defineManagedExtension,
  getManagedExtensionDescriptor,
  getManagedExtensionDescriptors,
} from "../../extensions/infra/lib/managed-extension.js";
import { createMockExtensionAPI } from "../helpers/mock-extension-api.js";

afterEach(() => {
  resetBundleConfigForTests();
});

describe("managed extension config getter", () => {
  test("exposes the managed extension descriptor for inspection", () => {
    const demoConfig = defineExtensionConfig({
      defaults: { value: "default" },
      normalize(raw: Record<string, unknown> | undefined, defaults: { value: string }) {
        return {
          value: typeof raw?.value === "string" ? raw.value : defaults.value,
        };
      },
    });

    const extension = defineManagedExtension({
      name: "demo",
      featureFlag: "myStuff",
      config: demoConfig,
      setup() {},
    });

    expect(getManagedExtensionDescriptor(extension)).toEqual({
      name: "demo",
      featureFlag: "myStuff",
      config: demoConfig,
    });
  });

  test("composes managed extensions in declared order and exposes every descriptor", async () => {
    const setupOrder: string[] = [];
    const first = defineManagedExtension({
      name: "first",
      setup() {
        setupOrder.push("first");
      },
    });
    const second = defineManagedExtension({
      name: "second",
      setup() {
        setupOrder.push("second");
      },
    });

    const extension = composeManagedExtensions([first, second]);
    const { pi } = createMockExtensionAPI();
    await extension(pi);

    expect(setupOrder).toEqual(["first", "second"]);
    expect(getManagedExtensionDescriptors(extension).map((descriptor) => descriptor.name)).toEqual([
      "first",
      "second",
    ]);
  });

  test("startup setup waits for final enablement and replays async startup handlers once", async () => {
    setBundleConfigForTests({ extensions: { demo: { enabled: false } } });
    const seen: string[] = [];
    const extension = defineManagedExtension({
      name: "demo",
      setupOnSessionStart: true,
      async setup(pi) {
        seen.push("setup");
        await Promise.resolve();
        const stop = pi.on("session_start", () => {
          seen.push("removed");
        });
        stop();
        pi.on("session_start", (event) => {
          seen.push(event.reason);
        });
        pi.on("resources_discover", () => ({ skillPaths: ["/skills"] }));
      },
    });
    const { pi, handlers } = createMockExtensionAPI();
    await extension(pi);
    expect(seen).toEqual([]);
    setBundleConfigForTests({ extensions: { demo: { enabled: true } } });
    const dispatch = async (reason: string) => {
      for (const handler of [...(handlers.get("session_start") ?? [])]) {
        await handler({ type: "session_start", reason }, {});
      }
    };
    await dispatch("startup");
    expect(seen).toEqual(["setup", "startup"]);
    expect(await handlers.get("resources_discover")?.[0]?.({}, {})).toEqual({
      skillPaths: ["/skills"],
    });
    await dispatch("resume");
    expect(seen).toEqual(["setup", "startup", "resume"]);
  });

  test("replays remaining startup handlers after a handler fails", async () => {
    setBundleConfigForTests({});
    const seen: string[] = [];
    const extension = defineManagedExtension({
      name: "demo",
      setupOnSessionStart: true,
      setup(pi) {
        pi.on("session_start", () => {
          throw new Error("startup failed");
        });
        pi.on("session_start", () => {
          seen.push("continued");
        });
      },
    });
    const { pi, handlers } = createMockExtensionAPI();
    await extension(pi);
    await expect(handlers.get("session_start")?.[0]?.({}, {})).rejects.toThrow(
      "demo startup handlers failed",
    );
    expect(seen).toEqual(["continued"]);
  });

  test("startup setup suppresses a factory-time enabled extension", async () => {
    setBundleConfigForTests({ extensions: { demo: { enabled: true } } });
    let registered = false;
    const extension = defineManagedExtension({
      name: "demo",
      setupOnSessionStart: true,
      setup() {
        registered = true;
      },
    });
    const { pi, handlers } = createMockExtensionAPI();
    await extension(pi);
    setBundleConfigForTests({ extensions: { demo: { enabled: false } } });
    await handlers.get("session_start")?.[0]?.({}, {});
    expect(registered).toBe(false);
  });

  test("passes a live config getter into setup", async () => {
    const seen: string[] = [];
    const demoConfig = defineExtensionConfig({
      defaults: { value: "default" },
      normalize(raw: Record<string, unknown> | undefined, defaults: { value: string }) {
        return {
          value: typeof raw?.value === "string" ? raw.value : defaults.value,
        };
      },
    });

    const extension = defineManagedExtension({
      name: "demo",
      config: demoConfig,
      setup(pi, getConfig) {
        pi.on("session_start", async () => {
          seen.push(getConfig().value);
        });
      },
    });

    const { pi, handlers } = createMockExtensionAPI();
    extension(pi);

    setBundleConfigForTests({
      extensions: {
        demo: {
          config: {
            value: "trusted-local",
          },
        },
      },
    });

    const handler = handlers.get("session_start")?.[0];
    await handler?.({}, {});

    expect(seen).toEqual(["trusted-local"]);
  });
});
