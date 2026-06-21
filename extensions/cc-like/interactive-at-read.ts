import os from "node:os";
import path from "node:path";
import type { ImageContent } from "@earendil-works/pi-ai";
import { createReadToolDefinition, getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { Markdown } from "@earendil-works/pi-tui";
import { isFeatureFlagEnabled } from "../infra/lib/bundle-config.js";
import { defineManagedExtension } from "../infra/lib/managed-extension.js";

type FileRef = {
  path: string;
};

type TextBlock = { type: "text"; text: string };
type ImageBlock = { type: "image"; data: string; mimeType: string };

type ReadMarkerDetails = {
  markdown: string;
};

const MESSAGE_TYPE = "interactive-at-read";
const TRAILING_PUNCTUATION = /[),.;:!?\]]+$/;

function isPathBoundary(ch: string | undefined): boolean {
  return !ch || /\s/.test(ch);
}

function canStartFileRef(text: string, index: number): boolean {
  const prev = text[index - 1];
  return !prev || /[\s([{"'`]/.test(prev);
}

function normalizeCandidatePath(rawPath: string): string {
  let candidate = rawPath.trim();
  while (TRAILING_PUNCTUATION.test(candidate)) {
    candidate = candidate.replace(TRAILING_PUNCTUATION, "");
  }
  return candidate;
}

function extractFileRefs(text: string): FileRef[] {
  const refs: FileRef[] = [];

  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "@") continue;
    if (!canStartFileRef(text, i)) continue;

    const next = text[i + 1];
    if (!next) continue;

    if (next === '"') {
      const end = text.indexOf('"', i + 2);
      if (end === -1) continue;
      const rawPath = text.slice(i + 2, end);
      const candidate = normalizeCandidatePath(rawPath);
      if (candidate) refs.push({ path: candidate });
      i = end;
      continue;
    }

    let end = i + 1;
    while (end < text.length && !isPathBoundary(text[end])) {
      end++;
    }

    const rawPath = text.slice(i + 1, end);
    const candidate = normalizeCandidatePath(rawPath);
    if (!candidate) continue;
    if (!/[./~\\]/.test(candidate[0]) && !/[A-Za-z0-9_-]/.test(candidate[0])) continue;

    refs.push({ path: candidate });
    i = end - 1;
  }

  return refs;
}

function resolveForDisplay(filePath: string, cwd: string): string {
  if (filePath === "~") return os.homedir();
  if (filePath.startsWith("~/")) return path.join(os.homedir(), filePath.slice(2));
  return path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);
}

function displayPath(filePath: string, cwd: string): string {
  const resolved = resolveForDisplay(filePath, cwd);
  const relative = path.relative(cwd, resolved);
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
    return relative;
  }
  return filePath;
}

function dedupeFileRefs(refs: FileRef[], cwd: string): FileRef[] {
  const seen = new Set<string>();
  const deduped: FileRef[] = [];

  for (const ref of refs) {
    const resolved = resolveForDisplay(ref.path, cwd);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    deduped.push(ref);
  }

  return deduped;
}

function extractText(blocks: Array<TextBlock | ImageBlock>): string {
  return blocks
    .filter((block): block is TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

function extractImages(blocks: Array<TextBlock | ImageBlock>): ImageContent[] {
  return blocks
    .filter((block): block is ImageBlock => block.type === "image")
    .map((block) => ({
      type: "image",
      data: block.data,
      mimeType: block.mimeType,
    }));
}

export default defineManagedExtension({
  name: "interactive-at-read",
  featureFlag: "ccLike",
  setup(pi) {
    if (isFeatureFlagEnabled("headless")) return;

    pi.registerMessageRenderer<ReadMarkerDetails>(MESSAGE_TYPE, (message, _options, _theme) => {
      const markdown = message.details?.markdown;
      if (!markdown) return undefined;
      return new Markdown(markdown, 0, 0, getMarkdownTheme());
    });

    pi.on("input", async (event, ctx) => {
      if (ctx.mode !== "tui") return { action: "continue" as const };
      if (event.source === "extension") return { action: "continue" as const };
      if (!event.text.includes("@")) return { action: "continue" as const };

      const refs = dedupeFileRefs(extractFileRefs(event.text), ctx.cwd);
      if (refs.length === 0) return { action: "continue" as const };

      const readTool = createReadToolDefinition(ctx.cwd);
      const readSections: string[] = [];
      const readImages: ImageContent[] = [];
      const markerPaths: string[] = [];

      for (const ref of refs) {
        const resolvedPath = resolveForDisplay(ref.path, ctx.cwd);
        markerPaths.push(displayPath(ref.path, ctx.cwd));

        try {
          const result = await readTool.execute("", { path: ref.path }, ctx.signal, undefined, {
            model: ctx.model,
          } as never);
          const blocks = result.content as Array<TextBlock | ImageBlock>;
          const text = extractText(blocks);
          const images = extractImages(blocks);

          if (text) {
            readSections.push(`<read-file path="${resolvedPath}">\n${text}\n</read-file>`);
          }

          readImages.push(...images);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          readSections.push(
            `<read-file path="${resolvedPath}">\n[read failed: ${message}]\n</read-file>`,
          );
        }
      }

      const hiddenText = `<attached-read-results>\n${readSections.join("\n\n")}\n</attached-read-results>`;
      const hiddenContent = [{ type: "text", text: hiddenText } as const, ...readImages];
      const marker = `  └ _[Read: ${markerPaths.join(", ")}]_`;

      pi.sendMessage(
        {
          customType: MESSAGE_TYPE,
          content: hiddenContent,
          display: true,
          details: { markdown: marker },
        },
        { deliverAs: "nextTurn" },
      );

      await pi.sendUserMessage(
        event.images && event.images.length > 0
          ? ([{ type: "text", text: event.text }, ...event.images] as const)
          : event.text,
      );

      return { action: "handled" as const };
    });
  },
});
