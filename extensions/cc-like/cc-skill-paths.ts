import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { discoverClaudeSkillDirs } from "./lib/cc-skill-discovery.js";
import { isManagedExtensionEnabled } from "../infra/lib/bundle-config.js";

export default function claudeSkillPathsExtension(pi: ExtensionAPI) {
  if (!isManagedExtensionEnabled("cc-skill-paths", "ccLike")) return;

  pi.on("resources_discover", async (event) => {
    const skillPaths = discoverClaudeSkillDirs(event.cwd);
    if (skillPaths.length === 0) return;
    return { skillPaths };
  });
}
