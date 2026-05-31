import type { ExtensionAPI, ExtensionContext, ToolResultEvent } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import {
  extractTextContent,
  normalizeReadPath,
  preprocessMarkdown,
  renderCommandOutput,
  renderFileEmbed,
  splitFrontmatter,
} from "./lib/markdown-preprocess.js";
import { maybeRealpath } from "./lib/cc-context.js";

function stripFrontmatter(raw: string): string {
  const { body } = splitFrontmatter(raw);
  return body.trim();
}

function parseCommandLine(text: string): { name: string; argsText: string; args: string[] } | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return null;

  const withoutSlash = trimmed.slice(1);
  const firstSpace = withoutSlash.search(/\s/);
  const name = firstSpace === -1 ? withoutSlash : withoutSlash.slice(0, firstSpace);
  const argsText = firstSpace === -1 ? "" : withoutSlash.slice(firstSpace).trim();
  return { name, argsText, args: parseArgs(argsText) };
}

function parseArgs(input: string): string[] {
  const out: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let escaping = false;

  for (const ch of input) {
    if (escaping) {
      current += ch;
      escaping = false;
      continue;
    }

    if (ch === "\\") {
      escaping = true;
      continue;
    }

    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }

    if (/\s/.test(ch)) {
      if (current) {
        out.push(current);
        current = "";
      }
      continue;
    }

    current += ch;
  }

  if (current) out.push(current);
  return out;
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

function getLoadedMarkdownResourcePaths(pi: ExtensionAPI): Set<string> {
  const paths = new Set<string>();

  for (const command of pi.getCommands()) {
    if (command.source !== "prompt") continue;
    const sourcePath = command.sourceInfo?.path;
    if (!sourcePath) continue;
    paths.add(maybeRealpath(sourcePath));
  }

  return paths;
}

async function expandPromptTemplate(
  commandPath: string,
  args: string[],
  argsText: string,
  ctx: ExtensionContext,
  pi: ExtensionAPI,
): Promise<string> {
  const raw = readFileSync(commandPath, "utf8");
  const body = stripFrontmatter(raw);
  const substituted = substituteTemplateArgs(body, args, argsText);
  return await preprocessMarkdown(substituted, commandPath, ctx.cwd, {
    exec: async (command: string) => {
      const result = await pi.exec("bash", ["-lc", command], { cwd: ctx.cwd, signal: ctx.signal });
      return { stdout: result.stdout, stderr: result.stderr, code: result.code };
    },
    renderCommand: (command, result) => renderCommandOutput(command, result.stdout, result.stderr, result.code),
    renderFile: (ref, resolvedPath, content) => renderFileEmbed(ref, maybeRealpath(resolvedPath), content),
  });
}

export default function claudeMarkdownPreprocessor(pi: ExtensionAPI) {
  pi.on("input", async (event, ctx) => {
    const parsed = parseCommandLine(event.text);
    if (!parsed) return { action: "continue" as const };

    if (parsed.name.startsWith("skill:")) return { action: "continue" as const };

    const command = pi.getCommands().find((c) => c.name === parsed.name);
    if (!command) return { action: "continue" as const };

    try {
      if (command.source === "prompt") {
        const expanded = await expandPromptTemplate(command.sourceInfo.path, parsed.args, parsed.argsText, ctx, pi);
        return { action: "transform" as const, text: expanded, images: event.images };
      }

    } catch (error) {
      ctx.ui.notify(`Claude preprocess failed: ${error instanceof Error ? error.message : String(error)}`, "warning");
    }

    return { action: "continue" as const };
  });

  pi.on("tool_result", async (event: ToolResultEvent, ctx: ExtensionContext) => {
    if ((event as { toolName?: string }).toolName !== "read") return;
    if ((event as { isError?: boolean }).isError) return;

    const input = (event as { input?: { path?: string } }).input;
    const rawPath = input?.path;
    if (!rawPath) return;

    const absolutePath = normalizeReadPath(rawPath, ctx.cwd);
    const loadedResourcePaths = getLoadedMarkdownResourcePaths(pi);
    if (!loadedResourcePaths.has(maybeRealpath(absolutePath))) return;

    const original = extractTextContent((event as { content?: unknown }).content);
    if (original === null) return;

    const processed = await preprocessMarkdown(original, absolutePath, ctx.cwd, {
      exec: async (command: string) => {
        const result = await pi.exec("bash", ["-lc", command], { cwd: ctx.cwd, signal: ctx.signal });
        return { stdout: result.stdout, stderr: result.stderr, code: result.code };
      },
      renderCommand: (command, result) => renderCommandOutput(command, result.stdout, result.stderr, result.code),
      renderFile: (ref, resolvedPath, content) => renderFileEmbed(ref, maybeRealpath(resolvedPath), content),
    });

    return {
      content: [{ type: "text" as const, text: processed }],
    };
  });
}
