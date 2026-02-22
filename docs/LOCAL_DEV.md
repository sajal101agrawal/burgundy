# Local Development

## Prerequisites

- Docker Desktop (or compatible Docker engine)
- Node.js 22+
- `corepack` enabled (ships with Node 22)

Optional:

- A spare SIM + WhatsApp account for dev pairing (Baileys)
- An Anthropic API key (starts with `sk-ant-`) to run the agent loop

## Quick Start

```bash
corepack enable
pnpm install
pnpm dev:up
```

`pnpm dev:up` runs `./scripts/dev-up.sh` which:

- Ensures `infra/docker/.env` exists.
- Prompts for `ANTHROPIC_API_KEY` if missing and writes it to `infra/docker/.env`.
- Runs `docker compose -f infra/docker/docker-compose.yml up -d --build`.

## Local URLs

- Web UI: `http://localhost:3001`
- API: `http://localhost:3005`
- Vault service: `http://localhost:3002`
- Memory service: `http://localhost:3003`
- Email service: `http://localhost:3004`

## WhatsApp Pairing (Dev)

OpenClaw uses Baileys for dev WhatsApp connectivity.

### Pair In The Web UI (Recommended)

1. Open `http://localhost:3001/settings`
2. Login
3. Click **Generate QR** under “WhatsApp Pairing (Dev)”
4. On your phone: WhatsApp → Settings → Linked Devices → Link a device → scan the QR
5. Keep the Settings page open until it shows “WhatsApp linked.”
6. Click **Send test to me** to confirm outbound sends are working.

### Pair From The Terminal (Fallback)

You can still pair via CLI if needed:

```bash
docker compose -f infra/docker/docker-compose.yml exec -it openclaw node openclaw.mjs channels login whatsapp
```

Notes:

- Until pairing is done, outbound sends will fail with `no_active_listener`.
- This is dev-only. Baileys is not WhatsApp-official and may violate ToS; use WhatsApp Business API in production.

## Browser Automation (Dev)

The OpenClaw container includes `chromium` so the agent can browse sites and perform actions via Chrome CDP.

Notes:

- In Docker dev, the browser tool defaults to profile `"openclaw"` (the isolated, OpenClaw-managed headless Chromium).
- The `"chrome"` profile is the Chrome-extension relay (requires a real interactive Chrome + extension click-to-attach) and is not used by default in this stack.

### When Sites Block Server Automation (Cloudflare / 429)

For sites like Blinkit/Zepto that aggressively block datacenter IPs, run browser automation on your own machine:

1. Open `http://localhost:3001/settings`
2. Login
3. In “Run Browser On Your Machine (Node)”, run the node host command in your terminal
4. Approve the pending pairing request from the same page

Once connected, OpenClaw will auto-route browser automation to your machine via the Node browser proxy.

## Multi-User Dev Flow (Single Shared Inbox)

In dev, there is exactly one WhatsApp account linked to OpenClaw (the “platform inbox” number).

Each platform user:

- Registers in the Web UI (`/register`) with their WhatsApp phone number.
- Gets provisioned into OpenClaw as a dedicated `agentId=userId` (multi-agent config).
- Is allowlisted for inbound DMs.

After registration, the user should message the platform inbox number on WhatsApp and the router will dispatch to their agent.

## Anthropic API Key

There are two supported ways to set the key in dev:

1. `./scripts/dev-up.sh` prompt (recommended first run).
2. Web UI: `http://localhost:3001/settings` (login required).

What happens when you save the key from the Web UI:

- Writes `ANTHROPIC_API_KEY=...` into `infra/docker/.env`.
- Also writes an OpenClaw auth profile into the shared Docker volume so OpenClaw can pick it up without extra manual steps.

Tip: If you don’t set the key, the platform will try to ask for it over WhatsApp the first time it needs to run the agent.

## Database Migrations

In local dev, services run Drizzle migrations at startup:

- `apps/api`
- `apps/worker`
- `packages/vault-service`
- `packages/memory-service`

Migrations live in:

- `packages/shared/db/migrations/`

If you want to run migrations manually:

```bash
pnpm db:migrate
```

## Smoke Test

```bash
pnpm smoke
```

This runs:

- lint + typecheck + build
- docker compose up
- API health check (in-container)
- OpenClaw log sanity check (no missing plugin manifests)

## Simulating an Inbound WhatsApp Message (No Real WhatsApp Needed)

This is useful before pairing, to verify routing and pending-listeners.

```bash
FROM_NUMBER="+15550001111" BODY="hello concierge" ./scripts/send-whatsapp-webhook.sh
```

The script posts to `http://localhost:3005/webhook/whatsapp`.
