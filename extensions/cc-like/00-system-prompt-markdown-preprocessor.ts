import { readFileSync } from "node:fs";
import { defineManagedExtension } from "../infra/lib/managed-extension.js";
import { discoverSystemPromptPath, preprocessSystemPromptTemplate } from "./lib/cc-context.js";

export default defineManagedExtension({
  name: "system-prompt-markdown-preprocessor",
  featureFlag: "ccLike",
  setup(pi) {
    pi.on("before_agent_start", async (event, ctx) => {
      const systemPromptPath = discoverSystemPromptPath(ctx.cwd);
      if (!systemPromptPath) return;

      const rawPrompt = readFileSync(systemPromptPath, "utf8");
      if (!event.systemPrompt.startsWith(rawPrompt)) return;
      if (!rawPrompt.includes("!") && !rawPrompt.includes("@")) return;

      const processedPrompt = await preprocessSystemPromptTemplate(
        rawPrompt,
        systemPromptPath,
        ctx,
        pi,
      );

      return {
        systemPrompt: `${processedPrompt}${event.systemPrompt.slice(rawPrompt.length)}`,
      };
    });
  },
});
