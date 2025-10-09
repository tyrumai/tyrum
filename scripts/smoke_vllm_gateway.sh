#!/usr/bin/env bash
set -euo pipefail

gateway_url=${VLLM_GATEWAY_URL:-http://localhost:8000}

echo "Checking vLLM gateway health at $gateway_url/health"
response=$(curl --show-error --silent --fail "$gateway_url/health")

if command -v jq >/dev/null 2>&1; then
  echo "$response" | jq -e '.status == "ok"' >/dev/null
fi

echo "vLLM gateway responded successfully."
