#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF' >&2
Usage: xvfb-run-safe.sh [xvfb-run options...] -- command [args...]
EOF
}

if (($# == 0)); then
  usage
  exit 2
fi

xvfb_args=()
while (($# > 0)); do
  if [[ "$1" == "--" ]]; then
    shift
    break
  fi
  xvfb_args+=("$1")
  shift
done

if (($# == 0)); then
  usage
  exit 2
fi

tmpdir="$(mktemp -d)"
status_file="$tmpdir/command.status"
stderr_file="$tmpdir/xvfb-run.stderr"
command_status=""

cleanup() {
  rm -rf "$tmpdir"
}
trap cleanup EXIT

set +e
TYRUM_XVFB_STATUS_FILE="$status_file" xvfb-run "${xvfb_args[@]}" bash -c '
  set +e
  "$@"
  status=$?
  printf "%s\n" "$status" >"$TYRUM_XVFB_STATUS_FILE"
  exit "$status"
' bash "$@" 2> >(tee "$stderr_file" >&2)
xvfb_status=$?
set -e

if [[ -f "$status_file" ]]; then
  command_status="$(<"$status_file")"
  if [[ "$command_status" != "0" ]]; then
    exit "$command_status"
  fi
fi

if ((xvfb_status == 0)); then
  exit 0
fi

if [[ "$command_status" == "0" ]] && grep -Eq 'xvfb-run: line [0-9]+: kill: \([0-9]+\) - No such process' "$stderr_file"; then
  exit 0
fi

exit "$xvfb_status"
