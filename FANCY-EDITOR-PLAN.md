# Fancy Editor Reimplementation Plan

## Goal

Build a new Pi extension that replaces the default editor chrome with a custom editor implementation and a powerline-style status bar.

This plan intentionally does **not** port `pi-powerline-footer` wholesale. That package bundles several unrelated features into a single extension. We only want the editor and status-bar ideas, plus the stash shortcut. We will reimplement those pieces to fit this package's structure and conventions.

## Source Material

The upstream reference implementation lives at:

- `/tmp/pi-powerline-footer`

Key files in that package:

- `index.ts` — monolithic extension entrypoint and feature hub
- `types.ts` — status segment and preset types
- `presets.ts` — segment ordering and preset definitions
- `segments.ts` — segment rendering logic
- `git-status.ts` — async git status caching and invalidation
- `icons.ts` — Nerd Font and ASCII icon sets
- `theme.ts` — semantic color resolution and optional theme override file
- `welcome.ts` — startup overlay and resource/session discovery
- `working-vibes.ts` — generated themed loading messages

Relevant Pi docs and examples already scouted:

- Pi docs: `docs/extensions.md`
- Pi examples:
  - `examples/extensions/custom-footer.ts`
  - `examples/extensions/modal-editor.ts`
  - `examples/extensions/status-line.ts`
  - `examples/extensions/rainbow-editor.ts`

Those docs and examples establish the extension APIs we need:

- `ctx.ui.setEditorComponent(...)`
- `ctx.ui.setFooter(...)`
- `ctx.ui.setWidget(...)`
- `pi.registerShortcut(...)`
- lifecycle hooks such as `session_start`, `tool_result`, and `user_bash`

## What to Build

Create a new extension entrypoint:

- `extensions/editor.ts`

This extension should provide:

1. A custom editor implementation based on Pi's `CustomEditor`
2. A powerline-style top status row rendered inside the editor chrome
3. An optional secondary row for overflowed status segments
4. Editor stash behavior on `Alt+S`
5. Git branch and dirty-state integration
6. Model, thinking, path, context, cost, and extension-status segments

## What to Exclude in v1

Do **not** bring these features into the first implementation:

- welcome overlay or startup header
- working vibes
- model profile switcher
- stash history picker
- prompt mining from session files
- theme override file support unless a concrete need appears
- large preset matrix copied from upstream

These features add complexity without helping the core editor work.

## Design Principles

### 1. Port the ideas, not the artifact

The upstream package proves the editor replacement works. It does not define the architecture we should keep.

We should preserve:

- the custom editor strategy
- the status segment concept
- the responsive overflow layout
- the stash interaction model
- the git caching pattern

We should rewrite:

- the extension orchestration
- state ownership
- segment context construction
- path handling
- file layout

### 2. Keep `editor.ts` small

`extensions/editor.ts` should wire Pi lifecycle events and commands to helper modules. It should not become another 2,000-line feature hub.

### 3. Keep rendering logic pure where possible

Given a status context, segment renderers should return strings and visibility flags. Avoid hidden filesystem or process calls inside segment rendering.

### 4. Fail safely

If the custom editor cannot initialize, Pi must fall back to the default editor behavior. The extension should log debug output and avoid breaking text input.

## Proposed File Layout

```text
pi-customizations/
├── FANCY-EDITOR-PLAN.md
├── extensions/
│   ├── editor.ts
│   └── lib/
│       └── editor/
│           ├── colors.ts
│           ├── editor-component.ts
│           ├── git.ts
│           ├── icons.ts
│           ├── layout.ts
│           ├── presets.ts
│           ├── segments.ts
│           ├── stash.ts
│           ├── state.ts
│           └── types.ts
```

## Module Responsibilities

### `extensions/editor.ts`

Own extension lifecycle wiring.

Responsibilities:

- register `session_start` hook
- install the custom editor component
- register footer data tap via `ctx.ui.setFooter(...)`
- register widgets for overflow rows if needed
- register `Alt+S` stash shortcut
- invalidate git caches on file mutations and branch-changing commands
- own any extension-level enable/disable or debug hooks

### `extensions/lib/editor/state.ts`

Hold in-memory runtime state.

Suggested state:

- current editor instance
- current footer data provider reference
- TUI reference for forced rerenders
- session start time
- current stash contents
- last computed layout cache, if needed

This module should define a small runtime state object instead of scattering module-level variables across multiple files.

### `extensions/lib/editor/editor-component.ts`

