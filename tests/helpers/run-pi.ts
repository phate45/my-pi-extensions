import { readFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import type { TempPiEnv } from "./temp-env.js";

export type CapturedExtensionState = {
  loadedExtensions: Array<{
    path: string;
    resolvedPath: string;
    sourceInfo: unknown;
  }>;
  bundleConfig: unknown;
  configSources: string[];
  effective: {
    featureFlags: Record<string, boolean>;
    extensions: Record<string, boolean>;
  };
  errors: string[];
};

type RunPiOptions = {
  env: TempPiEnv;
  approve?: boolean;
  overrideSettingsPath?: string;
};

const repoRoot = process.cwd();
const probePath = path.join(repoRoot, "tests", "probes", "capture-extension-state.ts");
const packagePath = repoRoot;

export async function runPiAndCaptureState(options: RunPiOptions): Promise<CapturedExtensionState> {
  const outputPath = path.join(options.env.outputDir, "state.json");
  const args = ["--no-session", "-e", probePath];

  if (options.approve === true) args.push("--approve");
  if (options.approve === false) args.push("--no-approve");
  if (options.overrideSettingsPath) args.push("--my-pi-settings", options.overrideSettingsPath);

  await new Promise<void>((resolve, reject) => {
    const child = spawn("pi", args, {
      cwd: options.env.projectDir,
      env: {
        ...process.env,
        PI_CODING_AGENT_DIR: options.env.agentDir,
        MY_PI_EXTENSIONS_TEST_OUTPUT: outputPath,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`pi exited with code=${code} signal=${signal}\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    });
  });

  const raw = await readFile(outputPath, "utf8");
  return JSON.parse(raw) as CapturedExtensionState;
}

export function buildAgentSettings() {
  return {
    quietStartup: true,
    packages: [packagePath],
  };
}
