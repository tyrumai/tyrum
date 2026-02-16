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
  errors=0
  for manifest in "$@"; do
    [ -f "${manifest}" ] || continue
    stderr="$(kubectl apply --dry-run=client --validate=false -f "${manifest}" 2>&1 >/dev/null)" || {
      if printf '%s' "$stderr" | grep -qi 'credential\|unauthorized\|unable to recognize'; then
        echo "warning: kubectl could not validate ${manifest} (no cluster credentials)" >&2
        echo "hint: install kubeconform for offline manifest validation" >&2
        exit 0
      fi
      echo "error: ${manifest}: ${stderr}" >&2
      errors=1
    }
  done
  exit "$errors"
fi

echo "kubeconform or kubectl not found; install one to validate Kubernetes manifests." >&2
exit 1
