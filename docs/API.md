# API Reference (Dev)

Base URL in Docker dev:

- Host: `http://localhost:3005`
- In-container: `http://api:3000`

## Public Endpoints

### Health

- `GET /health` -> `{ "status": "ok" }`

### Auth

- `POST /auth/register`
  - Body: `{ "phone": "+1555...", "password": "min 8 chars", "personaName": "optional" }`
  - Result: `{ "status": "queued", "userId": "uuid" }`
- `POST /auth/login`
  - Body: `{ "phone": "+1555...", "password": "..." }`
  - Result: `{ "token": "jwt", "user": { ... } }`

### Me (JWT required)

Header: `Authorization: Bearer <token>`

- `GET /me/tasks`
- `GET /me/vault`
- `GET /me/audit`
- `GET /me/anthropic-key` -> `{ "configured": true|false }`
- `POST /me/anthropic-key`
  - Body: `{ "apiKey": "sk-ant-..." }`
- `POST /me/whatsapp/login/start`
  - Body: `{ "force": false }` (optional)
  - Result: `{ "ok": true, "result": { "qrDataUrl"?: "data:image/png;base64,...", "message": "..." } }`
- `POST /me/whatsapp/login/wait`
  - Body: `{ "timeoutMs": 2000 }` (optional)
  - Result: `{ "ok": true, "result": { "connected": true|false, "message": "..." } }`
- `POST /me/whatsapp/test-send`
  - Body: `{ "message"?: "..." }` (optional)
  - Sends a test WhatsApp message to your own user phone.
- `GET /me/whatsapp/status`
  - Returns the OpenClaw WhatsApp account snapshot (running/connected/linked + lastError).

### WhatsApp Webhook (Dev Transport)

- `POST /webhook/whatsapp`
  - Body: `{ "from": "+1555...", "body": "text" }`

## Internal Endpoints (Protected)

These are called by OpenClaw and workers. In dev, `PLATFORM_INTERNAL_TOKEN=dev-internal-token` is used.

- `POST /internal/message/send`
- `POST /internal/provision`
- `POST /internal/user-ask`
- `POST /internal/pending-listener/check`
- `POST /internal/interrupt-classify`
- `POST /internal/tasks/checkpoint`
- `POST /internal/tasks/checkpoint/get`
