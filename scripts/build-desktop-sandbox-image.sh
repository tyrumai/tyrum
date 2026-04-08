#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
image_tag="${1:-${TYRUM_DESKTOP_SANDBOX_IMAGE_TAG:-tyrum-desktop-sandbox:local}}"

echo "Building desktop sandbox image: ${image_tag}"
docker build --load -f "${repo_root}/docker/desktop-sandbox/Dockerfile" -t "${image_tag}" "${repo_root}"

echo "Verifying Playwright Chromium launch inside ${image_tag}"
docker run --rm --entrypoint bash "${image_tag}" -lc \
  'node -e '\''const { chromium } = require("playwright"); (async () => { const browser = await chromium.launch({ headless: true }); await browser.close(); })().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exit(1); });'\'''

cat <<EOF

Local desktop sandbox image is ready: ${image_tag}

To point the gateway at this local tag, update the desktop-environment defaults:

curl -sS -X PUT \
  -H "authorization: Bearer \${GATEWAY_TOKEN}" \
  -H "content-type: application/json" \
  -d '{"default_image_ref":"${image_tag}"}' \
  "\${TYRUM_BASE_URL:-http://127.0.0.1:8788}/config/desktop-environments/defaults"
EOF
