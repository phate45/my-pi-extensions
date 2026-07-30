import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import skillToolExtension from "../../extensions/cc-like/skill-tool.js";
import { resetBundleConfigForTests } from "../../extensions/infra/lib/bundle-config.js";
import { createMockExtensionAPI } from "../helpers/mock-extension-api.js";

const tempDirs: string[] = [];
const originalArgv = [...process.argv];

async function makeTempDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "skill-tool-"));
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

afterEach(async () => {
  resetBundleConfigForTests();
  process.argv = [...originalArgv];

  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) continue;
    await rm(dir, { recursive: true, force: true });
  }
});

describe("skill-tool extension", () => {
  test("registers the model-facing skill tool when skills are enabled", async () => {
    const root = await makeTempDir();
    const skillPath = await writeSkill(root);
    const { pi, handlers, tools } = createMockExtensionAPI();
    (pi as any).getCommands = () => [{ source: "skill", sourceInfo: { path: skillPath } }];

    skillToolExtension(pi);

    const sessionStart = handlers.get("session_start")?.[0];
    await sessionStart?.({}, {});

    const beforeAgentStart = handlers.get("before_agent_start")?.[0];
    const result = await beforeAgentStart?.({ systemPrompt: "base prompt" });

    expect(handlers.get("session_start")?.length).toBe(1);
    expect(handlers.get("before_agent_start")?.length).toBe(1);
    expect(tools).toHaveLength(1);
    expect((tools[0] as { name: string }).name).toBe("skill");
    expect(result).toEqual({
      systemPrompt: expect.stringContaining("Use the skill tool to execute/load a skill"),
    });
  });

  test("does not expose the model-facing skill tool under --no-skills alone", async () => {
    process.argv = [process.argv[0] ?? "node", process.argv[1] ?? "test", "--no-skills"];

    const { pi, handlers, tools } = createMockExtensionAPI();
    skillToolExtension(pi);

    const sessionStart = handlers.get("session_start")?.[0];
    await sessionStart?.({}, {});

    expect(tools).toEqual([]);
  });

  test("exposes an explicitly loaded skill under --no-skills", async () => {
    const root = await makeTempDir();
    const skillPath = await writeSkill(root, "explicit-skill");
    process.argv = [
      process.argv[0] ?? "node",
      process.argv[1] ?? "test",
      "--no-skills",
      "--skill",
      skillPath,
    ];

    const { pi, handlers, tools } = createMockExtensionAPI();
    (pi as any).getCommands = () => [{ source: "skill", sourceInfo: { path: skillPath } }];
    skillToolExtension(pi);

    const sessionStart = handlers.get("session_start")?.[0];
    await sessionStart?.({}, {});
    const beforeAgentStart = handlers.get("before_agent_start")?.[0];
    const result = await beforeAgentStart?.({ systemPrompt: "base prompt" });

    expect(tools).toHaveLength(1);
    expect((tools[0] as { name: string }).name).toBe("skill");
    expect(result?.systemPrompt).toContain("<name>explicit-skill</name>");

    const toolResult = await (tools[0] as any).execute(
      "tool-call",
      { name: "explicit-skill" },
      undefined,
      undefined,
      { cwd: root },
    );
    const text = toolResult.content.map((item: { text: string }) => item.text).join("\n");
    expect(text).toContain('<skill name="explicit-skill"');
    expect(text).toContain("# Demo\n\nUse this.");
    expect(text).not.toContain("description: Demo skill for testing.");
  });

  test("enumerates multiple explicitly loaded skills under --no-skills", async () => {
    const root = await makeTempDir();
    const firstPath = await writeSkill(root, "first-skill");
    const secondPath = await writeSkill(root, "second-skill");
    process.argv = [
      process.argv[0] ?? "node",
      process.argv[1] ?? "test",
      "--no-skills",
      "--skill",
      firstPath,
      "--skill",
      secondPath,
    ];

    const { pi, handlers, tools } = createMockExtensionAPI();
    (pi as any).getCommands = () => [
      { source: "skill", sourceInfo: { path: firstPath } },
      { source: "skill", sourceInfo: { path: secondPath } },
    ];
    skillToolExtension(pi);

    const sessionStart = handlers.get("session_start")?.[0];
    await sessionStart?.({}, {});
    const beforeAgentStart = handlers.get("before_agent_start")?.[0];
    const result = await beforeAgentStart?.({ systemPrompt: "base prompt" });

    expect(tools).toHaveLength(1);
    expect(result?.systemPrompt).toContain("<name>first-skill</name>");
    expect(result?.systemPrompt).toContain("<name>second-skill</name>");
  });

  test("does not enumerate ambient skills in explicit-only mode", async () => {
    const root = await makeTempDir();
    const ambientPath = await writeSkill(root, "ambient-skill");
    const explicitRoot = await makeTempDir();
    const explicitPath = await writeSkill(explicitRoot, "explicit-skill");
    process.argv = [
      process.argv[0] ?? "node",
      process.argv[1] ?? "test",
      "--no-skills",
      "--skill",
      explicitPath,
    ];

    const { pi, handlers, tools } = createMockExtensionAPI();
    (pi as any).getCommands = () => [{ source: "skill", sourceInfo: { path: explicitPath } }];
    skillToolExtension(pi);

    const sessionStart = handlers.get("session_start")?.[0];
    await sessionStart?.({}, {});
    const beforeAgentStart = handlers.get("before_agent_start")?.[0];
    const result = await beforeAgentStart?.({ systemPrompt: "base prompt" });

    expect(ambientPath).not.toBe(explicitPath);
    expect(result?.systemPrompt).toContain("<name>explicit-skill</name>");
    expect(result?.systemPrompt).not.toContain("ambient-skill");

    const toolResult = await (tools[0] as any).execute(
      "tool-call",
      { name: "ambient-skill" },
      undefined,
      undefined,
      { cwd: root },
    );
    expect(toolResult.content[0]?.text).toContain("Skill not found: ambient-skill");
    expect(toolResult.content[0]?.text).toContain("Available skills: explicit-skill");
  });
});
