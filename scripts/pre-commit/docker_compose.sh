#!/bin/sh
# Validate Docker Compose configuration for staged compose files.
set -eu

if [ "$#" -eq 0 ]; then
  exit 0
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "docker not found; install Docker Engine with Compose support." >&2
  exit 1
fi

compose_cmd=""
if docker compose version >/dev/null 2>&1; then
  compose_cmd="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  compose_cmd="docker-compose"
else
  echo "docker compose command not available; install Docker Compose v2." >&2
  exit 1
fi

for file in "$@"; do
  [ -f "${file}" ] || continue
  # shellcheck disable=SC2086
  ${compose_cmd} -f "${file}" config >/dev/null
done
