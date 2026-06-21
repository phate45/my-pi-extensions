---
created: 2026-06-21T10:13:05
modified: 2026-06-21T23:17:59
---

# Context Stack

## Purpose

The context stack makes Pi behave like Claude-style project context loading while still fitting Pi's runtime model.

## Responsibilities

This stack owns:
- replacing stock project context with the bundle's effective context set
- loading `.local.md` companions alongside primary project context files
- honoring per-source knobs for Claude context files
- deduping discovered context resources
- keeping startup summaries and `/context` in sync when the UI layer is active

Current Claude-file knobs live under `extensions.cc-context-local-files.config.claudeFiles`:
- `global` → `~/.claude/CLAUDE.md`
- `project` → `<git project root>/CLAUDE.md` (falls back to `cwd` outside git)
- `local` → `<git project root>/CLAUDE.local.md` (falls back to `cwd` outside git)

When `CLAUDE_PROJECT_DIR` is set, Claude-family project discovery uses that directory as its starting point instead of Pi's `cwd`.
That override applies to Claude project-root resolution only; broader `AGENTS*` discovery still follows Pi's ordinary context path.

Those knobs only control the Claude-family files. Existing `AGENTS*` discovery stays on the broader context path.

## Invariants

When context behavior changes, keep these views aligned:
- prompt-loaded context files
- manually read context files
- discovered local companion files
- startup header context listing
- `/context` effective context listing

If one of those moves without the others, the UI lies.

In effective `headless` mode, the user-facing reporting layer is intentionally off:
- the startup header summary does not render
- `/context` does not register

That means the alignment rule applies to interactive UI sessions, not to headless runs where both reporting surfaces are disabled together.

## Typical changes

Change this stack when you need to:
- alter how primary project context is discovered or replaced
- include or filter `.local.md` companion context
- change how effective context is reported
- keep startup context summaries honest

## Verification

After changes, confirm:
- `CLAUDE.local.md` content appears alongside primary project context
- disabled Claude sources actually disappear from the effective context listing
- effective context dedupes correctly
- startup header context matches `/context` in UI sessions
- prompt-visible context and effective context are describing the same reality
- effective `headless` mode disables both startup-summary reporting and `/context` together
