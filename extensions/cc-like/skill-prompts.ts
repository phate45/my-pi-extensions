import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { areSkillsDisabled, isFeatureFlagEnabled } from "../infra/lib/bundle-config.js";
import { defineManagedExtension } from "../infra/lib/managed-extension.js";
import {
  executeClaudeCommandByName,
  executeSkillByName,
  parseSkillCommand,
  parseSlashCommandLine,
} from "./lib/skill-invocation.js";
import { generateSkillPromptShims } from "./lib/skill-prompt-shims.js";

export default defineManagedExtension({
  name: "skill-prompts",
  featureFlag: "ccLike",
  setup(pi: ExtensionAPI) {
    if (isFeatureFlagEnabled("headless")) return;

    pi.on("resources_discover", async (event) => {
      const shimDir = generateSkillPromptShims(event.cwd);
      if (!shimDir) return;
      return { promptPaths: [shimDir] };
    });

    pi.on("session_start", async (_event, ctx) => {
      ctx.ui.addAutocompleteProvider((current) => ({
        async getSuggestions(lines, cursorLine, cursorCol, options) {
          const suggestions = await current.getSuggestions(lines, cursorLine, cursorCol, options);
          if (!suggestions) return null;

          const beforeCursor = lines[cursorLine]?.slice(0, cursorCol) ?? "";
          const isSlashCommandList = beforeCursor.startsWith("/") && !beforeCursor.includes(" ");
          if (!isSlashCommandList) return suggestions;

          const seenSkillItems = new Set<string>();
          const items = suggestions.items.filter((item) => {
            const name = item.value || item.label;
            if (!name.startsWith("skill:")) return true;
            if (seenSkillItems.has(name)) return false;
            seenSkillItems.add(name);
            return true;
          });

          return { ...suggestions, items };
        },
        applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
          return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
        },
        shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
          return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? false;
        },
      }));
    });

    pi.on("input", async (event, ctx) => {
      const parsedSkill = parseSkillCommand(event.text);
      if (parsedSkill) {
        const result = await executeSkillByName(parsedSkill.name, parsedSkill.argsText, ctx, pi, {
          useNativeSkills: !areSkillsDisabled(),
        });
        const text = result.content.map((item) => item.text).join("\n");
        if (result.isError) {
          ctx.ui.notify(text, "warning");
          return { action: "handled" as const };
        }

        return { action: "transform" as const, text, images: event.images };
      }

      const parsedCommand = parseSlashCommandLine(event.text);
      if (!parsedCommand || parsedCommand.name.startsWith("skill:")) {
        return { action: "continue" as const };
      }

      const commandResult = await executeClaudeCommandByName(
        parsedCommand.name,
        parsedCommand.argsText,
        parsedCommand.args,
        ctx,
        pi,
      );
      if (!commandResult) return { action: "continue" as const };

      const text = commandResult.content.map((item) => item.text).join("\n");
      return { action: "transform" as const, text, images: event.images };
    });
  },
});
