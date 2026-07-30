---
created: 2026-07-30T22:32:26
modified: 2026-07-30T22:32:37
---

# Claude Rules Stack

## Purpose

This stack loads Claude-compatible Markdown rules from `.claude/rules` and injects each rule when its scope becomes relevant.

Use rules for durable repository constraints. Use `CLAUDE.md` for broad project context and skills for task-driven workflows.

## Discovery

The stack uses the same Claude project resolution as commands, skills, context files, and git context:

1. `CLAUDE_PROJECT_DIR` overrides Pi's current working directory when set.
2. Git repositories resolve to their worktree root.
3. Directories outside Git use the resolved Claude project directory.

Rule discovery checks:

- project rules at `<project-root>/.claude/rules`
- ancestor `.claude/rules` directories above the project root when global discovery is enabled
- user rules at `~/.claude/rules` when global discovery is enabled

Discovery recurses through Markdown files, follows symlinked files and directories, and prevents symlink cycles. A higher-priority source claims a relative rule path before lower-priority sources. Project rules therefore override global rules with the same relative path.

## Rule format

A rule without `paths` applies unconditionally:

```markdown
Run focused tests after changing production code.
```

A `paths` string or list scopes the rule to project-relative globs:

```markdown
---
paths:
  - "src/**/*.ts"
  - "tests/**/*.ts"
---
Use strict TypeScript and keep tests close to the behavior they verify.
```

The parser accepts standard YAML frontmatter. Invalid frontmatter skips only the malformed rule and emits one warning per session.

## Activation

Unconditional rules enter context before the first model call. Path-scoped rules activate when the agent targets a matching project file with `read`, `edit`, or `write`.

- `read` executes normally; Pi injects matching rules before the next model call.
- `edit` and `write` block before mutation; Pi injects matching rules and asks the agent to retry.
- each rule injects once per compaction epoch
- parallel matches combine into one rule message
- compaction resets activation, immediately restores unconditional rules, and permits scoped rules to activate again

The extension rediscovers rule files before activation boundaries. New rules and edits to rules that have not loaded yet can affect the current session without `/reload`. Already-loaded rules refresh after compaction.

## Configuration

Disable the extension completely:

```json
{
  "extensions": {
    "claude-rules": {
      "enabled": false
    }
  }
}
```

Control project and global discovery independently:

```json
{
  "extensions": {
    "claude-rules": {
      "enabled": true,
      "config": {
        "global": false,
        "project": true
      }
    }
  }
}
```

Both source switches default to `true`.

## Verification

When changing this stack, verify:

- unconditional rules load before the first model call
- matching reads continue and inject before the next model call
- matching edits and writes block once, then succeed on retry
- unrelated and out-of-project paths do not activate rules
- project rules override global rules by relative path
- global and project configuration switches work independently
- `CLAUDE_PROJECT_DIR`, Git roots, worktrees, symlinks, and compaction preserve their documented behavior
