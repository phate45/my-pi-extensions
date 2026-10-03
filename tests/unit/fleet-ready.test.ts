import { afterEach, beforeEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

let cwd: string;
const root = resolve(import.meta.dir, "../..");

function run(command: string, ...args: string[]) {
  return spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
    timeout: 5000,
  });
}

function git(...args: string[]) {
  const result = run("git", ...args);
  if (result.status !== 0) throw new Error(result.stderr);
}

function manifest(version = "1.0.0") {
  writeFileSync(
    join(cwd, "package.json"),
    `${JSON.stringify({ devDependencies: { "@earendil-works/pi-coding-agent": version } })}\n`,
  );
}

function probe(status: number, stdout = "", tool = "pi") {
  const result = run("just", "fleet-ready", tool);
  expect(result.status).toBe(status);
  expect(result.stdout).toBe(stdout);
}

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "fleet-ready-"));
  mkdirSync(join(cwd, "scripts"));
  for (const file of ["justfile", "scripts/fleet-ready.sh"]) {
    copyFileSync(join(root, file), join(cwd, file));
  }
  git("init", "-q", "-b", "master");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Fleet test");
  manifest();
  git("add", ".");
  git("commit", "-qm", "Tested pin");
  git("update-ref", "refs/remotes/origin/master", "HEAD");
  git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/master");
});

afterEach(() => rmSync(cwd, { recursive: true, force: true }));

test("answers exactly one origin-matching version line", () => {
  probe(0, "1.0.0\n");
});

test("rejects unsupported tools", () => {
  probe(2, "", "nope");
});

test("rejects staged and unstaged manifest changes, even when they cancel", () => {
  manifest("1.1.0");
  probe(2);
  git("add", "package.json");
  probe(2);
  manifest();
  probe(2);
});

test("rejects a promoted pin until cached origin advances", () => {
  manifest("1.1.0");
  git("add", "package.json");
  git("commit", "-qm", "Promote locally");
  probe(2);
  git("update-ref", "refs/remotes/origin/master", "HEAD");
  probe(0, "1.1.0\n");
});
