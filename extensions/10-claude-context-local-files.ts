import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  discoverExtendedContextFiles,
  discoverStockContextFiles,
  getAgentDir,
  maybeRealpath,
  preprocessContextMarkdown,
  replaceProjectContextBlock,
} from "./lib/claude-context.js";

export default function claudeContextLocalFilesExtension(pi: ExtensionAPI) {
  pi.on("before_agent_start", async (event, ctx) => {
    const stockFiles = discoverStockContextFiles(ctx.cwd, getAgentDir());
    const extendedFiles = discoverExtendedContextFiles(ctx.cwd, getAgentDir());
    if (extendedFiles.length === 0 && stockFiles.length === 0) return;

    const discoveredSet = new Set(extendedFiles.map((file: { path: string }) => maybeRealpath(file.path)));
    const processedFiles = [];

    for (const file of extendedFiles) {
      const processed = await preprocessContextMarkdown(file.content, file.path, ctx.cwd, discoveredSet, async (command: string) => {
        const result = await pi.exec("bash", ["-lc", command], { cwd: ctx.cwd, signal: ctx.signal });
        return { stdout: result.stdout, stderr: result.stderr, code: result.code };
      });
      processedFiles.push({ path: file.path, content: processed });
    }

    return {
      systemPrompt: replaceProjectContextBlock(event.systemPrompt, stockFiles, processedFiles),
    };
  });
}
