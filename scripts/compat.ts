#!/usr/bin/env bun

import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

const PI_CODING_AGENT = "@earendil-works/pi-coding-agent";
const PI_DEVELOPMENT_PACKAGES = [
  "@earendil-works/pi-ai",
  PI_CODING_AGENT,
  "@earendil-works/pi-tui",
] as const;

type PackageJson = {
  devDependencies?: Record<string, string>;
  [key: string]: unknown;
};

type CompatibilityDecision =
  | { kind: "current" }
  | { kind: "test"; currentVersion: string; targetVersion: string };

export function getCompatibilityDecision(
  currentVersion: string,
  latestVersion: string,
): CompatibilityDecision {
  if (Bun.semver.order(currentVersion, latestVersion) >= 0) return { kind: "current" };
  return { kind: "test", currentVersion, targetVersion: latestVersion };
}

export function trustedPiArgs(args: string[]): string[] {
  return ["--approve", ...args];
}

export function updatePiDevelopmentDependencies(
  packageJson: PackageJson,
  piVersion: string,
  typeboxVersion: string,
): PackageJson {
  if (!packageJson.devDependencies?.[PI_CODING_AGENT]) {
    throw new Error(`package.json is missing ${PI_CODING_AGENT} in devDependencies`);
  }

  const updated = structuredClone(packageJson);
  const devDependencies = updated.devDependencies as Record<string, string>;
  for (const packageName of PI_DEVELOPMENT_PACKAGES) {
    devDependencies[packageName] = piVersion;
  }
  devDependencies.typebox = typeboxVersion;
  return updated;
}

function formatCommand(command: string, args: string[]): string {
  return [command, ...args].join(" ");
}

function run(
  command: string,
  args: string[],
  options: {
    cwd: string;
    env?: NodeJS.ProcessEnv;
    input?: string;
    capture?: boolean;
    trimOutput?: boolean;
  },
): string {
  console.log(`$ ${formatCommand(command, args)}`);
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: "utf8",
    input: options.input,
    stdio: options.capture ? "pipe" : ["inherit", "inherit", "inherit"],
    maxBuffer: 20 * 1024 * 1024,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
    throw new Error(
      `${formatCommand(command, args)} exited with status ${result.status}${output ? `\n${output}` : ""}`,
    );
  }

  const output = String(result.stdout ?? "");
  return options.trimOutput === false ? output : output.trim();
}

function readPackageJson(root: string): PackageJson {
  return JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as PackageJson;
}

function npmJson(root: string, args: string[]): unknown {
  const output = run("npm", ["view", ...args, "--json"], { cwd: root, capture: true });
  return JSON.parse(output);
}

function getPinnedPiVersion(packageJson: PackageJson): string {
  const version = packageJson.devDependencies?.[PI_CODING_AGENT];
  if (!version) throw new Error(`package.json is missing ${PI_CODING_AGENT} in devDependencies`);
  return version;
}

function createSourceSnapshot(root: string, snapshot: string): void {
  mkdirSync(dirname(snapshot), { recursive: true });
  run("git", ["worktree", "add", "--detach", snapshot, "HEAD"], { cwd: root });

  const trackedChanges = run("git", ["diff", "--binary", "HEAD"], {
    cwd: root,
    capture: true,
    trimOutput: false,
  });
  if (trackedChanges) {
    run("git", ["apply", "--binary", "--whitespace=nowarn", "-"], {
      cwd: snapshot,
      input: trackedChanges,
    });
  }

  const untracked = run("git", ["ls-files", "--others", "--exclude-standard", "-z"], {
    cwd: root,
    capture: true,
    trimOutput: false,
  });
  for (const relativePath of untracked.split("\0").filter(Boolean)) {
    const destination = join(snapshot, relativePath);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(join(root, relativePath), destination, { recursive: true });
  }
}

export function promoteCompatibilityDependencies(snapshot: string, root: string): void {
  for (const file of ["package.json", "bun.lock"]) {
    cpSync(join(snapshot, file), join(root, file));
  }
}

