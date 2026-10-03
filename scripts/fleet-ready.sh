#!/usr/bin/env bash
# Offline probe: only the pin shared with cached origin's default branch is ready.
set -Eeuo pipefail
trap 'exit 2' ERR
export GIT_OPTIONAL_LOCKS=0

refuse() {
  printf '%s\n' "$1" >&2
  exit 2
}

[[ $# == 1 && $1 == pi ]] || refuse 'fleet-ready supports only pi'

# Diff both the index and worktree. Do not refresh or write the index.
git cat-file -e HEAD:package.json
git diff --quiet --no-ext-diff --cached -- package.json || refuse 'package.json is staged'
git diff --quiet --no-ext-diff -- package.json || refuse 'package.json is dirty'
origin_ref=$(git symbolic-ref refs/remotes/origin/HEAD)
[[ $origin_ref == refs/remotes/origin/* ]] || refuse 'missing cached origin default branch'
origin_manifest=$(git show "$origin_ref:package.json")

# Require one manifest and a bare version pin, not a dependency range.
version_filter='
  select(length == 1) | .[0].devDependencies["@earendil-works/pi-coding-agent"]
  | select(type == "string")
  | select(test("^[0-9]+\\.[0-9]+\\.[0-9]+(-[0-9A-Za-z.-]+)?(\\+[0-9A-Za-z.-]+)?$") and (contains("\n") | not))
'
local_pin=$(jq -esr "$version_filter" package.json)
origin_pin=$(printf '%s' "$origin_manifest" | jq -esr "$version_filter")
[[ $local_pin == "$origin_pin" ]] || refuse 'local Pi pin differs from cached origin'
printf '%s\n' "$local_pin"
