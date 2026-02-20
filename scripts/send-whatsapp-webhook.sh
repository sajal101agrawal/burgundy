#!/usr/bin/env bash
set -euo pipefail

API_URL=${API_URL:-"http://localhost:3000"}
FROM_NUMBER=${FROM_NUMBER:-"+15551234567"}
BODY=${BODY:-"hello from local dev"}

curl -sS -X POST "${API_URL}/webhook/whatsapp" \
  -H "content-type: application/json" \
  -d "{\"from\":\"${FROM_NUMBER}\",\"body\":\"${BODY}\"}"

echo
