#!/usr/bin/env bash
# Start (or restart) the local browser node and auto-pair it.
# Run from the repo root. Useful if the node host process dies after dev-up.
set -euo pipefail

NODE_STATE_DIR=".openclaw-local"
NODE_PID_FILE=".openclaw-local/node-host.pid"
API_URL="${PLATFORM_API_URL:-http://localhost:3005}"
INTERNAL_TOKEN="${PLATFORM_INTERNAL_TOKEN:-dev-internal-token}"
GATEWAY_TOKEN="${OPENCLAW_GATEWAY_TOKEN:-dev-gateway-token}"
GATEWAY_HOST="${OPENCLAW_GATEWAY_HOST:-127.0.0.1}"
GATEWAY_PORT="${OPENCLAW_GATEWAY_PORT:-18789}"

if ! command -v node >/dev/null 2>&1; then
  echo "Error: node not found. Install Node.js 22+ and try again."
  exit 1
fi

if [[ ! -f "packages/openclaw-fork/openclaw.mjs" ]]; then
  echo "Error: run this script from the repo root (packages/openclaw-fork/openclaw.mjs not found)."
  exit 1
fi

mkdir -p "$NODE_STATE_DIR"

is_pid_alive() {
  local pid="$1"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

# Check connection by asking the platform API for browser status.
# The node-provided browser profile has userDataDir under .openclaw-local.
# We only need the profile config to be present (node connected), not Chrome
# actively running — Chrome starts lazily on first use.
is_browser_node_connected() {
  local resp
  resp=$(curl -sf --max-time 5 \
    "${API_URL}/internal/browser/status?profile=openclaw" \
    -H "Authorization: Bearer ${INTERNAL_TOKEN}" 2>/dev/null || echo '{}')
  # A 503 returns {"ok":false,"error":"browser_unavailable"} — node not connected.
  # A successful response (node connected) includes userDataDir with .openclaw-local.
  echo "$resp" | grep -q '\.openclaw-local' && echo "yes" || echo "no"
}

check_already_connected() {
  if [[ -f "$NODE_PID_FILE" ]]; then
    local pid
    pid="$(cat "$NODE_PID_FILE" 2>/dev/null || true)"
    if ! is_pid_alive "$pid"; then
      echo "no"
      return
    fi
  fi
  is_browser_node_connected
}

if [[ "$(check_already_connected 2>/dev/null)" == "yes" ]]; then
  echo "Local browser node is already connected. Nothing to do."
  exit 0
fi

# Stop any previously running node host
if [[ -f "$NODE_PID_FILE" ]]; then
  old_pid="$(cat "$NODE_PID_FILE" 2>/dev/null || true)"
  if [[ -n "$old_pid" ]] && kill -0 "$old_pid" 2>/dev/null; then
    echo "Stopping previous node host (PID $old_pid)..."
    kill "$old_pid" 2>/dev/null || true
    sleep 1
  fi
  rm -f "$NODE_PID_FILE"
fi

echo "Starting local browser node..."
echo "  Gateway: ws://${GATEWAY_HOST}:${GATEWAY_PORT}"
echo "  State:   ${NODE_STATE_DIR}/"
echo "  Log:     ${NODE_STATE_DIR}/node-host.log"
echo

# Resolve the auth token to use for initial connection.
# Prefer the device-issued token (avoids "pairing required" for already-paired nodes).
# If the device token turns out to be stale (gateway rotated tokens after rebuild),
# we detect it below and fall back to a fresh gateway-token pairing.
DEVICE_AUTH="$NODE_STATE_DIR/identity/device-auth.json"
NODE_DEVICE_TOKEN=""
if [[ -f "$DEVICE_AUTH" ]]; then
  NODE_DEVICE_TOKEN=$(node -e "
    try {
      const d = JSON.parse(require('fs').readFileSync('$DEVICE_AUTH','utf8'));
      process.stdout.write(d?.tokens?.node?.token || '');
    } catch { process.stdout.write(''); }
  " 2>/dev/null || true)
fi
CONN_TOKEN="${NODE_DEVICE_TOKEN:-$GATEWAY_TOKEN}"

start_node() {
  local token="$1"
  OPENCLAW_STATE_DIR="$NODE_STATE_DIR" \
  OPENCLAW_GATEWAY_TOKEN="$token" \
  node packages/openclaw-fork/openclaw.mjs node run \
    --host "$GATEWAY_HOST" \
    --port "$GATEWAY_PORT" \
    --display-name "Local Browser Node" \
    >> "$NODE_STATE_DIR/node-host.log" 2>&1 &
  echo $!
}

node_pid=$(start_node "$CONN_TOKEN")
echo "$node_pid" > "$NODE_PID_FILE"
echo "Node host started (PID $node_pid)."
echo

echo "Waiting for node to connect and auto-pairing if needed..."

STALE_TOKEN_DETECTED=0

for attempt in $(seq 1 25); do
  sleep 3

  # If the node process has already died, check whether it was a token problem.
  if ! is_pid_alive "$node_pid"; then
    break
  fi

  # Detect stale device token: gateway says "mismatch" or "pairing required" in the log.
  if [[ $STALE_TOKEN_DETECTED -eq 0 ]] && grep -q "device token mismatch\|rotate/reissue" \
      "$NODE_STATE_DIR/node-host.log" 2>/dev/null; then
    echo "  Stale device token detected — clearing device auth and re-pairing..."
    STALE_TOKEN_DETECTED=1
    # Kill current node process and remove the stale device auth.
    kill "$node_pid" 2>/dev/null || true
    sleep 1
    rm -f "$DEVICE_AUTH"
    rm -f "$NODE_PID_FILE"
    # Restart with the shared gateway token to trigger a fresh pairing.
    node_pid=$(start_node "$GATEWAY_TOKEN")
    echo "$node_pid" > "$NODE_PID_FILE"
    echo "  Restarted with gateway token (PID $node_pid)."
    continue
  fi

  # Auto-approve any pending pairing requests.
  curl -sf -X POST "${API_URL}/internal/nodes/auto-pair" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${INTERNAL_TOKEN}" \
    -d '{}' \
    >/dev/null 2>&1 || true

  # Check if the node is now connected via the browser API.
  if [[ "$(is_browser_node_connected)" == "yes" ]]; then
    echo "Local browser node is connected. Browser automation will now use your residential IP."
    exit 0
  fi

  if [[ $attempt -lt 25 ]]; then
    echo "  Attempt $attempt/25 — waiting..."
  fi
done

echo
echo "Node pairing timed out. The node host is still running (PID $node_pid)."
echo "Check the log: tail -f $NODE_STATE_DIR/node-host.log"
echo "Or approve manually at http://localhost:3001/settings"
exit 1