Wrap Pi's `CustomEditor` and override rendering.

Responsibilities:

- instantiate the custom editor
- preserve default editing behavior from `CustomEditor`
- intercept render output and insert custom chrome
- render top status line
- render top border, prompt lines, and bottom border
- cooperate with optional widgets below or above the editor

This is the core of the feature.

### `extensions/lib/editor/layout.ts`

Compute which status segments fit on the top row and which spill to a secondary row.

Responsibilities:

- measure visible widths
- pack segments in order
- build the top-row string
- build the secondary-row string

The upstream `computeResponsiveLayout()` logic is a useful reference, but the reimplementation should stay small and only support what we actually use.

### `extensions/lib/editor/segments.ts`

Render individual status segments.

Start with a minimal segment set:

- `pi`
- `model`
- `thinking`
- `path`
- `git`
- `context`
- `cost`
- `extension_statuses`

Possible later additions:

- token totals
- cache read/write
- session id
- clock

### `extensions/lib/editor/presets.ts`

Define segment ordering and separator style.

For v1, keep this tiny. One default preset is enough. At most, add:

- `default`
- `compact`
- `ascii`

Do not copy the full upstream preset matrix unless we decide we need it.

### `extensions/lib/editor/types.ts`

Define:

- segment identifiers
- render context type
- preset type
- color scheme type
- segment render result type

The types from upstream are a good starting point, but they should be trimmed to the segments and options we actually support.

### `extensions/lib/editor/icons.ts`

Define icon sets and fallback behavior.

Keep the upstream strategy:

- Nerd Font icons when available
- ASCII or simple Unicode fallback otherwise

This module should stay data-oriented.

### `extensions/lib/editor/colors.ts`

Map semantic segment colors to Pi theme colors or fixed colors.

For v1, hardcode a small semantic palette in code. Skip dynamic `theme.json` loading unless that becomes necessary.

### `extensions/lib/editor/git.ts`

Provide async git branch and dirty-state caching.

Keep the good parts of the upstream implementation:

- short TTL cache
- branch cache separate from status cache
- background refresh during synchronous render calls
- explicit invalidation after relevant tool events

Avoid copying the module verbatim. Rewrite it cleanly around the needs of this extension.

### `extensions/lib/editor/stash.ts`

Implement stash behavior.

Required behavior:

- `Alt+S` with editor text and no stash: stash text and clear editor
- `Alt+S` with empty editor and stash present: restore stash
- `Alt+S` with editor text and stash present: replace stash with current editor text and clear editor
- `Alt+S` with empty editor and no stash: show a notification

Expose a small API that `editor.ts` can call.

For v1, keep stash in memory. Persistent stash history can come later if needed.

## Upstream Features Worth Reusing Conceptually

### Custom editor replacement

The upstream implementation proves that a Pi extension can:

- install a `CustomEditor` wrapper via `ctx.ui.setEditorComponent(...)`
- preserve default editor handling by delegating to `CustomEditor`
- override `render(width)` to inject custom status rows and borders

That technique is the foundation of the new extension.

### Footer data as a read-only signal source

The upstream extension uses `ctx.ui.setFooter(...)` even though it renders no visible footer. It does this to access `ReadonlyFooterDataProvider` for:

- current git branch
- extension statuses from `ctx.ui.setStatus(...)`
- rerender notifications on branch change

We should keep that pattern. It is a clean way to consume footer state while rendering the status bar elsewhere.

### Responsive layout with overflow row

The upstream extension computes a top row and a secondary row. That idea is worth preserving.

It allows the editor chrome to adapt to narrow terminals without truncating everything into mush.

### Git cache invalidation strategy

The upstream extension invalidates git caches on:

- `write`
- `edit`
- branch-affecting `bash` commands
- branch-affecting `user_bash` commands

This behavior belongs in the new extension.

## Known Problems in the Upstream Package

These observations matter because a new session will not have the investigation context.

### 1. The upstream entrypoint is monolithic

`/tmp/pi-powerline-footer/index.ts` owns too many concerns:

- editor chrome
- stash
- vibes
- welcome overlay
- model profiles
- prompt history
- git integration
- commands and shortcuts
- UI overlays

Do not recreate that shape.

### 2. Path rendering uses `process.cwd()`

The upstream `segments.ts` uses `process.cwd()` for the path segment.

The new implementation should prefer the session or extension context value instead, so the displayed path tracks Pi's actual working directory rather than the process default.

### 3. Several pieces rely on broad `any` typing

