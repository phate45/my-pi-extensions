import os from "node:os";
import path from "node:path";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import {
  preprocessMarkdown,
  renderCommandOutput,
  renderErrorBlock,
  renderFileEmbed,
} from "./markdown-preprocess.js";

export type ContextFile = {
  path: string;
  content: string;
};

const STOCK_BASENAMES = ["AGENTS.md", "CLAUDE.md"] as const;
const EXTENDED_FAMILIES = ["AGENTS", "CLAUDE"] as const;
const CONTEXT_SECTION_HEADER = "\n\n<project_context>\n\nProject-specific instructions and guidelines:\n\n";
const CONTEXT_SECTION_FOOTER = "</project_context>\n";
const LEGACY_CONTEXT_SECTION_HEADER = "\n\n# Project Context\n\nProject-specific instructions and guidelines:\n\n";
const SKILLS_SECTION_HEADER = "\n\nThe following skills provide specialized instructions for specific tasks.";
const DATE_HEADER = "\nCurrent date: ";

export function getAgentDir(): string {
  return path.join(os.homedir(), ".pi", "agent");
}

export function discoverSystemPromptPath(cwd: string, agentDir = getAgentDir()): string | null {
  const projectPath = path.join(cwd, ".pi", "SYSTEM.md");
  if (existsSync(projectPath)) return projectPath;

  const globalPath = path.join(agentDir, "SYSTEM.md");
  if (existsSync(globalPath)) return globalPath;

  return null;
}

export function maybeRealpath(filePath: string): string {
  try {
    return realpathSync(filePath);
  } catch {
    return path.resolve(filePath);
  }
}

export function isContextFilePath(filePath: string): boolean {
  const base = path.basename(filePath);
  return base === "AGENTS.md" || base === "AGENTS.local.md" || base === "CLAUDE.md" || base === "CLAUDE.local.md";
}

function readFileIfExists(filePath: string): ContextFile | null {
  if (!existsSync(filePath)) return null;
  return { path: filePath, content: readFileSync(filePath, "utf8") };
}

function loadStockContextFileFromDir(dir: string): ContextFile | null {
  for (const basename of STOCK_BASENAMES) {
    const match = readFileIfExists(path.join(dir, basename));
    if (match) return match;
  }
  return null;
}

function loadExtendedContextFilesFromDir(dir: string): ContextFile[] {
  for (const family of EXTENDED_FAMILIES) {
    const basePath = path.join(dir, `${family}.md`);
    const localPath = path.join(dir, `${family}.local.md`);
    const base = readFileIfExists(basePath);
    const local = readFileIfExists(localPath);
    if (!base && !local) continue;
    return [base, local].filter((file): file is ContextFile => file !== null);
  }
  return [];
}

