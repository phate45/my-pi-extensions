# Fancy Editor Detailed Implementation Plan

_Compiled after inspecting the local package, Pi docs/examples, and the upstream `pi-powerline-footer` reference implementation._

## Executive Summary

The good news: Pi very much supports this kind of editor surgery.

The important APIs are real and documented:
- `ctx.ui.setEditorComponent(...)`
- `ctx.ui.setFooter(...)`
- `ctx.ui.setWidget(...)`
- `pi.registerShortcut(...)`
- lifecycle hooks like `session_start`, `tool_result`, `user_bash`, `model_select`, `agent_start`, `agent_end`
- `CustomEditor` for preserving app-level keybindings while overriding render behavior

The main technical risk is **not** “can Pi do this?”
It can.

The real risk is **how invasive the render override becomes**, especially around:
- autocomplete rows
- empty-editor rendering
- narrow terminals
- rerender triggers for git/footer/status changes
- not accidentally desyncing from Pi’s default editor behavior

So the implementation should treat the custom editor wrapper as a **thin chrome adapter** around `CustomEditor`, not a rewrite of editing behavior.

---

## What I Inspected

### Local package

```text
pi-customizations/
├── AGENTS.md
├── FANCY-EDITOR-PLAN.md
├── package.json
├── extensions/
│   ├── 00-system-prompt-markdown-preprocessor.ts
│   ├── 10-claude-context-local-files.ts
│   ├── claude-command-paths.ts
│   ├── claude-markdown-preprocessor.ts
│   ├── claude-skill-paths.ts
│   ├── context.ts
│   ├── multi-edit.ts
│   ├── whimsical.ts
│   └── lib/
│       ├── claude-context.ts
│       └── markdown-preprocess.ts
└── themes/
    └── nightowl.json
```

### Relevant Pi docs read

- `README.md`
- `docs/extensions.md`
- `docs/sdk.md`
- `docs/skills.md`
- `docs/tui.md`
- `docs/keybindings.md`
- `docs/themes.md`
- `docs/session.md`

### Relevant Pi examples read

- `examples/extensions/custom-footer.ts`
- `examples/extensions/modal-editor.ts`
- `examples/extensions/status-line.ts`
- `examples/extensions/rainbow-editor.ts`

### Upstream reference inspected

```text
/tmp/pi-powerline-footer/
├── README.md
├── index.ts
├── types.ts
├── presets.ts
├── segments.ts
├── git-status.ts
├── icons.ts
├── theme.ts
├── welcome.ts
└── working-vibes.ts
```

I also inspected the key regions of `index.ts` around:
- responsive layout computation
- session lifecycle wiring
- stash shortcut behavior
- custom editor setup
- footer bridge setup
- secondary-row widget rendering

---

## What Pi’s API Actually Guarantees

## 1. Custom editor support is first-class

Pi’s extension API explicitly supports replacing the main editor:

```ts
ctx.ui.setEditorComponent((tui, theme, keybindings) => new MyEditor(tui, theme, keybindings));
```

The factory type from Pi’s declarations is:

```ts
setEditorComponent(
  factory: ((tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) => EditorComponent) | undefined
): void;
```

And `CustomEditor` is declared as:

```ts
class CustomEditor extends Editor {
  constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager, options?: EditorOptions);
}
```

### Implication

We should extend `CustomEditor`, not `Editor`.
That preserves app-level behavior like:
- escape / abort
- ctrl+d exit behavior
- model shortcuts
- extension shortcuts
- default editing logic

That lines up with both the docs and the `modal-editor.ts` / `rainbow-editor.ts` examples.

---

## 2. Footer replacement can be used as a hidden data bridge

Pi’s `setFooter()` API provides a `ReadonlyFooterDataProvider` with exactly the extra state we care about:

```ts
type ReadonlyFooterDataProvider = Pick<FooterDataProvider,
  "getGitBranch" |
  "getExtensionStatuses" |
  "getAvailableProviderCount" |
  "onBranchChange"
>;
```