The upstream package uses `any` heavily around editor and context objects. The new implementation should tighten types wherever Pi's public API makes that practical.

### 4. Welcome/resource discovery is heuristic

The upstream `welcome.ts` scans the filesystem to infer loaded resources. That logic is not needed for the editor work and should not come along for the ride.

## Status Model for v1

Build a focused status context instead of porting the entire upstream context builder.

Suggested shape:

```ts
interface EditorStatusContext {
  modelName: string;
  thinkingLevel: string;
  cwd: string;
  gitBranch: string | null;
  gitCounts: {
    staged: number;
    unstaged: number;
    untracked: number;
  };
  contextPercent: number | null;
  contextWindow: number | null;
  cost: number | null;
  extensionStatuses: ReadonlyMap<string, string>;
}
```

This structure is enough to build a useful status bar without pulling in every upstream token and profile feature.

## Editor Rendering Strategy

The custom editor should render in this order:

```text
status row
horizontal rule
prompted editor content
horizontal rule
```

When status content overflows:

```text
top status row
horizontal rule
prompted editor content
horizontal rule
secondary status row
```

A possible rendering shape:

```text
 π | model | think:med | repo | git | 41.2%/200k | $0.03
 ─────────────────────────────────────────────────────────
 > user input line 1
   continuation line 2
 ─────────────────────────────────────────────────────────
 stash
```

The exact styling can evolve later. The structural goal matters more than the initial cosmetics.

## Event Wiring Plan

### `session_start`

- create or reset runtime state
- install custom editor component
- install footer data provider bridge
- install overflow-row widget if used
- clear stash indicator on session switch

### `tool_result`

Invalidate git caches on file mutation tools:

- `write`
- `edit`

Also inspect `bash` results when the command likely changed git branch or working tree state.

### `user_bash`

Inspect commands triggered by `!` and invalidate branch or status caches when they may affect git state.

### shortcut registration

Register:

- `alt+s` — stash / restore editor text

## Recommended Implementation Sequence

### Phase 1 — skeleton extension

Create `extensions/editor.ts` and install a wrapped `CustomEditor` that renders a placeholder status row.

Success criteria:

- Pi still accepts input normally
- custom editor renders without breaking autocomplete or prompt input
- fallback to default behavior remains possible if initialization fails

### Phase 2 — minimal segment system

Add:

- basic types
- icons
- colors
- one preset
- minimal segment renderers

Success criteria:

- status row shows model, thinking, path, and placeholder git data
- rendering code stays isolated from extension lifecycle wiring

### Phase 3 — responsive overflow layout

Implement top-row packing and secondary-row overflow.

Success criteria:

- narrow terminals still show useful status information
- segment ordering stays stable

### Phase 4 — stash

Add stash handling and indicator updates.

Success criteria:

- `Alt+S` toggles stash behavior correctly
- stash state survives within the session
- status or indicator shows when a stash exists

### Phase 5 — git integration

Add git branch and dirty-state caching plus invalidation.

Success criteria:

- branch and dirty counts appear without blocking render performance
- edits and branch changes refresh the status bar predictably

### Phase 6 — polish

Possible polish items after the core works:

- refine separators and icon fallbacks
- add compact preset
- add token or time segments if useful
- decide whether stash persistence is worth adding

## Verification Checklist

After implementation changes:

1. Typecheck the new extension files
2. Run `/reload`
3. Start a fresh Pi session
4. Confirm the editor still accepts normal input
5. Confirm autocomplete still works
6. Confirm the custom status row renders in wide and narrow terminals
7. Confirm `Alt+S` stashes and restores text correctly
8. Confirm git branch and dirty state update after edits and branch changes
9. Confirm disabling or failure paths do not leave Pi without a usable editor

## Explicit Non-Goals

These are tempting but outside the scope of the first implementation:

- build a complete upstream-compatible clone
- preserve every upstream preset, command, and shortcut
- port overlay UIs unrelated to the editor
- add session mining or history browsers
- add generated loading-message features

## Handoff Summary

A future session should treat this as a focused reimplementation project.

The task is:

- build a new extension at `extensions/editor.ts`
- use `/tmp/pi-powerline-footer` as reference material only
- reimplement the custom editor chrome and stash behavior in small modules
- keep the first version narrow, typed, and debuggable

If scope pressure appears, cut features until only these remain:

- custom editor wrapper
- top status row
- stash shortcut
- git branch integration

That reduced slice still delivers the core value.
