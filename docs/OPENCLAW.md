# OpenClaw Integration

---

## What OpenClaw Provides

OpenClaw is the agent runtime that powers the concierge:

- **Agent loop** — Claude-based (configurable model) multi-turn conversation with tool use
- **Browser automation** — Chrome CDP control (`browser` tool: start, open, snapshot, act, scroll, type, click, etc.)
- **Channel adapters** — WhatsApp (Baileys for dev), Telegram, Discord, Slack, and more
- **Session management** — per-agent conversation history, branching, compaction
- **Workspace files** — per-agent directory of persona/config files read at session start
- **Plugin system** — `before_prompt_build`, `before_tool_call`, `agent_end`, and other lifecycle hooks

---

## Fork Changes

This repo includes OpenClaw under `packages/openclaw-fork/` with minimal platform patches:

| Patch | Purpose |
|---|---|
| `OPENCLAW_WORKSPACE` env var | Overrides the workspace root directory (so all agents use `/workspace` in Docker) |
| Internal WhatsApp HTTP | Adds an HTTP inbound/outbound endpoint for pre-routed messages from the platform API |
| Pending listener hook | Calls `POST /internal/pending-listener/check` before routing a new message as a fresh task |
| Interrupt classifier hook | Calls `POST /internal/interrupt-classify` when a message arrives while a task is active |
| System prompt hook patch | Ensures `before_prompt_build` hook result is appended to (not replaced) the base system prompt |
| `OPENCLAW_NO_RESPAWN=1` | Forces in-process restarts on config reload (required in Docker — spawning a new PID exits the container) |

The fork is intentionally minimal. Upstream OpenClaw changes can be merged with low conflict risk.

---

## Platform Plugins (Skills)

Platform skills are loaded as OpenClaw plugins from `/app/extensions/*` in the OpenClaw container.

Each plugin provides:
- `package.json` with `openclaw.extensions` declaration
- `openclaw.plugin.json` for loader validation and enablement
- `src/index.ts` exporting a plugin object with `register(api)` callback

Plugins are hot-mounted via Docker volume bind in dev (no container rebuild needed for code changes to `src/`). The `dist/` directory must be built locally first.

### All Platform Plugins

#### `intent-router-skill`

Registers a `before_prompt_build` hook. Inspects the user's message and injects a detailed task-execution directive into the system prompt before the agent runs.

Intents handled:
- **Order/delivery** — provider reasoning, browser ordering flow, OTP login, confirm-before-pay
- **Presentation** — Gamma → Canva → Presentations.AI, temp-email registration, PPTX export + send
- **Email** — browser login, 2FA relay, inbox read
- **Photo/image** — stock_photo_send or browser AI image generation
- **Research** — Perplexity browser flow, 3-5 bullet summary with sources
- **Software/code** — scope-based: inline / bash tools / Claude Code CLI
- **File/document** — bash conversion tools or browser-based file tool
- **Generic catch-all** — fires for any action-oriented message not matched above: REASON → PLAN → IDENTIFY BLOCKERS → ACT → DELIVER

Source: `packages/openclaw-extensions/intent-router-skill/src/index.ts`

#### `vault-skill`

Encrypted credential storage. Tools exposed to the agent:

| Tool | Description |
|---|---|
| `vault_get` | Retrieve a stored secret by key |
| `vault_set` | Store an encrypted secret |
| `vault_list` | List all vault keys for the current user |
| `vault_share` | Share a vault entry with another user |

Calls `packages/vault-service` HTTP API. Scoped per-user via `userId` injected by `platform-userid-injector`.

Source: `packages/openclaw-extensions/vault-skill/src/index.ts`

#### `otp-relay-skill`

Pauses task execution and relays an OTP request to the user via WhatsApp.

Tool: `otp_request`

Flow:
1. Agent calls `otp_request` with a message to send the user
2. Skill calls `POST /internal/user-ask` on the platform API
3. User receives the WhatsApp message asking for the OTP
4. User replies — the pending listener resolves and returns the OTP to the agent
5. Agent fills the OTP in the browser and continues

Source: `packages/openclaw-extensions/otp-relay-skill/src/index.ts`

#### `stuck-handler-skill`

Tool: `stuck_escalate`

