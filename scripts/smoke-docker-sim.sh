#!/usr/bin/env bash
# Simulates the Dockerfile build steps (workspace-manifest npm ci, backend-only
# build) and smoke-tests the production server, including extension CORS.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
SIM=$(mktemp -d)
SERVER_PID=""
cleanup() {
  if [[ -n "$SERVER_PID" ]]; then
    kill "$SERVER_PID" 2>/dev/null || true
  fi
  rm -rf "$SIM"
}
trap cleanup EXIT

mkdir -p "$SIM/apps/backend" "$SIM/apps/extension"
cp "$REPO/package.json" "$REPO/package-lock.json" "$SIM/"
cp "$REPO/apps/backend/package.json" "$SIM/apps/backend/"
cp "$REPO/apps/extension/package.json" "$SIM/apps/extension/"

cd "$SIM"
npm ci --workspace=@extcom-ai/backend >/dev/null
echo "npm ci (workspace graph) OK"

cp -r "$REPO/apps/backend/src" apps/backend/src
cp "$REPO/apps/backend/tsconfig.json" apps/backend/
npm run build --workspace=@extcom-ai/backend >/dev/null
echo "backend build OK"

NODE_ENV=production PORT=3457 AUTH_TOKENS=simtoken:free \
  DATABASE_PATH="$SIM/db.sqlite" node apps/backend/dist/server.js &
SERVER_PID=$!
sleep 2

echo "--- /health ---"
curl -sf http://localhost:3457/health
echo
echo "--- CORS preflight from extension origin ---"
curl -s -X OPTIONS http://localhost:3457/v1/generate-reply \
  -H "Origin: chrome-extension://abcdefg" \
  -H "Access-Control-Request-Method: POST" \
  -D - -o /dev/null | grep -iE "^HTTP|access-control" || true
echo "--- authenticated quota check (must not consume) ---"
ME_BEFORE=$(curl -sf http://localhost:3457/v1/me \
  -H "Authorization: Bearer simtoken")
echo "$ME_BEFORE"
echo "--- generate-reply auth + provider path (no API key => 503 expected) ---"
curl -s -X POST http://localhost:3457/v1/generate-reply \
  -H "Origin: chrome-extension://abcdefg" \
  -H "Authorization: Bearer simtoken" \
  -H "Content-Type: application/json" \
  --data '{"postText":"test post","tone":"degen"}'
echo
ME_AFTER=$(curl -sf http://localhost:3457/v1/me \
  -H "Authorization: Bearer simtoken")
if [[ "$ME_AFTER" != "$ME_BEFORE" ]]; then
  echo "quota changed after failed provider request" >&2
  exit 1
fi
echo "failed provider request refunded quota"
echo "--- dev token must be rejected in production ---"
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3457/v1/generate-reply \
  -H "Authorization: Bearer dev-local-token" \
  -H "Content-Type: application/json" \
  --data '{"postText":"test post","tone":"degen"}'
