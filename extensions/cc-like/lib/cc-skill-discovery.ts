import {
  discoverClaudeResourceDirs,
  type ClaudeResourceDiscoveryOptions,
} from "./claude-resource-discovery.js";

export function discoverClaudeSkillDirs(
  cwd: string,
  options?: ClaudeResourceDiscoveryOptions,
): string[] {
  return discoverClaudeResourceDirs(cwd, "skills", options);
}