### Implication

The upstream trick is legit: install an effectively empty footer just to gain access to:
- current git branch
- extension statuses from `ctx.ui.setStatus(...)`
- branch-change subscriptions for rerendering

This is not a hack against undocumented internals. It is relying on a documented API shape.

---

## 3. Widgets are the right place for overflow rows

Pi supports widgets above or below the editor:

```ts
ctx.ui.setWidget("key", content, { placement: "belowEditor" });
```

### Implication

If the editor chrome only renders the primary status row, then:
- overflow row can be a widget below the editor
- notification-style statuses can optionally be a widget above the editor

This matches the upstream strategy and keeps the editor render simpler.

---

## 4. Keybindings and shortcuts are extension-safe

Pi supports extension-level keyboard shortcuts via:

```ts
pi.registerShortcut("alt+s", { ... })
```

Docs also confirm keybinding IDs and defaults, including the app/editor namespaces.

### Implication

`Alt+S` is a safe first shortcut for stash behavior.
If we later want UI hints, we should use keybinding-aware helpers (`keyHint`, injected keybindings manager) rather than hardcoding strings into render output.

---

## 5. Render contract is strict about width

Pi TUI components must render lines that do not exceed `width`.
Useful helpers:
- `visibleWidth(str)`
- `truncateToWidth(str, width)`
- `wrapTextWithAnsi(str, width)`

### Implication

The status layout module must be width-aware and ANSI-safe.
No vibes-only string concatenation unless we enjoy display corruption as a hobby.

---

## Key Findings from Pi Examples

## `modal-editor.ts`

Confirms the intended pattern:
- subclass `CustomEditor`
- override `handleInput()` for modal behavior
- call `super.handleInput(data)` for everything else
- optionally override `render(width)` to decorate output

This is the single most relevant canonical example.

## `rainbow-editor.ts`

Confirms:
- editor render override can safely post-process `super.render(width)` output
- rerender animation can be driven via `this.tui.requestRender()` from inside the custom editor

This matters because our status row and git refresh may need editor-driven rerenders.

## `custom-footer.ts`

Confirms:
- custom footer receives `footerData`
- `footerData.onBranchChange(...)` can trigger rerenders
- branch and extension status data are intentionally exposed here

## `status-line.ts`

Confirms:
- `ctx.ui.setStatus(...)` is the canonical way for extensions to publish compact status text
- those statuses are exactly what we should surface in the status bar’s `extension_statuses` segment

---

## Key Findings from the Upstream Reference

## What is worth copying conceptually

```text
upstream ideas worth keeping
┌──────────────────────────────────────────────────────────┐
│ 1. CustomEditor wrapper                                 │
│ 2. FooterDataProvider as hidden signal source           │
│ 3. Responsive top-row + overflow-row packing            │
│ 4. Async git cache with invalidation                    │
│ 5. Alt+S stash interaction model                        │
└──────────────────────────────────────────────────────────┘
```

## What should not be copied structurally

```text
upstream shape to avoid
┌──────────────────────────────────────────────────────────┐
│ giant index.ts monolith                                 │
│ welcome overlay logic mixed with editor logic           │
│ profile switching mixed with stash mixed with vibes     │
│ broad `any` types everywhere                            │
│ path segment using process.cwd()                        │
└──────────────────────────────────────────────────────────┘
```

## Specific upstream implementation details that matter

### A. Layout logic is small enough to reimplement cleanly

Upstream `computeResponsiveLayout()` is straightforward:
- render segments in order
- measure widths
- pack as many as fit into row 1
- spill the remainder into row 2 until width runs out
- preserve ordering

That logic is good and should be reimplemented in a small dedicated module.

### B. Stash behavior is exactly the desired interaction model

Upstream `Alt+S` logic matches the desired v1 behavior:
- text + no stash → stash and clear
- empty + stash → restore
- text + stash → replace stash and clear
- empty + no stash → notify

We should copy the semantics, not the persisted-history complexity.

