---
created: 2026-06-21T10:13:05
modified: 2026-06-21T16:13:47
---

# Architecture

## Purpose

This package does two jobs:

1. keep Pi customizations and themes under version control
2. make Claude-style project conventions work naturally inside Pi

## Layers

### `extensions/infra/`
Shared bundle infrastructure.

Owns:
- bundle config loading and merge policy
- managed extension gating
- shared input pipeline ordering for bundle-owned transforms and routers
- generic plumbing shared across extension families

Keep this layer generic.

### `extensions/cc-like/`
Claude Code-like Pi behavior.

Owns:
- `.claude` resource discovery
- markdown expansion
- context loading and reporting
- skill execution, Claude command invocation, compact invocation rendering, and prompt shims
- startup header and git context

### `extensions/my-stuff/`
Personal Pi customizations.

Owns:
- local tools and shell behavior
- UI tweaks and experiments
- personal input transforms such as abbreviations
- feature-local typed config definitions and normalization helpers

### `extensions/**/lib/`
Helpers only.

Use `lib/` for shared implementation detail, not extension entrypoints.

## Design bias

The repo prefers:
- small changes
- explicit ownership
- tests before implementation when behavior changes
- direct entrypoints over framework sludge

If an abstraction hides when Pi registers hooks, commands, or tools, it is too clever.
