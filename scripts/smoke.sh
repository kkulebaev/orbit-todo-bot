#!/usr/bin/env bash
# Smoke test for @orbit/cli against the deployed Railway API.
#
# Requires:
#   - ORBIT_TOKEN: a user-PAT minted via /cli_link in the bot
#   - ORBIT_API_BASE_URL: public API URL (default: https://orbit-todo-api.up.railway.app)
#
# Exits 0 on success, non-zero on any failure.

set -euo pipefail

CLI="${CLI:-node $(pwd)/apps/cli/dist/index.js}"
BASE="${ORBIT_API_BASE_URL:-https://orbit-todo-api.up.railway.app}"

if [ -z "${ORBIT_TOKEN:-}" ]; then
  echo "ORBIT_TOKEN env var required (mint via /cli_link in bot)"
  exit 1
fi

echo "→ orbit --version"
$CLI --version

echo "→ orbit whoami --json"
ORBIT_API_BASE_URL="$BASE" ORBIT_TOKEN="$ORBIT_TOKEN" $CLI whoami --json | head -c 200
echo

echo "→ orbit list --json"
ORBIT_API_BASE_URL="$BASE" ORBIT_TOKEN="$ORBIT_TOKEN" $CLI list --json | head -c 200
echo

echo "OK"
