import { execFileSync } from "node:child_process";
import path from "node:path";
import { realpathSync } from "node:fs";
import { resolveClaudeProjectDir } from "./claude-project-dir.js";

const projectRootCache = new Map<string, string>();

function maybeRealpath(dir: string): string {
  try {
    return realpathSync(dir);
  } catch {
    return path.resolve(dir);
  }
}

export function resolveProjectRoot(cwd: string): string {
  const resolvedCwd = resolveClaudeProjectDir(cwd);
  const cached = projectRootCache.get(resolvedCwd);
  if (cached) return cached;

  let projectRoot = resolvedCwd;

  try {
    const stdout = execFileSync("git", ["-C", resolvedCwd, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();

    if (stdout) {
      projectRoot = maybeRealpath(stdout);
    }
  } catch {
    projectRoot = resolvedCwd;
  }

  projectRootCache.set(resolvedCwd, projectRoot);
  return projectRoot;
}

export function resetProjectRootCacheForTests() {
  projectRootCache.clear();
}
