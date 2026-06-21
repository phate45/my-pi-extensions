import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { expandClaudeMarkdownResource } from "../../extensions/cc-like/lib/claude-markdown-expansion.js";
import {
  resetBundleConfigForTests,
  setBundleConfigForTests,
} from "../../extensions/infra/lib/bundle-config.js";

const tempDirs: string[] = [];

async function makeTempDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "claude-markdown-expansion-"));
  tempDirs.push(dir);
  return dir;
}

function createMockPi(
  execImpl: (command: string) => { stdout: string; stderr: string; code: number | null },
): ExtensionAPI {
  return {
    exec: async (_program, argv) => execImpl(String(argv[1])),
  } as unknown as ExtensionAPI;
}

function createCtx(cwd: string): ExtensionContext {
  return { cwd, signal: new AbortController().signal } as ExtensionContext;
}

afterEach(async () => {
  resetBundleConfigForTests();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) continue;
    await rm(dir, { recursive: true, force: true });
  }
});

describe("claude markdown expansion", () => {
  test("inlines stdout on success and preserves xml on failure", async () => {
    const dir = await makeTempDir();
    const resourcePath = path.join(dir, "prompt.md");
    await writeFile(resourcePath, ["before", "! ok", "! fail", "after"].join("\n"));

    const pi = createMockPi((command) =>
      command === "ok"
        ? { stdout: "nice\n", stderr: "", code: 0 }
        : { stdout: "", stderr: "boom\n", code: 1 },
    );

    const expanded = await expandClaudeMarkdownResource(
      await Bun.file(resourcePath).text(),
      resourcePath,
      createCtx(dir),
      pi,
    );

    expect(expanded).toContain("before\nnice");
    expect(expanded).toContain('<command-output command="fail" exit_code=1>');
    expect(expanded).toContain("<stderr>\nboom");
    expect(expanded).toContain("after");
  });

  test("supports inline file embeds for system-style expansion", async () => {
    const dir = await makeTempDir();
    const refsDir = path.join(dir, "refs");
    await mkdir(refsDir, { recursive: true });
    await writeFile(path.join(refsDir, "note.md"), "hello from file\n");
    const resourcePath = path.join(dir, "SYSTEM.md");
    await writeFile(resourcePath, "@refs/note.md\n! ok\n");

    const expanded = await expandClaudeMarkdownResource(
      await Bun.file(resourcePath).text(),
      resourcePath,
      createCtx(dir),
      createMockPi(() => ({ stdout: "shell says hi\n", stderr: "", code: 0 })),
      { fileRenderMode: "inline" },
    );

    expect(expanded).toContain("hello from file");
    expect(expanded).toContain("shell says hi");
    expect(expanded).not.toContain("<file-content");
  });

  test("can disable interpolation globally via bundle config", async () => {
    const dir = await makeTempDir();
    const resourcePath = path.join(dir, "prompt.md");
    await writeFile(resourcePath, ["before", "! ok", "@missing.txt", "after"].join("\n"));
    setBundleConfigForTests({
      extensions: {
        "claude-markdown-expansion": {
          config: { disabled: true },
        },
      },
    });

    const expanded = await expandClaudeMarkdownResource(
      await Bun.file(resourcePath).text(),
      resourcePath,
      createCtx(dir),
      createMockPi(() => ({ stdout: "nice\n", stderr: "", code: 0 })),
    );

    expect(expanded).toBe("before\n! ok\n@missing.txt\nafter");
  });

  test("can disable only bash interpolation", async () => {
    const dir = await makeTempDir();
    const refsDir = path.join(dir, "refs");
    await mkdir(refsDir, { recursive: true });
    await writeFile(path.join(refsDir, "note.md"), "hello from file\n");
    const resourcePath = path.join(dir, "prompt.md");
    await writeFile(resourcePath, ["before", "! ok", "@refs/note.md", "after"].join("\n"));
    setBundleConfigForTests({
      extensions: {
        "claude-markdown-expansion": {
          config: { disableBash: true },
        },
      },
    });

    const expanded = await expandClaudeMarkdownResource(
      await Bun.file(resourcePath).text(),
      resourcePath,
      createCtx(dir),
      createMockPi(() => ({ stdout: "nice\n", stderr: "", code: 0 })),
    );

    expect(expanded).toContain("! ok");
    expect(expanded).toContain('<file-content path="refs/note.md"');
  });

  test("can disable only include interpolation", async () => {
    const dir = await makeTempDir();
    const refsDir = path.join(dir, "refs");
    await mkdir(refsDir, { recursive: true });
    await writeFile(path.join(refsDir, "note.md"), "hello from file\n");
    const resourcePath = path.join(dir, "prompt.md");
    await writeFile(resourcePath, ["before", "! ok", "@refs/note.md", "after"].join("\n"));
    setBundleConfigForTests({
      extensions: {
        "claude-markdown-expansion": {
          config: { disableIncludes: true },
        },
      },
    });

    const expanded = await expandClaudeMarkdownResource(
      await Bun.file(resourcePath).text(),
      resourcePath,
      createCtx(dir),
      createMockPi(() => ({ stdout: "nice\n", stderr: "", code: 0 })),
    );

    expect(expanded).toContain("nice");
    expect(expanded).toContain("@refs/note.md");
  });
});
