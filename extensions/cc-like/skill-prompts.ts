import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { areSkillsDisabled, isFeatureFlagEnabled } from "../infra/lib/bundle-config.js";
import { registerInputRouter } from "../infra/lib/input-pipeline.js";
import { defineManagedExtension } from "../infra/lib/managed-extension.js";
import { formatExpandedInvocation, formatSkillLikeInvocation } from "./lib/invocation-render.js";
import {
  executeClaudeCommandByName,
  executeSkillByName,
  parseSkillCommand,
  parseSlashCommandLine,
} from "./lib/skill-invocation.js";
import { generateSkillPromptShims } from "./lib/skill-prompt-shims.js";

const CLAUDE_COMMAND_MESSAGE_TYPE = "claude-command-invocation";

type ClaudeCommandInvocationDetails = {
  name: string;
  content: string;
};

export default defineManagedExtension({
  name: "skill-prompts",
  featureFlag: "ccLike",
  setup(pi: ExtensionAPI) {
    if (isFeatureFlagEnabled("headless")) return;

    pi.registerMessageRenderer<ClaudeCommandInvocationDetails>(
      CLAUDE_COMMAND_MESSAGE_TYPE,
      (message, options, theme) => {
        const text = new Text("", 0, 0);
        const name = message.details?.name ?? "...";
        const content = message.details?.content ?? "";
        text.setText(
          formatSkillLikeInvocation(
            name,
            theme as { fg: (color: string, text: string) => string },
          ) +
            formatExpandedInvocation(
              content,
              options.expanded,
              theme as { fg: (color: string, text: string) => string },
            ),
        );
        return text;
      },
    );

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

    registerInputRouter(
      "skill-prompts",
      async ({ text, images, ctx, source, streamingBehavior }) => {
        if (source === "extension") return { action: "continue" as const };

        const parsedSkill = parseSkillCommand(text);
        if (parsedSkill) {
          const result = await executeSkillByName(parsedSkill.name, parsedSkill.argsText, ctx, pi, {
            useNativeSkills: !areSkillsDisabled(),
          });
          const transformed = result.content.map((item) => item.text).join("\n");
          if (result.isError) {
            ctx.ui.notify(transformed, "warning");
            return { action: "handled" as const };
          }

          return { action: "transform" as const, text: transformed, images };
        }

        const parsedCommand = parseSlashCommandLine(text);
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

        const transformed = commandResult.content.map((item) => item.text).join("\n");
        const isIdle = ctx.isIdle?.() ?? true;

        pi.sendMessage(
          {
            customType: CLAUDE_COMMAND_MESSAGE_TYPE,
            content: "",
            display: true,
            details: {
              name: parsedCommand.name,
              content: transformed,
            },
          },
          isIdle ? undefined : { deliverAs: "nextTurn" },
        );

        pi.sendMessage(
          {
            customType: CLAUDE_COMMAND_MESSAGE_TYPE,
            content:
              images && images.length > 0
                ? ([{ type: "text", text: transformed }, ...images] as const)
                : transformed,
            display: false,
            details: {
              name: parsedCommand.name,
              content: transformed,
            },
          },
          isIdle
            ? { triggerTurn: true }
            : { deliverAs: streamingBehavior === "followUp" ? "followUp" : "steer" },
        );

        return { action: "handled" as const };
      },
    );
  },
});
