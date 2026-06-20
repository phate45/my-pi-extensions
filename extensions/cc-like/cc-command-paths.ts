import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { discoverClaudeResourceDirs } from "./lib/claude-resource-discovery.js";
import { isManagedExtensionEnabled } from "../infra/lib/bundle-config.js";

export default function claudeCommandPathsExtension(pi: ExtensionAPI) {
  if (!isManagedExtensionEnabled("cc-command-paths", "ccLike")) return;

  pi.on("resources_discover", async (event) => {
    const promptPaths = discoverClaudeResourceDirs(event.cwd, "commands");
    if (promptPaths.length === 0) return;
    return { promptPaths };
  });
}
