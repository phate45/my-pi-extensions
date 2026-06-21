import { defineManagedExtension } from "../infra/lib/managed-extension.js";
import {
  discoverExtendedContextFiles,
  discoverStockContextFiles,
  getAgentDir,
  maybeRealpath,
  preprocessContextMarkdown,
  replaceProjectContextBlock,
} from "./lib/cc-context.js";

export default defineManagedExtension({
  name: "cc-context-local-files",
  featureFlag: "ccLike",
  setup(pi) {
    pi.on("before_agent_start", async (event, ctx) => {
      const stockFiles = discoverStockContextFiles(ctx.cwd, getAgentDir());
      const extendedFiles = discoverExtendedContextFiles(ctx.cwd, getAgentDir());
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
