#!/bin/sh
# Run frontend linting using the repository's package manager.
set -eu

root=""
if [ -f "web/package.json" ]; then
  root="web"
elif [ -f "package.json" ]; then
  root="."
else
  exit 0
fi

manager="npm"
if [ -f "${root}/pnpm-lock.yaml" ]; then
  manager="pnpm"
elif ROOT="${root}" python3 <<'PY'
from pathlib import Path
import json
import os

pkg = Path(os.environ["ROOT"]) / "package.json"
data = json.loads(pkg.read_text())
manager = data.get("packageManager", "")
raise SystemExit(0 if manager.startswith("pnpm@") else 1)
PY
then
  manager="pnpm"
fi

run_with_pnpm() {
  if ! command -v pnpm >/dev/null 2>&1; then
    if command -v corepack >/dev/null 2>&1; then
      corepack enable pnpm >/dev/null 2>&1 || true
    fi
  fi

  if ! command -v pnpm >/dev/null 2>&1; then
    echo "pnpm not found; install Node.js 20+ with pnpm (via corepack) to run frontend linting." >&2
    exit 1
  fi

  (cd "${root}" && pnpm run lint)
}

run_with_npm() {
  if ! command -v npm >/dev/null 2>&1; then
    echo "npm not found; install Node.js to run frontend linting." >&2
    exit 1
  fi
  npm --prefix "${root}" run lint
}

if [ "${manager}" = "pnpm" ]; then
  run_with_pnpm
else
  run_with_npm
fi
