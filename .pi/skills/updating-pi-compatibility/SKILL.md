---
name: updating-pi-compatibility
description: Check and update this bundle for a new Pi release. Use when a newer @earendil-works/pi-coding-agent version is available, when asked to check Pi compatibility, or when promoting the repository's pinned Pi SDK versions.
---

# Updating Pi Compatibility

Use the repository's compatibility harness. Do not replace it with ad hoc installs or mutate the global Pi installation.

## 1. Establish the version interval

- Confirm the working tree state before changing anything.
- Read the currently pinned `@earendil-works/pi-coding-agent` version from `package.json`.
- Query npm for the latest published version.
- Stop if the pin is current unless the request explicitly asks for a recheck.

Keep the current and target versions visible in the work summary.

## 2. Read every intervening release note with `gh`

Use GitHub release data from `earendil-works/pi`; do not start with web search. Fetch every release newer than the current pin through the target release, oldest-first:

```bash
set -euo pipefail
current=$(jq -r '.devDependencies["@earendil-works/pi-coding-agent"]' package.json)
target=$(npm view @earendil-works/pi-coding-agent@latest version)

if [[ "$current" == "$target" ]]; then
  printf 'Pi %s is already current.\n' "$current"
  exit 0
fi

tags=$(gh release list \
  --repo earendil-works/pi \
  --limit 100 \
  --json tagName \
  --jq '.[].tagName')

range=$(printf '%s\n' "$tags" | awk \
  -v current="v$current" \
  -v target="v$target" '
    $0 == target { collecting = 1 }
    collecting && $0 == current { found = 1; exit }
    collecting { print }
    END { if (!found) exit 42 }
  ')

printf '%s\n' "$range" | tac | while IFS= read -r tag; do
  gh release view "$tag" \
    --repo earendil-works/pi \
    --json tagName,publishedAt,body \
    --jq '"## " + .tagName + " (" + .publishedAt + ")\n\n" + .body'
done
```

If the range command exits with status 42, increase the release-list limit or paginate through the GitHub API. Do not silently omit intermediate releases.

Extract only actionable compatibility information:

- breaking changes
- deprecated or removed APIs
- extension lifecycle and event changes
- provider, context, tool, resource, SDK, and TUI contract changes
- new runtime or package requirements

Map each relevant change to repository call sites with `rg`. Release notes are the index; tagged Pi docs and type declarations are the source of truth. Use web research only when the upstream repository and published package do not answer the question.

## 3. Decide the compatibility window

Before editing, state whether the bundle must support:

- only the target Pi release, or
- both the previous pin and the target release

Do not claim backward compatibility from erased TypeScript types or a likely runtime path. Test every version claimed. Prefer API shapes that span the intended window when they remain clear and honest.

## 4. Run the compatibility harness before editing

```bash
just compat
```

The harness snapshots the checkout, installs the latest Pi release, and runs typechecks, tests, formatting checks, and an isolated runtime smoke test. Treat the first failure as evidence, not necessarily the complete migration plan; cross-check it against all intervening release notes.

## 5. Make the smallest migration

- Read the target release's relevant docs and declarations before changing behavior.
- Add or update focused tests for the affected contract.
- Change only the owning extension or helper.
- Audit every repository call site implicated by the release notes, not only the first compiler error.
- Keep global Pi settings and installation untouched.

When target package contents are needed before promotion, inspect the tagged GitHub source with `gh` or unpack the npm package into a temporary directory. Do not use the globally installed package as a proxy for the target release.

## 6. Prove and promote

Repeat until the isolated check passes:

```bash
just compat
```

Then promote the exact tested manifest and lockfile:

```bash
just compat-update
```

After promotion, run:

```bash
just test
just typecheck-all
just lint-ci
just compat
```

The final `just compat` should report that the pin is current. If backward compatibility is part of the stated window, run equivalent typecheck, test, and isolated runtime coverage against the previous pin as well.

## 7. Report precisely

Report:

- previous and target Pi versions
- relevant release-note findings
- compatibility failures and migrations
- commands that passed or failed
- whether backward compatibility was tested
- whether the global Pi installation remains unchanged
- uncommitted files left in the working tree

Never collapse “runtime probably works” into “compatible.”