function removeSourceSnapshot(root: string, snapshot: string): void {
  const result = spawnSync("git", ["worktree", "remove", "--force", snapshot], {
    cwd: root,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    rmSync(snapshot, { recursive: true, force: true });
    spawnSync("git", ["worktree", "prune"], { cwd: root, stdio: "inherit" });
  }
}

function runRuntimeSmokeTest(snapshot: string, targetVersion: string): void {
  const runtimeRoot = join(snapshot, ".tmp", "compat-runtime");
  const agentDir = join(runtimeRoot, "agent");
  const homeDir = join(runtimeRoot, "home");
  const sessionDir = join(runtimeRoot, "sessions");
  const cwdDir = join(runtimeRoot, "cwd");
  mkdirSync(homeDir, { recursive: true });
  mkdirSync(cwdDir, { recursive: true });

  const env = {
    ...process.env,
    HOME: homeDir,
    PI_CODING_AGENT_DIR: agentDir,
    PI_CODING_AGENT_SESSION_DIR: sessionDir,
    PI_OFFLINE: "1",
    PI_TELEMETRY: "0",
  };
  const pi = join(snapshot, "node_modules", ".bin", "pi");

  run(pi, ["install", snapshot], { cwd: cwdDir, env });

  const loadedVersion = run(pi, trustedPiArgs(["--version"]), {
    cwd: cwdDir,
    env,
    capture: true,
  });
  if (loadedVersion !== targetVersion) {
    throw new Error(`runtime smoke test loaded Pi ${loadedVersion}; expected ${targetVersion}`);
  }

  const help = run(pi, trustedPiArgs(["--help"]), { cwd: cwdDir, env, capture: true });
  if (!help.includes("--my-pi-settings")) {
    throw new Error("runtime smoke test did not load the bundle's extension CLI flags");
  }

  run(pi, ["list"], { cwd: cwdDir, env });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const unknownArgs = args.filter((arg) => arg !== "--apply");
  if (unknownArgs.length > 0) {
    throw new Error(`unknown compatibility arguments: ${unknownArgs.join(", ")}`);
  }

  const root = run("git", ["rev-parse", "--show-toplevel"], {
    cwd: process.cwd(),
    capture: true,
  });
  const packageJson = readPackageJson(root);
  const currentVersion = getPinnedPiVersion(packageJson);

  console.log(`Checking npm for the latest ${PI_CODING_AGENT} release...`);
  const latestVersion = npmJson(root, [`${PI_CODING_AGENT}@latest`, "version"]);
  if (typeof latestVersion !== "string") {
    throw new Error(`npm returned an invalid latest Pi version: ${JSON.stringify(latestVersion)}`);
  }

  const decision = getCompatibilityDecision(currentVersion, latestVersion);
  if (decision.kind === "current") {
    console.log(`Pi ${currentVersion} is already current; nothing to test.`);
    return;
  }

  const latestDependencies = npmJson(root, [
    `${PI_CODING_AGENT}@${decision.targetVersion}`,
    "dependencies",
  ]);
  if (
    typeof latestDependencies !== "object" ||
    latestDependencies === null ||
    typeof (latestDependencies as Record<string, unknown>).typebox !== "string"
  ) {
    throw new Error("npm returned no TypeBox dependency for the latest Pi release");
  }
  const typeboxVersion = (latestDependencies as Record<string, string>).typebox;

  const safeVersion = decision.targetVersion.replace(/[^0-9A-Za-z._-]/g, "-");
  const sandbox = mkdtempSync(join(tmpdir(), `pi-compat-${safeVersion}-`));
  const snapshot = join(sandbox, "source");

  console.log(
    `Testing Pi ${decision.targetVersion} compatibility (currently pinned: ${decision.currentVersion}).`,
  );
  try {
    createSourceSnapshot(root, snapshot);
    const updatedPackageJson = updatePiDevelopmentDependencies(
      readPackageJson(snapshot),
      decision.targetVersion,
      typeboxVersion,
    );
    writeFileSync(
      join(snapshot, "package.json"),
      `${JSON.stringify(updatedPackageJson, null, 2)}\n`,
    );

    run("bun", ["install"], { cwd: snapshot });
    run("just", ["typecheck-all"], { cwd: snapshot });
    run("just", ["test"], { cwd: snapshot });
    run("just", ["lint-ci"], { cwd: snapshot });
    runRuntimeSmokeTest(snapshot, decision.targetVersion);

    if (apply) {
      promoteCompatibilityDependencies(snapshot, root);
      console.log(
        `Promoted Pi ${decision.targetVersion} dependencies to package.json and bun.lock.`,
      );
    }
    console.log(`Pi ${decision.targetVersion} compatibility check passed.`);
  } finally {
    removeSourceSnapshot(root, snapshot);
    rmSync(sandbox, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
