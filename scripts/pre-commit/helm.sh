#!/bin/sh
# Lint Helm charts touched in the staged changes.
set -eu

if [ "$#" -eq 0 ]; then
  exit 0
fi

if ! command -v helm >/dev/null 2>&1; then
  echo "helm not found; install Helm to lint chart changes." >&2
  exit 1
fi

TMP_DIRS=$(mktemp)
trap 'rm -f "$TMP_DIRS"' EXIT

for file in "$@"; do
  current_dir=$(dirname "${file}")
  while [ "${current_dir}" != "." ] && [ "${current_dir}" != "/" ]; do
    if [ -f "${current_dir}/Chart.yaml" ] || [ -f "${current_dir}/Chart.yml" ]; then
      printf '%s\n' "${current_dir}" >>"${TMP_DIRS}"
      break
    fi
    next_dir=$(dirname "${current_dir}")
    if [ "${next_dir}" = "${current_dir}" ]; then
      break
    fi
    current_dir=${next_dir}
  done
  if [ "${current_dir}" = "." ]; then
    if [ -f "Chart.yaml" ] || [ -f "Chart.yml" ]; then
      printf '%s\n' "." >>"${TMP_DIRS}"
    fi
  fi
done

sort -u "${TMP_DIRS}" | while IFS= read -r dir; do
  [ -d "${dir}" ] || continue
  helm lint "${dir}"
done
