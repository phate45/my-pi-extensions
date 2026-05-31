import { existsSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export function maybeRealpathPath(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

export function collectAncestorClaudeSkillDirs(cwd: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  let current = path.resolve(cwd);
  while (true) {
    const candidate = path.join(current, ".claude", "skills");
    if (existsSync(candidate)) {
      const resolved = maybeRealpathPath(candidate);
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

export function discoverClaudeSkillDirs(cwd: string): string[] {
  const skillPaths: string[] = [];
  const seen = new Set<string>();

  const addIfExists = (dir: string) => {
    if (!existsSync(dir)) return;
    const resolved = maybeRealpathPath(dir);
    if (seen.has(resolved)) return;
    seen.add(resolved);
    skillPaths.push(dir);
  };

  for (const dir of collectAncestorClaudeSkillDirs(cwd)) {
    addIfExists(dir);
  }
  addIfExists(path.join(os.homedir(), ".claude", "skills"));

  return skillPaths;
}
