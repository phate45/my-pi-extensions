#!/usr/bin/env bun

import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";

const PI_CODING_AGENT = "@earendil-works/pi-coding-agent";
const PI_DEVELOPMENT_PACKAGES = [
  "@earendil-works/pi-ai",
  PI_CODING_AGENT,
  "@earendil-works/pi-tui",
] as const;
// Trust boundary for the compat sandbox's fresh-release exemption: any package
// published under the @earendil-works npm scope is treated as part of Pi's
// release train. Scoped to the org rather than the "pi-" name prefix because
// Pi 0.85+ ships new org packages (e.g. @earendil-works/chord) that are
// versioned and released in lockstep with the pi-* packages.
const ORG_PACKAGE_PREFIX = "@earendil-works/";
const MINIMUM_RELEASE_AGE_SECONDS = 5 * 24 * 60 * 60;

type PackageJson = {
  devDependencies?: Record<string, string>;
  [key: string]: unknown;
};

type CompatibilityDecision =
  | { kind: "current" }
  | { kind: "test"; currentVersion: string; targetVersion: string };

export function getCompatibilityDecision(
  currentVersion: string,
  targetVersion: string,
  explicitTarget = false,
): CompatibilityDecision {
  if (!explicitTarget && Bun.semver.order(currentVersion, targetVersion) >= 0) {
    return { kind: "current" };
  }
  return { kind: "test", currentVersion, targetVersion };
}

export function parseCompatibilityArgs(args: string[]): { apply: boolean; target?: string } {
  const { values } = parseArgs({
    args,
    options: { apply: { type: "boolean" }, target: { type: "string" } },
    strict: true,
    allowPositionals: false,
  });
  const target = values.target;
  if (
    target !== undefined &&
    (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(target) ||
      !Bun.semver.satisfies(target, target))
  ) {
    throw new Error("--target requires an exact Pi version, for example --target 1.0.4");
  }
  return { apply: values.apply ?? false, target };
}

export function createCompatibilityEnv(
  root: string,
  inherited: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...inherited,
    HOME: join(root, "home"),
    PI_CODING_AGENT_DIR: join(root, "agent"),
    PI_CODING_AGENT_SESSION_DIR: join(root, "sessions"),
    PI_OFFLINE: "1",
    PI_TELEMETRY: "0",
  };
  delete env.CLAUDE_PROJECT_DIR;
  mkdirSync(join(root, "home"), { recursive: true });
  return env;
}

export function trustedPiArgs(args: string[]): string[] {
  return ["--approve", ...args];
}

export function getPiReleaseAgeExcludes(
  codingAgentDependencies: Record<string, unknown>,
  loadDependencies: (packageName: string) => Record<string, unknown>,
): string[] {
  const packages = new Set(
    [...PI_DEVELOPMENT_PACKAGES, ...Object.keys(codingAgentDependencies)].filter((packageName) =>
      packageName.startsWith(ORG_PACKAGE_PREFIX),
    ),
  );
  const expanded = new Set([PI_CODING_AGENT]);
  const pending = [...packages].filter((packageName) => !expanded.has(packageName));

  while (pending.length > 0) {
    const packageName = pending.shift() as string;
    if (expanded.has(packageName)) continue;
    expanded.add(packageName);

    for (const dependency of Object.keys(loadDependencies(packageName))) {
      if (!dependency.startsWith(ORG_PACKAGE_PREFIX) || packages.has(dependency)) continue;
      packages.add(dependency);
      pending.push(dependency);
    }
  }

  return [...packages].sort();
}

export function formatCompatibilityBunfig(packageNames: string[]): string {
  const excludes = packageNames
    .map((packageName) => `  ${JSON.stringify(packageName)},`)
    .join("\n");
  return [
    "# Generated only inside the disposable Pi compatibility snapshot.",
    "[install]",
    `minimumReleaseAge = ${MINIMUM_RELEASE_AGE_SECONDS}`,
    "minimumReleaseAgeExcludes = [",
    excludes,
    "]",
    "",
  ].join("\n");
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
  return output ? JSON.parse(output) : null;
}

function npmDependencies(root: string, packageSpec: string): Record<string, unknown> {
  const dependencies = npmJson(root, [packageSpec, "dependencies"]);
  if (dependencies === null) return {};
  if (typeof dependencies !== "object" || Array.isArray(dependencies)) {
    throw new Error(`npm returned invalid dependencies for ${packageSpec}`);
  }
  return dependencies as Record<string, unknown>;
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
  const cwdDir = join(runtimeRoot, "cwd");
  mkdirSync(cwdDir, { recursive: true });
  const env = createCompatibilityEnv(runtimeRoot);
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
  const { apply, target } = parseCompatibilityArgs(process.argv.slice(2));

  const root = run("git", ["rev-parse", "--show-toplevel"], {
    cwd: process.cwd(),
    capture: true,
  });
  const packageJson = readPackageJson(root);
  const currentVersion = getPinnedPiVersion(packageJson);

  const requested = target ?? "latest";
  console.log(`Checking npm for ${PI_CODING_AGENT}@${requested}...`);
  const targetVersion = npmJson(root, [`${PI_CODING_AGENT}@${requested}`, "version"]);
  if (typeof targetVersion !== "string" || (target && targetVersion !== target)) {
    throw new Error(`npm returned an invalid Pi version: ${JSON.stringify(targetVersion)}`);
  }

  const decision = getCompatibilityDecision(currentVersion, targetVersion, target !== undefined);
  if (decision.kind === "current") {
    console.log(
      `Pi ${currentVersion} does not trail npm latest ${targetVersion}; checks skipped. Use --target ${currentVersion} to recheck.`,
    );
    return;
  }

  const dependencies = npmDependencies(root, `${PI_CODING_AGENT}@${decision.targetVersion}`);
  if (typeof dependencies.typebox !== "string") {
    throw new Error("npm returned no TypeBox dependency for the target Pi release");
  }
  const typeboxVersion = dependencies.typebox;
  const releaseAgeExcludes = getPiReleaseAgeExcludes(dependencies, (packageName) =>
    npmDependencies(root, `${packageName}@${decision.targetVersion}`),
  );

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
    writeFileSync(join(snapshot, "bunfig.toml"), formatCompatibilityBunfig(releaseAgeExcludes));

    run("bun", ["install"], { cwd: snapshot });
    const env = createCompatibilityEnv(join(snapshot, ".tmp", "compat-checks"));
    run("just", ["typecheck-all"], { cwd: snapshot, env });
    run("just", ["test"], { cwd: snapshot, env });
    run("just", ["lint-ci"], { cwd: snapshot, env });
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
