#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="infra/docker/.env"
COMPOSE_FILE="infra/docker/docker-compose.yml"
NODE_STATE_DIR=".openclaw-local"
NODE_PID_FILE=".openclaw-local/node-host.pid"
API_URL="http://localhost:3005"
INTERNAL_TOKEN="dev-internal-token"

mkdir -p "$(dirname "$ENV_FILE")"
touch "$ENV_FILE"

current_key="$(grep -E '^ANTHROPIC_API_KEY=' "$ENV_FILE" 2>/dev/null | head -n1 | cut -d= -f2- || true)"

if [[ -z "${current_key}" ]]; then
  echo "ANTHROPIC_API_KEY is not set in ${ENV_FILE}."
  echo "Paste your Anthropic key (starts with sk-ant-). It will be written to ${ENV_FILE}."
  echo "Tip: you can also set it later via Web UI: http://localhost:3001/settings"
  echo
  read -r -s -p "ANTHROPIC_API_KEY: " input_key
  echo
  if [[ -z "${input_key}" ]]; then
    echo "No key provided. Continuing without ANTHROPIC_API_KEY (agent calls will fail until set)."
  else
    if grep -qE '^ANTHROPIC_API_KEY=' "$ENV_FILE"; then
      perl -i -pe "s/^ANTHROPIC_API_KEY=.*/ANTHROPIC_API_KEY=$(printf '%s' "$input_key" | sed 's/[\\\\&]/\\\\&/g')/" "$ENV_FILE"
    else
      printf "\nANTHROPIC_API_KEY=%s\n" "$input_key" >> "$ENV_FILE"
    fi
    echo "Saved ANTHROPIC_API_KEY to ${ENV_FILE}."
  fi
fi

echo "Starting Docker services..."
docker compose -f "$COMPOSE_FILE" up -d --build

echo
echo "Up."
echo "Web UI:  http://localhost:3001"
echo "API:     http://localhost:3005"
echo "Vault:   http://localhost:3002"
echo "Memory:  http://localhost:3003"
echo "Email:   http://localhost:3004"

# ---------------------------------------------------------------------------
# Local browser node — runs on this machine so automation uses your residential
# IP. Quick-commerce sites (Blinkit/Zepto) block datacenter IPs; this fixes it.
# ---------------------------------------------------------------------------

start_local_node() {
  mkdir -p "$NODE_STATE_DIR"

  # Kill any stale node host from a previous run
  if [[ -f "$NODE_PID_FILE" ]]; then
    old_pid="$(cat "$NODE_PID_FILE" 2>/dev/null || true)"
    if [[ -n "$old_pid" ]] && kill -0 "$old_pid" 2>/dev/null; then
      echo "Stopping previous node host (PID $old_pid)..."
      kill "$old_pid" 2>/dev/null || true
      sleep 1
    fi
    rm -f "$NODE_PID_FILE"
  fi

  echo
  echo "Starting local browser node (residential IP for Blinkit/Zepto/Instamart)..."

  OPENCLAW_STATE_DIR="$NODE_STATE_DIR" \
  OPENCLAW_GATEWAY_TOKEN="dev-gateway-token" \
  node packages/openclaw-fork/openclaw.mjs node run \
    --host 127.0.0.1 \
    --port 18789 \
    --display-name "Local Browser Node" \
    >> "$NODE_STATE_DIR/node-host.log" 2>&1 &

  local node_pid=$!
  echo "$node_pid" > "$NODE_PID_FILE"
  echo "Node host started (PID $node_pid). Log: $NODE_STATE_DIR/node-host.log"
}

auto_approve_node() {
  echo "Waiting for node to connect and send pairing request..."
  local max_attempts=20
  local attempt=0
  local connected=0

  while [[ $attempt -lt $max_attempts ]]; do
    sleep 3
    attempt=$((attempt + 1))

    # Auto-approve any pending pairing requests (device or node flow)
    curl -sf -X POST "${API_URL}/internal/nodes/auto-pair" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer ${INTERNAL_TOKEN}" \
      -d '{}' \
      >/dev/null 2>&1 || true

    # Check if the node is now showing as connected via the OpenClaw CLI
    if OPENCLAW_STATE_DIR="$NODE_STATE_DIR" \
      OPENCLAW_GATEWAY_TOKEN="dev-gateway-token" \
      node packages/openclaw-fork/openclaw.mjs nodes status --json 2>/dev/null \
      | grep -qE '"connected"\s*:\s*true'; then
      echo "Local browser node is connected and ready."
      echo "Browser automation will now use your residential IP."
      connected=1
      break
    fi

    if [[ $attempt -lt $max_attempts ]]; then
      echo "  Attempt $attempt/$max_attempts — waiting..."
    fi
  done

  if [[ $connected -eq 0 ]]; then
    echo
    echo "Node pairing timed out. The node host is still running in the background."
    echo "Go to http://localhost:3001/settings -> 'Run Browser On Your Machine' -> approve manually."
    echo "Or run: pnpm node:start"
  fi
}

# Check if node binary is available (only works when called from repo root with node installed)
if command -v node >/dev/null 2>&1 && [[ -f "packages/openclaw-fork/openclaw.mjs" ]]; then
  # Wait for API to be ready before starting node setup
  echo
  echo "Waiting for API to be ready..."
  max_api_wait=30
  api_attempt=0
  while [[ $api_attempt -lt $max_api_wait ]]; do
    if curl -sf "${API_URL}/health" >/dev/null 2>&1; then
      break
    fi
    sleep 2
    api_attempt=$((api_attempt + 2))
  done

  start_local_node
  auto_approve_node &
  echo
  echo "Node pairing running in background. Check $NODE_STATE_DIR/node-host.log if needed."
else
  echo
  echo "Tip: Run 'pnpm node:start' separately to enable browser automation from your residential IP."
fi
