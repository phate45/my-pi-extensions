---
created: 2026-06-21T10:13:05
modified: 2026-06-21T15:33:29
---

# Markdown Expansion

## Purpose

This stack preprocesses Claude-flavored markdown for prompts, skills, context files, and the system prompt.

## Model

The bundle supports two expansion forms:
- `!cmd` command execution
- `@path` file includes

Expansion policy is shared. Entry-specific behavior should come from rendering mode, not from copy-pasted preprocess logic.

## Shared policy

Command behavior:
- successful `!cmd` expands to trimmed stdout only
- failing `!cmd` expands to structured command-output XML

File include behavior:
- prompt, skill, and context includes use structured file wrappers
- system prompt rendering rules are defined separately in `system-prompt.md`

## Kill switches

Bundle config can:
- disable all interpolation
- disable only command execution
- disable only file includes

Those controls belong to bundle config, not to per-entrypoint ad hoc flags.

## Design rule

Keep prompt preprocessing prompt-focused.
It should not execute skills, preprocess raw skill inspection, or treat generated skill shims as normal prompts.

For Claude-compat resources, distinguish ordinary prompts from invocation resources:
- ordinary Pi prompt templates still expand inline through prompt preprocessing
- `.claude/commands` should be intercepted before inline prompt expansion and routed through the Claude invocation path instead
- transformed input that becomes a Claude command at send time should still hit that invocation path before ordinary prompt expansion

## Verification

After changes, verify:
- successful command output no longer sprays XML
- failures still preserve diagnostic structure
- file rendering mode stays correct for the owning resource type
- `.claude/commands` do not accidentally fall back to ordinary inline prompt expansion
- config kill switches still behave independently
