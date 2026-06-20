import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type TempPiEnv = {
  rootDir: string;
  agentDir: string;
  projectDir: string;
  outputDir: string;
  cleanup(): Promise<void>;
};

export async function createTempPiEnv(): Promise<TempPiEnv> {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "my-pi-extensions-test-"));
  const agentDir = path.join(rootDir, "agent");
  const projectDir = path.join(rootDir, "project");
  const outputDir = path.join(rootDir, "out");

  await mkdir(agentDir, { recursive: true });
  await mkdir(projectDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });

  return {
    rootDir,
    agentDir,
    projectDir,
    outputDir,
    cleanup: async () => {
      await rm(rootDir, { recursive: true, force: true });
    },
  };
}

export async function writeJson(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2));
}
