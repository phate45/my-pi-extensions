---
created: 2026-06-21T10:13:05
modified: 2026-06-21T21:28:12
---

# Skill Stack

## Purpose

The skill stack makes Claude-style invocation resources feel native in Pi while preserving a clean separation between raw file inspection and actual execution.

## Responsibilities

This stack owns:
- `.claude/skills` discovery
- `.claude/commands` discovery as invocation resources, not ordinary Pi prompts
- model-facing `skill` tool registration
- human `/skill:name args` execution
- human `/command-name args` execution for `.claude/commands/command-name.md` through the same invocation family
- generated prompt shims for skill commands
- startup and prompt filtering so shims do not masquerade as normal prompts

Current entrypoint split:
- `skill-tool.ts` owns native Pi skill integration for model-facing execution and system-prompt skill listing
- `skill-prompts.ts` owns human-facing invocation shims, Claude command routing, and compact invocation message rendering for Claude-style resources
- `infra/input-pipeline.ts` owns the shared `input` event so transforms such as abbreviations can run before Claude command routing without cross-family imports

Mode interaction:
- Pi `--no-skills|-ns` disables native skill discovery and the model-facing `skill` tool
- in interactive runs, Claude-style human invocation still works through `skill-prompts.ts`
- in effective headless mode, that human invocation layer stays off as well
- bundle config can independently gate Claude resource sources:
  - `extensions.cc-resource-paths.config.commands.{global,project,loadInHeadless}`
  - `extensions.cc-resource-paths.config.skills.{global,project}`

Source semantics for `cc-resource-paths`:
- `project` = `<git project root>/.claude/{commands,skills}` and falls back to `cwd` outside git
- `global` = ancestor `.claude/{commands,skills}` directories above the resolved project root plus `~/.claude/{commands,skills}`
- `loadInHeadless` defaults to `false` for `.claude/commands`

## Invariants

Keep these aligned:
- visible skill list
- model-facing tool behavior
- human command behavior
- Claude command behavior
- compact invocation UI for Claude commands
- generated shim metadata
- startup and prompt filtering
- raw `read SKILL.md` remaining raw inspection

If one layer executes a skill while another only reads it, the stack becomes misleading fast.

## Execution rule

When a skill needs its directory, derive it from the `SKILL.md` location itself.
Do not infer it from a broader command base directory.

## Verification

After changes, confirm:
- `.claude/skills` discovery still works
- disabled global/project Claude resource sources stop contributing paths
- `.claude/commands` still load, but run through the invocation pipeline instead of inline prompt expansion
- `.claude/commands` render as compact invocation rows in the UI instead of visible inline XML payloads
- transformed slash input such as abbreviation-expanded `/from-handoff ...` still reaches Claude command routing
- `/skill:name args` executes through the same real stack as the model-facing tool when native skills are enabled
- `/command-name args` and `/skill:name args` both route through the human invocation path
- generated `/skill:*` shims do not show up as ordinary prompts
- ordinary Pi prompt templates still expand inline as prompts
- raw `read SKILL.md` remains inspection, not execution
