# AI Concierge Platform

This repository scaffolds the AI Concierge Platform described in the February 2026 technical specification.

## Structure
- `apps/api`: Fastify API gateway
- `apps/worker`: BullMQ workers
- `apps/web`: Next.js 14 web UI
- `packages/openclaw-fork`: OpenClaw git subtree placeholder
- `packages/openclaw-extensions`: Custom OpenClaw skills
- `packages/strategy-engine`, `packages/interrupt-classifier`, `packages/proactive-messaging`: core intelligence services
- `packages/vault-service`, `packages/memory-service`, `packages/email-service`: internal services
- `packages/shared/*`: shared config, types, db schema, logger, queue names
- `infra/docker`: Dockerfiles and dev compose

## Quick start (local)
1. Install dependencies: `pnpm install`
2. Start services via Docker Compose: `docker compose -f infra/docker/docker-compose.yml up`

## OpenClaw fork
Add the subtree to `packages/openclaw-fork` as described in `packages/openclaw-fork/README.md`.