### C. Footer bridge is important

Upstream installs an empty footer component solely to access:
- `footerData.getGitBranch()`
- `footerData.getExtensionStatuses()`
- `footerData.onBranchChange(...)`

That pattern is useful and should stay.

### D. Editor render override is the real danger zone

Upstream effectively does this:

```text
status row
horizontal rule
prompted content
horizontal rule
autocomplete rows (if any)
```

It obtains the default editor output via `originalRender(contentWidth)` and then rewrites the chrome around it.

That approach works, but it depends on assumptions about how `CustomEditor.render()` structures lines.

### E. Upstream has an autocomplete-reset workaround

There is an `autocompleteFixed` / re-set-editor-component workaround in upstream.
That smells like a compatibility patch for a real bug.

### Recommendation

Do **not** cargo-cult that into v1.
Instead:
1. start without it
2. test autocomplete explicitly
3. only add a compatibility shim if we can reproduce the issue in current Pi

Strange things are afoot at the Circle K if we import weirdness before proving we need it.

---

## Current Package Conventions to Respect

The local package already prefers:
- small extension entrypoints
- shared helper modules under `extensions/lib/*`
- typed helpers instead of giant module-level piles
- ESM imports with `.js` suffixes for local TS module references

Existing code style also favors:
- lightweight helper functions
- explicit naming
- minimal magic

### Implication

The proposed `extensions/editor.ts` + `extensions/lib/editor/*` split is aligned with the package’s actual style.

---

## Recommended Architecture

🎯 Editor architecture with clean separation:

```text
┌─────────────────────────────────────────────────────────────────┐
│ extensions/editor.ts                                           │
│ lifecycle glue, shortcut registration, footer bridge, invalid. │
└───────────────┬─────────────────────────────────────────────────┘
                │
                ├──────────────┬──────────────┬──────────────┐
                ▼              ▼              ▼              ▼
      ┌────────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
      │ state.ts       │ │ stash.ts    │ │ git.ts      │ │ presets.ts  │
      │ runtime state  │ │ Alt+S logic │ │ async cache │ │ segment set │
      └────────────────┘ └─────────────┘ └─────────────┘ └─────────────┘
                │                              │
                │                              ▼
                │                    ┌────────────────┐
                │                    │ segments.ts    │
                │                    │ pure renderers │
                │                    └───────┬────────┘
                │                            │
                ▼                            ▼
      ┌────────────────┐           ┌────────────────┐
      │ editor-        │◄──────────│ layout.ts      │
      │ component.ts   │           │ width packing  │
      │ CustomEditor   │           └────────────────┘
      │ wrapper        │
      └────────────────┘
```

---

## Recommended File Layout

```text
extensions/
├── editor.ts
└── lib/
    └── editor/
        ├── colors.ts
        ├── editor-component.ts
        ├── git.ts
        ├── icons.ts
        ├── layout.ts
        ├── presets.ts
        ├── segments.ts
        ├── stash.ts
        ├── state.ts
        └── types.ts
```

### Notes on each file

## `extensions/editor.ts`
Own only orchestration:
- `session_start`
- `session_shutdown`
- `tool_result`
- `user_bash`
- optional `model_select`
- shortcut registration
- footer bridge install
- widget install
- custom editor install

## `state.ts`
Central runtime state object. No scattered globals.

Suggested shape:

```ts
export interface EditorRuntimeState {
  sessionStartTime: number;
  stashText: string | null;
  currentEditor: FancyEditor | null;
  tui: TUI | null;
  footerData: ReadonlyFooterDataProvider | null;
  currentCtx: ExtensionContext | null;
  lastLayout: { width: number; result: LayoutResult; at: number } | null;
}
```

## `types.ts`
Should define only v1 types.
No need to preserve upstream’s giant surface area.

## `segments.ts`
Pure renderers.
No filesystem or subprocess work inside segment render functions.

## `git.ts`
Only git-specific async fetch/caching/invalidation.
No segment formatting logic here.

