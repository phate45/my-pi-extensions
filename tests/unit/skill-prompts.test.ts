import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import skillPromptsExtension from "../../extensions/cc-like/skill-prompts.js";
import { resetBundleConfigForTests } from "../../extensions/infra/lib/bundle-config.js";
import { createMockExtensionAPI } from "../helpers/mock-extension-api.js";

const tempDirs: string[] = [];
const originalArgv = [...process.argv];

async function makeTempDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "skill-prompts-"));
  tempDirs.push(dir);
  return dir;
}

async function writeSkill(projectDir: string, name = "demo-skill") {
  const skillDir = path.join(projectDir, ".claude", "skills", name);
  await mkdir(skillDir, { recursive: true });
  const skillPath = path.join(skillDir, "SKILL.md");
  await writeFile(
    skillPath,
    `---\nname: ${name}\ndescription: Demo skill for testing.\n---\n\n# Demo\n\nUse this.\n`,
  );
  return skillPath;
}

async function writeClaudeCommand(projectDir: string, name = "demo-command") {
  const commandDir = path.join(projectDir, ".claude", "commands");
  await mkdir(commandDir, { recursive: true });
  const commandPath = path.join(commandDir, `${name}.md`);
  await writeFile(
    commandPath,
    `---\ndescription: Demo Claude command for testing.\n---\n\n# Demo Command\n\nArgument: $ARGUMENTS\n`,
  );
  return commandPath;
}

afterEach(async () => {
  resetBundleConfigForTests();
  process.argv = [...originalArgv];

  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) continue;
    await rm(dir, { recursive: true, force: true });
  }
});

describe("skill-prompts extension", () => {
  test("registers prompt-shim and input handlers when enabled", () => {
    const { pi, handlers } = createMockExtensionAPI();

    skillPromptsExtension(pi);

    expect(handlers.get("resources_discover")?.length).toBe(1);
    expect(handlers.get("session_start")?.length).toBe(1);
    expect(handlers.get("input")?.length).toBe(1);
  });

  test("expands /skill commands directly from Claude skills under --no-skills", async () => {
    const root = await makeTempDir();
    await writeSkill(root);
    process.argv = [process.argv[0] ?? "node", process.argv[1] ?? "test", "--no-skills"];

    const { pi, handlers } = createMockExtensionAPI();
    skillPromptsExtension(pi);

    const input = handlers.get("input")?.[0];
    const result = await input?.(
      { text: "/skill:demo-skill test-arg", images: [] },
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
      text: expect.stringContaining('<skill name="demo-skill"'),
    });
    expect(result.text).toContain("ARGUMENTS: test-arg");
  });

  test("funnels .claude/commands through the invocation pipeline", async () => {
    const root = await makeTempDir();
    const commandPath = await writeClaudeCommand(root);

    const { pi, handlers } = createMockExtensionAPI();
    (pi as any).getCommands = () => [
      { name: "demo-command", source: "prompt", sourceInfo: { path: commandPath } },
    ];
    skillPromptsExtension(pi);

    const input = handlers.get("input")?.[0];
    const result = await input?.(
      { text: "/demo-command hello world", images: [] },
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
      text: expect.stringContaining('<claude-command name="demo-command"'),
    });
    expect(result.text).toContain("Argument: hello world");
  });

  test("skips registration in headless mode", () => {
    process.argv = [process.argv[0] ?? "node", process.argv[1] ?? "test", "-p"];

    const { pi, handlers } = createMockExtensionAPI();
    skillPromptsExtension(pi);

    expect([...handlers.keys()]).toEqual([]);
  });
});
