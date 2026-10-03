import { afterEach, describe, expect, test } from "bun:test";
import path from "node:path";
import { buildAgentSettings, runPiAndCaptureState } from "../helpers/run-pi.js";
import { createTempPiEnv, type TempPiEnv, writeJson } from "../helpers/temp-env.js";

const tempEnvs: TempPiEnv[] = [];

async function setupEnv() {
  const env = await createTempPiEnv();
  tempEnvs.push(env);
  await writeJson(path.join(env.agentDir, "settings.json"), buildAgentSettings());
  return env;
}

afterEach(async () => {
  while (tempEnvs.length > 0) {
    const env = tempEnvs.pop();
    if (!env) continue;
    await env.cleanup();
  }
});

describe("extension state integration", () => {
  test("baseline: package extensions load and default to enabled", async () => {
    const env = await setupEnv();

    const state = await runPiAndCaptureState({ env });
    const loadedPaths = state.loadedExtensions.map((entry) => entry.path);

    expect(
      loadedPaths.some((entry) => entry.includes("extensions/infra/00-bundle-config.ts")),
    ).toBe(true);
    expect(loadedPaths.some((entry) => entry.includes("extensions/cc-like/index.ts"))).toBe(true);
    expect(state.loadedExtensions).toContainEqual(
      expect.objectContaining({ path: "builtin:llama.cpp", hidden: true }),
    );
    expect(loadedPaths.some((entry) => entry.includes("extensions/cc-like/custom-header.ts"))).toBe(
      false,
    );
    expect(loadedPaths.some((entry) => entry.includes("extensions/my-stuff/web-research.ts"))).toBe(
      true,
    );
    expect(
      loadedPaths.some((entry) => entry.includes("extensions/my-stuff/frontmatter-timestamps.ts")),
    ).toBe(true);

    expect(state.tools).toContain("subagents_enable");
    expect(state.tools).toContain("bg_wait");
    expect(state.tools).not.toContain("subagent_wait");

    expect(state.effective.extensions["git-context"]).toBe(true);
    expect(state.effective.extensions["claude-rules"]).toBe(true);
    expect(state.effective.extensions["custom-header"]).toBe(true);
    expect(state.effective.extensions["frontmatter-timestamps"]).toBe(true);
    expect(state.effective.extensions["web-research"]).toBe(true);
    expect(state.effective.extensions["ask-user"]).toBe(true);
    expect(state.errors).toEqual([]);
  });

  test("global config disables an extension without changing the loaded extension list", async () => {
    const env = await setupEnv();
    await writeJson(path.join(env.agentDir, "my-pi-settings.json"), {
      extensions: {
        "git-context": { enabled: false },
      },
    });

    const state = await runPiAndCaptureState({ env });
    const loadedPaths = state.loadedExtensions.map((entry) => entry.path);

    expect(loadedPaths.some((entry) => entry.includes("extensions/cc-like/index.ts"))).toBe(true);
    expect(loadedPaths.some((entry) => entry.includes("extensions/cc-like/git-context.ts"))).toBe(
      false,
    );
    expect(state.effective.extensions["git-context"]).toBe(false);
    expect(state.configSources).toEqual([path.join(env.agentDir, "my-pi-settings.json")]);
  });

  test("trusted local config overrides global config", async () => {
    const env = await setupEnv();
    await writeJson(path.join(env.agentDir, "my-pi-settings.json"), {
      extensions: {
        "git-context": { enabled: false },
      },
    });
    await writeJson(path.join(env.projectDir, ".pi", "my-pi-settings.json"), {
      extensions: {
        "git-context": { enabled: true },
      },
    });

    const state = await runPiAndCaptureState({ env, approve: true });

    expect(state.effective.extensions["git-context"]).toBe(true);
    expect(state.configSources).toEqual([
      path.join(env.agentDir, "my-pi-settings.json"),
      path.join(env.projectDir, ".pi", "my-pi-settings.json"),
    ]);
  });

  test.each([
    { global: false, local: true, trusted: true, expected: true },
    { global: true, local: false, trusted: true, expected: false },
    { global: false, local: true, trusted: false, expected: false },
    { global: true, local: false, trusted: false, expected: true },
  ])("trust-aware tools honor $global/$local with trust=$trusted", async (settings) => {
    const env = await setupEnv();
    const config = (enabled: boolean) => ({
      extensions: { subagents: { enabled }, "multi-edit": { enabled } },
    });
    await writeJson(path.join(env.agentDir, "my-pi-settings.json"), config(settings.global));
    await writeJson(
      path.join(env.projectDir, ".pi", "my-pi-settings.json"),
      config(settings.local),
    );

    const state = await runPiAndCaptureState({ env, approve: settings.trusted });

    expect(state.tools.includes("subagents_enable")).toBe(settings.expected);
    expect(state.toolDescriptions.edit?.includes("multi")).toBe(settings.expected);
    expect(state.configSources).toEqual([
      path.join(env.agentDir, "my-pi-settings.json"),
      ...(settings.trusted ? [path.join(env.projectDir, ".pi", "my-pi-settings.json")] : []),
    ]);
    expect(state.errors).toEqual([]);
  });

  test.each([false, true])("trust-aware tools honor explicit replacement=%s", async (enabled) => {
    const env = await setupEnv();
    const config = (value: boolean) => ({
      extensions: { subagents: { enabled: value }, "multi-edit": { enabled: value } },
    });
    await writeJson(path.join(env.agentDir, "my-pi-settings.json"), config(!enabled));
    await writeJson(path.join(env.projectDir, ".pi", "my-pi-settings.json"), config(!enabled));
    const overridePath = path.join(env.rootDir, "override.json");
    await writeJson(overridePath, config(enabled));

    const state = await runPiAndCaptureState({
      env,
      approve: true,
      overrideSettingsPath: overridePath,
    });

    expect(state.tools.includes("subagents_enable")).toBe(enabled);
    expect(state.toolDescriptions.edit?.includes("multi")).toBe(enabled);
    expect(state.configSources).toEqual([overridePath]);
    expect(state.errors).toEqual([]);
  });

  test("cli override replaces global and local autodiscovery", async () => {
    const env = await setupEnv();
    const overridePath = path.join(env.rootDir, "override.json");

    await writeJson(path.join(env.agentDir, "my-pi-settings.json"), {
      extensions: {
        "git-context": { enabled: true },
      },
    });
    await writeJson(path.join(env.projectDir, ".pi", "my-pi-settings.json"), {
      extensions: {
        "git-context": { enabled: true },
      },
    });
    await writeJson(overridePath, {
      extensions: {
        "git-context": { enabled: false },
      },
    });

    const state = await runPiAndCaptureState({
      env,
      approve: true,
      overrideSettingsPath: overridePath,
    });

    expect(state.effective.extensions["git-context"]).toBe(false);
    expect(state.configSources).toEqual([overridePath]);
  });

  test("untrusted project ignores local config", async () => {
    const env = await setupEnv();
    await writeJson(path.join(env.agentDir, "my-pi-settings.json"), {
      extensions: {
        "git-context": { enabled: false },
      },
    });
    await writeJson(path.join(env.projectDir, ".pi", "my-pi-settings.json"), {
      extensions: {
        "git-context": { enabled: true },
      },
    });

    const state = await runPiAndCaptureState({ env, approve: false });

    expect(state.effective.extensions["git-context"]).toBe(false);
    expect(state.configSources).toEqual([path.join(env.agentDir, "my-pi-settings.json")]);
  });

  test("ccLike feature flag disables cc-like commands while keeping extensions loaded", async () => {
    const env = await setupEnv();
    await writeJson(path.join(env.agentDir, "my-pi-settings.json"), {
      featureFlags: {
        ccLike: false,
      },
    });

    const state = await runPiAndCaptureState({ env });

    expect(
      state.loadedExtensions.some((entry) => entry.path.includes("extensions/cc-like/index.ts")),
    ).toBe(true);
    expect(state.effective.featureFlags.ccLike).toBe(false);
    expect(state.commands).not.toContain("context");
    expect(state.tools).not.toContain("subagents_enable");
  });

  test("myStuff feature flag disables my-stuff tools while keeping extensions loaded", async () => {
    const env = await setupEnv();
    await writeJson(path.join(env.agentDir, "my-pi-settings.json"), {
      featureFlags: {
        myStuff: false,
      },
    });

    const state = await runPiAndCaptureState({ env });

    expect(
      state.loadedExtensions.some((entry) =>
        entry.path.includes("extensions/my-stuff/web-research.ts"),
      ),
    ).toBe(true);
    expect(state.effective.featureFlags.myStuff).toBe(false);
    expect(state.tools).not.toContain("web_research");
    expect(state.toolDescriptions.edit?.includes("multi")).toBe(false);
  });

  test("headless feature flag disables user-facing fluff while keeping extensions loaded", async () => {
    const env = await setupEnv();
    await writeJson(path.join(env.agentDir, "my-pi-settings.json"), {
      featureFlags: {
        headless: true,
      },
    });

    const state = await runPiAndCaptureState({ env });

    expect(
      state.loadedExtensions.some((entry) => entry.path.includes("extensions/cc-like/index.ts")),
    ).toBe(true);
    expect(
      state.loadedExtensions.some((entry) => entry.path.includes("extensions/my-stuff/yeet.ts")),
    ).toBe(true);
    expect(state.effective.featureFlags.headless).toBe(true);
    expect(state.commands).not.toContain("context");
    expect(state.commands).not.toContain("yeet");
    expect(state.tools).not.toContain("ask_user");
  });
});
