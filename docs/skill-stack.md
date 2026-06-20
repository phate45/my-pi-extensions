# Skill Stack

## Purpose

The skill stack makes Claude-style skills feel native in Pi while preserving a clean separation between raw file inspection and actual skill execution.

## Responsibilities

This stack owns:
- `.claude/skills` discovery
- model-facing `skill` tool registration
- human `/skill:name args` execution
- generated prompt shims for skill commands
- startup and prompt filtering so shims do not masquerade as normal prompts

## Invariants

Keep these aligned:
- visible skill list
- model-facing tool behavior
- human command behavior
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
- `/skill:name args` executes through the same real stack as the model-facing tool
- generated `/skill:*` shims do not show up as ordinary prompts
- raw `read SKILL.md` remains inspection, not execution
