#!/usr/bin/env bash
set -euo pipefail

# Tyrum installer (macOS + Linux)
# Usage:
#   curl -fsSL https://get.tyrum.ai/install.sh | bash
#   curl -fsSL https://get.tyrum.ai/install.sh | bash -s -- --channel beta
#   curl -fsSL https://get.tyrum.ai/install.sh | bash -s -- 2026.2.18

REPO="${TYRUM_REPO:-rhernaus/tyrum}"
CHANNEL="${TYRUM_CHANNEL:-stable}"
REQUESTED_VERSION="${TYRUM_VERSION:-}"
INSTALL_CMD="tyrum-gateway"

usage() {
  cat <<'EOF'
Tyrum installer

Usage:
  install.sh [version]
  install.sh --channel stable|beta|dev
  install.sh --version <version>
  install.sh --repo <owner/repo>

Notes:
- If no version is provided, the installer resolves the latest release for the selected channel.
- Explicit version always wins over channel selection.
- Supported tag formats: vYYYY.M.D, vYYYY.M.D-beta.N, vYYYY.M.D-dev.N
EOF
}

fail() {
  echo "error: $*" >&2
  exit 1
}

info() {
  echo "==> $*"
}

have() {
  command -v "$1" >/dev/null 2>&1
}

require_cmd() {
  local name="$1"
  have "$name" || fail "missing required command: $name"
}

download_to_file() {
  local url="$1"
  local output="$2"

  if have curl; then
    curl -fsSL --retry 3 --retry-delay 1 -o "$output" "$url"
    return
  fi

  if have wget; then
    wget -q -O "$output" "$url"
    return
  fi

  fail "missing downloader: install curl or wget"
}

fetch_text() {
  local url="$1"
  local output
  output="$(mktemp)"
  download_to_file "$url" "$output"
  cat "$output"
  rm -f "$output"
}

sha256_file() {
  local file="$1"
  if have sha256sum; then
    sha256sum "$file" | awk '{print $1}'
    return
  fi
  if have shasum; then
    shasum -a 256 "$file" | awk '{print $1}'
    return
  fi
  fail "missing checksum tool: install sha256sum or shasum"
}

is_supported_os() {
  case "$(uname -s)" in
    Darwin|Linux) return 0 ;;
    *) return 1 ;;
  esac
}

require_node_24() {
  require_cmd node
  require_cmd npm

  local major
  major="$(node -p 'process.versions.node.split(".")[0]')"
  if [[ "$major" -lt 24 ]]; then
    fail "Node.js 24+ required (found $(node -v)). Install Node 24 and retry."
  fi
}

validate_channel() {
  case "$1" in
    stable|beta|dev) return 0 ;;
    *) fail "invalid channel '$1' (expected stable, beta, or dev)" ;;
  esac
}

resolve_latest_tag_for_channel() {
  local channel="$1"

  if [[ "$channel" == "stable" ]]; then
    local api_url="https://api.github.com/repos/${REPO}/releases/latest"
    local json
    json="$(fetch_text "$api_url")"
    local tag
    tag="$(printf '%s' "$json" | node -e 'const fs=require("node:fs");const data=JSON.parse(fs.readFileSync(0,"utf8"));process.stdout.write(typeof data.tag_name==="string"?data.tag_name:"");')"
    [[ -n "$tag" ]] || fail "unable to resolve latest stable release tag for ${REPO}"
    printf '%s' "$tag"
    return
  fi

  local api_url="https://api.github.com/repos/${REPO}/releases?per_page=100"
  local json
  json="$(fetch_text "$api_url")"
  local tag
  tag="$(printf '%s' "$json" | node -e '
    const fs = require("node:fs");
    const channel = process.argv[1];
    const releases = JSON.parse(fs.readFileSync(0, "utf8"));
    if (!Array.isArray(releases)) process.exit(0);
    for (const rel of releases) {
      if (!rel || rel.draft || !rel.prerelease) continue;
      if (typeof rel.tag_name !== "string") continue;
      if (rel.tag_name.includes("-" + channel + ".")) {
        process.stdout.write(rel.tag_name);
        process.exit(0);
      }
    }
  ' "$channel")"
  [[ -n "$tag" ]] || fail "unable to resolve latest ${channel} release tag for ${REPO}"
  printf '%s' "$tag"
}

