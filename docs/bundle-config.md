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

## Managed entrypoints

Managed entrypoints use the shared wrapper from `infra`.

Use the config-less form when the extension only needs enablement.
Use the config-backed form when the extension needs typed config.

The wrapper should stay thin:
- gate by feature flag + per-extension enablement
- optionally hand normalized config into `setup(...)`
- nothing fancier

## Typed config helpers

Keep generic merge logic in bundle config.
Keep feature-specific config interpretation near the owning extension.

Good pattern:
- generic raw config in `infra`
- typed normalization in a local helper such as the web research config helper
- entrypoint consumes normalized config, not raw blobs

## Verification

When changing this stack, verify:
- preload vs trusted-local timing
- feature flags vs per-extension enablement
- CLI override replacement behavior
- package discovery still loads the intended entrypoints
- integration probes still reflect effective state honestly
