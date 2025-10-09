#!/usr/bin/env bash
set -euo pipefail

root_dir=$(git rev-parse --show-toplevel 2>/dev/null || true)
if [[ -z "$root_dir" ]]; then
  script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
  root_dir=$(cd -- "$script_dir/.." && pwd)
fi

gateway_url=${MODEL_GATEWAY_URL:-http://localhost:8001}

echo "Checking model gateway health at $gateway_url/healthz"
health_response=$(curl --show-error --silent --fail "$gateway_url/healthz")
echo "$health_response" | jq -e '.status == "ok"' >/dev/null
echo "Health check passed."

echo "Invoking mock frontier model through gateway"
completion_response=$(curl --show-error --silent --fail \
  -H "Content-Type: application/json" \
  -d '{"model":"frontier-mock","prompt":"ping"}' \
  "$gateway_url/v1/completions")

echo "$completion_response" | jq -e '.choices[0].text | startswith("Echo:")' >/dev/null
echo "Routing verification passed."

echo "Validating streaming response via SSE"
stream_response=$(curl --show-error --silent --fail --no-buffer \
  -H "Content-Type: application/json" \
  -d '{"model":"frontier-mock","prompt":"ping","stream":true}' \
  "$gateway_url/v1/completions")

if [[ "$stream_response" != *"data: [DONE]"* ]]; then
  echo "Streaming response missing [DONE] sentinel" >&2
  exit 1
fi
echo "Streaming verification passed."
