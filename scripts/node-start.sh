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

# Check if a node is already connected and healthy — skip startup if so
check_already_connected() {
  local resp
  resp=$(OPENCLAW_STATE_DIR="$NODE_STATE_DIR" \
    OPENCLAW_GATEWAY_TOKEN="$GATEWAY_TOKEN" \
    node packages/openclaw-fork/openclaw.mjs nodes status --json 2>/dev/null || echo '{}')
  # JSON output uses "connected": true (with space) from pretty-print
  echo "$resp" | grep -qE '"connected"\s*:\s*true' && echo "yes" || echo "no"
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

OPENCLAW_STATE_DIR="$NODE_STATE_DIR" \
OPENCLAW_GATEWAY_TOKEN="$GATEWAY_TOKEN" \
node packages/openclaw-fork/openclaw.mjs node run \
  --host "$GATEWAY_HOST" \
  --port "$GATEWAY_PORT" \
  --display-name "Local Browser Node" \
  >> "$NODE_STATE_DIR/node-host.log" 2>&1 &

node_pid=$!
echo "$node_pid" > "$NODE_PID_FILE"
echo "Node host started (PID $node_pid)."
echo

# Poll for connection — first wait for the node to trigger a pairing request,
# then approve it, then wait for a successful connection.
echo "Waiting for node to connect and auto-pairing if needed..."

for attempt in $(seq 1 20); do
  sleep 3

  # First try to auto-approve any pending pairing requests
  curl -sf -X POST "${API_URL}/internal/nodes/auto-pair" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${INTERNAL_TOKEN}" \
    -d '{}' \
    >/dev/null 2>&1 || true

  # Check if the node is now connected
  if OPENCLAW_STATE_DIR="$NODE_STATE_DIR" \
    OPENCLAW_GATEWAY_TOKEN="$GATEWAY_TOKEN" \
    node packages/openclaw-fork/openclaw.mjs nodes status --json 2>/dev/null \
    | grep -qE '"connected"\s*:\s*true'; then
    echo "Local browser node is connected. Browser automation will now use your residential IP."
    exit 0
  fi

  if [[ $attempt -lt 20 ]]; then
    echo "  Attempt $attempt/20 — waiting..."
  fi
done

echo
echo "Node pairing timed out. The node host is still running (PID $node_pid)."
echo "Check the log: tail -f $NODE_STATE_DIR/node-host.log"
echo "Or approve manually at http://localhost:3001/settings"
exit 1
