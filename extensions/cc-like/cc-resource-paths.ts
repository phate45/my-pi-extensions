import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { discoverClaudeResourceDirs } from "./lib/claude-resource-discovery.js";
import { discoverClaudeSkillDirs } from "./lib/cc-skill-discovery.js";
import {
  areSkillsDisabled,
  isExtensionEnabled,
  isFeatureFlagEnabled,
} from "../infra/lib/bundle-config.js";
import { defineManagedExtension } from "../infra/lib/managed-extension.js";
import {
  ccResourcePathsConfig,
  type CcResourcePathsConfig,
} from "./lib/claude-resource-load-config.js";

function getPromptPaths(cwd: string, config: CcResourcePathsConfig) {
  if (!isExtensionEnabled("cc-command-paths")) return undefined;
  if (isFeatureFlagEnabled("headless") && !config.commands.loadInHeadless) return undefined;

  const promptPaths = discoverClaudeResourceDirs(cwd, "commands", {
    includeProject: config.commands.project,
    includeGlobal: config.commands.global,
  });
  return promptPaths.length > 0 ? promptPaths : undefined;
}

function getSkillPaths(cwd: string, config: CcResourcePathsConfig) {
  if (!isExtensionEnabled("cc-skill-paths")) return undefined;
  if (areSkillsDisabled()) return undefined;

  const skillPaths = discoverClaudeSkillDirs(cwd, {
    includeProject: config.skills.project,
    includeGlobal: config.skills.global,
  });
  return skillPaths.length > 0 ? skillPaths : undefined;
}

export default defineManagedExtension({
  name: "cc-resource-paths",
  featureFlag: "ccLike",
  config: ccResourcePathsConfig,
  setup(pi: ExtensionAPI, getConfig: () => CcResourcePathsConfig) {
    pi.on("resources_discover", async (event) => {
      const config = getConfig();
      const promptPaths = getPromptPaths(event.cwd, config);
      const skillPaths = getSkillPaths(event.cwd, config);

      if (!promptPaths && !skillPaths) return;
      return {
        ...(promptPaths ? { promptPaths } : {}),
        ...(skillPaths ? { skillPaths } : {}),
      };
    });
  },
});
