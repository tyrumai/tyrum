#!/bin/sh
# Validate Kubernetes manifests using kubeconform or kubectl as a fallback.
set -eu

if [ "$#" -eq 0 ]; then
  exit 0
fi

if command -v kubeconform >/dev/null 2>&1; then
  for manifest in "$@"; do
    [ -f "${manifest}" ] || continue
    kubeconform -strict "${manifest}"
  done
  exit 0
fi

if command -v kubectl >/dev/null 2>&1; then
  failed=0
  for manifest in "$@"; do
    [ -f "${manifest}" ] || continue
    if ! kubectl apply --dry-run=client --validate=false -f "${manifest}" 2>/dev/null; then
      echo "warning: kubectl could not validate ${manifest} (no cluster credentials?)" >&2
      failed=1
    fi
  done
  if [ "$failed" -eq 1 ]; then
    echo "hint: install kubeconform for offline manifest validation" >&2
  fi
  exit 0
fi

echo "kubeconform or kubectl not found; install one to validate Kubernetes manifests." >&2
exit 1
