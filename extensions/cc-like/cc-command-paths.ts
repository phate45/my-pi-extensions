import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";

function maybeRealpath(dir: string): string {
  try {
    return realpathSync(dir);
  } catch {
    return path.resolve(dir);
  }
}

function collectAncestorClaudeCommandDirs(cwd: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  let current = path.resolve(cwd);
  while (true) {
    const candidate = path.join(current, ".claude", "commands");
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

export default function claudeCommandPathsExtension(pi: ExtensionAPI) {
  pi.on("resources_discover", async (event) => {
    const promptPaths: string[] = [];
    const seen = new Set<string>();

    const addIfExists = (dir: string) => {
      if (!existsSync(dir)) return;
      const resolved = maybeRealpath(dir);
      if (seen.has(resolved)) return;
      seen.add(resolved);
      promptPaths.push(dir);
    };

    for (const dir of collectAncestorClaudeCommandDirs(event.cwd)) {
      addIfExists(dir);
    }
    addIfExists(path.join(os.homedir(), ".claude", "commands"));

    if (promptPaths.length === 0) return;
    return { promptPaths };
  });
}
