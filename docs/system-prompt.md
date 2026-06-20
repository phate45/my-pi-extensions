# System Prompt

## Purpose

This stack applies the shared markdown-expansion model to the agent-level system prompt.

Shared command and include policy lives in `markdown-expansion.md`. This doc only covers what is unique about the system prompt path.

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
