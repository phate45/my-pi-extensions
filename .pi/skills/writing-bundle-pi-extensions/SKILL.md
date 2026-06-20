---
name: writing-bundle-pi-extensions
description: Author or refactor Pi extensions for this bundle. Use when adding an extension entrypoint, changing bundle config or feature-flag wiring, moving extension helpers between infra and feature folders, or modifying Pi-specific behavior under extensions/.
---

# Writing Bundle Pi Extensions

This skill is for extension work in `my-pi-extensions`: adding entrypoints, refactoring extension structure, wiring config, or changing Pi-specific runtime behavior.

## Step 1: Classify the change

Decide what kind of extension work this is before touching files.

- **Infra**: generic bundle plumbing shared across extension families
  - examples: bundle config loader, managed extension shim
  - location: `extensions/infra/`
- **Claude-compat behavior**: Claude Code-like Pi behavior
  - location: `extensions/cc-like/`
- **Personal extensions**: Mark-specific tools and UI customizations
  - location: `extensions/my-stuff/`
- **Helpers only**: reusable implementation detail, never an entrypoint
  - location: `extensions/**/lib/`

Completion criterion: you can name the owning extension family and the concrete files that should change.

## Step 2: Read the right source of truth

Read the in-repo guidance and the Pi docs that govern the behavior you are changing.

Start with:
- [`CLAUDE.md`](../../../CLAUDE.md)
- [`package.json`](../../../package.json)
- the owning extension entrypoint and nearby `lib/` helpers

Then read the relevant Pi docs from the installed Pi tree:
- extension lifecycle/hooks/resource loading → `docs/extensions.md`
- skills/skill discovery/skill commands → `docs/skills.md`
- TUI behavior/components → `docs/tui.md`
- SDK/runtime/resource loader behavior → `docs/sdk.md`

If those docs point to related pages, follow them before implementing.

Completion criterion: you can point to the Pi doc section and repo file that define the intended behavior.

## Step 3: Place code at the right layer

Use the smallest layer that honestly owns the behavior.

### Put code in `extensions/infra/` when
- the logic is generic across extension families
- the code defines shared bundle policy
- feature gating/config plumbing would otherwise be duplicated

### Put code in `extensions/cc-like/` when
- the behavior is part of Claude-compat semantics
- it changes prompt/context/skill/command preprocessing or discovery

### Put code in `extensions/my-stuff/` when
- the behavior is personal to this bundle's non-Claude customizations
- it registers tools, commands, or UI behavior that is not generic infra

### Put code in `lib/` when
- the file is a helper, parser, renderer, or normalizer
- it should never be loaded as an extension entrypoint

Do not hide bundle-generic logic in `my-stuff` just because it was convenient once.

Completion criterion: entrypoints live in the correct top-level folder and helper code lives under the nearest sensible `lib/`.

## Step 4: Use the bundle's managed extension shape

For bundle-managed entrypoints, prefer the shared shim:
- `extensions/infra/lib/managed-extension.ts`

Use the no-config form when the extension only needs enablement:

```ts
export default defineManagedExtension({
  name: "git-context",
  featureFlag: "ccLike",
  setup(pi) {
    // register hooks/tools/commands
  },
});
```

Use the config-backed form when the extension has real per-extension settings:

```ts
export default defineManagedExtension({
  name: "web-research",
  featureFlag: "myStuff",
  getConfig: getWebResearchConfig,
  setup(pi, config) {
    // consume typed config here
  },
});
```

Keep responsibilities split cleanly:
- generic config loading/merging/feature flags → `extensions/infra/lib/bundle-config.ts`
- generic enablement wrapper → `extensions/infra/lib/managed-extension.ts`
- extension-specific typed config normalization → local helper near the extension, e.g. `extensions/my-stuff/lib/web-research-config.ts`

Do not turn `bundle-config.ts` into a registry of every extension's schema.

Completion criterion: the entrypoint is thin, the generic policy lives in infra, and any typed config parsing is local to the owning extension.

## Step 5: Preserve Pi entrypoint clarity

Pi entrypoints are plain functions over `ExtensionAPI`. Keep them obvious.

- Register hooks/tools/commands directly in the entrypoint or a clearly named helper
- Avoid inheritance and lifecycle abstraction layers
- Do not obscure when behavior runs at factory time versus `session_start`
- Keep feature gating explicit at the entrypoint boundary

If a shared abstraction makes it harder to see when registration happens, it is too clever.

Completion criterion: a reader can explain registration timing and runtime behavior from the entrypoint without spelunking through framework sludge.

## Step 6: Update resource wiring when needed

When adding or moving entrypoints, verify package discovery still matches intent.

Check:
- `package.json` `pi.extensions`
- whether the new file should be matched by existing globs
- whether a helper file accidentally became discoverable as an entrypoint

This bundle currently uses top-level globs for:
- `extensions/infra/*.ts`
- `extensions/cc-like/*.ts`
- `extensions/my-stuff/*.ts`

Completion criterion: Pi will discover the intended entrypoints and ignore helper files.

## Step 7: Test first, then verify the right slice

Follow the repo workflow: TDD, then implementation, then targeted verification.

Useful commands:
- `just test`
- `just test-unit`
- `just test-integration`
- `just typecheck-all`
- `just typecheck-skill-stack`
- `just typecheck-context-stack`

Typical expectations:
- add or update unit tests for config parsing, enablement, or registration behavior
- run integration tests when discovery/loading/registration semantics changed
- run the focused typecheck recipe when touching the skill/context stacks

Completion criterion: the tests that cover the changed behavior pass, and you ran the narrowest command that proves the change is real.

## Step 8: Keep related behaviors aligned

When changing one part of a Pi behavior stack, check the sibling files named in `CLAUDE.md` instead of fixing only one visible symptom.

Examples:
- context behavior changes often span context discovery, startup summary, and `/context`
- skill behavior changes often span discovery, execution, prompt shims, and startup filtering
- markdown preprocessing changes often span shared expansion policy and the entrypoints that invoke it

Completion criterion: no adjacent behavior stack is left stale by the change.

## Red flags

Stop and reconsider when you are about to:
- add a base class hierarchy for extensions
- put extension-specific schema rules into infra
- duplicate feature-flag/config parsing in an entrypoint
- register helper files as entrypoints
- fix a Pi behavior without reading the governing doc page first
- add broad refactors when a surgical change would do

## Output standard

A good extension change in this bundle has these properties:
- correct owning layer
- thin entrypoint
- shared policy in infra only when genuinely generic
- typed config helper local to the extension when needed
- tests proving registration and/or behavior
- Pi docs and repo guidance actually consulted, not vibes-based improvisation
