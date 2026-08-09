import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
  activateClaudeSkillsForCwd,
  activateClaudeSkillsForTarget,
  getActivatedClaudeSkills,
  getSkillCommands,
  resetActivatedClaudeSkills,
  type SkillSummary,
} from "./lib/skill-execution.js";
import { formatExpandedInvocation, formatSkillLikeInvocation } from "./lib/invocation-render.js";
import { executeSkillByName } from "./lib/skill-invocation.js";
import { areSkillsDisabled, isExtensionEnabled } from "../infra/lib/bundle-config.js";
import { defineManagedExtension } from "../infra/lib/managed-extension.js";
import { getCcResourcePathsConfig } from "./lib/claude-resource-load-config.js";

const skillToolSchema = Type.Object({
  name: Type.String({ description: "Name of the skill to execute/load." }),
});
const FILE_TOOLS = new Set(["read", "edit", "write"]);
export const SKILL_DISCOVERY_MESSAGE_TYPE = "claude-skill-discovery";

type SkillToolParams = {
  name: string;
};

type SkillDiscoveryMessageDetails = {
  skills: Array<{ name: string; description: string } | string>;
};

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

  return formatExpandedInvocation(text, true, theme);
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
    let skillToolRegistered = false;
    let initialSkills: SkillSummary[] | undefined;
    const pendingSkills = new Map<string, SkillSummary>();

    pi.registerMessageRenderer<SkillDiscoveryMessageDetails>(
      SKILL_DISCOVERY_MESSAGE_TYPE,
      (message, { expanded }, theme) => {
        const skills = message.details?.skills ?? [];
        const summary = `Newly available skills:\n${skills
          .map((skill) =>
            typeof skill === "string" ? `↳ ${skill}` : `↳ ${skill.name} — ${skill.description}`,
          )
          .join("\n")}`;
        if (!expanded) return new Text(theme.fg("muted", summary), 0, 0);

        const content =
          typeof message.content === "string"
            ? message.content
            : JSON.stringify(message.content, null, 2);
        return new Text(
          `${theme.fg("accent", "Newly available skills:")}\n${theme.fg("dim", summary.slice("Newly available skills:\n".length))}\n\n${content}`,
          0,
          0,
        );
      },
    );

    const registerSkillTool = (force = false) => {
      if (skillToolRegistered) return;
      if (!force && areSkillsDisabled() && getSkillCommands(pi).length === 0) return;

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
            formatSkillLikeInvocation(
              name,
              theme as { fg: (color: string, text: string) => string },
            ),
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
      skillToolRegistered = true;
    };

    pi.on("session_start", async (_event, ctx) => {
      resetActivatedClaudeSkills(pi);
      pendingSkills.clear();
      initialSkills = undefined;
      if (!areSkillsDisabled() && typeof ctx.cwd === "string") {
        activateClaudeSkillsForCwd(pi, ctx.cwd);
      }
      registerSkillTool();
    });

    pi.on("before_agent_start", async (event) => {
      initialSkills ??= [
        ...new Map(
          [...getSkillCommands(pi), ...getActivatedClaudeSkills(pi)].map((skill) => [
            skill.path,
            skill,
          ]),
        ).values(),
      ];
      const replacement = renderSkillPromptReplacement(initialSkills);
      if (!replacement) return;
      return {
        systemPrompt: replacePiSkillPromptBlock(event.systemPrompt, replacement),
      };
    });

    pi.on("tool_call", (event, ctx) => {
      if (!FILE_TOOLS.has(event.toolName)) return;
      if (!isExtensionEnabled("cc-skill-paths") || !getCcResourcePathsConfig().skills.project) {
        return;
      }
      const rawPath = (event.input as { path?: unknown }).path;
      if (typeof rawPath !== "string") return;

      for (const skill of activateClaudeSkillsForTarget(pi, ctx.cwd, rawPath)) {
        pendingSkills.set(skill.path, skill);
      }
      registerSkillTool(pendingSkills.size > 0);
    });

    pi.on("turn_end", () => {
      if (pendingSkills.size === 0) return;
      const skills = [...pendingSkills.values()].sort((left, right) =>
        left.name.localeCompare(right.name),
      );
      pendingSkills.clear();
      pi.sendMessage(
        {
          customType: SKILL_DISCOVERY_MESSAGE_TYPE,
          content: [
            "<system-reminder>",
            "<skill-discovery>",
            "Newly available skills:",
            ...skills.map((skill) => `- ${skill.name} — ${skill.description}`),
            "</skill-discovery>",
            "</system-reminder>",
          ].join("\n"),
          display: true,
          details: {
            skills: skills.map((skill) => ({
              name: skill.name,
              description: skill.description,
            })),
          } satisfies SkillDiscoveryMessageDetails,
        },
        { deliverAs: "steer" },
      );
    });
  },
});
