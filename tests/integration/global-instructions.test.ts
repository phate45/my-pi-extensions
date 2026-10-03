import { afterEach, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildAgentSettings, runPiAndCaptureContext } from "../helpers/run-pi.js";
import { createTempPiEnv, type TempPiEnv, writeJson } from "../helpers/temp-env.js";

const envs: TempPiEnv[] = [];
afterEach(async () => {
  while (envs.length) await envs.pop()?.cleanup();
});

test("selected SYSTEM.md expands before global and project Claude instructions", async () => {
  const env = await createTempPiEnv();
  envs.push(env);
  const home = path.join(env.outputDir, "home");
  await mkdir(path.join(home, ".claude"), { recursive: true });
  await writeJson(path.join(env.agentDir, "settings.json"), buildAgentSettings());
  await writeFile(path.join(env.agentDir, "SYSTEM.md"), "PI ONLY\n@pi-specific.md\n");
  await writeFile(path.join(env.agentDir, "pi-specific.md"), "EXPANDED PI INSTRUCTIONS");
  await writeFile(path.join(home, ".claude", "CLAUDE.md"), "SHARED AGENT INSTRUCTIONS");
  await writeFile(path.join(env.projectDir, "CLAUDE.md"), "PROJECT INSTRUCTIONS");

  const global = await runPiAndCaptureContext({ env, homeDir: home, approve: true });
  expect(global.systemPrompt).toContain("EXPANDED PI INSTRUCTIONS");
  expect(global.systemPrompt).toContain("SHARED AGENT INSTRUCTIONS");
  expect(global.systemPrompt).toContain("PROJECT INSTRUCTIONS");
  expect(global.systemPrompt.split("PROJECT INSTRUCTIONS")).toHaveLength(2);
  expect(global.systemPrompt.split("SHARED AGENT INSTRUCTIONS")).toHaveLength(2);
  expect(global.systemPrompt.indexOf("PI ONLY")).toBeLessThan(
    global.systemPrompt.indexOf("SHARED AGENT INSTRUCTIONS"),
  );

  await mkdir(path.join(env.projectDir, ".pi"), { recursive: true });
  await writeFile(path.join(env.projectDir, ".pi", "SYSTEM.md"), "PROJECT PI PROMPT\n");
  const project = await runPiAndCaptureContext({ env, homeDir: home, approve: true });
  expect(project.systemPrompt).toContain("PROJECT PI PROMPT");
  expect(project.systemPrompt).not.toContain("PI ONLY");
  expect(project.systemPrompt).toContain("SHARED AGENT INSTRUCTIONS");
  expect(project.systemPrompt).toContain("PROJECT INSTRUCTIONS");

  await writeJson(path.join(env.agentDir, "my-pi-settings.json"), {
    extensions: {
      "cc-context-local-files": { config: { claudeFiles: { global: false } } },
    },
  });
  const disabled = await runPiAndCaptureContext({ env, homeDir: home, approve: true });
  expect(disabled.systemPrompt).toContain("PROJECT PI PROMPT");
  expect(disabled.systemPrompt).toContain("PROJECT INSTRUCTIONS");
  expect(disabled.systemPrompt).not.toContain("SHARED AGENT INSTRUCTIONS");
});
