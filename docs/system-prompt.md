---
created: 2026-06-21T10:13:05
modified: 2026-10-03T15:29:29
---

# System Prompt

## Purpose

This stack applies the shared markdown-expansion model to the agent-level system prompt.

Shared command and include policy lives in `markdown-expansion.md`. This doc only covers what is unique about the system prompt path.

## Instruction composition

Pi selects `<cwd>/.pi/SYSTEM.md` before `<agentDir>/SYSTEM.md`. The bundle preserves that precedence and expands the selected template before adding context. `PI_CODING_AGENT_DIR` selects the agent directory when set.

Keep `SYSTEM.md` specific to Pi. Put shared agent instructions in `~/.claude/CLAUDE.md`; the context loader adds that file when it exists and `cc-context-local-files.config.claudeFiles.global` is enabled. A selected `SYSTEM.md` does not suppress Claude context files. Project `CLAUDE.md` and `CLAUDE.local.md` remain separate project instructions.

`scripts/render-pi-doc-paths.sh` locates the installed Pi docs from its pnpm launcher, including both `dist/cli.js` and `dist/bundle/cli.js`. It also identifies this bundle checkout and points agents to the bundle settings documentation and example defaults. A machine-local wrapper can call this tracked script from a `!cmd` line in `SYSTEM.md`.

## Rendering mode

System prompt preprocessing uses inline rendering for file includes.

That means:
- successful command expansion inlines stdout directly
- failed command expansion still renders structured command-output XML
- file includes inline raw content instead of wrapped file-content blocks

## Scope

Use this stack when changing:
- startup system prompt preprocessing
- how global agent instructions expand `!cmd` or `@path`
- how system prompt expansion interacts with project context loading

## Verification

After changes, verify in a fresh Pi session:
- the system prompt contains the expected expanded content
- inline includes stay inline
- successful command output stays clean
- failure output remains diagnosable