## `editor-component.ts`
The one place allowed to know about the fragile shape of `CustomEditor.render()` output.
Keep that blast radius contained.

---

## Recommended v1 Status Context

```ts
export interface EditorStatusContext {
  modelName: string;
  modelId: string | null;
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
  sessionStartTime: number;
}
```

### Why this is enough

It covers the initial requested segment set without dragging in:
- profile switchers
- token archaeology
- subscription heuristics
- prompt mining
- time/clock/session vanity metrics

Those can come later if they prove useful.

---

## Recommended v1 Segment Set

### Keep
- `pi`
- `model`
- `thinking`
- `path`
- `git`
- `context`
- `cost`
- `extension_statuses`

### Cut for v1
- token input/output/cache breakdown
- hostname
- session id
- wall clock
- profile badges

### Reason

The objective is to prove the editor chrome, not to cosplay as a Bloomberg terminal.

---

## Responsive Layout Strategy

🎯 Keep layout dumb, deterministic, and width-driven.

```text
segment order
π → model → think → path → git → context → cost → ext

packing algorithm
┌──────────────────────────────────────────────────────┐
│ row 1: keep appending segments while they fit        │
│ row 2: append remaining segments while they fit      │
│ stop when row 2 fills                                │
│ preserve ordering                                    │
└──────────────────────────────────────────────────────┘
```

### Rules

1. Render all segments first
2. Drop invisible/empty ones
3. Measure with `visibleWidth`
4. Pack into row 1
5. Spill remaining into row 2
6. Do not reshuffle by “importance” in v1
7. Do not right-align anything in v1 unless needed

### Recommendation

Keep the first implementation **left-packed only**.
The upstream split of left vs right segments is nice, but not necessary to prove the concept.
Right alignment can come later if desired.

---

## Editor Rendering Strategy

This is the most important implementation detail.

## Goal rendering shape

```text
 status row
 ───────────────────────────────────────────────────────
 > user input line 1
   continuation line 2
 ───────────────────────────────────────────────────────
 overflow row (only if needed)
```

## Practical strategy

Inside the custom editor wrapper:

1. create a `CustomEditor`
2. keep its original `handleInput`
3. call `super.render(contentWidth)` or delegated render for editable content
4. inspect the returned lines
5. identify the editor content region vs trailing autocomplete rows
6. replace the stock top/bottom chrome with our own
7. append autocomplete rows unchanged

### Why not rewrite editor rendering from scratch?

Because that would be professionally silly.
We want Pi’s editing behavior, cursor logic, wrapping, autocomplete internals, and key handling to stay Pi’s problem.

### Narrow-terminal fallback

If `width < 10` or if parsing the default render shape fails unexpectedly:
- fall back to the original `CustomEditor.render(width)` output

That gives us a safe escape hatch.

---

## Git Integration Strategy

## What upstream gets right
- short TTL cache
- separate branch cache
- background fetch during sync render path
- invalidation after writes/edits and branch-affecting shell commands

## Recommended v1 design

```text
git.ts
├── getGitSnapshot(cwd, providerBranch?) -> GitSnapshot
├── invalidateGitStatus()
├── invalidateGitBranch()
└── maybeCommandAffectsGit(cmd) -> boolean
```

### Behavior

- branch cache TTL: short
- status cache TTL: short
- render path returns last-known state immediately
- async refresh updates caches in background
- rerender requested after refresh completion if TUI ref exists

### Events to invalidate on

#### `tool_result`
- `write`
- `edit`
- `bash` with branch-affecting command patterns

#### `user_bash`
- branch-affecting command patterns

### Recommended command patterns

Start with upstream-style patterns:
- `git checkout`
- `git switch`
- `git branch -d/-D/-m/-M`
- `git merge`
- `git rebase`
- `git pull`
- `git reset`
- `git worktree`
- `git stash pop`
- `git stash apply`

### Important nuance

