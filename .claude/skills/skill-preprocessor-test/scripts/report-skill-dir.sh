#!/usr/bin/env bash
set -euo pipefail
printf 'script_path=%s\n' "$0"
printf 'script_dir=%s\n' "$(cd "$(dirname "$0")" && pwd)"
