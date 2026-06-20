import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { discoverClaudeResourceDirs } from "../../extensions/cc-like/lib/claude-resource-discovery.js";

const tempDirs: string[] = [];

async function makeTempDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "claude-resource-discovery-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) continue;
    await rm(dir, { recursive: true, force: true });
  }
});

describe("claude resource discovery", () => {
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
});
