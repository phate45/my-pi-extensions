import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { discoverClaudeResourceDirs } from "./lib/claude-resource-discovery.js";
import { discoverClaudeSkillDirs } from "./lib/cc-skill-discovery.js";
import { areSkillsDisabled, isExtensionEnabled } from "../infra/lib/bundle-config.js";
import { defineManagedExtension } from "../infra/lib/managed-extension.js";

function getPromptPaths(cwd: string) {
  if (!isExtensionEnabled("cc-command-paths")) return undefined;

  const promptPaths = discoverClaudeResourceDirs(cwd, "commands");
  return promptPaths.length > 0 ? promptPaths : undefined;
}

function getSkillPaths(cwd: string) {
  if (!isExtensionEnabled("cc-skill-paths")) return undefined;
  if (areSkillsDisabled()) return undefined;

  const skillPaths = discoverClaudeSkillDirs(cwd);
  return skillPaths.length > 0 ? skillPaths : undefined;
}

export default defineManagedExtension({
  name: "cc-resource-paths",
  featureFlag: "ccLike",
  setup(pi: ExtensionAPI) {
    pi.on("resources_discover", async (event) => {
      const promptPaths = getPromptPaths(event.cwd);
      const skillPaths = getSkillPaths(event.cwd);

      if (!promptPaths && !skillPaths) return;
      return {
        ...(promptPaths ? { promptPaths } : {}),
        ...(skillPaths ? { skillPaths } : {}),
      };
    });
  },
});
