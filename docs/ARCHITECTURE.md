# Architecture

This repo implements a dev-grade AI Concierge Platform built on top of OpenClaw.

- **OpenClaw** provides: agent loop, browser automation, channel adapters (WhatsApp/Baileys), session management, tool execution, workspace/persona file management.
- **The platform** adds: SaaS primitives (registration/login/provisioning), multi-user routing, task + listener state, vault service, intent routing, and per-task autonomous execution flows.

---

## Services

Docker Compose services (`infra/docker/docker-compose.yml`):

| Service | Port (host) | Role |
|---|---|---|
| `web` (Next.js) | 3001 | Web UI: registration, login, settings, dashboard, vault, tasks, audit |
| `api` (Fastify) | 3005 | HTTP gateway: auth, WhatsApp webhook receiver, internal endpoints |
| `worker` (BullMQ) | — | Async jobs: provisioning, outbound WhatsApp, tool discovery, audit, email |
| `vault` (Fastify) | 3002 | AES-256-GCM credential storage in Postgres |
| `memory` (Fastify) | 3003 | Per-agent memory in Postgres (text + vector search) |
| `email` (Fastify) | 3004 | Inbound email receiver → actionability classification queue |
| `openclaw` (OpenClaw gateway) | 18789 (WS), 18810 (HTTP) | Agent runtime, WhatsApp adapter, browser automation |
| `postgres` (pgvector) | 5433 | Primary DB: users, tasks, vault, memory, audit, tool registry |
| `redis` | 6380 | BullMQ backend + pending listener (user.ask) coordination |

All services share a `openclaw-workspace` Docker volume (mounted at `/openclaw-workspace` in `api`, `/workspace` in `openclaw`).

---

## Message Flow (WhatsApp Inbound)

```
User sends WhatsApp message
        │
        ▼
OpenClaw (Baileys adapter)
  receives inbound DM from +E164
        │
        ▼
POST http://api:3000/internal/whatsapp/inbound
  { from: "+E164", body: "text" }
  (OpenClaw's internal WhatsApp HTTP adapter calls this via OPENCLAW_WHATSAPP_INBOUND_PATH)
        │
        ▼
API: POST /webhook/whatsapp
  1. Look up userId by phone
  2. Pending listener check (Redis):
     - If an active user.ask is waiting → dispatch reply to the coroutine, stop here
  3. Interrupt classification:
     - If a task is active → classify as SUPERSEDE / MODIFY / ADDITIVE / UNRELATED
  4. Forward to OpenClaw inbound endpoint:
     POST openclaw:18810/internal/whatsapp/inbound
     { from, body, agentId=userId }
        │
        ▼
OpenClaw routes to agent (agentId=userId)
  - Loads workspace files: AGENTS.md, SOUL.md, USER.md, memory files
  - Runs before_prompt_build hooks (intent-router-skill injects directive)
  - Runs the agent loop (Claude claude-opus-4-6 by default)
  - Agent uses tools: browser, vault_get, otp_request, stuck_escalate, etc.
        │
        ▼
Agent sends reply
  - OpenClaw outbound → POST api:3000/internal/message/send
  - API → POST openclaw:18810/internal/whatsapp/send
  - User receives WhatsApp message
```

---

## Agent Behavior Design

### Core Loop: REASON → PLAN → ACT → DELIVER

Every task follows this loop before any execution:

```
REASON  — What does the user need? What service/site/tool can accomplish it?
PLAN    — What is the best approach? (Always prefer browser automation)
ACT     — Execute with tools. Report each major step with a one-line update.
DELIVER — Send result directly to WhatsApp (file, confirmation, summary).
```

This is encoded in `AGENTS.md` written to each agent's workspace, and reinforced by per-message directives from the intent router.

### Browser-First Strategy

```
1. browser target="node"  — runs on the developer's machine via the Node browser proxy
                            Uses a residential IP. Best for sites that block datacenter IPs.
2. browser target="host"  — runs in the Docker container (headless Chromium)
                            Falls back when node is unavailable or times out.
```

Never claims a site is blocked without actually opening it and taking a snapshot.

### Credential Handling

| Login type | Behavior |
|---|---|
| Email + password | Asks the user for credentials at the moment of need: "What email and password should I use for [site]?" |
| Phone + OTP | Uses the user's WhatsApp number as the phone number. Calls `otp_request` when OTP is needed. |
| New account | Registers with a disposable email from temp-mail.org (browser automation). |

### OTP Relay

1. Agent reaches an OTP screen during a browser task
2. Calls `otp_request` tool — the user gets a WhatsApp message: "Please send me the OTP you received"
3. Agent suspends execution via Redis `user.ask` pending listener
4. User replies with the OTP on WhatsApp
5. `POST /webhook/whatsapp` routes the reply to the waiting coroutine
6. Agent fills the OTP in the browser and continues

### Temporary Email Registration

When a task requires an account on a new service:
1. Agent opens temp-mail.org in the browser
2. Copies the disposable email address
3. Navigates to the target site and registers with that address
4. Returns to temp-mail.org to click the verification link
5. Proceeds with the task using the newly created account

---

## Intent Router: Per-Message Directive Injection

The `intent-router-skill` registers a `before_prompt_build` hook in OpenClaw. Before each agent run it:

1. Inspects the user's message for intent keywords
2. Selects the appropriate directive(s)
3. Appends them to the system prompt (without replacing the base system prompt)

