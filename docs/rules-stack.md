---
created: 2026-07-30T22:32:26
modified: 2026-08-09T21:14:24
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
- nested `.claude/rules` directories along a targeted file's ancestry
- ancestor `.claude/rules` directories above the project root when global discovery is enabled
- user rules at `~/.claude/rules` when global discovery is enabled

Discovery recurses through Markdown files, follows symlinked files and directories, and prevents symlink cycles. A higher-priority root source claims a relative rule path before lower-priority root sources. Project rules therefore override global rules with the same relative path.

Nested rule directories load lazily when `read`, `edit`, or `write` targets a file in their subtree. Their `paths` globs match relative to the directory that owns `.claude/rules`; for example, `packages/api/.claude/rules/typescript.md` can use `paths: src/**`. Parent and child rule directories compose even when they contain the same relative rule path, with the deeper rule loading after its parents.

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

Unconditional project rules enter context before the first model call. When Pi starts inside a package subtree, unconditional nested rules along that directory's ancestry enter context at the same boundary. Path-scoped rules activate when the agent targets a matching project file with `read`, `edit`, or `write`.

- `read` executes normally; Pi injects matching root and nested rules before the next model call.
- `edit` and `write` block before mutation; Pi injects matching root and nested rules and asks the agent to retry.
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
- nested rules load only for targets in their subtree and match package-relative paths
- parent and child nested roots compose with deeper rules last
- global and project configuration switches work independently
- `CLAUDE_PROJECT_DIR`, Git roots, worktrees, symlinks, and compaction preserve their documented behavior
