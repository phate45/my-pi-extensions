import { discoverClaudeResourceDirs } from "./claude-resource-discovery.js";

export function discoverClaudeSkillDirs(cwd: string): string[] {
  return discoverClaudeResourceDirs(cwd, "skills");
}
