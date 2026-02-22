# Web UI Guide (Dev)

Base URL:

- `http://localhost:3001`

## Login

The dev stack bootstraps a single dev user (configurable via `DEV_USER_PHONE`).

Default dev credentials:

- Phone: whatever `DEV_USER_PHONE` is set to in `infra/docker/.env`
- Password: `dev-password`

Login happens on:

- `http://localhost:3001/settings`

The JWT is stored in `localStorage`.

## Settings

`/settings` is the platform operator console for local dev:

- Anthropic key:
  - Paste your `sk-ant-...` key and save.
  - This writes `ANTHROPIC_API_KEY=...` into `infra/docker/.env` and also updates OpenClaw’s auth profile inside the shared Docker volume.
- WhatsApp pairing (dev):
  1. Click **Generate QR** (or **Force relink** if you’re stuck).
  2. On the phone that owns the WhatsApp account: WhatsApp → Settings → Linked Devices → Link a device → scan.
  3. Keep the page open until it shows “WhatsApp linked.”
  4. Click **Send test to me** to confirm outbound messages work.
  5. Users should message the **Platform inbox number** shown on the page (single shared inbox).

- Run browser on your machine (Node):
  - This is the fix for “Blinkit/Zepto blocks server automation (429/Cloudflare)”.
  - Start the node host command shown on the page in a terminal on your laptop/desktop.
  - Approve the pending pairing request (copy the `requestId` from the JSON and approve).
  - Once connected, OpenClaw’s browser tool will auto-route to your machine’s browser proxy, so automation originates from your residential IP.

## Other Pages

- `/dashboard`: task overview (active task + history)
- `/vault`: read-only list of vault entries (dev UI)
- `/tasks`: task history list (dev UI)
- `/register`: registration page (queues provisioning in the worker)
