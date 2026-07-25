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
