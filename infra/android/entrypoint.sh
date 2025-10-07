#!/usr/bin/env bash
set -euo pipefail

log() {
  printf '[%s] %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"
}

AVD_NAME=${AVD_NAME:-tyrum-android-executor}
SYSTEM_IMAGE=${ANDROID_SYSTEM_IMAGE:-system-images;android-34;google_apis;x86_64}
AVD_DEVICE_ID=${ANDROID_AVD_DEVICE_ID:-pixel_6}
AVD_ABI=${ANDROID_AVD_ABI:-x86_64}
AVDMANAGER_BIN=${AVDMANAGER_BIN:-/opt/android-sdk/cmdline-tools/latest/bin/avdmanager}
RUNTIME_PARENT=${ANDROID_RUNTIME_PARENT:-/tmp/android-runtime}
EMULATOR_CONSOLE_PORT=${EMULATOR_CONSOLE_PORT:-5554}
EMULATOR_ADB_PORT=${EMULATOR_ADB_PORT:-$((EMULATOR_CONSOLE_PORT + 1))}
DEFAULT_INTERNAL_CONSOLE=${EMULATOR_CONSOLE_PORT_INTERNAL:-0}
if (( DEFAULT_INTERNAL_CONSOLE <= 0 )); then
  DEFAULT_INTERNAL_CONSOLE=$((EMULATOR_CONSOLE_PORT + 200))
  if (( DEFAULT_INTERNAL_CONSOLE >= 65534 )); then
    DEFAULT_INTERNAL_CONSOLE=5660
  fi
fi
if (( DEFAULT_INTERNAL_CONSOLE == EMULATOR_CONSOLE_PORT )); then
  DEFAULT_INTERNAL_CONSOLE=$((DEFAULT_INTERNAL_CONSOLE + 2))
fi
if (( DEFAULT_INTERNAL_CONSOLE % 2 == 1 )); then
  DEFAULT_INTERNAL_CONSOLE=$((DEFAULT_INTERNAL_CONSOLE + 1))
fi
EMULATOR_CONSOLE_PORT_INTERNAL=$DEFAULT_INTERNAL_CONSOLE
EMULATOR_ADB_PORT_INTERNAL=${EMULATOR_ADB_PORT_INTERNAL:-$((EMULATOR_CONSOLE_PORT_INTERNAL + 1))}
if (( EMULATOR_ADB_PORT_INTERNAL == EMULATOR_ADB_PORT )); then
  EMULATOR_ADB_PORT_INTERNAL=$((EMULATOR_ADB_PORT_INTERNAL + 2))
fi
EMULATOR_GRPC_PORT=${EMULATOR_GRPC_PORT:-8554}
BOOT_TIMEOUT_SECONDS=${ANDROID_BOOT_TIMEOUT_SECONDS:-240}
BOOT_COMPLETION_GRACE_SECONDS=${ANDROID_BOOT_COMPLETION_GRACE_SECONDS:-120}
DATA_PARTITION_MB=${ANDROID_DATA_PARTITION_MB:-2048}
SDK_ROOT=${ANDROID_SDK_ROOT:-/opt/android-sdk}
ADB_DEVICE_SERIAL=${ADB_DEVICE_SERIAL:-emulator-${EMULATOR_CONSOLE_PORT_INTERNAL}}
mkdir -p "$RUNTIME_PARENT"
RUNTIME_HOME=$(mktemp -d "${RUNTIME_PARENT}/home.XXXXXX")

