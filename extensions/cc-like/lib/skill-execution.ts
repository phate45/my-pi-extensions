import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import {
  discoverClaudeSkillDirs,
  discoverNestedClaudeSkillDirectories,
} from "./cc-skill-discovery.js";
import { parseShellLikeArgs } from "./cli-args.js";
import { expandClaudeMarkdownResource } from "./claude-markdown-expansion.js";
import { splitFrontmatter } from "./markdown-preprocess.js";
import { maybeRealpath } from "./cc-context.js";
import { resolveClaudeProjectDir } from "./claude-project-dir.js";
import { resolveProjectRoot } from "./git-project-root.js";

export type SkillMetadata = {
  name: string;
  description: string;
  whenToUse?: string;
  arguments: string[];
  argumentHint?: string;
  disableModelInvocation: boolean;
  userInvocable: boolean;
};

export type SkillFrontmatter = {
  raw: string;
  fields: Record<string, unknown>;
  metadata: SkillMetadata;
};

export type SkillDocument = {
  raw: string;
  frontmatter: SkillFrontmatter;
  body: string;
};

export type SkillSummary = SkillMetadata & {
  path: string;
  baseDir: string;
};

export type SkillExpansionOptions = {
  argsText?: string;
};

const activatedSkillsByApi = new WeakMap<ExtensionAPI, Map<string, SkillSummary>>();

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseScalar(value: string): unknown {
  const trimmed = value.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;

  const quoted = trimmed.match(/^(["'])(.*)\1$/s);
  if (quoted) return quoted[2];

  const inlineList = trimmed.match(/^\[(.*)]$/s);
  if (inlineList) {
    return inlineList[1]
      .split(",")
      .map((item) => String(parseScalar(item.trim())))
      .filter(Boolean);
  }

  return trimmed;
}

function parseFrontmatterFields(rawFrontmatter: string): Record<string, unknown> {
  const content = rawFrontmatter.replace(/^---\n/, "").replace(/\n---\n?$/, "");
  const fields: Record<string, unknown> = {};
  const lines = content.split("\n");

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (!line.trim() || line.trimStart().startsWith("#")) continue;

    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    if (rawValue.trim()) {
      fields[key] = parseScalar(rawValue);
      continue;
    }

    const list: string[] = [];
    let lookahead = index + 1;
    while (lookahead < lines.length) {
      const itemMatch = lines[lookahead].match(/^\s*-\s+(.+)$/);
      if (!itemMatch) break;
      list.push(String(parseScalar(itemMatch[1])));
      lookahead++;
    }

    if (list.length > 0) {
      fields[key] = list;
      index = lookahead - 1;
    } else {
      fields[key] = "";
    }
  }

  return fields;
}

function stringField(fields: Record<string, unknown>, key: string): string | undefined {
  const value = fields[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function booleanField(
  fields: Record<string, unknown>,
  key: string,
  defaultValue: boolean,
): boolean {
  const value = fields[key];
  return typeof value === "boolean" ? value : defaultValue;
}

function argumentNamesField(fields: Record<string, unknown>): string[] {
  const value = fields.arguments;
  if (Array.isArray(value))
    return value
      .map(String)
      .map((item) => item.trim())
      .filter(Boolean);
  if (typeof value === "string")
    return value
      .split(/\s+/)
      .map((item) => item.trim())
      .filter(Boolean);
  return [];
}

function normalizeSkillMetadata(fields: Record<string, unknown>): SkillMetadata {
  const name = stringField(fields, "name");
  const description = stringField(fields, "description");

  if (!name) throw new Error("Skill frontmatter requires a non-empty name");
  if (!description) throw new Error("Skill frontmatter requires a non-empty description");

  return {
    name,
    description,
    whenToUse: stringField(fields, "when_to_use"),
    arguments: argumentNamesField(fields),
    argumentHint: stringField(fields, "argument-hint"),
    disableModelInvocation: booleanField(fields, "disable-model-invocation", false),
    userInvocable: booleanField(fields, "user-invocable", true),
  };
}

export function parseSkillFrontmatter(rawFrontmatter: string): SkillFrontmatter {
  const fields = parseFrontmatterFields(rawFrontmatter);
  return { raw: rawFrontmatter, fields, metadata: normalizeSkillMetadata(fields) };
}

export function parseSkillDocument(raw: string): SkillDocument {
  const { frontmatter, body } = splitFrontmatter(raw);
  return {
    raw,
    frontmatter: parseSkillFrontmatter(frontmatter),
    body: body.trim(),
  };
}

export function readSkillDocument(skillPath: string): SkillDocument {
  return parseSkillDocument(readFileSync(skillPath, "utf8"));
}

export const parseArgs = parseShellLikeArgs;

function expandSkillVariables(
  body: string,
  skill: SkillSummary,
  options: SkillExpansionOptions,
): string {
  const skillDir = maybeRealpath(skill.baseDir);
  const argsText = options.argsText?.trim() ?? "";
  const args = parseArgs(argsText);
  const hasArgumentsToken =
    /\$ARGUMENTS(?:\[\d+])?|\$@|\$\d+/.test(body) ||
    skill.arguments.some((name) => new RegExp(`\\$${escapeRegExp(name)}\\b`).test(body));

  let out = body.replace(/\$\{SKILL_DIR}/g, skillDir);
  out = out.replace(/\$ARGUMENTS\[(\d+)]/g, (_m, index) => args[Number(index)] ?? "");
  out = out.replace(/\$ARGUMENTS|\$@/g, argsText);
  out = out.replace(/\$(\d+)/g, (_m, index) => {
    const n = Number(index);
    return n === 0 ? (args[0] ?? "") : (args[n - 1] ?? "");
  });

  for (const [index, name] of skill.arguments.entries()) {
    out = out.replace(new RegExp(`\\$${escapeRegExp(name)}\\b`, "g"), args[index] ?? "");
  }

  if (argsText && !hasArgumentsToken) {
    out = `${out}\n\nARGUMENTS: ${argsText}`;
  }

  return out;
}

export function getSkillCommands(pi: ExtensionAPI): SkillSummary[] {
  return pi
    .getCommands()
    .filter((command) => command.source === "skill" && command.sourceInfo?.path)
    .flatMap((command) => {
      const skillPath = command.sourceInfo.path;
      const baseDir = path.dirname(skillPath);
      try {
        const document = readSkillDocument(skillPath);
        return [{ ...document.frontmatter.metadata, path: skillPath, baseDir }];
      } catch {
        return [];
      }
    });
}

function discoverSkillFilesFromDir(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  const visited = new Set<string>();

  const walk = (current: string) => {
    const canonical = maybeRealpath(current);
    if (visited.has(canonical)) return;
    visited.add(canonical);

    const skillFile = path.join(current, "SKILL.md");
    if (existsSync(skillFile) && statSync(skillFile).isFile()) {
      out.push(skillFile);
      return;
    }

    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const fullPath = path.join(current, entry.name);
      let isDirectory = entry.isDirectory();
      if (entry.isSymbolicLink()) {
        try {
          isDirectory = statSync(fullPath).isDirectory();
        } catch {
          continue;
        }
      }
      if (isDirectory) walk(fullPath);
    }
  };

  walk(dir);
  return out;
}

export function discoverClaudeSkills(cwd: string): SkillSummary[] {
  const seenNames = new Set<string>();
  const skills: SkillSummary[] = [];

  for (const skillDir of discoverClaudeSkillDirs(cwd)) {
    for (const skillFile of discoverSkillFilesFromDir(skillDir)) {
      let document;
      try {
        document = readSkillDocument(skillFile);
      } catch {
        continue;
      }

      const metadata = document.frontmatter.metadata;
      if (seenNames.has(metadata.name)) continue;
      seenNames.add(metadata.name);

      skills.push({
        ...metadata,
        path: skillFile,
        baseDir: path.dirname(skillFile),
      });
    }
  }

  return skills;
}

function discoverSkillsInDirectories(directories: Array<{ directory: string; scopePath: string }>) {
  return directories.flatMap(({ directory, scopePath }) =>
    discoverSkillFilesFromDir(directory).flatMap((skillFile) => {
      try {
        const document = readSkillDocument(skillFile);
        return [
          {
            ...document.frontmatter.metadata,
            name: `${scopePath}:${document.frontmatter.metadata.name}`,
            path: skillFile,
            baseDir: path.dirname(skillFile),
          },
        ];
      } catch {
        return [];
      }
    }),
  );
}

export function resetActivatedClaudeSkills(pi: ExtensionAPI) {
  activatedSkillsByApi.set(pi, new Map());
}

export function getActivatedClaudeSkills(pi: ExtensionAPI): SkillSummary[] {
  return [...(activatedSkillsByApi.get(pi)?.values() ?? [])];
}

function activateClaudeSkillsForProjectTarget(
  pi: ExtensionAPI,
  projectRoot: string,
  target: string,
): SkillSummary[] {
  const activated = activatedSkillsByApi.get(pi) ?? new Map<string, SkillSummary>();
  activatedSkillsByApi.set(pi, activated);
  const discovered = discoverSkillsInDirectories(
    discoverNestedClaudeSkillDirectories(projectRoot, target),
  );
  const fresh: SkillSummary[] = [];
  for (const skill of discovered) {
    if (activated.has(skill.path)) continue;
    activated.set(skill.path, skill);
    fresh.push(skill);
  }
  return fresh;
}

export function activateClaudeSkillsForTarget(
  pi: ExtensionAPI,
  cwd: string,
  rawPath: string,
): SkillSummary[] {
  const projectRoot = resolveProjectRoot(cwd);
  const target = extractProjectRelativePath(rawPath, cwd, projectRoot);
  if (!target) return [];

  return activateClaudeSkillsForProjectTarget(pi, projectRoot, target);
}

export function activateClaudeSkillsForCwd(pi: ExtensionAPI, cwd: string): SkillSummary[] {
  const projectRoot = resolveProjectRoot(cwd);
  const projectDir = resolveClaudeProjectDir(cwd);
  const relativePath = path.relative(projectRoot, projectDir);
  if (
    relativePath.length === 0 ||
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    return [];
  }

  return activateClaudeSkillsForProjectTarget(
    pi,
    projectRoot,
    path.join(relativePath, ".pi-startup").split(path.sep).join("/"),
  );
}

export function getSkillsForInvocation(
  pi: ExtensionAPI,
  cwd: string,
  useNativeSkills: boolean,
): SkillSummary[] {
  const base = useNativeSkills ? getSkillCommands(pi) : discoverClaudeSkills(cwd);
  return [...base, ...getActivatedClaudeSkills(pi)];
}

function extractProjectRelativePath(rawPath: string, cwd: string, projectRoot: string) {
  const withoutAt = rawPath.startsWith("@") ? rawPath.slice(1) : rawPath;
  if (!withoutAt.trim()) return undefined;

  const absolutePath = path.resolve(cwd, withoutAt);
  const relativePath = path.relative(projectRoot, absolutePath);
  if (
    relativePath.length === 0 ||
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    return undefined;
  }
  return relativePath.split(path.sep).join("/");
}

export async function expandSkill(
  skill: SkillSummary,
  ctx: ExtensionContext,
  pi: ExtensionAPI,
  options: SkillExpansionOptions = {},
): Promise<string> {
  const document = readSkillDocument(skill.path);
  const expandedBody = expandSkillVariables(document.body, skill, options);
  const preprocessed = await expandClaudeMarkdownResource(expandedBody, skill.path, ctx, pi, {
    transformEmbeddedFile: (resolvedPath, content) =>
      path.basename(resolvedPath) === "SKILL.md"
        ? splitFrontmatter(content).body.trimStart()
        : content,
  });

  const skillBlock = [
    `<skill name=${JSON.stringify(skill.name)} location=${JSON.stringify(maybeRealpath(skill.path))}>`,
    `References are relative to ${maybeRealpath(skill.baseDir)}.`,
    "",
    preprocessed,
    "</skill>",
  ].join("\n");

  return skillBlock;
}