Used when browser automation is blocked (CAPTCHA, bot detection, manual step required). Sends a message to the user explaining the situation and waits for their reply before continuing.

Source: `packages/openclaw-extensions/stuck-handler-skill/src/index.ts`

#### `task-checkpoint-skill`

Long-running task state persistence.

| Tool | Description |
|---|---|
| `checkpoint_save` | Save current task state to Postgres via the platform API |
| `checkpoint_resume` | Retrieve the most recent saved checkpoint |

Source: `packages/openclaw-extensions/task-checkpoint-skill/src/index.ts`

#### `deck-skill`

Fallback PPTX generator when browser-based deck tools are unavailable.

Tool: `deck_send_pptx`

Generates a PPTX file locally from a slide plan, saves it to the agent workspace, then calls `media_send_url` (or directly sends via WhatsApp outbound) to deliver it as WhatsApp media.

Source: `packages/openclaw-extensions/deck-skill/src/index.ts`

#### `media-send-skill`

Real WhatsApp media delivery (not just links).

| Tool | Description |
|---|---|
| `media_send_url` | Download an image from a URL and send it as a WhatsApp photo/document |
| `stock_photo_send` | Search for and send a stock photo by keyword |

Source: `packages/openclaw-extensions/media-send-skill/src/index.ts`

#### `screenshot-send-skill`

Tool: `screenshot_send`

Captures a screenshot of the current browser tab and sends it to the user as a WhatsApp photo. Useful for showing the user what the agent sees when stuck.

Source: `packages/openclaw-extensions/screenshot-send-skill/src/index.ts`

#### `deployment-skill`

Tool: `deploy`

Dev-grade deployment workflow. Currently implements a Vercel deploy path. Requires explicit confirmation via `user.ask` before executing.

Source: `packages/openclaw-extensions/deployment-skill/src/index.ts`

#### `account-creator-skill`

Tool: `account_create`

Automated account creation flow:
1. Opens the target site in the browser
2. Fills registration form (using temp email or user-provided credentials)
3. Verifies email if needed
4. Saves credentials to the vault

Source: `packages/openclaw-extensions/account-creator-skill/src/index.ts`

#### `platform-userid-injector`

Registers a `before_tool_call` hook. Automatically injects the `userId` (from `ctx.agentId`) into platform tools that need it:

- `vault_get`, `vault_set`, `vault_list`, `vault_share`
- `otp_request`
- `stuck_escalate`
- `checkpoint_save`, `checkpoint_resume`
- `deploy`
- `account_create`

This means the agent never needs to know or pass a userId — it's injected transparently.

Source: `packages/openclaw-extensions/platform-userid-injector/src/index.ts`

---

## Agent Workspace Files

OpenClaw reads bootstrap files from the per-agent workspace at session start. For this platform:

```
/workspace/workspace-{agentId}/
├── SOUL.md      Agent identity (written by platform API on startup)
├── AGENTS.md    Workflow rules + per-task flows (written by platform API on startup)
├── USER.md      User phone number (written by platform API on startup)
├── TOOLS.md     Tool descriptions (OpenClaw-managed)
├── IDENTITY.md  Agent name/emoji (OpenClaw-managed)
├── HEARTBEAT.md Session heartbeat (OpenClaw-managed)
├── BOOTSTRAP.md First-run initialization guide (deleted after first session)
└── memory/      Daily session notes (agent-written)
```

### Writing Persona Files

The platform API writes `SOUL.md`, `AGENTS.md`, and `USER.md` via `writePersonaFilesForAgent()` in `apps/api/src/index.ts`.

Path resolution:
```
OPENCLAW_STATE_DIR = /openclaw-workspace/state   (API container)
workspace root     = /openclaw-workspace/         (parent of state dir)
agent workspace    = /openclaw-workspace/workspace-{agentId}/

Same volume in OpenClaw container:
                   = /workspace/workspace-{agentId}/
```

This is called at API startup for the dev user, and by the provisioning job for each newly registered user.

### SOUL.md Content

```markdown
# Concierge

You are Concierge — an autonomous operating assistant, NOT a chatbot.
Your job is to DO things for the user, not describe how to do them.
You act on the real web: you open browsers, log in, navigate, click, fill forms, and deliver results.
...
```

