import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { type ExtensionAPI, withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { defineManagedExtension } from "../infra/lib/managed-extension.js";
import {
  getFrontmatterTimestampsConfig,
  type FrontmatterTimestampsConfig,
} from "./lib/frontmatter-timestamps-config.js";

type ToolInput = {
  path?: string;
  multi?: Array<{ path?: string }>;
  patch?: string;
};

function toIsoWithOffset(date = new Date()): string {
  const pad = (n: number) => String(Math.trunc(Math.abs(n))).padStart(2, "0");
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const offsetHours = pad(offsetMinutes / 60);
  const offsetRemainder = pad(offsetMinutes % 60);
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${sign}${offsetHours}:${offsetRemainder}`;
}

function toIsoLocal(date = new Date()): string {
  const pad = (n: number) => String(Math.trunc(Math.abs(n))).padStart(2, "0");
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
}

function extractPathsFromPatch(patchText?: string): string[] {
  if (!patchText) return [];

  const paths = new Set<string>();
  for (const line of patchText.split(/\r?\n/)) {
    const match = line.match(/^\*\*\* (?:Update|Add) File: (.+)$/);
    if (match?.[1]) {
      paths.add(match[1].trim());
    }
  }
  return [...paths];
}

function collectPaths(toolName: string, input: ToolInput): string[] {
  if (toolName === "write") {
    return input.path ? [input.path] : [];
  }

  if (toolName !== "edit") return [];

  const paths = new Set<string>();
  if (input.path) paths.add(input.path);

  for (const item of input.multi ?? []) {
    if (item.path) {
      paths.add(item.path);
      continue;
    }

    if (input.path) {
      paths.add(input.path);
    }
  }

  for (const patchPath of extractPathsFromPatch(input.patch)) {
    paths.add(patchPath);
  }

  return [...paths];
}

function resolveHomePath(value: string) {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

function resolvePathFromCwd(filePath: string, cwd: string) {
  const expanded = resolveHomePath(filePath);
  return path.isAbsolute(expanded) ? expanded : path.resolve(cwd, expanded);
}

function isPathWithinRoot(filePath: string, rootPath: string) {
  const relative = path.relative(rootPath, filePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function shouldTrackFile(filePath: string, cwd: string, config: FrontmatterTimestampsConfig) {
  const absolutePath = resolvePathFromCwd(filePath, cwd);
  const extension = path.extname(absolutePath).toLowerCase();

  if (!config.includeExtensions.includes(extension)) {
    return false;
  }

  if (config.includePaths.length === 0) {
    return true;
  }

  return config.includePaths
    .map((rootPath) => resolvePathFromCwd(rootPath, cwd))
    .some((rootPath) => isPathWithinRoot(absolutePath, rootPath));
}

async function updateFrontmatterTimestamp(
  filePath: string,
  cwd: string,
  config: FrontmatterTimestampsConfig,
): Promise<boolean> {
  const absolutePath = resolvePathFromCwd(filePath, cwd);

  return withFileMutationQueue(absolutePath, async () => {
    let content: string;
    try {
      content = await fs.readFile(absolutePath, "utf8");
    } catch {
      return false;
    }

    if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) {
      return false;
    }

    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/);
    if (!match) return false;

    const frontmatterBody = match[1];
    const frontmatterStart = match[0].slice(0, match[0].length - (match[2]?.length ?? 0));
    const newTimestamp = config.includeTimezone ? toIsoWithOffset() : toIsoLocal();

    const nextBody = /^modified:\s*.+$/m.test(frontmatterBody)
      ? frontmatterBody.replace(/^modified:\s*.+$/m, `modified: ${newTimestamp}`)
      : `${frontmatterBody}\nmodified: ${newTimestamp}`;

    const nextFrontmatter = `---\n${nextBody}\n---`;
    const nextContent = content.replace(frontmatterStart, nextFrontmatter);
    if (nextContent === content) return false;

    await fs.writeFile(absolutePath, nextContent, "utf8");
    return true;
  });
}

export default defineManagedExtension({
  name: "frontmatter-timestamps",
  featureFlag: "myStuff",
  getConfig: getFrontmatterTimestampsConfig,
  setup(pi: ExtensionAPI, config) {
    pi.on("tool_result", async (event, ctx) => {
      if (event.isError) return;
      if (event.toolName !== "write" && event.toolName !== "edit") return;

      const cwd = ctx.sessionManager.getCwd() ?? process.cwd();
      const paths = collectPaths(event.toolName, event.input as ToolInput);
      if (paths.length === 0) return;

      const updated = new Set<string>();
      for (const filePath of paths) {
        if (updated.has(filePath) || !shouldTrackFile(filePath, cwd, config)) {
          continue;
        }

        updated.add(filePath);
        try {
          await updateFrontmatterTimestamp(filePath, cwd, config);
        } catch (error) {
          if (!ctx.hasUI) continue;

          ctx.ui.notify(
            `frontmatter-timestamps: failed to update ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
            "warning",
          );
        }
      }
    });
  },
});