Use `ctx.cwd` as the source of truth for path/worktree context.
Do not use `process.cwd()` for status bar path display.
The Pi SDK docs explicitly warn that prebuilt tools and default path assumptions can otherwise drift.

---

## Stash Strategy

## Required v1 semantics

```text
Alt+S state machine

┌──────────────┬──────────────┬──────────────────────────────┐
│ editor text  │ stash text   │ result                       │
├──────────────┼──────────────┼──────────────────────────────┤
│ yes          │ no           │ stash + clear editor         │
│ no           │ yes          │ restore stash                │
│ yes          │ yes          │ replace stash + clear editor │
│ no           │ no           │ notify                       │
└──────────────┴──────────────┴──────────────────────────────┘
```

## Recommendation

Implement stash as a small pure-ish module:

```ts
export interface StashState {
  text: string | null;
}

export type StashActionResult =
  | { kind: "stashed"; nextEditorText: ""; stashText: string }
  | { kind: "restored"; nextEditorText: string; stashText: null }
  | { kind: "updated"; nextEditorText: ""; stashText: string }
  | { kind: "empty" };
```

Then the shortcut handler just:
- reads editor text
- calls stash module
- updates `ctx.ui.setEditorText(...)`
- updates `ctx.ui.setStatus("stash", ...)`
- sends notification

### Do not add in v1
- persisted stash history
- stash picker
- auto-restore after run

Those are upstream extras, not core requirements.

---

## Footer / Status Integration Strategy

### Why use `ctx.ui.setStatus(...)` at all?

Because other extensions may already publish useful compact status text.
The editor bar should be able to surface that via `extension_statuses`.

### Suggested policy for v1

- compact statuses appear in the status bar segment
- if there are no statuses, segment is hidden
- do not yet implement special filtering for notification-style `[foo] ...` statuses unless we actually observe noisy output

That filtering exists upstream because it bundles more behaviors. We do not need to pre-optimize for that.

---

## Concrete Implementation Sequence

## Phase 1 — proof-of-life editor wrapper

Deliverables:
- `extensions/editor.ts`
- `extensions/lib/editor/editor-component.ts`
- `extensions/lib/editor/state.ts`

Success criteria:
- custom editor installs on `session_start`
- editor still accepts input normally
- autocomplete still appears
- if anything goes sideways, default editor can be restored cleanly

### Required test checklist
- type text
- multiline input
- slash command autocomplete
- `@` path completion
- tab completion
- empty editor rendering
- narrow terminal rendering

## Phase 2 — minimal status row

Deliverables:
- `types.ts`
- `colors.ts`
- `icons.ts`
- `presets.ts`
- `segments.ts`

Success criteria:
- top row shows at least `pi`, `model`, `thinking`, `path`
- no git yet, or placeholder git data
- rendering remains width-safe

## Phase 3 — overflow row

Deliverables:
- `layout.ts`
- below-editor widget for row 2

Success criteria:
- narrow terminals preserve useful signal
- row 1 and row 2 stay stable across rerenders

## Phase 4 — stash

Deliverables:
- `stash.ts`
- `Alt+S` shortcut wiring

Success criteria:
- all four stash states behave correctly
- stash indicator shows via `ctx.ui.setStatus(...)` or direct segment state

## Phase 5 — git

Deliverables:
- `git.ts`
- invalidation hooks in `editor.ts`

Success criteria:
- branch shown
- dirty counts shown
- refresh is asynchronous / non-blocking
- branch changes and edits trigger updates predictably

## Phase 6 — polish

Potential additions:
- compact preset
- ASCII preset
- better path shortening
- notification filtering for extension statuses
- richer border styling

---

## Verification Plan

```text
verification ladder

1. typecheck changed files
2. /reload
3. fresh Pi session
4. validate editor behavior first
5. validate status rendering second
6. validate stash third
7. validate git invalidation last
```

## Detailed checks

### Core editor safety
- normal text entry works
- autocomplete still works
- `@` file picker still works
- slash commands still work
- enter / shift+enter semantics unchanged
- escape / abort semantics unchanged

