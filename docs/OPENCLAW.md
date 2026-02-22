# OpenClaw Integration Notes

## What We Changed in the Fork

This repo includes OpenClaw under `packages/openclaw-fork/` with minimal “platform hooks”:

- Config injection from `OPENCLAW_CONFIG_JSON`
- Workspace root override via `OPENCLAW_WORKSPACE`
- Internal WhatsApp HTTP endpoint for pre-routed inbound and outbound messages
- Platform hooks that call back into the platform API:
  - pending listener check
  - interrupt classification

The platform relies on OpenClaw’s:

- agent loop and tool calling
- WhatsApp adapter (dev: Baileys)
- browser automation (Chrome CDP)
- session management + workspace files

## Platform Plugins (Skills)

Platform plugins live here:

- `packages/openclaw-extensions/*`

They are copied into the OpenClaw container at:

- `/app/extensions/*`

Each plugin includes:

- `package.json` with `openclaw.extensions`
- `openclaw.plugin.json` for loader validation

Current platform plugins (dev):

- `vault-skill`: encrypted credential read/write via `vault-service`
- `otp-relay-skill`: pause task + ask user for OTP (via `user.ask`)
- `stuck-handler-skill`: escalate with assist flow when browser automation is blocked
- `account-creator-skill`: create accounts via browser automation + save credentials
- `task-checkpoint-skill`: task checkpoint primitives
- `deployment-skill`: deployment workflows (placeholder/dev-grade)
- `screenshot-send-skill`: capture + send screenshots via WhatsApp
- `media-send-skill`: download + send remote images as real WhatsApp media (`media_send_url`, `stock_photo_send`)

## Dev Config Strategy

In Docker dev, OpenClaw is launched with:

- `OPENCLAW_STATE_DIR=/workspace/state`
- `OPENCLAW_CONFIG_PATH=/workspace/state/openclaw.platform.json`
- `OPENCLAW_NO_RESPAWN=1` (in-process restarts; required in Docker)
- `openclaw.mjs gateway --bind lan` (so the API can reach the Gateway WS)

Why:

- OpenClaw is file-config-first in dev (the platform patches `openclaw.platform.json` at runtime during provisioning).
- `OPENCLAW_NO_RESPAWN=1` prevents a config reload from spawning a new PID and exiting (which would stop the Docker container).
- `--bind lan` ensures `ws://openclaw:18789` is reachable from other services.

## Browser Automation In Docker

The OpenClaw container image installs `chromium` so the built-in browser/CDP tool can browse websites and perform actions.

Dev defaults:

- `browser.enabled=true`
- `browser.headless=true`
- `browser.noSandbox=true`
- `browser.defaultProfile="openclaw"` (so the agent uses the built-in headless Chromium profile, not the Chrome-extension relay profile)

If browser actions fail, verify inside the container:

```bash
docker compose -f infra/docker/docker-compose.yml exec -it openclaw sh -lc 'which chromium && chromium --version'
```

## WhatsApp Internal HTTP

OpenClaw exposes:

- Inbound: `http://openclaw:18810/internal/whatsapp/inbound`
- Outbound: `http://openclaw:18810/internal/whatsapp/send`

Port note:

- We run the internal WhatsApp HTTP server on `18810` to avoid colliding with the default browser CDP port (`18800`).

Outbound returns:

- `503 no_active_listener` if WhatsApp is not paired.

## WhatsApp QR Pairing (Web UI)

For dev UX, the platform uses OpenClaw’s gateway `web.login.*` methods to generate a QR as a PNG data URL.

Flow:

- Web UI calls API:
  - `POST /me/whatsapp/login/start` → OpenClaw gateway `web.login.start`
  - `POST /me/whatsapp/login/wait` → OpenClaw gateway `web.login.wait`

Notes:

- The platform API connects to the Gateway as the Control UI client (mode `ui`) to request the `operator.admin` scope needed for `web.login.*`.
- The platform patches the OpenClaw config to allow a dev-only bypass:
  - `gateway.controlUi.allowInsecureAuth=true`
  - `gateway.controlUi.dangerouslyDisableDeviceAuth=true`
  - This is dev-only; do not enable in production.
