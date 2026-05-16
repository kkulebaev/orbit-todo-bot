#!/usr/bin/env bash
# smoke-legacy-rejection.sh
#
# AC-P2-22 step 8: assert that a legacy API_BOT_TOKEN is rejected with 401.
# Usage: API_BASE_URL=https://orbit-todo-api.up.railway.app \
#        OLD_BOT_TOKEN=<old-API_BOT_TOKEN-value> \
#        ./scripts/smoke-legacy-rejection.sh
#
# Exits 0 if the API returns 401 (legacy token rejected).
# Exits 1 otherwise (token was accepted or server error).

set -euo pipefail

API_BASE_URL="${API_BASE_URL:-https://orbit-todo-api.up.railway.app}"
OLD_BOT_TOKEN="${OLD_BOT_TOKEN:-}"

if [[ -z "$OLD_BOT_TOKEN" ]]; then
  echo "ERROR: OLD_BOT_TOKEN must be set" >&2
  exit 1
fi

HTTP_STATUS=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "Authorization: Bearer ${OLD_BOT_TOKEN}" \
  -H "X-Telegram-User-Id: 123456789" \
  "${API_BASE_URL}/v1/users/me")

echo "HTTP status: ${HTTP_STATUS}"

if [[ "$HTTP_STATUS" == "401" ]]; then
  echo "PASS: legacy token correctly rejected with 401"
  exit 0
else
  echo "FAIL: expected 401, got ${HTTP_STATUS}" >&2
  exit 1
fi