ensure_runtime_avd() {
  if [[ -d "$ANDROID_AVD_HOME/$AVD_NAME.avd" && -f "$ANDROID_AVD_HOME/$AVD_NAME.ini" ]]; then
    return
  fi
  log "Creating AVD '$AVD_NAME' (image: $SYSTEM_IMAGE)"
  rm -rf "$ANDROID_AVD_HOME/$AVD_NAME.avd" "$ANDROID_AVD_HOME/$AVD_NAME.ini"
  if ! HOME="$HOME" \
       ANDROID_SDK_ROOT="$SDK_ROOT" \
       ANDROID_HOME="$SDK_ROOT" \
       ANDROID_AVD_HOME="$ANDROID_AVD_HOME" \
       ANDROID_USER_HOME="$ANDROID_USER_HOME" \
        "$AVDMANAGER_BIN" --verbose create avd \
          --name "$AVD_NAME" \
          --package "$SYSTEM_IMAGE" \
          --device "$AVD_DEVICE_ID" \
          --abi "$AVD_ABI" \
          --force <<<"no"; then
    log "Failed to create runtime AVD; dumping avdmanager logs."
    find "$ANDROID_USER_HOME" -maxdepth 4 -type f -name '*.log' -print -exec cat {} + 2>/dev/null || true
    exit 1
  fi
  configure_avd_profile
  log "AVD '$AVD_NAME' created at $ANDROID_AVD_HOME"
}

configure_avd_profile() {
  local config_file="$ANDROID_AVD_HOME/$AVD_NAME.avd/config.ini"
  if [[ ! -f "$config_file" ]]; then
    log "AVD config.ini not found at $config_file"
    return
  fi
  if grep -q '^disk.dataPartition.size=' "$config_file"; then
    sed -i "s/^disk.dataPartition.size=.*/disk.dataPartition.size=${DATA_PARTITION_MB}M/" "$config_file"
  else
    printf '\ndisk.dataPartition.size=%sM\n' "$DATA_PARTITION_MB" >>"$config_file"
  fi
  if grep -q '^fastboot.forceColdBoot=' "$config_file"; then
    sed -i 's/^fastboot.forceColdBoot=.*/fastboot.forceColdBoot=yes/' "$config_file"
  else
    printf 'fastboot.forceColdBoot=yes\n' >>"$config_file"
  fi
  if grep -q '^hw.gpu.mode=' "$config_file"; then
    sed -i 's/^hw.gpu.mode=.*/hw.gpu.mode=off/' "$config_file"
  else
    printf 'hw.gpu.mode=off\n' >>"$config_file"
  fi
}

declare -a PORT_FORWARD_PIDS=()

start_port_proxy() {
  local listen_port=$1
  local target_port=$2
  if [[ $listen_port -eq $target_port ]]; then
    return
  fi
  if ! command -v socat >/dev/null 2>&1; then
    log "socat not available; cannot forward port $listen_port"
    return
  fi
  log "Forwarding 0.0.0.0:$listen_port -> 127.0.0.1:$target_port"
  socat TCP-LISTEN:"$listen_port",reuseaddr,fork TCP:127.0.0.1:"$target_port" &
  PORT_FORWARD_PIDS+=($!)
}

