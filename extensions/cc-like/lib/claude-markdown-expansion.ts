import path from "node:path";
import { realpathSync } from "node:fs";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  preprocessMarkdown,
  renderCommandOutput,
  renderCommandStdoutOnSuccess,
  renderFileEmbed,
} from "./markdown-preprocess.js";
import {
  getClaudeMarkdownExpansionConfig,
  isClaudeMarkdownInterpolationDisabled,
} from "../../infra/lib/bundle-config.js";

export type CommandRenderMode = "stdout-on-success-xml-on-error" | "xml-always";
export type FileRenderMode = "xml" | "inline";

export type ClaudeMarkdownExpansionProfile = {
  commandRenderMode?: CommandRenderMode;
  fileRenderMode?: FileRenderMode;
  shouldSkipEmbed?(resolvedPath: string): boolean;
  transformEmbeddedFile?(resolvedPath: string, content: string): string;
};

function maybeRealpath(filePath: string): string {
  try {
    return realpathSync(filePath);
  } catch {
    return path.resolve(filePath);
  }
}

async function execPreprocessBash(command: string, ctx: ExtensionContext, pi: ExtensionAPI) {
  const result = await pi.exec("bash", ["-lc", command], { cwd: ctx.cwd, signal: ctx.signal });
  return { stdout: result.stdout, stderr: result.stderr, code: result.code };
}

function renderCommandForMode(command: string, stdout: string, stderr: string, code: number | null, mode: CommandRenderMode) {
  if (mode === "xml-always") return renderCommandOutput(command, stdout, stderr, code);
  return renderCommandStdoutOnSuccess(command, stdout, stderr, code);
}

function renderFileForMode(ref: string, resolvedPath: string, content: string, mode: FileRenderMode) {
  if (mode === "inline") return content.trimEnd();
  return renderFileEmbed(ref, maybeRealpath(resolvedPath), content);
}

export async function expandClaudeMarkdownResource(
  raw: string,
  resourcePath: string,
  ctx: ExtensionContext,
  pi: ExtensionAPI,
  profile: ClaudeMarkdownExpansionProfile = {},
): Promise<string> {
  if (isClaudeMarkdownInterpolationDisabled()) return raw;

  const config = getClaudeMarkdownExpansionConfig();

  const commandRenderMode = profile.commandRenderMode ?? "stdout-on-success-xml-on-error";
  const fileRenderMode = profile.fileRenderMode ?? "xml";

  return preprocessMarkdown(raw, resourcePath, ctx.cwd, {
    exec: async (command: string) => execPreprocessBash(command, ctx, pi),
    shouldExpandCommand: () => config.disableBash !== true,
    shouldExpandFile: () => config.disableIncludes !== true,
    renderCommand: (command, result) =>
      renderCommandForMode(command, result.stdout, result.stderr, result.code, commandRenderMode),
    renderFile: (ref, resolvedPath, content) => {
      const transformed = profile.transformEmbeddedFile?.(resolvedPath, content) ?? content;
      return renderFileForMode(ref, resolvedPath, transformed, fileRenderMode);
    },
    shouldSkipEmbed: profile.shouldSkipEmbed,
  });
}
