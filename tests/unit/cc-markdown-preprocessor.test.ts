import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ccMarkdownPreprocessorExtension from "../../extensions/cc-like/cc-markdown-preprocessor.js";
import { resetBundleConfigForTests } from "../../extensions/infra/lib/bundle-config.js";
import { createMockExtensionAPI } from "../helpers/mock-extension-api.js";

const tempDirs: string[] = [];

async function makeTempDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cc-markdown-preprocessor-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  resetBundleConfigForTests();

  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) continue;
    await rm(dir, { recursive: true, force: true });
  }
});

describe("cc-markdown-preprocessor extension", () => {
  test("continues past .claude/commands so skill-prompts can intercept them", async () => {
    const root = await makeTempDir();
    const commandDir = path.join(root, ".claude", "commands");
    await mkdir(commandDir, { recursive: true });
    const commandPath = path.join(commandDir, "demo-command.md");
    await writeFile(commandPath, "# Demo\n");

    const { pi, handlers } = createMockExtensionAPI();
    (pi as any).getCommands = () => [
      { name: "demo-command", source: "prompt", sourceInfo: { path: commandPath } },
    ];
    ccMarkdownPreprocessorExtension(pi);

    const input = handlers.get("input")?.[0];
    const result = await input?.(
      { text: "/demo-command arg", images: [] },
      {
        cwd: root,
        ui: {
          notify() {},
        },
      },
    );

    expect(result).toEqual({ action: "continue" });
  });

  test("still expands ordinary Pi prompt templates inline", async () => {
    const root = await makeTempDir();
    const promptDir = path.join(root, ".pi", "prompts");
    await mkdir(promptDir, { recursive: true });
    const promptPath = path.join(promptDir, "demo.md");
    await writeFile(promptPath, "---\ndescription: Demo prompt\n---\n\nHello $ARGUMENTS\n");

    const { pi, handlers } = createMockExtensionAPI();
    (pi as any).getCommands = () => [
      { name: "demo", source: "prompt", sourceInfo: { path: promptPath } },
    ];
    ccMarkdownPreprocessorExtension(pi);

    const input = handlers.get("input")?.[0];
    const result = await input?.(
      { text: "/demo world", images: [] },
      {
        cwd: root,
        ui: {
          notify() {},
        },
      },
    );

    expect(result).toEqual({
      action: "transform",
      images: [],
      text: "Hello world",
    });
  });
});
