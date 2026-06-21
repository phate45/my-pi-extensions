import type {
  BeforeAgentStartEvent,
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { defineManagedExtension } from "../infra/lib/managed-extension.js";
import {
  discoverEffectiveContextFiles,
  discoverStockContextFiles,
  getAgentDir,
  maybeRealpath,
  preprocessContextMarkdown,
  replaceProjectContextBlock,
} from "./lib/cc-context.js";
import {
  ccContextLocalFilesConfig,
  type CcContextLocalFilesConfig,
} from "./lib/claude-resource-load-config.js";

export default defineManagedExtension({
  name: "cc-context-local-files",
  featureFlag: "ccLike",
  config: ccContextLocalFilesConfig,
  setup(pi: ExtensionAPI, _getConfig: () => CcContextLocalFilesConfig) {
    pi.on("before_agent_start", async (event: BeforeAgentStartEvent, ctx: ExtensionContext) => {
      const stockFiles = discoverStockContextFiles(ctx.cwd, getAgentDir());
      const extendedFiles = discoverEffectiveContextFiles(ctx.cwd, getAgentDir());
      if (extendedFiles.length === 0 && stockFiles.length === 0) return;

      const discoveredSet = new Set(
        extendedFiles.map((file: { path: string }) => maybeRealpath(file.path)),
      );
      const processedFiles = [];

      for (const file of extendedFiles) {
        const processed = await preprocessContextMarkdown(
          file.content,
          file.path,
          ctx,
          pi,
          discoveredSet,
        );
        processedFiles.push({ path: file.path, content: processed });
      }

      return {
        systemPrompt: replaceProjectContextBlock(event.systemPrompt, stockFiles, processedFiles),
      };
    });
  },
});
