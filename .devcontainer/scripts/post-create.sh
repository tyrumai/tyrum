#!/usr/bin/env bash
set -euo pipefail

export PATH="$HOME/.local/bin:$PATH"

if command -v corepack >/dev/null 2>&1; then
  corepack enable >/dev/null 2>&1 || true
  corepack prepare pnpm@latest --activate >/dev/null 2>&1 || true
fi

if command -v rustup >/dev/null 2>&1; then
  rustup component add rustfmt clippy >/dev/null 2>&1 || true
fi

if command -v pip3 >/dev/null 2>&1; then
  pip3 install --user --upgrade pre-commit >/dev/null 2>&1 || true
fi

if command -v pre-commit >/dev/null 2>&1; then
  pre-commit install --install-hooks || true
fi
