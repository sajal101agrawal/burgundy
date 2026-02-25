# API Reference

Base URL:
- From host machine: `http://localhost:3005`
- From inside Docker network: `http://api:3000`

---

## Authentication

Most user-facing endpoints require a JWT:
```
Authorization: Bearer <token>
```

Get a token via `POST /auth/login`.

Internal endpoints require `PLATFORM_INTERNAL_TOKEN`:
```
Authorization: Bearer dev-internal-token
```

---

## Public Endpoints

### Health

```
GET /health
```
Response: `{ "status": "ok" }`

### Auth

#### Register
```
POST /auth/register
```
Body:
```json
{
  "phone": "+15550001111",
  "password": "min-8-chars",
  "personaName": "optional display name"
}
```
Response:
```json
{ "status": "queued", "userId": "uuid" }
```
Queues a provisioning job in the worker. The user's OpenClaw agent and workspace will be ready within a few seconds.

#### Login
```
POST /auth/login
```
Body:
```json
{ "phone": "+15550001111", "password": "..." }
```
Response:
```json
{
  "token": "jwt",
  "user": { "id": "uuid", "phone": "+1555...", "personaName": "Concierge" }
}
```

---

## JWT-Protected Endpoints

All require `Authorization: Bearer <token>`.

### Tasks

```
GET /me/tasks
```
Returns the user's task history (active + completed).

### Vault

```
GET /me/vault
```
Returns the list of vault entry keys for the authenticated user.

### Audit

```
GET /me/audit
```
Returns the audit log for the authenticated user.

### Anthropic API Key

```
GET /me/anthropic-key
```
Response: `{ "configured": true | false }`

```
POST /me/anthropic-key
```
Body: `{ "apiKey": "sk-ant-..." }`

Writes the key to `infra/docker/.env` and to the OpenClaw auth profile in the shared Docker volume. Takes effect immediately.

### WhatsApp

```
POST /me/whatsapp/login/start
```
Body: `{ "force": false }` (optional — `force: true` clears existing session)

Calls OpenClaw Gateway `web.login.start`. Returns:
```json
{
  "ok": true,
  "result": {
    "qrDataUrl": "data:image/png;base64,...",
    "message": "QR ready"
  }
}
```

```
POST /me/whatsapp/login/wait
```
Body: `{ "timeoutMs": 2000 }` (optional, default 2000)

Polls OpenClaw Gateway `web.login.wait`. Returns:
```json
{ "ok": true, "result": { "connected": true | false, "message": "..." } }
```

```
POST /me/whatsapp/test-send
```
Body: `{ "message": "optional text" }`

Sends a test WhatsApp message to the authenticated user's own phone number.

```
GET /me/whatsapp/status
```
Returns the OpenClaw WhatsApp account snapshot:
```json
{
  "running": true,
  "connected": true,
  "linked": true,
  "lastError": null
}
```

### Node Status (Browser Node)

```
GET /me/nodes/status
```
Returns a list of connected browser nodes and their status.

```
POST /me/nodes/approve
```
Body: `{ "requestId": "..." }`

Manually approves a pending node pairing request. Used by the Settings UI.

---

## WhatsApp Webhook (Dev Transport)

```
POST /webhook/whatsapp
```
Body:
```json
{ "from": "+15550001111", "body": "message text" }
```

Called by the OpenClaw WhatsApp adapter when a new inbound DM arrives. Also used by `scripts/send-whatsapp-webhook.sh` to simulate inbound messages without real WhatsApp.

Processing order:
1. Look up user by `from` phone
2. If no Anthropic key configured → ask user for the key over WhatsApp
3. Check for active pending listener (OTP/confirm) → route to waiting coroutine if active
4. Forward to OpenClaw inbound endpoint for agent processing

---

## Internal Endpoints

Protected by `Authorization: Bearer <PLATFORM_INTERNAL_TOKEN>`.

Called by the OpenClaw gateway and worker services. Not intended for direct external use.

### Message Send

```
POST /internal/message/send
```
Body: `{ "to": "+E164", "body": "text", "mediaUrl"?: "...", "mediaType"?: "image|document" }`

Sends a WhatsApp message to a user. Called by OpenClaw when the agent produces a reply.

### Provisioning

```
POST /internal/provision
```
Body: `{ "userId": "uuid", "phone": "+E164", "personaName": "..." }`

Creates the OpenClaw agent binding, allowFrom entry, and writes the agent's workspace files (SOUL.md, AGENTS.md, USER.md).

### User Ask (Proactive Messaging)

```
POST /internal/user-ask
```
Body: `{ "userId": "uuid", "message": "...", "type": "otp|confirm|info", "timeoutMs": 60000 }`

Sends a WhatsApp message to the user and blocks (via Redis) until the user replies. Used by `otp_request`, `stuck_escalate`, and order confirmation flows.

### Pending Listener Check

```
POST /internal/pending-listener/check
```
Body: `{ "senderId": "uuid", "body": "reply text" }`

Checks if there is an active `user.ask` pending listener for this user. If yes, resolves it with the user's reply and returns `{ "handled": true }`. Called from the webhook handler before creating a new task.

### Interrupt Classification

```
POST /internal/interrupt-classify
```
Body: `{ "userId": "uuid", "activeTask": { ... }, "newMessage": "text" }`

Classifies an incoming message relative to an active task as SUPERSEDE / MODIFY / ADDITIVE / UNRELATED.

### Task Checkpoint

```
POST /internal/tasks/checkpoint
```
Body: `{ "taskId": "...", "agentId": "...", "state": { ... } }`

Saves a task checkpoint. Called by the `checkpoint_save` skill.

```
POST /internal/tasks/checkpoint/get
```
Body: `{ "taskId": "..." }`

Retrieves the most recent checkpoint for a task. Called by `checkpoint_resume`.

### Node Auto-Pair

```
POST /internal/nodes/auto-pair
```
Body: `{}` (empty JSON object required)

Approves all pending browser node pairing requests on the OpenClaw Gateway. Handles both `device.pair.*` (used by the node host on initial connection) and `node.pair.*` flows.

Called automatically by `dev-up.sh` and `scripts/node-start.sh` during local node setup.

Response:
```json
{
  "ok": true,
  "approved": 2,
  "approvedIds": ["req-abc", "req-def"],
  "failedIds": []
}
```

Or if no requests are pending:
```json
{ "ok": true, "approved": 0, "message": "no_pending_requests" }
```
