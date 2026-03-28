#!/usr/bin/env bash
set -euo pipefail

DOCS_DIR="${1:-${DOCS_DIR:-docs}}"
ARCHITECTURE_DIR="${ARCHITECTURE_DIR:-$DOCS_DIR/architecture}"
PUBLIC_CONTRACTS_DIR="${PUBLIC_CONTRACTS_DIR:-packages/contracts/src}"

if [[ ! -d "$DOCS_DIR" ]]; then
  echo "error: docs directory not found: $DOCS_DIR" >&2
  exit 1
fi

if [[ ! -d "$ARCHITECTURE_DIR" ]]; then
  echo "error: architecture docs directory not found: $ARCHITECTURE_DIR" >&2
  exit 1
fi

if [[ ! -d "$PUBLIC_CONTRACTS_DIR" ]]; then
  echo "error: public contracts directory not found: $PUBLIC_CONTRACTS_DIR" >&2
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

declare -a LEGACY_VOCAB_PATTERNS=(
  '(^|[^[:alnum:]])[sS][eE][sS][sS][iI][oO][nN][sS]?($|[^[:alnum:]])'
  '(^|[^[:alnum:]])[lL][aA][nN][eE][sS]?($|[^[:alnum:]])'
)

violations=0

scan_pattern() {
  local pattern="$1"
  local root="$2"
  shift 2

  if command -v rg >/dev/null 2>&1; then
    rg -n --ignore-case --no-ignore --hidden "$@" "$pattern" "$root"
    return
  fi

  if [[ "$root" == "$PUBLIC_CONTRACTS_DIR" ]]; then
    grep -Rni --include "*.ts" -- "$pattern" "$root"
    return
  fi

  grep -Rni --include "*.md" --include "*.html" -- "$pattern" "$root"
}

for pattern in "${BLOCKED_PATTERNS[@]}"; do
  if scan_pattern "$pattern" "$DOCS_DIR" --glob "*.md" --glob "*.html" >/dev/null; then
    echo "error: blocked docs phrase found: '$pattern'" >&2
    scan_pattern "$pattern" "$DOCS_DIR" --glob "*.md" --glob "*.html" >&2 || true
    violations=1
  fi
done

for pattern in "${LEGACY_VOCAB_PATTERNS[@]}"; do
  if scan_pattern "$pattern" "$ARCHITECTURE_DIR" --glob "*.md" >/dev/null; then
    echo "error: blocked clean-break vocabulary found in architecture docs: '$pattern'" >&2
    scan_pattern "$pattern" "$ARCHITECTURE_DIR" --glob "*.md" >&2 || true
    violations=1
  fi
  if scan_pattern "$pattern" "$PUBLIC_CONTRACTS_DIR" --glob "*.ts" >/dev/null; then
    echo "error: blocked clean-break vocabulary found in public contracts: '$pattern'" >&2
    scan_pattern "$pattern" "$PUBLIC_CONTRACTS_DIR" --glob "*.ts" >&2 || true
    violations=1
  fi
done

if [[ "$violations" -ne 0 ]]; then
  echo "error: public docs policy check failed" >&2
  exit 1
fi

echo "public docs policy check passed"
