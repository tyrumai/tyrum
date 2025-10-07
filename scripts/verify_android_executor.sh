#!/usr/bin/env bash
set -euo pipefail

root_dir=$(git rev-parse --show-toplevel 2>/dev/null || true)
if [[ -z "$root_dir" ]]; then
  script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
  root_dir=$(cd -- "$script_dir/.." && pwd)
fi

compose_file=${TYRUM_COMPOSE_FILE:-infra/docker-compose.yml}
service_name=${TYRUM_ANDROID_SERVICE:-android-executor}
adb_target=${TYRUM_ANDROID_HOST_PORT:-localhost:5555}

compose_cmd=(docker compose -f "$root_dir/$compose_file")

if ! "${compose_cmd[@]}" ps --status running "$service_name" >/dev/null 2>&1; then
  echo "Service '$service_name' is not running. Start it with:"
  echo "  docker compose -f $root_dir/$compose_file up -d $service_name"
  exit 2
fi

echo "Checking Android executor health via 'adb devices'"
adb_output=$("${compose_cmd[@]}" exec -T "$service_name" adb devices)
printf '%s\n' "$adb_output"

if printf '%s\n' "$adb_output" | awk 'NR>1 && $2=="device" {exit 0} END {exit 1}'; then
  echo "Emulator reported as online. Host ADB can connect via: adb connect $adb_target"
else
  echo "Emulator is not yet online. See docker logs via 'docker compose -f $root_dir/$compose_file logs $service_name'" >&2
  exit 1
fi
