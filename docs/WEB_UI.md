# Web UI Guide

Base URL: http://localhost:3001

---

## Login

Default dev credentials:
- **Phone**: value of `DEV_USER_PHONE` in `infra/docker/.env` (default: `+15550001111`)
- **Password**: `dev-password`

Login page: http://localhost:3001/settings (redirects if not logged in)

The JWT token is stored in `localStorage`. It expires based on `JWT_SECRET` (dev default is non-expiring for convenience).

---

## Pages

### `/settings` — Platform Operator Console

The main control panel for local dev. Contains:

#### Anthropic API Key

- Paste your `sk-ant-...` key and click Save
- What happens:
  - Writes `ANTHROPIC_API_KEY=...` to `infra/docker/.env`
  - Writes an OpenClaw auth profile into the shared Docker volume
  - Takes effect immediately — no container restart needed
- If not configured, the platform will attempt to ask for the key via WhatsApp on first agent use

#### WhatsApp Pairing (Dev)

Shows the platform inbox number that users should message.

To pair:
1. Click **Generate QR** (or **Force relink** to clear and start fresh)
2. On the phone owning the WhatsApp account: WhatsApp → Settings → Linked Devices → Link a device → scan
3. Keep the page open until it shows "WhatsApp linked"
4. Click **Send test to me** to confirm outbound messaging works

Status indicators:
- "WhatsApp linked" — paired and connected
- "Not connected" — not paired or session expired → click Force relink
- "Connecting..." — Baileys reconnecting (wait 10-15 seconds)

Notes:
- The number you pair here is the **platform inbox** — not any user's personal number
- All registered users message this inbox; the router dispatches to their individual agent
- If you see `status=515` restart errors, keep the page open for 15 seconds or click Force relink
- If the session shows 401/logged out, click Force relink and restart the OpenClaw container

#### Run Browser On Your Machine (Node)

This is the fix for Blinkit/Zepto/Instamart blocking server automation (Cloudflare, 429, bot detection).

**Automatic (recommended):**
- `dev-up.sh` starts and auto-pairs the node. Check status here.
- If not connected, run `pnpm node:start` in your terminal.

**Manual:**
1. Copy and run the node host command shown on the page in your terminal
2. Wait a few seconds — the pending pairing request will appear below
3. Click **Approve** next to the pending request

Once connected:
- The agent routes `browser target="node"` actions to your machine
- Your residential IP is used instead of the datacenter IP
- Quick-commerce sites that block servers will now work

Pending pairing requests:
- Lists any node hosts waiting for approval (both device.pair and node.pair flows)
- Each shows a `requestId` which you can approve with one click
- Auto-approved by `pnpm node:start`

#### Node Pairing Status

Shows a list of currently connected browser nodes with:
- Display name
- Connected status
- Last seen timestamp

#### Refresh

All status sections (WhatsApp, node) have a **Refresh** button to poll the latest state.

---

### `/dashboard` — Task Overview

Shows:
- Currently active task (if any) with status and progress
- Recent task history with outcomes

---

### `/vault` — Vault Viewer (Dev)

Read-only list of vault entries for the logged-in user.

Shows: key names and metadata. Does not show decrypted values (dev safety measure).

To view or manage vault values, use the agent directly ("show me my saved passwords" / "save my Netflix password").

---

### `/tasks` — Task History

Full task history list with:
- Task ID
- Trigger message
- Status (active, completed, failed, superseded)
- Timestamps
- Agent response preview

---

### `/register` — User Registration

Registration form for new users:
- Phone number (E.164 format, e.g. `+91...`)
- Password (min 8 chars)
- Display name (optional)

On submit: queues a provisioning job. The new user's OpenClaw agent, workspace files, and allowFrom entry are created within a few seconds.

After registration: the user should message the **platform inbox number** shown in Settings → WhatsApp Pairing.

---

## Common Workflows

### Test that the full stack works

1. Settings → set Anthropic key
2. Settings → pair WhatsApp, send test message
3. Message the platform inbox from your phone: "hello"
4. Expect a reply from the agent

### Test browser automation

1. Ensure the browser node is connected (Settings → Run Browser On Your Machine)
2. Message the platform inbox: "search for iphone 16 on Amazon"
3. Agent should open a browser, navigate to amazon.in, search, and report results

### Test OTP relay

1. Trigger a task that requires OTP login (e.g., "check my email" after providing credentials)
2. When the agent reaches the OTP screen, you receive a WhatsApp message asking for the OTP
3. Reply with the OTP — agent continues

### Add/update Anthropic key without restarting

1. Settings → paste new key → Save
2. The change takes effect on the next agent invocation
