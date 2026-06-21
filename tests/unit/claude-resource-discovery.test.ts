import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { discoverClaudeResourceDirs } from "../../extensions/cc-like/lib/claude-resource-discovery.js";
import { resetProjectRootCacheForTests } from "../../extensions/cc-like/lib/git-project-root.js";

const tempDirs: string[] = [];

async function makeTempDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "claude-resource-discovery-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  resetProjectRootCacheForTests();

  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) continue;
    await rm(dir, { recursive: true, force: true });
  }
});

describe("claude resource discovery", () => {
  const originalClaudeProjectDir = process.env.CLAUDE_PROJECT_DIR;

  afterEach(() => {
    if (originalClaudeProjectDir === undefined) delete process.env.CLAUDE_PROJECT_DIR;
    else process.env.CLAUDE_PROJECT_DIR = originalClaudeProjectDir;
  });

  test("collects ancestor .claude resource dirs from leaf to root", async () => {
    const root = await makeTempDir();
    const project = path.join(root, "project");
    const nested = path.join(project, "packages", "feature");
    await mkdir(path.join(project, ".claude", "commands"), { recursive: true });
    await mkdir(path.join(root, ".claude", "commands"), { recursive: true });
    await mkdir(nested, { recursive: true });

    const dirs = discoverClaudeResourceDirs(nested, "commands");

    expect(dirs.slice(0, 2)).toEqual([
      path.join(project, ".claude", "commands"),
      path.join(root, ".claude", "commands"),
    ]);
  });

  test("project-only discovery stays on cwd", async () => {
    const root = await makeTempDir();
    const project = path.join(root, "project");
    const nested = path.join(project, "packages", "feature");
    await mkdir(path.join(nested, ".claude", "commands"), { recursive: true });
    await mkdir(path.join(project, ".claude", "commands"), { recursive: true });

    const dirs = discoverClaudeResourceDirs(nested, "commands", {
      includeProject: true,
      includeGlobal: false,
    });

    expect(dirs).toEqual([path.join(nested, ".claude", "commands")]);
  });

  test("global-only discovery walks ancestors without re-adding cwd", async () => {
    const root = await makeTempDir();
    const project = path.join(root, "project");
    const nested = path.join(project, "packages", "feature");
    await mkdir(path.join(nested, ".claude", "commands"), { recursive: true });
    await mkdir(path.join(project, ".claude", "commands"), { recursive: true });
    await mkdir(path.join(root, ".claude", "commands"), { recursive: true });

    const dirs = discoverClaudeResourceDirs(nested, "commands", {
      includeProject: false,
      includeGlobal: true,
    });

    expect(dirs.slice(0, 2)).toEqual([
      path.join(project, ".claude", "commands"),
      path.join(root, ".claude", "commands"),
    ]);
    expect(dirs).not.toContain(path.join(nested, ".claude", "commands"));
  });

  test("project discovery resolves to git root when launched from a subdirectory", async () => {
    const root = await makeTempDir();
    const project = path.join(root, "project");
    const nested = path.join(project, "src", "package");
    await mkdir(path.join(project, ".claude", "commands"), { recursive: true });
    await mkdir(nested, { recursive: true });
    execFileSync("git", ["init", project], { stdio: "ignore" });

    const dirs = discoverClaudeResourceDirs(nested, "commands", {
      includeProject: true,
      includeGlobal: false,
    });

    expect(dirs).toEqual([path.join(project, ".claude", "commands")]);
  });

  test("project discovery resolves to worktree root inside a git worktree", async () => {
    const root = await makeTempDir();
    const project = path.join(root, "project");
    const worktree = path.join(root, "feat-worktree");
    await mkdir(project, { recursive: true });
    execFileSync("git", ["init", project], { stdio: "ignore" });
    execFileSync("git", ["-C", project, "config", "user.name", "Test User"], { stdio: "ignore" });
    execFileSync("git", ["-C", project, "config", "user.email", "test@example.com"], {
      stdio: "ignore",
    });
    await mkdir(path.join(project, "src"), { recursive: true });
    await Bun.write(path.join(project, "src", "README.md"), "hello\n");
    execFileSync("git", ["-C", project, "add", "."], { stdio: "ignore" });
    execFileSync("git", ["-C", project, "commit", "-m", "init"], { stdio: "ignore" });
    execFileSync("git", ["-C", project, "worktree", "add", "-b", "feat", worktree], {
      stdio: "ignore",
    });
    await mkdir(path.join(worktree, ".claude", "commands"), { recursive: true });
    await mkdir(path.join(worktree, "src", "package"), { recursive: true });

    const dirs = discoverClaudeResourceDirs(path.join(worktree, "src", "package"), "commands", {
      includeProject: true,
      includeGlobal: false,
    });

    expect(dirs).toEqual([path.join(worktree, ".claude", "commands")]);
  });

  test("uses CLAUDE_PROJECT_DIR as the Claude discovery base instead of cwd", async () => {
    const root = await makeTempDir();
    const project = path.join(root, "project");
    const sandbox = path.join(root, "sandbox", "run");
    await mkdir(path.join(project, ".claude", "commands"), { recursive: true });
    await mkdir(sandbox, { recursive: true });
    process.env.CLAUDE_PROJECT_DIR = project;

    const dirs = discoverClaudeResourceDirs(sandbox, "commands", {
      includeProject: true,
      includeGlobal: false,
    });

    expect(dirs).toEqual([path.join(project, ".claude", "commands")]);
  });
});
