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
  for manifest in "$@"; do
    [ -f "${manifest}" ] || continue
    kubectl apply --dry-run=client --validate=true -f "${manifest}"
  done
  exit 0
fi

echo "kubeconform or kubectl not found; install one to validate Kubernetes manifests." >&2
exit 1
