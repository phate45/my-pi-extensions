import { existsSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export type ClaudeResourceKind = "commands" | "skills";

function maybeRealpath(dir: string): string {
  try {
    return realpathSync(dir);
  } catch {
    return path.resolve(dir);
  }
}

export function collectAncestorClaudeResourceDirs(cwd: string, kind: ClaudeResourceKind): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  let current = path.resolve(cwd);
  while (true) {
    const candidate = path.join(current, ".claude", kind);
    if (existsSync(candidate)) {
      const resolved = maybeRealpath(candidate);
      if (!seen.has(resolved)) {
        seen.add(resolved);
        out.push(candidate);
      }
    }

    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return out;
}

export function discoverClaudeResourceDirs(cwd: string, kind: ClaudeResourceKind): string[] {
  const resourcePaths: string[] = [];
  const seen = new Set<string>();

  const addIfExists = (dir: string) => {
    if (!existsSync(dir)) return;
    const resolved = maybeRealpath(dir);
    if (seen.has(resolved)) return;
    seen.add(resolved);
    resourcePaths.push(dir);
  };

  for (const dir of collectAncestorClaudeResourceDirs(cwd, kind)) {
    addIfExists(dir);
  }
  addIfExists(path.join(os.homedir(), ".claude", kind));

  return resourcePaths;
}

export function isClaudeResourcePath(
  cwd: string,
  filePath: string,
  kind: ClaudeResourceKind,
): boolean {
  const resolvedPath = maybeRealpath(filePath);

  return discoverClaudeResourceDirs(cwd, kind).some((dir) => {
    const resolvedDir = maybeRealpath(dir);
    return resolvedPath === resolvedDir || resolvedPath.startsWith(`${resolvedDir}${path.sep}`);
  });
}
