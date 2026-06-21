import { afterEach, describe, expect, test } from "bun:test";
import {
  getExtConfig,
  resetBundleConfigForTests,
  setBundleConfigForTests,
} from "../../extensions/infra/lib/bundle-config.js";
import { defineManagedExtension } from "../../extensions/infra/lib/managed-extension.js";
import { createMockExtensionAPI } from "../helpers/mock-extension-api.js";

afterEach(() => {
  resetBundleConfigForTests();
});

describe("managed extension config getter", () => {
  test("passes a live config getter into setup", async () => {
    const seen: string[] = [];
    const extension = defineManagedExtension({
      name: "demo",
      getConfig: () => ({
        value: getExtConfig<{ value?: string }>("demo")?.value ?? "default",
      }),
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
