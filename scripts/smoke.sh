#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="infra/docker/docker-compose.yml"

echo "[1/4] Lint/typecheck/build"
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm build

echo
echo "[2/4] Docker up"
docker compose -f "$COMPOSE_FILE" up -d --build

echo
echo "[3/4] In-container health checks"
docker compose -f "$COMPOSE_FILE" exec -T api node --input-type=module -e "const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));let lastErr='';for(let i=0;i<60;i++){try{const r=await fetch('http://localhost:3000/health');if(r.ok){const j=await r.json();if(j?.status==='ok'){console.log(j);process.exit(0);}lastErr=JSON.stringify(j);}else{lastErr=String(r.status);} }catch(e){lastErr=String(e);}await sleep(1000);}console.error('health_check_timeout', lastErr);process.exit(1);"

echo
echo "[4/4] OpenClaw plugin sanity (no missing manifests)"
if docker compose -f "$COMPOSE_FILE" logs --no-log-prefix openclaw | grep -q "plugin manifest not found"; then
  echo "Found plugin manifest errors in OpenClaw logs."
  docker compose -f "$COMPOSE_FILE" logs --no-log-prefix openclaw | grep "plugin manifest not found" | tail -n 20
  exit 1
fi

echo "Smoke test OK."
