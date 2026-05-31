# my-pi-extensions

## What This Is

This repository is a local Pi package loaded from `~/.pi/agent/settings.json`.
It carries Pi-specific extensions, themes, and Claude-compatibility shims under version control instead of scattering them through `~/.pi/agent`.

## How We Work Here

- Treat this repo as Pi internals / Pi customization work
- Inventory the package first, then read only the docs and source relevant to the task at hand
- Before changing behavior, identify which extension or helper owns it
- Follow relevant Pi doc cross-references before implementing

## Pi Docs Source of Truth

The Pi docs path is provided in the active system prompt context.
When working on Pi topics, use that installed docs tree as the source of truth and follow related `.md` cross-references.

Examples:
- extension lifecycle or hooks → `docs/extensions.md`
- SDK/runtime/resource loader behavior → `docs/sdk.md`
- skill discovery or command behavior → `docs/skills.md`
- TUI behavior or components → `docs/tui.md`

## What This Package Does

This package has two jobs:

1. Carry a few stock Pi extensions/themes copied from reference material
2. Make Claude-style project conventions work naturally inside Pi

The Claude-compat layer is the important part. It teaches Pi how to discover `.claude` resources, preprocess Claude-flavored markdown, and load local context overrides without duplicating content.

The extension tree is split into three buckets:

- `extensions/cc-like/` — actual extension entrypoints for Claude Code-like behavior
- `extensions/my-stuff/` — actual extension entrypoints for personal Pi customizations
- `extensions/**/lib/` — implementation helpers only, never extension entrypoints

## Package Layout

- `package.json` — Pi package manifest; explicitly lists actual extension entrypoints under `extensions/cc-like/*.ts` and `extensions/my-stuff/*.ts`, plus `./themes`
- `themes/nightowl.json` — imported theme
- `extensions/cc-like/` — Claude Code-like shim entrypoints
  - `00-system-prompt-markdown-preprocessor.ts` — lets `SYSTEM.md` use inline `!` and `@` expansion
  - `10-cc-context-local-files.ts` — extends context loading to include `.local.md` companions
  - `cc-command-paths.ts` — adds `.claude/commands` directories to Pi prompt discovery
  - `cc-markdown-preprocessor.ts` — preprocesses prompt markdown with `!` and `@`
  - `cc-skill-paths.ts` — adds `.claude/skills` directories to Pi skill discovery
  - `context.ts` — custom `/context` view with context-window estimates, loaded-skill tracking, and effective context reporting
  - `custom-header.ts` — startup header with loaded context/skills/prompts/extensions summary
  - `git-context.ts` — snapshots short git repo state at session start and injects it into the system prompt when Pi starts inside a worktree
  - `interactive-at-read.ts` — turns interactive `@path` references into hidden read-tool payloads plus a visible read marker
  - `skill-tool.ts` — registers the model-facing `skill` tool and owns `/skill:name` execution
  - `lib/` — shim internals for context discovery, markdown preprocessing, skill execution, startup summaries, and extension-runtime monkey patches
- `extensions/my-stuff/` — personal Pi customization entrypoints
  - `fish-user-bash.ts` — runs user `!` / `!!` commands through fish with curated aliases
  - `multi-edit.ts` — custom multi-file edit tool
  - `tps-tracker.ts` — generation tokens/sec footer and final run notification
  - `web-research.ts` — `web_research` tool backed by Codex CLI
  - `whimsical.ts` / `yeet.ts` — local experimental extensions

## Local Task Runner

Prefer the local `justfile` recipes over ad-hoc compiler incantations.

Useful commands:

```bash
just typecheck path/to/file.ts [more files...]
just typecheck-all
just typecheck-skill-stack
just typecheck-context-stack
```

## Change Guidelines

### When editing context behavior

Start with:
- `extensions/cc-like/lib/cc-context.ts`
- `extensions/cc-like/10-cc-context-local-files.ts`
- `extensions/cc-like/lib/startup-summary.ts`
- `extensions/cc-like/context.ts`

Keep these aligned:
1. prompt-loaded context files
2. manually read context files
3. dedupe handling for discovered `.local.md` files
4. startup header context listing
5. `/context` effective context listing

### When editing command preprocessing

Start with:
- `extensions/cc-like/cc-markdown-preprocessor.ts`
- `extensions/cc-like/cc-command-paths.ts`

Keep `cc-markdown-preprocessor.ts` prompt-focused. It should not execute skills, preprocess raw skill reads, or expand `/skill:*` prompt shims.

### When editing skill behavior

Start with:
- `extensions/cc-like/skill-tool.ts`
- `extensions/cc-like/lib/skill-execution.ts`
- `extensions/cc-like/lib/skill-prompt-shims.ts`
- `extensions/cc-like/lib/cc-skill-discovery.ts`
- `extensions/cc-like/cc-skill-paths.ts`
- `extensions/cc-like/lib/startup-summary.ts`

Keep these aligned:
1. model-facing skill list and `disable-model-invocation`
2. model-facing `skill` tool execution
3. human `/skill:name args` execution
4. generated prompt-shim autocomplete and `argument-hint`
5. prompt/header filtering so `/skill:*` shims do not show as real prompts
6. raw `read SKILL.md` remains raw inspection, not skill execution

For skill execution, `${SKILL_DIR}` must come from `path.dirname(SKILL.md)`, not `command.sourceInfo.baseDir`.

### When editing system-prompt preprocessing

Start with:
- `extensions/cc-like/00-system-prompt-markdown-preprocessor.ts`
- `extensions/cc-like/lib/cc-context.ts`
- `~/.pi/agent/SYSTEM.md`
- `~/.pi/agent/render-pi-doc-paths.sh`

System-prompt preprocessing should inline stdout directly, not wrap the generated docs block in `<command-output>` tags.

### When editing web research behavior

Start with:
- `extensions/my-stuff/web-research.ts`

Current design:
- `web_research(query, depth?, freshness?)`
- query-only defaults to `depth="fast"` and `freshness="cached"`
- `fast` uses Codex model `gpt-5.4-mini`
- `deep` uses Codex model `gpt-5.4`
- `cached` / `live` map to Codex CLI `web_search="cached"` / `web_search="live"`
- Codex runs in an isolated temp cwd with `--sandbox read-only`, `--ephemeral`, and `--skip-git-repo-check`
- the tool returns the raw `--output-last-message` JSON string

## Verification Checklist

After changing anything important here, verify the right thing instead of relying on vibes.

- use the local `justfile` recipes
- reload Pi after package changes
- use a fresh Pi session when validating system-prompt behavior
- confirm `.claude/commands` show up as prompt templates
- confirm `.claude/skills` show up as skills
- confirm `/skill:name args` expands through `skill-tool.ts`
- confirm generated `/skill:*` shims do not show as real prompts
- confirm raw `read SKILL.md` stays raw inspection
- confirm `CLAUDE.local.md` content appears alongside `CLAUDE.md` in effective context
- confirm the custom header `[Context]` section matches `/context`
- confirm `quietStartup` is enabled so the custom header is the only startup resource summary
- confirm `web_research` defaults and freshness/depth routing remain correct
