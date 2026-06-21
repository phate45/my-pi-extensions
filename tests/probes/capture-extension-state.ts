import { writeFile } from "node:fs/promises";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  getBundleConfig,
  getBundleConfigSources,
  isExtensionEnabled,
  isFeatureFlagEnabled,
  takeBundleConfigErrors,
} from "../../extensions/infra/lib/bundle-config.js";
import { getLoadedExtensionsSnapshot } from "../../extensions/cc-like/lib/runtime-loaded-extensions.js";

const CHECKS = {
  featureFlags: ["ccLike", "myStuff", "experimental", "contextUx", "skillTooling", "headless"],
  extensions: ["git-context", "custom-header", "interactive-at-read", "web-research", "whimsical", "yeet"],
} as const;

export default function captureExtensionState(pi: ExtensionAPI) {
  pi.on("resources_discover", async (_event, ctx) => {
    const outputPath = process.env.MY_PI_EXTENSIONS_TEST_OUTPUT;
    if (!outputPath) throw new Error("MY_PI_EXTENSIONS_TEST_OUTPUT is not set");

    const payload = {
      loadedExtensions: getLoadedExtensionsSnapshot(),
      bundleConfig: getBundleConfig(),
      configSources: getBundleConfigSources(),
      commands: pi.getCommands().map((command) => command.name),
      tools: pi.getAllTools().map((tool) => tool.name),
      effective: {
        featureFlags: Object.fromEntries(CHECKS.featureFlags.map((name) => [name, isFeatureFlagEnabled(name)])),
        extensions: Object.fromEntries(CHECKS.extensions.map((name) => [name, isExtensionEnabled(name)])),
      },
      errors: takeBundleConfigErrors(),
    };

    await writeFile(outputPath, JSON.stringify(payload, null, 2));
    ctx.shutdown();
  });
}
