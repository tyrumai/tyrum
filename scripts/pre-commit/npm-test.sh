#!/bin/sh
# Run the frontend test suite without watch mode.
set -eu

if ! command -v npm >/dev/null 2>&1; then
  echo "npm not found; install Node.js to run frontend tests." >&2
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

npm --prefix "${root}" run test -- --watch=false
