import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  discoverConfiguredClaudeContextFiles,
  discoverEffectiveContextFiles,
} from "../../extensions/cc-like/lib/cc-context.js";
import { resetProjectRootCacheForTests } from "../../extensions/cc-like/lib/git-project-root.js";
import {
  resetBundleConfigForTests,
  setBundleConfigForTests,
} from "../../extensions/infra/lib/bundle-config.js";

const tempDirs: string[] = [];

async function makeTempDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cc-context-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  resetBundleConfigForTests();
  resetProjectRootCacheForTests();

  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) continue;
    await rm(dir, { recursive: true, force: true });
  }
});

describe("cc context discovery", () => {
  test("selects only the configured Claude files", async () => {
    const root = await makeTempDir();
    const agentDir = path.join(root, "agent");
    const project = path.join(root, "project");
    await mkdir(agentDir, { recursive: true });
    await mkdir(project, { recursive: true });
    await writeFile(path.join(agentDir, "CLAUDE.md"), "global");
    await writeFile(path.join(project, "CLAUDE.md"), "project");
    await writeFile(path.join(project, "CLAUDE.local.md"), "local");

    const files = discoverConfiguredClaudeContextFiles(
      project,
      { global: true, project: false, local: true },
      agentDir,
    );

    expect(files.map((file) => path.basename(file.path))).toEqual(["CLAUDE.md", "CLAUDE.local.md"]);
    expect(files.map((file) => file.content)).toEqual(["global", "local"]);
  });

  test("effective context keeps AGENTS while replacing Claude discovery with config", async () => {
    const root = await makeTempDir();
    const agentDir = path.join(root, "agent");
    const project = path.join(root, "project");
    await mkdir(agentDir, { recursive: true });
    await mkdir(project, { recursive: true });
    await writeFile(path.join(project, "AGENTS.md"), "agents");
    await writeFile(path.join(root, "CLAUDE.md"), "ancestor claude");
    await writeFile(path.join(project, "CLAUDE.md"), "project claude");
    await writeFile(path.join(project, "CLAUDE.local.md"), "local claude");

    setBundleConfigForTests({
      extensions: {
        "cc-context-local-files": {
          enabled: true,
          config: {
            claudeFiles: {
              global: false,
              project: true,
              local: false,
            },
          },
        },
      },
    });

    const files = discoverEffectiveContextFiles(project, agentDir);

    expect(files.map((file) => path.relative(root, file.path))).toEqual([
      path.join("project", "AGENTS.md"),
      path.join("project", "CLAUDE.md"),
    ]);
  });

  test("configured Claude files resolve against the git project root", async () => {
    const root = await makeTempDir();
    const project = path.join(root, "project");
    const nested = path.join(project, "src", "package");
    await mkdir(nested, { recursive: true });
    execFileSync("git", ["init", project], { stdio: "ignore" });
    await writeFile(path.join(project, "CLAUDE.md"), "project claude");
    await writeFile(path.join(project, "CLAUDE.local.md"), "local claude");

    const files = discoverConfiguredClaudeContextFiles(
      nested,
      { global: false, project: true, local: true },
      path.join(root, "agent"),
    );

    expect(files.map((file) => path.relative(root, file.path))).toEqual([
      path.join("project", "CLAUDE.md"),
      path.join("project", "CLAUDE.local.md"),
    ]);
  });
});
