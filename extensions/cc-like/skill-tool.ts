import { keyText, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
  expandSkill,
  findSkill,
  getSkillCommands,
  type SkillSummary,
} from "./lib/skill-execution.js";
import { generateSkillPromptShims } from "./lib/skill-prompt-shims.js";
import { isManagedExtensionEnabled } from "../infra/lib/bundle-config.js";

const skillToolSchema = Type.Object({
  name: Type.String({ description: "Name of the skill to execute/load." }),
});

type SkillToolParams = {
  name: string;
};

function formatSkillToolCall(
  name: string,
  theme: { fg: (color: string, text: string) => string },
): string {
  return (
    theme.fg("customMessageLabel", `\x1b[1m[skill]\x1b[22m `) +
    theme.fg("customMessageText", name) +
    theme.fg("dim", ` (${keyText("app.tools.expand")} to expand)`)
  );
}

function formatSkillToolResult(
  result: { content: Array<{ type: string; text?: string }> },
  expanded: boolean,
  theme: { fg: (color: string, text: string) => string },
  isError: boolean,
): string {
  if (!expanded && !isError) return "";

  const text = result.content
    .filter(
      (item): item is { type: string; text: string } =>
        item.type === "text" && typeof item.text === "string",
    )
    .map((item) => item.text)
    .join("\n");

  if (!text) return "";
  return `\n${text
    .split("\n")
    .map((line) => theme.fg("toolOutput", line))
    .join("\n")}`;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function renderSkillPromptReplacement(skills: SkillSummary[]): string {
  const visible = skills.filter((skill) => !skill.disableModelInvocation);
  if (visible.length === 0) return "";

  const lines = [
    "The following skills provide specialized instructions for specific tasks.",
    "Use the skill tool to execute/load a skill when the task matches its description.",
    "Use read only when you need to inspect a raw SKILL.md file without executing skill preprocessing.",
    "When a loaded skill references a relative path, resolve it against the skill directory reported by the skill tool.",
    "",
    "<available_skills>",
  ];

  for (const skill of visible) {
    lines.push("  <skill>");
    lines.push(`    <name>${escapeXml(skill.name)}</name>`);
    lines.push(`    <description>${escapeXml(skill.description)}</description>`);
    if (skill.whenToUse) {
      lines.push(`    <when_to_use>${escapeXml(skill.whenToUse)}</when_to_use>`);
    }
    lines.push("  </skill>");
  }

  lines.push("</available_skills>");
  return lines.join("\n");
}

function replacePiSkillPromptBlock(systemPrompt: string, replacement: string): string {
  const blockPattern =
    /\n*The following skills provide specialized instructions for specific tasks\.\nUse the read tool to load a skill's file when the task matches its description\.\nWhen a skill file references a relative path, resolve it against the skill directory \(parent of SKILL\.md \/ dirname of the path\) and use that absolute path in tool commands\.\n\n<available_skills>\n[\s\S]*?\n<\/available_skills>/;

  if (blockPattern.test(systemPrompt)) {
    return systemPrompt.replace(blockPattern, `\n\n${replacement}`);
  }

  if (!replacement) return systemPrompt;

  const cwdMarker = /\nCurrent date: /;
  if (cwdMarker.test(systemPrompt)) {
    return systemPrompt.replace(cwdMarker, `\n\n${replacement}\nCurrent date: `);
  }

  return `${systemPrompt}\n\n${replacement}`;
}

function parseSkillCommand(text: string): { name: string; argsText: string } | null {
  if (!text.startsWith("/skill:")) return null;
  const spaceIndex = text.indexOf(" ");
  const name =
    spaceIndex === -1 ? text.slice("/skill:".length) : text.slice("/skill:".length, spaceIndex);
  if (!name) return null;
  const argsText = spaceIndex === -1 ? "" : text.slice(spaceIndex + 1).trim();
  return { name, argsText };
}

async function executeSkillByName(
  name: string,
  argsText: string | undefined,
  ctx: ExtensionContext,
  pi: ExtensionAPI,
) {
  const skill = findSkill(pi, name);
  if (!skill) {
    const available =
      getSkillCommands(pi)
        .map((item) => item.name)
        .join(", ") || "none";
    return {
      content: [
        { type: "text" as const, text: `Skill not found: ${name}\nAvailable skills: ${available}` },
      ],
      details: { name, available },
      isError: true,
    };
  }

  const expanded = await expandSkill(skill, ctx, pi, { argsText });
  return {
    content: [{ type: "text" as const, text: expanded }],
    details: { name: skill.name, path: skill.path, baseDir: skill.baseDir },
  };
}

export default function skillToolExtension(pi: ExtensionAPI) {
  if (!isManagedExtensionEnabled("skill-tool", "ccLike")) return;

  pi.on("resources_discover", async (event) => {
    const shimDir = generateSkillPromptShims(event.cwd);
    if (!shimDir) return;
    return { promptPaths: [shimDir] };
  });

  const registerSkillTool = () => {
    pi.registerTool({
      name: "skill",
      label: "Skill",
      description:
        "Execute/load a named skill by name. This is skill execution: it reads the skill, strips frontmatter, preprocesses skill markdown, and returns instructions to follow. Use read only to inspect raw SKILL.md files without preprocessing.",
      promptSnippet: "Execute/load a named skill by name; returns preprocessed skill instructions.",
      promptGuidelines: [
        "Use the skill tool, not read, when a task matches an available skill description and you need to apply that skill.",
        "Use read for SKILL.md only when inspecting raw skill source rather than executing the skill.",
      ],
      parameters: skillToolSchema,
      renderCall(args, theme, context) {
        const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
        const name = typeof args?.name === "string" && args.name ? args.name : "...";
        text.setText(
          formatSkillToolCall(name, theme as { fg: (color: string, text: string) => string }),
        );
        return text;
      },
      renderResult(result, options, theme, context) {
        const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
        text.setText(
          formatSkillToolResult(
            result as { content: Array<{ type: string; text?: string }> },
            options.expanded,
            theme as { fg: (color: string, text: string) => string },
            context.isError,
          ),
        );
        return text;
      },
      async execute(_toolCallId, params: SkillToolParams, _signal, _onUpdate, ctx) {
        return await executeSkillByName(params.name, undefined, ctx, pi);
      },
    });
  };

  pi.on("session_start", async (_event, ctx) => {
    registerSkillTool();

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
    const parsed = parseSkillCommand(event.text);
    if (!parsed) return { action: "continue" as const };

    const result = await executeSkillByName(parsed.name, parsed.argsText, ctx, pi);
    const text = result.content.map((item) => item.text).join("\n");
    if (result.isError) {
      ctx.ui.notify(text, "warning");
      return { action: "handled" as const };
    }

    return { action: "transform" as const, text, images: event.images };
  });

  pi.on("before_agent_start", async (event) => {
    const replacement = renderSkillPromptReplacement(getSkillCommands(pi));
    if (!replacement) return;
    return {
      systemPrompt: replacePiSkillPromptBlock(event.systemPrompt, replacement),
    };
  });
}
