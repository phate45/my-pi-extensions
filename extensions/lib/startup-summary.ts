import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readdirSync, readFileSync } from "node:fs";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { discoverExtendedContextFiles, getAgentDir } from "./claude-context.js";

export type StartupSummary = {
  context: string[];
  skills: string[];
  prompts: string[];
  extensions: string[];
};

function normalizeSkillName(name: string): string {
  return name.startsWith("skill:") ? name.slice("skill:".length) : name;
}

export type EffectiveContextFile = {
  path: string;
  content: string;
  bytes: number;
};

const libDir = path.dirname(fileURLToPath(import.meta.url));
const extensionsDir = path.dirname(libDir);

export function shortenPath(filePath: string, cwd: string, agentDir = getAgentDir()): string {
  const resolved = path.resolve(filePath);
  const resolvedCwd = path.resolve(cwd);
  const resolvedAgentDir = path.resolve(agentDir);
  const home = os.homedir();

  const relToCwd = path.relative(resolvedCwd, resolved);
  const isInsideCwd = relToCwd === "" || (!relToCwd.startsWith("..") && !path.isAbsolute(relToCwd));
  if (isInsideCwd) return relToCwd || ".";

  if (resolved === resolvedAgentDir) return "~/.pi/agent";
  if (resolved.startsWith(resolvedAgentDir + path.sep)) return `~/.pi/agent/${resolved.slice(resolvedAgentDir.length + 1)}`;
  if (resolved === home) return "~";
  if (resolved.startsWith(home + path.sep)) return `~/${resolved.slice(home.length + 1)}`;
  return resolved;
}

export function listPackageExtensions(): string[] {
  return readdirSync(extensionsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(ts|js)$/.test(entry.name))
    .map((entry) => entry.name.replace(/\.(ts|js)$/, ""))
    .sort((a, b) => a.localeCompare(b));
}

export function loadEffectiveContextFiles(cwd: string): EffectiveContextFile[] {
  return discoverExtendedContextFiles(cwd, getAgentDir()).map((file) => {
    const content = readFileSync(file.path, "utf8");
    return {
      path: file.path,
      content,
      bytes: Buffer.byteLength(content, "utf8"),
    };
  });
}

export function getSkillNames(pi: ExtensionAPI): string[] {
  return pi
    .getCommands()
    .filter((command) => command.source === "skill")
    .map((command) => normalizeSkillName(command.name))
    .sort((a, b) => a.localeCompare(b));
}

export function getPromptNames(pi: ExtensionAPI): string[] {
  return pi
    .getCommands()
    .filter((command) => command.source === "prompt")
    .map((command) => `/${command.name}`)
    .filter((name) => !name.startsWith("/skill:"))
    .sort((a, b) => a.localeCompare(b));
}

export function buildStartupSummary(ctx: ExtensionContext, pi: ExtensionAPI): StartupSummary {
  const context = loadEffectiveContextFiles(ctx.cwd).map((file) => shortenPath(file.path, ctx.cwd));

  return {
    context,
    skills: getSkillNames(pi),
    prompts: getPromptNames(pi),
    extensions: listPackageExtensions(),
  };
}

export function wrapCompactList(items: string[], width: number, indent = "  "): string[] {
  const contentWidth = Math.max(10, width - indent.length);
  if (items.length === 0) return [`${indent}(none)`];

  const lines: string[] = [];
  let current = indent;

  for (let i = 0; i < items.length; i += 1) {
    const item = items[i]!;
    const token = current === indent ? item : `, ${item}`;
    if ((current + token).length <= indent.length + contentWidth) {
      current += token;
      continue;
    }

    if (current !== indent) {
      lines.push(current);
      current = `${indent}${item}`;
      continue;
    }

    lines.push(`${indent}${item}`);
    current = indent;
  }

  if (current !== indent) lines.push(current);
  return lines;
}
