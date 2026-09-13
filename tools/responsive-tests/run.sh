#!/usr/bin/env bash
# Checks that no page on the marketing site scrolls sideways on a phone.
#
#   ./tools/responsive-tests/run.sh
#
# Needs Playwright's Chromium. Locally: npx playwright install chromium
set -euo pipefail
cd "$(dirname "$0")/../.."

PORT="${PORT:-8099}"

if ! node -e "require.resolve('playwright')" >/dev/null 2>&1; then
  echo "playwright is not installed; skipping." >&2
  echo "  npm install --no-save playwright && npx playwright install chromium" >&2
  exit 0
fi

PORT="$PORT" node tools/responsive-tests/serve.mjs site >/dev/null 2>&1 &
SERVER=$!
trap 'kill "$SERVER" 2>/dev/null || true' EXIT

for _ in $(seq 1 40); do
  curl -sf "http://127.0.0.1:$PORT/" >/dev/null 2>&1 && break
  sleep 0.25
done

PORT="$PORT" node tools/responsive-tests/check.mjs site
