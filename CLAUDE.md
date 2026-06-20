# my-pi-extensions

## What This Is

This repository is a local Pi package loaded from `~/.pi/agent/settings.json`.
It keeps Pi extensions, themes, and Claude-compat behavior under version control instead of scattering them through `~/.pi/agent`.

## How We Work Here

- Treat this repo as Pi internals / Pi customization work
- For extension work, load `.pi/skills/writing-bundle-pi-extensions/SKILL.md` before digging into code
- Inventory the package first, then read only the docs and source relevant to the task at hand
- Before changing behavior, identify which extension family or helper owns it
- Read the relevant Pi docs before implementing; follow cross-references instead of winging it
- Prefer the smallest change that solves the actual problem
- Use TDD with the existing harness
- Write proper commit messages with bodies

## Package Topology

- `extensions/infra/` — shared bundle infrastructure
- `extensions/cc-like/` — Claude Code-like Pi behavior
- `extensions/my-stuff/` — personal Pi customizations
- `extensions/**/lib/` — helpers only, never entrypoints
- `themes/` — bundled themes
- `tests/` — unit and integration coverage
- `docs/` — middle-level technical orientation

`package.json` exposes extension entrypoints from `extensions/infra/*.ts`, `extensions/cc-like/*.ts`, and `extensions/my-stuff/*.ts`.

## Pi Docs Source of Truth

The Pi docs path is provided in the active system prompt context and the local machine setup notes.
Use that installed docs tree as the source of truth for Pi behavior.

Common entry points:
- extension lifecycle / hooks / resource discovery → `docs/extensions.md`
- SDK / runtime behavior → `docs/sdk.md`
- skills / discovery / commands → `docs/skills.md`
- TUI behavior / components → `docs/tui.md`

## Project Docs Map

Start here when the work touches one of these stacks:

- overall package shape → `docs/architecture.md`
- bundle config and managed entrypoints → `docs/bundle-config.md`
- context loading and `/context` behavior → `docs/context-stack.md`
- markdown expansion and prompt preprocessing → `docs/markdown-expansion.md`
- skills and skill-tool behavior → `docs/skill-stack.md`
- system prompt preprocessing → `docs/system-prompt.md`
- web research tool behavior → `docs/web-research.md`

## Verification

After changing anything important, verify the right slice instead of relying on vibes.

- use the local `justfile` recipes
- reload Pi after package changes
- use a fresh Pi session for startup and system-prompt validation
- confirm `.claude/commands` and `.claude/skills` still load
- confirm managed extensions still gate behavior correctly
- confirm startup summaries and `/context` stay aligned when context behavior changes
- confirm skill execution and raw `read SKILL.md` behavior stay distinct when touching the skill stack
