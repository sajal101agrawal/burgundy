#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="infra/docker/.env"
COMPOSE_FILE="infra/docker/docker-compose.yml"

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
echo

# Ensure the gateway's internal agent device has the operator.write scope.
# This scope is required for the agent sandbox to execute browser tool commands.
# It is not granted by default during device pairing, so we patch it in after startup.
# The change is persisted to the Docker volume and survives container restarts.
echo "Patching agent device scopes..."
OPENCLAW_STATE="$(docker compose -f "$COMPOSE_FILE" exec openclaw printenv OPENCLAW_STATE_DIR 2>/dev/null | tr -d '\r' || echo '/workspace/state')"
docker compose -f "$COMPOSE_FILE" exec -T openclaw node -e "
  const fs = require('fs');
  const path = '${OPENCLAW_STATE}/devices/paired.json';
  try {
    const data = JSON.parse(fs.readFileSync(path, 'utf8'));
    let changed = 0;
    for (const [, dev] of Object.entries(data)) {
      const d = dev;
      if (d.clientMode === 'backend' && Array.isArray(d.scopes) && !d.scopes.includes('operator.write')) {
        d.scopes.push('operator.write');
        changed++;
      }
    }
    if (changed > 0) {
      fs.writeFileSync(path, JSON.stringify(data, null, 2));
      console.log('Added operator.write scope to ' + changed + ' agent device(s).');
    } else {
      console.log('Agent device scopes already up to date.');
    }
  } catch (e) {
    console.log('Scope patch skipped: ' + e.message);
  }
" 2>/dev/null || echo "Scope patch skipped (gateway not ready yet — will apply on next run)."
echo

# Reconnect the local browser node after the gateway restarts.
# The node process dies on gateway restart (ECONNRESET) and must be re-launched
# so browser tool calls route to the Mac's Chrome instead of the Docker Chromium.
echo "Reconnecting local browser node..."
pnpm node:start || echo "Warning: node start failed. Browser automation will fall back to Docker Chromium."
