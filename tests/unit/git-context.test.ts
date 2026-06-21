import { afterEach, describe, expect, test } from "bun:test";
import gitContextExtension from "../../extensions/cc-like/git-context.js";
import {
  resetBundleConfigForTests,
  setBundleConfigForTests,
} from "../../extensions/infra/lib/bundle-config.js";
import { createMockExtensionAPI } from "../helpers/mock-extension-api.js";

afterEach(() => {
  resetBundleConfigForTests();
});

describe("git-context extension", () => {
  const originalClaudeProjectDir = process.env.CLAUDE_PROJECT_DIR;

  afterEach(() => {
    if (originalClaudeProjectDir === undefined) delete process.env.CLAUDE_PROJECT_DIR;
    else process.env.CLAUDE_PROJECT_DIR = originalClaudeProjectDir;
  });

  test("registers handlers when enabled", () => {
    const { pi, handlers } = createMockExtensionAPI();

    gitContextExtension(pi);

    expect(handlers.get("session_start")?.length).toBe(1);
    expect(handlers.get("before_agent_start")?.length).toBe(1);
  });

  test("skips registration when disabled in bundle config", () => {
    const { pi, handlers } = createMockExtensionAPI();
    setBundleConfigForTests({
      extensions: {
        "git-context": { enabled: false },
      },
    });

    gitContextExtension(pi);

    expect([...handlers.keys()]).toEqual([]);
  });

  test("skips registration when the ccLike feature flag is disabled", () => {
    const { pi, handlers } = createMockExtensionAPI();
    setBundleConfigForTests({
      featureFlags: {
        ccLike: false,
      },
      extensions: {
        "git-context": { enabled: true },
      },
    });

    gitContextExtension(pi);

    expect([...handlers.keys()]).toEqual([]);
  });

  test("builds git context from CLAUDE_PROJECT_DIR instead of cwd", async () => {
    process.env.CLAUDE_PROJECT_DIR = "/real/project";

    const { pi, handlers } = createMockExtensionAPI();
    const execCalls: Array<{ args: string[]; cwd?: string }> = [];

    pi.exec = async (_command, args, options) => {
      execCalls.push({ args: args as string[], cwd: options?.cwd });

      const joined = (args as string[]).join(" ");
      if (joined.includes("rev-parse --is-inside-work-tree")) {
        return { stdout: "true\n", stderr: "", code: 0, killed: false };
      }
      if (joined.includes("branch --show-current")) {
        return { stdout: "master\n", stderr: "", code: 0, killed: false };
      }
      if (joined.includes("log --oneline -5")) {
        return { stdout: "abc123 commit\n", stderr: "", code: 0, killed: false };
      }
      if (joined.includes("status --short")) {
        return { stdout: "M file.ts\n", stderr: "", code: 0, killed: false };
      }
      return { stdout: "", stderr: "", code: 0, killed: false };
    };

    gitContextExtension(pi);

    const sessionStart = handlers.get("session_start")?.[0];
    const beforeAgentStart = handlers.get("before_agent_start")?.[0];

    await sessionStart?.({ reason: "startup" }, { cwd: "/sandbox/run", signal: undefined, ui: {} });

    const result = await beforeAgentStart?.({ systemPrompt: "Base\nCurrent date: 2026-06-21" });

    expect(execCalls.map((call) => call.args[1])).toEqual([
      "/real/project",
      "/real/project",
      "/real/project",
      "/real/project",
    ]);
    expect(result?.systemPrompt).toContain("# Git Context");
    expect(result?.systemPrompt).toContain("Branch: master");
  });
});
