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

  test("skips registration under --no-skills", async () => {
    const root = await makeTempDir();
    const skillPath = await writeSkill(root);
    process.argv = [process.argv[0] ?? "node", process.argv[1] ?? "test", "--no-skills"];

    const { pi, handlers, tools } = createMockExtensionAPI();
    (pi as any).getCommands = () => [{ source: "skill", sourceInfo: { path: skillPath } }];

    skillToolExtension(pi);

    expect([...handlers.keys()]).toEqual([]);
    expect(tools).toEqual([]);
  });
});
