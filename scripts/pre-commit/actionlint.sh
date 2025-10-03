#!/bin/sh
# Run GitHub Actions workflow linting, preferring an installed actionlint binary.
set -eu

if command -v actionlint >/dev/null 2>&1; then
  exec actionlint "$@"
fi

if command -v npx >/dev/null 2>&1; then
  exec npx --yes actionlint@latest "$@"
fi

echo "actionlint not found; install actionlint or Node.js to lint workflows." >&2
exit 1
