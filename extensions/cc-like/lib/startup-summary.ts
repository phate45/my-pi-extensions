import os from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";
import type { ExtensionAPI, ExtensionContext, SourceInfo } from "@earendil-works/pi-coding-agent";
import { discoverExtendedContextFiles, getAgentDir } from "./cc-context.js";
import { getLoadedExtensionsPatchStatus, getLoadedExtensionsSnapshot } from "./runtime-loaded-extensions.js";
import { getResourcePatchStatus } from "./runtime-resource-events.js";

export type StartupSummary = {
  context: string[];
  skills: string[];
  prompts: string[];
  extensions: string[];
  warnings: string[];
};

export type BuildStartupSummaryOptions = {
  expectExtendedResources?: boolean;
};

function normalizeSkillName(name: string): string {
  return name.startsWith("skill:") ? name.slice("skill:".length) : name;
}

export type EffectiveContextFile = {
  path: string;
  content: string;
  bytes: number;
};

type LoadedExtension = ReturnType<typeof getLoadedExtensionsSnapshot>[number];

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

function displayExtensionName(extensionPath: string): string {
  const base = path.basename(extensionPath);
  if (base === "index.ts" || base === "index.js") return path.basename(path.dirname(extensionPath));
  return base.replace(/\.(ts|js)$/u, "");
}

function formatSourceHeading(source: string, rootLabel: string): string {
  if (source === "local") return `[${rootLabel}]`;
  if (source.startsWith("npm:")) return "[npm]";
  if (source.startsWith("git:")) return "[git]";
  if (source === "cli") return "[path]";
  return `[${source}]`;
}

function getLocationLabel(extension: LoadedExtension, cwd: string, agentDir: string): string {
  const baseDir = extension.sourceInfo.baseDir ? path.resolve(extension.sourceInfo.baseDir) : undefined;
  if (baseDir) {
    if (baseDir === agentDir || baseDir.startsWith(agentDir + path.sep)) return shortenPath(agentDir, cwd, agentDir);
    if (baseDir === path.resolve(cwd) || baseDir.startsWith(path.resolve(cwd) + path.sep)) return shortenPath(cwd, cwd, agentDir);
  }

  const fallback = extension.sourceInfo.baseDir ? path.dirname(extension.sourceInfo.baseDir) : path.dirname(extension.path);
  return shortenPath(fallback, cwd, agentDir);
}

function groupKeyForProjectLocal(extension: LoadedExtension, cwd: string): string {
  const baseDir = extension.sourceInfo.baseDir ? path.resolve(extension.sourceInfo.baseDir) : path.resolve(cwd);
  const parentDir = path.dirname(path.resolve(extension.path));
  const relativeDir = path.relative(baseDir, parentDir).replace(/\\/gu, "/");
  return relativeDir ? `${relativeDir}/` : "./";
}

function sortNames(names: Iterable<string>): string[] {
  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}

export function listLoadedExtensions(cwd: string): string[] {
  const agentDir = getAgentDir();
  const extensions = getLoadedExtensionsSnapshot();
  if (extensions.length === 0) return ["  (none)"];

  const lines: string[] = [];
  const sourceGroups = new Map<string, Map<string, Set<string>>>();
  const sourceHeadings = new Map<string, string>();

  for (const extension of extensions) {
    const source = extension.sourceInfo.source;
    const rootLabel = source === "local"
      ? shortenPath(extension.sourceInfo.baseDir ?? cwd, cwd, agentDir)
      : getLocationLabel(extension, cwd, agentDir);
    const heading = formatSourceHeading(source, rootLabel);
    sourceHeadings.set(source, heading);

    const subgroup = source === "local"
      ? `[${groupKeyForProjectLocal(extension, cwd)}]`
      : `[${getLocationLabel(extension, cwd, agentDir)}]`;
    const name = displayExtensionName(extension.path);

    let subgroupMap = sourceGroups.get(source);
    if (!subgroupMap) {
      subgroupMap = new Map();
      sourceGroups.set(source, subgroupMap);
    }

    const names = subgroupMap.get(subgroup) ?? new Set<string>();
    names.add(name);
    subgroupMap.set(subgroup, names);
  }

  const orderedSources = [...sourceGroups.keys()].sort((a, b) => {
    const rank = (source: string) => {
      if (source === "local") return 0;
      if (source.startsWith("npm:")) return 1;
      if (source.startsWith("git:")) return 2;
      if (source === "cli") return 3;
      return 4;
    };
    return rank(a) - rank(b) || a.localeCompare(b);
  });

  for (const source of orderedSources) {
    lines.push(sourceHeadings.get(source) ?? `[${source}]`);
    const subgroupMap = sourceGroups.get(source)!;
    for (const subgroup of [...subgroupMap.keys()].sort((a, b) => a.localeCompare(b))) {
      lines.push(`  ${subgroup} - ${sortNames(subgroupMap.get(subgroup)!).join(", ")}`);
    }
  }

  return lines;
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

export function buildStartupSummary(
  ctx: ExtensionContext,
  pi: ExtensionAPI,
  options: BuildStartupSummaryOptions = {},
): StartupSummary {
  const context = loadEffectiveContextFiles(ctx.cwd).map((file) => shortenPath(file.path, ctx.cwd));
  const warnings: string[] = [];
  const extensionPatch = getLoadedExtensionsPatchStatus();
  const resourcePatch = getResourcePatchStatus();

  if (extensionPatch.error) warnings.push(`[patch:loaded-extensions] ${extensionPatch.error}`);
  else if (!extensionPatch.installed) warnings.push("[patch:loaded-extensions] patch not installed");
  else if (!extensionPatch.observed) warnings.push("[patch:loaded-extensions] hook not observed; extension list may be stale");

  if (resourcePatch.error) warnings.push(`[patch:resources] ${resourcePatch.error}`);
  else if (!resourcePatch.installed) warnings.push("[patch:resources] patch not installed");
  else if (options.expectExtendedResources && !resourcePatch.observed) {
    warnings.push("[patch:resources] hook not observed after resources_discover; skills/prompts may be stale");
  }

  return {
    context,
    skills: getSkillNames(pi),
    prompts: getPromptNames(pi),
    extensions: listLoadedExtensions(ctx.cwd),
    warnings,
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
