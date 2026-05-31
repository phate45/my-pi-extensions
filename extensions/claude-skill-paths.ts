import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { discoverClaudeSkillDirs } from "./lib/claude-skill-discovery.js";

export default function claudeSkillPathsExtension(pi: ExtensionAPI) {
  pi.on("resources_discover", async (event) => {
    const skillPaths = discoverClaudeSkillDirs(event.cwd);
    if (skillPaths.length === 0) return;
    return { skillPaths };
  });
}
