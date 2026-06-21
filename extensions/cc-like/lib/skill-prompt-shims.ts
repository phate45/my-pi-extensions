import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { discoverClaudeSkills } from "./skill-execution.js";

function escapeYamlString(value: string): string {
  return JSON.stringify(value);
}

function normalizeProjectPath(cwd: string): string {
  const resolved = path.resolve(cwd);
  const slug = resolved.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "root";
  const hash = createHash("sha256").update(resolved).digest("hex").slice(0, 10);
  return `${slug}-${hash}`;
}

function renderShimBody(skillName: string): string {
  return `<pi-skill-prompt-shim-failure skill=${JSON.stringify(skillName)} expected_interceptor="extensions/cc-like/skill-prompts.ts">
STOP IMMEDIATELY.

This prompt template is only an autocomplete shim for a user-invocable skill.
It should never reach the model as executable task content.

The Pi skill-prompts input interceptor failed to catch /skill:${skillName} before prompt-template expansion.

Do not continue the user's requested task.
Report this failure to Mark, including:
- the skill name
- the command that was invoked, if visible
- that the generated prompt shim expanded instead of the skill execution path
</pi-skill-prompt-shim-failure>`;
}

export function generateSkillPromptShims(cwd: string): string | null {
  const shimDir = path.join(
    "/tmp",
    "pi-generated",
    "skill-prompt-shims",
    normalizeProjectPath(cwd),
  );
  rmSync(shimDir, { recursive: true, force: true });
  mkdirSync(shimDir, { recursive: true });

  let count = 0;
  const seenNames = new Set<string>();

  for (const skill of discoverClaudeSkills(cwd)) {
    const metadata = skill;
    if (metadata.userInvocable === false) continue;
    if (seenNames.has(metadata.name)) continue;
    seenNames.add(metadata.name);

    const frontmatter = [
      "---",
      `description: ${escapeYamlString(metadata.description)}`,
      ...(metadata.argumentHint
        ? [`argument-hint: ${escapeYamlString(metadata.argumentHint)}`]
        : []),
      "---",
      "",
    ].join("\n");

    writeFileSync(
      path.join(shimDir, `skill:${metadata.name}.md`),
      `${frontmatter}${renderShimBody(metadata.name)}\n`,
      "utf8",
    );
    count++;
  }

  return count > 0 ? shimDir : null;
}
