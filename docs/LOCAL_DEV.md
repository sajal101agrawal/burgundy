# Local Development Guide

---

## Prerequisites

| Requirement | Notes |
|---|---|
| **Node.js 22+** | Required for `corepack` and running the OpenClaw CLI locally |
| **corepack** | `corepack enable` — manages the pnpm version declared in `package.json` |
| **Docker Desktop** | Or any compatible Docker engine with Compose v2 |
| **pnpm** | Installed via corepack, no manual install needed |
| **Anthropic API key** | `sk-ant-...` — required for the agent LLM. Set via `dev-up.sh` prompt or Web UI |
| **Spare WhatsApp number** | A second SIM/account for dev pairing (Baileys linked-device). Not the platform user's number. |

---

## Quick Start

```bash
corepack enable
pnpm install
./scripts/dev-up.sh
```

`dev-up.sh` does:
1. Creates `infra/docker/.env` if it doesn't exist
2. Prompts for `ANTHROPIC_API_KEY` if missing and saves it
3. Runs `docker compose up -d --build` — builds and starts all services
4. Waits for the API to be healthy (`GET /health`)
5. Starts the local browser node (residential IP) in the background
6. Auto-pairs the node by calling `/internal/nodes/auto-pair`

---

## Service URLs

| Service | Host URL | Notes |
|---|---|---|
| Web UI | http://localhost:3001 | Next.js frontend |
| API | http://localhost:3005 | Fastify gateway |
| Vault service | http://localhost:3002 | AES-256-GCM credential store |
| Memory service | http://localhost:3003 | Per-agent memory (Postgres + vector) |
| Email service | http://localhost:3004 | Inbound email receiver |
| OpenClaw Gateway | ws://localhost:18789 | WebSocket gateway |
| OpenClaw internal HTTP | http://localhost:18810 | Container-only (WhatsApp inbound/outbound) |
| Postgres | localhost:5433 | `postgres/postgres`, db `concierge` |
| Redis | localhost:6380 | BullMQ + pending listeners |

---

## First-Time Setup

After `dev-up.sh` completes:

### 1. Set the Anthropic API key

If you skipped the `dev-up.sh` prompt:
1. Open http://localhost:3001/settings
2. Login: phone = `DEV_USER_PHONE` from `infra/docker/.env` (default `+15550001111`), password = `dev-password`
3. Paste your `sk-ant-...` key and click Save

What happens when you save:
- Writes `ANTHROPIC_API_KEY=...` into `infra/docker/.env`
- Writes an OpenClaw auth profile into the shared Docker volume so the agent can use it immediately (no container restart needed)

### 2. Pair WhatsApp (recommended: Web UI)

1. Open http://localhost:3001/settings
2. Click **Generate QR** under "WhatsApp Pairing (Dev)"
3. On the phone that owns the WhatsApp account: WhatsApp → Settings → Linked Devices → Link a device → scan the QR
4. Keep the Settings page open until it shows "WhatsApp linked"
5. Click **Send test to me** to verify outbound messages work

Alternative (terminal):
```bash
docker compose -f infra/docker/docker-compose.yml exec -it openclaw node openclaw.mjs channels login whatsapp
```

Notes:
- The WhatsApp number you pair here is the **platform inbox** number — not the user's personal number
- All platform users message this inbox; the router dispatches to their individual agent
- Until pairing is done, outbound sends fail with `503 no_active_listener`
- Baileys is dev-only; do not scale to production with it

### 3. Verify the local browser node

`dev-up.sh` starts and auto-pairs the node automatically. Check in Settings under "Run Browser On Your Machine" — it should show as connected.

If it is not connected:
```bash
pnpm node:start
# or
./scripts/node-start.sh
```

---

## Browser Automation

### In-Container Browser (host target)

The OpenClaw Docker image includes Chromium. The agent uses it automatically when `browser target="host"` is used. It runs headless without X11.

Defaults set in the platform config:
- `browser.enabled = true`
- `browser.headless = true`
- `browser.noSandbox = true`
- `browser.defaultProfile = "openclaw"`

Verify Chromium is available:
```bash
docker compose -f infra/docker/docker-compose.yml exec -it openclaw sh -lc 'which chromium && chromium --version'
```

### Local Browser Node (node target)

When the agent uses `browser target="node"`, it routes through the local browser node proxy running on your machine. Traffic originates from your residential IP, bypassing Cloudflare/bot protection on quick-commerce sites.

#### Starting the node

```bash
pnpm node:start
```

Or manually (run from the repo root):
```bash
OPENCLAW_STATE_DIR=.openclaw-local \
OPENCLAW_GATEWAY_TOKEN=dev-gateway-token \
node packages/openclaw-fork/openclaw.mjs node run \
  --host 127.0.0.1 --port 18789 \
  --display-name "Local Browser Node"
```

