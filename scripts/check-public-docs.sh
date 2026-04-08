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
  '(^|[^[:alnum:]_])[rR][uU][nN]_id($|[^[:alnum:]_])'
  '(^|[^[:alnum:]])[rR][uU][nN]-level($|[^[:alnum:]])'
  '(^|[^[:alpha:]])automation[[:space:]-]+runs($|[^[:alpha:]])'
  '(^|[^[:alpha:]])across[[:space:]-]+runs($|[^[:alpha:]])'
  '(^|[^[:alpha:]])later[[:space:]-]+runs($|[^[:alpha:]])'
  '(^|[^[:alpha:]])different[[:space:]-]+runs($|[^[:alpha:]])'
  '(^|[^[:alpha:]])for[[:space:]-]+the[[:space:]-]+run($|[^[:alpha:]])'
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
    grep -RniE --include "*.ts" -- "$pattern" "$root"
    return
  fi

  grep -RniE --include "*.md" --include "*.html" -- "$pattern" "$root"
}

scan_file_paths() {
  local pattern="$1"
  local root="$2"
  local mode="$3"
  local include_args=()

  if [[ "$mode" == "contracts" ]]; then
    include_args=(-name "*.ts")
  else
    include_args=( \( -name "*.md" -o -name "*.html" \) )
  fi

  find "$root" "${include_args[@]}" -type f -print |
    sed "s#^${root%/}/##" |
    grep -En -- "$pattern"
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
  if scan_file_paths "$pattern" "$ARCHITECTURE_DIR" "docs" >/dev/null; then
    echo "error: blocked clean-break vocabulary found in architecture doc filenames: '$pattern'" >&2
    scan_file_paths "$pattern" "$ARCHITECTURE_DIR" "docs" >&2 || true
    violations=1
  fi
  if scan_pattern "$pattern" "$PUBLIC_CONTRACTS_DIR" --glob "*.ts" >/dev/null; then
    echo "error: blocked clean-break vocabulary found in public contracts: '$pattern'" >&2
    scan_pattern "$pattern" "$PUBLIC_CONTRACTS_DIR" --glob "*.ts" >&2 || true
    violations=1
  fi
  if scan_file_paths "$pattern" "$PUBLIC_CONTRACTS_DIR" "contracts" >/dev/null; then
    echo "error: blocked clean-break vocabulary found in public contract filenames: '$pattern'" >&2
    scan_file_paths "$pattern" "$PUBLIC_CONTRACTS_DIR" "contracts" >&2 || true
    violations=1
  fi
done

if [[ "$violations" -ne 0 ]]; then
  echo "error: public docs policy check failed" >&2
  exit 1
fi

echo "public docs policy check passed"
