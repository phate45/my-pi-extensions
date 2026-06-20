import os from "node:os";
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";

export type ExecResult = {
  stdout: string;
  stderr: string;
  code: number | null;
};

export type MarkdownPreprocessHooks = {
  exec(command: string): Promise<ExecResult>;
  renderCommand(command: string, result: ExecResult): string | null;
  renderFile(ref: string, resolvedPath: string, content: string): string | null;
  shouldExpandCommand?(command: string): boolean;
  shouldExpandFile?(ref: string): boolean;
  shouldSkipEmbed?(resolvedPath: string): boolean;
};

export function splitFrontmatter(raw: string): { frontmatter: string; body: string } {
  if (!raw.startsWith("---\n")) return { frontmatter: "", body: raw };
  const end = raw.indexOf("\n---\n", 4);
  if (end === -1) return { frontmatter: "", body: raw };
  return {
    frontmatter: raw.slice(0, end + 5),
    body: raw.slice(end + 5),
  };
}

export function normalizeReadPath(inputPath: string, cwd: string): string {
  let p = inputPath;
  if (p.startsWith("@")) p = p.slice(1);
  if (p === "~") p = os.homedir();
  else if (p.startsWith("~/")) p = path.join(os.homedir(), p.slice(2));
  if (!path.isAbsolute(p)) p = path.resolve(cwd, p);
  return path.resolve(p);
}

export function extractTextContent(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;

  const parts: string[] = [];
  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    const candidate = item as { type?: unknown; text?: unknown };
    if (candidate.type === "text" && typeof candidate.text === "string") {
      parts.push(candidate.text);
    }
  }

  return parts.length > 0 ? parts.join("") : null;
}

export function resolveEmbedPath(rawPath: string, resourceDir: string, cwd: string): string {
  const trimmed = rawPath.trim();
  if (!trimmed) throw new Error("Empty @path reference");

  let candidate = trimmed;
  if (candidate === "~") return os.homedir();
  if (candidate.startsWith("~/")) return path.join(os.homedir(), candidate.slice(2));
  if (path.isAbsolute(candidate)) return candidate;

  const fromResourceDir = path.resolve(resourceDir, candidate);
  if (existsSync(fromResourceDir)) return fromResourceDir;

  return path.resolve(cwd, candidate);
}

export function renderCommandOutput(command: string, stdout: string, stderr: string, code: number | null): string {
  const chunks: string[] = [];
  chunks.push(`<command-output command=${JSON.stringify(command)} exit_code=${JSON.stringify(code)}>`);
  if (stdout.trim()) {
    chunks.push("<stdout>");
    chunks.push(stdout.trimEnd());
    chunks.push("</stdout>");
  }
  if (stderr.trim()) {
    chunks.push("<stderr>");
    chunks.push(stderr.trimEnd());
    chunks.push("</stderr>");
  }
  if (!stdout.trim() && !stderr.trim()) {
    chunks.push("<stdout></stdout>");
  }
  chunks.push("</command-output>");
  return chunks.join("\n");
}

export function renderCommandStdoutOnSuccess(command: string, stdout: string, stderr: string, code: number | null): string | null {
  if (code === 0) {
    const trimmed = stdout.trimEnd();
    return trimmed ? trimmed : null;
  }

  return renderCommandOutput(command, stdout, stderr, code);
}

export function renderFileEmbed(ref: string, resolvedPath: string, content: string): string {
  return [
    `<file-content path=${JSON.stringify(ref)} resolved_path=${JSON.stringify(resolvedPath)}>`,
    content.trimEnd(),
    "</file-content>",
  ].join("\n");
}

export function renderErrorBlock(subject: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return [
    `<preprocess-error subject=${JSON.stringify(subject)}>`,
    message,
    "</preprocess-error>",
  ].join("\n");
}

export async function preprocessMarkdown(
  raw: string,
  resourcePath: string,
  cwd: string,
  hooks: MarkdownPreprocessHooks,
): Promise<string> {
  const { frontmatter, body } = splitFrontmatter(raw);
  const resourceDir = path.dirname(resourcePath);
  const lines = body.split("\n");
  const out: string[] = [];

  for (const line of lines) {
    if (line.startsWith("!")) {
      const command = line.slice(1).trim();
      if (!command) {
        out.push(line);
        continue;
      }
      if (hooks.shouldExpandCommand?.(command) === false) {
        out.push(line);
        continue;
      }

      try {
        const result = await hooks.exec(command);
        const rendered = hooks.renderCommand(command, result);
        if (rendered !== null) out.push(rendered);
      } catch (error) {
        out.push(renderErrorBlock(`command: ${command}`, error));
      }
      continue;
    }

    if (line.startsWith("@")) {
      const ref = line.slice(1).trim();
      if (!ref) {
        out.push(line);
        continue;
      }
      if (hooks.shouldExpandFile?.(ref) === false) {
        out.push(line);
        continue;
      }

      try {
        const embeddedPath = resolveEmbedPath(ref, resourceDir, cwd);
        if (hooks.shouldSkipEmbed?.(embeddedPath)) continue;
        const content = readFileSync(embeddedPath, "utf8");
        const rendered = hooks.renderFile(ref, embeddedPath, content);
        if (rendered !== null) out.push(rendered);
      } catch (error) {
        out.push(renderErrorBlock(`file: ${ref}`, error));
      }
      continue;
    }

    out.push(line);
  }

  return frontmatter ? `${frontmatter}${out.join("\n")}` : out.join("\n");
}
