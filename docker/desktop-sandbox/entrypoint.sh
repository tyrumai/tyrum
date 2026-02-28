#!/usr/bin/env bash
set -euo pipefail

export DISPLAY="${DISPLAY:-:0}"
export DESKTOP_GEOMETRY="${DESKTOP_GEOMETRY:-1280x720}"
export DESKTOP_DEPTH="${DESKTOP_DEPTH:-24}"
export VNC_PORT="${VNC_PORT:-5900}"
export NOVNC_PORT="${NOVNC_PORT:-6080}"

# Maximize a11y availability for future AT-SPI backends.
export NO_AT_BRIDGE="${NO_AT_BRIDGE:-0}"
export QT_ACCESSIBILITY="${QT_ACCESSIBILITY:-1}"

export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/tmp/runtime}"
mkdir -p "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"

mkdir -p /run/dbus
rm -f /run/dbus/pid || true
dbus-daemon --system --fork --nopidfile --print-address >/dev/null

if [[ -z "${DBUS_SESSION_BUS_ADDRESS:-}" ]]; then
  eval "$(dbus-launch --sh-syntax)"
fi

echo "desktop-sandbox: starting Xvfb (${DISPLAY})"
Xvfb "$DISPLAY" -screen 0 "${DESKTOP_GEOMETRY}x${DESKTOP_DEPTH}" -nolisten tcp -ac &

for _ in $(seq 1 50); do
  if xdpyinfo -display "$DISPLAY" >/dev/null 2>&1; then
    break
  fi
  sleep 0.1
done

echo "desktop-sandbox: starting Xfce session"
startxfce4 >/tmp/xfce4.log 2>&1 &

echo "desktop-sandbox: starting x11vnc (port ${VNC_PORT})"
x11vnc -display "$DISPLAY" -rfbport "$VNC_PORT" -listen 0.0.0.0 -shared -forever -nopw >/tmp/x11vnc.log 2>&1 &

echo "desktop-sandbox: starting noVNC (port ${NOVNC_PORT})"
novnc_proxy --vnc "127.0.0.1:${VNC_PORT}" --listen "${NOVNC_PORT}" >/tmp/novnc.log 2>&1 &

takeover_url_default="http://localhost:${NOVNC_PORT}/vnc.html?autoconnect=true"
takeover_url="${TYRUM_DESKTOP_SANDBOX_TAKEOVER_URL:-$takeover_url_default}"
export TYRUM_TAKEOVER_URL="${TYRUM_TAKEOVER_URL:-$takeover_url}"

echo "desktop-sandbox: takeover_url=${takeover_url}"

if [[ -z "${TYRUM_GATEWAY_WS_URL:-}" ]]; then
  export TYRUM_GATEWAY_WS_URL="ws://tyrum:8788/ws"
fi

if [[ -z "${TYRUM_GATEWAY_TOKEN_PATH:-}" && -z "${TYRUM_GATEWAY_TOKEN:-}" ]]; then
  export TYRUM_GATEWAY_TOKEN_PATH="/gateway/.admin-token"
fi

if [[ -n "${TYRUM_GATEWAY_TOKEN_PATH:-}" ]]; then
  echo "desktop-sandbox: waiting for gateway token file (${TYRUM_GATEWAY_TOKEN_PATH})"
  for _ in $(seq 1 120); do
    if [[ -s "${TYRUM_GATEWAY_TOKEN_PATH}" ]]; then
      break
    fi
    sleep 0.5
  done
  if [[ ! -s "${TYRUM_GATEWAY_TOKEN_PATH}" ]]; then
    echo "desktop-sandbox: gateway token file not ready: ${TYRUM_GATEWAY_TOKEN_PATH}" >&2
    exit 1
  fi
fi

export TYRUM_NODE_LABEL="${TYRUM_NODE_LABEL:-tyrum-desktop-sandbox}"
export TYRUM_NODE_MODE="${TYRUM_NODE_MODE:-desktop-sandbox}"

echo "desktop-sandbox: starting tyrum-desktop-node (ws=${TYRUM_GATEWAY_WS_URL})"
node_args=(
  --ws-url "$TYRUM_GATEWAY_WS_URL"
  --label "$TYRUM_NODE_LABEL"
  --mode "$TYRUM_NODE_MODE"
  --takeover-url "$takeover_url"
)

if [[ -n "${TYRUM_GATEWAY_TOKEN:-}" ]]; then
  node_args+=(--token "$TYRUM_GATEWAY_TOKEN")
fi

if [[ -n "${TYRUM_GATEWAY_TOKEN_PATH:-}" ]]; then
  node_args+=(--token-path "$TYRUM_GATEWAY_TOKEN_PATH")
fi

exec node /app/packages/desktop-node/bin/tyrum-desktop-node.mjs "${node_args[@]}"
