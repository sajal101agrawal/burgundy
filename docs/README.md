# Platform Docs

Documentation for the AI Concierge Platform — a WhatsApp-native autonomous agent system built on OpenClaw.

Start here based on what you need:

---

## Getting started

- **`docs/LOCAL_DEV.md`** — Prerequisites, quick start, WhatsApp pairing, browser node setup, all service URLs, environment variables

---

## Understanding the system

- **`docs/ARCHITECTURE.md`** — Full system design: services, message flow, agent behavior (REASON → PLAN → ACT → DELIVER), intent router, workspace files, OTP relay, multi-agent setup, local browser node, vault

- **`docs/OPENCLAW.md`** — OpenClaw fork details: what was patched, all 11 platform plugins (intent-router, vault, OTP relay, stuck handler, checkpoint, deck, media, screenshot, deployment, account-creator, userid-injector), workspace file paths, dev configuration

---

## Reference

- **`docs/API.md`** — All API endpoints: public (health, auth), JWT-protected (tasks, vault, WhatsApp, nodes), internal (provision, user-ask, pending-listener, interrupt-classify, checkpoint, auto-pair)

- **`docs/WEB_UI.md`** — Web UI pages: settings (API key, WhatsApp QR, node pairing), dashboard, vault viewer, tasks, registration

---

## Operations

- **`docs/TROUBLESHOOTING.md`** — Common failure modes and fixes: agent behavior issues, WhatsApp problems, browser automation failures, service errors

- **`docs/SECURITY.md`** — Security model: internal auth, vault encryption, JWT, Baileys risks, agent confirmations, credential handling, data isolation

---

## Repo root

- **`README.md`** — Project overview, capabilities table, repository layout, quick start, agent behavior design, browser node, development workflows, environment variables, troubleshooting quick reference
