import { realpathSync } from "node:fs";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { minimatch } from "minimatch";
import { parseDocument } from "yaml";

const FRONTMATTER_RE = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u;

export type ClaudeRule = {
  id: string;
  sourcePath: string;
  sourceLabel: string;
  relativePath: string;
  body: string;
  paths?: string[];
  priority: number;
};

export type ClaudeRuleDiagnostic = {
  sourceLabel: string;
  reason: string;
};

export type ClaudeRuleDiscoveryResult = {
  rules: ClaudeRule[];
  diagnostics: ClaudeRuleDiagnostic[];
};

type ParsedRule = { body: string; paths?: string[] } | { reason: string };

export async function discoverClaudeRulesInDirectories(
  directories: string[],
): Promise<ClaudeRuleDiscoveryResult> {
  const rules: ClaudeRule[] = [];
  const diagnostics: ClaudeRuleDiagnostic[] = [];
  const claimedRelativePaths = new Set<string>();

  for (const [priority, directory] of directories.entries()) {
    const relativePaths = await findMarkdownFiles(directory);
    for (const relativePath of relativePaths) {
      if (claimedRelativePaths.has(relativePath)) continue;
      claimedRelativePaths.add(relativePath);

      const sourcePath = path.join(directory, ...relativePath.split("/"));
      const sourceLabel = sourcePath.split(path.sep).join("/");
      let content: string;
      try {
        content = await readFile(sourcePath, "utf8");
      } catch (error) {
        diagnostics.push({ sourceLabel, reason: `unreadable: ${getErrorCode(error)}` });
        continue;
      }

      const parsed = parseClaudeRule(content);
      if ("reason" in parsed) {
        diagnostics.push({ sourceLabel, reason: parsed.reason });
        continue;
      }

      rules.push({
        id: sourcePath,
        sourcePath,
        sourceLabel,
        relativePath,
        body: parsed.body,
        ...(parsed.paths ? { paths: parsed.paths } : {}),
        priority,
      });
    }
  }

  rules.sort(
    (left, right) =>
      right.priority - left.priority || left.sourceLabel.localeCompare(right.sourceLabel),
  );
  return { rules, diagnostics };
}

export function ruleMatchesTarget(rule: ClaudeRule, target: string): boolean {
  return Boolean(
    rule.paths?.some((pattern) =>
      minimatch(target, normalizePattern(pattern), { dot: true, nocase: false }),
    ),
  );
}

export function extractClaudeRuleTarget(
  rawPath: string,
  cwd: string,
  projectRoot: string,
): string | undefined {
  const withoutAt = rawPath.startsWith("@") ? rawPath.slice(1) : rawPath;
  if (!withoutAt.trim()) return undefined;

  const absolutePath = canonicalizePath(path.resolve(cwd, withoutAt));
  const canonicalRoot = canonicalizePath(projectRoot);
  const relativePath = path.relative(canonicalRoot, absolutePath);
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

function parseClaudeRule(content: string): ParsedRule {
  const frontmatter = content.match(FRONTMATTER_RE);
  if (!frontmatter) {
    if (/^\uFEFF?---(?:\r?\n|$)/u.test(content)) return { reason: "unclosed frontmatter" };
    return { body: content.replace(/^\uFEFF/u, "") };
  }

  const document = parseDocument(frontmatter[1] ?? "", { logLevel: "silent" });
  if (document.errors.length > 0) {
    return { reason: `invalid YAML: ${document.errors[0]?.message ?? "unknown error"}` };
  }

  const raw = document.toJS();
  if (raw !== null && (typeof raw !== "object" || Array.isArray(raw))) {
    return { reason: "frontmatter must be a mapping" };
  }

  const paths = normalizePaths((raw as Record<string, unknown> | null)?.paths);
  if (paths && "reason" in paths) return paths;
  return {
    body: content.slice(frontmatter[0].length),
    ...(paths ? { paths } : {}),
  };
}

function normalizePaths(raw: unknown): string[] | { reason: string } | undefined {
  if (raw === undefined) return undefined;
  const values = typeof raw === "string" ? [raw] : raw;
  if (!Array.isArray(values) || !values.every((value) => typeof value === "string")) {
    return { reason: "paths must be a string or string list" };
  }
  const normalized = values.map((value) => value.trim());
  if (normalized.length === 0 || normalized.some((value) => value.length === 0)) {
    return { reason: "paths must contain at least one non-empty glob" };
  }
  return [...new Set(normalized)];
}

async function findMarkdownFiles(
  directory: string,
  basePath = "",
  visited = new Set<string>(),
): Promise<string[]> {
  let canonicalDirectory: string;
  try {
    canonicalDirectory = await realpath(directory);
  } catch (error) {
    if (getErrorCode(error) === "ENOENT") return [];
    return [];
  }
  if (visited.has(canonicalDirectory)) return [];
  visited.add(canonicalDirectory);

  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: string[] = [];
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const sourcePath = path.join(directory, entry.name);
    const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;
    let isDirectory = entry.isDirectory();
    let isFile = entry.isFile();
    if (entry.isSymbolicLink()) {
      try {
        const target = await stat(sourcePath);
        isDirectory = target.isDirectory();
        isFile = target.isFile();
      } catch {
        continue;
      }
    }

    if (isDirectory) {
      files.push(...(await findMarkdownFiles(sourcePath, relativePath, visited)));
    } else if (isFile && entry.name.endsWith(".md")) {
      files.push(relativePath);
    }
  }
  return files;
}

function normalizePattern(pattern: string): string {
  return pattern.replace(/\\/gu, "/").replace(/^\.\//u, "");
}

function canonicalizePath(target: string): string {
  try {
    return realpathSync(target);
  } catch {
    const parent = path.dirname(target);
    try {
      return path.join(realpathSync(parent), path.basename(target));
    } catch {
      return path.resolve(target);
    }
  }
}

function getErrorCode(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return "EUNKNOWN";
}
