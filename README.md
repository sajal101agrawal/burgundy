# AI Concierge Platform

WhatsApp-native, multi-tenant AI concierge platform. Each registered user gets their own autonomous agent that can browse the web, place orders, create documents, relay OTPs, and complete real-world tasks — all triggered from a WhatsApp message.

Built on a lightly modified [OpenClaw](https://openclaw.dev) fork, with a Fastify API gateway, BullMQ workers, Next.js web UI, Postgres, Redis, and a suite of platform skills.

---

## What It Does

The agent is not a chatbot. When you send it a message, it:

1. **Reasons** about what you actually need and the best way to accomplish it
2. **Plans** an approach (always prefers browser automation over answering inline)
3. **Acts** — opens a real browser, navigates sites, logs in, fills forms, clicks buttons
4. **Delivers** the result directly to you on WhatsApp (file, confirmation, summary)

### Example: "Order me a Coke"

- Agent reasons: Coke is a quick-commerce item → Blinkit or Zepto
- Opens Blinkit in a browser (or Zepto as fallback)
- Searches for Coke, adds to cart
- Logs in using your WhatsApp number as the phone number
- Sends OTP request: "Please send me the OTP you just received"
- You reply with the OTP on WhatsApp — agent fills it and continues
- Shows order summary and asks "Confirm? Coke from Blinkit — ₹45 — 12 min delivery"
- Places the order and confirms with order ID + ETA

### Example: "Make me a PPT on AI in Healthcare"

- Agent reasons: AI deck tools produce better slides → try Gamma first
- Opens gamma.app in a browser
- If sign-up is required and you have no account: opens temp-mail.org, copies a disposable address, registers with it, verifies email
- Creates a presentation with the given topic, waits for generation
- Downloads the PPTX
- Sends the file to you on WhatsApp as media

### Example: "Research the best electric cars under 20 lakhs in India"

- Opens perplexity.ai in the browser
- Runs the query, reads the full sourced answer
- Sends a concise 4-5 bullet summary with sources

This pattern — reason → browser → credentials/OTP/temp-email as needed → deliver — applies to all tasks: ordering, email, code, file conversion, image generation, and anything else a user might ask.

---

## Capabilities

| Category | What's implemented |
|---|---|
| Channel | WhatsApp (Baileys dev adapter), internal HTTP ingress |
| Agent runtime | OpenClaw fork — agent loop, tool calling, session management, browser CDP |
| Browser automation | Headless Chromium in-container; Node browser proxy for residential IP |
| Ordering / quick-commerce | Browser-first ordering on Blinkit, Zepto, Instamart, Swiggy, Zomato, Amazon |
| Presentations | Browser-driven deck generation on Gamma, Canva, Presentations.AI; PPTX send |
| Email | Browser-based Gmail/Outlook login, 2FA relay, inbox read |
| Research | Perplexity-driven sourced research summaries |
| OTP relay | `otp_request` tool pauses task, asks user via WhatsApp, resumes on reply |
| Temp email registration | Agent opens temp-mail.org, gets disposable address, registers on target site |
| Credential collection | Asks user for email+password at point of need; never stores in plain text in replies |
| Vault | AES-256-GCM per-user encrypted credential store; `vault_get`/`vault_set`/`vault_list` |
| Media | Downloads and sends images as real WhatsApp media (`media_send_url`, `stock_photo_send`) |
| Screenshots | Browser snapshot → WhatsApp photo send |
| Deck generator | `deck_send_pptx` fallback skill generates PPTX locally and sends via WhatsApp |
| Proactive messaging | `user.ask` — suspends task execution, sends user a WhatsApp question, resumes on reply |
| Interrupt classification | Classifies new messages as SUPERSEDE / MODIFY / ADDITIVE / UNRELATED vs active task |
| Checkpointing | `checkpoint_save` / `checkpoint_resume` for long-running multi-step tasks |
| Deployment | `deploy` skill (dev-grade Vercel path, confirmation required) |
| Account creation | `account_create` — browser-driven account creation + vault save |
| Memory | Per-agent daily notes + long-term `MEMORY.md` in workspace |
| Multi-user | Each registered user gets their own OpenClaw agent (agentId = userId) |
| Web UI | Registration, login, settings (API key, WhatsApp QR, Node pairing), vault viewer, tasks, audit |

---

## Repository Layout

```
.
├── apps/
│   ├── api/           Fastify API gateway: auth, webhooks, internal endpoints for OpenClaw + workers
│   ├── worker/        BullMQ workers: provisioning, outbound WhatsApp, tool discovery, audit, email
│   └── web/           Next.js 14 web UI: registration, settings, dashboard, vault, tasks
│
├── packages/
│   ├── openclaw-fork/              OpenClaw subtree with platform patches (workspace path, internal HTTP)
│   ├── openclaw-extensions/        Platform skills (OpenClaw plugins)
│   │   ├── intent-router-skill/    Injects per-message task directives into the system prompt
│   │   ├── vault-skill/            vault_get, vault_set, vault_list, vault_share
│   │   ├── otp-relay-skill/        otp_request — pause task, relay OTP via WhatsApp
│   │   ├── stuck-handler-skill/    stuck_escalate — escalate blocked tasks to user
│   │   ├── task-checkpoint-skill/  checkpoint_save, checkpoint_resume
│   │   ├── deck-skill/             deck_send_pptx — local PPTX generation + WhatsApp send
│   │   ├── media-send-skill/       media_send_url, stock_photo_send — real WhatsApp media
│   │   ├── screenshot-send-skill/  Browser screenshot → WhatsApp photo
│   │   ├── deployment-skill/       deploy (dev-grade, Vercel)
│   │   ├── account-creator-skill/  account_create — browser + vault
│   │   └── platform-userid-injector/ Injects agentId=userId into platform tools
│   │
│   ├── strategy-engine/        Task strategy planner (dev)
│   ├── interrupt-classifier/   SUPERSEDE/MODIFY/ADDITIVE/UNRELATED classification
│   ├── proactive-messaging/    user.ask primitive — Redis-backed pending listener
│   ├── tool-registry/          Tool discovery and registration (seed)
│   ├── vault-service/          AES-256-GCM credential storage (Postgres)
│   ├── memory-service/         Per-agent memory in Postgres (text + vector search)
│   ├── email-service/          Inbound email → actionability classification
│   ├── provisioning-service/   New-user provisioning flow
│   └── shared/
│       ├── db/                 Drizzle ORM schema + migrations (Postgres)
│       ├── types/              Shared TypeScript types
│       ├── logger/             Pino logger wrapper
│       ├── queue/              BullMQ queue definitions
│       └── config/             Shared config helpers
│
├── infra/
│   ├── docker/
│   │   ├── docker-compose.yml          Dev stack (all services)
│   │   └── openclaw-agent/Dockerfile   OpenClaw container (Node 22 + Chromium)
│   ├── k8s/                    Kubernetes manifests (production)
│   └── terraform/              Infrastructure as code (production)
│
├── scripts/
│   ├── dev-up.sh           Bring up the full dev stack + auto-start local browser node
│   ├── node-start.sh       Start / restart the local browser node (auto-pairing)
│   ├── smoke.sh            Lint + typecheck + build + compose health check
│   └── send-whatsapp-webhook.sh  Simulate an inbound WhatsApp message (no real WhatsApp needed)
│
└── docs/                   All operational documentation
```

---

## Prerequisites

- **Node.js 22+** with `corepack` enabled
- **Docker Desktop** (or compatible Docker engine)
- **pnpm** (managed via corepack)
- **Anthropic API key** (`sk-ant-...`) — set during `dev-up.sh` prompt or via Web UI
- **A spare WhatsApp number** for dev pairing (Baileys linked-device; not the platform user's number)

---

## Quick Start

```bash
corepack enable
pnpm install
./scripts/dev-up.sh
```

`dev-up.sh` does the following:
1. Prompts for `ANTHROPIC_API_KEY` if not set, writes to `infra/docker/.env`
2. Runs `docker compose up -d --build` (builds all images, starts all services)
3. Waits for the API to be healthy
4. Automatically starts the local browser node (residential IP) and auto-pairs it

### Service URLs (after `dev-up.sh`)

| Service | URL |
|---|---|
| Web UI | http://localhost:3001 |
| API | http://localhost:3005 |
| Vault service | http://localhost:3002 |
| Memory service | http://localhost:3003 |
| Email service | http://localhost:3004 |
| OpenClaw Gateway WebSocket | ws://localhost:18789 |
| OpenClaw internal HTTP | http://localhost:18810 (container-only) |
| Postgres | localhost:5433 |
| Redis | localhost:6380 |

---

## First-Time Setup

After `dev-up.sh` starts everything:

1. Open http://localhost:3001/settings
2. Login — default credentials:
   - Phone: value of `DEV_USER_PHONE` in `infra/docker/.env` (or `+15550001111`)
   - Password: `dev-password`
3. If `ANTHROPIC_API_KEY` was not set in `dev-up.sh`, paste it in Settings and save
4. Click **Generate QR** under "WhatsApp Pairing":
   - On your phone: WhatsApp → Settings → Linked Devices → Link a device → scan the QR
   - Wait until Settings shows "WhatsApp linked"
   - Click **Send test to me** to verify outbound messages work
5. The local browser node is started automatically by `dev-up.sh`. Verify it is connected in Settings under "Run Browser On Your Machine". If it is not connected, run:
   ```bash
   pnpm node:start
   ```

---

## Agent Behavior Design

### Core Loop

Every task follows: **REASON → PLAN → ACT → DELIVER**

```
REASON  — What does the user actually need? What service/site can do it?
PLAN    — What is the best approach? (browser-first, then API, then inline)
ACT     — Execute with tools. Report each major step briefly as you go.
DELIVER — Send the result directly: file, confirmation, or summary.
```

### Browser-First Strategy

- Always attempts `browser target="node"` first — runs on the developer's machine using a residential IP (bypasses Cloudflare / bot detection on quick-commerce sites)
- Falls back to `browser target="host"` — headless Chromium inside the Docker container
- Never claims a site is blocked without actually opening it and taking a snapshot

### Credential Handling

| Login type | Agent behavior |
|---|---|
| Email + password | Asks "What email and password should I use for [site]?" at the moment of need |
| Phone + OTP | Uses user's WhatsApp number automatically; calls `otp_request` when OTP is sent |
| New account needed | Registers using a temp email from temp-mail.org |

### OTP Relay Flow

1. Agent hits an OTP screen in the browser
2. Calls `otp_request` tool → user receives a WhatsApp message asking for the OTP
3. Agent suspends the browser session
4. User replies with the OTP on WhatsApp
5. Agent fills the OTP in the browser and continues

### Temporary Email Registration

When a site requires an account and the user has none:
1. Agent opens temp-mail.org in the browser to get a disposable address
2. Registers on the target site with that address
3. Returns to temp-mail.org inbox to click the verification link
4. Proceeds with the task using the new account

### Per-Task Flows (via Intent Router)

The `intent-router-skill` intercepts each message and injects a detailed flow directive into the system prompt before the agent runs:

| Intent | Trigger keywords | Directive injected |
|---|---|---|
| Order / delivery | order, buy, purchase, get me, deliver | Full ordering flow with provider reasoning, OTP login, confirm-before-pay |
| Presentation | ppt, deck, slides, powerpoint | Gamma → Canva → Presentations.AI; temp-email registration; PPTX send |
| Email | email, inbox, gmail, outlook | Browser login, 2FA relay, inbox list |
| Photo / image | photo, image, pic + send/give/share | stock_photo_send or AI generation |
| Research | research, find out, what is, compare | Perplexity browser flow + summary |
| Software / code | code, script, build app, debug, deploy | Scope-based approach: inline / bash / Claude Code CLI |
| File / document | convert, create doc/pdf/excel, download | Bash tools or web tool browser flow |
| Generic task | Any action verb not matched above | Universal REASON → PLAN → IDENTIFY BLOCKERS → ACT → DELIVER |

### Agent Persona Files

Each agent's workspace at `/workspace/workspace-{agentId}/` contains:

| File | Content |
|---|---|
| `SOUL.md` | Concierge identity — "autonomous operating assistant, not a chatbot" |
| `AGENTS.md` | Full workflow rules: core loop, browser-first, credential handling, OTP relay, temp email, per-task workflows, red lines |
| `USER.md` | User's phone number |

These files are written by the API on startup via `writePersonaFilesForAgent`, which resolves the correct workspace path as `{openclaw-workspace-root}/workspace-{agentId}/`.

---

## Local Browser Node (Residential IP)

Quick-commerce sites like Blinkit and Zepto aggressively block datacenter IPs. Running browser automation on your own machine fixes this.

### Automatic (recommended)

`dev-up.sh` starts and auto-pairs the node automatically. If you need to restart it:

```bash
pnpm node:start
# or
./scripts/node-start.sh
```

### Manual command

```bash
OPENCLAW_STATE_DIR=.openclaw-local \
OPENCLAW_GATEWAY_TOKEN=dev-gateway-token \
node packages/openclaw-fork/openclaw.mjs node run \
  --host 127.0.0.1 --port 18789 \
  --display-name "Local Browser Node"
```

Then go to http://localhost:3001/settings and approve the pending pairing request, or run `pnpm node:start` which auto-approves it.

### How auto-pairing works

1. `node-start.sh` starts the node host in the background
2. Polls the `/internal/nodes/auto-pair` API endpoint which calls both `device.pair.approve` and `node.pair.approve` on the OpenClaw Gateway for any pending requests
3. Checks `nodes status --json` for a successful connection
4. Completes in ~10-15 seconds with no manual intervention

---

## Development Workflows

### Rebuild a specific service

```bash
docker compose -f infra/docker/docker-compose.yml up -d --build --force-recreate api
docker compose -f infra/docker/docker-compose.yml up -d --build --force-recreate openclaw
```

Note: When rebuilding the `openclaw` container, the `intent-router-skill` and other extensions must be built locally first since the Dockerfile copies their pre-built `dist/` directories:

```bash
pnpm --filter intent-router-skill build
docker compose -f infra/docker/docker-compose.yml up -d --build --force-recreate openclaw
```

### Simulate an inbound WhatsApp message

```bash
FROM_NUMBER="+15550001111" BODY="order me a coke" ./scripts/send-whatsapp-webhook.sh
```

### Run the smoke test

```bash
pnpm smoke
# or
./scripts/smoke.sh
```

### Database migrations

Migrations run automatically on service startup. To run manually:

```bash
pnpm db:migrate
```

### Typecheck all packages

```bash
pnpm typecheck
```

---

## Key Environment Variables

Set in `infra/docker/.env` (created by `dev-up.sh`):

| Variable | Default | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | (required) | Anthropic API key for the agent LLM |
| `DEV_USER_PHONE` | `+15550001111` | The dev user's WhatsApp phone number |
| `DEV_USER_ID` | `00000000-0000-0000-0000-000000000001` | Fixed UUID for the dev user |
| `DEV_INSTANCE_ENDPOINT` | `http://openclaw:18810` | OpenClaw internal HTTP URL for this user |

Hard-coded in docker-compose.yml (dev only):

| Variable | Value | Description |
|---|---|---|
| `PLATFORM_INTERNAL_TOKEN` | `dev-internal-token` | Token for internal API endpoints |
| `JWT_SECRET` | `dev-secret` | JWT signing secret |
| `VAULT_MASTER_KEY` | `dev-master-key` | Vault encryption root key |
| `OPENCLAW_GATEWAY_TOKEN` | `dev-gateway-token` | Gateway auth token |

---

## Troubleshooting (Quick Reference)

| Symptom | Fix |
|---|---|
| Agent doesn't reason/plan, just acts immediately | Persona files may be stale. Restart the API to rewrite SOUL.md/AGENTS.md |
| WhatsApp "pairing required" | Settings → Force relink → rescan QR |
| `no_active_listener` on outbound | WhatsApp not paired. See Settings → Generate QR |
| Browser blocks on Blinkit/Zepto (Cloudflare) | Run `pnpm node:start` to use residential IP |
| Node pairing not auto-approved | Run `pnpm node:start` which forces auto-pair |
| `plugin manifest not found` in OpenClaw logs | Rebuild the openclaw container |
| API can't access DB | Check postgres is running; run `pnpm db:migrate` |
| Agent can't run (model errors) | Set/update `ANTHROPIC_API_KEY` in Settings |

Full troubleshooting guide: `docs/TROUBLESHOOTING.md`

---

## Documentation

| Doc | Contents |
|---|---|
| `docs/LOCAL_DEV.md` | Step-by-step local setup, WhatsApp pairing, browser node, simulating messages |
| `docs/ARCHITECTURE.md` | End-to-end system design: services, message flow, multi-agent setup, agent behavior |
| `docs/OPENCLAW.md` | OpenClaw fork details, platform patches, all plugin skills |
| `docs/API.md` | All API endpoints (public, JWT-protected, internal) |
| `docs/WEB_UI.md` | Web UI pages and settings walkthrough |
| `docs/TROUBLESHOOTING.md` | Common failure modes and fixes |
| `docs/SECURITY.md` | Security model, vault encryption, dev-only bypasses |
