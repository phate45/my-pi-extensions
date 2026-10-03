#!/usr/bin/env bash
set -euo pipefail

pi_bin="$(command -v pi)"
pi_bin_real="$(realpath "$pi_bin")"
basedir="$(dirname "$pi_bin_real")"
cli_path_raw="$({ sed -nE 's/.*"([^" ]*node_modules\/[^" ]*pi-coding-agent\/dist\/(bundle\/)?cli\.js)".*/\1/p' "$pi_bin_real" || true; } | head -n 1)"

if [[ -z "$cli_path_raw" ]]; then
  echo "Failed to resolve pi package path from $pi_bin_real" >&2
  exit 1
fi

cli_path="${cli_path_raw//\$basedir_win/$basedir}"
cli_path="${cli_path//\$basedir/$basedir}"
package_root="${cli_path%/dist/*}"
package_root="$(realpath "$package_root")"
if [[ ! -f "$package_root/README.md" || ! -d "$package_root/docs" ]]; then
  echo "Pi documentation missing under $package_root" >&2
  exit 1
fi
readme="$package_root/README.md"
docs="$package_root/docs"
examples="$package_root/examples"
bundle_root="$(realpath "$(dirname "${BASH_SOURCE[0]}")/..")"

cat <<EOF
Pi documentation (read only when the user asks about pi itself, its SDK, extensions, themes, skills, or TUI):
- Main documentation: $readme
- Additional docs: $docs
- Examples: $examples (extensions, custom tools, SDK)
- Local extension bundle: $bundle_root. For bundle settings, read $bundle_root/docs/bundle-config.md and $bundle_root/my-pi-settings.example.json; bundle overrides live in <agentDir>/my-pi-settings.json or trusted <project>/.pi/my-pi-settings.json, separately from Pi's settings.json.
- When asked about: extensions (docs/extensions.md, examples/extensions/), themes (docs/themes.md), skills (docs/skills.md), prompt templates (docs/prompt-templates.md), TUI components (docs/tui.md), keybindings (docs/keybindings.md), SDK integrations (docs/sdk.md), custom providers (docs/custom-provider.md), adding models (docs/models.md), pi packages (docs/packages.md)
- When working on pi topics, read the docs and examples, and follow .md cross-references before implementing
- Always read pi .md files completely and follow links to related docs (e.g., tui.md for TUI API details)
EOF

