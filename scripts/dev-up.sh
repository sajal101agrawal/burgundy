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
    # Replace or append.
    if grep -qE '^ANTHROPIC_API_KEY=' "$ENV_FILE"; then
      perl -i -pe "s/^ANTHROPIC_API_KEY=.*/ANTHROPIC_API_KEY=$(printf '%s' "$input_key" | sed 's/[\\\\&]/\\\\&/g')/" "$ENV_FILE"
    else
      printf "\nANTHROPIC_API_KEY=%s\n" "$input_key" >> "$ENV_FILE"
    fi
    echo "Saved ANTHROPIC_API_KEY to ${ENV_FILE}."
  fi
fi

docker compose -f "$COMPOSE_FILE" up -d --build

echo
echo "Up."
echo "Web UI:  http://localhost:3001"
echo "API:     http://localhost:3005"
echo "Vault:   http://localhost:3002"
echo "Memory:  http://localhost:3003"
echo "Email:   http://localhost:3004"

