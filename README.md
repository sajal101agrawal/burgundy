# AI Concierge Platform

This repository scaffolds the AI Concierge Platform.

## Structure
- `apps/api`: Fastify API gateway
- `apps/worker`: BullMQ workers
- `apps/web`: Next.js 14 web UI
- `packages/openclaw-fork`: OpenClaw fork (git subtree)
- `packages/openclaw-extensions`: Custom OpenClaw skills
- `packages/strategy-engine`, `packages/interrupt-classifier`, `packages/proactive-messaging`: core intelligence services
- `packages/vault-service`, `packages/memory-service`, `packages/email-service`: internal services
- `packages/shared/*`: shared config, types, db schema, logger, queue names
- `infra/docker`: Dockerfiles and dev compose
- `docs/`: platform documentation (start with `docs/LOCAL_DEV.md`)

## Quick start (local)
1. Install deps: `corepack enable && pnpm install`
2. Start dev stack (prompts for `ANTHROPIC_API_KEY` if missing):

```bash
./scripts/dev-up.sh
```

### Local URLs
- Web UI: `http://localhost:3001`
- API: `http://localhost:3005`
- Vault service: `http://localhost:3002`
- Memory service: `http://localhost:3003`
- Email service: `http://localhost:3004`

### Web UI Guide

Start here:

- `docs/WEB_UI.md`

## Local webhook test
To simulate a WhatsApp inbound message:

```bash
DEV_USER_PHONE="+15551234567" docker compose -f infra/docker/docker-compose.yml up
```

Then in another shell:

```bash
FROM_NUMBER="+15551234567" BODY="hello concierge" ./scripts/send-whatsapp-webhook.sh
```

## WhatsApp Pairing (Dev)
OpenClaw uses Baileys for dev WhatsApp connectivity.

Recommended: pair from the Web UI:

- Open `http://localhost:3001/settings`
- Login
- Click **Generate QR** under “WhatsApp Pairing (Dev)” and scan it in WhatsApp → Linked Devices
- Click **Send test to me** to confirm outbound sends
- If pairing is flaky, click **Force relink** (hard-resets the cached auth dir and regenerates the QR)

Fallback: pair from the terminal:

```bash
docker compose -f infra/docker/docker-compose.yml exec -it openclaw node openclaw.mjs channels login whatsapp
```

Without pairing, outbound sends will fail with `no_active_listener`.

## Smoke Test

```bash
./scripts/smoke.sh
```

## Platform Docs

Start here:

- `docs/LOCAL_DEV.md`
- `docs/ARCHITECTURE.md`
- `docs/API.md`
