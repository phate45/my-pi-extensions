import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import frontmatterTimestampsExtension from "../../extensions/my-stuff/frontmatter-timestamps.js";
import {
  resetBundleConfigForTests,
  setBundleConfigForTests,
} from "../../extensions/infra/lib/bundle-config.js";
import { createMockExtensionAPI } from "../helpers/mock-extension-api.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "frontmatter-timestamps-test-"));
});

afterEach(async () => {
  resetBundleConfigForTests();
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

describe("frontmatter-timestamps extension", () => {
  test("registers tool_result handler when enabled", () => {
    const { pi, handlers } = createMockExtensionAPI();

    frontmatterTimestampsExtension(pi);

    expect(handlers.get("tool_result")?.length).toBe(1);
  });

  test("skips registration when disabled in bundle config", () => {
    const { pi, handlers } = createMockExtensionAPI();
    setBundleConfigForTests({
      extensions: {
        "frontmatter-timestamps": { enabled: false },
      },
    });

    frontmatterTimestampsExtension(pi);

    expect([...handlers.keys()]).toEqual([]);
  });

  test("skips registration when the myStuff feature flag is disabled", () => {
    const { pi, handlers } = createMockExtensionAPI();
    setBundleConfigForTests({
      featureFlags: {
        myStuff: false,
      },
      extensions: {
        "frontmatter-timestamps": { enabled: true },
      },
    });

    frontmatterTimestampsExtension(pi);

    expect([...handlers.keys()]).toEqual([]);
  });

  test("updates modified timestamp for markdown files after write", async () => {
    const notePath = path.join(tempDir, "Note.md");
    await writeFile(
      notePath,
      [
        "---",
        "created: 2026-06-21T10:00:00+00:00",
        "modified: 2026-06-21T10:00:00+00:00",
        "---",
        "",
        "hello",
      ].join("\n"),
      "utf8",
    );

    const { pi, handlers } = createMockExtensionAPI();
    frontmatterTimestampsExtension(pi);

    const handler = handlers.get("tool_result")?.[0];
    await handler(
      {
        isError: false,
        toolName: "write",
        input: { path: notePath },
      },
      {
        hasUI: false,
        sessionManager: {
          getCwd: () => tempDir,
        },
      },
    );

    const content = await readFile(notePath, "utf8");
    expect(content).toContain("created: 2026-06-21T10:00:00+00:00");
    expect(content).not.toContain("modified: 2026-06-21T10:00:00+00:00");
    expect(content).toMatch(/modified: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(content).not.toMatch(/modified: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}/);
  });

  test("includes timezone offset when configured", async () => {
    const notePath = path.join(tempDir, "Zoned.md");
    await writeFile(
      notePath,
      [
        "---",
        "created: 2026-06-21T10:00:00",
        "modified: 2026-06-21T10:00:00",
        "---",
        "",
        "hello",
      ].join("\n"),
      "utf8",
    );

    setBundleConfigForTests({
      extensions: {
        "frontmatter-timestamps": {
          config: {
            includeTimezone: true,
          },
        },
      },
    });

    const { pi, handlers } = createMockExtensionAPI();
    frontmatterTimestampsExtension(pi);

    const handler = handlers.get("tool_result")?.[0];
    await handler(
      {
        isError: false,
        toolName: "write",
        input: { path: notePath },
      },
      {
        hasUI: false,
        sessionManager: {
          getCwd: () => tempDir,
        },
      },
    );

    const content = await readFile(notePath, "utf8");
    expect(content).toMatch(/modified: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}/);
  });

  test("reads config at handler runtime instead of capturing setup-time values", async () => {
    const notePath = path.join(tempDir, "RuntimeConfig.md");
    await writeFile(
      notePath,
      [
        "---",
        "created: 2026-06-21T10:00:00",
        "modified: 2026-06-21T10:00:00",
        "---",
        "",
        "hello",
      ].join("\n"),
      "utf8",
    );

    const { pi, handlers } = createMockExtensionAPI();
    frontmatterTimestampsExtension(pi);

    setBundleConfigForTests({
      extensions: {
        "frontmatter-timestamps": {
          config: {
            includeTimezone: true,
          },
        },
      },
    });

    const handler = handlers.get("tool_result")?.[0];
    await handler(
      {
        isError: false,
        toolName: "write",
        input: { path: notePath },
      },
      {
        hasUI: false,
        sessionManager: {
          getCwd: () => tempDir,
        },
      },
    );

    const content = await readFile(notePath, "utf8");
    expect(content).toMatch(/modified: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}/);
  });

  test("ignores non-markdown files by default", async () => {
    const filePath = path.join(tempDir, "config.json");
    const original = '{\n  "hello": true\n}\n';
    await writeFile(filePath, original, "utf8");

    const { pi, handlers } = createMockExtensionAPI();
    frontmatterTimestampsExtension(pi);

    const handler = handlers.get("tool_result")?.[0];
    await handler(
      {
        isError: false,
        toolName: "write",
        input: { path: filePath },
      },
      {
        hasUI: false,
        sessionManager: {
          getCwd: () => tempDir,
        },
      },
    );

    expect(await readFile(filePath, "utf8")).toBe(original);
  });

  test("respects configured include paths", async () => {
    const trackedDir = path.join(tempDir, "tracked");
    const skippedDir = path.join(tempDir, "skipped");
    const trackedPath = path.join(trackedDir, "Tracked.md");
    const skippedPath = path.join(skippedDir, "Skipped.md");

    await Bun.write(
      trackedPath,
      "---\ncreated: 2026-06-21T10:00:00+00:00\nmodified: 2026-06-21T10:00:00+00:00\n---\n\ntracked\n",
    );
    await Bun.write(
      skippedPath,
      "---\ncreated: 2026-06-21T10:00:00+00:00\nmodified: 2026-06-21T10:00:00+00:00\n---\n\nskipped\n",
    );

    setBundleConfigForTests({
      extensions: {
        "frontmatter-timestamps": {
          config: {
            includePaths: [trackedDir],
          },
        },
      },
    });

    const { pi, handlers } = createMockExtensionAPI();
    frontmatterTimestampsExtension(pi);
    const handler = handlers.get("tool_result")?.[0];

    await handler(
      {
        isError: false,
        toolName: "edit",
        input: {
          multi: [{ path: trackedPath }, { path: skippedPath }],
        },
      },
      {
        hasUI: false,
        sessionManager: {
          getCwd: () => tempDir,
        },
      },
    );

    const tracked = await readFile(trackedPath, "utf8");
    const skipped = await readFile(skippedPath, "utf8");

    expect(tracked).not.toContain("modified: 2026-06-21T10:00:00+00:00");
    expect(skipped).toContain("modified: 2026-06-21T10:00:00+00:00");
  });
});
