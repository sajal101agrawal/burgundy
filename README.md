# AI Concierge Platform

WhatsApp‑native, multi‑tenant AI concierge built on a lightly modified OpenClaw fork. Each user gets their own agent, tools, memory, email, and (dev) WhatsApp pairing.

## Capabilities (what’s implemented today)
- WhatsApp channel (Baileys) with internal HTTP ingress for routing
- Per‑user OpenClaw workspace + persona files (AGENTS/SOUL/USER)
- Proactive messaging primitive (`user.ask`) + pending listener registry (OTP, confirm, info)
- Vault service + vault skill (AES‑256‑GCM, per‑user key)
- OTP relay, stuck handler (temp browser link), checkpointing
- Strategy engine, interrupt classifier, tool registry (seed)
- Browser automation with node/host targets; media + screenshot send skills
- Intent router (orders, presentations, photos) with tool‑first directives
- Deck generator skill (`deck_send_pptx`) with WhatsApp media send
- Web UI: registration, settings (Anthropic key, WhatsApp pairing, node pairing), vault, tasks, audit

## Repository layout
- `apps/api` — Fastify API gateway & webhooks
- `apps/worker` — BullMQ workers (provision, send-whatsapp, tool discovery, audit, email actionability)
- `apps/web` — Next.js 14 Web UI
- `packages/openclaw-fork` — OpenClaw subtree with platform patches
- `packages/openclaw-extensions` — platform skills (vault, otp, stuck, checkpoint, deployment, account-creator, media, deck, intent-router, platform-userid injector, screenshot)
- `packages/strategy-engine`, `packages/interrupt-classifier`, `packages/proactive-messaging`, `packages/tool-registry`
- `packages/vault-service`, `packages/memory-service`, `packages/email-service`
- `packages/shared/*` — types, db, logger, queue, config
- `infra/docker` — dev Dockerfile/compose for API, worker, web, vault, memory, postgres, redis, openclaw agent
- `docs/` — operational guides (start with `docs/LOCAL_DEV.md`)

## Prereqs
- Node 22 (corepack enabled), Docker, pnpm
- Anthropic API key (set via Web UI or env `ANTHROPIC_API_KEY`)
- Spare WhatsApp number for dev pairing

## Quick start (dev stack)
```bash
corepack enable
pnpm install
./scripts/dev-up.sh   # builds images, runs docker compose, applies migrations
```

Local URLs
- Web UI: http://localhost:3001
- API: http://localhost:3005
- OpenClaw internal HTTP: http://localhost:18810 (container network)

First-time checklist
1) Open http://localhost:3001/settings
2) Set Anthropic API key
3) Generate WhatsApp QR and scan (Linked Devices) → send test
4) (Optional) Start an OpenClaw Node on your machine for browser tasks; approve the pending request in Settings

Smoke test
```bash
./scripts/smoke.sh
```

Troubleshooting (quick)
- WhatsApp “pairing required” → Settings → Force relink, then rescan
- Browser “blocked/bot” on quick‑commerce → run a Node on your laptop and select node target
- Missing migrations → `pnpm db:migrate` (runs inside worker/API on start, but run manually if needed)

Key docs
- docs/LOCAL_DEV.md — step‑by‑step dev setup & common issues
- docs/WEB_UI.md — how to pair WhatsApp/Node, set keys
- docs/ARCHITECTURE.md — end‑to‑end system design
- docs/API.md — API surfaces & webhooks