export function discoverStockContextFiles(cwd: string, agentDir = getAgentDir()): ContextFile[] {
  const files: ContextFile[] = [];
  const seen = new Set<string>();

  const add = (file: ContextFile | null) => {
    if (!file) return;
    const resolved = maybeRealpath(file.path);
    if (seen.has(resolved)) return;
    seen.add(resolved);
    files.push(file);
  };

  add(loadStockContextFileFromDir(agentDir));

  const ancestors: ContextFile[] = [];
  let current = path.resolve(cwd);
  const root = path.parse(current).root;
  while (true) {
    const file = loadStockContextFileFromDir(current);
    if (file) {
      const resolved = maybeRealpath(file.path);
      if (!seen.has(resolved)) {
        seen.add(resolved);
        ancestors.unshift(file);
      }
    }
    if (current === root) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  files.push(...ancestors);
  return files;
}

export function discoverExtendedContextFiles(cwd: string, agentDir = getAgentDir()): ContextFile[] {
  const files: ContextFile[] = [];
  const seen = new Set<string>();

  const add = (file: ContextFile) => {
    const resolved = maybeRealpath(file.path);
    if (seen.has(resolved)) return;
    seen.add(resolved);
    files.push(file);
  };

  for (const file of loadExtendedContextFilesFromDir(agentDir)) add(file);

  const ancestors: ContextFile[] = [];
  let current = path.resolve(cwd);
  const root = path.parse(current).root;
  while (true) {
    const dirFiles = loadExtendedContextFilesFromDir(current);
    for (let i = dirFiles.length - 1; i >= 0; i -= 1) {
      const file = dirFiles[i];
      const resolved = maybeRealpath(file.path);
      if (seen.has(resolved)) continue;
      seen.add(resolved);
      ancestors.unshift(file);
    }
    if (current === root) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  files.push(...ancestors);
  return files;
}

export async function preprocessContextMarkdown(
  raw: string,
  resourcePath: string,
  cwd: string,
  discoveredContextPaths: Set<string>,
  exec: (command: string) => Promise<{ stdout: string; stderr: string; code: number | null }>,
): Promise<string> {
  return preprocessMarkdown(raw, resourcePath, cwd, {
    exec,
    renderCommand: (command, result) => renderCommandOutput(command, result.stdout, result.stderr, result.code),
    renderFile: (ref, resolvedPath, content) => renderFileEmbed(ref, maybeRealpath(resolvedPath), content),
    shouldSkipEmbed: (resolvedPath) => discoveredContextPaths.has(maybeRealpath(resolvedPath)),
  });
}

export async function preprocessSystemPromptTemplate(
  raw: string,
  resourcePath: string,
  cwd: string,
  exec: (command: string) => Promise<{ stdout: string; stderr: string; code: number | null }>,
): Promise<string> {
  return preprocessMarkdown(raw, resourcePath, cwd, {
    exec,
    renderCommand: (_command, result) => {
      const out: string[] = [];
      if (result.stdout.trimEnd()) out.push(result.stdout.trimEnd());
      if (result.stderr.trim()) out.push(renderErrorBlock(`stderr: ${_command}`, result.stderr.trimEnd()));
      return out.length > 0 ? out.join("\n") : null;
    },
    renderFile: (_ref, _resolvedPath, content) => content.trimEnd(),
  });
}

export function renderProjectContextBlock(files: ContextFile[]): string {
  if (files.length === 0) return "";
  let out = CONTEXT_SECTION_HEADER;
  for (const file of files) {
    out += `<project_instructions path="${file.path}">\n${file.content}\n</project_instructions>\n\n`;
  }
  out += CONTEXT_SECTION_FOOTER;
  return out;
}

function renderLegacyProjectContextBlock(files: ContextFile[]): string {
  if (files.length === 0) return "";
  let out = LEGACY_CONTEXT_SECTION_HEADER;
  for (const file of files) {
    out += `## ${file.path}\n\n${file.content}\n\n`;
  }
  return out;
}

function insertContextBlock(systemPrompt: string, block: string): string {
  if (!block) return systemPrompt;

  const skillsIndex = systemPrompt.indexOf(SKILLS_SECTION_HEADER);
  if (skillsIndex !== -1) {
    return `${systemPrompt.slice(0, skillsIndex)}${block}${systemPrompt.slice(skillsIndex)}`;
  }

  const dateIndex = systemPrompt.lastIndexOf(DATE_HEADER);
  if (dateIndex !== -1) {
    return `${systemPrompt.slice(0, dateIndex)}${block}${systemPrompt.slice(dateIndex)}`;
  }

  return `${systemPrompt}${block}`;
}

export function replaceProjectContextBlock(systemPrompt: string, stockFiles: ContextFile[], replacementFiles: ContextFile[]): string {
  const replacementBlock = renderProjectContextBlock(replacementFiles);
  if (!replacementBlock) return systemPrompt;

  const taggedContextPattern = /\n\n<project_context>\n\nProject-specific instructions and guidelines:\n\n[\s\S]*?<\/project_context>\n?/u;
  if (taggedContextPattern.test(systemPrompt)) {
    return systemPrompt.replace(taggedContextPattern, replacementBlock);
  }

  const stockBlock = renderLegacyProjectContextBlock(stockFiles);

  if (stockBlock && systemPrompt.includes(stockBlock)) {
    return systemPrompt.replace(stockBlock, replacementBlock);
  }

  return insertContextBlock(systemPrompt, replacementBlock);
}
