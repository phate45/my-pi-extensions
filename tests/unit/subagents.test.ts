import { describe, expect, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerBundledSubagents } from "../../extensions/cc-like/subagents.js";
import { createMockExtensionAPI } from "../helpers/mock-extension-api.js";

describe("bundled subagents adapter", () => {
  test("registers the upstream extension and contributes its packaged resources", async () => {
    const { pi, handlers } = createMockExtensionAPI();
    let registered = false;

    registerBundledSubagents(
      pi,
      () => {
        registered = true;
      },
      "/bundle/node_modules/pi-subagents",
    );

    expect(registered).toBe(true);

    const discover = handlers.get("resources_discover")?.[0];
    expect(discover).toBeDefined();
    expect(await discover?.({ cwd: "/project", reason: "startup" }, {})).toEqual({
      skillPaths: ["/bundle/node_modules/pi-subagents/skills"],
      promptPaths: ["/bundle/node_modules/pi-subagents/prompts"],
    });
  });

  test("omits resource kinds disabled by Pi CLI policy", async () => {
    const { pi, handlers } = createMockExtensionAPI();

    registerBundledSubagents(pi, () => {}, "/bundle/node_modules/pi-subagents", {
      skills: false,
      prompts: true,
    });

    const discover = handlers.get("resources_discover")?.[0];
    expect(await discover?.({ cwd: "/project", reason: "startup" }, {})).toEqual({
      promptPaths: ["/bundle/node_modules/pi-subagents/prompts"],
    });
  });

  test("contributes nothing when both resource kinds are disabled", async () => {
    const { pi, handlers } = createMockExtensionAPI();

    registerBundledSubagents(pi, () => {}, "/bundle/node_modules/pi-subagents", {
      skills: false,
      prompts: false,
    });

    const discover = handlers.get("resources_discover")?.[0];
    expect(await discover?.({ cwd: "/project", reason: "startup" }, {})).toBeUndefined();
  });

  test("preserves an async upstream factory result", async () => {
    const { pi } = createMockExtensionAPI();
    const result = registerBundledSubagents(
      pi,
      async (_adaptedPi: ExtensionAPI) => "ready",
      "/bundle/node_modules/pi-subagents",
    );

    expect(await result).toBe("ready");
  });
});
