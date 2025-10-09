#!/usr/bin/env bash
set -euo pipefail

MODEL="${VLLM_MODEL:-hf-internal-testing/tiny-random-LlamaForCausalLM}"
MODEL_NAME="${VLLM_MODEL_NAME:-tyrum-stub}"
HOST="${VLLM_HOST:-0.0.0.0}"
PORT="${VLLM_PORT:-8000}"

read -r -a EXTRA_ARGS <<<"${VLLM_EXTRA_ARGS:-}"

exec vllm serve "${MODEL}" \
  --served-model-name "${MODEL_NAME}" \
  --host "${HOST}" \
  --port "${PORT}" \
  "${EXTRA_ARGS[@]}"
