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

if ! command -v npm >/dev/null 2>&1; then
  echo "npm not found; install Node.js to run frontend linting." >&2
  exit 1
fi

npm --prefix "${root}" run lint
