# Architecture (Dev Build)

This repo implements a dev-grade version of the February 2026 specification:

- OpenClaw provides the agent loop, browser automation, channel adapters, session management, and tool execution.
- The platform adds SaaS primitives: registration/login, routing, task + listener state, vault service, and service orchestration.

## Services

Docker Compose services (see `infra/docker/docker-compose.yml`):

- `web` (Next.js): registration, login, dashboard, vault viewer, settings
- `api` (Fastify): HTTP gateway, auth, WhatsApp webhook receiver, internal endpoints for OpenClaw + workers
- `worker` (BullMQ): provisioning jobs, outbound message jobs, tool discovery, audit writes
- `vault` (Fastify): encrypted credential storage in Postgres (dev-grade key hierarchy)
- `memory` (Fastify): memory persistence in Postgres (dev-grade text query)
- `email` (Fastify): inbound email receiver that enqueues actionability classification
- `openclaw` (OpenClaw gateway): agent runtime and WhatsApp adapter (Baileys dev)
- `postgres` (pgvector image): primary DB for users/tasks/vault/memory/audit/tool registry
- `redis` (redis): BullMQ backend + pending listener coordination

## Message Flow (WhatsApp)

High-level:

1. WhatsApp message arrives at API: `POST /webhook/whatsapp` with `{ from, body }`.
2. API looks up user by `from` phone number.
3. Pending listener check:
   - If there is an active listener (OTP/confirm/info), the reply is routed to the waiting coroutine and the message is not turned into a new task.
4. Interrupt classification:
   - If a task is active, the new message is classified as SUPERSEDE/MODIFY/ADDITIVE/UNRELATED (dev implementation).
5. Dispatch:
   - API forwards the message into OpenClaw’s internal HTTP inbound endpoint (`openclaw:18810/internal/whatsapp/inbound`).

## OpenClaw Multi-Agent (Dev)

Dev uses a single OpenClaw runtime with multiple agents configured in `openclaw.platform.json`:

- `agentId = userId` (UUID) for each registered user.
- OpenClaw `bindings[]` map `(channel=whatsapp, peer.direct.id=+E164)` → `agentId`.
- WhatsApp inbound DMs are allowlisted via the OpenClaw allowFrom store file.

This gives per-user persona + memory isolation without per-user containers (which comes later).

Outbound:

- Worker/API uses OpenClaw’s internal outbound endpoint (`/internal/whatsapp/send`) to send WhatsApp messages.
- If WhatsApp isn’t paired, OpenClaw returns `503 no_active_listener`.

## Proactive Messaging (`user.ask`)

`user.ask` is the “pause + wait for reply” primitive used by OTP, confirmations, and missing-info prompts.

Implementation:

- Stored in Redis (`packages/proactive-messaging`) with a blocking pop per ask, so execution can suspend until the user replies.
- The router resolves the pending listener before creating any new task.

## OpenClaw Platform Skills (Plugins)

Platform skills are loaded as OpenClaw plugins from `/app/extensions/*` in the OpenClaw container.

Examples:

- Vault tools: `vault_get`, `vault_set`, `vault_list`, `vault_share`
- OTP relay: `otp_request`
- Stuck handler: `stuck_escalate`
- Checkpointing: `checkpoint_save`, `checkpoint_resume`
- Deployment: `deploy` (dev-grade, currently Vercel-only path)

Each platform plugin includes `openclaw.plugin.json` so the OpenClaw plugin loader can validate and enable it.
