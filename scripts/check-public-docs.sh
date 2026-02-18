#!/usr/bin/env bash
set -euo pipefail

DOCS_DIR="${1:-docs}"

if [[ ! -d "$DOCS_DIR" ]]; then
  echo "error: docs directory not found: $DOCS_DIR" >&2
  exit 1
fi

declare -a BLOCKED_PATTERNS=(
  "domain routing"
  "dns record"
  "cloudflare dashboard"
  "vercel dashboard"
  "internal runbook"
  "ops-only"
)

violations=0

scan_pattern() {
  local pattern="$1"
  if command -v rg >/dev/null 2>&1; then
    rg -n --ignore-case --glob "*.md" "$pattern" "$DOCS_DIR"
    return
  fi

  grep -Rni --include "*.md" -- "$pattern" "$DOCS_DIR"
}

for pattern in "${BLOCKED_PATTERNS[@]}"; do
  if scan_pattern "$pattern" >/dev/null; then
    echo "error: blocked docs phrase found: '$pattern'" >&2
    scan_pattern "$pattern" >&2 || true
    violations=1
  fi
done

if [[ "$violations" -ne 0 ]]; then
  echo "error: public docs policy check failed" >&2
  exit 1
fi

echo "public docs policy check passed"