The node PID and log are stored in `.openclaw-local/`:
- `.openclaw-local/node-host.pid`
- `.openclaw-local/node-host.log`

#### Auto-pairing

`node-start.sh` (and `dev-up.sh`) auto-pair the node:
1. Starts the node host process
2. Polls `POST /internal/nodes/auto-pair` to approve any pending `device.pair` or `node.pair` requests on the Gateway
3. Verifies connection via `nodes status --json`

If auto-pairing fails, you can approve manually in Settings → "Pending pairing requests".

---

## Multi-User Dev Flow

In dev, there is one WhatsApp inbox (the platform number you paired). Multiple users can register and message it.

Each user:
1. Registers via `POST /auth/register` or the web UI (`/register`)
2. Gets provisioned: OpenClaw agent binding + allowFrom entry + workspace files
3. Messages the platform inbox number
4. Gets routed to their personal agent (agentId = userId)

After registration, users get their own:
- OpenClaw workspace at `/workspace/workspace-{userId}/`
- Session history
- Memory files
- Vault namespace

---

## Anthropic API Key

Two ways to set it:

1. `./scripts/dev-up.sh` prompt (recommended for first run)
2. Web UI: http://localhost:3001/settings → Anthropic API Key section

The key is stored in `infra/docker/.env` and also written as an OpenClaw auth profile in the shared Docker volume. Changes take effect immediately without restarting containers.

If the key is not set, the platform tries to ask the user for it over WhatsApp on first agent invocation.

---

## Database Migrations

Migrations run automatically at service startup (Drizzle ORM). Services that run migrations:
- `apps/api`
- `apps/worker`
- `packages/vault-service`
- `packages/memory-service`

Migration files: `packages/shared/db/migrations/`

Run manually:
```bash
pnpm db:migrate
```

---

## Simulating an Inbound WhatsApp Message

Test the full message routing pipeline without real WhatsApp:

```bash
FROM_NUMBER="+15550001111" BODY="order me a coke" ./scripts/send-whatsapp-webhook.sh
```

Posts to `http://localhost:3005/webhook/whatsapp`. Works before WhatsApp is paired.

---

## Smoke Test

```bash
pnpm smoke
# or
./scripts/smoke.sh
```

Runs:
1. Lint + typecheck + build
2. `docker compose up`
3. API health check from inside the container
4. OpenClaw log sanity check (no missing plugin manifests)

---

## Rebuilding Individual Services

```bash
# Rebuild only the API (fast — no image rebuild needed if code is volume-mounted)
docker compose -f infra/docker/docker-compose.yml up -d --force-recreate api

# Rebuild the OpenClaw container (needed when changing extensions or the fork)
# Build extensions first (Dockerfile copies pre-built dist/)
pnpm --filter intent-router-skill build
pnpm --filter deck-skill build
docker compose -f infra/docker/docker-compose.yml up -d --build --force-recreate openclaw
```

Note: The `api` container mounts the repo directly (`../../:/app`) and builds on start, so code changes are picked up on container restart without a Docker image rebuild. The `openclaw` container copies files at build time, so it needs a full image rebuild.

---

## Useful Docker Commands

```bash
# See all service statuses
docker compose -f infra/docker/docker-compose.yml ps

# Tail logs for a service
docker logs docker-openclaw-1 -f
docker logs docker-api-1 -f

# Run a command inside a service
docker compose -f infra/docker/docker-compose.yml exec -it openclaw sh

# Hard reset (removes data volumes — WARNING: destroys all state)
docker compose -f infra/docker/docker-compose.yml down -v
```

---

## Environment Variables Reference

`infra/docker/.env` (user-provided):

| Variable | Default | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | (required) | Anthropic key for the agent |
| `DEV_USER_PHONE` | `+15550001111` | Dev user's WhatsApp number |
| `DEV_USER_ID` | `00000000-0000-0000-0000-000000000001` | Fixed UUID for dev user |
| `DEV_INSTANCE_ENDPOINT` | `http://openclaw:18810` | OpenClaw HTTP endpoint for this user |
| `OPENAI_API_KEY` | (optional) | Enables vector search in memory service |

Hard-coded in `docker-compose.yml` (dev only — change for production):

| Variable | Dev value |
|---|---|
| `PLATFORM_INTERNAL_TOKEN` | `dev-internal-token` |
| `JWT_SECRET` | `dev-secret` |
| `VAULT_MASTER_KEY` | `dev-master-key` |
| `OPENCLAW_GATEWAY_TOKEN` | `dev-gateway-token` |