| Intent | Detection | Directive injected |
|---|---|---|
| `order` | order, buy, purchase, get me, deliver | Provider reasoning + ordering flow + OTP login + confirm-before-pay |
| `presentation` | ppt, deck, slides, powerpoint | Gamma→Canva→Presentations.AI; temp-email registration; PPTX export + send |
| `email` | email, inbox, gmail, outlook | Browser login + 2FA relay + inbox read |
| `photo` | photo, image + send/give/share | stock_photo_send or browser-based AI image generation |
| `research` | research, find out, what is, compare | Perplexity browser flow + 3-5 bullet summary with sources |
| `software` | code, script, build app, debug, deploy | Scope-based: inline / bash / Claude Code CLI |
| `file` | convert, create doc/pdf/excel | Bash tools or browser-based file tool |
| `generic` (catch-all) | Any action verb not matched above | Universal REASON → PLAN → BLOCKERS → ACT → DELIVER |

---

## Agent Workspace Files

OpenClaw reads "bootstrap files" from the per-agent workspace directory at startup of each session:

```
/workspace/workspace-{agentId}/
├── AGENTS.md      Full workflow rules and per-task flows (written by platform API)
├── SOUL.md        Agent identity: "autonomous operating assistant, not a chatbot" (written by API)
├── USER.md        User's phone number (written by API)
├── TOOLS.md       Available tool descriptions (OpenClaw-generated)
├── IDENTITY.md    Agent name/emoji (OpenClaw-managed)
├── HEARTBEAT.md   Session heartbeat (OpenClaw-managed)
├── BOOTSTRAP.md   First-run initialization (deleted after first session)
└── memory/        Daily session notes (agent-written)
    └── YYYY-MM-DD.md
```

The platform API (`writePersonaFilesForAgent`) writes `SOUL.md`, `AGENTS.md`, and `USER.md` at API startup into the correct workspace path. The workspace root is resolved as the parent directory of `OPENCLAW_STATE_DIR`:

```
OPENCLAW_STATE_DIR = /openclaw-workspace/state   (in API container)
workspace root     = /openclaw-workspace/          (parent)
agent workspace    = /openclaw-workspace/workspace-{agentId}/
```

This is the same Docker volume mounted at `/workspace` in the OpenClaw container.

---

## OpenClaw Multi-Agent Setup

Dev uses a single OpenClaw gateway runtime with multiple agents:

- `agentId = userId` (UUID) for each registered user
- OpenClaw `bindings[]` in `openclaw.platform.json` map `(channel=whatsapp, peer.direct.id=+E164)` → `agentId`
- WhatsApp inbound DMs are allowlisted via the OpenClaw allowFrom store
- Each agent has its own workspace directory, session history, and memory

Provisioning flow (triggered by `POST /auth/register`):
1. Worker runs the provisioning job
2. Calls OpenClaw's internal API to create the agent binding and allowFrom entry
3. API writes `SOUL.md`, `AGENTS.md`, `USER.md` to the agent's workspace

---

## Proactive Messaging (`user.ask`)

`user.ask` is the suspend-and-wait primitive. Used by: OTP relay, order confirmation, missing-info requests.

```
agent calls otp_request / stuck_escalate
        │
        ▼
Platform sends WhatsApp message to user
Creates Redis pending listener key (userId → {type, resolve})
        │
        ▼ (agent execution suspended)
User replies on WhatsApp
        │
        ▼
POST /webhook/whatsapp
  pending listener check → routes reply to waiting coroutine
        │
        ▼
Agent resumes with the user's reply
```

---

## Local Browser Node (Residential IP)

The OpenClaw container runs headless Chromium but originates from a datacenter IP. Quick-commerce sites block this.

The browser node proxy runs on the developer's machine and forwards browser automation commands from OpenClaw to a real browser on the local network. Traffic originates from the residential IP.

```
OpenClaw agent
  browser tool (target="node")
        │
        ▼  WebSocket
Local browser node process
  (openclaw.mjs node run)
        │
        ▼  Chrome CDP
Browser on developer's machine
        │
        ▼  HTTPS from residential IP
Blinkit / Zepto / Instamart
```

Auto-pairing flow (in `dev-up.sh` and `node-start.sh`):
1. Start node host process in background
2. Poll `POST /internal/nodes/auto-pair` — approves pending device.pair and node.pair requests on the Gateway
3. Check `nodes status --json` for `"connected": true`
4. Complete in ~10-15 seconds

---

## Vault Service

`packages/vault-service` stores encrypted credentials in Postgres.

- Each entry is encrypted with AES-256-GCM
- Dev: `VAULT_MASTER_KEY=dev-master-key` (replace with AWS KMS in production)
- Tools: `vault_get`, `vault_set`, `vault_list`, `vault_share`
- The `vault-skill` plugin calls the vault service HTTP API from inside OpenClaw

---

## Security Model (Dev)

| Control | Dev setting | Production recommendation |
|---|---|---|
| Internal API auth | `PLATFORM_INTERNAL_TOKEN=dev-internal-token` | Rotate; use mTLS or Vault-issued tokens |
| JWT secret | `JWT_SECRET=dev-secret` | 256-bit random secret |
| Vault master key | `VAULT_MASTER_KEY=dev-master-key` | AWS KMS or equivalent HSM |
| OpenClaw Gateway token | `OPENCLAW_GATEWAY_TOKEN=dev-gateway-token` | Rotate per deployment |
| Control UI auth | `dangerouslyDisableDeviceAuth=true` | Remove; use proper device pairing |
| WhatsApp adapter | Baileys (linked-device, ToS risk) | WhatsApp Business API |
