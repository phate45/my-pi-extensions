import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  getBundleConfigSources,
  getExtConfig,
  isBundleConfigInitialized,
  isExtensionEnabled,
  isFeatureFlagEnabled,
  isManagedExtensionEnabled,
  refreshBundleConfig,
  resetBundleConfigForTests,
  takeBundleConfigErrors,
} from "../../extensions/my-stuff/lib/bundle-config.js";

const tempDirs: string[] = [];
const originalAgentDir = process.env.PI_CODING_AGENT_DIR;

async function makeTempDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "bundle-config-test-"));
  tempDirs.push(dir);
  return dir;
}

async function writeJson(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2));
}

afterEach(async () => {
  resetBundleConfigForTests();
  process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) continue;
    await rm(dir, { recursive: true, force: true });
  }
});

describe("bundle-config", () => {
  test("loads global settings from PI_CODING_AGENT_DIR", async () => {
    const root = await makeTempDir();
    const agentDir = path.join(root, "agent");
    const projectDir = path.join(root, "project");
    process.env.PI_CODING_AGENT_DIR = agentDir;

    await writeJson(path.join(agentDir, "my-pi-settings.json"), {
      featureFlags: { experimental: false },
      extensions: {
        "git-context": { enabled: false },
      },
    });

    refreshBundleConfig({ cwd: projectDir, isProjectTrusted: false });

    expect(isBundleConfigInitialized()).toBe(true);
    expect(isFeatureFlagEnabled("experimental")).toBe(false);
    expect(isExtensionEnabled("git-context")).toBe(false);
    expect(getBundleConfigSources()).toEqual([path.join(agentDir, "my-pi-settings.json")]);
  });

  test("local trusted settings override global settings", async () => {
    const root = await makeTempDir();
    const agentDir = path.join(root, "agent");
    const projectDir = path.join(root, "project");
    process.env.PI_CODING_AGENT_DIR = agentDir;

    await writeJson(path.join(agentDir, "my-pi-settings.json"), {
      featureFlags: { experimental: false },
      extensions: {
        "web-research": {
          enabled: true,
          config: { defaultDepth: "fast", nested: { freshness: "cached" } },
        },
      },
    });

    await writeJson(path.join(projectDir, ".pi", "my-pi-settings.json"), {
      featureFlags: { experimental: true },
      extensions: {
        "web-research": {
          config: { nested: { freshness: "live" } },
        },
      },
    });

    refreshBundleConfig({ cwd: projectDir, isProjectTrusted: true });

    expect(isFeatureFlagEnabled("experimental")).toBe(true);
    expect(getExtConfig("web-research")).toEqual({
      defaultDepth: "fast",
      nested: { freshness: "live" },
    });
  });

  test("local settings are ignored when project is untrusted", async () => {
    const root = await makeTempDir();
    const agentDir = path.join(root, "agent");
    const projectDir = path.join(root, "project");
    process.env.PI_CODING_AGENT_DIR = agentDir;

    await writeJson(path.join(agentDir, "my-pi-settings.json"), {
      extensions: { "git-context": { enabled: false } },
    });
    await writeJson(path.join(projectDir, ".pi", "my-pi-settings.json"), {
      extensions: { "git-context": { enabled: true } },
    });

    refreshBundleConfig({ cwd: projectDir, isProjectTrusted: false });

    expect(isExtensionEnabled("git-context")).toBe(false);
    expect(getBundleConfigSources()).toEqual([path.join(agentDir, "my-pi-settings.json")]);
  });

  test("override file replaces autodiscovered global and local settings", async () => {
    const root = await makeTempDir();
    const agentDir = path.join(root, "agent");
    const projectDir = path.join(root, "project");
    process.env.PI_CODING_AGENT_DIR = agentDir;

    await writeJson(path.join(agentDir, "my-pi-settings.json"), {
      extensions: { "git-context": { enabled: false } },
    });
    await writeJson(path.join(projectDir, ".pi", "my-pi-settings.json"), {
      extensions: { "git-context": { enabled: true } },
    });
    await writeJson(path.join(root, "override.json"), {
      extensions: { "git-context": { enabled: false, config: { source: "override" } } },
    });

    refreshBundleConfig({
      cwd: projectDir,
      isProjectTrusted: true,
      overridePath: path.join(root, "override.json"),
    });

    expect(isExtensionEnabled("git-context")).toBe(false);
    expect(getExtConfig("git-context")).toEqual({ source: "override" });
    expect(getBundleConfigSources()).toEqual([path.join(root, "override.json")]);
  });

  test("managed extension enablement combines feature flags and per-extension switches", async () => {
    const root = await makeTempDir();
    const agentDir = path.join(root, "agent");
    const projectDir = path.join(root, "project");
    process.env.PI_CODING_AGENT_DIR = agentDir;

    await writeJson(path.join(agentDir, "my-pi-settings.json"), {
      featureFlags: { ccLike: false, myStuff: true },
      extensions: {
        "custom-header": { enabled: true },
        "web-research": { enabled: false },
      },
    });

    refreshBundleConfig({ cwd: projectDir, isProjectTrusted: false });

    expect(isManagedExtensionEnabled("custom-header", "ccLike")).toBe(false);
    expect(isManagedExtensionEnabled("web-research", "myStuff")).toBe(false);
    expect(isManagedExtensionEnabled("fish-user-bash", "myStuff")).toBe(true);
  });

  test("reports invalid JSON as a non-fatal load error", async () => {
    const root = await makeTempDir();
    const agentDir = path.join(root, "agent");
    const projectDir = path.join(root, "project");
    process.env.PI_CODING_AGENT_DIR = agentDir;

    await mkdir(agentDir, { recursive: true });
    await writeFile(path.join(agentDir, "my-pi-settings.json"), "not json\n");

    refreshBundleConfig({ cwd: projectDir, isProjectTrusted: false });

    const errors = takeBundleConfigErrors();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("Failed to load");
    expect(getBundleConfigSources()).toEqual([]);
  });
});
