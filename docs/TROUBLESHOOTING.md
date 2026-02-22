# Troubleshooting

## “plugin manifest not found” in OpenClaw logs

Cause:

- A platform plugin is missing `openclaw.plugin.json`.

Fix:

- Ensure each plugin folder under `packages/openclaw-extensions/*` contains `openclaw.plugin.json`.
- Rebuild OpenClaw container:

```bash
docker compose -f infra/docker/docker-compose.yml up -d --build openclaw
```

## Outbound WhatsApp fails with `no_active_listener`

Cause:

- WhatsApp not paired in OpenClaw container.
  - Or OpenClaw is restarting and the listener hasn’t re-attached yet (transient).

Fix:

```bash
docker compose -f infra/docker/docker-compose.yml exec -it openclaw node openclaw.mjs channels login whatsapp
```

Recommended (Web UI):

1. Open `http://localhost:3001/settings`
2. Login
3. Generate QR and scan on the phone that owns the WhatsApp account
4. Click **Send test to me**

If you see `no_transport` from the internal inbound endpoint, wait ~5–10 seconds and retry. The platform router retries transient 503s, but right after a config reload OpenClaw may briefly have no listener attached.

## WhatsApp pairing fails with `status=515 ... (restart required)`

Cause:

- A Baileys “restart-after-pairing” edge case: WhatsApp asks the web session to reconnect right after scanning.

Fix:

1. Keep the Settings page open for ~15 seconds; it should recover automatically.
2. If it keeps looping, click **Force relink** (clears cached auth + generates a fresh QR).
3. If it still fails, remove existing linked devices on the phone and try again.

## WhatsApp status shows 401 Unauthorized / “Session logged out”

Cause:

- The linked-device session was revoked, or cached creds are corrupted/partial.

Fix:

1. `http://localhost:3001/settings` → **Force relink**
2. Restart OpenClaw:

```bash
docker compose -f infra/docker/docker-compose.yml up -d --force-recreate openclaw
```

## Web UI `/settings` shows 500 errors

Cause:

- A stale/corrupted Next.js dev build output.

Fix:

- Restart the `web` service (dev compose clears `apps/web/.next` on startup):

```bash
docker compose -f infra/docker/docker-compose.yml up -d --force-recreate web
```

## API can’t access DB tables

Cause:

- Migrations did not run or Postgres isn’t reachable.

Fix:

- Check docker compose status:

```bash
docker compose -f infra/docker/docker-compose.yml ps
```

- Run:

```bash
pnpm db:migrate
```

## Agent can’t run / model errors

Cause:

- Missing `ANTHROPIC_API_KEY` (or invalid key).

Fix:

- Set the key with `pnpm dev:up` prompt, or via `http://localhost:3001/settings`.

## Browser tool says “Chrome extension relay is running, but no tab is connected”

Cause:

- The browser tool is using profile `"chrome"` (the Chrome-extension relay profile), but no real Chrome tab has been attached via the OpenClaw Browser Relay extension.

Fix:

- In this repo’s Docker dev stack, we default to profile `"openclaw"` (headless Chromium in-container). Ensure the OpenClaw config has:
  - `browser.defaultProfile="openclaw"`
- If you actually want to control your desktop Chrome via extension relay, you must:
  - install the OpenClaw Browser Relay extension in Chrome
  - click the toolbar icon on the target tab (badge ON)
  - then use `profile="chrome"`

## Browser tool says “tab not found”

Cause:

- A browser action was attempted without a valid `targetId` (or using a stale `targetId`).

Fix:

- The platform patches OpenClaw so `snapshot/navigate/act/...` will auto-pick an open page tab when `targetId` is omitted.
- If you still hit it:
  1. Run `browser` with `action=tabs` and note a valid `targetId`.
  2. Retry with that `targetId`.

## Some sites (e.g. Blinkit) show Cloudflare / “Access Denied”

Cause:

- Bot protection / IP reputation blocks headless, datacenter-origin browser automation.

Fix options:

- Switch providers (Zepto / Instamart / etc) and retry.
- Run browser automation on the user’s machine (OpenClaw Node browser proxy) so traffic originates from a residential IP.
- Fall back to human-in-the-loop: have the user complete the blocked step and then reply “done” so the agent continues.

## Smoke Test

When in doubt:

```bash
pnpm smoke
```
