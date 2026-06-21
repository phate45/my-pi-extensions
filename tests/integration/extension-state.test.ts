import { afterEach, describe, expect, test } from "bun:test";
import path from "node:path";
import { createTempPiEnv, writeJson, type TempPiEnv } from "../helpers/temp-env.js";
import { buildAgentSettings, runPiAndCaptureState } from "../helpers/run-pi.js";

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
    expect(loadedPaths.some((entry) => entry.includes("extensions/cc-like/custom-header.ts"))).toBe(
      true,
    );
    expect(loadedPaths.some((entry) => entry.includes("extensions/my-stuff/web-research.ts"))).toBe(
      true,
    );
    expect(
      loadedPaths.some((entry) => entry.includes("extensions/my-stuff/frontmatter-timestamps.ts")),
    ).toBe(true);

    expect(state.effective.extensions["git-context"]).toBe(true);
    expect(state.effective.extensions["custom-header"]).toBe(true);
    expect(state.effective.extensions["frontmatter-timestamps"]).toBe(true);
    expect(state.effective.extensions["web-research"]).toBe(true);
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

    expect(loadedPaths.some((entry) => entry.includes("extensions/cc-like/git-context.ts"))).toBe(
      true,
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
      state.loadedExtensions.some((entry) => entry.path.includes("extensions/cc-like/context.ts")),
    ).toBe(true);
    expect(state.effective.featureFlags.ccLike).toBe(false);
    expect(state.commands).not.toContain("context");
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
      state.loadedExtensions.some((entry) => entry.path.includes("extensions/cc-like/context.ts")),
    ).toBe(true);
    expect(
      state.loadedExtensions.some((entry) => entry.path.includes("extensions/my-stuff/yeet.ts")),
    ).toBe(true);
    expect(state.effective.featureFlags.headless).toBe(true);
    expect(state.commands).not.toContain("context");
    expect(state.commands).not.toContain("yeet");
  });
});
