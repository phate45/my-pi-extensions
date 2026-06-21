import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { defineManagedExtension } from "../infra/lib/managed-extension.js";

type GitCounts = {
  staged: number;
  unstaged: number;
  untracked: number;
};

type ExecResult = {
  stdout: string;
  stderr: string;
  code: number;
};

async function git(
  pi: ExtensionAPI,
  cwd: string,
  args: string[],
  signal?: AbortSignal,
): Promise<ExecResult> {
  return await pi.exec("git", ["-C", cwd, ...args], { cwd, signal });
}

function countStatus(shortStatus: string): GitCounts {
  const counts: GitCounts = { staged: 0, unstaged: 0, untracked: 0 };

  for (const line of shortStatus.split("\n")) {
    if (!line) continue;

    const x = line[0] ?? " ";
    const y = line[1] ?? " ";

    if (x === "?" && y === "?") {
      counts.untracked++;
      continue;
    }

    if (x !== " " && x !== "?") counts.staged++;
    if (y !== " ") counts.unstaged++;
  }

  return counts;
}

function formatCount(count: number, label: string): string {
  return `${count} ${label}`;
}

function renderGitContext(branch: string, commits: string, counts: GitCounts): string {
  const lines = [
    "# Git Context",
    "",
    `Branch: ${branch}`,
    "",
    "Last 5 commits:",
    ...(commits.trim()
      ? commits
          .trim()
          .split("\n")
          .map((line) => `- ${line}`)
      : ["- none"]),
    "",
    `Status: ${formatCount(counts.staged, "staged")}, ${formatCount(counts.unstaged, "unstaged")}, ${formatCount(counts.untracked, "untracked")}`,
  ];

  return `\n\n${lines.join("\n")}\n`;
}

function insertBeforeCurrentDate(systemPrompt: string, block: string): string {
  const dateMarker = "\nCurrent date: ";
  const index = systemPrompt.lastIndexOf(dateMarker);
  if (index === -1) return `${systemPrompt}${block}`;
  return `${systemPrompt.slice(0, index)}${block}${systemPrompt.slice(index)}`;
}

async function buildGitContext(pi: ExtensionAPI, ctx: ExtensionContext): Promise<string> {
  const inside = await git(pi, ctx.cwd, ["rev-parse", "--is-inside-work-tree"], ctx.signal);
  if (inside.code !== 0 || inside.stdout.trim() !== "true") return "";

  const branchResult = await git(pi, ctx.cwd, ["branch", "--show-current"], ctx.signal);
  let branch = branchResult.stdout.trim();
  if (!branch) {
    const head = await git(pi, ctx.cwd, ["rev-parse", "--short", "HEAD"], ctx.signal);
    branch = head.code === 0 && head.stdout.trim() ? `detached @ ${head.stdout.trim()}` : "unknown";
  }

  const log = await git(pi, ctx.cwd, ["log", "--oneline", "-5"], ctx.signal);
  const status = await git(pi, ctx.cwd, ["status", "--short"], ctx.signal);

  return renderGitContext(
    branch,
    log.code === 0 ? log.stdout : "",
    countStatus(status.code === 0 ? status.stdout : ""),
  );
}

export default defineManagedExtension({
  name: "git-context",
  featureFlag: "ccLike",
  setup(pi) {
    let gitContext = "";

    pi.on("session_start", async (_event, ctx) => {
      gitContext = await buildGitContext(pi, ctx);
    });

    pi.on("before_agent_start", async (event) => {
      if (!gitContext) return;
      return { systemPrompt: insertBeforeCurrentDate(event.systemPrompt, gitContext) };
    });
  },
});
