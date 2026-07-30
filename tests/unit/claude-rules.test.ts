import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import claudeRulesExtension from "../../extensions/cc-like/claude-rules.js";
import {
  discoverClaudeRulesInDirectories,
  extractClaudeRuleTarget,
  ruleMatchesTarget,
} from "../../extensions/cc-like/lib/claude-rules.js";
import { resetProjectRootCacheForTests } from "../../extensions/cc-like/lib/git-project-root.js";
import {
  resetBundleConfigForTests,
  setBundleConfigForTests,
} from "../../extensions/infra/lib/bundle-config.js";
import { createMockExtensionAPI } from "../helpers/mock-extension-api.js";

const tempDirs: string[] = [];
const originalClaudeProjectDir = process.env.CLAUDE_PROJECT_DIR;

async function makeTempDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "claude-rules-"));
  tempDirs.push(dir);
  return dir;
}

async function writeRule(root: string, relativePath: string, content: string) {
  const target = path.join(root, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
}

afterEach(async () => {
  resetBundleConfigForTests();
  resetProjectRootCacheForTests();
  if (originalClaudeProjectDir === undefined) delete process.env.CLAUDE_PROJECT_DIR;
  else process.env.CLAUDE_PROJECT_DIR = originalClaudeProjectDir;

  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

describe("Claude rule discovery", () => {
  test("parses YAML paths, recurses, and lets higher-priority roots override by relative path", async () => {
    const root = await makeTempDir();
    const projectRules = path.join(root, "project-rules");
    const globalRules = path.join(root, "global-rules");
    await writeRule(globalRules, "style.md", "Global style");
    await writeRule(globalRules, "backend/auth.md", "Global auth");
    await writeRule(
      projectRules,
      "backend/auth.md",
      '---\npaths:\n  - "src/**/*.{ts,tsx}"\n  - .github/**\n---\nProject auth',
    );

    const result = await discoverClaudeRulesInDirectories([projectRules, globalRules]);

    expect(result.diagnostics).toEqual([]);
    expect(result.rules.map((rule) => rule.sourcePath)).toEqual([
      path.join(globalRules, "style.md"),
      path.join(projectRules, "backend/auth.md"),
    ]);
    expect(result.rules[1]?.paths).toEqual(["src/**/*.{ts,tsx}", ".github/**"]);
    expect(result.rules[1]?.body).toBe("Project auth");
  });

  test("follows symlinked directories without looping", async () => {
    const root = await makeTempDir();
    const rules = path.join(root, "rules");
    const shared = path.join(root, "shared");
    await writeRule(shared, "team.md", "Shared rule");
    await mkdir(rules, { recursive: true });
    await symlink(shared, path.join(rules, "team"));
    await symlink(rules, path.join(shared, "loop"));

    const result = await discoverClaudeRulesInDirectories([rules]);

    expect(result.rules.map((rule) => rule.body)).toEqual(["Shared rule"]);
  });

  test("diagnoses malformed frontmatter without dropping valid siblings", async () => {
    const root = await makeTempDir();
    await writeRule(root, "bad.md", "---\npaths: [src/**\n---\nBad");
    await writeRule(root, "valid.md", "Valid");

    const result = await discoverClaudeRulesInDirectories([root]);

    expect(result.rules.map((rule) => rule.body)).toEqual(["Valid"]);
    expect(result.diagnostics[0]?.reason).toMatch(/invalid YAML/);
  });

  test("matches project-relative paths including dotfiles and rejects outside targets", () => {
    const rule = {
      id: "rule",
      sourcePath: "/repo/.claude/rules/typed.md",
      sourceLabel: ".claude/rules/typed.md",
      relativePath: "typed.md",
      body: "Typed",
      paths: ["./src/**/*.{ts,tsx}", ".github/**"],
      priority: 0,
    };

    expect(ruleMatchesTarget(rule, "src/app.tsx")).toBe(true);
    expect(ruleMatchesTarget(rule, ".github/workflows/ci.yml")).toBe(true);
    expect(ruleMatchesTarget(rule, "README.md")).toBe(false);
    expect(extractClaudeRuleTarget("@src/app.ts", "/repo", "/repo")).toBe("src/app.ts");
    expect(extractClaudeRuleTarget("../outside.ts", "/repo", "/repo")).toBeUndefined();
  });
});

describe("claude-rules extension", () => {
  test("skips registration when the extension or ccLike feature is disabled", () => {
    for (const config of [
      { extensions: { "claude-rules": { enabled: false } } },
      {
        featureFlags: { ccLike: false },
        extensions: { "claude-rules": { enabled: true } },
      },
    ]) {
      resetBundleConfigForTests();
      setBundleConfigForTests(config);
      const mock = createMockExtensionAPI();
      claudeRulesExtension(mock.pi);
      expect([...mock.handlers.keys()]).toEqual([]);
    }
  });

  test("injects unconditional rules before the first model call only", async () => {
    const project = await makeTempDir();
    await writeRule(project, ".claude/rules/base.md", "Always follow this rule.");
    process.env.CLAUDE_PROJECT_DIR = project;
    const { pi, handlers } = createMockExtensionAPI();
    claudeRulesExtension(pi);
    const ctx = { cwd: project, hasUI: false, sessionManager: { getSessionId: () => "one" } };

    await handlers.get("session_start")?.[0]?.({ reason: "startup" }, ctx);
    const first = await handlers.get("before_agent_start")?.[0]?.({ systemPrompt: "BASE" }, ctx);
    const second = await handlers.get("before_agent_start")?.[0]?.({ systemPrompt: "BASE" }, ctx);

    expect(first.message.content).toContain("Always follow this rule.");
    expect(second).toBeUndefined();
  });

  test("queues scoped rules after reads without blocking", async () => {
    const project = await makeTempDir();
    await writeRule(
      project,
      ".claude/rules/typed.md",
      "---\npaths: src/**\n---\nUse strict types.",
    );
    process.env.CLAUDE_PROJECT_DIR = project;
    const mock = createMockExtensionAPI();
    claudeRulesExtension(mock.pi);
    const ctx = { cwd: project, hasUI: false, sessionManager: { getSessionId: () => "one" } };
    await mock.handlers.get("session_start")?.[0]?.({ reason: "startup" }, ctx);

    const call = await mock.handlers.get("tool_call")?.[0]?.(
      { toolName: "read", input: { path: "src/app.ts" } },
      ctx,
    );
    await mock.handlers.get("turn_end")?.[0]?.({}, ctx);

    expect(call).toBeUndefined();
    expect(mock.sentMessages).toHaveLength(1);
    expect(mock.sentMessages[0]).toMatchObject({ options: { deliverAs: "steer" } });
    expect(JSON.stringify(mock.sentMessages[0])).toContain("Use strict types.");
  });

  for (const toolName of ["edit", "write"] as const) {
    test(`blocks the first matching ${toolName} and allows retry after rule injection`, async () => {
      const project = await makeTempDir();
      await writeRule(
        project,
        ".claude/rules/typed.md",
        "---\npaths: src/**\n---\nUse strict types.",
      );
      process.env.CLAUDE_PROJECT_DIR = project;
      const mock = createMockExtensionAPI();
      claudeRulesExtension(mock.pi);
      const ctx = { cwd: project, hasUI: false, sessionManager: { getSessionId: () => "one" } };
      await mock.handlers.get("session_start")?.[0]?.({ reason: "startup" }, ctx);
      const event = { toolName, input: { path: "src/app.ts" } };

      const first = await mock.handlers.get("tool_call")?.[0]?.(event, ctx);
      await mock.handlers.get("turn_end")?.[0]?.({}, ctx);
      const retry = await mock.handlers.get("tool_call")?.[0]?.(event, ctx);

      expect(first).toMatchObject({ block: true });
      expect(mock.sentMessages).toHaveLength(1);
      expect(retry).toBeUndefined();
    });
  }

  test("aggregates parallel matching mutations into one rule injection", async () => {
    const project = await makeTempDir();
    await writeRule(project, ".claude/rules/typed.md", "---\npaths: src/**\n---\nTyped rule");
    process.env.CLAUDE_PROJECT_DIR = project;
    const mock = createMockExtensionAPI();
    claudeRulesExtension(mock.pi);
    const ctx = { cwd: project, hasUI: false, sessionManager: { getSessionId: () => "one" } };
    await mock.handlers.get("session_start")?.[0]?.({ reason: "startup" }, ctx);

    const handler = mock.handlers.get("tool_call")?.[0];
    const first = await handler?.({ toolName: "edit", input: { path: "src/a.ts" } }, ctx);
    const second = await handler?.({ toolName: "write", input: { path: "src/b.ts" } }, ctx);
    await mock.handlers.get("turn_end")?.[0]?.({}, ctx);

    expect(first).toMatchObject({ block: true });
    expect(second).toMatchObject({ block: true });
    expect(mock.sentMessages).toHaveLength(1);
    expect(JSON.stringify(mock.sentMessages[0])).toContain("src/a.ts");
    expect(JSON.stringify(mock.sentMessages[0])).toContain("src/b.ts");
  });

  test("reinjects unconditional and scoped rules after compaction", async () => {
    const project = await makeTempDir();
    await writeRule(project, ".claude/rules/base.md", "Base rule");
    await writeRule(project, ".claude/rules/typed.md", "---\npaths: src/**\n---\nTyped rule");
    process.env.CLAUDE_PROJECT_DIR = project;
    const mock = createMockExtensionAPI();
    claudeRulesExtension(mock.pi);
    const ctx = { cwd: project, hasUI: false, sessionManager: { getSessionId: () => "one" } };
    await mock.handlers.get("session_start")?.[0]?.({ reason: "startup" }, ctx);
    await mock.handlers.get("before_agent_start")?.[0]?.({ systemPrompt: "BASE" }, ctx);
    await mock.handlers.get("tool_call")?.[0]?.(
      { toolName: "read", input: { path: "src/a.ts" } },
      ctx,
    );
    await mock.handlers.get("turn_end")?.[0]?.({}, ctx);

    await mock.handlers.get("session_compact")?.[0]?.({}, ctx);
    await mock.handlers.get("tool_call")?.[0]?.(
      { toolName: "read", input: { path: "src/b.ts" } },
      ctx,
    );
    await mock.handlers.get("turn_end")?.[0]?.({}, ctx);

    expect(mock.sentMessages).toHaveLength(3);
    expect(JSON.stringify(mock.sentMessages[1])).toContain("Base rule");
    expect(JSON.stringify(mock.sentMessages[2])).toContain("Typed rule");
  });

  test("honors source config and CLAUDE_PROJECT_DIR", async () => {
    const root = await makeTempDir();
    const project = path.join(root, "project");
    const sandbox = path.join(root, "sandbox");
    await writeRule(project, ".claude/rules/project.md", "Project rule");
    await writeRule(root, ".claude/rules/global.md", "Ancestor global rule");
    await mkdir(sandbox, { recursive: true });
    process.env.CLAUDE_PROJECT_DIR = project;
    setBundleConfigForTests({
      extensions: {
        "claude-rules": { enabled: true, config: { global: false, project: true } },
      },
    });
    const mock = createMockExtensionAPI();
    claudeRulesExtension(mock.pi);
    const ctx = { cwd: sandbox, hasUI: false, sessionManager: { getSessionId: () => "one" } };

    await mock.handlers.get("session_start")?.[0]?.({ reason: "startup" }, ctx);
    const injection = await mock.handlers.get("before_agent_start")?.[0]?.(
      { systemPrompt: "BASE" },
      ctx,
    );

    expect(injection.message.content).toContain("Project rule");
    expect(injection.message.content).not.toContain("Ancestor global rule");
  });
});
