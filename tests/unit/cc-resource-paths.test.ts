import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ccResourcePathsExtension from "../../extensions/cc-like/cc-resource-paths.js";
import {
  resetBundleConfigForTests,
  setBundleConfigForTests,
} from "../../extensions/infra/lib/bundle-config.js";
import { createMockExtensionAPI } from "../helpers/mock-extension-api.js";

const tempDirs: string[] = [];
const originalArgv = [...process.argv];

async function makeTempDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cc-resource-paths-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  resetBundleConfigForTests();
  process.argv = [...originalArgv];

  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) continue;
    await rm(dir, { recursive: true, force: true });
  }
});

describe("cc-resource-paths extension", () => {
  const originalClaudeProjectDir = process.env.CLAUDE_PROJECT_DIR;

  afterEach(() => {
    if (originalClaudeProjectDir === undefined) delete process.env.CLAUDE_PROJECT_DIR;
    else process.env.CLAUDE_PROJECT_DIR = originalClaudeProjectDir;
  });

  test("registers a resources_discover handler when enabled", () => {
    const { pi, handlers } = createMockExtensionAPI();

    ccResourcePathsExtension(pi);

    expect(handlers.get("resources_discover")?.length).toBe(1);
  });

  test("returns both promptPaths and skillPaths", async () => {
    const root = await makeTempDir();
    const project = path.join(root, "project");
    const nested = path.join(project, "packages", "feature");
    await mkdir(path.join(project, ".claude", "commands"), { recursive: true });
    await mkdir(path.join(project, ".claude", "skills"), { recursive: true });
    await mkdir(nested, { recursive: true });

    const { pi, handlers } = createMockExtensionAPI();
    ccResourcePathsExtension(pi);

    const handler = handlers.get("resources_discover")?.[0];
    const result = await handler?.({ cwd: nested });

    expect(result).toEqual({
      promptPaths: expect.arrayContaining([path.join(project, ".claude", "commands")]),
      skillPaths: expect.arrayContaining([path.join(project, ".claude", "skills")]),
    });
  });

  test("respects per-part enablement inside the combined extension", async () => {
    const root = await makeTempDir();
    const project = path.join(root, "project");
    await mkdir(path.join(project, ".claude", "commands"), { recursive: true });
    await mkdir(path.join(project, ".claude", "skills"), { recursive: true });

    setBundleConfigForTests({
      extensions: {
        "cc-command-paths": { enabled: false },
        "cc-skill-paths": { enabled: true },
      },
    });

    const { pi, handlers } = createMockExtensionAPI();
    ccResourcePathsExtension(pi);

    const handler = handlers.get("resources_discover")?.[0];
    const result = await handler?.({ cwd: project });

    expect(result).toEqual({
      skillPaths: expect.arrayContaining([path.join(project, ".claude", "skills")]),
    });
    expect(result?.promptPaths).toBeUndefined();
  });

  test("suppresses skillPaths under --no-skills while keeping command paths", async () => {
    const root = await makeTempDir();
    const project = path.join(root, "project");
    await mkdir(path.join(project, ".claude", "commands"), { recursive: true });
    await mkdir(path.join(project, ".claude", "skills"), { recursive: true });
    process.argv = [process.argv[0] ?? "node", process.argv[1] ?? "test", "--no-skills"];

    const { pi, handlers } = createMockExtensionAPI();
    ccResourcePathsExtension(pi);

    const handler = handlers.get("resources_discover")?.[0];
    const result = await handler?.({ cwd: project });

    expect(result).toEqual({
      promptPaths: expect.arrayContaining([path.join(project, ".claude", "commands")]),
    });
    expect(result?.skillPaths).toBeUndefined();
  });

  test("respects global and project source knobs independently", async () => {
    const root = await makeTempDir();
    const project = path.join(root, "project");
    const nested = path.join(project, "packages", "feature");
    await mkdir(path.join(project, ".claude", "commands"), { recursive: true });
    await mkdir(path.join(project, ".claude", "skills"), { recursive: true });
    await mkdir(path.join(nested, ".claude", "commands"), { recursive: true });
    await mkdir(path.join(nested, ".claude", "skills"), { recursive: true });

    setBundleConfigForTests({
      extensions: {
        "cc-resource-paths": {
          enabled: true,
          config: {
            commands: { global: true, project: false },
            skills: { global: false, project: true },
          },
        },
      },
    });

    const { pi, handlers } = createMockExtensionAPI();
    ccResourcePathsExtension(pi);

    const handler = handlers.get("resources_discover")?.[0];
    const result = await handler?.({ cwd: nested });

    expect(result?.promptPaths).toEqual(
      expect.arrayContaining([path.join(project, ".claude", "commands")]),
    );
    expect(result?.promptPaths).not.toContain(path.join(nested, ".claude", "commands"));
    expect(result?.skillPaths).toEqual([path.join(nested, ".claude", "skills")]);
  });

  test("suppresses Claude commands in headless mode by default", async () => {
    const root = await makeTempDir();
    const project = path.join(root, "project");
    await mkdir(path.join(project, ".claude", "commands"), { recursive: true });
    await mkdir(path.join(project, ".claude", "skills"), { recursive: true });

    setBundleConfigForTests({
      featureFlags: {
        headless: true,
      },
      extensions: {
        "cc-resource-paths": {
          enabled: true,
          config: {
            skills: { global: false, project: true },
          },
        },
      },
    });

    const { pi, handlers } = createMockExtensionAPI();
    ccResourcePathsExtension(pi);

    const handler = handlers.get("resources_discover")?.[0];
    const result = await handler?.({ cwd: project });

    expect(result).toEqual({
      skillPaths: [path.join(project, ".claude", "skills")],
    });
    expect(result?.promptPaths).toBeUndefined();
  });

  test("allows Claude commands in headless mode when opted in", async () => {
    const root = await makeTempDir();
    const project = path.join(root, "project");
    await mkdir(path.join(project, ".claude", "commands"), { recursive: true });
    await mkdir(path.join(project, ".claude", "skills"), { recursive: true });

    setBundleConfigForTests({
      featureFlags: {
        headless: true,
      },
      extensions: {
        "cc-resource-paths": {
          enabled: true,
          config: {
            commands: { global: false, project: true, loadInHeadless: true },
            skills: { global: false, project: true },
          },
        },
      },
    });

    const { pi, handlers } = createMockExtensionAPI();
    ccResourcePathsExtension(pi);

    const handler = handlers.get("resources_discover")?.[0];
    const result = await handler?.({ cwd: project });

    expect(result).toEqual({
      promptPaths: [path.join(project, ".claude", "commands")],
      skillPaths: [path.join(project, ".claude", "skills")],
    });
  });

  test("discovers Claude command and skill paths from CLAUDE_PROJECT_DIR instead of cwd", async () => {
    const root = await makeTempDir();
    const project = path.join(root, "project");
    const sandbox = path.join(root, "sandbox", "run");
    await mkdir(path.join(project, ".claude", "commands"), { recursive: true });
    await mkdir(path.join(project, ".claude", "skills"), { recursive: true });
    await mkdir(sandbox, { recursive: true });
    process.env.CLAUDE_PROJECT_DIR = project;

    const { pi, handlers } = createMockExtensionAPI();
    ccResourcePathsExtension(pi);

    const handler = handlers.get("resources_discover")?.[0];
    const result = await handler?.({ cwd: sandbox });

    expect(result?.promptPaths).toEqual(
      expect.arrayContaining([path.join(project, ".claude", "commands")]),
    );
    expect(result?.skillPaths).toEqual(
      expect.arrayContaining([path.join(project, ".claude", "skills")]),
    );
  });

  test("skips registration when disabled via bundle config", () => {
    const { pi, handlers } = createMockExtensionAPI();
    setBundleConfigForTests({
      extensions: {
        "cc-resource-paths": { enabled: false },
      },
    });

    ccResourcePathsExtension(pi);

    expect([...handlers.keys()]).toEqual([]);
  });

  test("skips registration when the ccLike feature flag is disabled", () => {
    const { pi, handlers } = createMockExtensionAPI();
    setBundleConfigForTests({
      featureFlags: {
        ccLike: false,
      },
      extensions: {
        "cc-resource-paths": { enabled: true },
      },
    });

    ccResourcePathsExtension(pi);

    expect([...handlers.keys()]).toEqual([]);
  });
});
