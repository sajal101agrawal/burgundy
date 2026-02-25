# Troubleshooting

---

## Agent Behavior

### Agent doesn't reason or plan — just acts immediately or gives a generic answer

**Cause**: The agent's persona files (`SOUL.md`, `AGENTS.md`) are either not present, stale, or written to the wrong path.

**Diagnosis**: Check the actual workspace files:
```bash
docker exec docker-openclaw-1 cat /workspace/workspace-00000000-0000-0000-0000-000000000001/AGENTS.md | head -20
```
If it shows the generic OpenClaw workspace guide instead of the Concierge rules, the files need to be rewritten.

**Fix**: Restart the API container — it rewrites the workspace files on startup:
```bash
docker compose -f infra/docker/docker-compose.yml up -d --force-recreate api
```

Then verify:
```bash
docker exec docker-openclaw-1 head -10 /workspace/workspace-00000000-0000-0000-0000-000000000001/SOUL.md
# Should show: "You are Concierge — an autonomous operating assistant..."
```

### Agent says "I don't have access to ordering apps" or similar

**Cause**: The intent router directive wasn't injected, or the agent ignored it.

**Fix**:
1. Verify the intent router plugin is loaded:
   ```bash
   docker logs docker-openclaw-1 | grep intent
   docker exec docker-openclaw-1 ls /app/extensions/intent-router-skill/dist/
   ```
2. Check that the plugin is enabled in the platform config:
   ```bash
   docker exec docker-openclaw-1 grep -A3 "intent-router" /workspace/state/openclaw.platform.json
   ```
3. Make sure the extension was built before the container:
   ```bash
   pnpm --filter intent-router-skill build
   docker compose -f infra/docker/docker-compose.yml up -d --build --force-recreate openclaw
   ```

### Agent creates PPT directly without using Gamma/Canva

**Cause**: Same as above — `AGENTS.md` or the intent router directive isn't reaching the agent.

**Fix**: Same as "agent doesn't reason" fix above.

---

## WhatsApp

### Outbound fails with `no_active_listener` (503)

**Cause**: WhatsApp is not paired to the OpenClaw container, or the Baileys listener hasn't re-attached yet after a restart.

**Fix (Web UI)**:
1. Open http://localhost:3001/settings
2. Click **Generate QR** → scan on phone → wait for "WhatsApp linked"
3. Click **Send test to me**

**Fix (terminal fallback)**:
```bash
docker compose -f infra/docker/docker-compose.yml exec -it openclaw node openclaw.mjs channels login whatsapp
```

If you see `no_transport` from the inbound endpoint, wait 5-10 seconds — the platform router retries transient 503s, but right after a config reload there may be a brief window with no listener attached.

### WhatsApp pairing fails with `status=515 ... (restart required)`

**Cause**: A Baileys "restart-after-pairing" edge case — WhatsApp asks the web session to reconnect right after scanning.

**Fix**:
1. Keep the Settings page open for ~15 seconds — it should recover automatically
2. If it keeps looping, click **Force relink** (clears cached auth + generates a fresh QR)
3. If it still fails, remove the linked device on your phone and try again

### WhatsApp status shows 401 Unauthorized / "Session logged out"

**Cause**: The linked-device session was revoked (e.g., logged out from phone), or cached credentials are corrupted.

**Fix**:
1. Settings → **Force relink**
2. Restart OpenClaw:
   ```bash
   docker compose -f infra/docker/docker-compose.yml up -d --force-recreate openclaw
   ```

### Messages from user not reaching the agent

**Cause**: User's phone number is not allowlisted or not routable to an agent.

**Fix**:
1. Confirm the user is registered: check the users table or try `POST /auth/register`
2. Check the routing logs in the API container:
   ```bash
   docker logs docker-api-1 --tail 50 | grep whatsapp
   ```
3. Verify the agent binding exists in OpenClaw config:
   ```bash
   docker exec docker-openclaw-1 grep "+phonenumber" /workspace/state/openclaw.platform.json
   ```

---

## Browser Automation

### Sites show Cloudflare / "Access Denied" / 429

