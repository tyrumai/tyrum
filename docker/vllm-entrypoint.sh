#!/usr/bin/env bash
set -euo pipefail

MODEL="${VLLM_MODEL:-hf-internal-testing/tiny-random-LlamaForCausalLM}"
MODEL_NAME="${VLLM_MODEL_NAME:-tyrum-stub}"
HOST="${VLLM_HOST:-0.0.0.0}"
PORT="${VLLM_PORT:-8000}"

EXTRA_ARGS=()
if [[ -n "${VLLM_EXTRA_ARGS:-}" ]]; then
  if ! command -v python3 >/dev/null 2>&1; then
    echo "python3 is required to parse VLLM_EXTRA_ARGS safely" >&2
    exit 1
  fi
  while IFS= read -r arg; do
    [[ -n "$arg" ]] || continue
    EXTRA_ARGS+=("$arg")
  done < <(python3 - <<'PY'
import os
import shlex

value = os.environ.get("VLLM_EXTRA_ARGS", "")
for token in shlex.split(value):
    print(token)
PY
)
fi

exec vllm serve "${MODEL}" \
  --served-model-name "${MODEL_NAME}" \
  --host "${HOST}" \
  --port "${PORT}" \
  "${EXTRA_ARGS[@]}"