### Status rendering
- row 1 renders in wide terminal
- row 2 appears in narrow terminal
- no line exceeds width
- ANSI colors don’t break measurement

### Stash
- all four state transitions behave correctly
- status indicator clears correctly
- stash survives within the session

### Git
- branch appears in repo
- branch disappears outside repo
- dirty counts refresh after `edit` / `write`
- branch updates after `git switch` / `git checkout`

### Failure path
- if custom editor init fails, Pi remains usable

---

## Risks and Unknowns

## Risk 1 — render-shape coupling to `CustomEditor.render()`

This is the big one.
If Pi changes the internal layout of `CustomEditor.render()`, a chrome-wrapping approach could get brittle.

### Mitigation
- isolate this logic in `editor-component.ts`
- keep fallback to raw `originalRender(width)`
- avoid parsing more structure than necessary

## Risk 2 — autocomplete edge cases

The upstream package contains a suspicious autocomplete reset workaround.
That means there is probably some real historical sharp edge.

### Mitigation
- explicitly test autocomplete early
- add a compatibility shim only if current Pi reproduces the issue

## Risk 3 — rerender timing for async git updates

A background refresh is only useful if the UI repaints when the cache updates.

### Mitigation
- keep `tui` ref in runtime state
- request rerender after cache refresh/invalidation
- subscribe to `footerData.onBranchChange(...)`

## Risk 4 — line width with ANSI styling

Powerline-ish status bars love ANSI and Unicode. Width accounting hates them right back.

### Mitigation
- use `visibleWidth`
- centralize layout measurement
- keep separators simple in v1

---

## Strong Recommendations

## Recommendation 1

Do **not** start by copying upstream files into this package.
That would import too much accidental design.

## Recommendation 2

Treat `editor-component.ts` as a compatibility adapter around Pi’s editor, not a UI playground.
The thinner it is, the less likely it is to explode when Pi changes.

## Recommendation 3

Start with one preset only:
- `default`

Maybe add:
- `compact`
- `ascii`

Anything beyond that is premature ornamentation.

## Recommendation 4

Keep path rendering sourced from `ctx.cwd` / runtime context, never `process.cwd()`.
This is one of the explicit upstream flaws and an easy trap.

## Recommendation 5

Use the footer bridge from day one.
Without it, you lose branch-change subscriptions and extension statuses, which are central to the whole editor-bar idea.

---

## Proposed v1 Scope Lock

If implementation starts getting spicy, hold the line here:

```text
minimum shippable slice
┌──────────────────────────────────────────────┐
│ ✅ custom editor wrapper                      │
│ ✅ top status row                             │
│ ✅ Alt+S stash                                │
│ ✅ git branch integration                     │
│ ✅ overflow row widget                        │
│ ❌ welcome overlay                            │
│ ❌ vibes                                      │
│ ❌ profile switcher                           │
│ ❌ stash history                              │
│ ❌ large preset matrix                        │
└──────────────────────────────────────────────┘
```

That slice is enough to deliver the actual value.

---

## Suggested Next Implementation Step

Before writing the full extension, do a small spike:

### Spike goal
Build a tiny `extensions/editor.ts` that:
1. installs a `CustomEditor` subclass
2. prepends a single placeholder status line
3. installs an empty footer bridge
4. verifies autocomplete still works

### Why
That spike de-risks the one thing most likely to bite us: editor render wrapping.

If that spike behaves, the rest becomes systematic module work.
If it doesn’t, we learn early and cheaply instead of after building a cute segment system on sand.

---

## Bottom Line

The plan is technically sound.
Pi’s APIs support it.
The upstream package proves the concept.

The correct move is a **narrow, typed reimplementation** with:
- thin custom editor wrapper
- pure segment/layout modules
- hidden footer bridge
- async git cache
- minimal stash state machine

The one place to be paranoid is the custom editor render override.
Everything else is straightforward engineering once that foundation is stable.
