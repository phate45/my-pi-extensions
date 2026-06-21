# my-pi-extensions

This repo is a local Pi package for my personal Pi environment.

It bundles:
- shared extension infrastructure
- Claude-style compatibility behavior
- personal extensions and experiments
- themes

It exists so Pi customization lives in one repo instead of leaking across `~/.pi/agent` and whatever half-remembered local edits seemed funny at the time.

## What this package does

- loads managed Pi extensions from multiple extension families
- supports bundle-level feature flags and per-extension config
- provides Claude-style `.claude/commands` and `.claude/skills` compatibility; with a custom `Skill` tool
- integrates with Pi's native skill stack
- includes a generated example bundle config and test coverage for extension behavior

## Layout

- `extensions/infra/` — shared bundle infrastructure, config bootstrap, managed extension helpers, and input pipeline wiring
- `extensions/cc-like/` — Claude Code-like behavior for skills, prompts, context loading, markdown expansion, and invocation UX
- `extensions/my-stuff/` — personal extensions, tools, and experiments
- `themes/` — theme files
- `docs/` — middle-layer architecture and subsystem docs
- `tests/` — unit and integration coverage

## Configuration

Bundle config can come from:
- the global Pi agent config location
- trusted project-local `./.pi/my-pi-settings.json`
- CLI override via `--my-pi-settings <path>`

Useful entry points:
- `my-pi-settings.example.json` — generated example config from managed extension declarations
- `docs/bundle-config.md` — bundle config behavior, precedence, and runtime timing notes

## Development

Common commands:
- `just test`
- `just test-unit`
- `just test-integration`
- `just lint`
- `just lint-ci`
- `just generate-config`

## Docs

- `docs/architecture.md`
- `docs/bundle-config.md`
- `docs/context-stack.md`
- `docs/markdown-expansion.md`
- `docs/skill-stack.md`
- `docs/system-prompt.md`
- `docs/web-research.md`

## No guarantees

This is not a polished distribution, supported product, or stability promise.
I use it to shape my own Pi environment, and I am perfectly willing to monkey-patch Pi internals when the public API stops one layer short of useful.

If you copy parts of it, assume:
- paths may be specific to my machine
- behavior may depend on my `~/.pi/agent` setup
- some extensions exist because I wanted a thing now, not because the design is blessed
- Pi updates may break the sharper hacks

## Inspired by

This setup borrows ideas, patterns, or reference material from:
- [`davis7dotsh/my-pi-setup`](https://github.com/davis7dotsh/my-pi-setup/)
- [`earendil-works/pi` coding-agent extension examples](https://github.com/earendil-works/pi/tree/main/packages/coding-agent/examples/extensions)

## Use at your own risk

If Pi changes under me and something explodes, that is not a bug in the README. That is the price of doing fun surgery on the runtime.
