import path from "node:path";
import { realpathSync } from "node:fs";

export const CLAUDE_PROJECT_DIR_ENV = "CLAUDE_PROJECT_DIR";

function maybeRealpath(dir: string): string {
  try {
    return realpathSync(dir);
  } catch {
    return path.resolve(dir);
  }
}

export function resolveClaudeProjectDir(cwd: string): string {
  const override = process.env[CLAUDE_PROJECT_DIR_ENV]?.trim();
  if (!override) return maybeRealpath(cwd);
  return maybeRealpath(override);
}
