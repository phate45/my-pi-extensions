import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dir, "../..");
const fixtures: string[] = [];

function run(cwd: string, command: string, args: string[]) {
  return spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
    timeout: 5000,
  });
}

function git(cwd: string, ...args: string[]) {
  const result = run(cwd, "git", args);
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

function manifest(cwd: string, version: unknown) {
  writeFileSync(
    join(cwd, "package.json"),
    `${JSON.stringify({ devDependencies: { "@earendil-works/pi-coding-agent": version } })}\n`,
  );
}

function fixture(version: unknown = "1.0.0") {
  const cwd = mkdtempSync(join(tmpdir(), "fleet-ready-"));
  fixtures.push(cwd);
  mkdirSync(join(cwd, "scripts"));
  copyFileSync(join(projectRoot, "justfile"), join(cwd, "justfile"));
  copyFileSync(join(projectRoot, "scripts/fleet-ready.sh"), join(cwd, "scripts/fleet-ready.sh"));
  git(cwd, "init", "-q", "-b", "master");
  git(cwd, "config", "user.email", "test@example.com");
  git(cwd, "config", "user.name", "Fleet test");
  manifest(cwd, version);
  git(cwd, "add", ".");
  git(cwd, "commit", "-qm", "Initial tested pin");
  git(cwd, "update-ref", "refs/remotes/origin/master", "HEAD");
  git(cwd, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/master");
  return cwd;
}

function probe(cwd: string, tool = "pi") {
  return run(cwd, "just", ["fleet-ready", tool]);
}

function expectRefusal(cwd: string, tool = "pi") {
  const result = probe(cwd, tool);
  expect(result.status).toBe(2);
  expect(result.stdout).toBe("");
}

afterEach(() => {
  for (const cwd of fixtures.splice(0)) rmSync(cwd, { recursive: true, force: true });
});

describe("fleet readiness contract", () => {
  test("answers exactly one pushed version line without changing git state", () => {
    const cwd = fixture();
    const before = git(cwd, "status", "--porcelain");
    const result = probe(cwd);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("1.0.0\n");
    expect(result.stderr).toBe("");
    expect(git(cwd, "status", "--porcelain")).toBe(before);
  });

  test("rejects unsupported tools, including shell metacharacters", () => {
    const cwd = fixture();
    expectRefusal(cwd, "nope");
    expectRefusal(cwd, "pi'; echo injected; '");
  });

  test("allows unrelated dirty files and unpushed commits with the same pin", () => {
    const cwd = fixture();
    writeFileSync(join(cwd, "README.md"), "local work\n");
    git(cwd, "add", "README.md");
    git(cwd, "commit", "-qm", "Unrelated work");
    writeFileSync(join(cwd, "README.md"), "dirty work\n");
    expect(probe(cwd).stdout).toBe("1.0.0\n");
    expect(probe(cwd).status).toBe(0);
  });

  test("rejects unstaged and staged manifest changes even with the same pin", () => {
    const cwd = fixture();
    writeFileSync(
      join(cwd, "package.json"),
      `${JSON.stringify({ name: "changed", devDependencies: { "@earendil-works/pi-coding-agent": "1.0.0" } })}\n`,
    );
    expectRefusal(cwd);
    git(cwd, "add", "package.json");
    expectRefusal(cwd);
    // A clean net diff against HEAD still contains staged and unstaged changes.
    manifest(cwd, "1.0.0");
    expectRefusal(cwd);
  });

  test("rejects an unpushed promoted pin, then answers after the cached ref advances", () => {
    const cwd = fixture();
    manifest(cwd, "1.1.0");
    git(cwd, "add", "package.json");
    git(cwd, "commit", "-qm", "Promote pin locally");
    expectRefusal(cwd);
    git(cwd, "update-ref", "refs/remotes/origin/master", "HEAD");
    expect(probe(cwd).stdout).toBe("1.1.0\n");
    expect(probe(cwd).status).toBe(0);
  });

  test("rejects missing cached origin refs", () => {
    const cwd = fixture();
    git(cwd, "update-ref", "-d", "refs/remotes/origin/master");
    expectRefusal(cwd);
  });

  test("rejects ranges, absent pins, nonstrings, and multiline values", () => {
    for (const version of ["^1.0.0", null, 1, "1.0.0\n2.0.0", "01.0.0", "1.0.0-01"]) {
      expectRefusal(fixture(version));
    }
  });

  test("rejects missing pins and multiple JSON documents", () => {
    for (const contents of ["{}\n", "{}\n{}\n"]) {
      const cwd = fixture();
      writeFileSync(join(cwd, "package.json"), contents);
      git(cwd, "add", "package.json");
      git(cwd, "commit", "-qm", "Invalid manifest");
      git(cwd, "update-ref", "refs/remotes/origin/master", "HEAD");
      expectRefusal(cwd);
    }
  });

  test("accepts exact prerelease and build versions", () => {
    const cwd = fixture("1.1.0-rc.1+build.2");
    expect(probe(cwd).stdout).toBe("1.1.0-rc.1+build.2\n");
    expect(probe(cwd).status).toBe(0);
  });

  test("normalizes malformed JSON and missing commands to exit 2", () => {
    const cwd = fixture();
    writeFileSync(join(cwd, "package.json"), "not json\n");
    git(cwd, "add", "package.json");
    git(cwd, "commit", "-qm", "Bad manifest");
    git(cwd, "update-ref", "refs/remotes/origin/master", "HEAD");
    expectRefusal(cwd);
    const result = run(cwd, "/bin/bash", [
      "-c",
      "PATH=/nonexistent /bin/bash scripts/fleet-ready.sh pi",
    ]);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
  });
});
