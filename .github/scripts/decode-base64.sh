#!/usr/bin/env bash
# Portable base64 decode helper.
# Tries GNU (--decode / -d) then BSD (-D) flags in order, writing to a file.
# Usage: decode_base64 <value> <output-file>
# Returns 0 on success, 1 if all variants fail.
decode_base64() {
  local value="$1"
  local output="$2"

  printf '%s' "${value}" | base64 --decode > "${output}" 2>/dev/null && return 0
  printf '%s' "${value}" | base64 -d > "${output}" 2>/dev/null && return 0
  printf '%s' "${value}" | base64 -D > "${output}" 2>/dev/null && return 0

  return 1
}
