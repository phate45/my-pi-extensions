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

## Package Layout

- `package.json` — Pi package manifest; exposes `./extensions` and `./themes`
- `themes/nightowl.json` — imported theme
- `extensions/context.ts` — custom `/context` view with context-window estimates, loaded-skill tracking, and effective context reporting
- `extensions/custom-header.ts` — startup header with loaded context/skills/prompts/extensions summary
- `extensions/tps-tracker.ts` — generation tokens/sec footer and final run notification
- `extensions/web-research.ts` — `web_research` tool backed by Codex CLI
- `extensions/fish-user-bash.ts` — runs user `!` / `!!` commands through fish with curated aliases
- `extensions/git-context.ts` — snapshots short git repo state at session start and injects it into the system prompt when Pi starts inside a worktree
- `extensions/interactive-at-read.ts` — turns interactive `@path` references into hidden read-tool payloads plus a visible read marker
- `extensions/claude-skill-paths.ts` — adds `.claude/skills` directories to Pi skill discovery
- `extensions/claude-command-paths.ts` — adds `.claude/commands` directories to Pi prompt discovery
- `extensions/skill-tool.ts` — registers the model-facing `skill` tool and owns `/skill:name` execution
- `extensions/claude-markdown-preprocessor.ts` — preprocesses prompt markdown with `!` and `@`
- `extensions/00-system-prompt-markdown-preprocessor.ts` — lets `SYSTEM.md` use inline `!` and `@` expansion
- `extensions/10-claude-context-local-files.ts` — extends context loading to include `.local.md` companions
- `extensions/lib/` — shared helpers for context discovery, preprocessing, skill execution, prompt shims, and startup summaries

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
- `extensions/lib/claude-context.ts`
- `extensions/10-claude-context-local-files.ts`
- `extensions/lib/startup-summary.ts`
- `extensions/context.ts`

Keep these aligned:
1. prompt-loaded context files
2. manually read context files
3. dedupe handling for discovered `.local.md` files
4. startup header context listing
5. `/context` effective context listing

### When editing command preprocessing

Start with:
- `extensions/claude-markdown-preprocessor.ts`
- `extensions/claude-command-paths.ts`

Keep `claude-markdown-preprocessor.ts` prompt-focused. It should not execute skills, preprocess raw skill reads, or expand `/skill:*` prompt shims.

### When editing skill behavior

Start with:
- `extensions/skill-tool.ts`
- `extensions/lib/skill-execution.ts`
- `extensions/lib/skill-prompt-shims.ts`
- `extensions/lib/claude-skill-discovery.ts`
- `extensions/claude-skill-paths.ts`
- `extensions/lib/startup-summary.ts`

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
- `extensions/00-system-prompt-markdown-preprocessor.ts`
- `extensions/lib/claude-context.ts`
- `~/.pi/agent/SYSTEM.md`
- `~/.pi/agent/render-pi-doc-paths.sh`

System-prompt preprocessing should inline stdout directly, not wrap the generated docs block in `<command-output>` tags.

### When editing web research behavior

Start with:
- `extensions/web-research.ts`

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
