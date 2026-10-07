---
name: updating-pi-compatibility
description: Check and update this bundle for a new Pi release. Use when a newer @earendil-works/pi-coding-agent version is available, when asked to check Pi compatibility, or when promoting the repository's pinned Pi SDK versions.
---

# Updating Pi compatibility

Use the repository's compatibility harness. Keep the global Pi installation and settings untouched.

## 1. Establish the version interval

- Confirm the working tree state before changing anything.
- Read the current `@earendil-works/pi-coding-agent` pin from `package.json`.
- Use the exact release the user requests. If none is specified, resolve npm latest once with `npm view @earendil-works/pi-coding-agent@latest version`.
- Record that exact version as `target` and pass `--target "$target"` to every compatibility invocation. Keep it fixed through review, checks, and promotion.
- Stop if the pin matches the target unless the user asks for a recheck. An explicit target rechecks matching pins and also permits checks against older releases.

Completion criterion: the current and target versions are known and visible in the work summary.

## 2. Read every intervening release note with `gh`

List releases with `gh release list --repo earendil-works/pi --limit 100 --json tagName`. Read every release newer than the current pin through the target, oldest-first, with `gh release view <tag> --repo earendil-works/pi --json tagName,publishedAt,body`. Increase the limit or paginate if the list does not cover the interval.

Extract actionable compatibility information:

- breaking changes and deprecated or removed APIs
- extension lifecycle and event changes
- provider, context, tool, resource, SDK, and TUI contract changes
- new runtime or package requirements

Map relevant changes to repository call sites with `rg`. Release notes are the index; tagged Pi docs and type declarations are the source of truth. Use web research only when the upstream repository and published package do not answer the question.

Completion criterion: every intervening release has been reviewed and each relevant change has an identified bundle consumer or an explicit finding that none exists.

## 3. Decide the compatibility window

State whether the bundle must support only the target release or both the previous pin and target. Test every version claimed. Prefer API shapes that span the intended window when they remain clear and honest.

Completion criterion: the releases requiring verification are explicit.

## 4. Choose the check path

The harness snapshots the checkout, installs the exact target, and runs typechecks, tests, formatting checks, and an isolated runtime smoke test. It isolates HOME, Pi config, and sessions for checks and clears inherited `CLAUDE_PROJECT_DIR` automatically.

**Pin-only upgrade:** run `just compat-update --target "$target"` directly. It promotes the tested manifest and lockfile only after all checks pass. A separate preliminary `compat` run adds no evidence when no migration is needed.

**Migration investigation or check-only request:** run `just compat --target "$target"` first. Treat failures as evidence, not the complete migration plan; cross-check them against the release review. For an upgrade, make the smallest migration:

- Read the target release's relevant docs and declarations before changing behavior.
- Add focused tests for the affected contract and change the owning extension or helper.
- Audit every implicated call site, not only the first compiler error.
- Inspect tagged GitHub source or the target npm package when needed. The global installation is not a proxy for the target.

For an upgrade, run `just compat-update --target "$target"` after the migration. If it fails, fix the cause and repeat that command; each attempt checks before promotion. For a check-only request, stop after the requested checks pass without promoting.

Completion criterion: the exact target passes all checks and, when requested, its tested manifest and lockfile have been promoted.

## 5. Verify the promoted checkout

After promotion, install and verify the checkout:

```bash
bun install --frozen-lockfile
mkdir -p .tmp
home=$(mktemp -d "$PWD/.tmp/compat-home.XXXXXX")
env -u PI_CODING_AGENT_DIR -u PI_CODING_AGENT_SESSION_DIR -u CLAUDE_PROJECT_DIR \
  HOME="$home" just test
just typecheck-all
just lint-ci
git diff --check
```

Use an empty isolated HOME for the checkout's tests because `just test` itself still inherits ambient user configuration. If backward compatibility is part of the stated window, also run `just compat --target <previous-pin>` to verify that release without changing the promoted checkout.

Completion criterion: checkout verification passes for the promoted dependency graph, and every release in the claimed compatibility window has passed the isolated checks.

## 6. Report precisely

Report:

- previous and target Pi versions
- relevant release-note findings and migrations
- commands that passed or failed
- whether backward compatibility was tested
- whether the global Pi installation remains unchanged
- uncommitted files left in the working tree

A default `just compat` that skips because the pin does not trail npm latest reports version currency only. An explicit `--target` runs compatibility checks. Keep those outcomes distinct.
