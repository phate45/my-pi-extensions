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

## Verification

After changes, verify:
- successful command output no longer sprays XML
- failures still preserve diagnostic structure
- file rendering mode stays correct for the owning resource type
- config kill switches still behave independently