normalize_tag() {
  local requested="$1"
  local tag
  local version

  if [[ -n "$requested" ]]; then
    if [[ "$requested" == v* ]]; then
      tag="$requested"
    else
      tag="v${requested}"
    fi
  else
    tag="$(resolve_latest_tag_for_channel "$CHANNEL")"
  fi

  if [[ ! "$tag" =~ ^v[0-9]{4}\.[0-9]{1,2}\.[0-9]{1,2}(-(beta|dev)\.[0-9]+)?$ ]]; then
    fail "unsupported tag format '${tag}'"
  fi

  version="${tag#v}"
  [[ -n "$version" ]] || fail "invalid version/tag: ${tag}"
  printf '%s;%s' "$tag" "$version"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --channel)
      [[ $# -ge 2 ]] || fail "--channel requires a value"
      CHANNEL="$2"
      shift 2
      ;;
    --version)
      [[ $# -ge 2 ]] || fail "--version requires a value"
      REQUESTED_VERSION="$2"
      shift 2
      ;;
    --repo)
      [[ $# -ge 2 ]] || fail "--repo requires a value"
      REPO="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      if [[ -z "$REQUESTED_VERSION" ]]; then
        REQUESTED_VERSION="$1"
        shift
      else
        fail "unexpected argument: $1"
      fi
      ;;
  esac
done

validate_channel "$CHANNEL"

if ! is_supported_os; then
  fail "unsupported OS: $(uname -s). This installer currently supports macOS and Linux."
fi

require_node_24

IFS=';' read -r TAG VERSION <<<"$(normalize_tag "$REQUESTED_VERSION")"
ASSET="tyrum-gateway-${VERSION}.tgz"
CHECKSUMS="SHA256SUMS"
BASE_URL="https://github.com/${REPO}/releases/download/${TAG}"

TMP_DIR="$(mktemp -d)"
cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

info "Installing Tyrum ${VERSION} (${TAG}) from ${REPO}"
download_to_file "${BASE_URL}/${CHECKSUMS}" "${TMP_DIR}/${CHECKSUMS}" || fail "failed to download ${CHECKSUMS}"
download_to_file "${BASE_URL}/${ASSET}" "${TMP_DIR}/${ASSET}" || fail "failed to download ${ASSET}"

EXPECTED_SHA="$(grep -E "  (\./)?${ASSET}$" "${TMP_DIR}/${CHECKSUMS}" | awk '{print $1}')"
[[ -n "$EXPECTED_SHA" ]] || fail "checksum entry for ${ASSET} not found in ${CHECKSUMS}"

ACTUAL_SHA="$(sha256_file "${TMP_DIR}/${ASSET}")"
if [[ "$EXPECTED_SHA" != "$ACTUAL_SHA" ]]; then
  fail "checksum mismatch for ${ASSET} (expected ${EXPECTED_SHA}, got ${ACTUAL_SHA})"
fi

info "Checksum verified"

if ! npm install -g "${TMP_DIR}/${ASSET}"; then
  cat >&2 <<'EOF'
error: npm global install failed.
hint:
- Ensure your global npm bin directory is writable, or
- Use a Node manager (fnm/nvm/asdf), or
- Retry with elevated permissions only if appropriate for your environment.
EOF
  exit 1
fi

if ! have "${INSTALL_CMD}"; then
  NPM_PREFIX="$(npm prefix -g 2>/dev/null || true)"
  if [[ -n "${NPM_PREFIX}" ]]; then
    cat <<EOF
warning: ${INSTALL_CMD} was installed but is not on PATH.
add this to your shell profile:
  export PATH="${NPM_PREFIX}/bin:\$PATH"
EOF
  fi
fi

cat <<EOF
Installed successfully.

Try:
  ${INSTALL_CMD}
  TYRUM_AGENT_ENABLED=1 ${INSTALL_CMD}
EOF