cleanup() {
  local exit_code=$?
  if [[ -n "${LOGGER_PID:-}" ]] && kill -0 "$LOGGER_PID" 2>/dev/null; then
    kill "$LOGGER_PID" 2>/dev/null || true
    wait "$LOGGER_PID" 2>/dev/null || true
  fi
  if [[ -n "${EMULATOR_PID:-}" ]] && kill -0 "$EMULATOR_PID" 2>/dev/null; then
    log "Stopping emulator (pid=$EMULATOR_PID)"
    kill "$EMULATOR_PID" 2>/dev/null || true
    wait "$EMULATOR_PID" 2>/dev/null || true
  fi
  adb kill-server >/dev/null 2>&1 || true
  if ((${#PORT_FORWARD_PIDS[@]})); then
    for pid in "${PORT_FORWARD_PIDS[@]}"; do
      if kill -0 "$pid" 2>/dev/null; then
        kill "$pid" 2>/dev/null || true
        wait "$pid" 2>/dev/null || true
      fi
    done
  fi
  rm -rf "$RUNTIME_HOME"
  log "Shutdown complete"
  exit "$exit_code"
}
trap cleanup EXIT INT TERM

export HOME=$RUNTIME_HOME
export ANDROID_USER_HOME=$RUNTIME_HOME/.android
export ANDROID_AVD_HOME=$ANDROID_USER_HOME/avd
export ANDROID_TMPDIR=$RUNTIME_HOME/tmp
export ANDROID_SDK_ROOT=$SDK_ROOT
export ANDROID_HOME=$SDK_ROOT
export QT_QPA_PLATFORM=offscreen
export PATH=$PATH:/opt/android-sdk/platform-tools:/opt/android-sdk/emulator:/opt/android-sdk/cmdline-tools/latest/bin

mkdir -p "$ANDROID_USER_HOME" "$ANDROID_AVD_HOME" "$ANDROID_TMPDIR"
touch "$ANDROID_USER_HOME/repositories.cfg"
ensure_runtime_avd

start_port_proxy "$EMULATOR_CONSOLE_PORT" "$EMULATOR_CONSOLE_PORT_INTERNAL"
start_port_proxy "$EMULATOR_ADB_PORT" "$EMULATOR_ADB_PORT_INTERNAL"

EMULATOR_ARGS=(
  -avd "$AVD_NAME"
  -ports "${EMULATOR_CONSOLE_PORT_INTERNAL},${EMULATOR_ADB_PORT_INTERNAL}"
  -grpc 0.0.0.0:"$EMULATOR_GRPC_PORT"
  -no-window
  -no-snapshot
  -no-snapshot-save
  -wipe-data
  -no-audio
  -no-boot-anim
  -no-metrics
  -gpu off
  -engine classic
  -timezone UTC
  -idle-grpc-timeout 300
  -skip-adb-auth
  -partition-size "$DATA_PARTITION_MB"
)

if [[ -w /dev/kvm ]]; then
  log "Hardware acceleration detected via /dev/kvm"
  EMULATOR_ARGS+=( -accel on )
else
  log "/dev/kvm unavailable; falling back to software rendering"
  EMULATOR_ARGS+=( -accel off )
fi

log "Launching Android emulator with AVD '$AVD_NAME'"
/opt/android-sdk/emulator/emulator "${EMULATOR_ARGS[@]}" \
  >"$RUNTIME_HOME/emulator.log" 2>&1 &
EMULATOR_PID=$!

sleep 5
adb start-server >/dev/null 2>&1 || true

log "Waiting for emulator $ADB_DEVICE_SERIAL to report device state"
start_ts=$SECONDS
deadline=$((start_ts + BOOT_TIMEOUT_SECONDS))
while true; do
  if adb devices 2>/dev/null | awk -v serial="$ADB_DEVICE_SERIAL" '$1 == serial && $2 == "device" {found=1} END {exit(!found)}'; then
    break
  fi
  if (( SECONDS >= deadline )); then
    log "Timed out waiting for $ADB_DEVICE_SERIAL to become ready"
    log "Recent emulator log output:"
    tail -n 200 "$RUNTIME_HOME/emulator.log" 2>/dev/null || true
    exit 1
  fi
  sleep 5
  adb connect "127.0.0.1:${EMULATOR_ADB_PORT}" >/dev/null 2>&1 || true
  adb devices >/dev/null 2>&1 || true
done

log "Emulator reported as ready; verifying boot completion"
completion_deadline=$((SECONDS + BOOT_COMPLETION_GRACE_SECONDS))
while true; do
  if adb -s "$ADB_DEVICE_SERIAL" shell getprop sys.boot_completed 2>/dev/null | grep -q '1'; then
    break
  fi
  if (( SECONDS >= completion_deadline )); then
    log "Timed out waiting for Android system boot"
    log "Recent emulator log output:"
    tail -n 200 "$RUNTIME_HOME/emulator.log" 2>/dev/null || true
    exit 1
  fi
  sleep 5
done

log "Android emulator boot complete; streaming logs"
tail -F "$RUNTIME_HOME/emulator.log" &
LOGGER_PID=$!
wait "$EMULATOR_PID"
if [[ -n "${LOGGER_PID:-}" ]] && kill -0 "$LOGGER_PID" 2>/dev/null; then
  kill "$LOGGER_PID" 2>/dev/null || true
  wait "$LOGGER_PID" 2>/dev/null || true
fi
