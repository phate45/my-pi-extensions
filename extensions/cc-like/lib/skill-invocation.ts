import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import path from "node:path";
import { isClaudeResourcePath } from "./claude-resource-discovery.js";
import { expandClaudeMarkdownResource } from "./claude-markdown-expansion.js";
import { parseShellLikeArgs } from "./cli-args.js";
import { splitFrontmatter } from "./markdown-preprocess.js";
import { maybeRealpath } from "./cc-context.js";
import {
  discoverClaudeSkills,
  expandSkill,
  findClaudeSkill,
  findSkill,
  getSkillCommands,
} from "./skill-execution.js";

function stripFrontmatter(raw: string): string {
  const { body } = splitFrontmatter(raw);
  return body.trim();
}

function substituteTemplateArgs(template: string, args: string[], argsText: string): string {
  let out = template;

  out = out.replace(/\$ARGUMENTS|\$@/g, argsText);
  out = out.replace(/\$([1-9][0-9]*)/g, (_m, idx) => args[Number(idx) - 1] ?? "");
  out = out.replace(/\$\{@:(\d+)(?::(\d+))?\}/g, (_m, startStr, lenStr) => {
    const start = Math.max(1, Number(startStr));
    const from = start - 1;
    const slice = lenStr ? args.slice(from, from + Number(lenStr)) : args.slice(from);
    return slice.join(" ");
  });

  return out;
}

function wrapClaudeCommandInvocation(name: string, commandPath: string, content: string): string {
  return [
    `<claude-command name=${JSON.stringify(name)} location=${JSON.stringify(maybeRealpath(commandPath))}>`,
    `References are relative to ${maybeRealpath(path.dirname(commandPath))}.`,
    "",
    content,
    "</claude-command>",
  ].join("\n");
}

export function parseSlashCommandLine(
  text: string,
): { name: string; argsText: string; args: string[] } | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return null;

  const withoutSlash = trimmed.slice(1);
  const firstSpace = withoutSlash.search(/\s/);
  const name = firstSpace === -1 ? withoutSlash : withoutSlash.slice(0, firstSpace);
  const argsText = firstSpace === -1 ? "" : withoutSlash.slice(firstSpace).trim();
  return { name, argsText, args: parseShellLikeArgs(argsText) };
}

export function parseSkillCommand(text: string): { name: string; argsText: string } | null {
  if (!text.startsWith("/skill:")) return null;
  const spaceIndex = text.indexOf(" ");
  const name =
    spaceIndex === -1 ? text.slice("/skill:".length) : text.slice("/skill:".length, spaceIndex);
  if (!name) return null;
  const argsText = spaceIndex === -1 ? "" : text.slice(spaceIndex + 1).trim();
  return { name, argsText };
}

export async function executeSkillByName(
  name: string,
  argsText: string | undefined,
  ctx: ExtensionContext,
  pi: ExtensionAPI,
  options?: { useNativeSkills?: boolean },
) {
  const useNativeSkills = options?.useNativeSkills ?? true;
  const skills = useNativeSkills ? getSkillCommands(pi) : discoverClaudeSkills(ctx.cwd);
  const skill = useNativeSkills ? findSkill(pi, name) : findClaudeSkill(ctx.cwd, name);
  if (!skill) {
    const available = skills.map((item) => item.name).join(", ") || "none";
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

export function findClaudeCommand(pi: ExtensionAPI, cwd: string, name: string) {
  const command = pi.getCommands().find((item) => item.name === name);
  if (command?.source !== "prompt" || !command.sourceInfo?.path) return undefined;
  if (!isClaudeResourcePath(cwd, command.sourceInfo.path, "commands")) return undefined;
  return command;
}

export async function executeClaudeCommandByName(
  name: string,
  argsText: string,
  args: string[],
  ctx: ExtensionContext,
  pi: ExtensionAPI,
) {
  const command = findClaudeCommand(pi, ctx.cwd, name);
  if (!command?.sourceInfo?.path) return undefined;

  const raw = readFileSync(command.sourceInfo.path, "utf8");
  const body = stripFrontmatter(raw);
  const substituted = substituteTemplateArgs(body, args, argsText);
  const expanded = await expandClaudeMarkdownResource(
    substituted,
    command.sourceInfo.path,
    ctx,
    pi,
  );

  return {
    content: [
      {
        type: "text" as const,
        text: wrapClaudeCommandInvocation(name, command.sourceInfo.path, expanded),
      },
    ],
    details: {
      name,
      path: command.sourceInfo.path,
      baseDir: path.dirname(command.sourceInfo.path),
    },
  };
}
