import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import {
  discoverSystemPromptPath,
  preprocessSystemPromptTemplate,
} from "./lib/cc-context.js";
import { isManagedExtensionEnabled } from "../my-stuff/lib/bundle-config.js";

export default function systemPromptMarkdownPreprocessorExtension(pi: ExtensionAPI) {
  if (!isManagedExtensionEnabled("system-prompt-markdown-preprocessor", "ccLike")) return;

  pi.on("before_agent_start", async (event, ctx) => {
    const systemPromptPath = discoverSystemPromptPath(ctx.cwd);
    if (!systemPromptPath) return;

    const rawPrompt = readFileSync(systemPromptPath, "utf8");
    if (!event.systemPrompt.startsWith(rawPrompt)) return;
    if (!rawPrompt.includes("!") && !rawPrompt.includes("@")) return;

    const processedPrompt = await preprocessSystemPromptTemplate(rawPrompt, systemPromptPath, ctx.cwd, async (command: string) => {
      const result = await pi.exec("bash", ["-lc", command], { cwd: ctx.cwd, signal: ctx.signal });
      return { stdout: result.stdout, stderr: result.stderr, code: result.code };
    });

    return {
      systemPrompt: `${processedPrompt}${event.systemPrompt.slice(rawPrompt.length)}`,
    };
  });
}
