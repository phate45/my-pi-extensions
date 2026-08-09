import { afterEach, describe, expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";
import { buildAgentSettings, runPiAndCaptureContext } from "../helpers/run-pi.js";
import { createTempPiEnv, type TempPiEnv, writeJson } from "../helpers/temp-env.js";

const execFileAsync = promisify(execFile);
const tempEnvs: TempPiEnv[] = [];

async function setupFixture() {
  const env = await createTempPiEnv();
  tempEnvs.push(env);
  await writeJson(path.join(env.agentDir, "settings.json"), buildAgentSettings());
  await execFileAsync("git", ["init", env.projectDir]);

  const packageDir = path.join(env.projectDir, "packages", "api");
  await mkdir(path.join(packageDir, "src"), { recursive: true });
  await writeFile(path.join(env.projectDir, "CLAUDE.md"), "ROOT CLAUDE CONTEXT");
  await writeFile(path.join(packageDir, "CLAUDE.md"), "PACKAGE CLAUDE CONTEXT");
  await writeSkill(env.projectDir, "root-skill", "ROOT SKILL");
  await writeSkill(packageDir, "package-skill", "PACKAGE SKILL");
  await writeRule(env.projectDir, "root.md", "ROOT RULE");
  await writeRule(packageDir, "package.md", "PACKAGE RULE");

  return { env, packageDir };
}

async function writeSkill(root: string, name: string, marker: string) {
  const skillDir = path.join(root, ".claude", "skills", name);
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    path.join(skillDir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${marker}\n---\n\n${marker}\n`,
  );
}

async function writeRule(root: string, name: string, marker: string) {
  const rulesDir = path.join(root, ".claude", "rules");
  await mkdir(rulesDir, { recursive: true });
  await writeFile(path.join(rulesDir, name), marker);
}

afterEach(async () => {
  while (tempEnvs.length > 0) await tempEnvs.pop()?.cleanup();
});

describe("nested Claude resources at startup", () => {
  test("root launch loads only root CLAUDE.md, skills, and rules", async () => {
    const { env } = await setupFixture();

    const state = await runPiAndCaptureContext({ env, approve: true });
    const messages = JSON.stringify(state.messages);

    expect(state.systemPrompt).toContain("ROOT CLAUDE CONTEXT");
    expect(state.systemPrompt).not.toContain("PACKAGE CLAUDE CONTEXT");
    expect(state.systemPrompt).toContain("root-skill");
    expect(state.systemPrompt).not.toContain("package-skill");
    expect(messages).toContain("ROOT RULE");
    expect(messages).not.toContain("PACKAGE RULE");
  });

  test("subdirectory launch activates its CLAUDE.md, skills, and rules", async () => {
    const { env, packageDir } = await setupFixture();

    const state = await runPiAndCaptureContext({ env, cwd: packageDir, approve: true });
    const messages = JSON.stringify(state.messages);

    expect(state.systemPrompt).toContain("ROOT CLAUDE CONTEXT");
    expect(state.systemPrompt).toContain("PACKAGE CLAUDE CONTEXT");
    expect(state.systemPrompt).toContain("root-skill");
    expect(state.systemPrompt).toContain("packages/api:package-skill");
    expect(messages).toContain("ROOT RULE");
    expect(messages).toContain("PACKAGE RULE");
  });
});
