---
created: 2026-06-21T10:13:05
modified: 2026-06-21T16:30:03
---

# Bundle Config

## Purpose

Bundle config provides semantic knobs for this package without stuffing custom schema into Pi's own `settings.json`.

## Sources

Bundle config lives in `my-pi-settings.json` and can be loaded from:
- the agent directory
- `./.pi/my-pi-settings.json` in a trusted project
- `--my-pi-settings <path>`

The CLI flag replaces autodiscovery entirely. Trusted project-local config only counts after trust is established.

## Precedence

Normal flow:
1. `<agentDir>/my-pi-settings.json`
2. `./.pi/my-pi-settings.json` overrides global

Override flow:
1. `--my-pi-settings <path>` only

No global or project-local merge happens in override mode.

## Timing

Global or override config is preloaded early so extension factory-time gating works.
Trusted project-local config merges later, once trust-aware startup logic can decide whether to honor it.

That split is deliberate. It keeps early gating possible without treating untrusted project files as startup policy.

## Shape

The config model has two layers:
- `featureFlags` for coarse bundle switches
- `extensions.<name>` for per-extension enablement and config

Mental model:
- feature flag = broad slice of the bundle
- extension enablement = one concrete entrypoint
- extension config = typed local settings for that feature

Current notable feature flags:
- `ccLike` for Claude-compat behavior
- `myStuff` for personal extensions
- `headless` for user-facing UI fluff that should stay out of non-TUI runs

`headless` has one special rule: the effective flag is true when either:
- bundle config sets `featureFlags.headless: true`, or
- Pi starts in a non-TUI mode such as `-p`, `--mode json`, or `--mode rpc`

That auto-application is argv-derived, not `ctx.mode`-derived. Factory-time extension gating runs before any handler has a `ctx`, so the resolver cannot depend on runtime context that does not exist yet.

Related Pi CLI switches also affect bundle behavior even though they are not bundle config keys.
Most notably:
- `--no-skills` / `-ns` disables native Pi skill discovery and the model-facing `skill` tool
- this bundle still keeps Claude-style human invocation available in interactive runs via `skill-prompts.ts`
- in effective headless mode, that human invocation layer stays off too

## Managed entrypoints

Managed entrypoints use the shared wrapper from `infra`.

Use the config-less form when the extension only needs enablement.
Use the config-backed form when the extension needs typed config.

The wrapper should stay thin:
- gate by feature flag + per-extension enablement
- optionally hand a typed config getter into `setup(...)`
- nothing fancier

Configured managed extensions now declare a runtime config definition with:
- `defaults` for the normalized config shape
- `normalize(raw, defaults)` for feature-local interpretation
- optional `key` when the config key must differ from the managed extension name

Infra still owns global vs local merge policy.
The extension config definition owns only its typed slice under `extensions.<name>.config`.

Important timing rule:
- `getConfig` is a live getter, not a startup snapshot
- global or CLI-override config is available during extension factory setup
- trusted project-local config is only merged on `session_start`
- therefore, any behavior that must honor trusted local config should call the getter at runtime inside handlers, commands, or tool execution rather than caching config at factory time

That avoids the worst flavor of surprise: loaded extension, correct local config file, absolutely nothing happens because the extension captured pre-trust config once and called it a day.

## Input ordering

Pi runs `input` handlers in plain registration order and does not restart the chain after a transform.
This bundle now hides that footgun behind `extensions/infra/input-pipeline.ts`.

Bundle-owned send-time input behavior should register into the shared pipeline instead of adding independent `pi.on("input")` handlers when ordering matters.

Current split:
- transforms rewrite text first
- routers classify the transformed text second

That keeps personal transforms such as abbreviations decoupled from Claude-style routing while still letting `hnd` become `/from-handoff ...` before the cc-like command stack inspects it.

## Typed config helpers

Keep generic merge logic in bundle config.
Keep feature-specific config interpretation near the owning extension.

Good pattern:
- generic raw config in `infra`
- shared config-definition helper in `infra/lib/extension-config.ts`
- typed normalization in a local helper such as the web research config helper
- entrypoint consumes a live typed getter, not raw blobs

Example shape:

```json
{
  "extensions": {
    "cc-markdown-preprocessor": {
      "enabled": true,
      "config": {
        "disableBash": false,
        "disableIncludes": false
      }
    },
    "web-research": {
      "enabled": true,
      "config": {
        "defaultDepth": "fast",
        "defaultFreshness": "cached"
      }
    }
  }
}
```

That means whole-feature disablement lives on `enabled`, while sub-feature knobs stay inside `config`.

## Example config generation

`just generate-config` writes `my-pi-settings.example.json` from the managed extension declarations in this package.

Generation rules:
- read entrypoints from `package.json` `pi.extensions`
- import each entrypoint normally
- inspect managed extension descriptors exposed by `defineManagedExtension(...)`
- emit `enabled: true` for each managed extension
- emit `config` from the config definition defaults when that extension declares typed config

The generator does not scrape TypeScript source and does not boot a full Pi session.
It uses the same declaration path the runtime already uses, then serializes the inspectable descriptor.

## Verification

When changing this stack, verify:
- preload vs trusted-local timing
- feature flags vs per-extension enablement
- `headless` behavior in config-driven and non-TUI argv-driven cases
- CLI override replacement behavior
- `just generate-config` still matches the checked-in example file
- package discovery still loads the intended entrypoints
- integration probes still reflect effective state honestly
