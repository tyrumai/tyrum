#!/bin/sh
# Run Next.js/React linting where package.json is available.
set -eu

if ! command -v npm >/dev/null 2>&1; then
  echo "npm not found; install Node.js to run frontend linting." >&2
  exit 1
fi

root=""
if [ -f "web/package.json" ]; then
  root="web"
elif [ -f "package.json" ]; then
  root="."
else
  exit 0
fi

npm --prefix "${root}" run lint
