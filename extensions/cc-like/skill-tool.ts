import { keyText, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { getSkillCommands, type SkillSummary } from "./lib/skill-execution.js";
import { executeSkillByName } from "./lib/skill-invocation.js";
import { areSkillsDisabled } from "../infra/lib/bundle-config.js";
import { defineManagedExtension } from "../infra/lib/managed-extension.js";

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

export default defineManagedExtension({
  name: "skill-tool",
  featureFlag: "ccLike",
  setup(pi: ExtensionAPI) {
    if (areSkillsDisabled()) return;

    const registerSkillTool = () => {
      pi.registerTool({
        name: "skill",
        label: "Skill",
        description:
          "Execute/load a named skill by name. This is skill execution: it reads the skill, strips frontmatter, preprocesses skill markdown, and returns instructions to follow. Use read only to inspect raw SKILL.md files without preprocessing.",
        promptSnippet:
          "Execute/load a named skill by name; returns preprocessed skill instructions.",
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

    pi.on("session_start", async () => {
      registerSkillTool();
    });

    pi.on("before_agent_start", async (event) => {
      const replacement = renderSkillPromptReplacement(getSkillCommands(pi));
      if (!replacement) return;
      return {
        systemPrompt: replacePiSkillPromptBlock(event.systemPrompt, replacement),
      };
    });
  },
});
