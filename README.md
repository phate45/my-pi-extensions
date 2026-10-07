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
- composes Claude-compatible behavior behind one explicitly ordered Pi entrypoint
- preserves bundle-level feature flags and per-extension config across composed extensions
- provides Claude-style `.claude/commands`, `.claude/skills`, and path-scoped `.claude/rules` compatibility with a custom `Skill` tool
- integrates with Pi's native skill stack
- bundles `pi-subagents` as Claude-compatible behavior, including its packaged skills and prompts
- bundles Patty's background task tools while suppressing its redundant `agent_bg` tool
- includes a generated example bundle config and test coverage for extension behavior
- shows live TPS and the timestamped completion summary through `ctx.ui.setStatus("tps", ...)`, without completion notifications

## Layout

- `extensions/infra/` — shared bundle infrastructure, config bootstrap, managed extension helpers, and input pipeline wiring
- `extensions/cc-like/` — Claude Code-like behavior composed in ascending filename order by `index.ts`
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

## Curated skill mode

Wrappers can give a Pi agent a persona-specific skill set without leaking ambient global, project, or `.claude/skills` resources:

```bash
pi --no-skills \
  --skill /path/to/persona-skill-one/SKILL.md \
  --skill /path/to/persona-skill-two/SKILL.md
```

`--no-skills` disables ambient discovery, while repeated explicit `--skill` entries remain available through the custom model-facing `skill` tool and its Claude markdown preprocessing. If Pi loads no valid explicit skills, the model-facing tool stays disabled.

## Development

`package.json` records the exact development pins for Pi's core packages and TypeBox. Runtime package peers use Pi's bundled core modules.

Common commands:
- `just test`
- `just test-unit`
- `just test-integration`
- `just compat` — query npm and test against the latest Pi release in an isolated worktree
- `just compat-update` — run the compatibility check, then promote the tested dependency pins
- `just lint`
- `just lint-ci`
- `just generate-config`

Both compatibility recipes accept `--target <exact-version>`. Resolve the desired version once,
then use it for every check and promotion. An explicit target always runs the checks, even when it
matches the current pin or is older. Without a target, the recipes resolve npm's latest release and
skip checks when the pinned SDK does not trail it. A skip confirms version currency, not compatibility.

The recipes snapshot the checkout in a temporary worktree, update its Pi development dependencies,
and run typechecks, tests, formatting checks, and a Pi CLI smoke test. Checks use disposable HOME,
Pi config, and session directories and ignore inherited `CLAUDE_PROJECT_DIR`. The runtime smoke test
uses a separate empty environment and pre-approves trust. The recipes remove the snapshot afterward
and leave the global Pi installation and settings untouched.

For a pin-only upgrade, run `just compat-update --target <exact-version>` directly. It checks before
copying the tested `package.json` and `bun.lock` into the checkout; failed checks leave both files
untouched. Use `just compat --target <exact-version>` first when investigating a migration without
promoting dependencies. After promotion, install with `bun install --frozen-lockfile` and verify the
checkout with `just test` under an isolated HOME, `just typecheck-all`, and `just lint-ci`.

`just fleet-ready pi` reports the tested `@earendil-works/pi-coding-agent` development pin for fleet
rollouts. This read-only, offline probe uses Bash, Git, and jq. It prints one bare version and exits 0
only when `package.json` has no staged or unstaged changes and its pin matches the last-fetched
origin default branch at `refs/remotes/origin/HEAD`. It never fetches. Missing cached refs, invalid
pins, different local pins, and unsupported tools exit 2 without stdout. Unrelated local changes
and commits do not block an answer.

## Docs

- `docs/architecture.md`
- `docs/bundle-config.md`
- `docs/context-stack.md`
- `docs/markdown-expansion.md`
- `docs/skill-stack.md`
- `docs/rules-stack.md`
- `docs/system-prompt.md`
- `docs/tensorx-provider.md`
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
