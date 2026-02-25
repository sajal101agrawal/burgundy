# Security Notes

This repository is a dev-grade implementation. It is a foundation, not production-ready. All hard-coded secrets and disabled auth controls documented here must be changed before production deployment.

---

## Dev-Only Bypasses (MUST change for production)

| Setting | Dev value | Production requirement |
|---|---|---|
| `PLATFORM_INTERNAL_TOKEN` | `dev-internal-token` | Rotate; use a strong random secret or mTLS |
| `JWT_SECRET` | `dev-secret` | 256-bit random secret stored in a secret manager |
| `VAULT_MASTER_KEY` | `dev-master-key` | AWS KMS or equivalent HSM |
| `OPENCLAW_GATEWAY_TOKEN` | `dev-gateway-token` | Rotate per deployment; store in secret manager |
| `controlUi.dangerouslyDisableDeviceAuth` | `true` | Remove; require proper device pairing |
| `controlUi.allowInsecureAuth` | `true` | Remove; enforce TLS and proper auth |

---

## Internal API Authentication

All internal endpoints (`/internal/*`) are protected by `PLATFORM_INTERNAL_TOKEN`.

In Docker dev: token is set to `dev-internal-token` in `docker-compose.yml`.

OpenClaw and workers include this token in the `Authorization: Bearer` header on all internal requests.

In production: rotate the token, restrict network access to the internal endpoints, consider mTLS between services.

---

## Vault Encryption

`packages/vault-service` stores credentials in Postgres with per-entry AES-256-GCM encryption.

Key hierarchy (dev):
```
VAULT_MASTER_KEY (env var, cleartext in dev)
  └── Per-user encryption key (derived or stored)
       └── Per-entry AES-256-GCM ciphertext
```

In production:
- Replace `VAULT_MASTER_KEY` with AWS KMS
- Per-user keys should be encrypted at rest with KMS
- Never store the master key in plaintext in an env file

---

## User Authentication (JWT)

- Passwords are stored as scrypt hashes (v1)
- JWT tokens are signed with `JWT_SECRET`
- Dev: `JWT_SECRET=dev-secret` — short, predictable. Replace in production.

---

## WhatsApp (Baileys)

Baileys is a WhatsApp web protocol reverse-engineering library used for dev pairing.

Risks:
- Can violate WhatsApp ToS
- Sessions can be revoked by WhatsApp at any time
- Not suitable for production scale or commercial use

**For production**: Use the official [WhatsApp Business API](https://developers.facebook.com/docs/whatsapp/cloud-api) or a licensed BSP (Business Service Provider).

---

## Agent Confirmations (Irreversible Actions)

The platform is designed to always ask for explicit confirmation before irreversible actions:

| Action | Confirmation mechanism |
|---|---|
| Placing an order / payment | Agent stops and shows order summary + "Confirm?" before checkout |
| Deploying to production | `deploy` skill calls `user.ask` for explicit confirmation |
| Sending email on behalf of user | Agent asks "Ready to send this email?" before submitting |
| Deleting data | Agent asks "This will permanently delete X. Confirm?" |

This is enforced in `AGENTS.md` (Red Lines section) and in each skill's implementation.

The `user.ask` primitive (Redis pending listener) ensures execution is suspended until the user explicitly replies.

---

## Credential Handling

- Credentials collected during tasks (email+password) are never stored in reply messages
- They are passed directly to the browser via the `browser` tool
- If the user wants to save a credential for reuse, the agent uses `vault_set` which encrypts it
- The `vault-skill` plugin ensures vault operations are always scoped to the correct `userId`

---

## Data Isolation

In the multi-agent dev setup:
- Each user's agent has a separate OpenClaw workspace directory
- Vault entries are scoped per `userId`
- Memory files are per-agent
- Session history is per-agent

Cross-user data access is not possible through the agent tools — the `platform-userid-injector` plugin always injects the correct `userId` from `ctx.agentId`, not from agent-supplied parameters.

---

## Network Security

In Docker dev, all services are on the same bridge network. In production:

- The OpenClaw gateway should be behind a firewall and accessible only to the API service
- Internal endpoints should not be exposed to the public internet
- Use TLS for all inter-service communication
- The browser node proxy connects via WebSocket to the Gateway — ensure the Gateway port (18789) is not publicly accessible
