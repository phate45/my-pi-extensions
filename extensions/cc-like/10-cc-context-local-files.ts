import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  discoverExtendedContextFiles,
  discoverStockContextFiles,
  getAgentDir,
  maybeRealpath,
  preprocessContextMarkdown,
  replaceProjectContextBlock,
} from "./lib/cc-context.js";
import { isManagedExtensionEnabled } from "../infra/lib/bundle-config.js";

export default function claudeContextLocalFilesExtension(pi: ExtensionAPI) {
  if (!isManagedExtensionEnabled("cc-context-local-files", "ccLike")) return;

  pi.on("before_agent_start", async (event, ctx) => {
    const stockFiles = discoverStockContextFiles(ctx.cwd, getAgentDir());
    const extendedFiles = discoverExtendedContextFiles(ctx.cwd, getAgentDir());
    if (extendedFiles.length === 0 && stockFiles.length === 0) return;

    const discoveredSet = new Set(extendedFiles.map((file: { path: string }) => maybeRealpath(file.path)));
    const processedFiles = [];

    for (const file of extendedFiles) {
      const processed = await preprocessContextMarkdown(file.content, file.path, ctx, pi, discoveredSet);
      processedFiles.push({ path: file.path, content: processed });
    }

    return {
      systemPrompt: replaceProjectContextBlock(event.systemPrompt, stockFiles, processedFiles),
    };
  });
}