### AGENTS.md Content

Contains the full workflow ruleset:
- Core Loop (REASON → PLAN → ACT → DELIVER)
- Browser-First Strategy
- Credential Handling (email+password, phone+OTP, temp email)
- OTP Relay flow
- Temporary Email Registration flow
- Per-task workflows: ordering, presentation, research, file, email, image, software
- Confirmation required before irreversible actions
- Progress reporting expectations
- Red lines (no irreversible actions without confirmation)

---

## Dev Configuration

OpenClaw is launched in Docker with:

```
OPENCLAW_WORKSPACE=/workspace
OPENCLAW_STATE_DIR=/workspace/state
OPENCLAW_CONFIG_PATH=/workspace/state/openclaw.platform.json
OPENCLAW_NO_RESPAWN=1
```

Started with:
```bash
node openclaw.mjs gateway --port 18789 --bind lan
```

`--bind lan` ensures `ws://openclaw:18789` is reachable from other services on the Docker bridge network.

### Platform Config (`openclaw.platform.json`)

The platform writes and maintains this file at `/workspace/state/openclaw.platform.json`. Key sections:

```json
{
  "gateway": {
    "controlUi": {
      "allowInsecureAuth": true,
      "dangerouslyDisableDeviceAuth": true
    }
  },
  "browser": {
    "enabled": true,
    "headless": true,
    "noSandbox": true,
    "defaultProfile": "openclaw"
  },
  "agents": {
    "00000000-0000-0000-0000-000000000001": {
      "name": "Concierge",
      "bindings": [
        { "channel": "whatsapp", "peer": { "direct": { "id": "+15550001111" } } }
      ]
    }
  },
  "plugins": {
    "entries": {
      "whatsapp": { "enabled": true },
      "vault-skill": { "enabled": true },
      "otp-relay-skill": { "enabled": true },
      "intent-router-skill": { "enabled": true },
      "deck-skill": { "enabled": true }
    }
  }
}
```

### Internal WhatsApp HTTP

OpenClaw exposes two internal endpoints on port 18810:

| Endpoint | Method | Description |
|---|---|---|
| `/internal/whatsapp/inbound` | POST | Receive a pre-routed inbound message from the platform API |
| `/internal/whatsapp/send` | POST | Send an outbound WhatsApp message |

Port 18810 is used (not the default) to avoid colliding with the browser CDP port (18800).

Returns `503 no_active_listener` if WhatsApp is not paired.

---

## Browser Automation Notes

### Node Browser Proxy

The OpenClaw node browser proxy allows the agent to control a browser running on a separate machine (e.g., the developer's laptop).

```
OpenClaw agent
  ↓ browser tool (target="node")
  ↓ WebSocket to node host
Local node host process (openclaw.mjs node run)
  ↓ Chrome CDP
Browser on developer's machine
  ↓ HTTPS from residential IP
Target website
```

Auto-pairing via `POST /internal/nodes/auto-pair`:
- Calls `device.pair.list` and `node.pair.list` on the Gateway
- Approves all pending requests via `device.pair.approve` and `node.pair.approve`
- The node host uses the `device.pair.*` flow when it first connects

### Browser Timeouts

Set in `docker-compose.yml` to account for Chromium cold-start in Docker:

```
OPENCLAW_BROWSER_START_TIMEOUT_MS=120000
OPENCLAW_BROWSER_OPEN_TIMEOUT_MS=120000
OPENCLAW_BROWSER_CDP_READY_TIMEOUT_MS=60000
```

---

## Rebuilding Extensions

Extensions are mounted into the OpenClaw container via Docker volume binds in dev:

```yaml
volumes:
  - ../../packages/openclaw-extensions/intent-router-skill:/app/extensions/intent-router-skill:ro
  - ../../packages/openclaw-extensions/deck-skill:/app/extensions/deck-skill:ro
  # ... etc
```

For TypeScript source changes to take effect, build the extension:

```bash
pnpm --filter intent-router-skill build
```

No container restart needed — the volume bind picks up changes immediately.

For changes to `openclaw.plugin.json` or `package.json`, restart the OpenClaw container:

```bash
docker compose -f infra/docker/docker-compose.yml up -d --force-recreate openclaw
```
