#!/bin/sh
# Run GitHub Actions workflow linting, pulling a cached binary if the tool is not installed.
set -eu

if command -v actionlint >/dev/null 2>&1; then
  exec actionlint "$@"
fi

version="1.7.7"
os=$(uname -s)
arch=$(uname -m)

case "$os" in
  Linux) platform_os="linux" ;;
  Darwin) platform_os="darwin" ;;
  *)
    echo "Unsupported OS '$os' for actionlint" >&2
    exit 1
    ;;
esac

case "$arch" in
  x86_64|amd64) platform_arch="amd64" ;;
  arm64|aarch64) platform_arch="arm64" ;;
  *)
    echo "Unsupported architecture '$arch' for actionlint" >&2
    exit 1
    ;;
esac

cache_root="${XDG_CACHE_HOME:-${HOME:-/tmp}/.cache}/tyrum"
binary_path="$cache_root/actionlint-${version}"

if [ ! -x "$binary_path" ]; then
  url="https://github.com/rhysd/actionlint/releases/download/v${version}/actionlint_${version}_${platform_os}_${platform_arch}.tar.gz"
  tmpdir=$(mktemp -d)
  trap 'rm -rf "$tmpdir"' EXIT

  if ! command -v curl >/dev/null 2>&1; then
    echo "curl is required to download actionlint" >&2
    exit 1
  fi

  curl -sSL "$url" -o "$tmpdir/actionlint.tgz"
  if ! command -v tar >/dev/null 2>&1; then
    echo "tar is required to extract actionlint" >&2
    exit 1
  fi

  tar -xzf "$tmpdir/actionlint.tgz" -C "$tmpdir" actionlint
  mkdir -p "$cache_root"
  mv "$tmpdir/actionlint" "$binary_path"
  chmod +x "$binary_path"
  rm -rf "$tmpdir"
  trap - EXIT
fi

exec "$binary_path" "$@"