**Cause**: Bot protection blocks the datacenter IP of the OpenClaw Docker container.

**Fix**:
1. Run `pnpm node:start` to start the local browser node using your residential IP
2. Verify it's connected in Settings → "Run Browser On Your Machine"
3. The agent automatically uses `target="node"` (residential IP) first — it falls back to `target="host"` only if the node is unavailable

If the user explicitly wants a specific provider that is blocking:
- Agent should try the next best provider automatically
- If blocked on all providers, agent asks: "Switch provider or run the browser on your machine?"

### Browser node not connecting / pairing not approved

**Cause**: The node host started but the pairing request wasn't approved automatically.

**Fix**:
```bash
pnpm node:start
```
This kills any stale node host, starts a fresh one, and polls `POST /internal/nodes/auto-pair` until connected.

If still failing, check the node log:
```bash
cat .openclaw-local/node-host.log
```

And check the API auto-pair response manually:
```bash
curl -sf -X POST http://localhost:3005/internal/nodes/auto-pair \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer dev-internal-token" \
  -d '{}'
```

### Browser tool says "Chrome extension relay is running, but no tab is connected"

**Cause**: The agent is trying to use `profile="chrome"` (the Chrome-extension relay), but no Chrome tab has been attached via the OpenClaw Browser Relay extension.

**Fix**: In this repo's Docker dev stack, the default profile is `"openclaw"` (headless Chromium in-container). Verify:
```bash
docker exec docker-openclaw-1 grep "defaultProfile" /workspace/state/openclaw.platform.json
```
Should show `"openclaw"`. If showing `"chrome"`, update the platform config.

### Browser tool says "tab not found" or stale targetId

**Cause**: A browser action was attempted with a stale or invalid `targetId`.

**Fix**: The platform patches OpenClaw to auto-pick an open page tab when `targetId` is omitted. If still hitting it:
1. Run `browser action=tabs` to list valid tab IDs
2. Retry with the correct `targetId`

---

## API / Services

### Web UI `/settings` shows 500 errors

**Cause**: Stale or corrupted Next.js dev build output.

**Fix** (dev compose clears `apps/web/.next` on startup):
```bash
docker compose -f infra/docker/docker-compose.yml up -d --force-recreate web
```

### API can't access DB tables / migration errors

**Cause**: Migrations didn't run, or Postgres isn't reachable.

**Fix**:
```bash
# Check services
docker compose -f infra/docker/docker-compose.yml ps

# Run migrations manually
pnpm db:migrate
```

### Agent can't run / model errors

**Cause**: Missing or invalid `ANTHROPIC_API_KEY`.

**Fix**: Set the key in Settings → Anthropic API Key, or in `infra/docker/.env` and restart the API.

### OpenClaw log shows "plugin manifest not found"

**Cause**: A platform plugin is missing `openclaw.plugin.json`.

**Fix**:
1. Check each plugin in `packages/openclaw-extensions/*/openclaw.plugin.json` exists
2. Rebuild the OpenClaw container:
   ```bash
   docker compose -f infra/docker/docker-compose.yml up -d --build --force-recreate openclaw
   ```

### `POST /internal/nodes/auto-pair` returns `{ "ok": false, "error": "openclaw_gateway_not_configured" }`

**Cause**: `OPENCLAW_GATEWAY_URL` is not set in the API container environment.

**Fix**: Verify `infra/docker/docker-compose.yml` has `OPENCLAW_GATEWAY_URL=ws://openclaw:18789` in the `api` service environment.

---

## General

### Smoke test fails

```bash
pnpm smoke
```

Read the output carefully — it shows exactly which step failed. Common causes:
- TypeScript errors → `pnpm typecheck`
- Docker compose not up → `./scripts/dev-up.sh`
- API not responding → check `docker logs docker-api-1`
- OpenClaw plugin errors → check `docker logs docker-openclaw-1`

### Hard reset (lose all state)

```bash
docker compose -f infra/docker/docker-compose.yml down -v
./scripts/dev-up.sh
```

This destroys all data (Postgres, Redis, OpenClaw workspace, vault). Use only in dev.
