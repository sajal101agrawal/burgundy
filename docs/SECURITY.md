# Security Notes (Dev Build)

This repository is a dev-grade implementation. Treat it as a foundation, not production-ready security.

## Internal Auth

Internal endpoints on the API are protected by `PLATFORM_INTERNAL_TOKEN`.

In Docker dev:

- Token is set to `dev-internal-token` via `infra/docker/docker-compose.yml`.
- OpenClaw and the worker include the token on internal requests.

## Vault Encryption

`packages/vault-service` stores secrets in Postgres with per-entry AES-256-GCM.

Dev notes:

- `VAULT_MASTER_KEY` is set in docker compose to `dev-master-key`.
- In production, the “master key” should be AWS KMS and per-user keys should be encrypted at rest with KMS.

## WhatsApp (Baileys)

Baileys is used for dev and can violate WhatsApp ToS. Do not scale with Baileys.

## Confirmation Before Irreversible Actions

The platform skill set is designed so irreversible actions require explicit confirmation.

Dev build:

- `deployment-skill` implements a confirmation step via platform `user.ask`.

