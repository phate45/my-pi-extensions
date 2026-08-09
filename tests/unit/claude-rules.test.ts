import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import claudeRulesExtension from "../../extensions/cc-like/claude-rules.js";
import {
  discoverClaudeRulesInDirectories,
  discoverNestedClaudeRuleDirectories,
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

  test("discovers nested rule roots only along the target ancestry", async () => {
    const root = await makeTempDir();
    await writeRule(root, "packages/.claude/rules/shared.md", "Shared package rule");
    await writeRule(root, "packages/foo/.claude/rules/local.md", "Foo rule");
    await writeRule(root, "packages/bar/.claude/rules/local.md", "Bar rule");

    const directories = discoverNestedClaudeRuleDirectories(root, "packages/foo/src/service.ts");

    expect(directories).toEqual([
      {
        directory: path.join(root, "packages/.claude/rules"),
        scopePath: "packages",
      },
      {
        directory: path.join(root, "packages/foo/.claude/rules"),
        scopePath: "packages/foo",
      },
    ]);
  });

  test("matches nested rule paths relative to their owning package", () => {
    const rule = {
      id: "nested-rule",
      sourcePath: "/repo/packages/foo/.claude/rules/typed.md",
      sourceLabel: "packages/foo/.claude/rules/typed.md",
      relativePath: "typed.md",
      scopePath: "packages/foo",
      body: "Typed",
      paths: ["src/**"],
      priority: -1,
    };

    expect(ruleMatchesTarget(rule, "packages/foo/src/app.ts")).toBe(true);
    expect(ruleMatchesTarget(rule, "packages/foo/test/app.ts")).toBe(false);
    expect(ruleMatchesTarget(rule, "packages/bar/src/app.ts")).toBe(false);
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

  test("loads nested unconditional rules from the launch directory", async () => {
    const project = await makeTempDir();
    const packageDir = path.join(project, "packages", "foo");
    await mkdir(packageDir, { recursive: true });
    execFileSync("git", ["init", project], { stdio: "ignore" });
    await writeRule(project, ".claude/rules/base.md", "Project rule.");
    await writeRule(packageDir, ".claude/rules/local.md", "Package rule.");
    const mock = createMockExtensionAPI();
    claudeRulesExtension(mock.pi);
    const ctx = { cwd: packageDir, hasUI: false, sessionManager: { getSessionId: () => "one" } };

    await mock.handlers.get("session_start")?.[0]?.({ reason: "startup" }, ctx);
    const injection = await mock.handlers.get("before_agent_start")?.[0]?.(
      { systemPrompt: "BASE" },
      ctx,
    );

    expect(injection.message.content).toContain("Project rule.");
    expect(injection.message.content).toContain("Package rule.");
  });

  test("loads nested unconditional rules lazily and isolates sibling packages", async () => {
    const project = await makeTempDir();
    await writeRule(
      project,
      "packages/foo/.claude/rules/local.md",
      "Only applies inside package foo.",
    );
    process.env.CLAUDE_PROJECT_DIR = project;
    const mock = createMockExtensionAPI();
    claudeRulesExtension(mock.pi);
    const ctx = { cwd: project, hasUI: false, sessionManager: { getSessionId: () => "one" } };
    await mock.handlers.get("session_start")?.[0]?.({ reason: "startup" }, ctx);

    const startup = await mock.handlers.get("before_agent_start")?.[0]?.(
      { systemPrompt: "BASE" },
      ctx,
    );
    expect(startup).toBeUndefined();

    await mock.handlers.get("tool_call")?.[0]?.(
      { toolName: "read", input: { path: "packages/bar/src/app.ts" } },
      ctx,
    );
    await mock.handlers.get("turn_end")?.[0]?.({}, ctx);
    expect(mock.sentMessages).toHaveLength(0);

    await mock.handlers.get("tool_call")?.[0]?.(
      { toolName: "read", input: { path: "packages/foo/src/app.ts" } },
      ctx,
    );
    await mock.handlers.get("turn_end")?.[0]?.({}, ctx);

    expect(mock.sentMessages).toHaveLength(1);
    expect(JSON.stringify(mock.sentMessages[0])).toContain("Only applies inside package foo.");
  });

  test("matches nested scoped rules package-relatively and blocks mutations", async () => {
    const project = await makeTempDir();
    await writeRule(
      project,
      "packages/foo/.claude/rules/typed.md",
      "---\npaths: src/**\n---\nUse package-local types.",
    );
    process.env.CLAUDE_PROJECT_DIR = project;
    const mock = createMockExtensionAPI();
    claudeRulesExtension(mock.pi);
    const ctx = { cwd: project, hasUI: false, sessionManager: { getSessionId: () => "one" } };
    await mock.handlers.get("session_start")?.[0]?.({ reason: "startup" }, ctx);
    const handler = mock.handlers.get("tool_call")?.[0];

    const sibling = await handler?.(
      { toolName: "edit", input: { path: "packages/bar/src/app.ts" } },
      ctx,
    );
    const first = await handler?.(
      { toolName: "edit", input: { path: "packages/foo/src/app.ts" } },
      ctx,
    );
    await mock.handlers.get("turn_end")?.[0]?.({}, ctx);
    const retry = await handler?.(
      { toolName: "edit", input: { path: "packages/foo/src/app.ts" } },
      ctx,
    );

    expect(sibling).toBeUndefined();
    expect(first).toMatchObject({ block: true });
    expect(JSON.stringify(mock.sentMessages[0])).toContain("Use package-local types.");
    expect(retry).toBeUndefined();
  });

  test("honors the project source switch for nested rules", async () => {
    const project = await makeTempDir();
    await writeRule(project, "packages/foo/.claude/rules/local.md", "Nested project rule.");
    process.env.CLAUDE_PROJECT_DIR = project;
    setBundleConfigForTests({
      extensions: {
        "claude-rules": { enabled: true, config: { global: false, project: false } },
      },
    });
    const mock = createMockExtensionAPI();
    claudeRulesExtension(mock.pi);
    const ctx = { cwd: project, hasUI: false, sessionManager: { getSessionId: () => "one" } };
    await mock.handlers.get("session_start")?.[0]?.({ reason: "startup" }, ctx);

    const result = await mock.handlers.get("tool_call")?.[0]?.(
      { toolName: "edit", input: { path: "packages/foo/src/app.ts" } },
      ctx,
    );
    await mock.handlers.get("turn_end")?.[0]?.({}, ctx);

    expect(result).toBeUndefined();
    expect(mock.sentMessages).toHaveLength(0);
  });

  test("composes same-named parent and child rules with the child last", async () => {
    const project = await makeTempDir();
    await writeRule(project, "packages/.claude/rules/style.md", "Parent package rule.");
    await writeRule(project, "packages/foo/.claude/rules/style.md", "Child package rule.");
    process.env.CLAUDE_PROJECT_DIR = project;
    const mock = createMockExtensionAPI();
    claudeRulesExtension(mock.pi);
    const ctx = { cwd: project, hasUI: false, sessionManager: { getSessionId: () => "one" } };
    await mock.handlers.get("session_start")?.[0]?.({ reason: "startup" }, ctx);

    await mock.handlers.get("tool_call")?.[0]?.(
      { toolName: "read", input: { path: "packages/foo/src/app.ts" } },
      ctx,
    );
    await mock.handlers.get("turn_end")?.[0]?.({}, ctx);

    const message = JSON.stringify(mock.sentMessages[0]);
    expect(message).toContain("Parent package rule.");
    expect(message).toContain("Child package rule.");
    expect(message.indexOf("Parent package rule.")).toBeLessThan(
      message.indexOf("Child package rule."),
    );
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
