import {
  discoverClaudeResourceDirs,
  type ClaudeResourceDiscoveryOptions,
} from "./claude-resource-discovery.js";
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";

export function discoverClaudeSkillDirs(
  cwd: string,
  options?: ClaudeResourceDiscoveryOptions,
): string[] {
  return discoverClaudeResourceDirs(cwd, "skills", options);
}

export type NestedClaudeSkillDirectory = {
  directory: string;
  scopePath: string;
};

export function discoverNestedClaudeSkillDirectories(
  projectRoot: string,
  target: string,
): NestedClaudeSkillDirectory[] {
  const canonicalRoot = canonicalizePath(projectRoot);
  const absoluteTarget = path.resolve(canonicalRoot, ...target.split("/"));
  const relativeTarget = path.relative(canonicalRoot, absoluteTarget);
  if (
    relativeTarget === ".." ||
    relativeTarget.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeTarget)
  ) {
    return [];
  }

  const directories: NestedClaudeSkillDirectory[] = [];
  const seen = new Set<string>();
  let current = path.dirname(absoluteTarget);
  while (current !== canonicalRoot) {
    const directory = path.join(current, ".claude", "skills");
    if (existsSync(directory)) {
      const canonicalDirectory = canonicalizePath(directory);
      if (!seen.has(canonicalDirectory)) {
        seen.add(canonicalDirectory);
        directories.unshift({
          directory,
          scopePath: path.relative(canonicalRoot, current).split(path.sep).join("/"),
        });
      }
    }

    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return directories;
}

function canonicalizePath(target: string): string {
  try {
    return realpathSync(target);
  } catch {
    const parent = path.dirname(target);
    try {
      return path.join(realpathSync(parent), path.basename(target));
    } catch {
      return path.resolve(target);
    }
  }
}
