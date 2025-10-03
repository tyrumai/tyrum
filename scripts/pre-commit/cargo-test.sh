#!/usr/bin/env bash
set -euo pipefail

if ! command -v cargo >/dev/null 2>&1; then
  echo "cargo not found; install Rust toolchain to run cargo test." >&2
  exit 1
fi

repo_root="$(git rev-parse --show-toplevel)"
manifest="$repo_root/Cargo.toml"
if [ ! -f "$manifest" ]; then
  echo "Skipping cargo test: no Cargo.toml detected." >&2
  exit 0
fi

temp_metadata="$(mktemp)"
trap 'rm -f "$temp_metadata"' EXIT

if ! cargo metadata --format-version 1 --no-deps >"$temp_metadata" 2>/dev/null; then
  echo "Skipping cargo test: unable to read cargo metadata." >&2
  exit 0
fi

if grep -Eq '"packages"[[:space:]]*:[[:space:]]*\[[[:space:]]*\]' "$temp_metadata"; then
  echo "Skipping cargo test: no Rust packages defined in workspace." >&2
  exit 0
fi

cargo test --all --all-targets
