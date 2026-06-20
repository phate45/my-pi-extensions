# Web Research

## Purpose

`web_research` is a model-facing tool for current or external information that does not live in the repo.

## Contract

Inputs:
- `query`
- optional `depth`
- optional `freshness`

The tool returns the raw structured JSON from Codex.

## Defaults

Query-only calls use configured defaults.
The fallback defaults are:
- depth: `fast`
- freshness: `cached`

Typed normalization for those defaults belongs near the web research extension, not in generic bundle config.

## Routing

Depth selects the research profile:
- `fast`
- `deep`

Freshness selects Codex web search mode:
- `cached`
- `live`

## Boundaries

This tool is a narrow web research sidecar.
It returns raw structured JSON from Codex and is not a general shell execution surface.

## Verification

After changes, verify:
- registration still respects managed extension gating
- query-only calls pick up configured defaults
- explicit call arguments override configured defaults
- depth and freshness still map to the intended Codex settings
- returned payload remains the raw JSON string from Codex
